"""Read-only access to the local SAP raw cache (see models_sap_raw.py /
sap_raw_sync_service.py) for the Node backend to consume, so its own
historicalActualsService.ts (FBL3N) and manpowerService.ts (KSSB V1) stop
each calling the SAP broker directly for reports this process already pulls
and stores. Unauthenticated, same as transfers.py's /cc-gl-options - Node's
own background scheduler has no user JWT to forward, and this data is no
more sensitive than that endpoint's admin-maintained master lists.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import func
from sqlmodel import Session, select

from ..db import get_session
from ..models_sap_raw import SapFbl3nRaw, SapKssbV1Raw, SapSalrRaw

router = APIRouter(prefix="/sap-cache", tags=["sap-cache"])


class GlCcAmountOut(BaseModel):
    glAccount: str
    costCenter: str
    amount: float


# Both FBL3N and KSSB V1 are pre-aggregated here (SUM ... GROUP BY, in SQL,
# not row-by-row in Python) rather than served as raw per-posting rows -
# confirmed live that returning FBL3N's ~190k raw rows for a fiscal year as
# JSON took long enough to blow past pyBackendClient.ts's 10s axios timeout,
# and every consumer (historicalActualsService.ts, manpowerService.ts) only
# ever wanted a YTD sum per (glAccount, costCenter) through their own
# as-of-month cutoff anyway - `throughMonth` does that filtering in the same
# query, so at most a few hundred/thousand grouped rows cross the wire
# instead of hundreds of thousands.
def _summed_by_gl_cc(session: Session, model, fiscal_year: int, through_month: int | None) -> list[GlCcAmountOut]:
    query = select(model.gl_account, model.cost_center, func.sum(model.amount)).where(model.fiscal_year == fiscal_year)
    if through_month is not None:
        query = query.where(model.month <= through_month)
    query = query.group_by(model.gl_account, model.cost_center)
    rows = session.exec(query).all()
    return [GlCcAmountOut(glAccount=r[0], costCenter=r[1], amount=float(r[2])) for r in rows]


@router.get("/fbl3n", response_model=list[GlCcAmountOut])
def fbl3n_cache(fiscalYear: int, throughMonth: int | None = None, session: Session = Depends(get_session)):
    return _summed_by_gl_cc(session, SapFbl3nRaw, fiscalYear, throughMonth)


@router.get("/kssb-v1", response_model=list[GlCcAmountOut])
def kssb_v1_cache(fiscalYear: int, throughMonth: int | None = None, session: Session = Depends(get_session)):
    """`fiscalYear` here is the same "actual postings year" (target - 1) that
    manpowerService.ts's own runManpowerRecompute already passes when it
    calls fetchKssbV1Cache - this endpoint doesn't re-derive that offset, it
    just serves whatever fiscal_year the cache was populated for
    (sap_raw_sync_service.py's sync_kssb_v1_raw already stores it under
    fiscal_year - 1 for that same reason).
    """
    return _summed_by_gl_cc(session, SapKssbV1Raw, fiscalYear, throughMonth)


class SalrCacheRowOut(BaseModel):
    aufnr: str
    budget: float
    actual: float
    committed: float
    allotted: float
    available: float


@router.get("/salr", response_model=list[SalrCacheRowOut])
def salr_cache(fiscalYear: int, session: Session = Depends(get_session)):
    rows = session.exec(select(SapSalrRaw).where(SapSalrRaw.fiscal_year == fiscalYear)).all()
    return [SalrCacheRowOut(aufnr=r.aufnr, budget=r.budget, actual=r.actual, committed=r.committed, allotted=r.allotted, available=r.available) for r in rows]
