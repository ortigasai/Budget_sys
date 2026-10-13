"""GAE report - Main Report and Detailed Report, built from the CC-GL mapping
workbook (gae_cc_gl_mapping) with monthly series for four measures:

- budget   : KSSB V2 plan (sap_kssb_v2_raw.plan)
- actual   : FBL3N actuals for the current year (sap_fbl3n_raw.amount)
- forecast : actual for months already closed, HistoricalActuals' remaining
             monthly forecast for later months
- ly       : prior-year actuals (sap_gae_past_actual_raw)

The frontend picks months/quarters/YTD and the two measures to compare from
these 12-month arrays, so one response serves every Primary Comparison.
"""

from __future__ import annotations

import re
from collections import defaultdict

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import text
from sqlmodel import Session, select

from ..auth import AuthedUser, get_current_user
from ..db import get_session
from ..models_phase1 import FiscalCycleConfig, HistoricalActuals
from ..models_phase4 import ReportAccessGrant
from ..models_sap_raw import GaeCcGlMapping, SapFbl3nRaw, SapGaePastActualRaw, SapKssbV2Raw

router = APIRouter(prefix="/reports", tags=["reports"])

MAIN_MANPOWER = [("Salaries", "salaries"), ("PB", "pb"), ("Retirement", "retirement"), ("Employee Benefits", "employee benefits")]
MAIN_NON_MANPOWER = [
    ("Professional fees", "professional fees"),
    ("Taxes & Licenses", "taxes & licenses"),
    ("Ad & Promo", "ad & promo"),
    ("Contracted services", "contracted services"),
    ("Systems & Applications", "systems & applications"),
    ("MTS", "mts"),
    ("Others", "others"),
]
DETAIL_SECTIONS = [
    ("Salaries", "salaries", [
        "Regular Employee", "Guaranteed Bonus", "Office Staff (BTs)", "Project Employee", "OT Pay", "OJT", "Leave Encashment",
    ]),
    ("Employee Benefits", "employee benefits", [
        "Medical/Insurance", "Government Contributions", "Uniform", "Gas Allowance", "Employee Programs/Perks", "FBT", "Recruitment", "Trainings & Seminars",
    ]),
    ("Professional Fees", "professional fees", [
        "Internal and external consultants", "Open cases", "BOD", "Legal retainier fees", "Internal consultants", "Systems cost",
    ]),
    ("Contracted Services", "contracted services", ["Security", "Admin Staff", "Janitorial", "Contracted-Others"]),
    ("Others", "others", [
        "Entertainment, Amusement & Recreation", "Christmas Baskets", "Electricity & Water", "Insurance", "Postal & Communication",
        "BOD Meeting", "Rent", "Repairs & Maintenance", "Repairs & Maintenance - Vehicle", "Supplies", "Transportation & Travel",
        "Valle Verde", "Dues and Fees", "Donations, Contributions and Miscellaneous Expenses", "Research and Development",
        "Disallowed Input VAT", "Others",
    ]),
]


def _norm(s: str) -> str:
    return re.sub(r"\s+", " ", (s or "").strip().lower())


class SeriesOut(BaseModel):
    budget: list[float]
    actual: list[float]
    forecast: list[float]
    ly: list[float]
    # Last year's budget/plan (SAP KSSB V2 for fiscalYear - 1) - distinct from
    # `ly`, which is last year's actual.
    lyBudget: list[float]


class ReportRowOut(BaseModel):
    key: str
    label: str
    level: int  # 0 = section or grand total, 1 = line
    isTotal: bool
    series: SeriesOut


class GaeReportOut(BaseModel):
    fiscalYear: int
    asOfMonth: int
    main: list[ReportRowOut]
    detailed: list[ReportRowOut]
    unmappedSubTypes: list[str]


def _can_view(user: AuthedUser, session: Session) -> bool:
    if user.has_role("BUDGET_OFFICER") or (user.access is not None and user.can("reports", False)):
        return True
    return session.exec(select(ReportAccessGrant).where(ReportAccessGrant.user_id == user.id)).first() is not None


def _zeros() -> list[float]:
    return [0.0] * 12


def _empty() -> dict[str, list[float]]:
    return {"budget": _zeros(), "actual": _zeros(), "forecast": _zeros(), "ly": _zeros(), "lyBudget": _zeros()}


def _add(dst: list[float], src: list[float]) -> None:
    for i in range(12):
        dst[i] += src[i]


def _sum_aggs(*aggs: dict[str, list[float]]) -> dict[str, list[float]]:
    out = _empty()
    for a in aggs:
        for k in out:
            _add(out[k], a[k])
    return out


def _series(agg: dict[str, list[float]]) -> SeriesOut:
    return SeriesOut(budget=agg["budget"], actual=agg["actual"], forecast=agg["forecast"], ly=agg["ly"], lyBudget=agg["lyBudget"])


def _finalized_budget(session: Session, fiscal_year: int) -> dict[tuple[str, str], list[float]]:
    """Approved budget per (cost center, GL) from the Finalize & Upload snapshot.

    Each finalized line's monthly amounts come from its GAE request (the months
    the requestor entered). The finalized amount is proposed minus the budget cut,
    so the monthly amounts are scaled by finalized / proposed to apply the cut.
    """
    rows = session.execute(
        text(
            """
            select f."costCenter", f."glAccount", f.amount, r."proposedAmount", r."monthlyAmounts"
            from "FinalizedBudgetLine" f
            join "BudgetRequest" r on r.id = f."budgetRequestId"
            where f."fiscalYear" = :fy
            """
        ),
        {"fy": fiscal_year},
    ).all()
    out: dict[tuple[str, str], list[float]] = defaultdict(_zeros)
    for cost_center, gl_account, amount, proposed, monthly in rows:
        months = monthly if isinstance(monthly, list) else []
        factor = (amount / proposed) if proposed else 0.0
        for i in range(12):
            value = float(months[i]) if i < len(months) and months[i] is not None else 0.0
            out[(str(cost_center), str(gl_account))][i] += value * factor
    return out


def _current_forecast_year(session: Session) -> int:
    """forecastYear (targetCalendarYear - 1) - the real current calendar
    year, same rule the frontend applies (see fiscalCycle.ts). Falls back to
    the same default Node uses when the FiscalCycleConfig row hasn't been
    created yet.
    """
    config = session.get(FiscalCycleConfig, "singleton")
    target_year = config.targetCalendarYear if config else 2027
    return target_year - 1


def _load(session: Session, fiscal_year: int):
    pairs = {(m.cost_center, m.gl_account): m for m in session.exec(select(GaeCcGlMapping)).all()}
    budget: dict[tuple[str, str], list[float]] = defaultdict(_zeros)
    for r in session.exec(select(SapKssbV2Raw).where(SapKssbV2Raw.fiscal_year == fiscal_year)).all():
        key = (r.cost_center, r.gl_account)
        if key in pairs and 1 <= r.month <= 12:
            budget[key][r.month - 1] += r.plan
    # The approved (finalized) budget per CC-GL replaces SAP's plan for that CC-GL;
    # CC-GLs with no finalized budget keep the SAP plan.
    for key, series in _finalized_budget(session, fiscal_year).items():
        budget[key] = series
    actual: dict[tuple[str, str], list[float]] = defaultdict(_zeros)
    for r in session.exec(select(SapFbl3nRaw).where(SapFbl3nRaw.fiscal_year == fiscal_year)).all():
        key = (r.cost_center, r.gl_account)
        if key in pairs and 1 <= r.month <= 12:
            actual[key][r.month - 1] += r.amount
    remaining: dict[tuple[str, str], list[float]] = defaultdict(_zeros)
    # Forecast rows are stored under the Target Calendar Year (forecast year + 1).
    for h in session.exec(select(HistoricalActuals).where(HistoricalActuals.fiscalYear == fiscal_year + 1)).all():
        key = (h.costCenter, h.glAccount)
        if key not in pairs:
            continue
        for m, v in (h.monthlyRemainingForecast2026 or {}).items():
            try:
                mi = int(m)
            except (TypeError, ValueError):
                continue
            if 1 <= mi <= 12:
                remaining[key][mi - 1] += float(v or 0)
    ly: dict[tuple[str, str], list[float]] = defaultdict(_zeros)
    ly_year = fiscal_year - 1
    # sap_gae_past_actual_raw is a one-time import that only covers years
    # before the real current year (see its own docstring) - when the
    # requested fiscalYear is a budget-prep year ahead of the real current
    # year (e.g. 2027, with the real current year at 2026), "last year" IS
    # the real current year, whose actuals live in the continuously-synced
    # sap_fbl3n_raw instead.
    if ly_year == _current_forecast_year(session):
        for r in session.exec(select(SapFbl3nRaw).where(SapFbl3nRaw.fiscal_year == ly_year)).all():
            key = (r.cost_center, r.gl_account)
            if key in pairs and 1 <= r.month <= 12:
                ly[key][r.month - 1] += r.amount
    else:
        for r in session.exec(select(SapGaePastActualRaw).where(SapGaePastActualRaw.fiscal_year == ly_year)).all():
            key = (r.cost_center, r.gl_account)
            if key in pairs and 1 <= r.month <= 12:
                ly[key][r.month - 1] += r.amount
    # Last year's budget/plan - same source (sap_kssb_v2_raw) as the current
    # year's `budget` above, just for fiscal_year - 1. No "finalized budget"
    # override here (that override only applies to the year currently being
    # finalized, not a prior, already-closed year).
    ly_budget: dict[tuple[str, str], list[float]] = defaultdict(_zeros)
    for r in session.exec(select(SapKssbV2Raw).where(SapKssbV2Raw.fiscal_year == ly_year)).all():
        key = (r.cost_center, r.gl_account)
        if key in pairs and 1 <= r.month <= 12:
            ly_budget[key][r.month - 1] += r.plan
    return pairs, budget, actual, remaining, ly, ly_budget


@router.get("/gae-report", response_model=GaeReportOut)
def gae_report(
    fiscalYear: int = 2026,
    user: AuthedUser = Depends(get_current_user),
    session: Session = Depends(get_session),
):
    if not _can_view(user, session):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "You don't have access to reports.")

    pairs, budget, actual, remaining, ly, ly_budget = _load(session, fiscalYear)
    as_of = max((i + 1 for key in actual for i, v in enumerate(actual[key]) if v), default=0)

    def forecast_for(key: tuple[str, str]) -> list[float]:
        return [actual[key][i] if (i + 1) <= as_of else remaining[key][i] for i in range(12)]

    # Each mapped (CC, GL) pair feeds its Main Report type and Detailed sub type.
    by_type: dict[str, dict[str, list[float]]] = defaultdict(_empty)
    by_sub: dict[tuple[str, str], dict[str, list[float]]] = defaultdict(_empty)
    for key, m in pairs.items():
        t = _norm(m.type)
        sub = _norm(m.sub_type)
        series = {"budget": budget[key], "actual": actual[key], "forecast": forecast_for(key), "ly": ly[key], "lyBudget": ly_budget[key]}
        for name, values in series.items():
            _add(by_type[t][name], values)
            _add(by_sub[(t, sub)][name], values)

    main: list[ReportRowOut] = []
    manpower_aggs = []
    for label, norm in MAIN_MANPOWER:
        agg = by_type.get(norm, _empty())
        manpower_aggs.append(agg)
        main.append(ReportRowOut(key=norm, label=label, level=1, isTotal=False, series=_series(agg)))
    total_manpower = _sum_aggs(*manpower_aggs)
    main.append(ReportRowOut(key="total-manpower", label="Total Manpower", level=0, isTotal=True, series=_series(total_manpower)))

    non_manpower_aggs = []
    for label, norm in MAIN_NON_MANPOWER:
        agg = by_type.get(norm, _empty())
        non_manpower_aggs.append(agg)
        main.append(ReportRowOut(key=norm, label=label, level=1, isTotal=False, series=_series(agg)))
    total_non_manpower = _sum_aggs(*non_manpower_aggs)
    main.append(ReportRowOut(key="total-non-manpower", label="Total Non-Manpower", level=0, isTotal=True, series=_series(total_non_manpower)))

    grand = _sum_aggs(total_manpower, total_non_manpower)
    main.append(ReportRowOut(key="total", label="TOTAL", level=0, isTotal=True, series=_series(grand)))
    pb = by_type.get("pb", _empty())
    without_pb = {k: [grand[k][i] - pb[k][i] for i in range(12)] for k in grand}
    main.append(ReportRowOut(key="total-without-pb", label="TOTAL w/o PB", level=0, isTotal=True, series=_series(without_pb)))

    # Detailed Report: each section lists its sub types, then a section total.
    detailed: list[ReportRowOut] = []
    unmapped: set[str] = set()
    for section_label, type_norm, subs in DETAIL_SECTIONS:
        known = {_norm(s) for s in subs}
        section_aggs = []
        for sub_label in subs:
            agg = by_sub.get((type_norm, _norm(sub_label)), _empty())
            section_aggs.append(agg)
            detailed.append(ReportRowOut(key=f"{type_norm}:{_norm(sub_label)}", label=sub_label, level=1, isTotal=False, series=_series(agg)))
        # Mapped sub types the list doesn't name roll into this section's own
        # catch-all lines, so nothing mapped is dropped from the totals.
        for (t, s), agg in sorted(by_sub.items()):
            if t == type_norm and s not in known:
                unmapped.add(s)
                section_aggs.append(agg)
                detailed.append(ReportRowOut(key=f"{t}:{s}", label=s or "(no sub type)", level=1, isTotal=False, series=_series(agg)))
        detailed.append(ReportRowOut(key=f"total-{type_norm}", label=f"Total {section_label}", level=0, isTotal=True, series=_series(_sum_aggs(*section_aggs))))

    return GaeReportOut(fiscalYear=fiscalYear, asOfMonth=as_of, main=main, detailed=detailed, unmappedSubTypes=sorted(unmapped))
