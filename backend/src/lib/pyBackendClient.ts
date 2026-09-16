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
