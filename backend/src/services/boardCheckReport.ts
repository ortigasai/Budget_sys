import ExcelJS from "exceljs";
import { RequestCategory, RequestStage, Sbu } from "@prisma/client";
import { prisma } from "../prisma";
import { NPC_SBU_OPTIONS } from "../lib/npcSbu";
import { getFinalizedBudgetReport, type BoardBudgetCheckOut } from "./finalizedBudgetReportService";

// Excel reports laid out like the Consolidated Board-Approved P&L grid
// (frontend/src/components/BoardApprovedGrid.tsx): P&L lines down the side
// with the same calculated subtotals, one column per SBU (plus Total) or, for
// one SBU, one column per figure. Two reports use it:
//   - buildBoardCheckReport: the Finalized Budget Report page's Board-Approved
//     Budget vs. Total Finalized table.
//   - buildBoardApprovedPageReport: the Consolidated Board-Approved P&L and
//     Board-Approved NPC Budget pages, exactly as shown (Board-Approved vs
//     Total Approved and Proposed).
// NPC isn't part of the P&L, so it gets its own sheet, one row per NPC SBU.

// Same columns, order and labels as the grid (RBU is Residential).
const COLUMNS: { key: Sbu; label: string }[] = [
  { key: Sbu.CORPORATE, label: "Corporate" },
  { key: Sbu.ESTATES, label: "Estates" },
  { key: Sbu.LEISURE, label: "Leisure" },
  { key: Sbu.MALLS, label: "Malls" },
  { key: Sbu.OFFICES, label: "Offices" },
  { key: Sbu.RESIDENTIAL, label: "RBU" },
];
const ALL_SBUS = COLUMNS.map((c) => c.key);
const sbuName = (sbu: Sbu) => (sbu === Sbu.RESIDENTIAL ? "Residential" : COLUMNS.find((c) => c.key === sbu)!.label);

// The grid's input lines, with the SBU columns each one applies to.
const LINES: { id: string; label: string; category: RequestCategory; columns: Sbu[] }[] = [
  { id: "dev", label: "Development (Vertical + Horizontal)", category: RequestCategory.REVENUE, columns: [Sbu.RESIDENTIAL] },
  { id: "malls-rev", label: "Malls", category: RequestCategory.REVENUE, columns: [Sbu.MALLS] },
  { id: "offices-rev", label: "Offices", category: RequestCategory.REVENUE, columns: [Sbu.OFFICES] },
  { id: "estates-rev", label: "Estates", category: RequestCategory.REVENUE, columns: [Sbu.ESTATES] },
  { id: "cos", label: "Cost of Sales", category: RequestCategory.COST_OF_SALES, columns: [Sbu.RESIDENTIAL] },
  { id: "commission", label: "Commission", category: RequestCategory.COMMISSION, columns: [Sbu.RESIDENTIAL] },
  { id: "doe", label: "Direct Operating Expenses", category: RequestCategory.DOE, columns: ALL_SBUS },
  { id: "ga", label: "General and Administrative Expenses", category: RequestCategory.GAE, columns: [Sbu.CORPORATE] },
  { id: "da", label: "Depreciation & Amortization", category: RequestCategory.DEPRECIATION_AMORTIZATION, columns: [Sbu.RESIDENTIAL, Sbu.MALLS, Sbu.OFFICES, Sbu.ESTATES, Sbu.CORPORATE] },
  { id: "interest", label: "Interest expense", category: RequestCategory.INTEREST_EXPENSE, columns: [Sbu.RESIDENTIAL, Sbu.MALLS, Sbu.OFFICES, Sbu.ESTATES] },
  { id: "other", label: "Other income", category: RequestCategory.OTHER_INCOME, columns: [Sbu.CORPORATE] },
];

// One measure's value for an input line in an SBU column (0 where the line doesn't apply).
type Value = (lineId: string, sbu: Sbu) => number;
type Calc = (v: Value, sbu: Sbu) => number;
const totalRevenues: Calc = (v, s) => ["dev", "malls-rev", "offices-rev", "estates-rev"].reduce((sum, id) => sum + v(id, s), 0);
const grossProfit: Calc = (v, s) => totalRevenues(v, s) - v("cos", s);
const ebitda: Calc = (v, s) => grossProfit(v, s) - v("commission", s) - v("doe", s) - v("ga", s);
const nibt: Calc = (v, s) => ebitda(v, s) - v("da", s) - v("interest", s) + v("other", s);
type Row = { kind: "label"; label: string } | { kind: "line"; id: string } | { kind: "calc"; label: string; fn: Calc };
const ROWS: Row[] = [
  { kind: "label", label: "Revenues" },
  { kind: "line", id: "dev" },
  { kind: "line", id: "malls-rev" },
  { kind: "line", id: "offices-rev" },
  { kind: "line", id: "estates-rev" },
  { kind: "calc", label: "Total Revenues", fn: totalRevenues },
  { kind: "line", id: "cos" },
  { kind: "calc", label: "Gross Profit", fn: grossProfit },
  { kind: "line", id: "commission" },
  { kind: "line", id: "doe" },
  { kind: "line", id: "ga" },
  { kind: "calc", label: "EBITDA", fn: ebitda },
  { kind: "line", id: "da" },
  { kind: "line", id: "interest" },
  { kind: "line", id: "other" },
  { kind: "calc", label: "NIBT", fn: nibt },
];
// A row's value for one SBU: the line itself, or its subtotal formula.
const rowValue = (row: Exclude<Row, { kind: "label" }>, v: Value, sbu: Sbu) => (row.kind === "line" ? v(row.id, sbu) : row.fn(v, sbu));
const lineOf = (id: string) => LINES.find((l) => l.id === id)!;

// Same look as the grid: green header, light-green subtotal rows, negatives in brackets.
const NUM_FMT = '#,##0;(#,##0);"—"';
const PCT_FMT = '0%;(0%);"—"';
const HEADER_FILL: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEDF6F1" } };
const DARK_GREEN = { argb: "FF164B33" };
const BORDER_GREEN = { style: "thin" as const, color: { argb: "FFA7D7BE" } };

function styleHeader(row: ExcelJS.Row, lastCol: number) {
  row.font = { bold: true, color: DARK_GREEN };
  for (let c = 1; c <= lastCol; c++) {
    const cell = row.getCell(c);
    cell.fill = HEADER_FILL;
    cell.border = { top: BORDER_GREEN, bottom: BORDER_GREEN };
    if (c > 1) cell.alignment = { horizontal: "right", wrapText: true };
  }
}
function styleNumbers(row: ExcelJS.Row, lastCol: number, formats?: string[]) {
  for (let c = 2; c <= lastCol; c++) {
    const cell = row.getCell(c);
    cell.numFmt = formats?.[c - 2] ?? NUM_FMT;
    cell.alignment = { horizontal: "right" };
  }
}
function styleSubtotal(row: ExcelJS.Row, lastCol: number, formats?: string[]) {
  row.font = { bold: true, color: DARK_GREEN };
  for (let c = 1; c <= lastCol; c++) row.getCell(c).fill = HEADER_FILL;
  styleNumbers(row, lastCol, formats);
}

// One measure across SBU columns (plus Total when showing every SBU) - the grid's own shape.
function writePlBlock(sheet: ExcelJS.Worksheet, title: string, columns: typeof COLUMNS, showTotal: boolean, v: Value) {
  const lastCol = 1 + columns.length + (showTotal ? 1 : 0);
  styleHeader(sheet.addRow([title, ...columns.map((c) => c.label), ...(showTotal ? ["Total"] : [])]), lastCol);
  for (const row of ROWS) {
    if (row.kind === "label") {
      sheet.addRow([row.label]).font = { bold: true, color: { argb: "FF475569" } };
      continue;
    }
    const applies = (sbu: Sbu) => row.kind === "calc" || lineOf(row.id).columns.includes(sbu);
    const r = sheet.addRow([
      row.kind === "line" ? lineOf(row.id).label : row.label,
      ...columns.map((c) => (applies(c.key) ? rowValue(row, v, c.key) : "—")),
      ...(showTotal ? [columns.reduce((sum, c) => sum + rowValue(row, v, c.key), 0)] : []),
    ]);
    if (row.kind === "calc") styleSubtotal(r, lastCol);
    else {
      styleNumbers(r, lastCol);
      if (showTotal) r.getCell(lastCol).font = { bold: true };
    }
  }
}

// One SBU with several figures side by side - the grid's single-SBU view
// (Board-Approved, Total Approved and Proposed, Variance, %).
function writePlMeasuresBlock(sheet: ExcelJS.Worksheet, title: string, sbu: Sbu, measures: { label: string; value: Value; percentOf?: [Value, Value] }[]) {
  const lastCol = 1 + measures.length;
  const formats = measures.map((m) => (m.percentOf ? PCT_FMT : NUM_FMT));
  styleHeader(sheet.addRow([title, ...measures.map((m) => m.label)]), lastCol);
  for (const row of ROWS) {
    if (row.kind === "label") {
      sheet.addRow([row.label]).font = { bold: true, color: { argb: "FF475569" } };
      continue;
    }
    const applies = row.kind === "calc" || lineOf(row.id).columns.includes(sbu);
    const r = sheet.addRow([
      row.kind === "line" ? lineOf(row.id).label : row.label,
      ...measures.map((m) => {
        if (!applies) return "—";
        if (!m.percentOf) return rowValue(row, m.value, sbu);
        const base = rowValue(row, m.percentOf[1], sbu);
        return base === 0 ? "—" : rowValue(row, m.percentOf[0], sbu) / base;
      }),
    ]);
    if (row.kind === "calc") styleSubtotal(r, lastCol, formats);
    else styleNumbers(r, lastCol, formats);
  }
}

// A plain table: one row per item, then a Total row.
function writeTable(sheet: ExcelJS.Worksheet, headers: string[], rows: (string | number)[][], total: (string | number)[]) {
  const lastCol = headers.length;
  styleHeader(sheet.addRow(headers), lastCol);
  for (const r of rows) styleNumbers(sheet.addRow(r), lastCol);
  styleSubtotal(sheet.addRow(total), lastCol);
}

// For NPC, an SBU means its NPC SBUs (Corporate covers Corporate Admin/HR/IT).
const NPC_SBUS_FOR: Record<Sbu, string[]> = {
  CORPORATE: ["CORPORATE_ADMIN", "CORPORATE_HR", "CORPORATE_IT"],
  ESTATES: ["ESTATES"],
  LEISURE: ["LEISURE"],
  MALLS: ["MALLS"],
  OFFICES: ["OFFICES"],
  RESIDENTIAL: ["RESIDENTIAL"],
};

// ---- Board-Approved Budget vs. Total Finalized (Finalized Budget Report page) ----

export type BoardCheckSection = "PL" | "NPC";
export type BoardCheckMeasure = "BOARD" | "FINALIZED" | "VARIANCE";

export interface BoardCheckReportQuery {
  fiscalYear: number;
  sections: BoardCheckSection[];
  measures: BoardCheckMeasure[];
  sbu?: Sbu;
}

const MEASURE_TITLES: Record<BoardCheckMeasure, (year: number) => string> = {
  BOARD: (y) => `Consolidated Board-Approved P&L ${y}`,
  FINALIZED: (y) => `Consolidated Total Finalized P&L ${y}`,
  VARIANCE: (y) => `Consolidated P&L ${y} - Board-Approved vs Total Finalized`,
};
const MEASURE_LABELS: Record<BoardCheckMeasure, string> = {
  BOARD: "Board-Approved",
  FINALIZED: "Total Finalized",
  VARIANCE: "Board-Approved vs Total Finalized",
};
const measureValue = (c: BoardBudgetCheckOut | undefined, m: BoardCheckMeasure) =>
  !c ? 0 : m === "BOARD" ? c.boardApprovedAmount : m === "FINALIZED" ? c.totalFinalizedAmount : c.variance;

export async function buildBoardCheckReport(query: BoardCheckReportQuery): Promise<{ buffer: Buffer; filename: string }> {
  const { boardBudgetChecks } = await getFinalizedBudgetReport({ fiscalYear: query.fiscalYear });
  const columns = query.sbu ? COLUMNS.filter((c) => c.key === query.sbu) : COLUMNS;
  const sbuSuffix = query.sbu ? ` - ${sbuName(query.sbu)}` : "";
  const workbook = new ExcelJS.Workbook();

  if (query.sections.includes("PL")) {
    // GAE's one Corporate figure is stored without an SBU.
    const checkFor = (category: RequestCategory, sbu: Sbu) =>
      boardBudgetChecks.find((c) => c.requestCategory === category && (c.sbu === sbu || (category === RequestCategory.GAE && !c.sbu && sbu === Sbu.CORPORATE)));
    const sheet = workbook.addWorksheet("Consolidated P&L");
    sheet.getColumn(1).width = 38;
    for (let i = 0; i <= columns.length; i++) sheet.getColumn(2 + i).width = 18;
    query.measures.forEach((measure, i) => {
      if (i > 0) sheet.addRow([]);
      const v: Value = (lineId, sbu) => (lineOf(lineId).columns.includes(sbu) ? measureValue(checkFor(lineOf(lineId).category, sbu), measure) : 0);
      writePlBlock(sheet, `${MEASURE_TITLES[measure](query.fiscalYear)}${sbuSuffix}`, columns, !query.sbu, v);
    });
  }

  if (query.sections.includes("NPC")) {
    const allowed = query.sbu ? NPC_SBUS_FOR[query.sbu] : null;
    const npcRows = NPC_SBU_OPTIONS.filter((o) => !allowed || allowed.includes(o.value));
    const checkFor = (npcSbu: string) => boardBudgetChecks.find((c) => c.requestCategory === RequestCategory.NPC && c.npcSbu === npcSbu);
    const sheet = workbook.addWorksheet("NPC");
    sheet.getColumn(1).width = 24;
    query.measures.forEach((_, i) => (sheet.getColumn(2 + i).width = 24));
    writeTable(
      sheet,
      [`Board-Approved NPC Budget ${query.fiscalYear}${sbuSuffix}`, ...query.measures.map((m) => MEASURE_LABELS[m])],
      npcRows.map((o) => [o.label, ...query.measures.map((m) => measureValue(checkFor(o.value), m))]),
      ["Total", ...query.measures.map((m) => npcRows.reduce((sum, o) => sum + measureValue(checkFor(o.value), m), 0))]
    );
  }

  const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
  return { buffer, filename: `board-approved-vs-finalized-${query.fiscalYear}${query.sbu ? `-${sbuName(query.sbu)}` : ""}.xlsx` };
}

// ---- Consolidated Board-Approved P&L / Board-Approved NPC Budget pages ----

// NPC requests counted in Total Approved and Proposed: fully approved, or
// submitted and still in review (see /budget-requests/npc-approved-totals).
export const NPC_UNCOUNTED_STAGES: RequestStage[] = [RequestStage.DRAFT, RequestStage.RETURNED_TO_REQUESTOR, RequestStage.REJECTED, RequestStage.CANCELLED];

export interface BoardApprovedPageReportQuery {
  fiscalYear: number;
  page: "PL" | "NPC";
  // P&L: one SBU (the page's single-SBU view), or every SBU when omitted.
  sbu?: Sbu;
  // NPC: limit the rows to these NPC SBUs (an SBU Finance viewer's own).
  npcSbus?: string[];
}

export async function buildBoardApprovedPageReport(query: BoardApprovedPageReportQuery): Promise<{ buffer: Buffer; filename: string }> {
  const workbook = new ExcelJS.Workbook();
  const history = await prisma.boardApprovedBudget.findMany({ where: { fiscalYear: query.fiscalYear }, orderBy: { setAt: "desc" } });

  if (query.page === "PL") {
    // Board-Approved: latest figure per (category, SBU column); G&A sits in Corporate.
    const columnOf = (category: RequestCategory, sbu: Sbu | null) => (category === RequestCategory.GAE ? Sbu.CORPORATE : sbu);
    const board = new Map<string, number>();
    for (const h of history) {
      if (h.requestCategory === RequestCategory.NPC) continue;
      const k = `${h.requestCategory}|${columnOf(h.requestCategory, h.sbu)}`;
      if (!board.has(k)) board.set(k, h.amount);
    }
    // Total Approved and Proposed: finalized amounts plus requests awaiting
    // Budget Officer review, net of budget cuts - same as the page.
    const approved = new Map<string, number>();
    const add = (category: RequestCategory, sbu: Sbu | null, amount: number) => {
      const k = `${category}|${columnOf(category, sbu)}`;
      approved.set(k, (approved.get(k) ?? 0) + amount);
    };
    const { lines } = await getFinalizedBudgetReport({ fiscalYear: query.fiscalYear });
    for (const l of lines) if (l.requestCategory !== RequestCategory.NPC) add(l.requestCategory, l.sbu, l.amount);
    const pending = await prisma.budgetRequest.findMany({
      where: { currentStage: RequestStage.BUDGET_OFFICER_REVIEW, requestCategory: { not: RequestCategory.NPC } },
      select: { requestCategory: true, sbu: true, proposedAmount: true, budgetCutAmount: true },
    });
    for (const r of pending) add(r.requestCategory, r.sbu, r.proposedAmount - r.budgetCutAmount);

    const lookup = (map: Map<string, number>): Value => (lineId, sbu) => {
      const line = lineOf(lineId);
      return line.columns.includes(sbu) ? map.get(`${line.category}|${sbu}`) ?? 0 : 0;
    };
    const boardValue = lookup(board);
    const approvedValue = lookup(approved);
    const varianceValue: Value = (id, s) => boardValue(id, s) - approvedValue(id, s);

    const sheet = workbook.addWorksheet("Consolidated P&L");
    sheet.getColumn(1).width = 38;
    for (let i = 0; i <= COLUMNS.length; i++) sheet.getColumn(2 + i).width = 18;
    const title = `Consolidated Board-Approved P&L ${query.fiscalYear}`;
    if (query.sbu) {
      writePlMeasuresBlock(sheet, `${title} - ${sbuName(query.sbu)}`, query.sbu, [
        { label: COLUMNS.find((c) => c.key === query.sbu)!.label, value: boardValue },
        { label: "Total Approved and Proposed", value: approvedValue },
        { label: "Variance", value: varianceValue },
        { label: "%", value: varianceValue, percentOf: [varianceValue, boardValue] },
      ]);
    } else {
      writePlBlock(sheet, title, COLUMNS, true, boardValue);
      sheet.addRow([]);
      writePlBlock(sheet, `Total Approved and Proposed ${query.fiscalYear}`, COLUMNS, true, approvedValue);
      sheet.addRow([]);
      writePlBlock(sheet, `Variance ${query.fiscalYear} (Board-Approved less Total Approved and Proposed)`, COLUMNS, true, varianceValue);
    }
    const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
    return { buffer, filename: `consolidated-board-approved-pl-${query.fiscalYear}${query.sbu ? `-${sbuName(query.sbu)}` : ""}.xlsx` };
  }

  // NPC page: Original + Additions/Reductions = Total Board-Approved, less
  // Total Approved and Proposed = Available, one row per NPC SBU.
  const npcRows = NPC_SBU_OPTIONS.filter((o) => !query.npcSbus || query.npcSbus.includes(o.value));
  const latestPart = (npcSbu: string, isAdjustment: boolean) =>
    history.find((h) => h.requestCategory === RequestCategory.NPC && h.npcSbu === npcSbu && h.isAdjustment === isAdjustment)?.amount ?? 0;
  const requests = await prisma.budgetRequest.findMany({
    where: { requestCategory: RequestCategory.NPC, fiscalYear: query.fiscalYear, currentStage: { notIn: NPC_UNCOUNTED_STAGES }, npcSbu: { in: npcRows.map((o) => o.value) } },
    select: { npcSbu: true, proposedAmount: true, budgetCutAmount: true },
  });
  const approvedFor = (npcSbu: string) => requests.filter((r) => r.npcSbu === npcSbu).reduce((sum, r) => sum + r.proposedAmount - r.budgetCutAmount, 0);
  const figures = npcRows.map((o) => {
    const original = latestPart(o.value, false);
    const adjustment = latestPart(o.value, true);
    const approved = approvedFor(o.value);
    return { label: o.label, values: [original, adjustment, original + adjustment, approved, original + adjustment - approved] };
  });
  const sheet = workbook.addWorksheet("Board-Approved NPC Budget");
  sheet.getColumn(1).width = 24;
  for (let i = 0; i < 5; i++) sheet.getColumn(2 + i).width = 22;
  const scopeSuffix = query.npcSbus && npcRows.length === 1 ? ` - ${npcRows[0].label}` : "";
  writeTable(
    sheet,
    [`Board-Approved NPC Budget ${query.fiscalYear}${scopeSuffix}`, "Original Board-Approved", "Board-Approved Additions/Reductions", "Total Board-Approved", "Total Approved and Proposed", "Available"],
    figures.map((f) => [f.label, ...f.values]),
    ["Total", ...[0, 1, 2, 3, 4].map((i) => figures.reduce((sum, f) => sum + f.values[i], 0))]
  );
  const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
  return { buffer, filename: `board-approved-npc-budget-${query.fiscalYear}.xlsx` };
}
