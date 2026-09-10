"""Shared SAP data broker client - Python mirror of backend/src/lib/sapBroker.ts.

Ortigas's own SAP data broker (not the Node backend - a genuine third-party
API), reached the same way Node reaches it: `X-API-Key` header (one key per
report), `?Column__in=...`/`?Column=...` query filtering, `limit`/`offset`
pagination to exhaustion. A plain sync httpx.Client, not async - every router
in this backend uses sync `def` handlers, so an async client would only add
bridging overhead for no benefit here.
"""

from __future__ import annotations

import httpx

from ..settings import settings

MAX_ROWS_PER_PAGE = 100
# Mirrors sapBroker.ts's KOSTL_CHUNK_SIZE - keeps each request's `*__in`
# filter a reasonable length; the broker's own docs don't state a length cap.
CHUNK_SIZE = 40


def _client(api_key: str) -> httpx.Client:
    return httpx.Client(base_url=settings.sap_broker_base_url, headers={"X-API-Key": api_key}, timeout=15.0)


def _paginate(client: httpx.Client, path: str, params: dict) -> list[dict]:
    rows: list[dict] = []
    offset = 0
    while True:
        resp = client.get(path, params={**params, "limit": MAX_ROWS_PER_PAGE, "offset": offset})
        resp.raise_for_status()
        page = resp.json()["rows"]
        rows.extend(page)
        if len(page) < MAX_ROWS_PER_PAGE:
            break
        offset += MAX_ROWS_PER_PAGE
    return rows


def fetch_fbl3n_rows(profit_centers: list[str], year: int) -> list[dict]:
    """budget_fbl3n - one row per real G/L posting (BUKRS, GJAHR,
    DocumentNumber, AmountInLocalCurrency, ItemText, GLAccount, ProfitCenter,
    YearMonth "YYYY/MM" string). `profit_centers` must already be padded to
    SAP's "00"+8-digit shape by the caller (ProfitCenter plays the cost
    center role here, same shape as KSSB's KOSTL). `YearMonth__startswith`
    scopes to the calendar year - verified live that `__gte`/`__lte` range
    filters return 0 rows on this field, while `__startswith` works.
    """
    if not profit_centers:
        return []
    with _client(settings.fbl3n_api_key) as client:
        rows: list[dict] = []
        for i in range(0, len(profit_centers), CHUNK_SIZE):
            chunk = profit_centers[i : i + CHUNK_SIZE]
            rows.extend(
                _paginate(
                    client,
                    "/sap/budget_fbl3n/rows/",
                    {"ProfitCenter__in": ",".join(chunk), "YearMonth__startswith": str(year)},
                )
            )
        return rows


def fetch_kssb_v2_rows(cost_centers: list[str], gjahr: int) -> list[dict]:
    """budget_kssb_v2 - per (KOSTL, CostElements, PostingPeriod) row carrying
    Plan/Actual/Commitment/Allotted/Available. Only its Commitment field is
    used anywhere now (see sap_sync_service.py) - Node's own KSSB V2 pull was
    removed once Forecast GAE/DOE moved to FBL3N + FinalizedBudgetLine.
    Periods 1-12 only (13-16 are SAP's own year-end/adjustment periods).
    """
    if not cost_centers:
        return []
    with _client(settings.kssb_v2_api_key) as client:
        rows: list[dict] = []
        for i in range(0, len(cost_centers), CHUNK_SIZE):
            chunk = cost_centers[i : i + CHUNK_SIZE]
            rows.extend(
                _paginate(
                    client,
                    "/sap/budget_kssb_v2/rows/",
                    {"KOSTL__in": ",".join(chunk), "GJAHR": gjahr, "PostingPeriod__lte": 12},
                )
            )
        return rows


def fetch_salr_rows(fiscal_year: int) -> list[dict]:
    """S_ALR_87013019 - one row per Internal Order (AUFNR), already fully
    computed by SAP: Budget/Actual/Commitment/Allotted/Available/
    AssignedPerSAP. No CC/GL filter exists on this report and it's a small
    table (174 rows for FY2026 at last check), so no chunking is needed - just
    GJAHR.
    """
    with _client(settings.salr_api_key) as client:
        return _paginate(client, "/sap/budget_salr/rows/", {"GJAHR": fiscal_year})
