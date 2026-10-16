import type ExcelJS from "exceljs";
import { prisma } from "../prisma";
import type { ExtraField } from "./expenseLineItemCatalog";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
// Company tells apart line items that share a name but are set up per
// company (own GL-CC and budget code each); blank for company-agnostic items.
// Total sits right after Dec - bulkUpload.ts writes a =SUM(Jan:Dec) formula
// into it per row, so it's auto-computed and never parsed back out below
// (proposedAmount is still the sum of monthlyAmounts computed in code).
// Columns are located by header label when parsing, so templates downloaded
// before Company existed (months starting at column C) still upload.
const FIXED_HEADER = ["Expense Category", "Expense Line Item", "Company", ...MONTHS, "Total", "Business Justification"];

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
    include: { company: true },
    orderBy: { name: "asc" },
  });
}

type VisibleLineItem = Awaited<ReturnType<typeof visibleLineItemsForRequest>>[number];

export interface ParsedExpenseRequestRow {
  row: number;
  lineItem: VisibleLineItem;
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
  items: VisibleLineItem[]
): { rows: ParsedExpenseRequestRow[]; errors: ExpenseRequestRowError[]; rowCount: number } {
  const itemsByName = new Map<string, VisibleLineItem[]>();
  for (const item of items) {
    const key = item.name.trim().toLowerCase();
    itemsByName.set(key, [...(itemsByName.get(key) ?? []), item]);
  }

  const headerRow = sheet.getRow(1);
  const columnByLabel = new Map<string, number>();
  for (let c = 1; c <= headerRow.cellCount; c++) {
    const label = String(headerRow.getCell(c).value ?? "").trim();
    if (label) columnByLabel.set(label, c);
  }
  const monthStartCol = columnByLabel.get("Jan") ?? 3;
  const companyCol = columnByLabel.get("Company");
  const businessJustificationCol = columnByLabel.get("Business Justification") ?? monthStartCol + 13;
  const extraFieldCols = [...columnByLabel.entries()].filter(([label]) => !FIXED_HEADER.includes(label)).map(([, col]) => col);
  const hasText = (v: ExcelJS.CellValue) => v !== null && v !== undefined && String(v).trim() !== "";

  const rows: ParsedExpenseRequestRow[] = [];
  const errors: ExpenseRequestRowError[] = [];
  let rowCount = 0;

  for (let rowNumber = 2; rowNumber <= sheet.rowCount; rowNumber++) {
    const row = sheet.getRow(rowNumber);
    // A row with a category but no line item is skipped as blank (nothing
    // to match against).
    const categoryCell = String(row.getCell(1).value ?? "").trim();
    const lineItemName = String(row.getCell(2).value ?? "").trim();
    const companyCell = companyCol ? String(row.getCell(companyCol).value ?? "").trim() : "";
    if (!lineItemName) continue; // blank row, not counted
    // The template comes pre-filled with every line item the department can
    // see, so a row with only its category/line item/company and nothing
    // entered is one the user isn't budgeting for - skipped, not rejected.
    const hasAmount = Array.from({ length: 12 }, (_, m) => row.getCell(monthStartCol + m).value).some((v) => hasText(v) && Number(v) !== 0);
    const hasOtherInput = hasText(row.getCell(businessJustificationCol).value) || extraFieldCols.some((c) => hasText(row.getCell(c).value));
    if (!hasAmount && !hasOtherInput) continue;

    rowCount++;

    try {
      const lineItem = resolveLineItem(itemsByName, lineItemName, categoryCell, companyCell);

      const monthlyAmounts: number[] = [];
      for (let m = 0; m < 12; m++) {
        const raw = row.getCell(monthStartCol + m).value;
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

export const companyLabel = (item: { company: { code: string } | null }) => item.company?.code ?? "";

// Several catalog rows can share a name - the same item set up per company,
// each with its own GL-CC and budget code - so name alone isn't a key.
function resolveLineItem(itemsByName: Map<string, VisibleLineItem[]>, name: string, category: string, company: string): VisibleLineItem {
  let candidates = itemsByName.get(name.toLowerCase()) ?? [];
  if (candidates.length === 0) {
    throw new Error(`Expense line item "${name}" is not in the standard catalog.`);
  }
  if (category) {
    const inCategory = candidates.filter((i) => i.category.toLowerCase() === category.toLowerCase());
    if (inCategory.length === 0) {
      const real = [...new Set(candidates.map((i) => i.category))].join(", ");
      throw new Error(`Expense Category "${category}" doesn't match "${candidates[0].name}"'s real category "${real}" - see the Catalog Reference sheet for the correct pairing.`);
    }
    candidates = inCategory;
  }
  if (company) {
    const match = candidates.find((i) => i.company && [i.company.code, i.company.name].some((v) => v.toLowerCase() === company.toLowerCase()));
    if (match) return match;
    const options = candidates.map(companyLabel).filter(Boolean);
    throw new Error(
      options.length > 0
        ? `"${name}" isn't set up for company "${company}" - use one of: ${options.join(", ")}.`
        : `"${name}" applies to every company - leave Company blank.`
    );
  }
  if (candidates.length === 1) return candidates[0];
  const companyAgnostic = candidates.filter((i) => !i.company);
  if (companyAgnostic.length === 1) return companyAgnostic[0];
  throw new Error(`"${name}" is set up separately for ${candidates.map(companyLabel).filter(Boolean).join(", ")} - fill in the Company column.`);
}
