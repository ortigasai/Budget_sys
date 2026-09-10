import ExcelJS from "exceljs";
import { prisma } from "../prisma";
import { HttpError } from "../httpError";
import { getFiscalCycle } from "../lib/fiscalCycle";
import { fetchNpcUtilization } from "../lib/pyBackendClient";
import { fetchSalrRows, type SalrRow } from "../lib/sapBroker";

// Note 11 §8 - NPC Forecast is genuinely new: NPC's real data (budget code,
// project title, IO linkage) lives in BudgetRequest/InternalOrderRequest,
// never in HistoricalActuals (the generic GAE/DOE/Revenue Forecast tables
// this mirrors the shape of, but not the data source). "NPC Budget" comes
// from the same FinalizedBudgetLine snapshot every other "approved budget"
// reader now uses; "IO Budget"/IO linkage comes from Python's existing
// /utilization/npc (no reimplementation of that join).
//
// SAP Requirements integration - "IO Actual" (the column the template's own
// sample file always showed, previously left unfilled since no such figure
// existed) now comes from a live S_ALR_87013019 pull, keyed by AUFNR against
// each matched IO's sap_document_number (only set once that IO has actually
// been uploaded to SAP). An IO with no sap_document_number yet (or one that
// doesn't resolve to a live SALR row) keeps null here, and the
// Total-Actual-+-Forecast/Surplus math falls back to IO Budget as its
// deduction basis, same as before this integration existed.

export interface NpcForecastRow {
  budgetRequestId: string;
  budgetCode: string;
  projectTitle: string;
  npcBudget: number;
  ioCodes: string[];
  ioBudget: number;
  ioActual: number | null; // live SALR Actual, summed across this budget code's uploaded IOs - null if none have a matching live SALR row yet
  npcAvailableBudget: number; // npcBudget - ioBudget
  monthlyRemainingForecast: Record<string, number>;
  remainingMonthsForecast: number;
  totalActualForecast: number; // (ioActual ?? ioBudget) + remainingMonthsForecast
  npcSurplus: number; // npcBudget - totalActualForecast
}

function sumMonthly(forecast: Record<string, number>, months: number[]): number {
  return months.reduce((sum, m) => sum + (forecast[String(m)] ?? 0), 0);
}

export async function getNpcForecastRows(npcSbu: string, authorizationHeader: string): Promise<{ asOfMonth: number; rows: NpcForecastRow[] }> {
  const { targetCalendarYear, asOfMonth } = await getFiscalCycle();
  const remainingMonths = Array.from({ length: 12 - asOfMonth }, (_, i) => asOfMonth + 1 + i);

  const finalizedLines = await prisma.finalizedBudgetLine.findMany({
    where: { requestCategory: "NPC", npcSbu, fiscalYear: targetCalendarYear },
    include: { budgetRequest: true },
  });

  const [ioRows, forecastEntries, salrRows] = await Promise.all([
    fetchNpcUtilization(targetCalendarYear, npcSbu, authorizationHeader),
    prisma.npcForecastEntry.findMany({
      where: { fiscalYear: targetCalendarYear, budgetRequestId: { in: finalizedLines.map((l) => l.budgetRequestId) } },
    }),
    // Best-effort: an NPC Forecast view shouldn't 500 just because the
    // broker is briefly unreachable - IO Actual just falls back to null
    // (same as "no matching SALR row") for every row in that case.
    fetchSalrRows(targetCalendarYear).catch(() => [] as SalrRow[]),
  ]);
  const ioByBudgetCode = new Map(ioRows.map((r) => [r.budgetCode, r]));
  const forecastByRequestId = new Map(forecastEntries.map((e) => [e.budgetRequestId, e]));
  // AUFNR is a 12-digit zero-padded Internal Order number; indexed both as-is
  // and with leading zeros stripped so a sap_document_number stored either
  // way still resolves.
  const salrByAufnr = new Map<string, SalrRow>();
  for (const row of salrRows) {
    salrByAufnr.set(row.AUFNR, row);
    salrByAufnr.set(row.AUFNR.replace(/^0+/, ""), row);
  }

  const rows: NpcForecastRow[] = finalizedLines
    .filter((line) => line.budgetRequest.budgetCode)
    .map((line) => {
      const budgetCode = line.budgetRequest.budgetCode!;
      const io = ioByBudgetCode.get(budgetCode);
      const forecastEntry = forecastByRequestId.get(line.budgetRequestId);
      const monthlyRemainingForecast = (forecastEntry?.monthlyRemainingForecast as Record<string, number>) ?? {};
      const ioBudget = io?.ioAmount ?? 0;

      const matchedSalr = (io?.ioCodes ?? [])
        .map((code) => salrByAufnr.get(code) ?? salrByAufnr.get(code.replace(/^0+/, "")))
        .filter((r): r is SalrRow => Boolean(r));
      const ioActual = matchedSalr.length > 0 ? matchedSalr.reduce((sum, r) => sum + (Number(r.Actual) || 0), 0) : null;

      const remainingMonthsForecast = sumMonthly(monthlyRemainingForecast, remainingMonths);
      const totalActualForecast = (ioActual ?? ioBudget) + remainingMonthsForecast;
      return {
        budgetRequestId: line.budgetRequestId,
        budgetCode,
        projectTitle: line.budgetRequest.projectTitle ?? "",
        npcBudget: line.amount,
        ioCodes: io?.ioCodes ?? [],
        ioBudget,
        ioActual,
        npcAvailableBudget: line.amount - ioBudget,
        monthlyRemainingForecast,
        remainingMonthsForecast,
        totalActualForecast,
        npcSurplus: line.amount - totalActualForecast,
      };
    })
    .sort((a, b) => a.budgetCode.localeCompare(b.budgetCode));

  return { asOfMonth, rows };
}

export async function setNpcForecastMonth(budgetRequestId: string, fiscalYear: number, month: number, value: number, userId: string) {
  const { asOfMonth } = await getFiscalCycle();
  if (month <= asOfMonth) {
    throw new HttpError(400, `Month ${month} is already in Actuals (as-of month is ${asOfMonth}).`);
  }
  const existing = await prisma.npcForecastEntry.findUnique({ where: { budgetRequestId_fiscalYear: { budgetRequestId, fiscalYear } } });
  const current = (existing?.monthlyRemainingForecast as Record<string, number>) ?? {};
  const updated = { ...current, [String(month)]: value };
  return prisma.npcForecastEntry.upsert({
    where: { budgetRequestId_fiscalYear: { budgetRequestId, fiscalYear } },
    update: { monthlyRemainingForecast: updated, updatedById: userId },
    create: { budgetRequestId, fiscalYear, monthlyRemainingForecast: updated, updatedById: userId },
  });
}

function monthColumns(asOfMonth: number): number[] {
  return Array.from({ length: 12 - asOfMonth }, (_, i) => asOfMonth + 1 + i);
}

export async function buildNpcForecastTemplateWorkbook(npcSbu: string, authorizationHeader: string) {
  const { targetCalendarYear, forecastYear, asOfMonth } = await getFiscalCycle();
  const { rows } = await getNpcForecastRows(npcSbu, authorizationHeader);
  const remainingMonths = monthColumns(asOfMonth);
  const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  // Column layout: A-C NPC(Code/Project Title/Budget), D gap, E-H IO(Code/
  // Project Title/Budget), I gap, J NPC Available Budget, K gap,
  // L..(L+n-1) remaining months, next col Total, next gap, next Total Actual
  // + Forecast, next NPC Surplus/(Deficit).
  const monthStartCol = 12; // L
  const totalCol = monthStartCol + remainingMonths.length;
  const totalActualForecastCol = totalCol + 2;
  const surplusCol = totalActualForecastCol + 1;

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Sheet1");

  sheet.getCell("A1").value = "Calendar Year";
  sheet.getCell("B1").value = forecastYear;
  sheet.getCell("A1").font = { bold: true };
  sheet.getCell("A2").value = "SBU";
  sheet.getCell("B2").value = npcSbu;
  sheet.getCell("A2").font = { bold: true };

  sheet.mergeCells(4, 1, 4, 3);
  sheet.getCell(4, 1).value = "NPC";
  sheet.mergeCells(4, 5, 4, 8);
  sheet.getCell(4, 5).value = "IO";
  sheet.mergeCells(4, monthStartCol, 4, totalCol);
  sheet.getCell(4, monthStartCol).value = "Remaining Months Forecast";
  sheet.getRow(4).font = { bold: true };
  sheet.getRow(4).alignment = { horizontal: "center" };

  const header5 = sheet.getRow(5);
  header5.getCell(1).value = "Code";
  header5.getCell(2).value = "Project Title";
  header5.getCell(3).value = "Budget";
  header5.getCell(5).value = "Code";
  header5.getCell(6).value = "Project Title";
  header5.getCell(7).value = "IO Budget";
  // Live SALR-sourced Actual (SAP Requirements integration) - blank for any
  // IO not yet uploaded to SAP or with no matching live SALR row.
  header5.getCell(8).value = "IO Actual";
  header5.getCell(10).value = "NPC Available Budget";
  remainingMonths.forEach((m, i) => {
    header5.getCell(monthStartCol + i).value = MONTH_NAMES[m - 1];
  });
  header5.getCell(totalCol).value = "Total";
  header5.getCell(totalActualForecastCol).value = "Total Actual + Forecast";
  header5.getCell(surplusCol).value = "NPC Surplus/(Deficit)";
  header5.font = { bold: true };

  rows.forEach((r, i) => {
    const rowNumber = 6 + i;
    const row = sheet.getRow(rowNumber);
    row.getCell(1).value = r.budgetCode;
    row.getCell(2).value = r.projectTitle;
    row.getCell(3).value = r.npcBudget;
    row.getCell(5).value = r.ioCodes.join(", ") || null;
    row.getCell(7).value = r.ioBudget;
    row.getCell(8).value = r.ioActual ?? null;
    row.getCell(10).value = { formula: `C${rowNumber}-G${rowNumber}` } as any;
    remainingMonths.forEach((m, mi) => {
      row.getCell(monthStartCol + mi).value = r.monthlyRemainingForecast[String(m)] ?? null;
    });
    const totalColLetter = sheet.getColumn(totalCol).letter;
    const monthStartLetter = sheet.getColumn(monthStartCol).letter;
    const monthEndLetter = sheet.getColumn(totalCol - 1).letter;
    row.getCell(totalCol).value = { formula: `SUM(${monthStartLetter}${rowNumber}:${monthEndLetter}${rowNumber})` } as any;
    row.getCell(totalActualForecastCol).value = { formula: `G${rowNumber}+${totalColLetter}${rowNumber}` } as any;
    row.getCell(surplusCol).value = { formula: `C${rowNumber}-${sheet.getColumn(totalActualForecastCol).letter}${rowNumber}` } as any;
  });

  sheet.getColumn(2).width = 24;
  sheet.getColumn(6).width = 24;
  sheet.getColumn(10).width = 18;
  sheet.getColumn(totalActualForecastCol).width = 20;
  sheet.getColumn(surplusCol).width = 20;

  return workbook;
}

interface NpcForecastParseError {
  row: number;
  error: string;
}

export async function parseNpcForecastTemplate(buffer: Buffer, npcSbu: string, userId: string) {
  const { targetCalendarYear, asOfMonth } = await getFiscalCycle();
  const remainingMonths = monthColumns(asOfMonth);
  const monthStartCol = 12;

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
  const sheet = workbook.worksheets[0];
  if (!sheet) throw new HttpError(400, "The uploaded file has no worksheet.");

  const finalizedLines = await prisma.finalizedBudgetLine.findMany({
    where: { requestCategory: "NPC", npcSbu, fiscalYear: targetCalendarYear },
    include: { budgetRequest: true },
  });
  const lineByBudgetCode = new Map(finalizedLines.filter((l) => l.budgetRequest.budgetCode).map((l) => [l.budgetRequest.budgetCode!, l]));

  const errors: NpcForecastParseError[] = [];
  let updated = 0;

  for (let r = 6; r <= sheet.rowCount; r++) {
    const row = sheet.getRow(r);
    const budgetCode = String(row.getCell(1).value ?? "").trim();
    if (!budgetCode) continue;

    const line = lineByBudgetCode.get(budgetCode);
    if (!line) {
      errors.push({ row: r, error: `"${budgetCode}" doesn't match a finalized NPC project for this SBU.` });
      continue;
    }

    const monthlyRemainingForecast: Record<string, number> = {};
    for (const m of remainingMonths) {
      const cell = row.getCell(monthStartCol + remainingMonths.indexOf(m));
      const raw = cell.value;
      const v = raw === null || raw === undefined || raw === "" ? null : Number(typeof raw === "object" && raw !== null && "result" in (raw as any) ? (raw as any).result : raw);
      if (v !== null) {
        if (Number.isNaN(v)) {
          errors.push({ row: r, error: `"${budgetCode}": the value for month ${m} isn't a number.` });
          continue;
        }
        monthlyRemainingForecast[String(m)] = v;
      }
    }

    await prisma.npcForecastEntry.upsert({
      where: { budgetRequestId_fiscalYear: { budgetRequestId: line.budgetRequestId, fiscalYear: targetCalendarYear } },
      update: { monthlyRemainingForecast, updatedById: userId },
      create: { budgetRequestId: line.budgetRequestId, fiscalYear: targetCalendarYear, monthlyRemainingForecast, updatedById: userId },
    });
    updated++;
  }

  if (errors.length > 0) return { ok: false as const, errors };
  return { ok: true as const, updated };
}
