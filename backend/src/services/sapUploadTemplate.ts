import path from "path";
import ExcelJS from "exceljs";
import { RequestCategory, Sbu } from "@prisma/client";
import { prisma } from "../prisma";

// Fills the SAP plan upload template for one category from its finalized lines.
// Revenue uses the Revenue template; every other category (except NPC, which has
// no template) uses the OPEX template.
//
// Monthly amounts are the ones the requestor entered on each request, scaled by the
// finalized amount (proposed minus budget cut), so each row adds up to the approved budget.

const TEMPLATE_DIR = path.join(__dirname, "..", "..", "templates");
const REVENUE_TEMPLATE = path.join(TEMPLATE_DIR, "SAP Upload Template_Revenue_SBU.xlsx");
const OPEX_TEMPLATE = path.join(TEMPLATE_DIR, "SAP Upload Template_OPEX_SBU.xlsx");

export class SapTemplateError extends Error {}

export interface SapTemplateRequest {
  fiscalYear: number;
  requestCategory: RequestCategory;
  sbu?: Sbu;
  // Blank: the template header only, no approved budget rows (the requestor starting point).
  blank?: boolean;
}

function codeValue(value: string): string | number {
  return /^\d+$/.test(value) ? Number(value) : value;
}

export async function buildSapUploadTemplate(req: SapTemplateRequest): Promise<{ buffer: Buffer; filename: string }> {
  if (req.requestCategory === RequestCategory.NPC) {
    throw new SapTemplateError("There is no SAP upload template for NPC.");
  }
  const isRevenue = req.requestCategory === RequestCategory.REVENUE;

  const lines = req.blank
    ? []
    : await prisma.finalizedBudgetLine.findMany({
        where: { fiscalYear: req.fiscalYear, requestCategory: req.requestCategory, sbu: req.sbu ?? undefined },
        include: { budgetRequest: { select: { proposedAmount: true, monthlyAmounts: true } } },
      });
  // One template row per cost center (profit center for Revenue) and GL account, with the
  // approved monthly amounts summed across its finalized lines.
  const totals = new Map<string, { code: string; gl: string; months: number[] }>();
  for (const line of lines) {
    const key = `${line.costCenter}|${line.glAccount}`;
    const row = totals.get(key) ?? { code: line.costCenter, gl: line.glAccount, months: Array(12).fill(0) as number[] };
    const monthly = (line.budgetRequest.monthlyAmounts as unknown as number[]) ?? [];
    // Finalized amount = proposed minus the budget cut, so scale the monthly amounts to match.
    const factor = line.budgetRequest.proposedAmount ? line.amount / line.budgetRequest.proposedAmount : 0;
    for (let i = 0; i < 12; i++) row.months[i] += (Number(monthly[i]) || 0) * factor;
    totals.set(key, row);
  }

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(isRevenue ? REVENUE_TEMPLATE : OPEX_TEMPLATE);
  const ws = wb.worksheets[0];

  // Locate the labelled rows rather than hard-coding their positions.
  const headerLabel = isRevenue ? "Profit Center" : "Cost Center";
  let headerRow = 0;
  let fiscalYearRow = 0;
  ws.eachRow((row, rowNumber) => {
    const first = String(row.getCell(1).value ?? "").trim();
    if (first === headerLabel && headerRow === 0) headerRow = rowNumber;
    if (first === "Fiscal Year" && fiscalYearRow === 0) fiscalYearRow = rowNumber;
  });
  if (!headerRow) throw new SapTemplateError("The SAP upload template is missing its header row.");
  if (fiscalYearRow) ws.getCell(fiscalYearRow, 2).value = req.fiscalYear;

  // Clear any placeholder data under the header, then write this category's rows.
  for (let r = headerRow + 1; r <= ws.rowCount; r++) {
    for (let c = 1; c <= 14; c++) ws.getCell(r, c).value = null;
  }
  let r = headerRow + 1;
  for (const { code, gl, months } of [...totals.values()].sort((a, b) => a.code.localeCompare(b.code) || a.gl.localeCompare(b.gl))) {
    ws.getCell(r, 1).value = codeValue(code);
    ws.getCell(r, 2).value = codeValue(gl);
    months.forEach((value, i) => {
      ws.getCell(r, 3 + i).value = Math.round(value * 100) / 100;
    });
    r++;
  }

  const buffer = Buffer.from(await wb.xlsx.writeBuffer());
  const label = req.sbu ? `${req.requestCategory}-${req.sbu}` : req.requestCategory;
  return { buffer, filename: `SAP Upload Template - ${label} - ${req.fiscalYear}.xlsx` };
}
