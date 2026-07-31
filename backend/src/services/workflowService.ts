import { DueDateStage, RequestStage, ReviewDecisionType } from "@prisma/client";
import { prisma } from "../prisma";
import { HttpError } from "../httpError";
import { computeDepartmentalCap } from "./budgetCalcService";
import { determineRequiresCfoApproval } from "./mobilePolicyService";

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
  await assertDueDateNotPassed(DueDateStage.REQUEST_AND_AUTHORIZATION);

  if (request.proposedAmount <= 0) {
    throw new HttpError(400, "2027 Proposed Amount must be greater than 0 to submit.");
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
  for (const field of extraFieldsConfig) {
    if (field.required && !otherFields[field.label]?.trim()) {
      throw new HttpError(400, `Field "${field.label}" is required for this expense line item.`);
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
    throw new HttpError(
      409,
      "The 2026 Remaining Months Forecast must be completed for this department before Centralized First-Level Review can proceed."
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

export async function finalizeAtStep5(requestId: string, userId: string) {
  const request = await prisma.budgetRequest.findUniqueOrThrow({ where: { id: requestId } });
  requireStage(request.currentStage, RequestStage.BUDGET_OFFICER_REVIEW);
  await assertDueDateNotPassed(DueDateStage.BCA_AND_FINALIZATION);

  await logDecision(requestId, request.currentStage, "APPROVE", userId);
  return prisma.budgetRequest.update({
    where: { id: requestId },
    data: { currentStage: RequestStage.APPROVED, status: "APPROVED" },
  });
}
