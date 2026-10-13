import type { BudgetRequest, Sbu } from "../api/client";
import { INPUT_LINES, columnsFor, fmt } from "./BoardApprovedGrid";

// Read-only sections for the All SBUs view of the Consolidated P&L, one table per section, one column per SBU:
//   - Total Approved and Proposed = finalized (approved) amounts + pending proposed amounts, net of budget cuts.
//   - Variance = Board-Approved less Total, so a bracketed figure is over the approved amount.
// For a single SBU, the editable grid itself shows these figures beside the board amounts.

type Entry = { requestCategory: string; sbu: Sbu | null; amount: number };
type HistoryRow = { requestCategory: string; sbu: Sbu | null; amount: number };
type CalcKey = "totalRevenues" | "grossProfit" | "ebitda" | "nibt";
type Row = { kind: "line"; id: string } | { kind: "calc"; key: CalcKey; label: string };
type Value = (lineId: string, sbu: Sbu) => number;

const cellKey = (category: string, column: Sbu) => `${category}|${column}`;
// G&A is stored with no SBU but sits in the Corporate column.
const columnOf = (category: string, sbu: Sbu | null): Sbu | null => (category === "GAE" ? "CORPORATE" : sbu);

const REVENUE_IDS = ["dev", "malls-rev", "offices-rev", "estates-rev"];

// Same row order as the Board-Approved grid.
const ROWS: Row[] = [
  ...REVENUE_IDS.map((id): Row => ({ kind: "line", id })),
  { kind: "calc", key: "totalRevenues", label: "Total Revenues" },
  { kind: "line", id: "cos" },
  { kind: "calc", key: "grossProfit", label: "Gross Profit" },
  { kind: "line", id: "commission" },
  { kind: "line", id: "doe" },
  { kind: "line", id: "ga" },
  { kind: "calc", key: "ebitda", label: "EBITDA" },
  { kind: "line", id: "da" },
  { kind: "line", id: "interest" },
  { kind: "line", id: "other" },
  { kind: "calc", key: "nibt", label: "NIBT" },
];

// Subtotal formulas over one measure, for one SBU column.
const subtotalsOf = (value: Value) => {
  const sumOf = (ids: string[], sbu: Sbu) => ids.reduce((s, id) => s + value(id, sbu), 0);
  const totalRevenues = (sbu: Sbu) => sumOf(REVENUE_IDS, sbu);
  const grossProfit = (sbu: Sbu) => totalRevenues(sbu) - value("cos", sbu);
  const ebitda = (sbu: Sbu) => grossProfit(sbu) - value("commission", sbu) - value("doe", sbu) - value("ga", sbu);
  const nibt = (sbu: Sbu) => ebitda(sbu) - value("da", sbu) - value("interest", sbu) + value("other", sbu);
  return { totalRevenues, grossProfit, ebitda, nibt };
};

const labelOf = (row: Row) => (row.kind === "line" ? (INPUT_LINES.find((l) => l.id === row.id)?.label ?? row.id) : row.label);

// Negatives turn red on line items only; subtotal rows keep their own colors.
const numCls = (v: number, bold: boolean, subtotal: boolean, negativeRed: boolean) => {
  const base = "py-1 px-2 text-right tabular-nums";
  const red = negativeRed && !subtotal && v < -0.5 ? "text-red-700" : "";
  return `${base} ${bold ? "font-semibold" : ""} ${red}`.trim();
};

// Total Approved and Proposed per (line, SBU): finalized amounts plus pending proposed, net of budget cuts.
// Exported so the single-SBU grid can show the same figures beside its board amounts.
export function approvedProposedLookup(requests: BudgetRequest[], finalized: Entry[]): Value {
  const total = new Map<string, number>();
  const add = (category: string, sbu: Sbu | null, amount: number) => {
    const col = columnOf(category, sbu);
    if (!col) return;
    const k = cellKey(category, col);
    total.set(k, (total.get(k) ?? 0) + amount);
  };
  for (const r of requests) add(r.requestCategory, r.sbu, r.proposedAmount - r.budgetCutAmount);
  for (const f of finalized) add(f.requestCategory, f.sbu, f.amount);
  return (lineId, sbu) => {
    const line = INPUT_LINES.find((l) => l.id === lineId);
    if (!line || !line.columns.includes(sbu)) return 0;
    return total.get(cellKey(line.category, sbu)) ?? 0;
  };
}

// All SBUs: one column per SBU, with Total Approved and Proposed and Variance as separate tables.
export function ConsolidatedTotalsTables({
  history,
  requests,
  finalized,
}: {
  history: HistoryRow[];
  requests: BudgetRequest[];
  finalized: Entry[];
}) {
  // Latest Board-Approved amount per (category, column). History is newest-first.
  const board = new Map<string, number>();
  for (const h of history) {
    const col = columnOf(h.requestCategory, h.sbu);
    if (!col) continue;
    const k = cellKey(h.requestCategory, col);
    if (!board.has(k)) board.set(k, h.amount);
  }
  const boardValue: Value = (lineId, sbu) => {
    const line = INPUT_LINES.find((l) => l.id === lineId);
    if (!line || !line.columns.includes(sbu)) return 0;
    return board.get(cellKey(line.category, sbu)) ?? 0;
  };
  const totalValue = approvedProposedLookup(requests, finalized);
  const varianceValue: Value = (lineId, sbu) => boardValue(lineId, sbu) - totalValue(lineId, sbu);

  const columns = columnsFor("ALL");
  const sections = [
    { title: "Total Approved and Proposed", note: "Finalized (approved) plus pending proposed, net of budget cuts.", value: totalValue, negativeRed: false },
    { title: "Variance", note: "Board-Approved less Total. Bracketed figures are over the Board-Approved amount.", value: varianceValue, negativeRed: true },
  ];

  return (
    <div className="space-y-6">
      {sections.map((section) => {
        const fns = subtotalsOf(section.value);
        return (
          <div key={section.title} className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
            <div className="mb-3">
              <h3 className="text-sm font-semibold text-slate-800">{section.title}</h3>
              <p className="mt-0.5 text-xs text-slate-500">{section.note}</p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-xs">
                <thead>
                  <tr className="border-b border-emerald-200 bg-[#edf6f1] text-[#164b33]">
                    <th className="py-1.5 pr-3 text-left font-semibold">Consolidated P&amp;L 2027</th>
                    {columns.map((c) => (
                      <th key={c.key} className="px-2 py-1.5 text-right font-semibold">
                        {c.label}
                      </th>
                    ))}
                    <th className="px-2 py-1.5 text-right font-semibold">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {ROWS.map((row, i) => {
                    const subtotal = row.kind === "calc";
                    const cellValue = (sbu: Sbu) => (row.kind === "line" ? section.value(row.id, sbu) : fns[row.key](sbu));
                    const rowTotal = columns.reduce((s, c) => s + cellValue(c.key), 0);
                    return (
                      <tr key={i} className={`border-t border-slate-100 ${subtotal ? "bg-[#edf6f1] text-[#164b33]" : ""}`}>
                        <td className={`py-1 pr-3 text-left ${subtotal ? "font-semibold" : ""}`}>{labelOf(row)}</td>
                        {columns.map((c) => {
                          const v = cellValue(c.key);
                          return (
                            <td key={c.key} className={numCls(v, subtotal, subtotal, section.negativeRed)}>
                              {fmt(v)}
                            </td>
                          );
                        })}
                        <td className={numCls(rowTotal, true, subtotal, section.negativeRed)}>{fmt(rowTotal)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        );
      })}
    </div>
  );
}
