"""SAP Requirements integration - real-data sync for the SapActualTransaction/
SapCommitment tables (see models_phase2.py), which today are only ever
populated by the manual `python -m app.seed_mock_sap` CLI script. These two
tables are read live by Utilization's Overview + Reconciliation, Transfer's
`/cc-gl-balance` display and submit-time balance check, Dash Flow's budget
check, and Reports' Budget vs Actual - so this one sync feeds all of those at
once (see routers/utilization.py's new POST /utilization/sync-sap).

Same delete-and-regenerate convention app/seed_mock_sap.py already uses (not
a new upsert scheme) - both functions clear the target fiscal year's existing
rows first, then insert fresh ones - but from the local raw SAP cache (see
models_sap_raw.py / sap_raw_sync_service.py) rather than the broker directly,
since Forecast GAE/DOE and Manpower need those same FBL3N/KSSB V1 reports too
and used to each pull them independently. The full sync run (see
_run_sync_and_record below) refreshes that raw cache first, then re-derives
these two tables from it.
"""

from __future__ import annotations

import logging
import threading
import time
from datetime import datetime, timedelta

from sqlalchemy import or_
from sqlalchemy import update as sa_update
from sqlmodel import Session, delete, select

from ..models_phase1 import FiscalCycleConfig, SapSyncLock
from ..models_phase2 import SapActualTransaction, SapCommitment, SapSyncStatus
from ..models_sap_raw import SapFbl3nRaw, SapKssbV2Raw
from .sap_raw_sync_service import sync_all_sap_raw

# NSSM redirects this service's stdout/stderr to backend-py/logs/*.log (see
# deploy/Deploy-IIS.ps1's Install-NssmService) - logging here (not print)
# picks up the app-wide format/level set once in main.py, so "did the last
# sync succeed or fail" is answerable by tailing that file instead of
# needing to query the DB or reproduce the failure interactively.
logger = logging.getLogger(__name__)


def sync_actuals_from_fbl3n(session: Session, fiscal_year: int) -> int:
    """Real per-posting G/L actuals, replacing SapActualTransaction rows for
    `fiscal_year` - reads the local cache (SapFbl3nRaw, kept fresh by
    sap_raw_sync_service.py) instead of calling the broker directly, since
    Forecast GAE/DOE's own mapping needs the exact same report. `budget_code`
    is always None here - FBL3N carries no such field, so every synced row
    correctly lands in Reconciliation's "Unmapped SAP Actuals" queue until
    manually mapped (the realistic behavior a live GL feed should have, not
    a gap to paper over).

    `fiscal_year` here is the *current* calendar year Utilization is scoped
    to (the frontend passes forecastYear, not targetCalendarYear - Budget
    Utilization Tracking tracks actual spend against the already-finalized
    budget for the year in force, not the next year's ask still being
    prepared), which is also the only year real SAP postings can exist for.
    """
    raw_rows = session.exec(select(SapFbl3nRaw).where(SapFbl3nRaw.fiscal_year == fiscal_year)).all()

    session.exec(delete(SapActualTransaction).where(SapActualTransaction.fiscal_year == fiscal_year))

    count = 0
    for raw in raw_rows:
        session.add(
            SapActualTransaction(
                gl_account=raw.gl_account,
                cost_center=raw.cost_center,
                fiscal_year=fiscal_year,
                month=raw.month,
                item_text=raw.item_text,
                amount=raw.amount,
                source_type="SAP_ACTUAL",
                budget_code=None,
                expense_line_item_id=None,
                posted_at=datetime(fiscal_year, raw.month, 1),
            )
        )
        count += 1
    return count


def sync_commitments_from_kssb_v2(session: Session, fiscal_year: int) -> int:
    """budget_kssb_v2's Commitment field (FBL3N carries none), summed per
    (KOSTL, CostElements) across periods 1-12, replacing SapCommitment rows
    for `fiscal_year` - reads the local cache (SapKssbV2Raw) instead of
    calling the broker directly. KSSB V2 doesn't distinguish open/closed, so
    everything it reports is by definition still-open committed spend as of
    now (status="OPEN"); it also carries no PO number field, so one is
    synthesized as a stable placeholder.

    Same "current year, not target year" framing as sync_actuals_from_fbl3n
    above - `fiscal_year` is the frontend's forecastYear.
    """
    raw_rows = session.exec(select(SapKssbV2Raw).where(SapKssbV2Raw.fiscal_year == fiscal_year)).all()

    totals: dict[tuple[str, str], float] = {}
    for raw in raw_rows:
        key = (raw.gl_account, raw.cost_center)
        totals[key] = totals.get(key, 0.0) + raw.commitment

    session.exec(delete(SapCommitment).where(SapCommitment.fiscal_year == fiscal_year))

    count = 0
    for (gl_account, cost_center), amount in totals.items():
        if amount == 0:
            continue
        session.add(
            SapCommitment(
                gl_account=gl_account,
                cost_center=cost_center,
                fiscal_year=fiscal_year,
                po_number=f"KSSB-{gl_account}-{cost_center}",
                item_text=f"KSSB V2 open commitment ({gl_account}/{cost_center})",
                amount=amount,
                status="OPEN",
                expense_line_item_id=None,
            )
        )
        count += 1
    return count


def sync_sap(session: Session, fiscal_year: int) -> dict[str, int]:
    actual_count = sync_actuals_from_fbl3n(session, fiscal_year)
    commitment_count = sync_commitments_from_kssb_v2(session, fiscal_year)
    session.commit()
    return {"actualsSynced": actual_count, "commitmentsSynced": commitment_count}


# ---------------------------------------------------------------------------
# Background-job wrapper. A full sync easily takes several minutes (hundreds
# of paginated broker requests, deliberately paced under its 120/min rate
# limit - see sap_broker.py) - far too long to run inline on the HTTP request
# a "Sync from SAP" click makes, since it would sit past IIS/ARR's own
# reverse-proxy timeout long before finishing. So the route only ever starts
# this in a background thread and returns immediately; the frontend polls
# GET /utilization/sync-sap/status for the result instead.
#
# Status is persisted to SapSyncStatus (one row per fiscal year), not just
# held in memory - a manual "Sync from SAP" click used to be the only way
# data ever refreshed, and a mid-sync failure (e.g. the broker read timeout
# the user hit) left no record of what happened once the polling browser
# tab moved on. Now every attempt's outcome survives a service restart and
# is visible to every user, and start_scheduled_sync (below) runs the same
# sync automatically every 10 minutes so a manual click is a supplementary
# "refresh now," not the only way this data ever updates.
# ---------------------------------------------------------------------------

# Guards against two syncs racing to INSERT the same fiscal year's first-ever
# SapSyncStatus row, and against the automatic loop and a manual click both
# passing the "not already running" check at the same instant - the actual
# "is it running" state lives in the DB row itself (checked/set under this
# lock), not in this lock.
_start_lock = threading.Lock()


def get_sync_status(fiscal_year: int) -> SapSyncStatus | None:
    from ..db import engine

    with Session(engine) as session:
        return session.get(SapSyncStatus, fiscal_year)


# A row stuck at status "running" forever (its process crashed or was
# restarted mid-sync, e.g. during local dev) would otherwise permanently
# block every future attempt for that fiscal year, in both
# start_sync_in_background and run_scheduled_sync below - confirmed live,
# a killed-mid-sync dev restart left fiscal year 2026 stuck exactly this
# way. Treat a "running" row older than this as abandoned, same reasoning
# and threshold as SapSyncLock's own LOCK_STALE.
RUNNING_STALE = timedelta(minutes=20)


def _is_genuinely_running(row: SapSyncStatus | None) -> bool:
    if row is None or row.status != "running":
        return False
    if row.started_at is None:
        return False
    return datetime.utcnow() - row.started_at < RUNNING_STALE


def _mark_running(session: Session, fiscal_year: int) -> None:
    row = session.get(SapSyncStatus, fiscal_year)
    if row is None:
        row = SapSyncStatus(fiscal_year=fiscal_year)
    row.status = "running"
    row.started_at = datetime.utcnow()
    row.finished_at = None
    row.error = None
    session.add(row)
    session.commit()


def _run_sync_and_record(fiscal_year: int) -> None:
    """Does the actual sync_sap() call + success/error status write - the
    caller is responsible for having already marked the row "running"
    (_mark_running) and for whatever concurrency guard applies to how it's
    being invoked (start_sync_in_background's _start_lock, or
    run_scheduled_sync's SapSyncLock).
    """
    from ..db import engine

    logger.info("SAP sync starting for fiscal year %s.", fiscal_year)
    try:
        with Session(engine) as session:
            raw_result = sync_all_sap_raw(session, fiscal_year)
            logger.info(
                "SAP raw cache refreshed for fiscal year %s: %d FBL3N, %d KSSB V1, %d KSSB V2, %d SALR row(s).",
                fiscal_year,
                raw_result["fbl3nSynced"],
                raw_result["kssbV1Synced"],
                raw_result["kssbV2Synced"],
                raw_result["salrSynced"],
            )
            result = sync_sap(session, fiscal_year)
            now = datetime.utcnow()
            row = session.get(SapSyncStatus, fiscal_year)
            row.status = "success"
            row.finished_at = now
            row.last_success_at = now
            row.actuals_synced = result["actualsSynced"]
            row.commitments_synced = result["commitmentsSynced"]
            row.error = None
            session.add(row)
            session.commit()
        logger.info(
            "SAP sync succeeded for fiscal year %s: %d actual(s), %d commitment(s).",
            fiscal_year,
            result["actualsSynced"],
            result["commitmentsSynced"],
        )
    except Exception as exc:  # noqa: BLE001 - deliberately broad: surface any failure to the polling frontend rather than losing it in a background thread
        logger.exception("SAP sync failed for fiscal year %s.", fiscal_year)
        with Session(engine) as err_session:
            row = err_session.get(SapSyncStatus, fiscal_year)
            if row is not None:
                row.status = "error"
                row.finished_at = datetime.utcnow()
                row.error = str(exc)
                err_session.add(row)
                err_session.commit()


def start_sync_in_background(fiscal_year: int) -> bool:
    """For a manual "Sync Now" click - returns False (and starts nothing) if
    a sync for this fiscal year is already running. Runs right away, same
    as before this file gained a scheduler - a deliberate, occasional user
    action doesn't queue behind SapSyncLock the way a scheduled tick does
    (see run_scheduled_sync below); that lock is about keeping the
    *automatic* schedule from hammering the broker with everything at once.
    """
    from ..db import engine

    with _start_lock:
        with Session(engine) as session:
            row = session.get(SapSyncStatus, fiscal_year)
            if _is_genuinely_running(row):
                logger.info("SAP sync for fiscal year %s skipped - already running (started %s).", fiscal_year, row.started_at)
                return False
            _mark_running(session, fiscal_year)

    threading.Thread(target=_run_sync_and_record, args=(fiscal_year,), daemon=True).start()
    return True


# 10 minutes - matches the "refresh every 10min" target. Deliberately not
# configurable via an env var/admin setting yet - no product requirement for
# that, and a hardcoded constant is easy to find and change here later.
SCHEDULED_SYNC_INTERVAL_SECONDS = 600

# ---------------------------------------------------------------------------
# SapSyncLock - a single global mutex (one row, id "global", see
# models_phase1.py's SapSyncLock for the full explanation) shared with the
# Node backend, so the SAP broker only ever sees ONE of the three scheduled
# sync jobs (Node's "historicalActuals"/"manpower", this combined "sap" job)
# running at a time instead of all of them hammering it simultaneously.
# ---------------------------------------------------------------------------

_SAP_LOCK_MODULE = "sap"
# A held-but-never-released lock (its owner crashed mid-sync) would
# otherwise block every future sync forever - treat one older than this as
# abandoned and let anyone reclaim it. Comfortably longer than any real
# sync's own duration (each is minutes, not this).
LOCK_STALE = timedelta(minutes=20)
LOCK_POLL_SECONDS = 15


def _try_acquire_global_lock(module_name: str) -> bool:
    from ..db import engine

    stale_cutoff = datetime.utcnow() - LOCK_STALE
    with Session(engine) as session:
        result = session.exec(
            sa_update(SapSyncLock)
            .where(SapSyncLock.id == "global")
            .where(or_(SapSyncLock.heldBy == None, SapSyncLock.heldAt < stale_cutoff))  # noqa: E711 - SQLAlchemy IS NULL idiom
            .values(heldBy=module_name, heldAt=datetime.utcnow())
        )
        session.commit()
        return result.rowcount > 0


def _release_global_lock(module_name: str) -> None:
    from ..db import engine

    with Session(engine) as session:
        session.exec(sa_update(SapSyncLock).where(SapSyncLock.id == "global").where(SapSyncLock.heldBy == module_name).values(heldBy=None, heldAt=None))
        session.commit()


def _current_forecast_year() -> int:
    """forecastYear (targetCalendarYear - 1) - Utilization Tracking's own
    "current year", same rule the frontend/Node backend already apply (see
    fiscalCycle.ts). Falls back to the same default Node uses when the
    FiscalCycleConfig row hasn't been created yet.
    """
    from ..db import engine

    with Session(engine) as session:
        config = session.get(FiscalCycleConfig, "singleton")
        target_year = config.targetCalendarYear if config else 2027
    return target_year - 1


def run_scheduled_sync(max_wait_seconds: int = 300) -> None:
    """For the automatic scheduler only (start_scheduled_sync below) - waits
    up to `max_wait_seconds` for the shared SapSyncLock (polling every
    LOCK_POLL_SECONDS; Node's own two scheduled jobs wait on the same lock),
    runs the sync for the current forecast year to completion once acquired,
    then releases it. Gives up (skips this tick, no error) if it never gets
    a turn in time - the next scheduled tick tries again, rather than this
    blocking indefinitely. Blocks the calling thread throughout (fine here -
    start_scheduled_sync already runs this on its own dedicated thread, not
    the request-handling one).
    """
    from ..db import engine

    fiscal_year = _current_forecast_year()
    deadline = time.monotonic() + max_wait_seconds
    while True:
        if _try_acquire_global_lock(_SAP_LOCK_MODULE):
            try:
                with Session(engine) as session:
                    row = session.get(SapSyncStatus, fiscal_year)
                    if _is_genuinely_running(row):
                        logger.info("Scheduled SAP sync skipped - fiscal year %s already running (e.g. a manual click).", fiscal_year)
                        return
                    _mark_running(session, fiscal_year)
                _run_sync_and_record(fiscal_year)
            finally:
                _release_global_lock(_SAP_LOCK_MODULE)
            return
        if time.monotonic() >= deadline:
            logger.info("Scheduled SAP sync skipped - couldn't get the shared SAP sync lock within %ds (something else was running the whole time).", max_wait_seconds)
            return
        logger.info("Scheduled SAP sync waiting for the shared SAP sync lock...")
        time.sleep(LOCK_POLL_SECONDS)


def start_scheduled_sync() -> None:
    """Runs the SAP sync automatically every 10 minutes (an immediate first
    run, then every SCHEDULED_SYNC_INTERVAL_SECONDS after) so Overview/
    Reconciliation/Reports stay fresh without anyone needing to click "Sync
    from SAP" - that button still works too, for an on-demand refresh.
    """

    logger.info("SAP sync scheduler starting - every %d seconds.", SCHEDULED_SYNC_INTERVAL_SECONDS)

    def _loop() -> None:
        while True:
            try:
                run_scheduled_sync()
            except Exception:  # noqa: BLE001 - a bad tick shouldn't kill the whole scheduler; the next one tries again
                logger.exception("Scheduled SAP sync tick failed unexpectedly.")
            time.sleep(SCHEDULED_SYNC_INTERVAL_SECONDS)

    threading.Thread(target=_loop, daemon=True).start()
