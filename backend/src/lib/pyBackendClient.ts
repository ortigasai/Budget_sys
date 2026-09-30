import axios from "axios";

// Note 11: the first server-to-server call this app makes - until now, the
// two backends only ever shared data via Python's own read-only mirrors of
// Node-owned tables (models_phase1.py) or by having the frontend call both
// `api`/`api2` and merge client-side. This one is needed specifically
// because CC/GL names and NPC/IO utilization data are Python-owned, but the
// Finalized Budget Report's Excel export (built entirely in Node via
// ExcelJS) needs them baked into the file server-side, not just shown
// on-screen. Both endpoints called below already exist and already return
// exactly the shape needed - nothing new was added on the Python side for
// this file to work.
const PY_BACKEND_URL = process.env.PY_BACKEND_URL ?? "http://127.0.0.1:8010";

const pyClient = axios.create({ baseURL: PY_BACKEND_URL, timeout: 10_000 });

export interface CcGlEntry {
  id: number;
  code: string;
  name: string;
}
export interface CcGlOptions {
  costCenters: CcGlEntry[];
  glAccounts: CcGlEntry[];
}

// GET /transfers/cc-gl-options - no auth required (see backend-py's
// transfers.py), returns the full admin-maintained CC/GL master lists.
export async function fetchCcGlOptions(): Promise<CcGlOptions> {
  const { data } = await pyClient.get<CcGlOptions>("/transfers/cc-gl-options");
  return data;
}

// One row's worth of per-IO figures - a Budget Code can fund more than one
// Internal Order, and the frontend shows each one on its own line, not
// lumped into a single summed figure (see NpcForecastView.tsx).
export interface NpcIoDetail {
  aufnr: string;
  description: string;
  budget: number;
  // None when no live/imported Actual exists yet for this specific IO -
  // for the live-workflow path, Python leaves this null and Node fills it
  // in per-IO from its own SALR broker match (see npcForecastService.ts).
  actual: number | null;
}

export interface NpcUtilizationRow {
  budgetCode: string;
  projectTitle: string;
  amount: number;
  location: string | null;
  sbu: string;
  ioCodes: string[];
  // Per-IO breakdown backing ioCodes above.
  ios: NpcIoDetail[];
  ioAmount: number;
  balance: number;
  // Only set when Python sourced this row from the NPC Monitoring import
  // (models_npc_monitoring.py) - null for the live-workflow path, which
  // gets its own Actual from a direct SALR broker pull instead (see
  // npcForecastService.ts).
  actual: number | null;
  // True only for a standalone "Carry-over" IO row (no Budget Code, no NPC-
  // approved project behind it) - amount is set equal to ioAmount for
  // these (there's no real NPC budget ask to show instead).
  isCarryOver: boolean;
}

// GET /utilization/npc requires an authenticated user (SBU-scoped for
// non-Budget-Officers) - rather than minting a separate service-to-service
// credential, this forwards the calling route's own incoming `Authorization`
// header verbatim (e.g. req.header("authorization")) - both backends verify
// the same JWT secret, so a token issued by Node's own /auth/login is
// already valid on Python's side too (see backend-py/app/auth.py).
// asOfMonth is NPC Forecast's own "YTD Actual through" cutoff (independent
// of GAE/DOE's - see fiscalCycle.ts's npcAsOfMonth) - only the monitoring-
// import path on the Python side has a monthly Actual breakdown to apply it
// to; every other path ignores it and keeps its existing behavior.
export async function fetchNpcUtilization(fiscalYear: number, sbu: string, authorizationHeader: string, asOfMonth?: number): Promise<NpcUtilizationRow[]> {
  const { data } = await pyClient.get<NpcUtilizationRow[]>("/utilization/npc", {
    params: { fiscalYear, sbu, asOfMonth },
    headers: { Authorization: authorizationHeader },
  });
  return data;
}

// The raw-SAP-cache endpoints below (GET /sap-cache/*) - Python owns one
// local copy of each SAP broker report (see backend-py's
// sap_raw_sync_service.py), refreshed on its own 10-min schedule under the
// shared SapSyncLock, instead of every module here calling the broker
// itself and duplicating the same pulls. No auth required, same as
// /transfers/cc-gl-options above - Node's own scheduler has no user JWT to
// forward.

// Already unpadded/normalized by the Python side (no more "00" prefix to
// strip here), and pre-summed per (glAccount, costCenter) through
// `throughMonth` (SQL SUM/GROUP BY on Python's side, not per-row here) -
// confirmed live that returning FBL3N's ~190k raw rows for a fiscal year
// instead took long enough to blow past this client's 10s timeout below.
export interface GlCcAmount {
  glAccount: string;
  costCenter: string;
  amount: number;
}

export async function fetchFbl3nCache(fiscalYear: number, throughMonth: number): Promise<GlCcAmount[]> {
  const { data } = await pyClient.get<GlCcAmount[]>("/sap-cache/fbl3n", { params: { fiscalYear, throughMonth } });
  return data;
}

// `fiscalYear` here must be the same "actual postings year" (target - 1)
// manpowerService.ts already computes before this call - the cache is keyed
// by whatever fiscal_year sap_raw_sync_service.py's sync_kssb_v1_raw stored
// it under (also target - 1, for the same reason), not re-derived here.
export async function fetchKssbV1Cache(fiscalYear: number, throughMonth: number): Promise<GlCcAmount[]> {
  const { data } = await pyClient.get<GlCcAmount[]>("/sap-cache/kssb-v1", { params: { fiscalYear, throughMonth } });
  return data;
}

export interface SalrCacheRow {
  aufnr: string;
  budget: number;
  actual: number;
  committed: number;
  allotted: number;
  available: number;
}

export async function fetchSalrCache(fiscalYear: number): Promise<SalrCacheRow[]> {
  const { data } = await pyClient.get<SalrCacheRow[]>("/sap-cache/salr", { params: { fiscalYear } });
  return data;
}
