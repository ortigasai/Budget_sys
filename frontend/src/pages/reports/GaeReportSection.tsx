import { Fragment } from "react";
import { useQuery } from "@tanstack/react-query";
import { api2 } from "../../api/client";

// The GAE report (Main Report, with the Detailed Report below it). Every
// Primary Comparison reads the same monthly series from the backend; this
// component only picks the months (YTD or full year) and the two measures the
// chosen comparison sets side by side.

interface SeriesOut {
  budget: number[];
  actual: number[];
  forecast: number[];
  ly: number[];
  lyBudget: number[];
}
interface ReportRowOut {
  key: string;
  label: string;
  level: number;
  isTotal: boolean;
  series: SeriesOut;
}
interface GaeReportOut {
  fiscalYear: number;
  asOfMonth: number;
  main: ReportRowOut[];
  detailed: ReportRowOut[];
  unmappedSubTypes: string[];
}

type Measure = keyof SeriesOut;
type PairId =
  | "budget-actual"
  | "budget-forecast"
  | "forecast-actual"
  | "cy-actual-ly-actual"
  | "cy-budget-ly-budget"
  | "cy-budget-ly-actual"
  | "cy-forecast-ly-actual"
  | "cy-forecast-ly-budget";

// "Last Year Comparisons" sidebar entries - always "Current Year X vs Last
// Year Y" (left = CY measure, right = LY measure), matching Layout.tsx's
// sidebar id convention below.
export const LAST_YEAR_COMPARISON_IDS = ["cy-actual-ly-actual", "cy-budget-ly-budget", "cy-budget-ly-actual", "cy-forecast-ly-actual", "cy-forecast-ly-budget"] as const;

const PAIRS: Record<PairId, { left: Measure; right: Measure; leftLabel: string; rightLabel: string }> = {
  "budget-actual": { left: "budget", right: "actual", leftLabel: "Budget", rightLabel: "Actual" },
  "budget-forecast": { left: "budget", right: "forecast", leftLabel: "Budget", rightLabel: "Forecast" },
  "forecast-actual": { left: "forecast", right: "actual", leftLabel: "Forecast", rightLabel: "Actual" },
  "cy-actual-ly-actual": { left: "actual", right: "ly", leftLabel: "CY Actual", rightLabel: "LY Actual" },
  "cy-budget-ly-budget": { left: "budget", right: "lyBudget", leftLabel: "CY Budget", rightLabel: "LY Budget" },
  "cy-budget-ly-actual": { left: "budget", right: "ly", leftLabel: "CY Budget", rightLabel: "LY Actual" },
  "cy-forecast-ly-actual": { left: "forecast", right: "ly", leftLabel: "CY Forecast", rightLabel: "LY Actual" },
  "cy-forecast-ly-budget": { left: "forecast", right: "lyBudget", leftLabel: "CY Forecast", rightLabel: "LY Budget" },
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const fmt = (n: number) => (Math.abs(n) < 0.5 ? "—" : Math.round(n).toLocaleString(undefined, { maximumFractionDigits: 0 }));
const pct = (variance: number, base: number) => (Math.abs(base) < 0.5 ? "—" : `${((variance / Math.abs(base)) * 100).toFixed(1)}%`);
const sumRange = (values: number[], months: number[]) => months.reduce((acc, m) => acc + (values[m - 1] ?? 0), 0);

// Truncating the text itself (not CSS white-space: nowrap + text-overflow:
// ellipsis) - a long label like "Donations, Contributions and Miscellaneous
// Expenses" under that CSS approach still forces its table-layout: fixed
// column wider than its colgroup width in every browser tested, throwing
// the Main Report and Detailed Report tables (which share one colgroup) out
// of alignment with each other. Pre-shortening the string sidesteps that
// entirely.
const truncateLabel = (label: string, maxChars = 34) => (label.length > maxChars ? `${label.slice(0, maxChars - 1)}…` : label);

export function GaeReportSection({ fiscalYear, granularity, comparison, ytdThrough, measure }: { fiscalYear: number; granularity: "YTD" | "ANNUAL"; comparison: string; ytdThrough?: number; measure?: SingleMeasure }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ["reports", "gae-report", fiscalYear],
    queryFn: async () => (await api2.get<GaeReportOut>("/reports/gae-report", { params: { fiscalYear } })).data,
  });

  if (isLoading) return <div className="rounded-lg border border-slate-200 bg-white p-4 text-sm text-slate-500">Loading GAE report…</div>;
  if (error || !data) return <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">Could not load the GAE report.</div>;

  const asOf = ytdThrough || data.asOfMonth || 12;
  const months = granularity === "YTD" ? Array.from({ length: asOf }, (_, i) => i + 1) : Array.from({ length: 12 }, (_, i) => i + 1);
  const periodLabel = granularity === "YTD" ? `Jan–${MONTHS[asOf - 1]} ${fiscalYear}` : `Full year ${fiscalYear}`;
  const quarters = [1, 2, 3, 4].filter((q) => months.some((m) => Math.ceil(m / 3) === q));

  const pair = comparison in PAIRS ? PAIRS[comparison as PairId] : null;
  const isMonthly = comparison === "monthly-comparison";

  // Monthly / Quarterly with a single measure: one column per month or quarter.
  const measureLabel = measure ? measure[0].toUpperCase() + measure.slice(1) : "";

  // Main Report and Detailed Report render the same headerCells()/cells()
  // shape but hold different rows - under table-layout: auto, each table's
  // column widths are computed independently from its own widest content
  // (long Detailed Report labels like "Donations, Contributions and
  // Miscellaneous Expenses" can force its label column wider than Main
  // Report's), so the two tables can drift out of alignment with each other
  // even with the same min-width classes. An explicit colgroup + table-fixed
  // (below) makes both tables' column widths identical and content-independent.
  const dataColumnCount = pair ? 4 : measure ? (isMonthly ? months.length : quarters.length) + 1 : isMonthly ? months.length * 2 : quarters.length * 3;
  const LABEL_COL_WIDTH = 320;
  const DATA_COL_WIDTH = 160;
  // Explicit total, used below instead of a shrink-to-fit (w-fit) wrapper -
  // with table-layout: fixed, a w-fit wrapper creates a circular sizing pass
  // where the browser falls back to measuring actual cell content (ignoring
  // the colgroup) to decide how wide the wrapper should shrink to, which is
  // exactly what let one table's longest label (e.g. "Donations,
  // Contributions and Miscellaneous Expenses" in the Detailed Report) widen
  // its column beyond the other table's, breaking alignment between them.
  const tableWidthPx = LABEL_COL_WIDTH + dataColumnCount * DATA_COL_WIDTH;
  const colgroup = (
    <colgroup>
      <col style={{ width: LABEL_COL_WIDTH }} />
      {Array.from({ length: dataColumnCount }, (_, i) => (
        <col key={i} style={{ width: DATA_COL_WIDTH }} />
      ))}
    </colgroup>
  );

  const headerCells = () => {
    if (pair) {
      return (
        <>
          <th className="min-w-[160px] px-5 py-2 text-right">{pair.leftLabel}</th>
          <th className="min-w-[160px] px-5 py-2 text-right">{pair.rightLabel}</th>
          <th className="min-w-[160px] px-5 py-2 text-right">Variance</th>
          <th className="min-w-[160px] px-5 py-2 text-right">Variance %</th>
        </>
      );
    }
    if (measure) {
      return (
        <>
          {isMonthly
            ? months.map((m) => (
                <th key={`hm${m}`} className="min-w-[160px] px-5 py-2 text-right">
                  {MONTHS[m - 1]}
                </th>
              ))
            : quarters.map((q) => (
                <th key={`hq${q}`} className="min-w-[160px] px-5 py-2 text-right">
                  Q{q} {measureLabel}
                </th>
              ))}
          <th className="min-w-[160px] px-5 py-2 text-right">Total</th>
        </>
      );
    }
    if (isMonthly) {
      return (
        <>
          {months.map((m) => (
            <Fragment key={`hm${m}`}>
              <th className="min-w-[160px] px-5 py-2 text-right">{MONTHS[m - 1]} Budget</th>
              <th className="min-w-[160px] px-5 py-2 text-right">{MONTHS[m - 1]} Actual</th>
            </Fragment>
          ))}
        </>
      );
    }
    return (
      <>
        {quarters.map((q) => (
          <Fragment key={`hq${q}`}>
            <th className="min-w-[160px] px-5 py-2 text-right">Q{q} Budget</th>
            <th className="min-w-[160px] px-5 py-2 text-right">Q{q} Actual</th>
            <th className="min-w-[160px] px-5 py-2 text-right">Q{q} Variance</th>
          </Fragment>
        ))}
      </>
    );
  };

  const cells = (row: ReportRowOut) => {
    if (pair) {
      const left = sumRange(row.series[pair.left], months);
      const right = sumRange(row.series[pair.right], months);
      const variance = right - left;
      return (
        <>
          <td className="min-w-[160px] px-5 py-1 text-right tabular-nums">{fmt(left)}</td>
          <td className="min-w-[160px] px-5 py-1 text-right tabular-nums">{fmt(right)}</td>
          <td className="min-w-[160px] px-5 py-1 text-right tabular-nums">{fmt(variance)}</td>
          <td className="min-w-[160px] px-5 py-1 text-right tabular-nums">{pct(variance, left)}</td>
        </>
      );
    }
    if (measure) {
      return (
        <>
          {isMonthly
            ? months.map((m) => (
                <td key={`cm${m}`} className="min-w-[160px] px-5 py-1 text-right tabular-nums">
                  {fmt(row.series[measure][m - 1])}
                </td>
              ))
            : quarters.map((q) => (
                <td key={`cq${q}`} className="min-w-[160px] px-5 py-1 text-right tabular-nums">
                  {fmt(sumRange(row.series[measure], months.filter((m) => Math.ceil(m / 3) === q)))}
                </td>
              ))}
          <td className="min-w-[160px] px-5 py-1 text-right font-semibold tabular-nums">{fmt(sumRange(row.series[measure], months))}</td>
        </>
      );
    }
    if (isMonthly) {
      return (
        <>
          {months.map((m) => (
            <Fragment key={`cm${m}`}>
              <td className="min-w-[160px] px-5 py-1 text-right tabular-nums">{fmt(row.series.budget[m - 1])}</td>
              <td className="min-w-[160px] px-5 py-1 text-right tabular-nums">{fmt(row.series.actual[m - 1])}</td>
            </Fragment>
          ))}
        </>
      );
    }
    return (
      <>
        {quarters.map((q) => {
          const qm = months.filter((m) => Math.ceil(m / 3) === q);
          const b = sumRange(row.series.budget, qm);
          const a = sumRange(row.series.actual, qm);
          return (
            <Fragment key={`cq${q}`}>
              <td className="min-w-[160px] px-5 py-1 text-right tabular-nums">{fmt(b)}</td>
              <td className="min-w-[160px] px-5 py-1 text-right tabular-nums">{fmt(a)}</td>
              <td className="min-w-[160px] px-5 py-1 text-right tabular-nums">{fmt(a - b)}</td>
            </Fragment>
          );
        })}
      </>
    );
  };

  const renderRows = (rows: ReportRowOut[]) =>
    rows.map((row) => (
      <tr key={row.key} className={`border-t border-slate-100 ${row.isTotal ? "bg-[#edf6f1] font-semibold text-[#164b33]" : ""}`}>
        <td className={`sticky left-0 z-10 min-w-[320px] overflow-hidden px-5 py-1 ${row.isTotal ? "bg-[#edf6f1]" : "bg-white"} ${row.level === 1 ? "pl-8" : ""}`} title={row.label.length > 34 ? row.label : undefined}>
          {truncateLabel(row.label)}
        </td>
        {cells(row)}
      </tr>
    ));

  return (
    <section className="space-y-4 rounded-lg border border-emerald-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-base font-semibold text-slate-800">GAE Report</h2>
        <span className="text-xs text-slate-500">{periodLabel} · Amounts in PHP</span>
      </div>

      {/* No w-full on the table - a wide viewport would otherwise stretch
          it to fill the page, spreading its mostly-numeric columns across
          large gaps of empty space even though each column's header and
          data cells stay pixel-aligned to each other. The bordered wrapper
          gets an explicit pixel width (tableWidthPx), not w-fit - a
          shrink-to-fit wrapper around a table-layout: fixed table measures
          actual cell content to decide its own width, which can make this
          table wider than the Detailed Report table below despite both
          using the same colgroup (see tableWidthPx's comment). max-w-full
          keeps it horizontally scrollable if that width ever exceeds the
          container. */}
      <div className="max-w-full overflow-auto rounded-lg border border-emerald-200" style={{ maxHeight: "70vh", width: tableWidthPx }}>
        <table className="table-fixed text-sm">
          {colgroup}
          <thead className="sticky top-0 z-20 bg-[#edf6f1] text-left text-xs text-[#164b33]">
            <tr>
              <th className="sticky left-0 z-30 bg-[#edf6f1] px-5 py-2">Main Report</th>
              {headerCells()}
            </tr>
          </thead>
          <tbody>{renderRows(data.main)}</tbody>
        </table>
      </div>

      <h3 className="pt-2 text-sm font-semibold text-slate-800">Detailed Report</h3>
      <div className="max-w-full overflow-auto rounded-lg border border-emerald-200" style={{ maxHeight: "70vh", width: tableWidthPx }}>
        <table className="table-fixed text-sm">
          {colgroup}
          <thead className="sticky top-0 z-20 bg-[#edf6f1] text-left text-xs text-[#164b33]">
            <tr>
              <th className="sticky left-0 z-30 bg-[#edf6f1] px-5 py-2">Detailed Report</th>
              {headerCells()}
            </tr>
          </thead>
          <tbody>{renderRows(data.detailed)}</tbody>
        </table>
      </div>

      {data.unmappedSubTypes.length > 0 && (
        <p className="text-xs text-slate-500">Mapped sub types not listed in the Detailed Report, shown as their own lines: {data.unmappedSubTypes.join(", ")}.</p>
      )}
    </section>
  );
}

// Shared by the GAE report and the Reports page's Comparison Chart: the same
// monthly TOTAL series, so the chart and the report always agree.
export function useGaeReport(fiscalYear: number) {
  return useQuery({
    queryKey: ["reports", "gae-report", fiscalYear],
    queryFn: async () => (await api2.get<GaeReportOut>("/reports/gae-report", { params: { fiscalYear } })).data,
  });
}

export function gaeChartSeries(data: GaeReportOut, comparison: string, granularity: "YTD" | "ANNUAL", ytdThrough: number) {
  const isMonthly = comparison === "monthly-comparison";
  const isQuarterly = comparison === "quarterly-comparison";
  const pair: { left: Measure; right: Measure; leftLabel: string; rightLabel: string } | null = comparison in PAIRS ? PAIRS[comparison as PairId] : isMonthly || isQuarterly ? PAIRS["budget-actual"] : null;
  if (!pair) return null;
  const total = data.main.find((r) => r.key === "total");
  if (!total) return null;
  const asOf = ytdThrough || data.asOfMonth || 12;
  const months = granularity === "YTD" ? Array.from({ length: asOf }, (_, i) => i + 1) : Array.from({ length: 12 }, (_, i) => i + 1);
  const points = isQuarterly
    ? [1, 2, 3, 4].filter((q) => months.some((m) => Math.ceil(m / 3) === q)).map((q) => {
        const qm = months.filter((m) => Math.ceil(m / 3) === q);
        const base = sumRange(total.series[pair.left], qm);
        const target = sumRange(total.series[pair.right], qm);
        return { period: `Q${q}`, baseline: base, target, variancePct: base ? ((target - base) / Math.abs(base)) * 100 : null };
      })
    : months.map((m) => {
        const base = total.series[pair.left][m - 1];
        const target = total.series[pair.right][m - 1];
        return { period: MONTHS[m - 1], baseline: base, target, variancePct: Math.abs(base) < 0.5 ? null : ((target - base) / Math.abs(base)) * 100 };
      });
  return { points, baselineLabel: pair.leftLabel, targetLabel: pair.rightLabel };
}

// Monthly / Quarterly Comparison: one measure (Actual, Budget or Forecast) per
// month or quarter, from the same TOTAL row the table and other charts use.
export type SingleMeasure = "budget" | "actual" | "forecast";
export function gaeSingleSeries(data: GaeReportOut, measure: SingleMeasure, granularity: "YTD" | "ANNUAL", ytdThrough: number, quarterly: boolean) {
  const total = data.main.find((r) => r.key === "total");
  if (!total) return null;
  const asOf = ytdThrough || data.asOfMonth || 12;
  const months = granularity === "YTD" ? Array.from({ length: asOf }, (_, i) => i + 1) : Array.from({ length: 12 }, (_, i) => i + 1);
  const series = total.series[measure];
  const points = quarterly
    ? [1, 2, 3, 4].filter((q) => months.some((m) => Math.ceil(m / 3) === q)).map((q) => ({ period: `Q${q}`, baseline: 0, target: sumRange(series, months.filter((m) => Math.ceil(m / 3) === q)), variancePct: null }))
    : months.map((m) => ({ period: MONTHS[m - 1], baseline: 0, target: series[m - 1], variancePct: null }));
  const label = measure[0].toUpperCase() + measure.slice(1);
  return { points, baselineLabel: label, targetLabel: label };
}

// The KPI cards' totals for the chosen comparison, from the GAE report's TOTAL row
// over the same months (YTD or full year) the table uses.
export function gaeKpiTotals(data: GaeReportOut, comparison: string, granularity: "YTD" | "ANNUAL", ytdThrough: number) {
  const pair = comparison in PAIRS ? PAIRS[comparison as PairId] : comparison === "monthly-comparison" || comparison === "quarterly-comparison" ? PAIRS["budget-actual"] : null;
  if (!pair) return null;
  const total = data.main.find((r) => r.key === "total");
  if (!total) return null;
  const asOf = ytdThrough || data.asOfMonth || 12;
  const months = granularity === "YTD" ? Array.from({ length: asOf }, (_, i) => i + 1) : Array.from({ length: 12 }, (_, i) => i + 1);
  return {
    baselineLabel: pair.leftLabel,
    baseline: sumRange(total.series[pair.left], months),
    targetLabel: pair.rightLabel,
    target: sumRange(total.series[pair.right], months),
    varianceLabel: `${pair.leftLabel} vs ${pair.rightLabel}`,
  };
}
