import crypto from "node:crypto";

export interface SapCostCenterPlanningLine {
  budgetRequestId: string;
  glAccount: string;
  costCenter: string;
  fiscalYear: number;
  monthlyAmounts: number[];
}

export interface SapUploadResult {
  documentNumber: string;
  status: "SUCCESS";
  transactionCode: "KP06";
  postedAt: string;
}

/**
 * Stand-in for the real SAP BAPI/RFC call (FR-1.33-35). Produces a
 * deterministic-looking fake document number and always succeeds. Swap the
 * body of this function for a real SAP client (e.g. node-rfc calling KP06)
 * without touching any caller — the interface is the integration seam.
 */
export async function uploadCostCenterPlanning(
  lines: SapCostCenterPlanningLine[]
): Promise<SapUploadResult> {
  const suffix = crypto.randomBytes(4).toString("hex").toUpperCase();
  const documentNumber = `KP06-${new Date().getFullYear()}-${suffix}`;

  return {
    documentNumber,
    status: "SUCCESS",
    transactionCode: "KP06",
    postedAt: new Date().toISOString(),
  };
}

// Rough monthly per-head rates used only to generate a plausible mock YTD
// pull for the Manpower Budgeting module — there is no real SAP source to
// read from yet. Swap this function for a real SAP read without touching
// manpowerService.ts, which only depends on this interface.
const MOCK_MONTHLY_RATE_PER_HEAD: Record<string, number> = {
  "Basic Pay": 30000,
  "Guaranteed Bonus": 2500,
  "Government Contributions (ER) - SSS": 1200,
  "Government Contributions (ER) - Pag-Ibig": 200,
  "Government Contributions (ER) - Philhealth": 900,
};
const MOCK_DEFAULT_MONTHLY_RATE_PER_HEAD = 300;

export async function pullManpowerActuals(
  payComponentName: string,
  headcount: number,
  monthsElapsed: number
): Promise<number> {
  const rate = MOCK_MONTHLY_RATE_PER_HEAD[payComponentName] ?? MOCK_DEFAULT_MONTHLY_RATE_PER_HEAD;
  return Math.round(headcount * rate * monthsElapsed);
}
