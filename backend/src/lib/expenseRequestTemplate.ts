import type ExcelJS from "exceljs";
import { prisma } from "../prisma";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const EXPENSE_REQUEST_TEMPLATE_HEADER = ["Expense Line Item", ...MONTHS, "Business Justification", "Other Required Fields (JSON)"];

// Shared by bulkUpload.ts's GAE/DOE one-shot import and doeBatches.ts's
// draft-first batch upload - same template shape, same catalog-name
// matching and per-row validation either way. What differs between the two
// callers is what happens to a successfully-parsed row afterwards (create +
// immediately submit, vs create as DRAFT and wait for an explicit batch
// Submit) - that decision stays with each caller, this just parses.
export async function visibleLineItemsForRequest(departmentId: string) {
  const department = await prisma.department.findUnique({ where: { id: departmentId } });
  const applyVisibilityFilter = department?.name !== "Budget";
  return prisma.expenseLineItem.findMany({
    where: {
      status: "STANDARD",
      category: { not: "Manpower - Salary" },
      ...(applyVisibilityFilter ? { OR: [{ visibleToDepartmentId: null }, { visibleToDepartmentId: departmentId }] } : {}),
    },
    orderBy: { name: "asc" },
  });
}

export interface ParsedExpenseRequestRow {
  row: number;
  lineItem: Awaited<ReturnType<typeof visibleLineItemsForRequest>>[number];
  monthlyAmounts: number[];
  proposedAmount: number;
  businessJustification: string;
  otherRequiredFields: Record<string, string>;
}
export interface ExpenseRequestRowError {
  row: number;
  error: string;
}

// The row-by-row extraction/validation bulkUpload.ts's `/bulk-upload` POST
// used to inline directly in its loop - unchanged behavior, just usable from
// more than one caller now.
export function parseExpenseRequestSheet(
  sheet: ExcelJS.Worksheet,
  itemsByName: Map<string, Awaited<ReturnType<typeof visibleLineItemsForRequest>>[number]>
): { rows: ParsedExpenseRequestRow[]; errors: ExpenseRequestRowError[]; rowCount: number } {
  const rows: ParsedExpenseRequestRow[] = [];
  const errors: ExpenseRequestRowError[] = [];
  let rowCount = 0;

  for (let rowNumber = 2; rowNumber <= sheet.rowCount; rowNumber++) {
    const row = sheet.getRow(rowNumber);
    const lineItemName = String(row.getCell(1).value ?? "").trim();
    if (!lineItemName) continue; // blank row, not counted

    rowCount++;

    try {
      const lineItem = itemsByName.get(lineItemName.toLowerCase());
      if (!lineItem) {
        throw new Error(`Expense line item "${lineItemName}" is not in the standard catalog.`);
      }

      const monthlyAmounts: number[] = [];
      for (let m = 0; m < 12; m++) {
        const raw = row.getCell(2 + m).value;
        const num = Number(raw ?? 0);
        if (Number.isNaN(num) || num < 0) {
          throw new Error(`${MONTHS[m]} amount must be a non-negative number.`);
        }
        monthlyAmounts.push(num);
      }
      const proposedAmount = monthlyAmounts.reduce((a, b) => a + b, 0);
      if (proposedAmount <= 0) {
        throw new Error("Proposed Amount must be greater than 0.");
      }

      const businessJustification = String(row.getCell(14).value ?? "").trim();
      if (!businessJustification) {
        throw new Error("Business Justification is mandatory.");
      }

      let otherRequiredFields: Record<string, string> = {};
      const rawOther = row.getCell(15).value;
      if (rawOther) {
        try {
          otherRequiredFields = JSON.parse(String(rawOther));
        } catch {
          throw new Error("Other Required Fields (JSON) column is not valid JSON.");
        }
      }
      const extraFieldsConfig = (lineItem.extraFieldsConfig as { label: string; required: boolean }[]) ?? [];
      for (const field of extraFieldsConfig) {
        if (field.required && !otherRequiredFields[field.label]?.trim()) {
          throw new Error(`Field "${field.label}" is required for "${lineItem.name}".`);
        }
      }

      rows.push({ row: rowNumber, lineItem, monthlyAmounts, proposedAmount, businessJustification, otherRequiredFields });
    } catch (err) {
      errors.push({ row: rowNumber, error: err instanceof Error ? err.message : "Unknown error" });
    }
  }

  return { rows, errors, rowCount };
}
