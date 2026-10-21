import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api, type Sbu } from "../api/client";

// The Board-Approved budget grid, laid out like the "BOD Approved" P&L sheet:
// one row per budget line, one column per SBU. Only the budget lines are inputs;
// the subtotals and profit lines (Total Revenues, Gross Profit, EBITDA, NIBT) are
// calculated. RBU is the Residential SBU. G&A is one Corporate figure (no SBU).

export type BoardCategory =
  | "REVENUE"
  | "COST_OF_SALES"
  | "COMMISSION"
  | "DOE"
  | "GAE"
  | "DEPRECIATION_AMORTIZATION"
  | "INTEREST_EXPENSE"
  | "OTHER_INCOME";

export interface BoardBudgetRow {
  requestCategory: BoardCategory;
  sbu: Sbu | null;
  amount: number;
  setAt: string;
  setByName?: string | null;
}

const CATEGORY_LABEL: Record<BoardCategory, string> = {
  REVENUE: "Revenue",
  COST_OF_SALES: "Cost of Sales",
  COMMISSION: "Commission",
  DOE: "Direct Operating Expenses",
  GAE: "General & Administrative Expenses",
  DEPRECIATION_AMORTIZATION: "Depreciation & Amortization",
  INTEREST_EXPENSE: "Interest expense",
  OTHER_INCOME: "Other income",
};

// Alphabetical, like every other SBU list (RBU is Residential).
export const COLUMNS: { key: Sbu; label: string }[] = [
  { key: "CORPORATE", label: "Corporate" },
  { key: "ESTATES", label: "Estates" },
  { key: "LEISURE", label: "Leisure" },
  { key: "MALLS", label: "Malls" },
  { key: "OFFICES", label: "Offices" },
  { key: "RESIDENTIAL", label: "RBU" },
];

const ALL: Sbu[] = ["CORPORATE", "ESTATES", "LEISURE", "MALLS", "OFFICES", "RESIDENTIAL"];

// Columns to show: every SBU, or only the selected one when the page's SBU filter is set.
export function columnsFor(sbuFilter?: Sbu | "ALL") {
  return sbuFilter && sbuFilter !== "ALL" ? COLUMNS.filter((c) => c.key === sbuFilter) : COLUMNS;
}

// Input lines, with the SBU columns each one applies to (matching the sheet).
export const INPUT_LINES: { id: string; label: string; category: BoardCategory; columns: Sbu[] }[] = [
  { id: "dev", label: "Development (Vertical + Horizontal)", category: "REVENUE", columns: ["RESIDENTIAL"] },
  { id: "malls-rev", label: "Malls", category: "REVENUE", columns: ["MALLS"] },
  { id: "offices-rev", label: "Offices", category: "REVENUE", columns: ["OFFICES"] },
  { id: "estates-rev", label: "Estates", category: "REVENUE", columns: ["ESTATES"] },
  { id: "cos", label: "Cost of Sales", category: "COST_OF_SALES", columns: ["RESIDENTIAL"] },
  { id: "commission", label: "Commission", category: "COMMISSION", columns: ["RESIDENTIAL"] },
  { id: "doe", label: "Direct Operating Expenses", category: "DOE", columns: ALL },
  { id: "ga", label: "General and Administrative Expenses", category: "GAE", columns: ["CORPORATE"] },
  { id: "da", label: "Depreciation & Amortization", category: "DEPRECIATION_AMORTIZATION", columns: ["RESIDENTIAL", "MALLS", "OFFICES", "ESTATES", "CORPORATE"] },
  { id: "interest", label: "Interest expense", category: "INTEREST_EXPENSE", columns: ["RESIDENTIAL", "MALLS", "OFFICES", "ESTATES"] },
  { id: "other", label: "Other income", category: "OTHER_INCOME", columns: ["CORPORATE"] },
];

const keyOf = (category: BoardCategory, sbu: Sbu | null) => `${category}|${sbu ?? ""}`;
const storedSbu = (category: BoardCategory, sbu: Sbu) => (category === "GAE" ? null : sbu);

export function fmt(n: number) {
  if (Math.abs(n) < 0.5) return "—";
  return n < 0 ? `(${Math.round(-n).toLocaleString()})` : Math.round(n).toLocaleString();
}

// Reads what the user typed: commas and spaces are ignored; "(1,000)" or "-1,000" is negative.
function parseAmount(s: string): number {
  const t = s.trim();
  if (!t) return 0;
  const n = Number(t.replace(/[^0-9.]/g, ""));
  if (!Number.isFinite(n)) return 0;
  return t.startsWith("(") || t.startsWith("-") ? -n : n;
}

// Subtotal formulas over one measure (the same ones the board grid uses), for one SBU column.
function subtotalsOf(value: (lineId: string, sbu: Sbu) => number) {
  const totalRevenues = (sbu: Sbu) => ["dev", "malls-rev", "offices-rev", "estates-rev"].reduce((s, id) => s + value(id, sbu), 0);
  const grossProfit = (sbu: Sbu) => totalRevenues(sbu) - value("cos", sbu);
  const ebitda = (sbu: Sbu) => grossProfit(sbu) - value("commission", sbu) - value("doe", sbu) - value("ga", sbu);
  const nibt = (sbu: Sbu) => ebitda(sbu) - value("da", sbu) - value("interest", sbu) + value("other", sbu);
  return { totalRevenues, grossProfit, ebitda, nibt };
}

// Percent of the Board-Approved amount; a dash when zero, bracketed when negative.
function fmtPct(p: number | null) {
  if (p === null || Math.abs(p) < 0.5) return "—";
  return p < 0 ? `(${Math.round(-p)}%)` : `${Math.round(p)}%`;
}

export function BoardApprovedGrid({
  fiscalYear,
  history,
  sbuFilter,
  actual,
  readOnly = false,
}: {
  fiscalYear: number;
  history: BoardBudgetRow[];
  sbuFilter?: Sbu | "ALL";
  // Total Approved and Proposed for a line in one column; shown beside the board figures for one SBU.
  actual?: (lineId: string, sbu: Sbu) => number;
  // BCA members can view this grid (and its History) but not edit it - see
  // requireRoleOrAccess("finalization") on the backend save routes.
  readOnly?: boolean;
}) {
  const queryClient = useQueryClient();
  const columns = columnsFor(sbuFilter);
  // The Total column only makes sense across all SBUs; a single-SBU view shows the measures instead.
  const showTotal = !sbuFilter || sbuFilter === "ALL";
  const measures = !showTotal && !!actual;

  // Latest amount per (category, SBU). History is newest-first, so the first match wins.
  const latest = new Map<string, number>();
  for (const h of history) {
    const k = keyOf(h.requestCategory, h.sbu);
    if (!latest.has(k)) latest.set(k, h.amount);
  }

  const [draft, setDraft] = useState<Record<string, string>>({});
  const [focusKey, setFocusKey] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);

  // The value shown for an input cell: what the user typed, else the latest saved amount.
  const cellValue = (category: BoardCategory, sbu: Sbu): number => {
    const k = keyOf(category, storedSbu(category, sbu));
    const typed = draft[k];
    if (typed !== undefined) return parseAmount(typed);
    return latest.get(k) ?? 0;
  };

  // Input line value for a column (zero if the line doesn't apply to that column).
  const lineValue = (lineId: string, sbu: Sbu): number => {
    const line = INPUT_LINES.find((l) => l.id === lineId);
    if (!line || !line.columns.includes(sbu)) return 0;
    return cellValue(line.category, sbu);
  };

  // Calculated lines, per column.
  const totalRevenues = (sbu: Sbu) => ["dev", "malls-rev", "offices-rev", "estates-rev"].reduce((s, id) => s + lineValue(id, sbu), 0);
  const grossProfit = (sbu: Sbu) => totalRevenues(sbu) - lineValue("cos", sbu);
  const ebitda = (sbu: Sbu) => grossProfit(sbu) - lineValue("commission", sbu) - lineValue("doe", sbu) - lineValue("ga", sbu);
  const nibt = (sbu: Sbu) => ebitda(sbu) - lineValue("da", sbu) - lineValue("interest", sbu) + lineValue("other", sbu);

  // Total Approved and Proposed for the same rows (single-SBU view only).
  const actualOf = (lineId: string, sbu: Sbu) => actual?.(lineId, sbu) ?? 0;
  const actualFns = subtotalsOf(actualOf);

  const changedCells = () => {
    const cells: { requestCategory: BoardCategory; sbu: Sbu | null; amount: number }[] = [];
    for (const line of INPUT_LINES) {
      for (const sbu of line.columns) {
        const k = keyOf(line.category, storedSbu(line.category, sbu));
        if (draft[k] === undefined) continue;
        const amount = parseAmount(draft[k]);
        if ((latest.get(k) ?? 0) === amount) continue;
        cells.push({ requestCategory: line.category, sbu: storedSbu(line.category, sbu), amount });
      }
    }
    return cells;
  };

  const save = useMutation({
    mutationFn: async () => (await api.post<{ saved: number }>("/admin/board-approved-budget/bulk", { fiscalYear, cells: changedCells() })).data,
    onSuccess: (data) => {
      setMessage(data.saved > 0 ? `Saved ${data.saved} change(s).` : "No changes to save.");
      setDraft({});
      queryClient.invalidateQueries({ queryKey: ["board-approved-budget"] });
    },
    onError: () => setMessage("Could not save the Board-Approved budget."),
  });

  const rowCls = "border-t border-slate-100";
  const labelCls = "py-1 pr-3 text-left";
  const numCls = "py-1 px-2 text-right tabular-nums";
  const totalCls = "py-1 px-2 text-right font-semibold tabular-nums";

  const sumOver = (f: (sbu: Sbu) => number) => columns.reduce((s, c) => s + f(c.key), 0);

  // Cells after the SBU columns: a Total across SBUs, or Total Approved and Proposed, Variance and % for one SBU.
  const trailingCells = (board: number, approved: number, subtotal: boolean) => {
    if (!measures) return showTotal ? <td className={totalCls}>{fmt(board)}</td> : null;
    const variance = board - approved;
    const pct = board === 0 ? null : (variance / board) * 100;
    return (
      <>
        <td className={numCls}>{fmt(approved)}</td>
        <td className={`${numCls} ${!subtotal && variance < -0.5 ? "text-red-700" : ""}`}>{fmt(variance)}</td>
        <td className={numCls}>{fmtPct(pct)}</td>
      </>
    );
  };

  const inputRow = (line: (typeof INPUT_LINES)[number]) => (
    <tr key={line.id} className={rowCls}>
      <td className={labelCls}>{line.label}</td>
      {columns.map((c) => {
        if (!line.columns.includes(c.key)) return <td key={c.key} className={numCls}>—</td>;
        const k = keyOf(line.category, storedSbu(line.category, c.key));
        const raw = draft[k] ?? String(latest.get(k) ?? "");
        if (readOnly) return <td key={c.key} className={numCls}>{fmt(parseAmount(raw))}</td>;
        // Accounting format when not editing; raw digits while the cell has focus.
        const shown = focusKey === k ? raw : fmt(parseAmount(raw));
        return (
          <td key={c.key} className="px-1 py-1">
            <input
              type="text"
              inputMode="decimal"
              className="w-32 rounded border border-slate-300 px-2 py-1 text-right text-xs tabular-nums"
              value={shown}
              onFocus={() => setFocusKey(k)}
              onBlur={() => setFocusKey(null)}
              onChange={(e) => setDraft((d) => ({ ...d, [k]: e.target.value.replace(/[^0-9.\-()]/g, "") }))}
            />
          </td>
        );
      })}
      {trailingCells(sumOver((sbu) => lineValue(line.id, sbu)), sumOver((sbu) => actualOf(line.id, sbu)), false)}
    </tr>
  );

  const calcRow = (label: string, fn: (sbu: Sbu) => number, emphasis = false, actualFn?: (sbu: Sbu) => number) => (
    <tr key={label} className={`${rowCls} ${emphasis ? "bg-[#edf6f1] font-semibold text-[#164b33]" : ""}`}>
      <td className={labelCls}>{label}</td>
      {columns.map((c) => (
        <td key={c.key} className={numCls}>
          {fmt(fn(c.key))}
        </td>
      ))}
      {trailingCells(sumOver(fn), actualFn ? sumOver(actualFn) : 0, true)}
    </tr>
  );

  const sectionRow = (label: string) => (
    <tr key={label} className="bg-slate-50">
      <td colSpan={1 + columns.length + (measures ? 3 : showTotal ? 1 : 0)} className="py-1 pr-3 text-left text-xs font-semibold text-slate-600">
        {label}
      </td>
    </tr>
  );

  return (
    <div className="space-y-3">
      <div className={`overflow-x-auto rounded-lg border border-slate-200 bg-white ${measures ? "mx-auto w-fit max-w-full" : ""}`}>
        <table className={`${showTotal ? "w-full" : "w-auto"} text-xs`}>
          <thead className="bg-[#edf6f1] text-[#164b33]">
            <tr>
              <th className="py-2 pr-3 text-left">Consolidated Board-Approved P&amp;L {fiscalYear}</th>
              {columns.map((c) => (
                <th key={c.key} className="px-2 py-2 text-right">
                  {c.label}
                </th>
              ))}
              {measures ? (
                <>
                  <th className="px-2 py-2 text-right">Total Approved and Proposed</th>
                  <th className="px-2 py-2 text-right">Variance</th>
                  <th className="px-2 py-2 text-right">%</th>
                </>
              ) : (
                showTotal && <th className="px-2 py-2 text-right">Total</th>
              )}
            </tr>
          </thead>
          <tbody>
            {sectionRow("Revenues")}
            {inputRow(INPUT_LINES[0])}
            {inputRow(INPUT_LINES[1])}
            {inputRow(INPUT_LINES[2])}
            {inputRow(INPUT_LINES[3])}
            {calcRow("Total Revenues", totalRevenues, true, actualFns.totalRevenues)}
            {inputRow(INPUT_LINES[4])}
            {calcRow("Gross Profit", grossProfit, true, actualFns.grossProfit)}
            {inputRow(INPUT_LINES[5])}
            {inputRow(INPUT_LINES[6])}
            {inputRow(INPUT_LINES[7])}
            {calcRow("EBITDA", ebitda, true, actualFns.ebitda)}
            {inputRow(INPUT_LINES[8])}
            {inputRow(INPUT_LINES[9])}
            {inputRow(INPUT_LINES[10])}
            {calcRow("NIBT", nibt, true, actualFns.nibt)}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        {readOnly ? (
          <span className="text-xs text-slate-400">View only</span>
        ) : (
          <>
            <button
              type="button"
              onClick={() => save.mutate()}
              disabled={save.isPending || changedCells().length === 0}
              className="rounded-md bg-emerald-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-600 disabled:opacity-50"
            >
              {save.isPending ? "Saving…" : "Save Board-Approved Budget"}
            </button>
            <span className="text-xs text-slate-500">
              {changedCells().length} changed · Each save is recorded in the history below.
            </span>
          </>
        )}
        {message && <span className="text-xs text-slate-700">{message}</span>}
        <button type="button" onClick={() => setShowHistory((v) => !v)} className="ml-auto rounded-md border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100">
          {showHistory ? "Hide History" : "History"}
        </button>
      </div>

      {showHistory && (
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="w-full text-xs">
            <thead className="bg-slate-50 text-left text-slate-600">
              <tr>
                <th className="px-3 py-2">Saved</th>
                <th className="px-3 py-2">Line</th>
                <th className="px-3 py-2">SBU</th>
                <th className="px-3 py-2 text-right">Amount</th>
                <th className="px-3 py-2">Saved by</th>
              </tr>
            </thead>
            <tbody>
              {history.length === 0 && (<tr><td colSpan={5} className="px-3 py-3 text-slate-400">No Board-Approved budget has been saved for this year yet.</td></tr>)}
              {history.map((h, i) => (
                <tr key={i} className="border-t border-slate-100">
                  <td className="px-3 py-1.5">{new Date(h.setAt).toLocaleString("en-PH", { dateStyle: "medium", timeStyle: "short" })}</td>
                  <td className="px-3 py-1.5">{CATEGORY_LABEL[h.requestCategory]}</td>
                  <td className="px-3 py-1.5">{h.sbu ? (COLUMNS.find((c) => c.key === h.sbu)?.label ?? h.sbu) : "Corporate / —"}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{fmt(h.amount)}</td>
                  <td className="px-3 py-1.5">{h.setByName ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
