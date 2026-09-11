"""SAP Requirements integration - real-data sync for the SapActualTransaction/
SapCommitment tables (see models_phase2.py), which today are only ever
populated by the manual `python -m app.seed_mock_sap` CLI script. These two
tables are read live by Utilization's Overview + Reconciliation, Transfer's
`/cc-gl-balance` display and submit-time balance check, Dash Flow's budget
check, and Reports' Budget vs Actual - so this one sync feeds all of those at
once (see routers/utilization.py's new POST /utilization/sync-sap).

Same delete-and-regenerate convention app/seed_mock_sap.py already uses (not
a new upsert scheme) - both functions clear the target fiscal year's existing
rows first, then insert fresh ones from the broker.
"""

from __future__ import annotations

from datetime import datetime

from sqlmodel import Session, delete, select

from ..models_phase2 import SapActualTransaction, SapCommitment
from ..models_phase3 import CostCenter
from .sap_broker import fetch_fbl3n_rows, fetch_kssb_v2_rows


def _padded_cost_centers(session: Session) -> list[str]:
    """Every admin-maintained Cost Center (Phase 3's own master list, already
    used by Transfer's own CC/GL pickers), padded to SAP's "00"+8-digit shape.
    Only clean numeric codes can ever match a real SAP KOSTL/ProfitCenter.
    """
    codes = session.exec(select(CostCenter.code)).all()
    return [f"00{c}" for c in codes if c.isdigit()]


def _strip_pad(value: str) -> str:
    """Undo the "00"+8-digit padding SAP-side CC/GL codes carry, back to the
    bare 8-digit form this app's catalogs use elsewhere - mirrors the Node
    side's `.replace(/^00/, "")` convention exactly (strip only a literal
    leading "00", not every leading zero, since a code's own digits may
    legitimately start with one).
    """
    return value[2:] if value.startswith("00") else value


def sync_actuals_from_fbl3n(session: Session, fiscal_year: int) -> int:
    """Real per-posting G/L actuals from budget_fbl3n, replacing
    SapActualTransaction rows for `fiscal_year`. `budget_code` is always None
    here - FBL3N carries no such field, so every synced row correctly lands
    in Reconciliation's "Unmapped SAP Actuals" queue until manually mapped
    (the realistic behavior a live GL feed should have, not a gap to paper
    over).

    `fiscal_year` here is the *current* calendar year Utilization is scoped
    to (the frontend passes forecastYear, not targetCalendarYear - Budget
    Utilization Tracking tracks actual spend against the already-finalized
    budget for the year in force, not the next year's ask still being
    prepared), which is also the only year real SAP postings can exist for.
    """
    cost_centers = _padded_cost_centers(session)
    rows = fetch_fbl3n_rows(cost_centers, fiscal_year) if cost_centers else []

    session.exec(delete(SapActualTransaction).where(SapActualTransaction.fiscal_year == fiscal_year))

    count = 0
    for row in rows:
        cost_center = _strip_pad(row["ProfitCenter"])
        gl_account = _strip_pad(row["GLAccount"])
        year_str, month_str = row["YearMonth"].split("/")
        month = int(month_str)
        session.add(
            SapActualTransaction(
                gl_account=gl_account,
                cost_center=cost_center,
                fiscal_year=fiscal_year,
                month=month,
                item_text=row.get("ItemText") or "",
                amount=float(row["AmountInLocalCurrency"]),
                source_type="SAP_ACTUAL",
                budget_code=None,
                expense_line_item_id=None,
                posted_at=datetime(int(year_str), month, 1),
            )
        )
        count += 1
    return count


def sync_commitments_from_kssb_v2(session: Session, fiscal_year: int) -> int:
    """budget_kssb_v2's Commitment field (FBL3N carries none), summed per
    (KOSTL, CostElements) across periods 1-12, replacing SapCommitment rows
    for `fiscal_year`. KSSB V2 doesn't distinguish open/closed, so everything
    it reports is by definition still-open committed spend as of now
    (status="OPEN"); it also carries no PO number field, so one is
    synthesized as a stable placeholder.

    Same "current year, not target year" framing as sync_actuals_from_fbl3n
    above - `fiscal_year` is the frontend's forecastYear.
    """
    cost_centers = _padded_cost_centers(session)
    rows = fetch_kssb_v2_rows(cost_centers, fiscal_year) if cost_centers else []

    totals: dict[tuple[str, str], float] = {}
    for row in rows:
        cost_center = _strip_pad(row["KOSTL"])
        cost_elements = (row.get("CostElements") or "").strip()
        gl_account = _strip_pad(cost_elements.split()[0]) if cost_elements else None
        if not gl_account:
            continue
        commitment = float(row.get("Commitment") or 0)
        if commitment == 0:
            continue
        key = (gl_account, cost_center)
        totals[key] = totals.get(key, 0.0) + commitment

    session.exec(delete(SapCommitment).where(SapCommitment.fiscal_year == fiscal_year))

    count = 0
    for (gl_account, cost_center), amount in totals.items():
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
