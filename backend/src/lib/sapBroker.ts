import axios from "axios";

// Ortigas's own SAP data broker - a genuine third-party API, unlike
// pyBackendClient.ts's Node-to-Python call. Each report has its own API key
// (see .env.example); the broker's own base URL is shared across all of
// them. See backend-py/app/services/sap_broker.py for the Python mirror of
// this same client (used by Phase 2/3's own SAP touchpoints) - same
// concurrent-fetch-under-a-shared-rate-limiter design as this file, for the
// same reason: a naive "wait, then request, then await the response" loop
// wastes each response's own round-trip time as dead time between requests,
// which measured out to roughly half the broker's real throughput in
// practice on the Python side before this was fixed there.
const SAP_BROKER_BASE_URL = process.env.SAP_BROKER_BASE_URL ?? "https://paba.ortigasland.com.ph/api/v1";
const MAX_ROWS_PER_PAGE = 100;
// Keeps each request's query string short - a `*__in` filter is comma-joined,
// and the broker's own docs don't state a length cap, so this stays
// conservative.
const CHUNK_SIZE = 40;
// The broker's own rate limit (confirmed via /whoami/: rate_limit_per_minute
// 120). A small safety margin under it, since our clock and the broker's
// aren't perfectly synchronized and a burst right at the boundary could
// still trip a 429.
const EFFECTIVE_RATE_PER_MINUTE = 110;
// How many requests can be in flight at once - purely about overlapping
// network round-trip time; the shared RateLimiter below is what actually
// caps the dispatch rate no matter how many are concurrent.
const MAX_CONCURRENT_REQUESTS = 8;
const MAX_RETRIES = 8;
const DEFAULT_RETRY_AFTER_SECONDS = 3;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Token-bucket pacing: `acquire()` resolves once it's this caller's turn,
 * spaced `60000/ratePerMinute` ms apart from the previous caller - shared
 * across every concurrent fetch so the *aggregate* dispatch rate stays
 * under the broker's limit, regardless of how many requests are in flight.
 */
class RateLimiter {
  private intervalMs: number;
  private nextAvailable: number;

  constructor(ratePerMinute: number) {
    this.intervalMs = 60_000 / ratePerMinute;
    this.nextAvailable = Date.now();
  }

  async acquire(): Promise<void> {
    const now = Date.now();
    const wait = Math.max(0, this.nextAvailable - now);
    this.nextAvailable = Math.max(now, this.nextAvailable) + this.intervalMs;
    if (wait > 0) await sleep(wait);
  }
}

const rateLimiter = new RateLimiter(EFFECTIVE_RATE_PER_MINUTE);

function sapClient(apiKey: string | undefined) {
  return axios.create({
    baseURL: SAP_BROKER_BASE_URL,
    headers: { "X-API-Key": apiKey ?? "" },
    timeout: 15_000,
    // 429 (rate limited) and 5xx (a transient hiccup on the broker's own
    // end, not something retrying at the same pace would make worse -
    // confirmed live: a 502 mid-sync that succeeded on retry) are both
    // handled by getWithRateLimit below instead of throwing here.
    validateStatus: (status) => status < 400 || status === 429 || status >= 500,
  });
}

interface RowsResponse<T> {
  rows: T[];
  total?: number;
}

/** One rate-limited GET with retry/backoff on 429 and 5xx. */
async function getWithRateLimit<T>(client: ReturnType<typeof sapClient>, path: string, params: Record<string, unknown>): Promise<RowsResponse<T>> {
  let lastStatus = 0;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    await rateLimiter.acquire();
    const res = await client.get<RowsResponse<T>>(path, { params });
    if (res.status < 400) return res.data;
    lastStatus = res.status;
    const retryAfter = res.headers["retry-after"];
    const waitSeconds = retryAfter ? Number(retryAfter) : DEFAULT_RETRY_AFTER_SECONDS * (attempt + 1);
    await sleep(waitSeconds * 1000);
  }
  // Retries exhausted and still failing - surface it as a real error instead
  // of silently returning a response our own validateStatus let through.
  throw new Error(`SAP broker request failed after ${MAX_RETRIES} retries (${path}), last status ${lastStatus}`);
}

/** Runs `tasks` with at most `limit` in flight at once, in any order. */
async function runWithConcurrency<T>(tasks: (() => Promise<T>)[], limit: number): Promise<T[]> {
  const results: T[] = new Array(tasks.length);
  let next = 0;
  async function worker() {
    for (;;) {
      const i = next++;
      if (i >= tasks.length) return;
      results[i] = await tasks[i]();
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, worker));
  return results;
}

/**
 * Every row across every chunk in `chunkParamsList` (one params object per
 * cost-center chunk, or a single-element array for an unchunked report like
 * SALR). First page of each chunk is fetched sequentially (with
 * `count: true`, to learn that chunk's total row count) - genuinely
 * sequential since there's nothing to parallelize yet - then every
 * remaining page across every chunk is dispatched at once through one
 * shared bounded pool, rate-limited the same way.
 */
async function fetchAll<T>(client: ReturnType<typeof sapClient>, path: string, chunkParamsList: Record<string, unknown>[]): Promise<T[]> {
  const rows: T[] = [];
  const remainingRequests: Record<string, unknown>[] = [];
  for (const params of chunkParamsList) {
    const first = await getWithRateLimit<T>(client, path, { ...params, limit: MAX_ROWS_PER_PAGE, offset: 0, count: true });
    rows.push(...first.rows);
    const total = first.total;
    if (total === undefined || first.rows.length < MAX_ROWS_PER_PAGE) continue;
    for (let offset = MAX_ROWS_PER_PAGE; offset < total; offset += MAX_ROWS_PER_PAGE) {
      remainingRequests.push({ ...params, limit: MAX_ROWS_PER_PAGE, offset });
    }
  }

  if (remainingRequests.length > 0) {
    const pages = await runWithConcurrency(
      remainingRequests.map((params) => () => getWithRateLimit<T>(client, path, params)),
      MAX_CONCURRENT_REQUESTS
    );
    for (const page of pages) rows.push(...page.rows);
  }
  return rows;
}

export interface Fbl3nRow {
  BUKRS: string;
  GJAHR: string;
  DocumentNumber: string;
  AmountInLocalCurrency: string;
  ItemText: string | null;
  GLAccount: string;
  ProfitCenter: string;
  YearMonth: string; // "YYYY/MM"
}

/**
 * Real per-posting G/L actuals (Forecast GAE/DOE's "Sync from SAP" - see
 * historicalActualsService.ts). `profitCenters` must already be padded to
 * SAP's "00"+8-digit shape (ProfitCenter plays the cost center role here,
 * same shape as KSSB's KOSTL). `YearMonth__startswith` scopes to the
 * calendar year - verified live that `__gte`/`__lte` range filters return 0
 * rows on this string field, while `__startswith` works.
 */
export async function fetchFbl3nRows(profitCenters: string[], year: number): Promise<Fbl3nRow[]> {
  if (profitCenters.length === 0) return [];
  const client = sapClient(process.env.FBL3N_API_KEY);
  const chunkParamsList = [];
  for (let i = 0; i < profitCenters.length; i += CHUNK_SIZE) {
    chunkParamsList.push({ ProfitCenter__in: profitCenters.slice(i, i + CHUNK_SIZE).join(","), YearMonth__startswith: String(year) });
  }
  return fetchAll<Fbl3nRow>(client, "/sap/budget_fbl3n/rows/", chunkParamsList);
}

export interface SalrRow {
  KOKRS: string;
  GJAHR: string;
  AUFNR: string; // 12-digit zero-padded Internal Order number
  OrderDescription: string;
  Budget: string;
  Actual: string;
  Commitment: string;
  Allotted: string;
  Available: string;
  AssignedPerSAP: string;
}

/**
 * S_ALR_87013019 - one row per Internal Order, already fully computed by SAP
 * (Budget/Actual/Commitment/Allotted/Available). No CC/GL filter exists on
 * this report and it's a small table, so no chunking is needed - just GJAHR.
 */
export async function fetchSalrRows(fiscalYear: number): Promise<SalrRow[]> {
  const client = sapClient(process.env.SALR_API_KEY);
  return fetchAll<SalrRow>(client, "/sap/budget_salr/rows/", [{ GJAHR: fiscalYear }]);
}

export interface KssbV1Row {
  KOKRS: string;
  GJAHR: string;
  PostingPeriod: number;
  KSTAR: string;
  CostCenterName: string | null;
  CostElementName: string | null;
  CompanyCode: string | null;
  ProfitCenter: string;
  Actual: string;
}

/**
 * budget_kssb_v1 - Actual-only (no Plan/Commitment), per (KSTAR, ProfitCenter,
 * PostingPeriod). Used by Manpower's "Run Manpower Budget" (see
 * manpowerService.ts) once a Pay Component/Company pair has an admin-mapped
 * GL Account/Cost Center. `glAccounts`/`profitCenters` must already be padded
 * to SAP's shape by the caller.
 */
export async function fetchKssbV1Rows(profitCenters: string[], glAccounts: string[], gjahr: number): Promise<KssbV1Row[]> {
  if (profitCenters.length === 0 || glAccounts.length === 0) return [];
  const client = sapClient(process.env.KSSB_V1_API_KEY);
  const chunkParamsList = [];
  for (let i = 0; i < profitCenters.length; i += CHUNK_SIZE) {
    const ccChunk = profitCenters.slice(i, i + CHUNK_SIZE);
    for (let j = 0; j < glAccounts.length; j += CHUNK_SIZE) {
      const glChunk = glAccounts.slice(j, j + CHUNK_SIZE);
      chunkParamsList.push({ ProfitCenter__in: ccChunk.join(","), KSTAR__in: glChunk.join(","), GJAHR: gjahr, PostingPeriod__lte: 12 });
    }
  }
  return fetchAll<KssbV1Row>(client, "/sap/budget_kssb_v1/rows/", chunkParamsList);
}
