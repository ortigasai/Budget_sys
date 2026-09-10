import axios from "axios";

// Ortigas's own SAP data broker - a genuine third-party API, unlike
// pyBackendClient.ts's Node-to-Python call. Each report has its own API key
// (see .env.example); the broker's own base URL is shared across all of
// them. See backend-py/app/services/sap_broker.py for the Python mirror of
// this same client (used by Phase 2/3's own SAP touchpoints).
const SAP_BROKER_BASE_URL = process.env.SAP_BROKER_BASE_URL ?? "https://paba.ortigasland.com.ph/api/v1";
const MAX_ROWS_PER_PAGE = 100;
// Keeps each request's query string short - a `*__in` filter is comma-joined,
// and the broker's own docs don't state a length cap, so this stays
// conservative.
const CHUNK_SIZE = 40;

function sapClient(apiKey: string | undefined) {
  return axios.create({
    baseURL: SAP_BROKER_BASE_URL,
    headers: { "X-API-Key": apiKey ?? "" },
    timeout: 15_000,
  });
}

interface RowsResponse<T> {
  rows: T[];
}

async function paginate<T>(client: ReturnType<typeof sapClient>, path: string, params: Record<string, unknown>): Promise<T[]> {
  const rows: T[] = [];
  let offset = 0;
  for (;;) {
    const { data } = await client.get<RowsResponse<T>>(path, { params: { ...params, limit: MAX_ROWS_PER_PAGE, offset } });
    rows.push(...data.rows);
    if (data.rows.length < MAX_ROWS_PER_PAGE) break;
    offset += MAX_ROWS_PER_PAGE;
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
  const client = sapClient(process.env.FBL3N_API_KEY);
  const rows: Fbl3nRow[] = [];
  for (let i = 0; i < profitCenters.length; i += CHUNK_SIZE) {
    const chunk = profitCenters.slice(i, i + CHUNK_SIZE);
    rows.push(
      ...(await paginate<Fbl3nRow>(client, "/sap/budget_fbl3n/rows/", {
        ProfitCenter__in: chunk.join(","),
        YearMonth__startswith: String(year),
      }))
    );
  }
  return rows;
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
  return paginate<SalrRow>(client, "/sap/budget_salr/rows/", { GJAHR: fiscalYear });
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
  const rows: KssbV1Row[] = [];
  for (let i = 0; i < profitCenters.length; i += CHUNK_SIZE) {
    const ccChunk = profitCenters.slice(i, i + CHUNK_SIZE);
    for (let j = 0; j < glAccounts.length; j += CHUNK_SIZE) {
      const glChunk = glAccounts.slice(j, j + CHUNK_SIZE);
      rows.push(
        ...(await paginate<KssbV1Row>(client, "/sap/budget_kssb_v1/rows/", {
          ProfitCenter__in: ccChunk.join(","),
          KSTAR__in: glChunk.join(","),
          GJAHR: gjahr,
          PostingPeriod__lte: 12,
        }))
      );
    }
  }
  return rows;
}
