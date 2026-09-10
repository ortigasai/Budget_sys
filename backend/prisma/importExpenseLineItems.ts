import path from "node:path";
import { PrismaClient } from "@prisma/client";
import {
  buildExpenseLineItemId,
  parseExpenseLineItemsFile as parseExpenseLineItemsFileShared,
  type ParsedExpenseLineItemRow,
} from "../src/lib/expenseLineItemCatalog";
import { BudgetCodePrefixKind } from "@prisma/client";
import { formatBudgetCode, getBudgetCodePrefixCode, nextBudgetCode } from "../src/lib/budgetCode";
import { getFiscalCycle } from "../src/lib/fiscalCycle";

// Re-runnable importer for the real "Budgeting System_Expense Line Items"
// catalog (notes item 3: "the list is not yet complete, will add more line
// items as we go"). Upserts Company/Department/ExpenseLineItem rows so it's
// safe to run again as the source file grows. Row parsing lives in
// src/lib/expenseLineItemCatalog.ts, shared with the Admin Console's
// "Upload Template" button (src/services/expenseLineItemService.ts).

const SOURCE_FILE = path.resolve(__dirname, "data/expense-line-items.xlsx");

// The full company/business-unit set implied by the Manpower workbook's
// column headers. "OLCP" (a source-file typo for "OCLP") is normalized away
// in expenseLineItemCatalog.ts before rows ever reach this list, so it's
// intentionally not a company of its own here.
const COMPANIES: { code: string; name: string }[] = [
  { code: "OCC", name: "OCC" },
  { code: "OCLP", name: "OCLP" },
  { code: "OCLP_PROJECT", name: "OCLP Project" },
  { code: "OLC", name: "OLC" },
  { code: "OLC_PROJECT", name: "OLC Project" },
  { code: "OUTSOURCED", name: "Outsourced" },
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
  const { targetCalendarYear } = await getFiscalCycle();
  const cdPrefixCache = new Map<string, string | null>();

  const resolveDepartmentId = async (name: string) => {
    let id = departmentCache.get(name);
    if (!id) {
      const dept = await prisma.department.upsert({
        where: { name },
        update: {},
        create: { name, type: "CENTRALIZED" },
      });
      id = dept.id;
      departmentCache.set(name, id);
    }
    return id;
  };

  let imported = 0;
  for (const row of rows) {
    const departmentId = await resolveDepartmentId(row.departmentName);
    const visibleToDepartmentId = row.visibleToDepartmentName
      ? await resolveDepartmentId(row.visibleToDepartmentName)
      : null;

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

    // Normally the file's own CD+Num (row.budgetCodePrefix/budgetCodeNum)
    // combined with the *current* Target Calendar Year - not the file's own
    // YY, which is frozen to whichever year it was last edited in. A row
    // missing CD/Num (e.g. an unrecognized department, or a fresh row added
    // without the CD/Num formulas filled in) falls back to the department's
    // configured CD prefix (Admin Console > Budget Codes) + a generated
    // sequence number instead, so it still gets a code.
    let budgetCode: string | null = null;
    if (row.budgetCodePrefix && row.budgetCodeNum != null) {
      budgetCode = formatBudgetCode(row.budgetCodePrefix, targetCalendarYear, row.budgetCodeNum);
    } else {
      if (!cdPrefixCache.has(row.departmentName)) {
        cdPrefixCache.set(
          row.departmentName,
          await getBudgetCodePrefixCode(BudgetCodePrefixKind.CENTRALIZED_DEPARTMENT, row.departmentName)
        );
      }
      const prefixCode = cdPrefixCache.get(row.departmentName);
      if (prefixCode) budgetCode = await nextBudgetCode(prefixCode, targetCalendarYear);
    }

    await prisma.expenseLineItem.upsert({
      where: { id },
      update: {
        category: row.category,
        description: row.description,
        glAccount: row.glAccount,
        costCenter: row.costCenter,
        ownerDepartmentId: departmentId,
        companyId,
        extraFieldsConfig: row.extraFieldsConfig as any,
        requiresMobilePolicy: row.requiresMobilePolicy,
        spendGridComputation: row.spendGridComputation,
        spendGridFrequency: row.spendGridFrequency,
        sampleCharges: row.sampleCharges,
        visibleToDepartmentId,
        budgetCode: budgetCode ?? undefined,
      },
      create: {
        id,
        name: row.name,
        category: row.category,
        description: row.description,
        glAccount: row.glAccount,
        costCenter: row.costCenter,
        ownerDepartmentId: departmentId,
        companyId,
        extraFieldsConfig: row.extraFieldsConfig as any,
        requiresMobilePolicy: row.requiresMobilePolicy,
        spendGridComputation: row.spendGridComputation,
        spendGridFrequency: row.spendGridFrequency,
        sampleCharges: row.sampleCharges,
        visibleToDepartmentId,
        managedBy: budgetOfficerId,
        budgetCode,
      },
    });
    imported++;
  }

  console.log(`Imported ${imported} expense line items across ${departmentCache.size} departments.`);
  return { imported, departments: [...departmentCache.keys()] };
}
