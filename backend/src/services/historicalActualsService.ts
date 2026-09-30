import ExcelJS from "exceljs";
import { RequestCategory, Sbu } from "@prisma/client";
import { prisma } from "../prisma";
import { getFiscalCycle } from "../lib/fiscalCycle";
import { fetchFbl3nCache } from "../lib/pyBackendClient";

// Notes_6/9 (Forecast section): Budget-Officer-only bulk upload for the
// Forecast page's reference data. Matches by ExpenseLineItem.name against
// the STANDARD catalog - case/punctuation-insensitive (a real upload had
// "Jobstreet Subscription" against the catalog's "JOBSTREET Subscription",
// and "PMAP - People Management..." against "PMAP People Management...",
// same name otherwise). A name that resolves to more than one catalog row
// is narrowed by the row's own Expense Category first (most of these are
// the same name reused under different categories - "Others" under
// "Office Supplies - HQ" vs "Office Supplies - Non HQ" - and the file
// already carries that column), then by CC/GL. If more than one row still
// remains, it's a genuine same-category, multi-company duplicate (e.g.
// "Meetings", one row per company) - per user direction these are merged,
// not rejected: the upload's total lands on one deterministically-chosen
// row of the group, and the Forecast table's own (Expense Category,
// Expense Line Item) grouping (see routes/forecast.ts) displays it
// together with that group's other company rows, so nothing is lost by
// not splitting the upload's number across companies it can't tell apart.
// See resolveCatalogMatch below for the exact narrowing order.
//
// Column layout is read from the header row itself (whichever row has
// "Budget Code" in column A, scanned within the first few rows), not fixed
// positions — this file's shape has changed more than once as the user's
// real source data evolved (e.g. "Budgeting System_Forecast Upload.xlsx"'s
// "Upload Template" tab: Budget Code/Type/Sub Type/Expense Category/
// Expense Line Item/CC/GL/Approved 2026B/2026A-01.."2026A-08" (actuals,
// summed for YTD)/2026F-09.."2026F-12" (remaining-months forecast, keyed by
// the month number in the header)/2026F (full-year total, ignored) — a
// completely different shape from the app's own "Open/Download Template"
// output (Budget Code/Expense Category/Expense Line Item/CC/GL/Approved
// Budget/Jan-Aug (actual, unmodeled)/YTD Actuals/Available Budget/remaining
// month names, fixed positions per buildForecastTemplateWorkbook below).
// Recognized headers, wherever they land:
//   - Budget Code / Expense Category / Revenue Category / Expense Line Item
//     / Revenue Line Item / CC / GL — by exact (case-insensitive) label.
//   - Approved Budget — any header starting with "approved".
//   - YTD Actuals — an explicit "...ytd..." column if present; otherwise
//     summed from any "<year>A-<month>" columns; otherwise 0.
//   - Remaining Months Forecast — any "<year>F-<month>" columns, keyed by
//     that literal month number; otherwise falls back to the old shape's
//     fixed position (REMAINING_MONTHS_START_COL, driven by asOfMonth),
//     since bare month names alone ("Jan" vs "Sep") can't tell an actual
//     column from a forecast one.
// If the sheet named "Upload Template" exists, it's used (uploads built
// from real SAP-derived data, not this app's own generator); otherwise the
// first sheet is used, same as before. Budget Code and Expense Category are
// always stored as-uploaded (not derived from the catalog) and optional.

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function remainingMonthColumns(asOfMonth: number): number[] {
  return Array.from({ length: 12 - asOfMonth }, (_, i) => asOfMonth + 1 + i);
}
const REMAINING_MONTHS_START_COL = 17; // Q - after Budget Code..Available Budget (A-P)

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

// Case/punctuation-insensitive comparison key for catalog/upload name and
// category matching - collapses any run of dashes/whitespace to a single
// space so "PMAP - People Management..." and "PMAP People Management..."
// (same item, different separator) compare equal, on top of the plain
// case-folding "JOBSTREET Subscription" vs "Jobstreet Subscription" needs.
function normalizeMatchKey(s: string): string {
  return s.trim().toLowerCase().replace(/[-\s]+/g, " ");
}

// CC/GL columns in the real-data shape are stored as numbers (80123102),
// not text - cellText would format that fine, but cellNumber's own
// Number.isFinite check needs a value to compare, not the exact string, so
// this normalizes either representation to the plain-digit string the
// catalog's own glAccount/costCenter columns use.
function cellCode(cell: ExcelJS.Cell): string {
  const v = cell.value as unknown;
  if (v === null || v === undefined || v === "") return "";
  if (typeof v === "number") return String(Math.round(v));
  return cellText(cell);
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

  // Prefer a sheet literally named "Upload Template" (the real-data shape,
  // e.g. "Budgeting System_Forecast Upload.xlsx") over worksheets[0] - a
  // file built from real source data tends to carry other tabs too (a raw
  // "Sheet1" export, a details/breakdown tab), and position alone can't
  // tell those apart from the real upload sheet. Falls back to the first
  // sheet, same as before, when no tab has that name (the app's own
  // "Open/Download Template" output, named after the category).
  const sheet =
    workbook.worksheets.find((s) => s.name.trim().toLowerCase() === "upload template") ?? workbook.worksheets[0];
  if (!sheet) throw new Error("Workbook has no sheets.");

  const { targetCalendarYear, forecastYear, asOfMonth } = await getFiscalCycle();
  const remainingMonths = remainingMonthColumns(asOfMonth);
  const catalog = await prisma.expenseLineItem.findMany({ where: { status: "STANDARD" } });
  const itemsByName = new Map<string, typeof catalog>();
  for (const item of catalog) {
    const key = normalizeMatchKey(item.name);
    const arr = itemsByName.get(key) ?? [];
    arr.push(item);
    itemsByName.set(key, arr);
  }

  const mappings = await prisma.forecastCategoryMapping.findMany();
  const categoryByGlCc = new Map(mappings.map((m) => [`${m.glAccount}:${m.costCenter}`, m.category]));

  // Header row - whichever of the first few rows has "Budget Code" in
  // column A. Both known shapes put it there; this is what lets the rest of
  // the column layout be read from the header text instead of assumed.
  let headerRowIdx = -1;
  for (let r = 1; r <= Math.min(10, sheet.rowCount); r++) {
    if (cellText(sheet.getRow(r).getCell(1)).toLowerCase() === "budget code") {
      headerRowIdx = r;
      break;
    }
  }
  if (headerRowIdx === -1) throw new Error(`Could not find a "Budget Code" header row in "${sheet.name}".`);

  let budgetCodeCol = -1;
  let expenseCategoryCol = -1;
  let nameCol = -1;
  let ccCol = -1;
  let glCol = -1;
  let approvedCol = -1;
  let ytdCol = -1;
  const actualMonthCols: number[] = [];
  const forecastMonthCols = new Map<number, number>(); // month (1-12) -> column
  const headerCells = sheet.getRow(headerRowIdx);
  for (let c = 1; c <= headerCells.cellCount; c++) {
    const label = cellText(headerCells.getCell(c)).trim().toLowerCase();
    if (!label) continue;
    if (label === "budget code") budgetCodeCol = c;
    else if (label === "expense category" || label === "revenue category") expenseCategoryCol = c;
    else if (label === "expense line item" || label === "revenue line item") nameCol = c;
    else if (label === "cc") ccCol = c;
    else if (label === "gl") glCol = c;
    else if (label.startsWith("approved")) approvedCol = c;
    else if (label.includes("ytd")) ytdCol = c;
    else {
      const actualMatch = label.match(/^\d{4}a-(\d{2})$/);
      const forecastMatch = label.match(/^\d{4}f-(\d{2})$/);
      if (actualMatch) actualMonthCols.push(c);
      else if (forecastMatch) forecastMonthCols.set(Number(forecastMatch[1]), c);
    }
  }
  if (nameCol === -1 || approvedCol === -1) {
    throw new Error(`"${sheet.name}" is missing an "Expense Line Item"/"Revenue Line Item" or "Approved..." column.`);
  }

  // See the function-level comment above for the narrowing order and why
  // remaining ambiguity is merged (onto one deterministically-chosen row)
  // rather than rejected.
  function resolveCatalogMatch(
    name: string,
    fileCategory: string | null,
    rowCc: string,
    rowGl: string
  ): { item: (typeof catalog)[number] } | { error: string } {
    let matches = itemsByName.get(normalizeMatchKey(name)) ?? [];
    if (matches.length === 0) {
      return { error: `"${name}" doesn't match any standard expense line item in the catalog.` };
    }
    if (matches.length > 1 && fileCategory) {
      const byCategory = matches.filter((m) => normalizeMatchKey(m.category) === normalizeMatchKey(fileCategory));
      if (byCategory.length > 0) matches = byCategory;
    }
    if (matches.length > 1 && rowCc && rowGl) {
      const byGlCc = matches.filter((m) => m.costCenter === rowCc && m.glAccount === rowGl);
      if (byGlCc.length > 0) matches = byGlCc;
    }
    if (matches.length > 1) {
      matches = [matches.slice().sort((a, b) => a.id.localeCompare(b.id))[0]];
    }
    return { item: matches[0] };
  }

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
    requestCategory: RequestCategory;
    monthlyRemainingForecast: Record<string, number>;
  }[] = [];

  for (let r = headerRowIdx + 1; r <= sheet.rowCount; r++) {
    const row = sheet.getRow(r);
    const name = cellText(row.getCell(nameCol));
    if (!name) continue; // blank row - not necessarily end of data, just skip

    const budgetCode = budgetCodeCol > 0 ? cellText(row.getCell(budgetCodeCol)) || null : null;
    const expenseCategory = expenseCategoryCol > 0 ? cellText(row.getCell(expenseCategoryCol)) || null : null;

    const approvedBudget = cellNumber(row.getCell(approvedCol));
    if (approvedBudget === null) {
      errors.push({ row: r, error: `"${name}": ${forecastYear} Approved Budget must be filled out.` });
      continue;
    }

    // YTD Actuals: an explicit column if the sheet has one, else summed
    // from the year-numbered actual-month columns (the real-data shape has
    // no single YTD cell - it's implicit in the monthly actuals), else 0.
    let ytdActual = 0;
    if (ytdCol > 0) {
      const v = cellNumber(row.getCell(ytdCol));
      if (v === null) {
        errors.push({ row: r, error: `"${name}": ${forecastYear} YTD Actuals must be filled out.` });
        continue;
      }
      ytdActual = v;
    } else {
      for (const c of actualMonthCols) ytdActual += cellNumber(row.getCell(c)) ?? 0;
    }

    // Remaining Months Forecast - optional per month; a blank cell leaves
    // that month's already-saved value untouched (see the merge-with-
    // existing logic below) rather than zeroing it out. Uses the sheet's own
    // year-numbered forecast columns when present, else falls back to the
    // fixed position the app's own template always uses (bare month names
    // there can't otherwise be told apart from the equally bare "Jan".."Aug"
    // actual columns that precede them).
    let monthCellError = false;
    const monthlyRemainingForecast: Record<string, number> = {};
    const forecastColsThisRow: [number, number][] =
      forecastMonthCols.size > 0
        ? [...forecastMonthCols.entries()]
        : remainingMonths.map((m, i) => [m, REMAINING_MONTHS_START_COL + i]);
    for (const [m, c] of forecastColsThisRow) {
      const cell = row.getCell(c);
      if (cell.value === null || cell.value === undefined || cell.value === "") continue;
      const value = cellNumber(cell);
      if (value === null) {
        errors.push({ row: r, error: `"${name}": the value for ${MONTH_NAMES[m - 1]} isn't a number.` });
        monthCellError = true;
        continue;
      }
      monthlyRemainingForecast[String(m)] = value;
    }
    if (monthCellError) continue;

    const rowCc = ccCol > 0 ? cellCode(row.getCell(ccCol)) : "";
    const rowGl = glCol > 0 ? cellCode(row.getCell(glCol)) : "";
    const resolved = resolveCatalogMatch(name, expenseCategory, rowCc, rowGl);
    if ("error" in resolved) {
      errors.push({ row: r, error: resolved.error });
      continue;
    }

    const item = resolved.item;
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
      monthlyRemainingForecast,
    });
  }

  // Two or more rows in the same upload resolving to the same catalog line
  // item (same Expense Category/Line Item/CC/GL - CC/GL both come from the
  // one matched catalog row, so any rows sharing an expenseLineItemId
  // necessarily share those too) are consolidated into a single combined
  // row - summing Approved Budget/YTD Actuals/each Remaining Month - rather
  // than rejected. Real data sometimes genuinely arrives split across
  // several rows for the same line item (e.g. one per sub-unit sharing the
  // same GL-CC), and per user direction those should be added together
  // instead of requiring the file to be hand-edited into one row first.
  const rowsByItem = new Map<string, typeof rows>();
  for (const row of rows) {
    const arr = rowsByItem.get(row.expenseLineItemId) ?? [];
    arr.push(row);
    rowsByItem.set(row.expenseLineItemId, arr);
  }
  const consolidatedRows: typeof rows = [];
  for (const group of rowsByItem.values()) {
    if (group.length === 1) {
      consolidatedRows.push(group[0]);
      continue;
    }
    const monthlyRemainingForecast: Record<string, number> = {};
    for (const g of group) {
      for (const [month, value] of Object.entries(g.monthlyRemainingForecast)) {
        monthlyRemainingForecast[month] = (monthlyRemainingForecast[month] ?? 0) + value;
      }
    }
    consolidatedRows.push({
      ...group[0],
      approvedBudget: group.reduce((sum, g) => sum + g.approvedBudget, 0),
      ytdActual: group.reduce((sum, g) => sum + g.ytdActual, 0),
      monthlyRemainingForecast,
    });
  }

  // Valid rows import even when others don't (errors is reported alongside,
  // not instead of, created/updated) - a real upload can run to hundreds of
  // rows, and a handful of blank placeholder rows or uncatalogued one-off
  // names shouldn't hold the whole file's real data hostage until every one
  // of them is individually fixed. Errors are still worth surfacing so the
  // Budget Officer knows what didn't make it in.
  let created = 0;
  let updated = 0;
  for (const row of consolidatedRows) {
    const key = {
      expenseLineItemId_fiscalYear: {
        expenseLineItemId: row.expenseLineItemId,
        fiscalYear: targetCalendarYear,
      },
    };
    const existing = await prisma.historicalActuals.findUnique({ where: key });
    // Merge onto whatever was already saved rather than replacing wholesale -
    // a month left blank in this upload keeps its previously-entered value
    // (same "only touch what's given" rule the per-cell PATCH already
    // follows), so a partially-filled re-upload can't accidentally zero out
    // months a department already forecasted by hand.
    const mergedMonthlyForecast = {
      ...((existing?.monthlyRemainingForecast2026 as Record<string, number> | null) ?? {}),
      ...row.monthlyRemainingForecast,
    };
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
      monthlyRemainingForecast2026: mergedMonthlyForecast,
    };
    await prisma.historicalActuals.upsert({
      where: key,
      update: data,
      create: { ...data, expenseLineItemId: row.expenseLineItemId, fiscalYear: targetCalendarYear },
    });
    if (existing) updated++;
    else created++;
  }

  return { ok: true as const, created, updated, errors };
}

interface SyncAmbiguousPair {
  glAccount: string;
  costCenter: string;
  itemNames: string[];
}

/**
 * Real-SAP-data replacement for parseForecastTemplate() above. YTD Actuals
 * are sourced from Ortigas's SAP data broker's budget_fbl3n report, read via
 * the Python backend's local raw cache (see pyBackendClient.ts's
 * fetchFbl3nCache, backend-py's sap_raw_sync_service.py) instead of calling
 * the broker directly - Utilization Tracking's own sync already needs this
 * exact same report, so both now read one shared, pre-fetched copy instead
 * of each hitting the broker independently. Real per-posting G/L actuals,
 * summed per CC-GL for periods through the current as-of-month cutoff.
 * Approved Budget comes from
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

  const mappings = await prisma.forecastCategoryMapping.findMany();
  const categoryByGlCc = new Map(mappings.map((m) => [`${m.glAccount}:${m.costCenter}`, m.category]));

  // YTD Actuals: sum per (glAccount, costCenter) for postings through the
  // current as-of-month cutoff (matching the "already in Actuals vs.
  // still-forecast" split the Forecast page itself uses) - Python sums this
  // in SQL (see sap_cache.py's fbl3n_cache) rather than returning every raw
  // posting for Node to sum here; rows are already unpadded/normalized, and
  // cover every admin Cost Center (a superset of this catalog's own cost
  // centers) - the itemsByGlCc lookup below naturally ignores whatever
  // doesn't match.
  const cacheRows = await fetchFbl3nCache(forecastYear, asOfMonth);
  const ytdActualByGlCc = new Map<string, number>();
  for (const row of cacheRows) {
    const key = `${row.glAccount}:${row.costCenter}`;
    ytdActualByGlCc.set(key, (ytdActualByGlCc.get(key) ?? 0) + row.amount);
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
    // Deliberately not item.budgetCode - Budget Code didn't exist in SAP yet
    // for 2026 (per the field's own "FY2026-frozen" comment below, and the
    // Forecast Template's own sample row, which leaves this column blank),
    // so there's no real 2026 code to show. item.budgetCode is the catalog's
    // OWN code, dynamically year-stamped to the CURRENT ask cycle (e.g.
    // "AS-27-1") - fabricating a "2026" version of it by re-stamping the
    // year was still a fabricated code, not a real one, so this field is
    // left alone entirely: never set on create (stays null) and never
    // touched on update (preserves whatever a manual upload may have put
    // there, on the rare row where one legitimately exists).
    const data: { departmentId: string; glAccount: string; costCenter: string; glDescription: string; expenseCategory: string; requestCategory: RequestCategory; ytdActuals2026: number; approvedBudget2026?: number } = {
      departmentId: item.ownerDepartmentId,
      glAccount: item.glAccount,
      costCenter: item.costCenter,
      glDescription: item.name,
      expenseCategory: item.category,
      requestCategory,
      ytdActuals2026: ytdActualByGlCc.get(key) ?? 0,
    };
    // Unlike YTD Actuals (a real, live SAP source), Approved Budget has no
    // live 2026 source at all right now - FinalizedBudgetLine only ever
    // gets a 2026 row if this app's own workflow finalized a 2026 request,
    // which hasn't happened (2026 predates this app; its real approved
    // budget only ever comes from the manual Upload Completed Template).
    // Only ever set/overwrite it here when real FinalizedBudgetLine data
    // was actually found for this GL-CC - otherwise leave whatever's
    // already stored alone, so a manually-uploaded Approved Budget isn't
    // silently reset to 0 by the next 10-minute sync.
    if (approvedBudgetByGlCc.has(key)) {
      data.approvedBudget2026 = approvedBudgetByGlCc.get(key);
    }
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
  const { targetCalendarYear, forecastYear, asOfMonth } = await getFiscalCycle();
  const remainingMonths = remainingMonthColumns(asOfMonth);
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
  headerRow.push(...remainingMonths.map((m) => MONTH_NAMES[m - 1]));
  sheet.getRow(4).values = headerRow;
  sheet.getRow(4).font = { bold: true };

  if (remainingMonths.length > 0) {
    const lastCol = REMAINING_MONTHS_START_COL + remainingMonths.length - 1;
    sheet.mergeCells(3, REMAINING_MONTHS_START_COL, 3, lastCol);
    sheet.getCell(3, REMAINING_MONTHS_START_COL).value = "Remaining Months Forecast";
    sheet.getCell(3, REMAINING_MONTHS_START_COL).alignment = { horizontal: "center" };
    sheet.getCell(3, REMAINING_MONTHS_START_COL).font = { bold: true };
  }

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
    const monthlyForecast = (r.monthlyRemainingForecast2026 as Record<string, number> | null) ?? {};
    remainingMonths.forEach((m, mi) => {
      row.getCell(REMAINING_MONTHS_START_COL + mi).value = monthlyForecast[String(m)] ?? null;
    });
  });

  [12.5, 15.5, 16.2, 16.2, 12, 19.9, 10, 10, 10, 10, 10, 10, 10, 10, 15.5, 19.5].forEach((w, i) => {
    sheet.getColumn(i + 1).width = w;
  });
  remainingMonths.forEach((_, i) => {
    sheet.getColumn(REMAINING_MONTHS_START_COL + i).width = 10;
  });

  return workbook;
}
