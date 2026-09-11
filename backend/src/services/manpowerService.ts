import ExcelJS from "exceljs";
import { HeadcountRequestStage, ManpowerSubmissionStage } from "@prisma/client";
import { prisma } from "../prisma";
import { HttpError } from "../httpError";
import { sumMonthlyForecast } from "./budgetCalcService";
import { uploadCostCenterPlanning } from "./sapMockAdapter";
import { getFiscalCycle } from "../lib/fiscalCycle";
import { fetchKssbV1Rows } from "../lib/sapBroker";

async function getAsOfMonth() {
  return (await getFiscalCycle()).asOfMonth;
}

async function getMeritRate(fiscalYear: number) {
  const config = await prisma.manpowerMeritRateConfig.findUnique({ where: { fiscalYear } });
  return config?.ratePercent ?? 0;
}

async function approvedHeadcountByCompany(): Promise<Record<string, number>> {
  const rows = await prisma.additionalHeadcountRequest.groupBy({
    by: ["companyId"],
    where: { currentStage: HeadcountRequestStage.APPROVED },
    _count: { _all: true },
  });
  return Object.fromEntries(rows.map((r) => [r.companyId, r._count._all]));
}

// Notes_6: Budget-Officer-only manual add/deduct override, per company (not
// tied to a specific rank).
async function headcountAdjustmentByCompany(fiscalYear: number): Promise<Record<string, number>> {
  const rows = await prisma.manpowerHeadcountAdjustment.findMany({ where: { fiscalYear } });
  return Object.fromEntries(rows.map((r) => [r.companyId, r.adjustment]));
}

// Pay-component names that are auto-filled from the uploaded roster (both
// for the base Remaining Forecast and for the Additional Headcount Request
// rank/level lookup) - matches HEADCOUNT_DRIVEN_COMPONENTS in seed.ts.
const ROSTER_FIELD_BY_COMPONENT: Record<string, "basicPayMonthly" | "sssMonthly" | "pagibigMonthly" | "philhealthMonthly"> = {
  "Basic Pay": "basicPayMonthly",
  "Government Contributions (ER) - SSS": "sssMonthly",
  "Government Contributions (ER) - Pag-Ibig": "pagibigMonthly",
  "Government Contributions (ER) - Philhealth": "philhealthMonthly",
};
const SALARY_LEVEL_FIELD_BY_COMPONENT: Record<string, "avgSalary" | "sssER" | "pagibigER" | "philhealthER"> = {
  "Basic Pay": "avgSalary",
  "Government Contributions (ER) - SSS": "sssER",
  "Government Contributions (ER) - Pag-Ibig": "pagibigER",
  "Government Contributions (ER) - Philhealth": "philhealthER",
};

// Notes_5: the 5 roster-driven "Salary" category components that the new
// Dashboard Report summary shows (Basic Pay, Guaranteed Bonus, 3 Gov't
// Contributions) - everything else is the "Other Pay Components" table.
const SALARY_COMPONENT_NAMES = [...Object.keys(SALARY_LEVEL_FIELD_BY_COMPONENT), "Guaranteed Bonus"];

interface GridCell {
  companyId: string;
  companyCode: string;
  ytdActual: number;
  remainingForecast: number;
  totalActualForecast: number;
  meritAmount: number;
  otherIncrease: number;
  additionalHeadcountCount: number;
  additionalHeadcountAmount: number;
  headcountAdjustmentAmount: number;
  budget: number;
  budgetVsPriorAmount: number;
  budgetVsPriorPercent: number;
}

interface GridRow {
  payComponent: { id: string; name: string; isHeadcountDriven: boolean; appliesMeritIncrease: boolean; forecastSource: string };
  cells: GridCell[];
  totalBudget: number;
}

/**
 * Additional Headcount Request $ attribution (Notes_4, amount convention
 * updated per Notes_6's Headcount Adjustment direction): for approved
 * requests, Basic Pay/Guaranteed Bonus/Gov't Contributions are computed via
 * the rank/level lookup against ManpowerSalaryLevel (the uploaded Template's
 * "Average Salary" sheet); every other component is HR-Analyst-manual
 * (ManpowerEntry.additionalHeadcountManual). Basic Pay and the 3 Gov't
 * Contributions use a full 12 months (an approved headcount add is a
 * permanent annual budget change, not just a remaining-months catch-up) -
 * Guaranteed Bonus uses 2 months of basic pay, matching its flat rate
 * everywhere else in this app.
 */
async function resolveAdditionalHeadcountByComponent(fiscalYear: number): Promise<Map<string, number>> {
  const [approved, salaryLevels, payComponents] = await Promise.all([
    prisma.additionalHeadcountRequest.findMany({ where: { currentStage: HeadcountRequestStage.APPROVED } }),
    prisma.manpowerSalaryLevel.findMany(),
    prisma.payComponent.findMany({
      where: { name: { in: [...Object.keys(SALARY_LEVEL_FIELD_BY_COMPONENT), "Guaranteed Bonus"] } },
    }),
  ]);
  const levelMap = new Map(salaryLevels.map((l) => [l.level, l]));
  const componentByName = new Map(payComponents.map((p) => [p.name, p]));

  const result = new Map<string, number>();
  const add = (payComponentId: string, companyId: string, amount: number) => {
    const key = `${payComponentId}:${companyId}`;
    result.set(key, (result.get(key) ?? 0) + amount);
  };

  const guaranteedBonus = componentByName.get("Guaranteed Bonus");

  for (const req of approved) {
    const level = levelMap.get(req.rank);
    if (!level) continue;

    for (const [name, field] of Object.entries(SALARY_LEVEL_FIELD_BY_COMPONENT)) {
      const pc = componentByName.get(name);
      if (!pc) continue;
      const monthlyRate = level[field];
      add(pc.id, req.companyId, monthlyRate * 12);
    }
    if (guaranteedBonus) {
      add(guaranteedBonus.id, req.companyId, level.avgSalary * 2);
    }
  }

  return result;
}

export async function getManpowerGrid(fiscalYear: number) {
  const [payComponents, companies, entries, rosterSummaries, additionalByCompany, meritRate, ahrByCell, headcountAdjustment] =
    await Promise.all([
      prisma.payComponent.findMany({ orderBy: { sortOrder: "asc" } }),
      prisma.company.findMany({ orderBy: { name: "asc" } }),
      prisma.manpowerEntry.findMany({ where: { fiscalYear } }),
      prisma.manpowerRosterSummary.findMany({ where: { fiscalYear } }),
      approvedHeadcountByCompany(),
      getMeritRate(fiscalYear),
      resolveAdditionalHeadcountByComponent(fiscalYear),
      headcountAdjustmentByCompany(fiscalYear),
    ]);

  const entryKey = (payComponentId: string, companyId: string) => `${payComponentId}:${companyId}`;
  const entryMap = new Map(entries.map((e) => [entryKey(e.payComponentId, e.companyId), e]));
  const rosterMap = new Map(rosterSummaries.map((r) => [r.companyId, r]));
  const companyByCode = new Map(companies.map((c) => [c.code, c]));
  const outsourced = companyByCode.get("OUTSOURCED");

  const rows: GridRow[] = payComponents.map((pc) => {
    let totalBudget = 0;
    const cells: GridCell[] = companies.map((company) => {
      const entry = entryMap.get(entryKey(pc.id, company.id));
      const ytdActual = entry?.ytdActual ?? 0;
      const remainingForecast = sumMonthlyForecast(entry?.remainingForecast);
      const totalActualForecast = ytdActual + remainingForecast;

      const meritEligible = pc.appliesMeritIncrease && company.id !== outsourced?.id;
      // Notes_5: Merit Increase = (Actual + Forecast) x rate, per the
      // updated Report file's explicit formula (was YTD Actual x rate).
      const meritAmount = meritEligible ? totalActualForecast * (meritRate / 100) : 0;
      const otherIncrease = entry?.otherIncrease ?? 0;

      const additionalHeadcountCount = pc.isHeadcountDriven ? additionalByCompany[company.id] ?? 0 : 0;
      const additionalHeadcountAmount =
        ahrByCell.get(entryKey(pc.id, company.id)) ?? entry?.additionalHeadcountManual ?? 0;

      // Notes_6: Headcount Adjustment $ impact - the adjustment count isn't
      // tied to a rank, so it's costed at that company's *average*
      // per-head rate (roster total ÷ headcount) rather than a rank
      // lookup. Per user direction: Basic Pay/Gov't Contributions use a
      // full 12 months (a headcount change is a permanent annual budget
      // change, not just a remaining-months catch-up); Guaranteed Bonus
      // uses 2 months of basic pay, matching its flat rate everywhere else
      // in this app.
      const roster = rosterMap.get(company.id);
      const adjustmentCount = headcountAdjustment[company.id] ?? 0;
      let headcountAdjustmentAmount = 0;
      if (adjustmentCount !== 0 && roster && roster.headcount > 0) {
        if (pc.name === "Guaranteed Bonus") {
          headcountAdjustmentAmount = (roster.basicPayMonthly / roster.headcount) * adjustmentCount * 2;
        } else {
          const field = ROSTER_FIELD_BY_COMPONENT[pc.name];
          if (field) headcountAdjustmentAmount = (roster[field] / roster.headcount) * adjustmentCount * 12;
        }
      }

      const budget = totalActualForecast + meritAmount + otherIncrease + additionalHeadcountAmount + headcountAdjustmentAmount;
      totalBudget += budget;
      const budgetVsPriorAmount = budget - totalActualForecast;
      const budgetVsPriorPercent = totalActualForecast > 0 ? budgetVsPriorAmount / totalActualForecast : 0;

      return {
        companyId: company.id,
        companyCode: company.code,
        ytdActual,
        remainingForecast,
        totalActualForecast,
        meritAmount,
        otherIncrease,
        additionalHeadcountCount,
        additionalHeadcountAmount,
        headcountAdjustmentAmount,
        budget,
        budgetVsPriorAmount,
        budgetVsPriorPercent,
      };
    });

    return {
      payComponent: {
        id: pc.id,
        name: pc.name,
        isHeadcountDriven: pc.isHeadcountDriven,
        appliesMeritIncrease: pc.appliesMeritIncrease,
        forecastSource: pc.forecastSource,
      },
      cells,
      totalBudget,
    };
  });

  const headcountRow = companies.map((c) => {
    const baseHeadcount = rosterMap.get(c.id)?.headcount ?? 0;
    const additionalHeadcountCount = additionalByCompany[c.id] ?? 0;
    const adjustment = headcountAdjustment[c.id] ?? 0;
    return {
      companyId: c.id,
      companyCode: c.code,
      baseHeadcount,
      additionalHeadcountCount,
      adjustment,
      effectiveHeadcount: baseHeadcount + additionalHeadcountCount + adjustment,
    };
  });

  return { companies, rows, headcountRow, asOfMonth: await getAsOfMonth(), meritRate };
}

// Notes_6: for the "Other Employee Benefits" section of the Dashboard
// Report, Proposed Budget comes from real submitted Standard Requests
// against the matching catalog item(s), not the usual
// Actual+Forecast+Merit+AHR formula - excludes Cancelled/Rejected requests
// since those don't represent a live budget ask. Sums by ExpenseLineItem
// name (which equals the pay-component name for these rows) and, when a
// company filter is applied, only that company's catalog variant(s).
async function standardRequestBudgetByComponent(fiscalYear: number, companyId?: string): Promise<Map<string, number>> {
  const items = await prisma.expenseLineItem.findMany({
    where: companyId ? { companyId } : undefined,
    select: { id: true, name: true },
  });
  if (items.length === 0) return new Map();

  const sums = await prisma.budgetRequest.groupBy({
    by: ["expenseLineItemId"],
    where: {
      fiscalYear,
      expenseLineItemId: { in: items.map((i) => i.id) },
      currentStage: { notIn: ["CANCELLED", "REJECTED"] },
    },
    _sum: { proposedAmount: true },
  });
  const sumByItemId = new Map(sums.map((s) => [s.expenseLineItemId, s._sum.proposedAmount ?? 0]));

  const result = new Map<string, number>();
  for (const item of items) {
    result.set(item.name, (result.get(item.name) ?? 0) + (sumByItemId.get(item.id) ?? 0));
  }
  return result;
}

/**
 * Notes_6: the Dashboard Report, matching the "Manpower Budget Report" tab -
 * a "Salary" section (Basic Pay, Guaranteed Bonus, 3 Gov't Contributions +
 * Total) and an "Other Employee Benefits" section (the other 14 components +
 * Total), optionally scoped to one company. Reuses getManpowerGrid's
 * already-computed cells for everything except Other Employee Benefits'
 * Proposed Budget, which is overridden by standardRequestBudgetByComponent.
 */
export async function getManpowerDashboardSummary(fiscalYear: number, companyId?: string) {
  const [grid, standardRequestBudget] = await Promise.all([
    getManpowerGrid(fiscalYear),
    standardRequestBudgetByComponent(fiscalYear, companyId),
  ]);

  const rowFor = (row: GridRow, budgetOverride?: number) => {
    const cells = companyId ? row.cells.filter((c) => c.companyId === companyId) : row.cells;
    const sum = (f: (c: GridCell) => number) => cells.reduce((s, c) => s + f(c), 0);
    const totalActualForecast = sum((c) => c.totalActualForecast);
    const budget = budgetOverride ?? sum((c) => c.budget);
    return {
      payComponentId: row.payComponent.id,
      payComponentName: row.payComponent.name,
      ytdActual: sum((c) => c.ytdActual),
      remainingForecast: sum((c) => c.remainingForecast),
      totalActualForecast,
      meritAmount: sum((c) => c.meritAmount),
      additionalHeadcountAmount: sum((c) => c.additionalHeadcountAmount),
      headcountAdjustmentAmount: sum((c) => c.headcountAdjustmentAmount),
      budget,
      budgetVsPriorAmount: budget - totalActualForecast,
      budgetVsPriorPercent: totalActualForecast > 0 ? (budget - totalActualForecast) / totalActualForecast : 0,
    };
  };

  type SummaryRow = ReturnType<typeof rowFor>;
  const totalOf = (label: string, rows: SummaryRow[]): SummaryRow => {
    const totalActualForecast = rows.reduce((s, r) => s + r.totalActualForecast, 0);
    const totalBudget = rows.reduce((s, r) => s + r.budget, 0);
    return {
      payComponentId: `TOTAL:${label}`,
      payComponentName: label,
      ytdActual: rows.reduce((s, r) => s + r.ytdActual, 0),
      remainingForecast: rows.reduce((s, r) => s + r.remainingForecast, 0),
      totalActualForecast,
      meritAmount: rows.reduce((s, r) => s + r.meritAmount, 0),
      additionalHeadcountAmount: rows.reduce((s, r) => s + r.additionalHeadcountAmount, 0),
      headcountAdjustmentAmount: rows.reduce((s, r) => s + r.headcountAdjustmentAmount, 0),
      budget: totalBudget,
      budgetVsPriorAmount: totalBudget - totalActualForecast,
      budgetVsPriorPercent: totalActualForecast > 0 ? (totalBudget - totalActualForecast) / totalActualForecast : 0,
    };
  };

  const salaryRows = grid.rows.filter((r) => SALARY_COMPONENT_NAMES.includes(r.payComponent.name)).map((r) => rowFor(r));
  const salaryTotal = totalOf("Total Salary", salaryRows);

  const otherRows = grid.rows
    .filter((r) => !SALARY_COMPONENT_NAMES.includes(r.payComponent.name))
    .map((r) => rowFor(r, standardRequestBudget.get(r.payComponent.name) ?? 0));
  const otherTotal = totalOf("Total Other Manpower Benefits", otherRows);

  return { companyId: companyId ?? null, salaryRows, salaryTotal, otherRows, otherTotal };
}

/**
 * "Run Manpower Budget" (Notes_4, reworked for the SAP Requirements
 * integration): pulls real KSSB V1 YTD actuals for every (payComponent,
 * company) pair that has both a GL Account and a Cost Center mapped (Admin
 * Console - see PayComponent.glAccount/Company.costCenter), summed across
 * periods 1..asOfMonth. Pairs missing either mapping stay at ytdActual=0
 * (same as any other unmapped GL-CC pair elsewhere in this app - skipped,
 * not fabricated) and are reported back in `unmapped`. Also auto-fills
 * Remaining Months Forecast for the roster-driven components (Basic Pay,
 * Guaranteed Bonus, Government Contributions) from the uploaded
 * ManpowerRosterSummary - Basic Pay/Contributions = monthly rate x
 * remaining months, Guaranteed Bonus = 2x monthly Basic Pay (flat, "2 months
 * of basic salary"). Every other component/company stays HR-Analyst-manual.
 */
export async function runManpowerRecompute(fiscalYear: number) {
  const [payComponents, companies, rosterSummaries, asOfMonth] = await Promise.all([
    prisma.payComponent.findMany(),
    prisma.company.findMany(),
    prisma.manpowerRosterSummary.findMany({ where: { fiscalYear } }),
    getAsOfMonth(),
  ]);
  const rosterMap = new Map(rosterSummaries.map((r) => [r.companyId, r]));
  const remainingMonths = 12 - asOfMonth;

  const glAccounts = [...new Set(payComponents.filter((p) => p.glAccount).map((p) => `00${p.glAccount}`))];
  const costCenters = [...new Set(companies.filter((c) => c.costCenter).map((c) => `00${c.costCenter}`))];
  // fiscalYear - 1, not fiscalYear: real KSSB V1 postings can only exist for
  // a year that's actually happened, not the future year still being
  // budgeted for (same "target year - 1" relationship as the Forecast
  // GAE/DOE sync) - ManpowerEntry itself still stays keyed on fiscalYear.
  const sapRows = glAccounts.length > 0 && costCenters.length > 0 ? await fetchKssbV1Rows(costCenters, glAccounts, fiscalYear - 1) : [];

  const ytdActualByGlCc = new Map<string, number>();
  for (const row of sapRows) {
    if (row.PostingPeriod > asOfMonth) continue;
    const costCenter = row.ProfitCenter.replace(/^00/, "");
    const glAccount = row.KSTAR.replace(/^00/, "");
    const key = `${glAccount}:${costCenter}`;
    ytdActualByGlCc.set(key, (ytdActualByGlCc.get(key) ?? 0) + (Number(row.Actual) || 0));
  }

  const unmapped: { payComponentId: string; payComponentName: string; companyId: string; companyCode: string }[] = [];

  for (const pc of payComponents) {
    for (const company of companies) {
      let ytdActual = 0;
      if (!pc.glAccount || !company.costCenter) {
        unmapped.push({ payComponentId: pc.id, payComponentName: pc.name, companyId: company.id, companyCode: company.code });
      } else {
        ytdActual = ytdActualByGlCc.get(`${pc.glAccount}:${company.costCenter}`) ?? 0;
      }

      const roster = rosterMap.get(company.id);
      const update: { ytdActual: number; remainingForecast?: { lump: number } } = { ytdActual };
      if (roster) {
        if (pc.name === "Guaranteed Bonus") {
          update.remainingForecast = { lump: 2 * roster.basicPayMonthly };
        } else {
          const field = ROSTER_FIELD_BY_COMPONENT[pc.name];
          if (field) update.remainingForecast = { lump: roster[field] * remainingMonths };
        }
      }

      await prisma.manpowerEntry.upsert({
        where: { payComponentId_companyId_fiscalYear: { payComponentId: pc.id, companyId: company.id, fiscalYear } },
        update,
        create: { payComponentId: pc.id, companyId: company.id, fiscalYear, ...update },
      });
    }
  }

  const grid = await getManpowerGrid(fiscalYear);
  return { ...grid, unmapped };
}

function cellNumber(cell: ExcelJS.Cell): number | null {
  const v = cell.value as unknown;
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "object" && v !== null) {
    if ("result" in (v as any)) {
      const r = (v as any).result;
      return typeof r === "number" ? r : null;
    }
    return null;
  }
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function cellText(cell: ExcelJS.Cell): string {
  const v = cell.value as unknown;
  if (v === null || v === undefined) return "";
  if (typeof v === "object" && v !== null) {
    if ("richText" in (v as any)) return (v as any).richText.map((t: any) => t.text).join("");
    if ("result" in (v as any)) return String((v as any).result ?? "");
    return "";
  }
  return String(v).trim();
}

interface TemplateValidationError {
  sheet: string;
  row: number;
  error: string;
}

// The 6 companies covered by the "Headcount per Company" template sheet, in
// the same column order the sheet uses (and the order the downloaded
// template re-generates them in).
const HEADCOUNT_TEMPLATE_COMPANY_CODES = ["OCC", "OCLP", "OCLP_PROJECT", "OLC", "OLC_PROJECT", "OUTSOURCED"];

/**
 * Notes_6: replaces the old Employee-List-based Manpower Template with a
 * simpler 2-sheet upload ("Average Salary" + "Headcount per Company") that
 * directly matches what the rank-based entry used to require box-by-box -
 * "put an excel template for upload instead of filling out the boxes one by
 * one." All-or-nothing: any blank "to be filled-out by HR" cell rejects the
 * whole upload, same rule as before. On success, upserts
 * ManpowerSalaryLevel + ManpowerHeadcountByRank for all 6 companies and
 * recomputes ManpowerRosterSummary for each.
 */
export async function parseHeadcountSalaryTemplate(
  buffer: Buffer,
  fiscalYear: number,
  uploadedById: string,
  sourceFileRef: string
) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as unknown as ArrayBuffer);

  const salarySheet = workbook.getWorksheet("Average Salary");
  const headcountSheet = workbook.getWorksheet("Headcount per Company");
  if (!salarySheet || !headcountSheet) {
    throw new HttpError(400, 'Workbook must contain "Average Salary" and "Headcount per Company" sheets.');
  }

  const errors: TemplateValidationError[] = [];

  // ---- Average Salary: Rank(col1) -> avgSalary/sssER/pagibigER/philhealthER (cols 2-5) ----
  const levelRows: { level: number; avgSalary: number; sssER: number; pagibigER: number; philhealthER: number }[] = [];
  for (let r = 6; r <= salarySheet.rowCount; r++) {
    const row = salarySheet.getRow(r);
    const level = cellNumber(row.getCell(1));
    if (level === null) continue;
    const avgSalary = cellNumber(row.getCell(2));
    const sssER = cellNumber(row.getCell(3));
    const pagibigER = cellNumber(row.getCell(4));
    const philhealthER = cellNumber(row.getCell(5));
    if (avgSalary === null || sssER === null || pagibigER === null || philhealthER === null) {
      errors.push({ sheet: "Average Salary", row: r, error: `Rank ${level}: Average Salary / contribution columns must all be filled out.` });
      continue;
    }
    levelRows.push({ level, avgSalary, sssER, pagibigER, philhealthER });
  }

  // ---- Headcount per Company: Rank(col1) -> headcount per company (cols 2-7, one per HEADCOUNT_TEMPLATE_COMPANY_CODES entry) ----
  const headcountRows: { level: number; companyCode: string; headcount: number }[] = [];
  for (let r = 6; r <= headcountSheet.rowCount; r++) {
    const row = headcountSheet.getRow(r);
    const level = cellNumber(row.getCell(1));
    if (level === null) continue;
    for (let i = 0; i < HEADCOUNT_TEMPLATE_COMPANY_CODES.length; i++) {
      const headcount = cellNumber(row.getCell(i + 2));
      if (headcount === null) {
        errors.push({
          sheet: "Headcount per Company",
          row: r,
          error: `Rank ${level}: ${HEADCOUNT_TEMPLATE_COMPANY_CODES[i]} headcount must be filled out (use 0 if none).`,
        });
        continue;
      }
      headcountRows.push({ level, companyCode: HEADCOUNT_TEMPLATE_COMPANY_CODES[i], headcount });
    }
  }

  if (errors.length > 0) {
    return { ok: false as const, errors };
  }

  const companies = await prisma.company.findMany();
  const companyByCode = new Map(companies.map((c) => [c.code, c]));

  await prisma.$transaction([
    ...levelRows.map((l) =>
      prisma.manpowerSalaryLevel.upsert({
        where: { level: l.level },
        update: { avgSalary: l.avgSalary, sssER: l.sssER, pagibigER: l.pagibigER, philhealthER: l.philhealthER },
        create: l,
      })
    ),
    ...headcountRows.flatMap((h) => {
      const company = companyByCode.get(h.companyCode);
      if (!company) return [];
      return [
        prisma.manpowerHeadcountByRank.upsert({
          where: { level_companyId_fiscalYear: { level: h.level, companyId: company.id, fiscalYear } },
          update: { headcount: h.headcount },
          create: { level: h.level, companyId: company.id, fiscalYear, headcount: h.headcount },
        }),
      ];
    }),
  ]);

  for (const code of HEADCOUNT_TEMPLATE_COMPANY_CODES) {
    const company = companyByCode.get(code);
    if (company) await recomputeRosterFromRanks(company.id, fiscalYear, uploadedById);
  }

  const batch = await prisma.manpowerTemplateUploadBatch.create({
    data: {
      uploadedById,
      fiscalYear,
      sourceFileRef,
      rowCount: levelRows.length + headcountRows.length,
      validationErrors: [],
      status: "COMPLETED",
    },
  });

  return {
    ok: true as const,
    batch,
    levelsUpdated: levelRows.length,
    companiesUpdated: HEADCOUNT_TEMPLATE_COMPANY_CODES.filter((c) => companyByCode.has(c)).length,
  };
}

/**
 * Generates the downloadable "Headcount and Salary Template" (Average
 * Salary + Headcount per Company sheets), pre-filled with the current DB
 * values so HR can edit in place and re-upload via parseHeadcountSalaryTemplate.
 */
export async function buildHeadcountSalaryTemplateWorkbook(fiscalYear: number): Promise<ExcelJS.Workbook> {
  const [levels, headcountData] = await Promise.all([
    prisma.manpowerSalaryLevel.findMany(),
    getManpowerHeadcountByRank(fiscalYear),
  ]);
  const levelByNumber = new Map(levels.map((l) => [l.level, l]));
  const orderedCompanies = HEADCOUNT_TEMPLATE_COMPANY_CODES.map((code) =>
    headcountData.companies.find((c) => c.code === code)
  ).filter((c): c is (typeof headcountData.companies)[number] => Boolean(c));
  const headcountByLevelCompany = new Map(headcountData.cells.map((c) => [`${c.level}:${c.companyId}`, c.headcount]));

  const workbook = new ExcelJS.Workbook();

  const salarySheet = workbook.addWorksheet("Average Salary");
  salarySheet.addRow(["Ortigas Group (OLC, OCC, OCLP)"]);
  salarySheet.addRow(["Average Salary per Employee Rank"]);
  salarySheet.addRow([]);
  salarySheet.addRow(["", "to be filled-out by HR", "to be filled-out by HR", "to be filled-out by HR", "to be filled-out by HR"]).font = {
    italic: true,
  };
  salarySheet.addRow([
    "Rank",
    "Average Salary",
    "Government Contributions (ER) - SSS",
    "Government Contributions (ER) - Pag-Ibig",
    "Government Contributions (ER) - Philhealth",
  ]).font = { bold: true };
  for (let level = 1; level <= 12; level++) {
    const existing = levelByNumber.get(level);
    salarySheet.addRow([level, existing?.avgSalary ?? 0, existing?.sssER ?? 0, existing?.pagibigER ?? 0, existing?.philhealthER ?? 0]);
  }
  salarySheet.columns.forEach((col) => (col.width = 30));

  const headcountSheet = workbook.addWorksheet("Headcount per Company");
  headcountSheet.addRow(["Ortigas Group (all companies)"]);
  headcountSheet.addRow(["Current Headcount per Company"]);
  headcountSheet.addRow([]);
  headcountSheet.addRow(["", ...orderedCompanies.map(() => "to be filled-out by HR")]).font = { italic: true };
  headcountSheet.addRow(["Rank", ...orderedCompanies.map((c) => c.name), "Total"]).font = { bold: true };
  for (let level = 1; level <= 12; level++) {
    const counts = orderedCompanies.map((c) => headcountByLevelCompany.get(`${level}:${c.id}`) ?? 0);
    headcountSheet.addRow([level, ...counts, counts.reduce((a, b) => a + b, 0)]);
  }
  headcountSheet.columns.forEach((col) => (col.width = 18));

  return workbook;
}

export async function setMeritRate(fiscalYear: number, ratePercent: number, updatedBy: string) {
  return prisma.manpowerMeritRateConfig.upsert({
    where: { fiscalYear },
    update: { ratePercent, updatedBy },
    create: { fiscalYear, ratePercent, updatedBy },
  });
}

export async function setHeadcountAdjustment(companyId: string, fiscalYear: number, adjustment: number, updatedBy: string) {
  return prisma.manpowerHeadcountAdjustment.upsert({
    where: { companyId_fiscalYear: { companyId, fiscalYear } },
    update: { adjustment, updatedBy },
    create: { companyId, fiscalYear, adjustment, updatedBy },
  });
}

export async function getManpowerHeadcountByRank(fiscalYear: number) {
  // Per user request: every company gets a column here (including the
  // "...Project" entities and Outsourced), not just OCC/OCLP/OLC.
  const companies = await prisma.company.findMany({ orderBy: { name: "asc" } });
  const rows = await prisma.manpowerHeadcountByRank.findMany({ where: { fiscalYear } });
  const rowMap = new Map(rows.map((r) => [`${r.level}:${r.companyId}`, r.headcount]));

  const cells = [];
  for (let level = 1; level <= 12; level++) {
    for (const company of companies) {
      cells.push({
        level,
        companyId: company.id,
        companyCode: company.code,
        headcount: rowMap.get(`${level}:${company.id}`) ?? 0,
      });
    }
  }
  return { companies, cells };
}

/**
 * Recomputes ManpowerRosterSummary for one company from the manually-entered
 * ManpowerHeadcountByRank x ManpowerSalaryLevel tables (Notes_5's "Computed
 * Monthly Salary" sheet: sum over ranks of headcount x per-rank rate).
 */
async function recomputeRosterFromRanks(companyId: string, fiscalYear: number, uploadedById: string) {
  const [byRank, salaryLevels] = await Promise.all([
    prisma.manpowerHeadcountByRank.findMany({ where: { companyId, fiscalYear } }),
    prisma.manpowerSalaryLevel.findMany(),
  ]);
  const levelMap = new Map(salaryLevels.map((l) => [l.level, l]));

  let headcount = 0;
  let basicPay = 0;
  let sss = 0;
  let pagibig = 0;
  let philhealth = 0;
  for (const row of byRank) {
    const level = levelMap.get(row.level);
    if (!level || row.headcount <= 0) continue;
    headcount += row.headcount;
    basicPay += row.headcount * level.avgSalary;
    sss += row.headcount * level.sssER;
    pagibig += row.headcount * level.pagibigER;
    philhealth += row.headcount * level.philhealthER;
  }

  await prisma.manpowerRosterSummary.upsert({
    where: { companyId_fiscalYear: { companyId, fiscalYear } },
    update: {
      headcount,
      basicPayMonthly: basicPay,
      sssMonthly: sss,
      pagibigMonthly: pagibig,
      philhealthMonthly: philhealth,
      sourceFileRef: "Manual entry (Headcount per Company)",
      uploadedById,
    },
    create: {
      companyId,
      fiscalYear,
      headcount,
      basicPayMonthly: basicPay,
      sssMonthly: sss,
      pagibigMonthly: pagibig,
      philhealthMonthly: philhealth,
      sourceFileRef: "Manual entry (Headcount per Company)",
      uploadedById,
    },
  });
}

function requireSubmissionStage(actual: ManpowerSubmissionStage, expected: ManpowerSubmissionStage) {
  if (actual !== expected) {
    throw new HttpError(409, `Manpower budget is at stage ${actual}, expected ${expected}.`);
  }
}

export async function submitManpowerBudget(fiscalYear: number, userId: string) {
  const submission = await prisma.manpowerBudgetSubmission.findUniqueOrThrow({ where: { fiscalYear } });
  requireSubmissionStage(submission.stage, ManpowerSubmissionStage.HR_ANALYST_DRAFT);
  return prisma.manpowerBudgetSubmission.update({
    where: { fiscalYear },
    data: { stage: ManpowerSubmissionStage.HR_HEAD_REVIEW, submittedById: userId },
  });
}

export async function hrHeadDecideManpowerBudget(fiscalYear: number, decision: "APPROVE" | "RETURN") {
  const submission = await prisma.manpowerBudgetSubmission.findUniqueOrThrow({ where: { fiscalYear } });
  requireSubmissionStage(submission.stage, ManpowerSubmissionStage.HR_HEAD_REVIEW);
  return prisma.manpowerBudgetSubmission.update({
    where: { fiscalYear },
    data: { stage: decision === "APPROVE" ? ManpowerSubmissionStage.BUDGET_OFFICER_REVIEW : ManpowerSubmissionStage.HR_ANALYST_DRAFT },
  });
}

export async function budgetOfficerDecideManpowerBudget(fiscalYear: number, decision: "RETURN" | "UPLOAD_TO_SAP") {
  const submission = await prisma.manpowerBudgetSubmission.findUniqueOrThrow({ where: { fiscalYear } });
  requireSubmissionStage(submission.stage, ManpowerSubmissionStage.BUDGET_OFFICER_REVIEW);

  if (decision === "RETURN") {
    return { submission: await prisma.manpowerBudgetSubmission.update({ where: { fiscalYear }, data: { stage: ManpowerSubmissionStage.HR_ANALYST_DRAFT } }) };
  }

  const sapResult = await uploadCostCenterPlanning([]);
  const submissionUpdated = await prisma.manpowerBudgetSubmission.update({
    where: { fiscalYear },
    data: { stage: ManpowerSubmissionStage.UPLOADED_TO_SAP, sapDocumentNumber: sapResult.documentNumber },
  });
  return { submission: submissionUpdated, sapResult };
}
