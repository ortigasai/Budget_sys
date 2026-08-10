import path from "node:path";
import { PrismaClient } from "@prisma/client";
import {
  buildExpenseLineItemId,
  parseExpenseLineItemsFile as parseExpenseLineItemsFileShared,
  type ParsedExpenseLineItemRow,
} from "../src/lib/expenseLineItemCatalog";

// Re-runnable importer for the real "Budgeting System_Expense Line Items"
// catalog (notes item 3: "the list is not yet complete, will add more line
// items as we go"). Upserts Company/Department/ExpenseLineItem rows so it's
// safe to run again as the source file grows. Row parsing lives in
// src/lib/expenseLineItemCatalog.ts, shared with the Admin Console's
// "Upload Template" button (src/services/expenseLineItemService.ts).

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

export function parseExpenseLineItemsFile(filePath: string = SOURCE_FILE): Promise<ParsedExpenseLineItemRow[]> {
  return parseExpenseLineItemsFileShared(filePath);
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

    const id = buildExpenseLineItemId(row.category, row.name, row.companyCode);

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
