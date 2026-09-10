import ExcelJS from "exceljs";
import { HttpError } from "../httpError";

// Spec item 16 - "Budgeting System_Revenue Budget Request Template.xlsx":
// row 2 is the header (A2="CC", B2="GL", C2:N2=Jan-Dec, O2="Total"), data
// starts at row 3, and O1 is a SUBTOTAL(9, O3:...) grand total the sheet
// itself computes. We recompute that grand total ourselves from the raw
// monthly cells rather than trusting O1's cached formula result, since a
// freshly-saved file isn't guaranteed to carry one.
const HEADER_ROW = 2;
const FIRST_DATA_ROW = 3;
const CC_COL = 1;
const GL_COL = 2;
const FIRST_MONTH_COL = 3; // C
const LAST_MONTH_COL = 14; // N
const MAX_DATA_ROWS = 5000;

export interface RevenueTemplateRow {
  costCenter: string;
  glAccount: string;
  monthlyAmounts: number[];
  total: number;
}

export interface ParsedRevenueTemplate {
  rows: RevenueTemplateRow[];
  grandTotal: number;
}

function cellNumber(cell: ExcelJS.Cell): number {
  const v = cell.value;
  if (v === null || v === undefined) return 0;
  if (typeof v === "number") return v;
  if (typeof v === "object" && "result" in (v as any)) return Number((v as any).result) || 0;
  const n = Number(v);
  return Number.isNaN(n) ? 0 : n;
}

function cellText(cell: ExcelJS.Cell): string {
  const v = cell.value;
  if (v === null || v === undefined) return "";
  if (typeof v === "object" && "result" in (v as any)) return String((v as any).result ?? "").trim();
  return String(v).trim();
}

export async function parseRevenueTemplate(buffer: Buffer): Promise<ParsedRevenueTemplate> {
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(buffer as any);
  } catch {
    throw new HttpError(400, "Could not read the uploaded file. Upload the Revenue Budget Request Template (.xlsx).");
  }

  const sheet = workbook.worksheets[0];
  if (!sheet) throw new HttpError(400, "The uploaded file has no worksheet.");

  const headerRow = sheet.getRow(HEADER_ROW);
  const ccHeader = cellText(headerRow.getCell(CC_COL)).toUpperCase();
  const glHeader = cellText(headerRow.getCell(GL_COL)).toUpperCase();
  if (ccHeader !== "CC" || glHeader !== "GL") {
    throw new HttpError(400, "This doesn't look like the Revenue Budget Request Template - row 2 should start with CC, GL headers. Download the template and try again.");
  }

  const rows: RevenueTemplateRow[] = [];
  let grandTotal = 0;
  const lastRow = Math.min(sheet.actualRowCount || FIRST_DATA_ROW, FIRST_DATA_ROW + MAX_DATA_ROWS);

  for (let r = FIRST_DATA_ROW; r <= lastRow; r++) {
    const row = sheet.getRow(r);
    const costCenter = cellText(row.getCell(CC_COL));
    const glAccount = cellText(row.getCell(GL_COL));
    if (!costCenter && !glAccount) continue; // blank row - template padding, not data

    if (!costCenter || !glAccount) {
      throw new HttpError(400, `Row ${r}: both CC and GL are required.`);
    }

    const monthlyAmounts: number[] = [];
    let rowTotal = 0;
    for (let c = FIRST_MONTH_COL; c <= LAST_MONTH_COL; c++) {
      const amount = cellNumber(row.getCell(c));
      monthlyAmounts.push(amount);
      rowTotal += amount;
    }

    rows.push({ costCenter, glAccount, monthlyAmounts, total: rowTotal });
    grandTotal += rowTotal;
  }

  if (rows.length === 0) {
    throw new HttpError(400, "No data rows found - fill in at least one CC/GL row before uploading.");
  }

  return { rows, grandTotal: Math.round(grandTotal * 100) / 100 };
}
