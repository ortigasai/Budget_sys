import { HeadcountRequestStage, ReviewDecisionType } from "@prisma/client";
import { prisma } from "../prisma";
import { HttpError } from "../httpError";

async function logDecision(
  additionalHeadcountRequestId: string,
  stage: HeadcountRequestStage,
  decision: ReviewDecisionType,
  decidedById: string,
  comment?: string | null
) {
  await prisma.headcountReviewDecision.create({
    data: { additionalHeadcountRequestId, stage, decision, decidedById, comment: comment ?? null },
  });
}

function requireStage(actual: HeadcountRequestStage, expected: HeadcountRequestStage) {
  if (actual !== expected) {
    throw new HttpError(409, `Request is at stage ${actual}, expected ${expected}.`);
  }
}

// Notes: "This is approved by the Dept Head, then reviewed by the HR
// Analyst, then approved by the HR Head." A Return is terminal — there's no
// draft state to loop back to; the requestor creates a fresh request.
async function decide(
  requestId: string,
  userId: string,
  currentStage: HeadcountRequestStage,
  nextStageOnApprove: HeadcountRequestStage,
  decision: "APPROVE" | "RETURN",
  comment?: string
) {
  const request = await prisma.additionalHeadcountRequest.findUniqueOrThrow({ where: { id: requestId } });
  requireStage(request.currentStage, currentStage);

  if (decision === "RETURN") {
    if (!comment?.trim()) throw new HttpError(400, "A reason is required to return this request.");
    await logDecision(requestId, currentStage, "RETURN", userId, comment);
    return prisma.additionalHeadcountRequest.update({
      where: { id: requestId },
      data: { currentStage: HeadcountRequestStage.RETURNED },
    });
  }

  await logDecision(requestId, currentStage, "APPROVE", userId, comment);
  return prisma.additionalHeadcountRequest.update({
    where: { id: requestId },
    data: { currentStage: nextStageOnApprove },
  });
}

export const deptHeadHeadcountDecision = (requestId: string, userId: string, decision: "APPROVE" | "RETURN", comment?: string) =>
  decide(requestId, userId, HeadcountRequestStage.DEPT_HEAD_REVIEW, HeadcountRequestStage.HR_ANALYST_REVIEW, decision, comment);

export const hrAnalystHeadcountDecision = (requestId: string, userId: string, decision: "APPROVE" | "RETURN", comment?: string) =>
  decide(requestId, userId, HeadcountRequestStage.HR_ANALYST_REVIEW, HeadcountRequestStage.HR_HEAD_REVIEW, decision, comment);

export const hrHeadHeadcountDecision = async (
  requestId: string,
  userId: string,
  decision: "APPROVE" | "RETURN",
  comment?: string
) => {
  const updated = await decide(
    requestId,
    userId,
    HeadcountRequestStage.HR_HEAD_REVIEW,
    HeadcountRequestStage.APPROVED,
    decision,
    comment
  );
  // Notes_8: the hire is confirmed once HR Head approves — that's when the
  // Office 365 Account request (IS & IT) and Mobile Phone budget request
  // (Admin Services) are both created for their respective reviewers.
  if (decision === "APPROVE") {
    await prisma.office365AccountRequest.create({ data: { additionalHeadcountRequestId: requestId } });
    await prisma.mobilePhoneBudgetRequest.create({ data: { additionalHeadcountRequestId: requestId } });
  }
  return updated;
};
