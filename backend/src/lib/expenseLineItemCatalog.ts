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
}

export interface ParsedExpenseLineItemRow {
  category: string;
  name: string;
  companyCode: string | null;
  departmentName: string;
  costCenter: string;
  glAccount: string;
  extraFieldsConfig: ExtraField[];
  requiresMobilePolicy: boolean;
}

const NUMBER_FIELD_LABELS = new Set(["Headcount", "Count", "No. of Vehicle"]);

export function parseAdditionalField(raw: string | null): ExtraField[] {
  if (!raw || !raw.trim()) return [];
  const value = raw.replace(/\\_/g, "_").trim();

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
    return [{ label: value, required: true, type: "NUMBER" }];
  }

  return [{ label: value, required: true, type: "TEXT" }];
}

function parseWorkbook(workbook: ExcelJS.Workbook): ParsedExpenseLineItemRow[] {
  const sheet = workbook.getWorksheet("Sheet1");
  if (!sheet) throw new Error(`Sheet1 not found in workbook`);

  const rows: ParsedExpenseLineItemRow[] = [];
  for (let r = 3; r <= sheet.rowCount; r++) {
    const row = sheet.getRow(r);
    const category = String(row.getCell(1).value ?? "").trim();
    const name = String(row.getCell(2).value ?? "").trim();
    if (!category || !name) continue;

    const companyRaw = String(row.getCell(3).value ?? "").trim();
    const departmentName = String(row.getCell(5).value ?? "").trim();
    const costCenterRaw = row.getCell(6).value;
    const glAccountRaw = row.getCell(7).value;
    const additionalFieldRaw = row.getCell(8).value ? String(row.getCell(8).value) : null;

    if (!departmentName) continue; // rows with no owning department can't be routed

    const extraFieldsConfig = parseAdditionalField(additionalFieldRaw);

    rows.push({
      category,
      name,
      companyCode: companyRaw || null,
      departmentName,
      costCenter: costCenterRaw ? String(costCenterRaw) : "PENDING",
      glAccount: glAccountRaw ? String(glAccountRaw) : "PENDING",
      extraFieldsConfig,
      // Only the specific row carrying the parsed Plan dropdown triggers the
      // rank/plan policy sub-form + conditional CFO gate — other company
      // variants of "Mobile Phone" (e.g. OCLP) don't have that field mapped.
      requiresMobilePolicy: extraFieldsConfig.some((f) => f.type === "DROPDOWN"),
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
