"""Shared SAP data broker client - Python mirror of backend/src/lib/sapBroker.ts.

Ortigas's own SAP data broker (not the Node backend - a genuine third-party
API), reached the same way Node reaches it: `X-API-Key` header (one key per
report), `?Column__in=...`/`?Column=...` query filtering, `limit`/`offset`
pagination to exhaustion.

Fetches within one call (e.g. every page of every cost-center chunk for a
single fetch_fbl3n_rows() call) run concurrently against a shared rate
limiter, not one page at a time - a naive "sleep, then request, then await
the response" loop wastes the response's own round-trip time as dead time
between requests, which measured out to roughly half the broker's real
throughput in practice (confirmed live: a full Utilization sync took 8+
minutes even with correct per-request pacing). Learning each chunk's total
row count up front (via the broker's own `count=true`) and then dispatching
every remaining page through one bounded thread pool, still governed by the
same shared rate limiter, closes that gap without ever exceeding the
broker's limit - httpx.Client itself is documented thread-safe for exactly
this kind of concurrent use from one instance.
"""

from __future__ import annotations

import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed

import httpx

from ..settings import settings

MAX_ROWS_PER_PAGE = 100
# Mirrors sapBroker.ts's KOSTL_CHUNK_SIZE - keeps each request's `*__in`
# filter a reasonable length; the broker's own docs don't state a length cap.
CHUNK_SIZE = 40
# The broker's own rate limit (confirmed via /whoami/: rate_limit_per_minute
# 120). A small safety margin under it, since our clock and the broker's
# aren't perfectly synchronized and a burst right at the boundary could
# still trip a 429.
EFFECTIVE_RATE_PER_MINUTE = 110
# How many requests can be in flight at once - purely about overlapping
# network round-trip time; the shared _RateLimiter below is what actually
# caps the dispatch rate no matter how many workers there are.
MAX_CONCURRENT_REQUESTS = 8
MAX_RETRIES = 8
DEFAULT_RETRY_AFTER_SECONDS = 3.0


class _RateLimiter:
    """Thread-safe token-bucket pacing: `acquire()` blocks the calling thread
    until its turn, spaced `60/rate_per_minute` seconds apart from the
    previous caller - shared across every worker thread so the *aggregate*
    dispatch rate stays under the broker's limit, regardless of how many
    requests are in flight concurrently.
    """

    def __init__(self, rate_per_minute: float) -> None:
        self._interval = 60.0 / rate_per_minute
        self._lock = threading.Lock()
        self._next_available = time.monotonic()

    def acquire(self) -> None:
        with self._lock:
            now = time.monotonic()
            wait = max(0.0, self._next_available - now)
            self._next_available = max(now, self._next_available) + self._interval
        if wait > 0:
            time.sleep(wait)


_rate_limiter = _RateLimiter(EFFECTIVE_RATE_PER_MINUTE)


def _client(api_key: str) -> httpx.Client:
    return httpx.Client(base_url=settings.sap_broker_base_url, headers={"X-API-Key": api_key}, timeout=15.0)


def _get(client: httpx.Client, path: str, params: dict) -> httpx.Response:
    """One rate-limited GET with retry/backoff on 429 (rate limited - honors
    a Retry-After header when the broker sends one) and 5xx (a transient
    server-side hiccup on the broker's own end - confirmed live: a 502
    mid-sync that succeeded on retry).
    """
    for attempt in range(MAX_RETRIES):
        _rate_limiter.acquire()
        resp = client.get(path, params=params)
        if resp.status_code < 500 and resp.status_code != 429:
            resp.raise_for_status()
            return resp
        retry_after = resp.headers.get("Retry-After")
        wait_seconds = float(retry_after) if retry_after else DEFAULT_RETRY_AFTER_SECONDS * (attempt + 1)
        time.sleep(wait_seconds)
    # Retries exhausted - one final attempt, letting its error surface.
    _rate_limiter.acquire()
    resp = client.get(path, params=params)
    resp.raise_for_status()
    return resp


def _fetch_all(client: httpx.Client, path: str, chunk_params: list[dict]) -> list[dict]:
    """Every row across every chunk in `chunk_params` (one dict of filter
    params per cost-center chunk, or a single-element list for an unchunked
    report like SALR). First page of each chunk is fetched sequentially
    (with count=true, to learn that chunk's total row count) - genuinely
    sequential since there's nothing to parallelize yet - then every
    remaining page across every chunk is dispatched at once through one
    shared bounded pool, rate-limited the same way.
    """
    rows: list[dict] = []
    remaining_requests: list[dict] = []
    for params in chunk_params:
        first = _get(client, path, {**params, "limit": MAX_ROWS_PER_PAGE, "offset": 0, "count": True})
        body = first.json()
        rows.extend(body["rows"])
        total = body.get("total")
        if total is None or len(body["rows"]) < MAX_ROWS_PER_PAGE:
            continue
        for offset in range(MAX_ROWS_PER_PAGE, total, MAX_ROWS_PER_PAGE):
            remaining_requests.append({**params, "limit": MAX_ROWS_PER_PAGE, "offset": offset})

    if remaining_requests:
        with ThreadPoolExecutor(max_workers=MAX_CONCURRENT_REQUESTS) as pool:
            futures = [pool.submit(_get, client, path, p) for p in remaining_requests]
            for future in as_completed(futures):
                rows.extend(future.result().json()["rows"])
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
    chunk_params = [
        {"ProfitCenter__in": ",".join(profit_centers[i : i + CHUNK_SIZE]), "YearMonth__startswith": str(year)}
        for i in range(0, len(profit_centers), CHUNK_SIZE)
    ]
    with _client(settings.fbl3n_api_key) as client:
        return _fetch_all(client, "/sap/budget_fbl3n/rows/", chunk_params)


def fetch_kssb_v2_rows(cost_centers: list[str], gjahr: int) -> list[dict]:
    """budget_kssb_v2 - per (KOSTL, CostElements, PostingPeriod) row carrying
    Plan/Actual/Commitment/Allotted/Available. Only its Commitment field is
    used anywhere now (see sap_sync_service.py) - Node's own KSSB V2 pull was
    removed once Forecast GAE/DOE moved to FBL3N + FinalizedBudgetLine.
    Periods 1-12 only (13-16 are SAP's own year-end/adjustment periods).
    """
    if not cost_centers:
        return []
    chunk_params = [
        {"KOSTL__in": ",".join(cost_centers[i : i + CHUNK_SIZE]), "GJAHR": gjahr, "PostingPeriod__lte": 12}
        for i in range(0, len(cost_centers), CHUNK_SIZE)
    ]
    with _client(settings.kssb_v2_api_key) as client:
        return _fetch_all(client, "/sap/budget_kssb_v2/rows/", chunk_params)


def fetch_salr_rows(fiscal_year: int) -> list[dict]:
    """S_ALR_87013019 - one row per Internal Order (AUFNR), already fully
    computed by SAP: Budget/Actual/Commitment/Allotted/Available/
    AssignedPerSAP. No CC/GL filter exists on this report and it's a small
    table (174 rows for FY2026 at last check), so no chunking is needed - just
    GJAHR.
    """
    with _client(settings.salr_api_key) as client:
        return _fetch_all(client, "/sap/budget_salr/rows/", [{"GJAHR": fiscal_year}])
