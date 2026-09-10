import ExcelJS from "exceljs";

// Shared parsing for the "Budgeting System_Expense Line Items" catalog
// shape — used by both the one-off seed importer (backend/prisma/
// importExpenseLineItems.ts, reading the source file from disk) and the
// Admin Console's "Upload Template" button (backend/src/services/
// expenseLineItemService.ts, reading an uploaded buffer). Lives under
// backend/src so both can import it without crossing the app's tsconfig
// rootDir boundary.

export interface ExtraFieldOption {
  label: string;
  value: number | null;
}
export interface ExtraField {
  label: string;
  required: boolean;
  type: "TEXT" | "NUMBER" | "DROPDOWN";
  options?: ExtraFieldOption[];
  // Notes_8: "Those expense where users to select which month to spend –
  // allow selection of multiple months." Only meaningful on a DROPDOWN field
  // (currently just "Spend Month") — the frontend renders it as a checkbox
  // group instead of a single-value select.
  multi?: boolean;
}

export interface ParsedExpenseLineItemRow {
  category: string;
  name: string;
  companyCode: string | null;
  description: string | null;
  departmentName: string;
  costCenter: string;
  glAccount: string;
  extraFieldsConfig: ExtraField[];
  requiresMobilePolicy: boolean;
  spendGridComputation: string | null;
  spendGridFrequency: string | null;
  sampleCharges: string | null;
  // Notes_7: column L, "Visible only to (Department)" — null when the row
  // has no visibility restriction (selectable by any Requestor).
  visibleToDepartmentName: string | null;
  // Columns A/C - the CD abbreviation (e.g. "AS") and this row's per-CD
  // sequence number. The file's own column D ("Budget Code") also bakes in
  // a YY, but that's frozen to whichever year the file was last edited in
  // (currently "26") - importExpenseLineItems.ts/expenseLineItemService.ts
  // rebuild the code from these two plus the *current* Target Calendar Year
  // instead, so it always matches the live admin-set year (see
  // lib/budgetCode.ts). Null when the row's CD/Num formulas didn't resolve
  // (e.g. an unrecognized department) - those fall back to the CD lookup +
  // sequence-counter path.
  budgetCodePrefix: string | null;
  budgetCodeNum: number | null;
}

const NUMBER_FIELD_LABELS = new Set(["Headcount", "Count", "No. of Vehicle"]);

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];
const MONTH_OPTIONS: ExtraFieldOption[] = MONTHS.map((m, i) => ({ label: m, value: i + 1 }));

const USER_SELECTS_MONTH = "User to select which month";
const MOBILE_PHONE_RANK_MONTH = "Rank, Month Start";
const MOBILE_PHONE_FULL_FIELDS = "Rank, Month Start, Employee Name, Department";

// Notes_8: for any line item whose Spend Grid Frequency is "User to select
// which month," the Requestor needs a way to say which one — added as an
// extra required field on top of whatever parsing produced. Mobile Phone
// rows already get their own "Month Start" field (a different concept — the
// grid repeats from that month through December, not a single placement)
// so they're excluded here to avoid two competing month pickers.
function appendSpendMonthIfNeeded(
  fields: ExtraField[],
  spendGridFrequency: string | null | undefined,
  rawValue: string | null | undefined
): ExtraField[] {
  if (spendGridFrequency?.trim() !== USER_SELECTS_MONTH) return fields;
  if (rawValue === MOBILE_PHONE_RANK_MONTH || rawValue === MOBILE_PHONE_FULL_FIELDS) return fields;
  return [...fields, { label: "Spend Month", required: true, type: "DROPDOWN", options: MONTH_OPTIONS, multi: true }];
}

export function parseAdditionalField(
  raw: string | null,
  spendGridComputation?: string | null,
  spendGridFrequency?: string | null
): ExtraField[] {
  if (!raw || !raw.trim()) return appendSpendMonthIfNeeded([], spendGridFrequency, raw);
  const value = raw.replace(/\\_/g, "_").trim();

  // Notes_8: "Mobile Phone – Require input of Rank (same as in Additional
  // Headcount request). Automatically reflect Budget Limit based on Rank
  // chosen. Reflect Budget Limit on the monthly spend grid starting on the
  // Month Start input by the user then." The catalog no longer carries a
  // "Plan" list for Mobile Phone at all — the requested amount is now always
  // exactly the rank's tier limit (see mobile-policy-tiers), so the
  // frontend derives it from Rank + Month Start rather than a formula.
  if (value === MOBILE_PHONE_RANK_MONTH || value === MOBILE_PHONE_FULL_FIELDS) {
    const rankOptions: ExtraFieldOption[] = Array.from({ length: 10 }, (_, i) => {
      const rank = i + 3; // ranks 3-12, matching the mobile-policy-tiers range
      return { label: String(rank), value: rank };
    });
    // Notes_8 (revised): the ₱300 tier (ranks 3-4) also covers Project-Based
    // and Outsourced staff, who don't have a numeric rank. Reusing value 3/4
    // for these labels routes them through the exact same tier lookup as a
    // real rank 3 or 4 — no separate lookup path needed.
    rankOptions.push({ label: "Project-Based", value: 3 }, { label: "Outsourced", value: 4 });
    const fields: ExtraField[] = [
      { label: "Rank", required: true, type: "DROPDOWN", options: rankOptions },
      { label: "Month Start", required: true, type: "DROPDOWN", options: MONTH_OPTIONS },
    ];
    if (value === MOBILE_PHONE_FULL_FIELDS) {
      // Notes_8: "Employee Name, Department (dropdown list from Budgeting
      // System_Employee List, column J)." Options come from the real
      // employee roster (already in the User table) on the frontend rather
      // than being embedded here — Department is derived read-only from
      // whichever employee is picked, so it can't be mismatched.
      fields.push(
        { label: "Employee Name", required: true, type: "DROPDOWN", options: [] },
        { label: "Department", required: true, type: "TEXT" }
      );
    }
    return fields;
  }

  // Notes_8: "the requestor will provide the numeric data on the required
  // fields, then the system will automatically compute based on the
  // formula stated." When a Spend Grid Computation formula exists and the
  // Additional Field lists multiple comma-separated variables (e.g.
  // "Headcount, Rate per Month (w/ OT)"), split them into separate NUMBER
  // inputs the frontend's formula evaluator can plug into that formula
  // (see frontend/src/lib/spendGridFormula.ts) — instead of one combined
  // free-text field.
  if (spendGridComputation && spendGridComputation.trim() && value.includes(",")) {
    const parts = value.split(",").map((p) => p.trim()).filter(Boolean);
    if (parts.length > 1) {
      return appendSpendMonthIfNeeded(
        parts.map((label) => ({ label, required: true, type: "NUMBER" as const })),
        spendGridFrequency,
        value
      );
    }
  }

  if (value.startsWith("Plan choices")) {
    const options: ExtraFieldOption[] = [];
    const lines = value.split("\n").slice(1); // drop the "Plan choices:" header line
    for (const line of lines) {
      const optionText = line.replace(/^\d+\.\s*/, "").trim();
      if (!optionText) continue;
      if (/^others/i.test(optionText)) {
        options.push({ label: "Others (specify)", value: null });
        continue;
      }
      const pesoMatch = optionText.match(/P(?:hp)?\s?([\d,]+(?:\.\d+)?)/i);
      const amount = pesoMatch ? Number(pesoMatch[1].replace(/,/g, "")) : null;
      options.push({ label: optionText, value: amount });
    }
    // Notes item 7: rank determines the plan budget ceiling — pair the Plan
    // dropdown with a rank dropdown so the request carries both fields the
    // CFO-approval check needs (see mobilePolicyService.ts).
    const rankOptions: ExtraFieldOption[] = Array.from({ length: 10 }, (_, i) => {
      const rank = i + 3; // ranks 3-12
      return { label: String(rank), value: rank };
    });
    return [
      { label: "Employee Rank", required: true, type: "DROPDOWN", options: rankOptions },
      { label: "Plan", required: true, type: "DROPDOWN", options },
    ];
  }

  if (NUMBER_FIELD_LABELS.has(value)) {
    return appendSpendMonthIfNeeded([{ label: value, required: true, type: "NUMBER" }], spendGridFrequency, value);
  }

  return appendSpendMonthIfNeeded([{ label: value, required: true, type: "TEXT" }], spendGridFrequency, value);
}

// Unwraps an Excel formula cell to its computed string result (e.g. the
// "Budget Code" column's =A&"-"&B&"-"&C formula) - plain-value cells pass
// through as before. Mirrors historicalActualsService.ts's cellText/cellNumber
// helpers, which unwrap the same shape for a different sheet.
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

function cellNumber(cell: ExcelJS.Cell): number | null {
  const v = cell.value as unknown;
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "object" && v !== null) {
    const r = (v as any).result;
    return typeof r === "number" ? r : null;
  }
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function parseWorkbook(workbook: ExcelJS.Workbook): ParsedExpenseLineItemRow[] {
  const sheet = workbook.getWorksheet("Sheet1");
  if (!sheet) throw new Error(`Sheet1 not found in workbook`);

  const rows: ParsedExpenseLineItemRow[] = [];
  for (let r = 3; r <= sheet.rowCount; r++) {
    const row = sheet.getRow(r);
    // Columns 1-4 (CD/YY/Num/Budget Code) are new. CD (1) and Num (3) are
    // read directly; YY (2) and the pre-computed Budget Code (4, ="CD-YY-Num")
    // are NOT used - the file's own YY is frozen to whichever year it was
    // last edited in, so the code is rebuilt from CD+Num plus the *current*
    // Target Calendar Year instead (see lib/budgetCode.ts). Everything from
    // column 5 on is the original layout, shifted right by 4.
    const budgetCodePrefixRaw = cellText(row.getCell(1));
    const budgetCodeNumRaw = cellNumber(row.getCell(3));
    const category = String(row.getCell(5).value ?? "").trim();
    const name = String(row.getCell(6).value ?? "").trim();
    if (!category || !name) continue;

    // "OLCP" is a verbatim typo for "OCLP" in one row of the source catalog
    // (a genuinely separate Company row was created for it once already and
    // had to be merged away) - normalized here so it can never resurface as
    // its own Company on a future import/re-upload.
    const companyRawText = String(row.getCell(7).value ?? "").trim();
    const companyRaw = companyRawText === "OLCP" ? "OCLP" : companyRawText;
    const descriptionRaw = String(row.getCell(8).value ?? "").trim();
    const departmentName = String(row.getCell(9).value ?? "").trim();
    const costCenterRaw = row.getCell(10).value;
    const glAccountRaw = row.getCell(11).value;
    const additionalFieldRaw = row.getCell(12).value ? String(row.getCell(12).value) : null;
    const spendGridComputationRaw = String(row.getCell(13).value ?? "").trim();
    const spendGridFrequencyRaw = String(row.getCell(14).value ?? "").trim();
    const sampleChargesRaw = String(row.getCell(15).value ?? "").trim();
    const visibleToDepartmentRaw = String(row.getCell(16).value ?? "").trim();

    if (!departmentName) continue; // rows with no owning department can't be routed

    const extraFieldsConfig = parseAdditionalField(additionalFieldRaw, spendGridComputationRaw, spendGridFrequencyRaw);

    rows.push({
      category,
      name,
      companyCode: companyRaw || null,
      description: descriptionRaw || null,
      departmentName,
      costCenter: costCenterRaw ? String(costCenterRaw) : "PENDING",
      glAccount: glAccountRaw ? String(glAccountRaw) : "PENDING",
      extraFieldsConfig,
      // Keyed off the category itself now, not "has a DROPDOWN field" — the
      // "Spend Month" field (added to any "User to select which month" row)
      // is also a DROPDOWN and would otherwise false-trigger the Mobile
      // Phone info banner on unrelated line items.
      requiresMobilePolicy: category === "Mobile Phone",
      spendGridComputation: spendGridComputationRaw || null,
      spendGridFrequency: spendGridFrequencyRaw || null,
      sampleCharges: sampleChargesRaw || null,
      visibleToDepartmentName: visibleToDepartmentRaw || null,
      budgetCodePrefix: budgetCodePrefixRaw || null,
      budgetCodeNum: budgetCodeNumRaw,
    });
  }
  return rows;
}

export async function parseExpenseLineItemsFile(filePath: string): Promise<ParsedExpenseLineItemRow[]> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);
  return parseWorkbook(workbook);
}

// Upload-from-the-browser variant (Admin Console "Upload Template" button) —
// same row shape/rules as the file-path variant used by the seed importer,
// just reading from an in-memory buffer instead of disk.
export async function parseExpenseLineItemsBuffer(buffer: Buffer): Promise<ParsedExpenseLineItemRow[]> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as any);
  return parseWorkbook(workbook);
}

// The real catalog often posts several distinct named line items to the
// *same* GL-CC (e.g. every Corporate Marketing sub-item shares one GL
// account) — GL-CC is not a unique key here. The dropdown selection path
// (category -> name -> company) is what's actually unique per row, so it
// doubles as a stable id: re-importing the same row (from the seed file or
// an Admin Console re-upload) updates it in place instead of duplicating it.
export function buildExpenseLineItemId(category: string, name: string, companyCode: string | null): string {
  return `${category}-${name}-${companyCode ?? "any"}`.replace(/[^a-zA-Z0-9]+/g, "_").toLowerCase();
}
