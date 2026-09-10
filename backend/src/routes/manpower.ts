import { Router } from "express";
import { z } from "zod";
import ExcelJS from "exceljs";
import multer from "multer";
import { RoleType } from "@prisma/client";
import { prisma } from "../prisma";
import { asyncHandler } from "../asyncHandler";
import { hasRole, requireAuth } from "../middleware/auth";
import { HttpError } from "../httpError";
import {
  buildHeadcountSalaryTemplateWorkbook,
  budgetOfficerDecideManpowerBudget,
  getManpowerDashboardSummary,
  getManpowerGrid,
  hrHeadDecideManpowerBudget,
  parseHeadcountSalaryTemplate,
  runManpowerRecompute,
  setHeadcountAdjustment,
  setMeritRate,
  submitManpowerBudget,
} from "../services/manpowerService";
import { getFiscalCycle } from "../lib/fiscalCycle";

export const manpowerRouter = Router();

manpowerRouter.use(requireAuth);

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

// HR Analyst owns this module; the Human Resources Centralized Department
// Head ("HR Head") and the Budget Officer also need read access as part of
// the approval chain.
async function requireManpowerViewer(req: any, res: any, next: any) {
  if (hasRole(req.user, RoleType.HR_ANALYST) || hasRole(req.user, RoleType.BUDGET_OFFICER)) {
    next();
    return;
  }
  const hrDept = await prisma.department.findUnique({ where: { name: "Human Resources" } });
  if (hrDept && hasRole(req.user, RoleType.CENTRALIZED_DEPARTMENT_HEAD, hrDept.id)) {
    next();
    return;
  }
  throw new HttpError(403, "Only the HR Analyst, HR Head, or Budget Officer can view Manpower Budgeting.");
}

function requireHrAnalyst(req: any, res: any, next: any) {
  if (!hasRole(req.user, RoleType.HR_ANALYST)) {
    throw new HttpError(403, "Only the HR Analyst can perform this action.");
  }
  next();
}

manpowerRouter.get(
  "/grid",
  requireManpowerViewer,
  asyncHandler(async (req, res) => {
    const { targetCalendarYear } = await getFiscalCycle();
    const fiscalYear = Number(req.query.fiscalYear ?? targetCalendarYear);
    res.json(await getManpowerGrid(fiscalYear));
  })
);

manpowerRouter.get(
  "/submission",
  requireManpowerViewer,
  asyncHandler(async (req, res) => {
    const { targetCalendarYear } = await getFiscalCycle();
    const fiscalYear = Number(req.query.fiscalYear ?? targetCalendarYear);
    const submission = await prisma.manpowerBudgetSubmission.findUnique({ where: { fiscalYear } });
    res.json(submission ?? { fiscalYear, stage: "HR_ANALYST_DRAFT" });
  })
);

manpowerRouter.get(
  "/merit-rate",
  requireManpowerViewer,
  asyncHandler(async (req, res) => {
    const { targetCalendarYear } = await getFiscalCycle();
    const fiscalYear = Number(req.query.fiscalYear ?? targetCalendarYear);
    const config = await prisma.manpowerMeritRateConfig.findUnique({ where: { fiscalYear } });
    res.json(config ?? { fiscalYear, ratePercent: 0 });
  })
);

manpowerRouter.put(
  "/merit-rate",
  asyncHandler(async (req, res) => {
    if (!hasRole(req.user, RoleType.HR_ANALYST) && !hasRole(req.user, RoleType.BUDGET_OFFICER)) {
      throw new HttpError(403, "Only the HR Analyst or Budget Officer can edit the Merit Increase Rate.");
    }
    const { fiscalYear, ratePercent } = z.object({ fiscalYear: z.number().int(), ratePercent: z.number() }).parse(req.body);
    res.json(await setMeritRate(fiscalYear, ratePercent, req.user!.id));
  })
);

// Notes_6: the Dashboard Report (Salary + Other Manpower Benefits
// sections), optionally scoped to one company via the company filter
// dropdown.
manpowerRouter.get(
  "/dashboard-summary",
  requireManpowerViewer,
  asyncHandler(async (req, res) => {
    const { targetCalendarYear } = await getFiscalCycle();
    const fiscalYear = Number(req.query.fiscalYear ?? targetCalendarYear);
    const companyId = typeof req.query.companyId === "string" && req.query.companyId ? req.query.companyId : undefined;
    res.json(await getManpowerDashboardSummary(fiscalYear, companyId));
  })
);

// Notes_6: Budget-Officer-only manual add/deduct override on the Headcount
// table, per company (not tied to a specific rank).
manpowerRouter.put(
  "/headcount-adjustment",
  asyncHandler(async (req, res) => {
    if (!hasRole(req.user, RoleType.BUDGET_OFFICER)) {
      throw new HttpError(403, "Only the Budget Officer can adjust headcount.");
    }
    const body = z
      .object({ companyId: z.string(), fiscalYear: z.number().int(), adjustment: z.number().int() })
      .parse(req.body);
    res.json(await setHeadcountAdjustment(body.companyId, body.fiscalYear, body.adjustment, req.user!.id));
  })
);

manpowerRouter.post(
  "/run",
  requireHrAnalyst,
  asyncHandler(async (req, res) => {
    const { targetCalendarYear } = await getFiscalCycle();
    const fiscalYear = Number(req.body.fiscalYear ?? targetCalendarYear);
    res.json(await runManpowerRecompute(fiscalYear));
  })
);

// Notes_6: "In 'View Full Report', allow export to excel" - mirrors exactly
// what the Detailed Report modal shows (Salary + Other Manpower Benefits
// sections, every column), respecting the current company filter.
manpowerRouter.get(
  "/export-dashboard-report",
  requireManpowerViewer,
  asyncHandler(async (req, res) => {
    const { targetCalendarYear } = await getFiscalCycle();
    const fiscalYear = Number(req.query.fiscalYear ?? targetCalendarYear);
    const companyId = typeof req.query.companyId === "string" && req.query.companyId ? req.query.companyId : undefined;
    const summary = await getManpowerDashboardSummary(fiscalYear, companyId);

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Manpower Budget Detailed Report");
    const headers = [
      "Account",
      "YTD Actual",
      "Remaining Forecast",
      "Actual + Forecast",
      "Merit Increase",
      "Additional Manpower",
      "Headcount Adjustment",
      "Proposed Budget",
      "Inc/Dec (Amount)",
      "Inc/Dec (%)",
    ];
    sheet.addRow(headers).font = { bold: true };

    const addRow = (row: (typeof summary.salaryRows)[number], bold?: boolean) => {
      const r = sheet.addRow([
        row.payComponentName,
        row.ytdActual,
        row.remainingForecast,
        row.totalActualForecast,
        row.meritAmount,
        row.additionalHeadcountAmount,
        row.headcountAdjustmentAmount,
        row.budget,
        row.budgetVsPriorAmount,
        row.budgetVsPriorPercent,
      ]);
      if (bold) r.font = { bold: true };
    };

    sheet.addRow(["Salary"]).font = { bold: true };
    summary.salaryRows.forEach((r) => addRow(r));
    addRow(summary.salaryTotal, true);
    sheet.addRow(["Other Manpower Benefits"]).font = { bold: true };
    summary.otherRows.forEach((r) => addRow(r));
    addRow(summary.otherTotal, true);

    sheet.columns.forEach((col, i) => (col.width = i === 0 ? 45 : 20));

    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="manpower-budget-detailed-report-${fiscalYear}.xlsx"`);
    await workbook.xlsx.write(res);
    res.end();
  })
);

const entrySchema = z.object({
  payComponentId: z.string(),
  companyId: z.string(),
  fiscalYear: z.number().int(),
  month: z.number().int().min(1).max(12).optional(),
  otherIncrease: z.number().optional(),
  additionalHeadcountManual: z.number().optional(),
  remainingForecastValue: z.number().optional(),
});

// Manual per-cell edit for MANUAL-sourced components (remaining forecast per
// month), Other Increase, and the manual Additional Headcount Request amount
// (for components not covered by the rank/level lookup).
manpowerRouter.patch(
  "/entries",
  requireHrAnalyst,
  asyncHandler(async (req, res) => {
    const body = entrySchema.parse(req.body);
    const key = { payComponentId_companyId_fiscalYear: { payComponentId: body.payComponentId, companyId: body.companyId, fiscalYear: body.fiscalYear } };
    const existing = await prisma.manpowerEntry.findUnique({ where: key });
    const forecast = (existing?.remainingForecast as Record<string, number>) ?? {};

    if (body.month !== undefined && body.remainingForecastValue !== undefined) {
      forecast[String(body.month)] = body.remainingForecastValue;
    }

    const updated = await prisma.manpowerEntry.upsert({
      where: key,
      update: {
        remainingForecast: forecast,
        ...(body.otherIncrease !== undefined ? { otherIncrease: body.otherIncrease } : {}),
        ...(body.additionalHeadcountManual !== undefined ? { additionalHeadcountManual: body.additionalHeadcountManual } : {}),
      },
      create: {
        payComponentId: body.payComponentId,
        companyId: body.companyId,
        fiscalYear: body.fiscalYear,
        remainingForecast: forecast,
        otherIncrease: body.otherIncrease ?? 0,
        additionalHeadcountManual: body.additionalHeadcountManual ?? 0,
      },
    });
    res.json(updated);
  })
);

// ---- Manpower Template (Employee List + Average Salary sheets) ----
// ---- Headcount and Salary Template (Notes_6: replaces the old
// Employee-List-based Manpower Template) ----
manpowerRouter.get(
  "/headcount-salary-template",
  requireHrAnalyst,
  asyncHandler(async (req, res) => {
    const { targetCalendarYear } = await getFiscalCycle();
    const fiscalYear = Number(req.query.fiscalYear ?? targetCalendarYear);
    const workbook = await buildHeadcountSalaryTemplateWorkbook(fiscalYear);
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", 'attachment; filename="headcount-and-salary-template.xlsx"');
    await workbook.xlsx.write(res);
    res.end();
  })
);

manpowerRouter.post(
  "/headcount-salary-template-upload",
  requireHrAnalyst,
  upload.single("file"),
  asyncHandler(async (req, res) => {
    if (!req.file) throw new HttpError(400, "No file uploaded.");
    const { targetCalendarYear } = await getFiscalCycle();
    const fiscalYear = Number(req.body.fiscalYear ?? targetCalendarYear);

    const result = await parseHeadcountSalaryTemplate(req.file.buffer, fiscalYear, req.user!.id, req.file.originalname);
    if (!result.ok) {
      res.status(400).json(result);
      return;
    }
    res.status(201).json(result);
  })
);

// ---- Approval chain: HR Analyst -> HR Head -> Budget Officer -> SAP ----
manpowerRouter.post(
  "/submit",
  requireHrAnalyst,
  asyncHandler(async (req, res) => {
    const { targetCalendarYear } = await getFiscalCycle();
    const fiscalYear = Number(req.body.fiscalYear ?? targetCalendarYear);
    res.json(await submitManpowerBudget(fiscalYear, req.user!.id));
  })
);

manpowerRouter.post(
  "/hr-head-decision",
  asyncHandler(async (req, res) => {
    const hrDept = await prisma.department.findUniqueOrThrow({ where: { name: "Human Resources" } });
    if (!hasRole(req.user, RoleType.CENTRALIZED_DEPARTMENT_HEAD, hrDept.id)) {
      throw new HttpError(403, "Only the Human Resources Centralized Department Head can decide this.");
    }
    const { fiscalYear, decision } = z.object({ fiscalYear: z.number().int(), decision: z.enum(["APPROVE", "RETURN"]) }).parse(req.body);
    res.json(await hrHeadDecideManpowerBudget(fiscalYear, decision));
  })
);

// Notes_4: Budget Officer's only 2 actions - Return to HR Analyst, or Upload
// to SAP (no separate "Approve then upload" step).
manpowerRouter.post(
  "/budget-officer-decision",
  asyncHandler(async (req, res) => {
    if (!hasRole(req.user, RoleType.BUDGET_OFFICER)) {
      throw new HttpError(403, "Only the Budget Officer can decide this.");
    }
    const { fiscalYear, decision } = z.object({ fiscalYear: z.number().int(), decision: z.enum(["RETURN", "UPLOAD_TO_SAP"]) }).parse(req.body);
    res.json(await budgetOfficerDecideManpowerBudget(fiscalYear, decision));
  })
);

// Notes_2/4: export mirrors the real report file's two tabs - Dashboard
// Report (Total 2026 only) and Excel Report (broken out per company).
manpowerRouter.get(
  "/export",
  requireManpowerViewer,
  asyncHandler(async (req, res) => {
    const { targetCalendarYear } = await getFiscalCycle();
    const fiscalYear = Number(req.query.fiscalYear ?? targetCalendarYear);
    const grid = await getManpowerGrid(fiscalYear);

    const workbook = new ExcelJS.Workbook();

    const dashboard = workbook.addWorksheet("Dashboard Report");
    dashboard.addRow([
      "Account",
      "YTD Actual",
      "Remaining Months Forecast",
      "Total Actual + Forecast",
      "Merit Increase",
      "Other Increase",
      "Additional Manpower Request",
      "Budget",
      "Budget vs Prior Year Actual + Forecast (Amount)",
      "Budget vs Prior Year Actual + Forecast (%)",
    ]).font = { bold: true };
    for (const row of grid.rows) {
      const sum = (f: (c: (typeof row.cells)[number]) => number) => row.cells.reduce((s, c) => s + f(c), 0);
      const totalActualForecast = sum((c) => c.totalActualForecast);
      const budget = sum((c) => c.budget);
      dashboard.addRow([
        row.payComponent.name,
        sum((c) => c.ytdActual),
        sum((c) => c.remainingForecast),
        totalActualForecast,
        sum((c) => c.meritAmount),
        sum((c) => c.otherIncrease),
        sum((c) => c.additionalHeadcountAmount),
        budget,
        budget - totalActualForecast,
        totalActualForecast > 0 ? (budget - totalActualForecast) / totalActualForecast : 0,
      ]);
    }
    dashboard.columns.forEach((col, i) => (col.width = i === 0 ? 40 : 22));

    const excelReport = workbook.addWorksheet("Excel Report");
    const metricGroups: { title: string; valueOf: (c: (typeof grid.rows)[number]["cells"][number]) => number }[] = [
      { title: "YTD Actual", valueOf: (c) => c.ytdActual },
      { title: "Remaining Months Forecast", valueOf: (c) => c.remainingForecast },
      { title: "Total Actual + Forecast", valueOf: (c) => c.totalActualForecast },
      { title: "Merit Increase", valueOf: (c) => c.meritAmount },
      { title: "Other Increase", valueOf: (c) => c.otherIncrease },
      { title: "Additional Manpower Request", valueOf: (c) => c.additionalHeadcountAmount },
      { title: "Budget", valueOf: (c) => c.budget },
      { title: "Budget vs Prior Year Actual + Forecast (Amount)", valueOf: (c) => c.budgetVsPriorAmount },
      { title: "Budget vs Prior Year Actual + Forecast (%)", valueOf: (c) => c.budgetVsPriorPercent },
    ];
    const groupHeader: (string | null)[] = ["Account"];
    const colHeader: string[] = [""];
    for (const group of metricGroups) {
      groupHeader.push(group.title, ...Array(grid.companies.length).fill(null), null);
      colHeader.push(...grid.companies.map((c) => c.code), `Total ${fiscalYear}`, "");
    }
    excelReport.addRow(groupHeader).font = { bold: true };
    excelReport.addRow(colHeader).font = { bold: true };
    for (const row of grid.rows) {
      const values: (string | number)[] = [row.payComponent.name];
      for (const group of metricGroups) {
        const perCompany = row.cells.map(group.valueOf);
        values.push(...perCompany, perCompany.reduce((a, b) => a + b, 0), "");
      }
      excelReport.addRow(values);
    }
    excelReport.columns.forEach((col, i) => (col.width = i === 0 ? 40 : 16));

    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="manpower-budget-${fiscalYear}.xlsx"`);
    await workbook.xlsx.write(res);
    res.end();
  })
);
