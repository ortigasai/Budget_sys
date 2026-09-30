// "Budgeting System_User Management" - tab "Access Control". Group -> module
// access matrix. P = all access (view/update/upload/download), X = none.
// Rules tab: a person in several groups gets P wherever ANY of their groups
// has P ("All access" prevails); BCA members see everything, like the Budget
// Officer.

import { prisma } from "../prisma";

export const ACCESS_GROUPS = ["BCA", "CD", "NCD", "MC", "SF", "NPC"] as const;
export type AccessGroup = (typeof ACCESS_GROUPS)[number];

type Row = { key: string; label: string; scope: "Department" | "SBU" | "NPC SBU" | "N/A"; CD: string; NCD: string; MC: string; SF: string; NPC: string };

// Column order in the sheet: CD, NCD, MC, SF, NPC.
const r = (key: string, label: string, scope: Row["scope"], flags: string): Row => {
  const [CD, NCD, MC, SF, NPC] = flags.split("");
  return { key, label, scope, CD, NCD, MC, SF, NPC };
};

export const ACCESS_MATRIX: Row[] = [
  r("forecast.gae", "Forecast - GAE", "Department", "PXXXX"),
  r("forecast.doe", "Forecast - DOE", "SBU", "XXXPX"),
  r("forecast.commission", "Forecast - Commission", "SBU", "XXXPX"),
  r("forecast.revenue", "Forecast - Revenue", "SBU", "XXXPX"),
  r("forecast.cos", "Forecast - Cost of Sales", "SBU", "XXXPX"),
  r("forecast.da", "Forecast - Depreciation & Amortization", "SBU", "XXXPX"),
  r("forecast.interest", "Forecast - Interest Expense", "SBU", "XXXPX"),
  r("forecast.npc", "Forecast - NPC", "NPC SBU", "XXXXP"),
  r("request.gae", "New Request - GAE", "Department", "PPXXX"),
  r("request.doe", "New Request - DOE", "SBU", "XXXPX"),
  r("request.commission", "New Request - Commission", "SBU", "XXXPX"),
  r("request.revenue", "New Request - Revenue", "SBU", "XXXPX"),
  r("request.cos", "New Request - Cost of Sales", "SBU", "XXXPX"),
  r("request.da", "New Request - Depreciation & Amortization", "SBU", "XXXPX"),
  r("request.interest", "New Request - Interest Expense", "SBU", "XXXPX"),
  r("request.npc", "New Request - NPC", "NPC SBU", "XXXXP"),
  r("myRequests", "My Requests", "N/A", "PPXPP"),
  r("inbox", "Inbox", "N/A", "PPPPP"),
  r("finalization", "Budget Finalization & Upload", "N/A", "XXXXX"),
  r("util.overview", "Utilization - Departmental Overview", "Department", "PXPXX"),
  r("util.reconciliation", "Utilization - Live Reconciliation", "Department", "PXPXX"),
  r("util.npc", "Utilization - NPC", "NPC SBU", "XXXXP"),
  r("util.dashflow", "Dash Flow Budget Check", "SBU", "XXXPX"),
  r("transfer.new", "New Transfer", "N/A", "PPXXX"),
  r("transfer.mine", "My Transfers", "N/A", "PPXXX"),
  r("transfer.inbox", "Transfer Inbox", "N/A", "PPPXX"),
  r("io.new", "New Internal Order Request", "NPC SBU", "XXXXP"),
  r("io.mine", "My Internal Order Requests", "NPC SBU", "XXXXP"),
  r("io.inbox", "Internal Order Inbox", "N/A", "XXPXP"),
  r("reports", "Budget Report & Analysis", "N/A", "XXPPX"),
  r("admin", "Admin Console", "N/A", "XXXXX"),
];

export const ACCESS_KEYS = ACCESS_MATRIX.map((row) => row.key);

type EffectiveRow = Row;
let cached: { at: number; rows: EffectiveRow[] } | null = null;

/** Defaults with the admin-edited AccessMatrixCell overrides applied (cached briefly; invalidated on edit). */
export async function getEffectiveMatrix(): Promise<EffectiveRow[]> {
  if (cached && Date.now() - cached.at < 10_000) return cached.rows;
  const cells = await prisma.accessMatrixCell.findMany();
  const rows = ACCESS_MATRIX.map((row) => {
    const copy: EffectiveRow = { ...row };
    for (const c of cells) if (c.key === row.key && (c.group as string) in copy) (copy as Record<string, unknown>)[c.group] = c.allowed ? "P" : "X";
    return copy;
  });
  cached = { at: Date.now(), rows };
  return rows;
}

export function invalidateAccessMatrix() {
  cached = null;
}

/** key -> true/false for the given group memberships. BCA => everything. */
export function computeAccess(groups: string[], matrix: EffectiveRow[]): Record<string, boolean> {
  const isBca = groups.includes("BCA");
  const out: Record<string, boolean> = {};
  for (const row of matrix) {
    out[row.key] = isBca || groups.some((g) => (row as Record<string, unknown>)[g] === "P");
  }
  return out;
}
