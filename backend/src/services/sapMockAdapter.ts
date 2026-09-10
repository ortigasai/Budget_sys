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
