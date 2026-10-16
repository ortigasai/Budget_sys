import type ExcelJS from "exceljs";
import { prisma } from "../prisma";
import type { ExtraField } from "./expenseLineItemCatalog";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
// Total (column O) sits right after Dec - bulkUpload.ts writes a =SUM(C:N)
// formula into it per row, so it's read-only/auto-computed, never parsed
// back out below (proposedAmount is still the sum of monthlyAmounts
// computed in code). Business Justification always follows at column P,
// regardless of how many Additional Field columns the catalog ends up
// needing - see buildTemplateHeader below.
const FIXED_HEADER = ["Expense Category", "Expense Line Item", ...MONTHS, "Total", "Business Justification"];

// Every distinct Additional Field label the given items' extraFieldsConfig
// declares (e.g. "Headcount", "Meal Allowance Rate", "Specify") - each gets
// its own real column in the template instead of one catch-all "Other
// Required Fields (JSON)" column, so a requestor fills in plain values, not
// JSON. A row only needs the columns its own line item's Catalog Reference
// entry lists as required; the rest stay blank. Derived from whichever items
// the caller passes (bulkUpload.ts passes the same department-visible list
// the rest of the template is already built from), so the columns always
// match what's actually selectable on that sheet.
export function extraFieldLabelsFor(items: { extraFieldsConfig: unknown }[]): string[] {
  const labels = new Set<string>();
  for (const item of items) {
    const fields = item.extraFieldsConfig as { label: string }[] | null;
    for (const f of fields ?? []) if (f.label) labels.add(f.label);
  }
  return Array.from(labels).sort((a, b) => a.localeCompare(b));
}

export function buildTemplateHeader(extraFieldLabels: string[]): string[] {
  return [...FIXED_HEADER, ...extraFieldLabels];
}

// Shared by bulkUpload.ts's GAE/DOE one-shot import and doeBatches.ts's
// draft-first batch upload - same template shape, same catalog-name
// matching and per-row validation either way. What differs between the two
// callers is what happens to a successfully-parsed row afterwards (create +
// immediately submit, vs create as DRAFT and wait for an explicit batch
// Submit) - that decision stays with each caller, this just parses.
export async function visibleLineItemsForRequest(departmentId: string) {
  const department = await prisma.department.findUnique({ where: { id: departmentId } });
  // Budget and Budget, Controls & Analysis (BCA) see every standard expense item (including manpower salary) and
  // aren't limited to the ones visible to them. Other departments don't get the manpower salary items.
  const isBudgetDepartment = department?.name === "Budget" || department?.name === "Budget, Controls & Analysis";
  const applyVisibilityFilter = !isBudgetDepartment;
  return prisma.expenseLineItem.findMany({
    where: {
      status: "STANDARD",
      ...(isBudgetDepartment ? {} : { category: { not: "Manpower - Salary" } }),
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
// more than one caller now. Additional Field values are read by matching the
// UPLOADED file's own header row to each field's label (not a fixed column
// index), so an older/newer catalog shape between download and upload still
// resolves correctly instead of silently reading the wrong cell.
export function parseExpenseRequestSheet(
  sheet: ExcelJS.Worksheet,
  itemsByName: Map<string, Awaited<ReturnType<typeof visibleLineItemsForRequest>>[number]>
): { rows: ParsedExpenseRequestRow[]; errors: ExpenseRequestRowError[]; rowCount: number } {
  const headerRow = sheet.getRow(1);
  const columnByLabel = new Map<string, number>();
  for (let c = 1; c <= headerRow.cellCount; c++) {
    const label = String(headerRow.getCell(c).value ?? "").trim();
    if (label) columnByLabel.set(label, c);
  }
  const businessJustificationCol = columnByLabel.get("Business Justification") ?? 16;
  const extraFieldCols = [...columnByLabel.entries()].filter(([label]) => !FIXED_HEADER.includes(label)).map(([, col]) => col);
  const hasText = (v: ExcelJS.CellValue) => v !== null && v !== undefined && String(v).trim() !== "";

  const rows: ParsedExpenseRequestRow[] = [];
  const errors: ExpenseRequestRowError[] = [];
  let rowCount = 0;

  for (let rowNumber = 2; rowNumber <= sheet.rowCount; rowNumber++) {
    const row = sheet.getRow(rowNumber);
    // Column A (Expense Category) is a cross-check / visible aid for the
    // person filling the sheet, not the match key - column B (Expense Line
    // Item) alone still resolves the real catalog row, same as before this
    // column existed. A row with a category but no line item is still
    // skipped as blank (nothing to match against).
    const categoryCell = String(row.getCell(1).value ?? "").trim();
    const lineItemName = String(row.getCell(2).value ?? "").trim();
    if (!lineItemName) continue; // blank row, not counted
    // The template comes pre-filled with every line item the department can
    // see, so a row with only its category/line item and nothing entered is
    // one the user isn't budgeting for - skipped, not rejected.
    const hasAmount = Array.from({ length: 12 }, (_, m) => row.getCell(3 + m).value).some((v) => hasText(v) && Number(v) !== 0);
    const hasOtherInput = hasText(row.getCell(businessJustificationCol).value) || extraFieldCols.some((c) => hasText(row.getCell(c).value));
    if (!hasAmount && !hasOtherInput) continue;

    rowCount++;

    try {
      const lineItem = itemsByName.get(lineItemName.toLowerCase());
      if (!lineItem) {
        throw new Error(`Expense line item "${lineItemName}" is not in the standard catalog.`);
      }
      if (categoryCell && categoryCell.toLowerCase() !== (lineItem.category ?? "").toLowerCase()) {
        throw new Error(
          `Expense Category "${categoryCell}" doesn't match "${lineItem.name}"'s real category "${lineItem.category}" - see the Catalog Reference sheet for the correct pairing.`
        );
      }

      const monthlyAmounts: number[] = [];
      for (let m = 0; m < 12; m++) {
        const raw = row.getCell(3 + m).value;
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

      const businessJustification = String(row.getCell(businessJustificationCol).value ?? "").trim();
      if (!businessJustification) {
        throw new Error("Business Justification is mandatory.");
      }

      const extraFieldsConfig = (lineItem.extraFieldsConfig as unknown as ExtraField[]) ?? [];
      // Mirrors workflowService.ts's own usesHeadcountTable rule exactly - a
      // Headcount + rate NUMBER pair with no DROPDOWN field renders as the
      // repeatable Headcount & Rate table on the web form, which stores its
      // values under "Row N <label>" keys instead of the plain label. Submit
      // validation checks for that exact key shape, so a bulk-uploaded row
      // for one of these items needs the same "Row 1 " prefix - the
      // spreadsheet only ever fills one row's worth per line item.
      const hasDropdownField = extraFieldsConfig.some((f) => f.type === "DROPDOWN");
      const headcountField = extraFieldsConfig.find((f) => f.label === "Headcount");
      const rateField = extraFieldsConfig.find((f) => f.label !== "Headcount" && f.type === "NUMBER");
      const usesHeadcountTable = !!(headcountField && rateField && lineItem.spendGridComputation && !hasDropdownField);

      const otherRequiredFields: Record<string, string> = {};
      for (const field of extraFieldsConfig) {
        const col = columnByLabel.get(field.label);
        const value = col ? String(row.getCell(col).value ?? "").trim() : "";
        const key = usesHeadcountTable ? `Row 1 ${field.label}` : field.label;
        if (value) otherRequiredFields[key] = value;
        if (field.required && !value) {
          throw new Error(
            col
              ? `Field "${field.label}" is required for "${lineItem.name}" - fill it into the "${field.label}" column.`
              : `Field "${field.label}" is required for "${lineItem.name}" but this sheet has no "${field.label}" column - download a fresh template.`
          );
        }
      }

      rows.push({ row: rowNumber, lineItem, monthlyAmounts, proposedAmount, businessJustification, otherRequiredFields });
    } catch (err) {
      errors.push({ row: rowNumber, error: err instanceof Error ? err.message : "Unknown error" });
    }
  }

  return { rows, errors, rowCount };
}
