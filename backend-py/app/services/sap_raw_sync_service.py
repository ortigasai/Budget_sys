"""Pulls each SAP broker report ONCE into its own local cache table (see
models_sap_raw.py for why) - the actual broker-calling work every module's
own mapping (sync_sap in sap_sync_service.py, historicalActualsService.ts,
manpowerService.ts, NPC Forecast, Internal Order Requests) used to each do
independently. This is the only piece of code left that calls the broker at
all; everything else reads these tables.

Same delete-and-regenerate convention every other sync in this app already
uses - each sub-sync clears its own table's rows for the target fiscal year
first, then inserts fresh ones.
"""

from __future__ import annotations

from sqlmodel import Session, delete, select

from ..models_phase3 import CostCenter
from .sap_broker import fetch_fbl3n_rows, fetch_kssb_v1_rows, fetch_kssb_v2_rows, fetch_salr_rows
from .sap_common import padded_cost_centers as _padded_cost_centers, strip_pad as _strip_pad

from ..models_sap_raw import SapFbl3nRaw, SapKssbV1Raw, SapKssbV2Raw, SapSalrRaw


def sync_fbl3n_raw(session: Session, fiscal_year: int) -> int:
    """Every admin Cost Center's FBL3N rows - the widest set any consumer
    needs (Utilization's own mapping already used this same set; Forecast
    GAE/DOE's own mapping used a narrower STANDARD-catalog subset, which is
    still fully covered here).
    """
    cost_centers = _padded_cost_centers(session)
    rows = fetch_fbl3n_rows(cost_centers, fiscal_year) if cost_centers else []

    session.exec(delete(SapFbl3nRaw).where(SapFbl3nRaw.fiscal_year == fiscal_year))
    count = 0
    for row in rows:
        year_str, month_str = row["YearMonth"].split("/")
        session.add(
            SapFbl3nRaw(
                gl_account=_strip_pad(row["GLAccount"]),
                cost_center=_strip_pad(row["ProfitCenter"]),
                fiscal_year=int(year_str),
                month=int(month_str),
                item_text=row.get("ItemText") or "",
                amount=float(row["AmountInLocalCurrency"]),
            )
        )
        count += 1
    return count


def sync_kssb_v2_raw(session: Session, fiscal_year: int) -> int:
    """Every admin Cost Center's KSSB V2 rows - Commitment (open commitments)
    and Plan (SAP's approved budget, summed per GL-CC for Utilization's
    Overview). Same Cost Center set Utilization's own mapping already used.
    """
    cost_centers = _padded_cost_centers(session)
    rows = fetch_kssb_v2_rows(cost_centers, fiscal_year) if cost_centers else []

    session.exec(delete(SapKssbV2Raw).where(SapKssbV2Raw.fiscal_year == fiscal_year))
    count = 0
    for row in rows:
        cost_elements = (row.get("CostElements") or "").strip()
        gl_account = _strip_pad(cost_elements.split()[0]) if cost_elements else None
        if not gl_account:
            continue
        posting_period = row.get("PostingPeriod")
        if posting_period is None:
            continue
        session.add(
            SapKssbV2Raw(
                gl_account=gl_account,
                cost_center=_strip_pad(row["KOSTL"]),
                fiscal_year=fiscal_year,
                month=int(posting_period),
                commitment=float(row.get("Commitment") or 0),
                plan=float(row.get("Plan") or 0),
            )
        )
        count += 1
    return count


def sync_kssb_v1_raw(session: Session, fiscal_year: int) -> int:
    """Manpower's own (PayComponent GL Account x Company Cost Center) pairs
    only - KSSB V1 has only ever had this one consumer, so there's no wider
    set to fetch. `fiscal_year - 1` for the same reason
    manpowerService.ts's own fetch always did: real postings can only exist
    for a year that's actually happened, not the future year being budgeted
    for - ManpowerEntry itself still stays keyed on the caller's fiscal_year.
    """
    # Both PayComponent and Company are Node/Prisma-owned (read-only shadow
    # models - see models_phase1.py), admin-editable via the Admin Console's
    # Manpower GL/CC mapping - mirrors manpowerService.ts's own two queries.
    from ..models_phase1 import Company, PayComponent

    pay_components = session.exec(select(PayComponent)).all()
    companies = session.exec(select(Company)).all()
    gl_accounts = sorted({f"00{p.glAccount}" for p in pay_components if p.glAccount})
    cost_centers = sorted({f"00{c.costCenter}" for c in companies if c.costCenter})
    rows = fetch_kssb_v1_rows(cost_centers, gl_accounts, fiscal_year - 1) if (cost_centers and gl_accounts) else []

    session.exec(delete(SapKssbV1Raw).where(SapKssbV1Raw.fiscal_year == fiscal_year - 1))
    count = 0
    for row in rows:
        posting_period = row.get("PostingPeriod")
        actual = row.get("Actual")
        if posting_period is None or actual is None:
            continue
        session.add(
            SapKssbV1Raw(
                gl_account=_strip_pad(row["KSTAR"]),
                cost_center=_strip_pad(row["ProfitCenter"]),
                fiscal_year=fiscal_year - 1,
                month=int(posting_period),
                amount=float(actual),
            )
        )
        count += 1
    return count


def sync_salr_raw(session: Session, fiscal_year: int) -> int:
    """Every Internal Order for `fiscal_year` - no Cost Center/GL filter
    exists on this report, so there's nothing to scope; it's a small table
    (~174 rows), fetched wholesale.
    """
    rows = fetch_salr_rows(fiscal_year)

    session.exec(delete(SapSalrRaw).where(SapSalrRaw.fiscal_year == fiscal_year))
    count = 0
    for row in rows:
        session.add(
            SapSalrRaw(
                aufnr=str(row["AUFNR"]).strip(),
                fiscal_year=fiscal_year,
                budget=float(row.get("Budget") or 0),
                actual=float(row.get("Actual") or 0),
                committed=float(row.get("Commitment") or 0),
                allotted=float(row.get("Allotted") or 0),
                available=float(row.get("Available") or 0),
            )
        )
        count += 1
    return count


def sync_all_sap_raw(session: Session, fiscal_year: int) -> dict[str, int]:
    fbl3n_count = sync_fbl3n_raw(session, fiscal_year)
    kssb_v2_count = sync_kssb_v2_raw(session, fiscal_year)
    kssb_v1_count = sync_kssb_v1_raw(session, fiscal_year)
    salr_count = sync_salr_raw(session, fiscal_year)
    session.commit()
    return {
        "fbl3nSynced": fbl3n_count,
        "kssbV1Synced": kssb_v1_count,
        "kssbV2Synced": kssb_v2_count,
        "salrSynced": salr_count,
    }
