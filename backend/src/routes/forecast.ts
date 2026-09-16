import { Router } from "express";
import { z } from "zod";
import multer from "multer";
import { RequestCategory, RoleType } from "@prisma/client";
import { prisma } from "../prisma";
import { asyncHandler } from "../asyncHandler";
import { requireAuth } from "../middleware/auth";
import { HttpError } from "../httpError";
import { isForecastCompleteForDepartment } from "../services/workflowService";
import { sumMonthlyForecast } from "../services/budgetCalcService";
import { budgetOfficerDecision, headDecision, submitForecast } from "../services/forecastWorkflowService";
import { buildForecastTemplateWorkbook } from "../services/historicalActualsService";
import { buildNpcForecastTemplateWorkbook, getNpcForecastRows, parseNpcForecastTemplate, setNpcForecastMonth } from "../services/npcForecastService";
import { hasRole } from "../middleware/auth";
import { CORE_CENTRALIZED_DEPARTMENT_NAMES } from "../lib/coreDepartments";
import { getFiscalCycle } from "../lib/fiscalCycle";
import { NPC_SBU_VALUES } from "../lib/npcSbu";

export const forecastRouter = Router();

forecastRouter.use(requireAuth);

// Notes_7: "Forecast should be shown on centralized departments' dashboard
// only" — restricted to the same core centralized department list that now
// also gates the Home dashboard's Cap & Pool cards (see lib/coreDepartments.ts).
// Every other centralized department (there are dozens more, imported from
// the real Employee List roster) has no forecast feature.
forecastRouter.get(
  "/eligible-departments",
  asyncHandler(async (_req, res) => {
    const departments = await prisma.department.findMany({
      where: { name: { in: CORE_CENTRALIZED_DEPARTMENT_NAMES } },
      orderBy: { name: "asc" },
    });
    res.json(departments);
  })
);

// Mirrors budget-requests' /reviewed-by-me — this user's own past forecast
// decisions, most recent first. Registered before the single-segment
// "/:departmentId" route below so the literal path wins the match.
forecastRouter.get(
  "/reviewed-by-me",
  asyncHandler(async (req, res) => {
    const submissions = await prisma.forecastSubmission.findMany({
      where: { reviewDecisions: { some: { decidedById: req.user!.id } } },
      include: {
        department: true,
        reviewDecisions: { include: { decidedBy: true }, orderBy: { timestamp: "asc" } },
      },
    });
    const withMyDecision = submissions
      .map((s) => {
        const mine = s.reviewDecisions.filter((d) => d.decidedById === req.user!.id);
        return { ...s, myDecision: mine[mine.length - 1] };
      })
      .sort((a, b) => b.myDecision.timestamp.getTime() - a.myDecision.timestamp.getTime())
      .slice(0, 20);
    res.json(withMyDecision);
  })
);

// Note 11 §8 - NPC Forecast, SBU-scoped rather than department-scoped (NPC
// has no single owning department the way GAE/DOE/Revenue do - see
// backend-py's own _resolve_npc_sbu_scope, mirrored here). Budget Officer
// may view/edit any of the 8 NPC SBUs; everyone else is pinned to their own
// department's Department.sbu.
async function resolveNpcSbuScope(user: { departmentId: string | null; roles: { roleType: RoleType }[] }, requestedSbu: string | undefined): Promise<string> {
  const isBudgetOfficer = user.roles.some((r) => r.roleType === RoleType.BUDGET_OFFICER);
  if (isBudgetOfficer) {
    if (!requestedSbu || !(NPC_SBU_VALUES as readonly string[]).includes(requestedSbu)) {
      throw new HttpError(400, "Select a valid NPC SBU.");
    }
    return requestedSbu;
  }
  const department = user.departmentId ? await prisma.department.findUnique({ where: { id: user.departmentId } }) : null;
  if (!department?.sbu) {
    throw new HttpError(403, "Your department has no NPC SBU assigned - ask the Budget Officer to set one in the Admin Console.");
  }
  return department.sbu;
}

forecastRouter.get(
  "/npc/template",
  asyncHandler(async (req, res) => {
    const { targetCalendarYear, forecastYear } = await getFiscalCycle();
    if (targetCalendarYear < 2027) {
      throw new HttpError(404, "The live spreadsheet template is available starting the fiscal year 2027 cycle.");
    }
    const npcSbu = await resolveNpcSbuScope(req.user!, req.query.npcSbu as string | undefined);
    const workbook = await buildNpcForecastTemplateWorkbook(npcSbu, req.header("authorization") ?? "");
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    // forecastYear, not targetCalendarYear - matches the workbook's own
    // "Calendar Year" cell (buildNpcForecastTemplateWorkbook), which is the
    // year this template's data actually belongs to.
    res.setHeader("Content-Disposition", `attachment; filename="npc-forecast-template-${npcSbu.toLowerCase()}-${forecastYear}.xlsx"`);
    await workbook.xlsx.write(res);
    res.end();
  })
);

const npcUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

forecastRouter.post(
  "/npc/upload",
  npcUpload.single("file"),
  asyncHandler(async (req, res) => {
    if (!req.file) throw new HttpError(400, "No file uploaded.");
    const { targetCalendarYear } = await getFiscalCycle();
    if (targetCalendarYear < 2027) {
      throw new HttpError(404, "The live spreadsheet template is available starting the fiscal year 2027 cycle.");
    }
    const npcSbu = await resolveNpcSbuScope(req.user!, req.body.npcSbu as string | undefined);
    const result = await parseNpcForecastTemplate(req.file.buffer, npcSbu, req.user!.id);
    res.status(result.ok ? 200 : 400).json(result);
  })
);

forecastRouter.patch(
  "/npc/entries/:budgetCode",
  asyncHandler(async (req, res) => {
    const { month, value } = forecastEntrySchema.parse(req.body);
    const { forecastYear } = await getFiscalCycle();
    const updated = await setNpcForecastMonth(req.params.budgetCode, forecastYear, month, value, req.user!.id);
    res.json(updated);
  })
);

forecastRouter.get(
  "/npc/:npcSbu",
  asyncHandler(async (req, res) => {
    const npcSbu = await resolveNpcSbuScope(req.user!, req.params.npcSbu);
    const result = await getNpcForecastRows(npcSbu, req.header("authorization") ?? "");
    res.json(result);
  })
);

async function canViewDepartment(user: { departmentId: string | null; roles: { roleType: RoleType }[] }, departmentId: string) {
  const dept = await prisma.department.findUnique({ where: { id: departmentId }, select: { name: true } });
  if (!dept || !CORE_CENTRALIZED_DEPARTMENT_NAMES.includes(dept.name)) return false;
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
    if (!(await canViewDepartment(req.user!, req.params.departmentId))) {
      throw new HttpError(403, "You can only view your own department's forecast.");
    }

    const cycle = await getFiscalCycle();
    const rows = await prisma.historicalActuals.findMany({
      where: { departmentId: req.params.departmentId, fiscalYear: cycle.targetCalendarYear },
      orderBy: { glDescription: "asc" },
    });
    const asOfMonth = cycle.asOfMonth;

    const withComputedColumns = rows.map((r) => {
      const remainingMonthsForecast = sumMonthlyForecast(r.monthlyRemainingForecast2026);
      const availableBudget2026 = r.approvedBudget2026 - r.ytdActuals2026;
      // Notes_9: matches "Budgeting System_Forecast Template.xlsx" exactly —
      // its own "2026 Total Actual + Forecast" column is YTD + Total (col
      // L = E5+K5), and "2026 Remaining Budget" is Approved - that same
      // total (col M = D5-L5), which is algebraically identical to the
      // pre-existing availableBudget2026 - remainingMonthsForecast.
      const totalActualForecast = r.ytdActuals2026 + remainingMonthsForecast;
      const remainingBudget2026 = availableBudget2026 - remainingMonthsForecast;
      return { ...r, remainingMonthsForecast, availableBudget2026, totalActualForecast, remainingBudget2026 };
    });

    res.json({ asOfMonth, rows: withComputedColumns });
  })
);

// Note 11 §9 - "Open Spreadsheet Template" for GAE/DOE/Revenue Forecast
// (NPC has its own distinct shape - see the /npc/template route added
// separately). Gated to fiscal year 2027+ (targetCalendarYear, the cycle
// this reference data belongs to) - 2026 keeps only the existing plain
// "Upload Forecast Template" flow.
forecastRouter.get(
  "/:departmentId/template",
  asyncHandler(async (req, res) => {
    if (!(await canViewDepartment(req.user!, req.params.departmentId))) {
      throw new HttpError(403, "You can only view your own department's forecast.");
    }
    const category = z.nativeEnum(RequestCategory).parse(req.query.category);
    const { targetCalendarYear } = await getFiscalCycle();
    if (targetCalendarYear < 2027) {
      throw new HttpError(404, "The live spreadsheet template is available starting the fiscal year 2027 cycle.");
    }

    const workbook = await buildForecastTemplateWorkbook(req.params.departmentId, category);
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="forecast-template-${category.toLowerCase()}-${targetCalendarYear}.xlsx"`);
    await workbook.xlsx.write(res);
    res.end();
  })
);

forecastRouter.get(
  "/:departmentId/completion-status",
  asyncHandler(async (req, res) => {
    if (!(await canViewDepartment(req.user!, req.params.departmentId))) {
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

    if (!(await canViewDepartment(req.user!, row.departmentId))) {
      throw new HttpError(403, "Only the owning department or the Budget Officer can enter this forecast.");
    }

    const { month, value } = forecastEntrySchema.parse(req.body);
    const { asOfMonth } = await getFiscalCycle();
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
forecastRouter.get(
  "/:departmentId/submission",
  asyncHandler(async (req, res) => {
    if (!(await canViewDepartment(req.user!, req.params.departmentId))) {
      throw new HttpError(403, "You can only view your own department's forecast.");
    }
    const { targetCalendarYear } = await getFiscalCycle();
    const submission = await prisma.forecastSubmission.findUnique({
      where: { departmentId_fiscalYear: { departmentId: req.params.departmentId, fiscalYear: targetCalendarYear } },
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
      include: {
        department: true,
        reviewDecisions: { include: { decidedBy: true }, orderBy: { timestamp: "asc" } },
      },
      orderBy: { updatedAt: "asc" },
    });
    res.json(submissions);
  })
);

forecastRouter.post(
  "/:departmentId/submit",
  asyncHandler(async (req, res) => {
    if (!(await canViewDepartment(req.user!, req.params.departmentId))) {
      throw new HttpError(403, "Only the owning department or the Budget Officer can submit this forecast.");
    }
    const { targetCalendarYear } = await getFiscalCycle();
    const updated = await submitForecast(req.params.departmentId, targetCalendarYear, req.user!.id);
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
    const { targetCalendarYear } = await getFiscalCycle();
    const updated = await headDecision(req.params.departmentId, targetCalendarYear, req.user!.id, decision, comment);
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
    const { targetCalendarYear } = await getFiscalCycle();
    const updated = await budgetOfficerDecision(req.params.departmentId, targetCalendarYear, req.user!.id, decision, comment);
    res.json(updated);
  })
);
