import { RequestCategory, Sbu } from "@prisma/client";
import { prisma } from "../prisma";
import { fetchCcGlOptions } from "../lib/pyBackendClient";

export interface FinalizedBudgetLineOut {
  glAccount: string;
  glAccountName: string | null;
  costCenter: string;
  costCenterName: string | null;
  requestCategory: RequestCategory;
  sbu: Sbu | null;
  npcSbu: string | null;
  amount: number;
  lineCount: number;
}

export interface BoardBudgetCheckOut {
  requestCategory: RequestCategory;
  sbu: Sbu | null;
  boardApprovedAmount: number;
  totalFinalizedAmount: number;
  variance: number;
}

export interface FinalizedBudgetReport {
  fiscalYear: number;
  lines: FinalizedBudgetLineOut[];
  boardBudgetChecks: BoardBudgetCheckOut[];
}

export interface FinalizedBudgetReportFilter {
  fiscalYear: number;
  requestCategory?: RequestCategory;
  sbu?: Sbu;
  npcSbu?: string;
  search?: string; // matches costCenter, glAccount, or their names
}

// Note 11 §3/§4 - the one place both the Budget-Officer-only Finalized
// Budget Report and the SBU-scoped Approved Budget report read from. Groups
// FinalizedBudgetLine (the per-line snapshot written at "Finalize & Upload"
// time - see workflowService.ts) by (requestCategory, sbu, npcSbu, glAccount,
// costCenter), and separately retains the existing "total finalized vs
// board-approved budget" check per (requestCategory, sbu), same "latest
// setAt wins" resolution Step5DashboardPage.tsx already does client-side.
export async function getFinalizedBudgetReport(filter: FinalizedBudgetReportFilter): Promise<FinalizedBudgetReport> {
  const lines = await prisma.finalizedBudgetLine.findMany({
    where: {
      fiscalYear: filter.fiscalYear,
      requestCategory: filter.requestCategory,
      sbu: filter.sbu,
      npcSbu: filter.npcSbu,
    },
  });

  const { costCenters, glAccounts } = await fetchCcGlOptions();
  const ccNameByCode = new Map(costCenters.map((c) => [c.code, c.name]));
  const glNameByCode = new Map(glAccounts.map((g) => [g.code, g.name]));

  const grouped = new Map<string, FinalizedBudgetLineOut>();
  for (const line of lines) {
    const key = [line.requestCategory, line.sbu ?? "", line.npcSbu ?? "", line.glAccount, line.costCenter].join("|");
    const existing = grouped.get(key);
    if (existing) {
      existing.amount += line.amount;
      existing.lineCount += 1;
    } else {
      grouped.set(key, {
        glAccount: line.glAccount,
        glAccountName: glNameByCode.get(line.glAccount) ?? null,
        costCenter: line.costCenter,
        costCenterName: ccNameByCode.get(line.costCenter) ?? null,
        requestCategory: line.requestCategory,
        sbu: line.sbu,
        npcSbu: line.npcSbu,
        amount: line.amount,
        lineCount: 1,
      });
    }
  }

  let reportLines = Array.from(grouped.values());
  if (filter.search) {
    const needle = filter.search.toLowerCase();
    reportLines = reportLines.filter(
      (l) =>
        l.glAccount.toLowerCase().includes(needle) ||
        l.costCenter.toLowerCase().includes(needle) ||
        (l.glAccountName ?? "").toLowerCase().includes(needle) ||
        (l.costCenterName ?? "").toLowerCase().includes(needle)
    );
  }
  reportLines.sort((a, b) => a.costCenter.localeCompare(b.costCenter) || a.glAccount.localeCompare(b.glAccount));

  // Board-budget-vs-total-finalized check, same shape as the figure already
  // shown on Step5DashboardPage.tsx, now computed server-side per
  // (requestCategory, sbu) present in this filtered set of lines.
  const history = await prisma.boardApprovedBudget.findMany({
    where: { fiscalYear: filter.fiscalYear },
    orderBy: { setAt: "desc" },
  });
  const latestBoardAmount = (category: RequestCategory, sbu: Sbu | null): number => {
    const match = history.find((h) => h.requestCategory === category && h.sbu === sbu);
    return match?.amount ?? 0;
  };

  const totalsByCategorySbu = new Map<string, { requestCategory: RequestCategory; sbu: Sbu | null; total: number }>();
  for (const line of lines) {
    const key = `${line.requestCategory}|${line.sbu ?? ""}`;
    const existing = totalsByCategorySbu.get(key);
    if (existing) {
      existing.total += line.amount;
    } else {
      totalsByCategorySbu.set(key, { requestCategory: line.requestCategory, sbu: line.sbu, total: line.amount });
    }
  }
  const boardBudgetChecks: BoardBudgetCheckOut[] = Array.from(totalsByCategorySbu.values()).map(({ requestCategory, sbu, total }) => {
    const boardApprovedAmount = latestBoardAmount(requestCategory, sbu);
    return {
      requestCategory,
      sbu,
      boardApprovedAmount,
      totalFinalizedAmount: total,
      variance: boardApprovedAmount - total,
    };
  });

  return { fiscalYear: filter.fiscalYear, lines: reportLines, boardBudgetChecks };
}
