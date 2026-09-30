import { RequestCategory } from "@prisma/client";

// Display labels for the 5 categories that share the SBU-batch flow (raw
// Cost Center + GL Account, no catalog line item - see approvalChain.ts's
// SBU_BATCH_CATEGORIES). Shared by bulkUpload.ts's template generator and
// doeBatches.ts's createSbuBatchRouter.
export const SBU_BATCH_CATEGORY_LABELS: Record<string, string> = {
  DOE: "DOE",
  COMMISSION: "Commission",
  COST_OF_SALES: "Cost of Sales",
  DEPRECIATION_AMORTIZATION: "Depreciation & Amortization",
  INTEREST_EXPENSE: "Interest Expense",
};

export function sbuBatchCategoryLabel(category: RequestCategory): string {
  return SBU_BATCH_CATEGORY_LABELS[category] ?? category;
}
