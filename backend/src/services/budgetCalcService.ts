import { RequestStage } from "@prisma/client";
import { prisma } from "../prisma";

// Stages that count as "approved" for the purposes of the Remaining
// Departmental Pool (FR-1.5) and the over-budget check at Step 5. A
// request only leaves the pool once it's fully rejected/returned; anything
// still moving through the workflow, or finalized, counts against the cap.
const POOL_CONSUMING_STAGES: RequestStage[] = [
  RequestStage.DEPT_HEAD_REVIEW,
  RequestStage.CENTRALIZED_L1_REVIEW,
  RequestStage.CENTRALIZED_HEAD_REVIEW,
  RequestStage.BCA_HEAD_REVIEW,
  RequestStage.BUDGET_OFFICER_REVIEW,
  RequestStage.APPROVED,
];

// HistoricalActuals.monthlyRemainingForecast2026 is a { "10": 1234, "11": 0 }
// map keyed by calendar month; only remaining-month keys are ever written,
// so summing every value in the object is safe.
export function sumMonthlyForecast(json: unknown): number {
  if (!json || typeof json !== "object") return 0;
  return Object.values(json as Record<string, number>).reduce((sum, v) => sum + (Number(v) || 0), 0);
}

export async function resolveGrowthRate(departmentId: string): Promise<number> {
  const override = await prisma.growthRateOverride.findUnique({ where: { departmentId } });
  if (override) return override.value;

  const config = await prisma.growthRateConfig.findUnique({ where: { id: "singleton" } });
  return config?.defaultValue ?? 0;
}

/**
 * FR-1.4 — 2027 Departmental Budget Cap =
 *   (2026 Actuals YTD + 2026 Remaining Months Forecast) x (1 + Growth Rate / 100)
 *
 * Sums HistoricalActuals across all CC-GLs for the department. Requires the
 * forecast to be completed (FR-1.10) for a meaningful figure, but does not
 * error if it's not — callers that need the gate should check
 * isForecastComplete separately.
 */
export async function computeDepartmentalCap(departmentId: string, fiscalYear: number) {
  const rows = await prisma.historicalActuals.findMany({ where: { departmentId } });

  const actualsYtd2026 = rows.reduce((sum, r) => sum + r.ytdActuals2026, 0);
  const remainingForecast2026 = rows.reduce((sum, r) => sum + sumMonthlyForecast(r.monthlyRemainingForecast2026), 0);
  const growthRate = await resolveGrowthRate(departmentId);

  const value = (actualsYtd2026 + remainingForecast2026) * (1 + growthRate / 100);

  await prisma.departmentalBudgetCap.upsert({
    where: { departmentId_fiscalYear: { departmentId, fiscalYear } },
    update: { value, actualsYtd2026, remainingForecast2026, growthRateUsed: growthRate, computedAt: new Date() },
    create: {
      departmentId,
      fiscalYear,
      value,
      actualsYtd2026,
      remainingForecast2026,
      growthRateUsed: growthRate,
    },
  });

  return { value, actualsYtd2026, remainingForecast2026, growthRateUsed: growthRate };
}

function requestNetAmount(req: { proposedAmount: number; budgetCutAmount: number }) {
  return Math.max(0, req.proposedAmount - req.budgetCutAmount);
}

/**
 * FR-1.5 — Remaining Departmental Pool = 2027 Departmental Budget Cap -
 * Sum of Approved Portal Requests (interpreted as any request still active
 * in the workflow or finalized; rejected/returned requests don't consume the
 * pool).
 *
 * `departmentId` here is the owning centralized department (Admin/IT/HR/
 * Corporate Finance/Tax/Legal) — requests are aggregated by their expense
 * line item's owner, not by whichever department originated the request,
 * since a Requesting department's spend draws against the centralized
 * unit's pool for that GL category (spec §1.2 scope).
 */
export async function computeRemainingPool(departmentId: string, fiscalYear: number) {
  const cap = await computeDepartmentalCap(departmentId, fiscalYear);

  const requests = await prisma.budgetRequest.findMany({
    where: {
      fiscalYear,
      expenseLineItem: { ownerDepartmentId: departmentId },
      currentStage: { in: POOL_CONSUMING_STAGES },
    },
    select: { proposedAmount: true, budgetCutAmount: true },
  });

  const totalPortalRequests = requests.reduce((sum, r) => sum + requestNetAmount(r), 0);
  const remainingPool = cap.value - totalPortalRequests;

  return { ...cap, totalPortalRequests, remainingPool };
}

