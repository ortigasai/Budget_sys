import { DueDateStage, RequestStage, ReviewDecisionType } from "@prisma/client";
import { prisma } from "../prisma";
import { HttpError } from "../httpError";
import { computeDepartmentalCap } from "./budgetCalcService";
import { determineRequiresCfoApproval } from "./mobilePolicyService";
import { getFiscalCycle } from "../lib/fiscalCycle";
import { uploadCostCenterPlanning } from "./sapMockAdapter";

const BCA_THRESHOLD = 1_000_000;

const DUE_DATE_STAGE_LABELS: Record<DueDateStage, string> = {
  FINALIZE_FORECAST: "Finalize Forecast",
  REQUEST_AND_AUTHORIZATION: "Departmental Request Creation & Authorization",
  CENTRALIZED_L1_REVIEW: "Centralized First-Level Review",
  CENTRALIZED_HEAD_REVIEW: "Centralized Department Head Review",
  BCA_AND_FINALIZATION: "BC&A Head Approval & Technical Review/Finalization",
};

// Notes_2 item 6: "When a workflow stage's due date passes without action —
// block actions." No-ops if the Budget Officer hasn't configured a due date
// for that stage yet.
export async function assertDueDateNotPassed(stage: DueDateStage) {
  const config = await prisma.workflowStageConfig.findUnique({ where: { stage } });
  if (config && config.dueDate.getTime() < Date.now()) {
    throw new HttpError(
      409,
      `The due date for "${DUE_DATE_STAGE_LABELS[stage]}" (${config.dueDate.toLocaleDateString()}) has passed. The Budget Officer must move the due date before this action can proceed.`
    );
  }
}

// FR-1.15 #2 — the Budget Officer's manual open/close gate on the budget
// cycle. Only blocks creating new requests; requests already in flight are
// unaffected. No config row yet means the cycle defaults to open.
export async function assertCycleOpen() {
  const config = await prisma.fiscalCycleConfig.findUnique({ where: { id: "singleton" } });
  if (config && !config.cycleOpen) {
    throw new HttpError(
      409,
      `The ${config.targetCalendarYear} budget cycle is closed. The Budget Officer must reopen it before new requests can be created.`
    );
  }
}

interface ExtraField {
  label: string;
  required: boolean;
  type?: "TEXT" | "NUMBER" | "DROPDOWN";
  options?: { label: string; value: number | null }[];
}

async function logDecision(
  budgetRequestId: string,
  stage: RequestStage,
  decision: ReviewDecisionType,
  decidedById: string,
  comment?: string | null
) {
  await prisma.reviewDecision.create({
    data: { budgetRequestId, stage, decision, decidedById, comment: comment ?? null },
  });
}

function requireStage(actual: RequestStage, expected: RequestStage) {
  if (actual !== expected) {
    throw new HttpError(409, `Request is at stage ${actual}, expected ${expected}.`);
  }
}

export async function submitRequest(requestId: string) {
  const request = await prisma.budgetRequest.findUniqueOrThrow({
    where: { id: requestId },
    include: { expenseLineItem: true, attachments: true },
  });
  requireStage(request.currentStage, RequestStage.DRAFT);
  if (request.requestCategory === "REVENUE") {
    throw new HttpError(400, "Revenue requests are submitted as a batch - use the Revenue upload flow's Submit action instead.");
  }
  await assertDueDateNotPassed(DueDateStage.REQUEST_AND_AUTHORIZATION);

  if (request.proposedAmount <= 0) {
    const { targetCalendarYear } = await getFiscalCycle();
    throw new HttpError(400, `${targetCalendarYear} Proposed Amount must be greater than 0 to submit.`);
  }
  if (!request.businessJustification?.trim()) {
    throw new HttpError(400, "Business Justification is mandatory.");
  }

  const docThreshold = await prisma.documentationThresholdConfig.findUnique({ where: { id: "singleton" } });
  if (docThreshold && request.proposedAmount > docThreshold.amount && request.attachments.length === 0) {
    throw new HttpError(
      400,
      `Supporting attachments are mandatory for requests over PHP ${docThreshold.amount.toLocaleString()}.`
    );
  }

  const extraFieldsConfig = (request.expenseLineItem.extraFieldsConfig as unknown as ExtraField[]) ?? [];
  const otherFields = (request.otherRequiredFields as Record<string, string>) ?? {};

  // Mirrors StandardRequestTab.tsx's usesHeadcountTable rule exactly: a
  // Headcount + rate NUMBER pair (Driver/Messenger/Operator, Drivers' Meal
  // Allowance, etc.), no DROPDOWN field. Those line items render the
  // repeatable Headcount & Rate table instead of the flat form, so their
  // values land in otherRequiredFields under "Row N <label>" keys (see
  // headcountRowsToFields) - the plain field.label lookup below would never
  // find them, and always reject a fully-filled-out request.
  const hasDropdownField = extraFieldsConfig.some((f) => f.type === "DROPDOWN");
  const headcountField = extraFieldsConfig.find((f) => f.label === "Headcount");
  const rateField = extraFieldsConfig.find((f) => f.label !== "Headcount" && f.type === "NUMBER");
  const usesHeadcountTable = !!(
    headcountField &&
    rateField &&
    request.expenseLineItem.spendGridComputation &&
    !hasDropdownField
  );

  if (usesHeadcountTable) {
    const hasCompleteRow = Object.keys(otherFields).some((key) => {
      const match = key.match(/^Row (\d+) Headcount$/);
      if (!match) return false;
      return otherFields[key]?.trim() && otherFields[`Row ${match[1]} ${rateField!.label}`]?.trim();
    });
    if (!hasCompleteRow) {
      throw new HttpError(400, "At least one Headcount & Rate row must be filled out.");
    }
  } else {
    for (const field of extraFieldsConfig) {
      if (field.required && !otherFields[field.label]?.trim()) {
        throw new HttpError(400, `Field "${field.label}" is required for this expense line item.`);
      }
    }
  }

  const requiresCfoApproval = await determineRequiresCfoApproval(extraFieldsConfig as any, otherFields);

  return prisma.budgetRequest.update({
    where: { id: requestId },
    data: { currentStage: RequestStage.DEPT_HEAD_REVIEW, status: "IN_REVIEW", requiresCfoApproval },
  });
}

export async function deptHeadDecision(
  requestId: string,
  userId: string,
  decision: "APPROVE" | "RETURN",
  comment?: string
) {
  const request = await prisma.budgetRequest.findUniqueOrThrow({ where: { id: requestId } });
  requireStage(request.currentStage, RequestStage.DEPT_HEAD_REVIEW);
  await assertDueDateNotPassed(DueDateStage.REQUEST_AND_AUTHORIZATION);

  if (decision === "RETURN") {
    if (!comment?.trim()) throw new HttpError(400, "A reason is required to return this request.");
    await logDecision(requestId, request.currentStage, "RETURN", userId, comment);
    return prisma.budgetRequest.update({
      where: { id: requestId },
      data: { currentStage: RequestStage.DRAFT, status: "RETURNED" },
    });
  }

  await logDecision(requestId, request.currentStage, "APPROVE", userId, comment);
  // Notes item 7 — an over-limit Mobile Phone request needs CFO sign-off,
  // inserted right after Department Head approval and before Centralized
  // First-Level Review (mirrors the conditional BC&A insertion pattern).
  const nextStage = request.requiresCfoApproval ? RequestStage.CFO_APPROVAL : RequestStage.CENTRALIZED_L1_REVIEW;
  return prisma.budgetRequest.update({
    where: { id: requestId },
    data: { currentStage: nextStage },
  });
}

export async function cfoDecision(
  requestId: string,
  userId: string,
  decision: "APPROVE" | "RETURN",
  comment?: string
) {
  const request = await prisma.budgetRequest.findUniqueOrThrow({ where: { id: requestId } });
  requireStage(request.currentStage, RequestStage.CFO_APPROVAL);

  if (decision === "RETURN") {
    if (!comment?.trim()) throw new HttpError(400, "A reason is required to return this request.");
    await logDecision(requestId, request.currentStage, "RETURN", userId, comment);
    return prisma.budgetRequest.update({
      where: { id: requestId },
      data: { currentStage: RequestStage.DEPT_HEAD_REVIEW },
    });
  }

  await logDecision(requestId, request.currentStage, "APPROVE", userId, comment);
  return prisma.budgetRequest.update({
    where: { id: requestId },
    data: { currentStage: RequestStage.CENTRALIZED_L1_REVIEW },
  });
}

// Notes item "Requestors' new budget request — requests not yet approved by
// the Dept. Head can still be cancelled by the Requestor."
export async function cancelRequest(requestId: string, userId: string) {
  const request = await prisma.budgetRequest.findUniqueOrThrow({ where: { id: requestId } });
  if (request.createdById !== userId) {
    throw new HttpError(403, "You can only cancel your own requests.");
  }
  if (request.requestCategory === "REVENUE") {
    throw new HttpError(400, "Revenue requests are cancelled as a batch - use the Revenue upload flow's Cancel action instead.");
  }
  if (request.currentStage !== RequestStage.DRAFT && request.currentStage !== RequestStage.DEPT_HEAD_REVIEW) {
    throw new HttpError(409, "This request has already been acted on by the Department Head and can no longer be cancelled.");
  }

  return prisma.budgetRequest.update({
    where: { id: requestId },
    data: { currentStage: RequestStage.CANCELLED, status: "CANCELLED" },
  });
}

export async function isForecastCompleteForDepartment(departmentId: string) {
  const rows = await prisma.historicalActuals.findMany({ where: { departmentId } });
  if (rows.length === 0) return false;
  return rows.every((r) => r.forecastCompletedAt !== null);
}

export async function centralizedL1Decision(
  requestId: string,
  userId: string,
  decision: "APPROVE" | "REJECT",
  comment?: string
) {
  const request = await prisma.budgetRequest.findUniqueOrThrow({
    where: { id: requestId },
    include: { expenseLineItem: true },
  });
  requireStage(request.currentStage, RequestStage.CENTRALIZED_L1_REVIEW);
  await assertDueDateNotPassed(DueDateStage.CENTRALIZED_L1_REVIEW);

  const ownerDepartmentId = request.expenseLineItem.ownerDepartmentId;

  const forecastReady = await isForecastCompleteForDepartment(ownerDepartmentId);
  if (!forecastReady) {
    const { forecastYear } = await getFiscalCycle();
    throw new HttpError(
      409,
      `The ${forecastYear} Remaining Months Forecast must be completed for this department before Centralized First-Level Review can proceed.`
    );
  }

  if (decision === "REJECT") {
    await logDecision(requestId, request.currentStage, "REJECT", userId);
    return prisma.budgetRequest.update({
      where: { id: requestId },
      data: { currentStage: RequestStage.REJECTED, status: "REJECTED" },
    });
  }

  await logDecision(requestId, request.currentStage, "APPROVE", userId, comment);
  return prisma.budgetRequest.update({
    where: { id: requestId },
    data: { currentStage: RequestStage.CENTRALIZED_HEAD_REVIEW },
  });
}

export async function centralizedHeadDecision(
  requestId: string,
  userId: string,
  decision: "APPROVE" | "RETURN",
  comment?: string
) {
  const request = await prisma.budgetRequest.findUniqueOrThrow({ where: { id: requestId } });
  requireStage(request.currentStage, RequestStage.CENTRALIZED_HEAD_REVIEW);
  await assertDueDateNotPassed(DueDateStage.CENTRALIZED_HEAD_REVIEW);

  if (decision === "RETURN") {
    if (!comment?.trim()) throw new HttpError(400, "A reason is required to return this request.");
    await logDecision(requestId, request.currentStage, "RETURN", userId, comment);
    return prisma.budgetRequest.update({
      where: { id: requestId },
      data: { currentStage: RequestStage.CENTRALIZED_L1_REVIEW },
    });
  }

  await logDecision(requestId, request.currentStage, "APPROVE", userId, comment);
  const nextStage = request.proposedAmount > BCA_THRESHOLD ? RequestStage.BCA_HEAD_REVIEW : RequestStage.BUDGET_OFFICER_REVIEW;
  return prisma.budgetRequest.update({
    where: { id: requestId },
    data: { currentStage: nextStage },
  });
}

export async function bcaHeadDecision(
  requestId: string,
  userId: string,
  decision: "APPROVE" | "RETURN",
  comment?: string
) {
  const request = await prisma.budgetRequest.findUniqueOrThrow({ where: { id: requestId } });
  requireStage(request.currentStage, RequestStage.BCA_HEAD_REVIEW);
  await assertDueDateNotPassed(DueDateStage.BCA_AND_FINALIZATION);

  if (decision === "RETURN") {
    if (!comment?.trim()) throw new HttpError(400, "A reason is required to return this request.");
    await logDecision(requestId, request.currentStage, "RETURN", userId, comment);
    return prisma.budgetRequest.update({
      where: { id: requestId },
      data: { currentStage: RequestStage.CENTRALIZED_HEAD_REVIEW },
    });
  }

  await logDecision(requestId, request.currentStage, "APPROVE", userId, comment);
  return prisma.budgetRequest.update({
    where: { id: requestId },
    data: { currentStage: RequestStage.BUDGET_OFFICER_REVIEW },
  });
}

export async function applyBudgetCut(requestId: string, userId: string, cutAmount: number) {
  const request = await prisma.budgetRequest.findUniqueOrThrow({
    where: { id: requestId },
    include: { expenseLineItem: true },
  });
  requireStage(request.currentStage, RequestStage.BUDGET_OFFICER_REVIEW);
  await assertDueDateNotPassed(DueDateStage.BCA_AND_FINALIZATION);
  if (cutAmount < 0 || cutAmount > request.proposedAmount) {
    throw new HttpError(400, "Budget cut must be between 0 and the proposed amount.");
  }

  const cap = await computeDepartmentalCap(request.expenseLineItem.ownerDepartmentId, request.fiscalYear);
  const net = request.proposedAmount - cutAmount;

  return prisma.budgetRequest.update({
    where: { id: requestId },
    data: {
      budgetCutAmount: cutAmount,
      isOverBudget: net > cap.value,
    },
  });
}

export async function returnAtStep5(
  requestId: string,
  userId: string,
  targetStage: Extract<
    RequestStage,
    "DEPT_HEAD_REVIEW" | "CENTRALIZED_L1_REVIEW" | "CENTRALIZED_HEAD_REVIEW" | "BCA_HEAD_REVIEW"
  >,
  reasonCodeId: string
) {
  const request = await prisma.budgetRequest.findUniqueOrThrow({ where: { id: requestId } });
  requireStage(request.currentStage, RequestStage.BUDGET_OFFICER_REVIEW);
  await assertDueDateNotPassed(DueDateStage.BCA_AND_FINALIZATION);

  const reason = await prisma.reasonCode.findUniqueOrThrow({ where: { id: reasonCodeId } });
  await logDecision(requestId, request.currentStage, "RETURN", userId, reason.label);

  return prisma.budgetRequest.update({
    where: { id: requestId },
    data: { currentStage: targetStage, reasonCode: reason.label },
  });
}

// Note 11: "Finalize & Upload" is now one click for every category
// (including NPC, which previously had no SAP-upload step at all) - it logs
// the approval, triggers the mock SAP adapter, and writes one
// FinalizedBudgetLine snapshot, all in the same transaction. That snapshot
// (not this row's own currentStage/status) is what every "approved budget"
// reader elsewhere in the system now queries - see budget_balance.py,
// utilization.py, reports.py in backend-py.
export async function finalizeAtStep5(requestId: string, userId: string) {
  const request = await prisma.budgetRequest.findUniqueOrThrow({
    where: { id: requestId },
    include: { expenseLineItem: true },
  });
  requireStage(request.currentStage, RequestStage.BUDGET_OFFICER_REVIEW);
  await assertDueDateNotPassed(DueDateStage.BCA_AND_FINALIZATION);

  const amount = request.proposedAmount - request.budgetCutAmount;
  const result = await uploadCostCenterPlanning([
    {
      budgetRequestId: request.id,
      glAccount: request.expenseLineItem.glAccount,
      costCenter: request.expenseLineItem.costCenter,
      fiscalYear: request.fiscalYear,
      monthlyAmounts: request.monthlyAmounts as number[],
    },
  ]);

  return prisma.$transaction(async (tx) => {
    await tx.reviewDecision.create({
      data: { budgetRequestId: requestId, stage: request.currentStage, decision: "APPROVE", decidedById: userId, comment: null },
    });
    const updated = await tx.budgetRequest.update({
      where: { id: requestId },
      data: { currentStage: RequestStage.APPROVED, status: "APPROVED", sapDocumentNumber: result.documentNumber },
    });
    await tx.finalizedBudgetLine.create({
      data: {
        budgetRequestId: requestId,
        fiscalYear: request.fiscalYear,
        requestCategory: request.requestCategory,
        sbu: request.sbu,
        npcSbu: request.npcSbu,
        glAccount: request.expenseLineItem.glAccount,
        costCenter: request.expenseLineItem.costCenter,
        amount,
        sapDocumentNumber: result.documentNumber,
        finalizedById: userId,
      },
    });
    return updated;
  });
}

// ---- Revenue (spec item 16) ----
// Revenue requests are created as a batch (one BudgetRequest per CC-GL row
// of the uploaded template - see routes/revenueBatches.ts), and every row in
// a batch always shares one currentStage: every mutation below acts on the
// whole batch atomically via updateMany, never on an individual row, so
// sibling rows can never drift apart. Its own 4-stage chain (SBU-role-based,
// no Department Head step) - see the RequestStage enum comment in
// schema.prisma for why this can't reuse the shared BCA_HEAD_REVIEW/
// BUDGET_OFFICER_REVIEW values GAE/DOE/NPC use.
const REVENUE_STAGE_ORDER: RequestStage[] = [
  RequestStage.REVENUE_BU_FINANCE_OFFICER_REVIEW,
  RequestStage.REVENUE_BU_FINANCE_HEAD_REVIEW,
  RequestStage.REVENUE_BUDGET_OFFICER_REVIEW,
  RequestStage.REVENUE_BCA_HEAD_REVIEW,
];

async function revenueBatchRows(batchId: string) {
  const rows = await prisma.budgetRequest.findMany({
    where: { bulkUploadBatchId: batchId },
    include: { expenseLineItem: true },
  });
  if (rows.length === 0) throw new HttpError(404, "Revenue batch not found or has no rows.");
  return rows;
}

function requireUniformStage(rows: { currentStage: RequestStage }[], expected: RequestStage) {
  if (!rows.every((r) => r.currentStage === expected)) {
    throw new HttpError(409, `This batch is at stage ${rows[0].currentStage}, expected ${expected}.`);
  }
}

export async function submitRevenueBatch(batchId: string) {
  const rows = await revenueBatchRows(batchId);
  requireUniformStage(rows, RequestStage.DRAFT);
  await assertDueDateNotPassed(DueDateStage.REQUEST_AND_AUTHORIZATION);

  const totalAmount = rows.reduce((sum, r) => sum + r.proposedAmount, 0);
  if (totalAmount <= 0) {
    throw new HttpError(400, "The uploaded template's total amount must be greater than 0 to submit.");
  }

  await prisma.budgetRequest.updateMany({
    where: { bulkUploadBatchId: batchId },
    data: { currentStage: RequestStage.REVENUE_BU_FINANCE_OFFICER_REVIEW, status: "IN_REVIEW" },
  });
  return revenueBatchRows(batchId);
}

export async function revenueBatchDecision(
  batchId: string,
  stage: (typeof REVENUE_STAGE_ORDER)[number],
  userId: string,
  decision: "APPROVE" | "RETURN",
  comment?: string
) {
  const rows = await revenueBatchRows(batchId);
  requireUniformStage(rows, stage);
  await assertDueDateNotPassed(DueDateStage.BCA_AND_FINALIZATION);

  const stageIndex = REVENUE_STAGE_ORDER.indexOf(stage);

  if (decision === "RETURN") {
    if (!comment?.trim()) throw new HttpError(400, "A reason is required to return this batch.");
    const targetStage = stageIndex === 0 ? RequestStage.DRAFT : REVENUE_STAGE_ORDER[stageIndex - 1];
    await prisma.reviewDecision.createMany({
      data: rows.map((r) => ({ budgetRequestId: r.id, stage, decision: "RETURN" as const, decidedById: userId, comment })),
    });
    await prisma.budgetRequest.updateMany({
      where: { bulkUploadBatchId: batchId },
      data: { currentStage: targetStage, status: targetStage === RequestStage.DRAFT ? "RETURNED" : undefined },
    });
    return revenueBatchRows(batchId);
  }

  const isLastStage = stageIndex === REVENUE_STAGE_ORDER.length - 1;

  // Note 11: the batch's terminal approval (REVENUE_BCA_HEAD_REVIEW) is
  // Revenue's "one click" finalize & upload - no separate button, since this
  // was already the only terminal action in its 4-stage chain. Same
  // mock-SAP-adapter-per-line + FinalizedBudgetLine-per-row shape as
  // finalizeAtStep5 above, just batched across every row at once.
  if (isLastStage) {
    const result = await uploadCostCenterPlanning(
      rows.map((r) => ({
        budgetRequestId: r.id,
        glAccount: r.expenseLineItem.glAccount,
        costCenter: r.expenseLineItem.costCenter,
        fiscalYear: r.fiscalYear,
        monthlyAmounts: r.monthlyAmounts as number[],
      }))
    );
    await prisma.$transaction(async (tx) => {
      await tx.reviewDecision.createMany({
        data: rows.map((r) => ({ budgetRequestId: r.id, stage, decision: "APPROVE" as const, decidedById: userId, comment: comment ?? null })),
      });
      await tx.budgetRequest.updateMany({
        where: { bulkUploadBatchId: batchId },
        data: { currentStage: RequestStage.APPROVED, status: "APPROVED", sapDocumentNumber: result.documentNumber },
      });
      await tx.finalizedBudgetLine.createMany({
        data: rows.map((r) => ({
          budgetRequestId: r.id,
          fiscalYear: r.fiscalYear,
          requestCategory: r.requestCategory,
          sbu: r.sbu,
          npcSbu: r.npcSbu,
          glAccount: r.expenseLineItem.glAccount,
          costCenter: r.expenseLineItem.costCenter,
          amount: r.proposedAmount - r.budgetCutAmount,
          sapDocumentNumber: result.documentNumber,
          finalizedById: userId,
        })),
      });
    });
    return revenueBatchRows(batchId);
  }

  await prisma.reviewDecision.createMany({
    data: rows.map((r) => ({ budgetRequestId: r.id, stage, decision: "APPROVE" as const, decidedById: userId, comment: comment ?? null })),
  });
  await prisma.budgetRequest.updateMany({
    where: { bulkUploadBatchId: batchId },
    data: { currentStage: REVENUE_STAGE_ORDER[stageIndex + 1] },
  });
  return revenueBatchRows(batchId);
}

export async function cancelRevenueBatch(batchId: string, userId: string) {
  const rows = await revenueBatchRows(batchId);
  if (rows.some((r) => r.createdById !== userId)) {
    throw new HttpError(403, "You can only cancel your own requests.");
  }
  requireUniformStage(rows, RequestStage.DRAFT);

  await prisma.budgetRequest.updateMany({
    where: { bulkUploadBatchId: batchId },
    data: { currentStage: RequestStage.CANCELLED, status: "CANCELLED" },
  });
  return revenueBatchRows(batchId);
}
