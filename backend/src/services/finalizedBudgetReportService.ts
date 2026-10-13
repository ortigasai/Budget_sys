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
  // Request / Budget Cut / Approved - `amount` (Approved) is already net of
  // the cut (proposedAmount - budgetCutAmount); `requestedAmount` and
  // `budgetCutAmount` are shown alongside it for transparency.
  requestedAmount: number;
  budgetCutAmount: number;
  amount: number;
  lineCount: number;
  // Budget codes of the requests grouped into this row (NPC/DOE codes; empty when a request has none).
  budgetCodes: string[];
  // Ticket numbers of the requests grouped into this row - every request should have one.
  ticketNumbers: string[];
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
    // GAE requests carry no code of their own; their code is the catalog line item's (see lib/budgetCode.ts).
    include: { budgetRequest: { select: { budgetCode: true, ticketNumber: true, proposedAmount: true, budgetCutAmount: true, expenseLineItem: { select: { budgetCode: true } } } } },
  });

  const { costCenters, glAccounts } = await fetchCcGlOptions();
  const ccNameByCode = new Map(costCenters.map((c) => [c.code, c.name]));
  const glNameByCode = new Map(glAccounts.map((g) => [g.code, g.name]));

  const grouped = new Map<string, FinalizedBudgetLineOut>();
  for (const line of lines) {
    const key = [line.requestCategory, line.sbu ?? "", line.npcSbu ?? "", line.glAccount, line.costCenter].join("|");
    const existing = grouped.get(key);
    const budgetCode = line.budgetRequest.budgetCode ?? line.budgetRequest.expenseLineItem?.budgetCode ?? null;
    const ticketNumber = line.budgetRequest.ticketNumber;
    if (existing) {
      existing.amount += line.amount;
      existing.requestedAmount += line.budgetRequest.proposedAmount;
      existing.budgetCutAmount += line.budgetRequest.budgetCutAmount;
      existing.lineCount += 1;
      if (budgetCode && !existing.budgetCodes.includes(budgetCode)) existing.budgetCodes.push(budgetCode);
      if (ticketNumber && !existing.ticketNumbers.includes(ticketNumber)) existing.ticketNumbers.push(ticketNumber);
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
        requestedAmount: line.budgetRequest.proposedAmount,
        budgetCutAmount: line.budgetRequest.budgetCutAmount,
        lineCount: 1,
        budgetCodes: budgetCode ? [budgetCode] : [],
        ticketNumbers: ticketNumber ? [ticketNumber] : [],
      });
    }
  }

  let reportLines = Array.from(grouped.values());
  if (filter.search) {
    const needle = filter.search.toLowerCase();
    reportLines = reportLines.filter(
      (l) =>
        l.glAccount.toLowerCase().includes(needle) ||
        l.budgetCodes.some((code) => code.toLowerCase().includes(needle)) ||
        l.ticketNumbers.some((t) => t.toLowerCase().includes(needle)) ||
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
  // Also list every approved budget that matches the filter, even one nothing has been
  // finalized against yet (its total is 0), so it shows as not yet finalized.
  for (const h of history) {
    if (filter.requestCategory && h.requestCategory !== filter.requestCategory) continue;
    if (filter.sbu && h.sbu !== filter.sbu) continue;
    const key = `${h.requestCategory}|${h.sbu ?? ""}`;
    if (!totalsByCategorySbu.has(key)) {
      totalsByCategorySbu.set(key, { requestCategory: h.requestCategory, sbu: h.sbu, total: 0 });
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

export interface FinalizedBudgetLineDetail {
  id: string;
  budgetRequestId: string;
  ticketNumber: string | null;
  budgetCode: string | null;
  itemName: string;
  departmentName: string;
  businessJustification: string;
  monthlyAmounts: number[];
  proposedAmount: number;
  budgetCutAmount: number;
  amount: number;
  currentStage: string;
  finalizedAt: string;
  finalizedBy: string;
  requestedBy: string;
  sapDocumentNumber: string | null;
  // NPC only - null for every other category.
  npcLocation: string | null;
  projectStartDate: string | null;
  projectEndDate: string | null;
}

// The individual requests behind one Finalized Budget Report row - opened
// from that row's "# Requests" count (see getFinalizedBudgetReport's
// grouping above, which this mirrors exactly).
export async function getFinalizedBudgetLineDetails(filter: {
  fiscalYear: number;
  requestCategory: RequestCategory;
  sbu: Sbu | null;
  npcSbu: string | null;
  glAccount: string;
  costCenter: string;
}): Promise<FinalizedBudgetLineDetail[]> {
  const lines = await prisma.finalizedBudgetLine.findMany({
    where: {
      fiscalYear: filter.fiscalYear,
      requestCategory: filter.requestCategory,
      sbu: filter.sbu,
      npcSbu: filter.npcSbu,
      glAccount: filter.glAccount,
      costCenter: filter.costCenter,
    },
    include: {
      finalizedBy: { select: { name: true } },
      budgetRequest: {
        select: {
          ticketNumber: true,
          budgetCode: true,
          projectTitle: true,
          businessJustification: true,
          monthlyAmounts: true,
          proposedAmount: true,
          budgetCutAmount: true,
          currentStage: true,
          npcLocation: true,
          projectStartDate: true,
          projectEndDate: true,
          createdBy: { select: { name: true } },
          department: { select: { name: true } },
          expenseLineItem: { select: { name: true, budgetCode: true } },
        },
      },
    },
    orderBy: { finalizedAt: "asc" },
  });

  return lines.map((l) => ({
    id: l.id,
    budgetRequestId: l.budgetRequestId,
    ticketNumber: l.budgetRequest.ticketNumber,
    // GAE's Budget Code is read from the catalog line item, not the request
    // itself - same fallback requestLineDisplay() uses on the frontend.
    budgetCode: l.budgetRequest.budgetCode ?? l.budgetRequest.expenseLineItem?.budgetCode ?? null,
    itemName: l.budgetRequest.projectTitle ?? l.budgetRequest.expenseLineItem?.name ?? `CC ${l.costCenter} / GL ${l.glAccount}`,
    departmentName: l.budgetRequest.department.name,
    businessJustification: l.budgetRequest.businessJustification,
    monthlyAmounts: l.budgetRequest.monthlyAmounts as number[],
    proposedAmount: l.budgetRequest.proposedAmount,
    budgetCutAmount: l.budgetRequest.budgetCutAmount,
    amount: l.amount,
    currentStage: l.budgetRequest.currentStage,
    finalizedAt: l.finalizedAt.toISOString(),
    finalizedBy: l.finalizedBy.name,
    requestedBy: l.budgetRequest.createdBy.name,
    sapDocumentNumber: l.sapDocumentNumber,
    npcLocation: l.budgetRequest.npcLocation,
    projectStartDate: l.budgetRequest.projectStartDate?.toISOString() ?? null,
    projectEndDate: l.budgetRequest.projectEndDate?.toISOString() ?? null,
  }));
}
