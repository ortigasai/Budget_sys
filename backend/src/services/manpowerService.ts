import ExcelJS from "exceljs";
import { HeadcountRequestStage, ManpowerSubmissionStage } from "@prisma/client";
import { prisma } from "../prisma";
import { HttpError } from "../httpError";
import { sumMonthlyForecast } from "./budgetCalcService";
import { pullManpowerActuals, uploadCostCenterPlanning } from "./sapMockAdapter";

async function getAsOfMonth() {
  const config = await prisma.fiscalCycleConfig.findUnique({ where: { id: "singleton" } });
  return config?.asOfMonth2026 ?? 9;
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
 * Additional Headcount Request $ attribution (Notes_4): for approved
 * requests, Basic Pay/Guaranteed Bonus/Gov't Contributions are computed via
 * the rank/level lookup against ManpowerSalaryLevel (the uploaded Template's
 * "Average Salary" sheet); every other component is HR-Analyst-manual
 * (ManpowerEntry.additionalHeadcountManual).
 */
async function resolveAdditionalHeadcountByComponent(fiscalYear: number): Promise<Map<string, number>> {
  const [approved, salaryLevels, payComponents, asOfMonth] = await Promise.all([
    prisma.additionalHeadcountRequest.findMany({ where: { currentStage: HeadcountRequestStage.APPROVED } }),
    prisma.manpowerSalaryLevel.findMany(),
    prisma.payComponent.findMany({
      where: { name: { in: [...Object.keys(SALARY_LEVEL_FIELD_BY_COMPONENT), "Guaranteed Bonus"] } },
    }),
    getAsOfMonth(),
  ]);
  const levelMap = new Map(salaryLevels.map((l) => [l.level, l]));
  const componentByName = new Map(payComponents.map((p) => [p.name, p]));
  const remainingMonths = 12 - asOfMonth;

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
      add(pc.id, req.companyId, monthlyRate * remainingMonths);
    }
    if (guaranteedBonus) {
      add(guaranteedBonus.id, req.companyId, level.avgSalary * 2);
    }
  }

  return result;
}

export async function getManpowerGrid(fiscalYear: number) {
  const [payComponents, companies, entries, rosterSummaries, additionalByCompany, meritRate, ahrByCell] = await Promise.all([
    prisma.payComponent.findMany({ orderBy: { sortOrder: "asc" } }),
    prisma.company.findMany({ orderBy: { name: "asc" } }),
    prisma.manpowerEntry.findMany({ where: { fiscalYear } }),
    prisma.manpowerRosterSummary.findMany({ where: { fiscalYear } }),
    approvedHeadcountByCompany(),
    getMeritRate(fiscalYear),
    resolveAdditionalHeadcountByComponent(fiscalYear),
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

      const budget = totalActualForecast + meritAmount + otherIncrease + additionalHeadcountAmount;
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
    return {
      companyId: c.id,
      companyCode: c.code,
      baseHeadcount,
      additionalHeadcountCount,
      effectiveHeadcount: baseHeadcount + additionalHeadcountCount,
    };
  });

  return { companies, rows, headcountRow, asOfMonth: await getAsOfMonth(), meritRate };
}

/**
 * Notes_5: the simplified "Dashboard Report" - just the 5 Salary-category
 * rows (Basic Pay, Guaranteed Bonus, 3 Gov't Contributions) + a Total row,
 * optionally scoped to one company (summed across all companies otherwise).
 * Reuses getManpowerGrid's already-computed cells rather than recomputing.
 */
export async function getManpowerDashboardSummary(fiscalYear: number, companyId?: string) {
  const grid = await getManpowerGrid(fiscalYear);
  const salaryRows = grid.rows.filter((r) => SALARY_COMPONENT_NAMES.includes(r.payComponent.name));

  const rowFor = (row: (typeof salaryRows)[number]) => {
    const cells = companyId ? row.cells.filter((c) => c.companyId === companyId) : row.cells;
    const sum = (f: (c: (typeof cells)[number]) => number) => cells.reduce((s, c) => s + f(c), 0);
    const totalActualForecast = sum((c) => c.totalActualForecast);
    const budget = sum((c) => c.budget);
    return {
      payComponentId: row.payComponent.id,
      payComponentName: row.payComponent.name,
      ytdActual: sum((c) => c.ytdActual),
      remainingForecast: sum((c) => c.remainingForecast),
      totalActualForecast,
      meritAmount: sum((c) => c.meritAmount),
      additionalHeadcountAmount: sum((c) => c.additionalHeadcountAmount),
      budget,
      budgetVsPriorAmount: budget - totalActualForecast,
      budgetVsPriorPercent: totalActualForecast > 0 ? (budget - totalActualForecast) / totalActualForecast : 0,
    };
  };

  const rows = salaryRows.map(rowFor);
  const totalActualForecast = rows.reduce((s, r) => s + r.totalActualForecast, 0);
  const totalBudget = rows.reduce((s, r) => s + r.budget, 0);
  const total = {
    ytdActual: rows.reduce((s, r) => s + r.ytdActual, 0),
    remainingForecast: rows.reduce((s, r) => s + r.remainingForecast, 0),
    totalActualForecast,
    meritAmount: rows.reduce((s, r) => s + r.meritAmount, 0),
    additionalHeadcountAmount: rows.reduce((s, r) => s + r.additionalHeadcountAmount, 0),
    budget: totalBudget,
    budgetVsPriorAmount: totalBudget - totalActualForecast,
    budgetVsPriorPercent: totalActualForecast > 0 ? (totalBudget - totalActualForecast) / totalActualForecast : 0,
  };

  return { companyId: companyId ?? null, rows, total };
}

/**
 * "Run Manpower Budget" (Notes_4): pulls SAP-mock YTD actuals for every
 * (payComponent, company), then auto-fills Remaining Months Forecast for the
 * roster-driven components (Basic Pay, Guaranteed Bonus, Government
 * Contributions) from the uploaded ManpowerRosterSummary - Basic
 * Pay/Contributions = monthly rate x remaining months, Guaranteed Bonus = 2x
 * monthly Basic Pay (flat, "2 months of basic salary"). Every other
 * component/company stays HR-Analyst-manual.
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
  const guaranteedBonus = payComponents.find((p) => p.name === "Guaranteed Bonus");

  for (const pc of payComponents) {
    for (const company of companies) {
      const roster = rosterMap.get(company.id);
      const headcount = roster?.headcount ?? 0;
      const ytdActual = await pullManpowerActuals(pc.name, headcount, asOfMonth);

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

  return getManpowerGrid(fiscalYear);
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

// Employee List "Company" column uses full legal-entity names; maps onto the
// existing Company.code values (importExpenseLineItems.ts).
const TEMPLATE_COMPANY_NAME_TO_CODE: Record<string, string> = {
  "Ortigas & Company, Limited Partnership": "OCLP",
  "Ortigas Commercial Corporation": "OCC",
  "Ortigas Land Corporation": "OLC",
  OUTSOURCED: "OUTSOURCED",
};

interface TemplateValidationError {
  sheet: string;
  row: number;
  error: string;
}

/**
 * Parses the uploaded Manpower Template (Employee List + Average Salary
 * sheets). All-or-nothing: any row with a blank "to be filled-out by HR"
 * cell rejects the whole upload (Notes_4: "Block upload if to be filled-out
 * by HR columns are empty"). On success, upserts ManpowerSalaryLevel and
 * aggregates the roster into ManpowerRosterSummary per company.
 */
export async function parseManpowerTemplate(
  buffer: Buffer,
  fiscalYear: number,
  uploadedById: string,
  sourceFileRef: string
) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as unknown as ArrayBuffer);

  const employeeSheet = workbook.getWorksheet("Employee List");
  const salarySheet = workbook.getWorksheet("Average Salary");
  if (!employeeSheet || !salarySheet) {
    throw new HttpError(400, 'Workbook must contain "Employee List" and "Average Salary" sheets.');
  }

  const errors: TemplateValidationError[] = [];

  // ---- Average Salary: Level(col1) -> avgSalary/sssER/pagibigER/philhealthER (cols 2-5) ----
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
      errors.push({ sheet: "Average Salary", row: r, error: `Level ${level}: Average Salary / contribution columns must all be filled out.` });
      continue;
    }
    levelRows.push({ level, avgSalary, sssER, pagibigER, philhealthER });
  }

  // Fetched up front so the Employee List loop can also accept a company
  // code directly (newer Template revisions use short codes like "OCC"
  // instead of the full legal name).
  const companies = await prisma.company.findMany();
  const companyByCode = new Map(companies.map((c) => [c.code, c]));
  const validCodes = new Set(companies.map((c) => c.code));

  // ---- Employee List: Company(col1), Level(col2) -> XLOOKUP'd amounts ----
  const employeeRows: { company: string; level: number }[] = [];
  for (let r = 8; r <= employeeSheet.rowCount; r++) {
    const row = employeeSheet.getRow(r);
    const companyText = cellText(row.getCell(1));
    const levelValue = cellNumber(row.getCell(2));
    if (!companyText && levelValue === null) continue; // fully blank row
    if (!companyText || levelValue === null) {
      errors.push({ sheet: "Employee List", row: r, error: "Company and Level must both be filled out." });
      continue;
    }
    const code = TEMPLATE_COMPANY_NAME_TO_CODE[companyText] ?? (validCodes.has(companyText.toUpperCase()) ? companyText.toUpperCase() : undefined);
    if (!code) {
      errors.push({ sheet: "Employee List", row: r, error: `Unknown company "${companyText}".` });
      continue;
    }
    employeeRows.push({ company: code, level: levelValue });
  }

  if (errors.length > 0) {
    return { ok: false as const, errors };
  }

  const levelByNumber = new Map(levelRows.map((l) => [l.level, l]));

  const perCompany = new Map<string, { headcount: number; basicPay: number; sss: number; pagibig: number; philhealth: number }>();
  // Per (company, level) headcount, so the "Fill Headcount per Company"
  // manual-entry grid can be pre-populated with the same numbers the
  // Employee List upload produced - the two should always agree.
  const perCompanyLevel = new Map<string, number>();
  for (const row of employeeRows) {
    const level = levelByNumber.get(row.level);
    if (!level) continue; // level not in Average Salary sheet - treated as not-yet-configured, skipped
    const acc = perCompany.get(row.company) ?? { headcount: 0, basicPay: 0, sss: 0, pagibig: 0, philhealth: 0 };
    acc.headcount += 1;
    acc.basicPay += level.avgSalary;
    acc.sss += level.sssER;
    acc.pagibig += level.pagibigER;
    acc.philhealth += level.philhealthER;
    perCompany.set(row.company, acc);

    const levelKey = `${row.company}:${row.level}`;
    perCompanyLevel.set(levelKey, (perCompanyLevel.get(levelKey) ?? 0) + 1);
  }

  await prisma.$transaction([
    ...levelRows.map((l) =>
      prisma.manpowerSalaryLevel.upsert({
        where: { level: l.level },
        update: { avgSalary: l.avgSalary, sssER: l.sssER, pagibigER: l.pagibigER, philhealthER: l.philhealthER },
        create: l,
      })
    ),
    ...[...perCompany.entries()].flatMap(([code, agg]) => {
      const company = companyByCode.get(code);
      if (!company) return [];
      return [
        prisma.manpowerRosterSummary.upsert({
          where: { companyId_fiscalYear: { companyId: company.id, fiscalYear } },
          update: {
            headcount: agg.headcount,
            basicPayMonthly: agg.basicPay,
            sssMonthly: agg.sss,
            pagibigMonthly: agg.pagibig,
            philhealthMonthly: agg.philhealth,
            sourceFileRef,
            uploadedById,
          },
          create: {
            companyId: company.id,
            fiscalYear,
            headcount: agg.headcount,
            basicPayMonthly: agg.basicPay,
            sssMonthly: agg.sss,
            pagibigMonthly: agg.pagibig,
            philhealthMonthly: agg.philhealth,
            sourceFileRef,
            uploadedById,
          },
        }),
      ];
    }),
    ...[...perCompanyLevel.entries()].flatMap(([key, headcount]) => {
      const [code, levelStr] = key.split(":");
      const company = companyByCode.get(code);
      if (!company) return [];
      const level = Number(levelStr);
      return [
        prisma.manpowerHeadcountByRank.upsert({
          where: { level_companyId_fiscalYear: { level, companyId: company.id, fiscalYear } },
          update: { headcount },
          create: { level, companyId: company.id, fiscalYear, headcount },
        }),
      ];
    }),
  ]);

  const batch = await prisma.manpowerTemplateUploadBatch.create({
    data: {
      uploadedById,
      fiscalYear,
      sourceFileRef,
      rowCount: employeeRows.length,
      validationErrors: [],
      status: "COMPLETED",
    },
  });

  return {
    ok: true as const,
    batch,
    levelsUpdated: levelRows.length,
    companiesUpdated: perCompany.size,
    employeesProcessed: employeeRows.length,
  };
}

export async function setMeritRate(fiscalYear: number, ratePercent: number, updatedBy: string) {
  return prisma.manpowerMeritRateConfig.upsert({
    where: { fiscalYear },
    update: { ratePercent, updatedBy },
    create: { fiscalYear, ratePercent, updatedBy },
  });
}

export async function setSalaryLevel(
  level: number,
  fields: { avgSalary: number; sssER: number; pagibigER: number; philhealthER: number }
) {
  return prisma.manpowerSalaryLevel.upsert({
    where: { level },
    update: fields,
    create: { level, ...fields },
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

export async function setHeadcountByRank(level: number, companyId: string, fiscalYear: number, headcount: number, updatedById: string) {
  await prisma.manpowerHeadcountByRank.upsert({
    where: { level_companyId_fiscalYear: { level, companyId, fiscalYear } },
    update: { headcount },
    create: { level, companyId, fiscalYear, headcount },
  });
  await recomputeRosterFromRanks(companyId, fiscalYear, updatedById);
  return getManpowerHeadcountByRank(fiscalYear);
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
