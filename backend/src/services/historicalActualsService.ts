import ExcelJS from "exceljs";
import { RequestCategory, Sbu } from "@prisma/client";
import { prisma } from "../prisma";
import { getFiscalCycle } from "../lib/fiscalCycle";
import { fetchFbl3nRows } from "../lib/sapBroker";

// Notes_6/9 (Forecast section): Budget-Officer-only bulk upload for the
// Forecast page's reference data. Matches by ExpenseLineItem.name against
// the STANDARD catalog; a name that resolves to more than one catalog row
// (a company-specific variant, e.g. "Gas Allowance") is rejected rather
// than guessed at, per user direction. Refer to
// "Budgeting System_Forecast Template.xlsx" for the exact shape: Budget
// Code (col A), Expense Category (col B), Expense Line Item (col C), CC
// (col D), GL (col E), 2026 Approved Budget (col F), 2026A-01..08 monthly
// actuals (cols G-N, unmodeled, skipped), 2026 YTD Actuals (col O), header
// row 4, data from row 5. CC/GL in the file are informational only — the
// authoritative GL/CC still comes from the catalog match, same as before.
// Budget Code and Expense Category are stored as-uploaded (not derived from
// the catalog) and are optional — the template's own sample row leaves them
// blank, since 2026 predates Budget Code existing in SAP. The remaining
// columns (Available Budget, month forecasts, totals) are Excel formulas,
// derived/display-only, and aren't part of the upload.

// The real SAP pull anticipated above now exists - see
// syncHistoricalActualsFromSap() below, keyed on CC-GL (not Budget Code,
// which SAP still doesn't carry) via the budget_kssb_v2 report. This upload
// stays available as a fallback/manual-override for the CC-GL pairs the
// sync can't auto-resolve (see that function's own doc comment).

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

interface ForecastTemplateValidationError {
  row: number;
  error: string;
}

export async function parseForecastTemplate(buffer: Buffer) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as unknown as ArrayBuffer);

  const sheet = workbook.getWorksheet("Sheet1") ?? workbook.worksheets[0];
  if (!sheet) throw new Error("Workbook has no sheets.");

  const { targetCalendarYear, forecastYear } = await getFiscalCycle();
  const catalog = await prisma.expenseLineItem.findMany({ where: { status: "STANDARD" } });
  const itemsByName = new Map<string, typeof catalog>();
  for (const item of catalog) {
    const arr = itemsByName.get(item.name) ?? [];
    arr.push(item);
    itemsByName.set(item.name, arr);
  }

  const mappings = await prisma.forecastCategoryMapping.findMany();
  const categoryByGlCc = new Map(mappings.map((m) => [`${m.glAccount}:${m.costCenter}`, m.category]));

  const errors: ForecastTemplateValidationError[] = [];
  const rows: {
    row: number;
    name: string;
    budgetCode: string | null;
    expenseCategory: string | null;
    approvedBudget: number;
    ytdActual: number;
    departmentId: string;
    glAccount: string;
    costCenter: string;
    expenseLineItemId: string;
    requestCategory: "GAE" | "DOE" | "NPC" | "REVENUE";
  }[] = [];

  for (let r = 5; r <= sheet.rowCount; r++) {
    const row = sheet.getRow(r);
    const budgetCode = cellText(row.getCell(1)) || null;
    const expenseCategory = cellText(row.getCell(2)) || null;
    const name = cellText(row.getCell(3));
    if (!name) continue; // blank row - not necessarily end of data, just skip

    const approvedBudget = cellNumber(row.getCell(6));
    const ytdActual = cellNumber(row.getCell(15));
    if (approvedBudget === null || ytdActual === null) {
      errors.push({ row: r, error: `"${name}": ${forecastYear} Approved Budget and ${forecastYear} YTD Actuals must both be filled out.` });
      continue;
    }

    const matches = itemsByName.get(name) ?? [];
    if (matches.length === 0) {
      errors.push({ row: r, error: `"${name}" doesn't match any standard expense line item in the catalog.` });
      continue;
    }
    if (matches.length > 1) {
      errors.push({
        row: r,
        error: `"${name}" matches ${matches.length} catalog items across different companies - upload one row per company GL/CC instead.`,
      });
      continue;
    }

    const item = matches[0];
    const requestCategory = categoryByGlCc.get(`${item.glAccount}:${item.costCenter}`) ?? "GAE";
    rows.push({
      row: r,
      name,
      budgetCode,
      expenseCategory,
      approvedBudget,
      ytdActual,
      departmentId: item.ownerDepartmentId,
      glAccount: item.glAccount,
      costCenter: item.costCenter,
      expenseLineItemId: item.id,
      requestCategory,
    });
  }

  // Two rows in the same upload resolving to the same catalog line item
  // would silently overwrite each other via the upsert below (per-line-item
  // now, not per-GL/CC — catalog rows may legitimately share a GL/CC, e.g.
  // "Driver"/"Messenger"/"Operator" already do), so treat that as ambiguous
  // rather than losing one row's figures.
  const rowsByItem = new Map<string, typeof rows>();
  for (const row of rows) {
    const arr = rowsByItem.get(row.expenseLineItemId) ?? [];
    arr.push(row);
    rowsByItem.set(row.expenseLineItemId, arr);
  }
  for (const group of rowsByItem.values()) {
    if (group.length > 1) {
      const names = group.map((g) => `"${g.name}"`).join(", ");
      for (const g of group) {
        errors.push({ row: g.row, error: `${names} resolve to the same expense line item - combine into one row (they'd otherwise overwrite each other).` });
      }
    }
  }

  if (errors.length > 0) {
    return { ok: false as const, errors };
  }

  let created = 0;
  let updated = 0;
  for (const row of rows) {
    const key = {
      expenseLineItemId_fiscalYear: {
        expenseLineItemId: row.expenseLineItemId,
        fiscalYear: targetCalendarYear,
      },
    };
    const existing = await prisma.historicalActuals.findUnique({ where: key });
    const data = {
      departmentId: row.departmentId,
      glAccount: row.glAccount,
      costCenter: row.costCenter,
      glDescription: row.name,
      budgetCode: row.budgetCode,
      expenseCategory: row.expenseCategory,
      requestCategory: row.requestCategory,
      approvedBudget2026: row.approvedBudget,
      ytdActuals2026: row.ytdActual,
    };
    await prisma.historicalActuals.upsert({
      where: key,
      update: data,
      create: { ...data, expenseLineItemId: row.expenseLineItemId, fiscalYear: targetCalendarYear },
    });
    if (existing) updated++;
    else created++;
  }

  return { ok: true as const, created, updated };
}

interface SyncAmbiguousPair {
  glAccount: string;
  costCenter: string;
  itemNames: string[];
}

/**
 * Real-SAP-data replacement for parseForecastTemplate() above. YTD Actuals
 * are sourced from Ortigas's SAP data broker's budget_fbl3n report (see
 * sapBroker.ts) - real per-posting G/L actuals, summed per CC-GL for periods
 * through the current as-of-month cutoff. Approved Budget comes from
 * FinalizedBudgetLine instead (Note 11's "one source of truth for approved
 * budget", the same snapshot every other "approved budget" reader in this
 * app uses) - FBL3N carries no Plan/Budget field at all, so this was already
 * forced, and it aligns Forecast with everything else rather than inventing
 * a second live-SAP budget source.
 *
 * Matching is CC-GL only, same limitation as the upload path but without a
 * name to disambiguate with: ExpenseLineItem has no unique constraint on
 * (glAccount, costCenter) - catalog rows can legitimately share one pair
 * (e.g. Driver/Messenger/Operator, broken out via extraFieldsConfig
 * headcount tables instead of separate codes). SAP only reports spend per
 * GL-CC, with no way to tell which of several catalog rows sharing that pair
 * it belongs to, so a pair matching more than one STANDARD catalog item is
 * skipped and reported rather than guessed at - those items keep needing
 * the manual upload above.
 */
export async function syncHistoricalActualsFromSap() {
  const { targetCalendarYear, forecastYear, asOfMonth } = await getFiscalCycle();
  const catalog = await prisma.expenseLineItem.findMany({ where: { status: "STANDARD" } });

  const itemsByGlCc = new Map<string, typeof catalog>();
  for (const item of catalog) {
    const key = `${item.glAccount}:${item.costCenter}`;
    const arr = itemsByGlCc.get(key) ?? [];
    arr.push(item);
    itemsByGlCc.set(key, arr);
  }

  // Only clean 8-digit numeric codes can ever match a real SAP ProfitCenter -
  // placeholders like "PENDING"/"TAX-GEL" (see importExpenseLineItems.ts)
  // never will, so skip padding/querying for those rather than sending a
  // guaranteed-empty filter to the broker.
  const distinctCostCenters = [...new Set(catalog.map((i) => i.costCenter))].filter((cc) => /^\d+$/.test(cc));
  const paddedCostCenters = distinctCostCenters.map((cc) => `00${cc}`);

  const mappings = await prisma.forecastCategoryMapping.findMany();
  const categoryByGlCc = new Map(mappings.map((m) => [`${m.glAccount}:${m.costCenter}`, m.category]));

  const sapRows = paddedCostCenters.length > 0 ? await fetchFbl3nRows(paddedCostCenters, forecastYear) : [];

  // YTD Actuals: sum AmountInLocalCurrency per (glAccount, costCenter) for
  // postings whose YearMonth ("YYYY/MM") month component is <= the current
  // as-of-month cutoff (matching the "already in Actuals vs. still-forecast"
  // split the Forecast page itself uses).
  const ytdActualByGlCc = new Map<string, number>();
  for (const row of sapRows) {
    const costCenter = row.ProfitCenter.replace(/^00/, "");
    const glAccount = row.GLAccount.replace(/^00/, "");
    const month = Number(row.YearMonth.split("/")[1]);
    if (!glAccount || !Number.isFinite(month) || month > asOfMonth) continue;
    const key = `${glAccount}:${costCenter}`;
    ytdActualByGlCc.set(key, (ytdActualByGlCc.get(key) ?? 0) + (Number(row.AmountInLocalCurrency) || 0));
  }

  // Approved Budget: FinalizedBudgetLine for forecastYear (the fiscal year
  // this reference data is *for* - e.g. 2026's own finalized budget, not the
  // 2027 ask being prepared), summed per (glAccount, costCenter).
  const finalizedLines = await prisma.finalizedBudgetLine.findMany({ where: { fiscalYear: forecastYear } });
  const approvedBudgetByGlCc = new Map<string, number>();
  for (const line of finalizedLines) {
    const key = `${line.glAccount}:${line.costCenter}`;
    approvedBudgetByGlCc.set(key, (approvedBudgetByGlCc.get(key) ?? 0) + line.amount);
  }

  const glCcKeys = new Set([...ytdActualByGlCc.keys(), ...approvedBudgetByGlCc.keys()]);

  const ambiguous: SyncAmbiguousPair[] = [];
  let created = 0;
  let updated = 0;
  let unmatchedCostCenters = 0;

  for (const key of glCcKeys) {
    const [glAccount, costCenter] = key.split(":");
    const matches = itemsByGlCc.get(key) ?? [];
    if (matches.length === 0) {
      unmatchedCostCenters++;
      continue;
    }
    if (matches.length > 1) {
      ambiguous.push({ glAccount, costCenter, itemNames: matches.map((m) => m.name) });
      continue;
    }

    const item = matches[0];
    const requestCategory = categoryByGlCc.get(key) ?? "GAE";
    const upsertKey = { expenseLineItemId_fiscalYear: { expenseLineItemId: item.id, fiscalYear: targetCalendarYear } };
    const existing = await prisma.historicalActuals.findUnique({ where: upsertKey });
    const data = {
      departmentId: item.ownerDepartmentId,
      glAccount: item.glAccount,
      costCenter: item.costCenter,
      glDescription: item.name,
      budgetCode: item.budgetCode,
      expenseCategory: item.category,
      requestCategory,
      approvedBudget2026: approvedBudgetByGlCc.get(key) ?? 0,
      ytdActuals2026: ytdActualByGlCc.get(key) ?? 0,
    };
    await prisma.historicalActuals.upsert({
      where: upsertKey,
      update: data,
      create: { ...data, expenseLineItemId: item.id, fiscalYear: targetCalendarYear },
    });
    if (existing) updated++;
    else created++;
  }

  return { ok: true as const, created, updated, unmatchedCostCenters, ambiguous };
}

// Note 11 §9 - "Open Spreadsheet Template" for GAE/DOE Forecast (Revenue
// shares this builder too - see routes/forecast.ts). Not a real SAP pull
// (the FUTURE WORK note above still stands) - a live-generated version of
// the same "Budgeting System_Forecast Template.xlsx" shape parseForecastTemplate
// already expects, pre-populated with this department's current
// HistoricalActuals rows for the category, so a Requestor edits and
// re-uploads instead of retyping every CC-GL row from scratch. Column
// positions (F=Approved Budget, O=YTD Actuals) match the parser exactly;
// G-N ("Actual" monthly breakdown) are left blank for the user to fill in -
// the parser never reads them, only F and O, so no data is fabricated by
// leaving them empty. Gated to fiscal year 2027+ by the caller (2026 keeps
// only the plain upload flow).
export async function buildForecastTemplateWorkbook(departmentId: string, category: RequestCategory) {
  const { targetCalendarYear, forecastYear } = await getFiscalCycle();
  const department = await prisma.department.findUniqueOrThrow({ where: { id: departmentId } });
  const rows = await prisma.historicalActuals.findMany({
    where: { departmentId, fiscalYear: targetCalendarYear, requestCategory: category },
    orderBy: { glDescription: "asc" },
  });

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(category);

  sheet.getCell("A1").value = "Calendar Year";
  sheet.getCell("B1").value = forecastYear;
  sheet.getCell("A2").value = "SBU";
  if (category === RequestCategory.GAE) {
    sheet.getCell("B2").value = "Corporate";
  } else if (category === RequestCategory.REVENUE) {
    // Informational only (the parser never reads row 2) - a dropdown of the
    // 5 real-estate SBUs rather than a fixed label, per the note.
    sheet.getCell("B2").dataValidation = { type: "list", allowBlank: true, formulae: [`"${Object.values(Sbu).join(",")}"`] };
  } else {
    sheet.getCell("B2").value = department.sbu ?? "";
  }
  sheet.getCell("A1").font = { bold: true };
  sheet.getCell("A2").font = { bold: true };

  sheet.mergeCells("G3:O3");
  sheet.getCell("G3").value = "Actual";
  sheet.getCell("G3").alignment = { horizontal: "center" };

  const headerRow = category === RequestCategory.REVENUE
    ? ["Budget Code", "Revenue Category", "Revenue Line Item", "CC", "GL", "Approved Budget", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "YTD Actuals", "Available Budget"]
    : ["Budget Code", "Expense Category", "Expense Line Item", "CC", "GL", "Approved Budget", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "YTD Actuals", "Available Budget"];
  sheet.getRow(4).values = headerRow;
  sheet.getRow(4).font = { bold: true };

  rows.forEach((r, i) => {
    const rowNumber = 5 + i;
    const row = sheet.getRow(rowNumber);
    row.getCell(1).value = r.budgetCode ?? null;
    row.getCell(2).value = r.expenseCategory ?? null;
    row.getCell(3).value = r.glDescription;
    row.getCell(4).value = r.costCenter;
    row.getCell(5).value = r.glAccount;
    row.getCell(6).value = r.approvedBudget2026;
    row.getCell(15).value = r.ytdActuals2026;
    row.getCell(16).value = { formula: `F${rowNumber}-O${rowNumber}` } as any;
  });

  [12.5, 15.5, 16.2, 16.2, 12, 19.9, 10, 10, 10, 10, 10, 10, 10, 10, 15.5, 19.5].forEach((w, i) => {
    sheet.getColumn(i + 1).width = w;
  });

  return workbook;
}
