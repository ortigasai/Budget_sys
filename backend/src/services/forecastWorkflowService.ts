import { DueDateStage, ForecastSubmissionStage, ReviewDecisionType } from "@prisma/client";
import { prisma } from "../prisma";
import { HttpError } from "../httpError";
import { assertDueDateNotPassed } from "./workflowService";

async function getAsOfMonth() {
  const config = await prisma.fiscalCycleConfig.findUnique({ where: { id: "singleton" } });
  return config?.asOfMonth2026 ?? 9;
}

function requireStage(actual: ForecastSubmissionStage, expected: ForecastSubmissionStage) {
  if (actual !== expected) {
    throw new HttpError(409, `Forecast is at stage ${actual}, expected ${expected}.`);
  }
}

async function logDecision(
  forecastSubmissionId: string,
  stage: ForecastSubmissionStage,
  decision: ReviewDecisionType,
  decidedById: string,
  comment?: string | null
) {
  await prisma.forecastReviewDecision.create({
    data: { forecastSubmissionId, stage, decision, decidedById, comment: comment ?? null },
  });
}

async function getOrCreateSubmission(departmentId: string, fiscalYear: number) {
  return prisma.forecastSubmission.upsert({
    where: { departmentId_fiscalYear: { departmentId, fiscalYear } },
    update: {},
    create: { departmentId, fiscalYear },
  });
}

// Notes_2 item 7: "Should be routed to the Centralized Department Head for
// review and approval (can return), then to the Budget Officer for approval
// (can return)." Replaces the old self-service "mark complete" action.
export async function submitForecast(departmentId: string, fiscalYear: number, userId: string) {
  await assertDueDateNotPassed(DueDateStage.FINALIZE_FORECAST);

  const submission = await getOrCreateSubmission(departmentId, fiscalYear);
  if (submission.stage !== ForecastSubmissionStage.DRAFT && submission.stage !== ForecastSubmissionStage.RETURNED) {
    throw new HttpError(409, `Forecast is already at stage ${submission.stage}.`);
  }

  const [rows, asOfMonth] = await Promise.all([
    prisma.historicalActuals.findMany({ where: { departmentId } }),
    getAsOfMonth(),
  ]);
  const remainingMonths = Array.from({ length: 12 - asOfMonth }, (_, i) => asOfMonth + 1 + i);
  const incomplete = rows.filter((r) => {
    const forecast = (r.monthlyRemainingForecast2026 as Record<string, number>) ?? {};
    return remainingMonths.some((m) => forecast[String(m)] === undefined);
  });
  if (incomplete.length > 0) {
    throw new HttpError(
      400,
      `${incomplete.length} CC-GL row(s) still need a 2026 Remaining Months Forecast value for every remaining month.`
    );
  }

  return prisma.forecastSubmission.update({
    where: { id: submission.id },
    data: { stage: ForecastSubmissionStage.HEAD_REVIEW, submittedById: userId },
  });
}

export async function headDecision(
  departmentId: string,
  fiscalYear: number,
  userId: string,
  decision: "APPROVE" | "RETURN",
  comment?: string
) {
  const submission = await getOrCreateSubmission(departmentId, fiscalYear);
  requireStage(submission.stage, ForecastSubmissionStage.HEAD_REVIEW);

  if (decision === "RETURN") {
    if (!comment?.trim()) throw new HttpError(400, "A reason is required to return this forecast.");
    await logDecision(submission.id, submission.stage, "RETURN", userId, comment);
    return prisma.forecastSubmission.update({
      where: { id: submission.id },
      data: { stage: ForecastSubmissionStage.RETURNED },
    });
  }

  await logDecision(submission.id, submission.stage, "APPROVE", userId, comment);
  return prisma.forecastSubmission.update({
    where: { id: submission.id },
    data: { stage: ForecastSubmissionStage.BUDGET_OFFICER_REVIEW },
  });
}

export async function budgetOfficerDecision(
  departmentId: string,
  fiscalYear: number,
  userId: string,
  decision: "APPROVE" | "RETURN",
  comment?: string
) {
  const submission = await getOrCreateSubmission(departmentId, fiscalYear);
  requireStage(submission.stage, ForecastSubmissionStage.BUDGET_OFFICER_REVIEW);

  if (decision === "RETURN") {
    if (!comment?.trim()) throw new HttpError(400, "A reason is required to return this forecast.");
    await logDecision(submission.id, submission.stage, "RETURN", userId, comment);
    return prisma.forecastSubmission.update({
      where: { id: submission.id },
      data: { stage: ForecastSubmissionStage.RETURNED },
    });
  }

  await logDecision(submission.id, submission.stage, "APPROVE", userId, comment);
  await prisma.historicalActuals.updateMany({
    where: { departmentId },
    data: { forecastCompletedAt: new Date() },
  });
  return prisma.forecastSubmission.update({
    where: { id: submission.id },
    data: { stage: ForecastSubmissionStage.APPROVED },
  });
}
