import { Router } from "express";
import { z } from "zod";
import { RoleType } from "@prisma/client";
import { prisma } from "../prisma";
import { asyncHandler } from "../asyncHandler";
import { requireAuth } from "../middleware/auth";
import { HttpError } from "../httpError";
import { isForecastCompleteForDepartment } from "../services/workflowService";
import { sumMonthlyForecast } from "../services/budgetCalcService";
import { budgetOfficerDecision, headDecision, submitForecast } from "../services/forecastWorkflowService";
import { hasRole } from "../middleware/auth";

export const forecastRouter = Router();

forecastRouter.use(requireAuth);

async function getAsOfMonth() {
  const config = await prisma.fiscalCycleConfig.findUnique({ where: { id: "singleton" } });
  return config?.asOfMonth2026 ?? 9;
}

function canViewDepartment(user: { departmentId: string | null; roles: { roleType: RoleType }[] }, departmentId: string) {
  return user.departmentId === departmentId || user.roles.some((r) => r.roleType === RoleType.BUDGET_OFFICER);
}

// FR-1.10 forecast view: 2025 Actuals, 2026 Approved Budget, 2026 YTD
// Actuals, and (per notes item 7) 2026 Available Budget / 2026 Remaining
// Budget, per CC-GL, for the given department. Notes item 7(4): a
// centralized department cannot view another centralized department's
// forecast — only the Budget Officer can view across departments.
forecastRouter.get(
  "/:departmentId",
  asyncHandler(async (req, res) => {
    if (!canViewDepartment(req.user!, req.params.departmentId)) {
      throw new HttpError(403, "You can only view your own department's forecast.");
    }

    const [rows, asOfMonth] = await Promise.all([
      prisma.historicalActuals.findMany({
        where: { departmentId: req.params.departmentId },
        orderBy: { glDescription: "asc" },
      }),
      getAsOfMonth(),
    ]);

    const withComputedColumns = rows.map((r) => {
      const remainingMonthsForecast = sumMonthlyForecast(r.monthlyRemainingForecast2026);
      const availableBudget2026 = r.approvedBudget2026 - r.ytdActuals2026;
      const remainingBudget2026 = availableBudget2026 - remainingMonthsForecast;
      return { ...r, remainingMonthsForecast, availableBudget2026, remainingBudget2026 };
    });

    res.json({ asOfMonth, rows: withComputedColumns });
  })
);

forecastRouter.get(
  "/:departmentId/completion-status",
  asyncHandler(async (req, res) => {
    if (!canViewDepartment(req.user!, req.params.departmentId)) {
      throw new HttpError(403, "You can only view your own department's forecast.");
    }
    const complete = await isForecastCompleteForDepartment(req.params.departmentId);
    res.json({ complete });
  })
);

const forecastEntrySchema = z.object({ month: z.number().int().min(1).max(12), value: z.number() });

// A department's own users (or the Budget Officer) fill in the remaining
// months forecast before Centralized First-Level Review can act (FR-1.10).
// Per notes item 2, entry is per remaining month — past months are already
// folded into ytdActuals2026 and aren't editable here.
forecastRouter.patch(
  "/entries/:id",
  asyncHandler(async (req, res) => {
    const row = await prisma.historicalActuals.findUniqueOrThrow({ where: { id: req.params.id } });

    if (!canViewDepartment(req.user!, row.departmentId)) {
      throw new HttpError(403, "Only the owning department or the Budget Officer can enter this forecast.");
    }

    const { month, value } = forecastEntrySchema.parse(req.body);
    const asOfMonth = await getAsOfMonth();
    if (month <= asOfMonth) {
      throw new HttpError(400, `Month ${month} is already in Actuals (as-of month is ${asOfMonth}).`);
    }

    const current = (row.monthlyRemainingForecast2026 as Record<string, number>) ?? {};
    const updated = { ...current, [String(month)]: value };

    const saved = await prisma.historicalActuals.update({
      where: { id: req.params.id },
      data: { monthlyRemainingForecast2026: updated },
    });
    res.json(saved);
  })
);

// ---- Forecast approval workflow (Notes_2 item 7): Requestor's department
// submits -> Centralized Department Head (approve/return) -> Budget Officer
// (approve/return). Only Budget Officer approval marks the department's
// forecast "complete" and unblocks Step 3A.
const FISCAL_YEAR = 2027;

forecastRouter.get(
  "/:departmentId/submission",
  asyncHandler(async (req, res) => {
    if (!canViewDepartment(req.user!, req.params.departmentId)) {
      throw new HttpError(403, "You can only view your own department's forecast.");
    }
    const submission = await prisma.forecastSubmission.findUnique({
      where: { departmentId_fiscalYear: { departmentId: req.params.departmentId, fiscalYear: FISCAL_YEAR } },
      include: { reviewDecisions: { include: { decidedBy: true }, orderBy: { timestamp: "asc" } } },
    });
    res.json(submission ?? { stage: "DRAFT", reviewDecisions: [] });
  })
);

// Requests waiting on the current user as Centralized Department Head or
// Budget Officer, across departments (mirrors budget-requests inbox pattern).
forecastRouter.get(
  "/inbox/pending",
  asyncHandler(async (req, res) => {
    const clauses: any[] = [];
    for (const role of req.user!.roles) {
      if (role.roleType === RoleType.CENTRALIZED_DEPARTMENT_HEAD) {
        clauses.push({ stage: "HEAD_REVIEW", departmentId: role.departmentId });
      } else if (role.roleType === RoleType.BUDGET_OFFICER) {
        clauses.push({ stage: "BUDGET_OFFICER_REVIEW" });
      }
    }
    if (clauses.length === 0) {
      res.json([]);
      return;
    }
    const submissions = await prisma.forecastSubmission.findMany({
      where: { OR: clauses },
      include: { department: true },
      orderBy: { updatedAt: "asc" },
    });
    res.json(submissions);
  })
);

forecastRouter.post(
  "/:departmentId/submit",
  asyncHandler(async (req, res) => {
    if (!canViewDepartment(req.user!, req.params.departmentId)) {
      throw new HttpError(403, "Only the owning department or the Budget Officer can submit this forecast.");
    }
    const updated = await submitForecast(req.params.departmentId, FISCAL_YEAR, req.user!.id);
    res.json(updated);
  })
);

forecastRouter.post(
  "/:departmentId/head-decision",
  asyncHandler(async (req, res) => {
    if (!hasRole(req.user, RoleType.CENTRALIZED_DEPARTMENT_HEAD, req.params.departmentId)) {
      throw new HttpError(403, "You are not the Centralized Department Head for this department.");
    }
    const { decision, comment } = z
      .object({ decision: z.enum(["APPROVE", "RETURN"]), comment: z.string().optional() })
      .parse(req.body);
    const updated = await headDecision(req.params.departmentId, FISCAL_YEAR, req.user!.id, decision, comment);
    res.json(updated);
  })
);

forecastRouter.post(
  "/:departmentId/budget-officer-decision",
  asyncHandler(async (req, res) => {
    if (!hasRole(req.user, RoleType.BUDGET_OFFICER)) {
      throw new HttpError(403, "Only the Budget Officer can decide this.");
    }
    const { decision, comment } = z
      .object({ decision: z.enum(["APPROVE", "RETURN"]), comment: z.string().optional() })
      .parse(req.body);
    const updated = await budgetOfficerDecision(req.params.departmentId, FISCAL_YEAR, req.user!.id, decision, comment);
    res.json(updated);
  })
);
