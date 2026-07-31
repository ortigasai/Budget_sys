import path from "node:path";
import ExcelJS from "exceljs";
import { PrismaClient } from "@prisma/client";

// Re-runnable importer for the real "Budgeting System_Expense Line Items"
// catalog (notes item 3: "the list is not yet complete, will add more line
// items as we go"). Upserts Company/Department/ExpenseLineItem rows so it's
// safe to run again as the source file grows.

const SOURCE_FILE = path.resolve(__dirname, "data/expense-line-items.xlsx");

// The full company/business-unit set implied by the Manpower workbook's
// column headers, plus "OLCP" as literally found in one Expense Line Items
// row (likely a source typo for OCLP, kept verbatim rather than silently
// "corrected").
const COMPANIES: { code: string; name: string }[] = [
  { code: "OCC", name: "OCC" },
  { code: "OCLP", name: "OCLP" },
  { code: "OCLP_PROJECT", name: "OCLP Project" },
  { code: "OLC", name: "OLC" },
  { code: "OLC_PROJECT", name: "OLC Project" },
  { code: "OUTSOURCED", name: "Outsourced" },
  { code: "OLCP", name: "OLCP" },
];

interface ExtraFieldOption {
  label: string;
  value: number | null;
}
interface ExtraField {
  label: string;
  required: boolean;
  type: "TEXT" | "NUMBER" | "DROPDOWN";
  options?: ExtraFieldOption[];
}

const NUMBER_FIELD_LABELS = new Set(["Headcount", "Count", "No. of Vehicle"]);

function parseAdditionalField(raw: string | null): ExtraField[] {
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

interface ParsedRow {
  category: string;
  name: string;
  companyCode: string | null;
  departmentName: string;
  costCenter: string;
  glAccount: string;
  extraFieldsConfig: ExtraField[];
  requiresMobilePolicy: boolean;
}

export async function parseExpenseLineItemsFile(filePath: string = SOURCE_FILE): Promise<ParsedRow[]> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);
  const sheet = workbook.getWorksheet("Sheet1");
  if (!sheet) throw new Error(`Sheet1 not found in ${filePath}`);

  const rows: ParsedRow[] = [];
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

export async function importExpenseLineItems(prisma: PrismaClient, budgetOfficerId: string) {
  for (const c of COMPANIES) {
    await prisma.company.upsert({
      where: { code: c.code },
      update: { name: c.name },
      create: c,
    });
  }

  const rows = await parseExpenseLineItemsFile();
  const departmentCache = new Map<string, string>();
  const companyCache = new Map<string, string>();

  let imported = 0;
  for (const row of rows) {
    let departmentId = departmentCache.get(row.departmentName);
    if (!departmentId) {
      const dept = await prisma.department.upsert({
        where: { name: row.departmentName },
        update: {},
        create: { name: row.departmentName, type: "CENTRALIZED" },
      });
      departmentId = dept.id;
      departmentCache.set(row.departmentName, departmentId);
    }

    let companyId: string | undefined;
    if (row.companyCode) {
      companyId = companyCache.get(row.companyCode);
      if (!companyId) {
        const company = await prisma.company.findUniqueOrThrow({ where: { code: row.companyCode } });
        companyId = company.id;
        companyCache.set(row.companyCode, companyId);
      }
    }

    // The real catalog often posts several distinct named line items to the
    // *same* GL-CC (e.g. every Corporate Marketing sub-item shares one GL
    // account) — GL-CC is not a unique key here. The dropdown selection path
    // (category -> name -> company) is what's actually unique per row.
    const id = `${row.category}-${row.name}-${row.companyCode ?? "any"}`
      .replace(/[^a-zA-Z0-9]+/g, "_")
      .toLowerCase();

    await prisma.expenseLineItem.upsert({
      where: { id },
      update: {
        category: row.category,
        glAccount: row.glAccount,
        costCenter: row.costCenter,
        ownerDepartmentId: departmentId,
        companyId,
        extraFieldsConfig: row.extraFieldsConfig as any,
        requiresMobilePolicy: row.requiresMobilePolicy,
      },
      create: {
        id,
        name: row.name,
        category: row.category,
        glAccount: row.glAccount,
        costCenter: row.costCenter,
        ownerDepartmentId: departmentId,
        companyId,
        extraFieldsConfig: row.extraFieldsConfig as any,
        requiresMobilePolicy: row.requiresMobilePolicy,
        managedBy: budgetOfficerId,
      },
    });
    imported++;
  }

  console.log(`Imported ${imported} expense line items across ${departmentCache.size} departments.`);
  return { imported, departments: [...departmentCache.keys()] };
}
