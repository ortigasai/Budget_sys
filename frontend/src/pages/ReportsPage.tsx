import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  api2,
  FINANCIAL_SCOPE_OPTIONS,
  type FinancialScope,
  type ReportFilterOptions,
  type ReportNote,
  type ReportSeriesPoint,
  type ReportSummary,
  type ReportTrendPoint,
} from "../api/client";
import { PageHeader } from "../components/PageHeader";
import { SectionLabel, TabBar } from "../components/TabBar";
import { SearchableSelect } from "../components/SearchableSelect";
import { useFiscalYear } from "../lib/fiscalCycle";
import { KpiCards } from "./reports/KpiCards";
import { ComparisonChart } from "./reports/ComparisonChart";
import { ScopeDonutChart } from "./reports/ScopeDonutChart";
import { ReportTable, type ComparisonMeta } from "./reports/ReportTable";

function peso(n: number) {
  return `₱${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const CALENDAR_YEARS = [2024, 2025, 2026, 2027];

type ComparisonId = "budget-actual" | "yoy-actual" | "budget-forecast" | "actual-forecast" | "trend";
const COMPARISON_OPTIONS: { value: ComparisonId; label: string }[] = [
  { value: "budget-actual", label: "Budget vs Actual" },
  { value: "yoy-actual", label: "Last Year Actual vs Current Year Actual" },
  { value: "budget-forecast", label: "Budget vs Forecast" },
  { value: "actual-forecast", label: "Actual vs Forecast" },
  { value: "trend", label: "5-Year Trend" },
];
const COMPARISON_META: Record<Exclude<ComparisonId, "trend">, ComparisonMeta & { baselineLabel: string; targetLabel: string }> = {
  "budget-actual": { leftLabel: "Budget", leftKey: "budgetCurrent", rightLabel: "Actual", rightKey: "actualCurrent", varianceLabel: "Budget vs Actual", varianceKey: "variance", baselineLabel: "Budget", targetLabel: "Actual" },
  "yoy-actual": { leftLabel: "LY Actual", leftKey: "actualPrior", rightLabel: "CY Actual", rightKey: "actualCurrent", varianceLabel: "YoY Actual", varianceKey: "varianceActualYoY", baselineLabel: "LY Actual", targetLabel: "CY Actual" },
  "budget-forecast": { leftLabel: "Budget", leftKey: "budgetCurrent", rightLabel: "Forecast", rightKey: "forecastCurrent", varianceLabel: "Budget vs Forecast", varianceKey: "varianceBudgetForecast", baselineLabel: "Budget", targetLabel: "Forecast" },
  "actual-forecast": { leftLabel: "Actual", leftKey: "actualCurrent", rightLabel: "Forecast", rightKey: "forecastCurrent", varianceLabel: "Actual vs Forecast", varianceKey: "varianceActualForecast", baselineLabel: "Actual", targetLabel: "Forecast" },
};

type Granularity = "MONTHLY" | "QUARTERLY" | "YTD" | "ANNUAL";
const GRANULARITY_TABS: { id: Granularity; label: string }[] = [
  { id: "MONTHLY", label: "Monthly" },
  { id: "QUARTERLY", label: "Quarterly" },
  { id: "YTD", label: "YTD" },
  { id: "ANNUAL", label: "Annual" },
];

type PresetId = "executive-summary" | "variance-alert" | "5-year-outlook";
const PRESETS: { id: PresetId; label: string }[] = [
  { id: "executive-summary", label: "Executive Summary" },
  { id: "variance-alert", label: "Variance Alert View" },
  { id: "5-year-outlook", label: "5-Year Outlook" },
];

// Phase 4 — Budget Report & Analysis (Note 12's dashboard redesign). Served
// by the FastAPI backend (backend-py/), reached via api2. Access is gated by
// RequireReportAccess (App.tsx) before this even mounts. FR-4.8's period
// sign-off lives in the Admin Console (PeriodSignOffTab) instead of here.
export function ReportsPage() {
  const { targetYear } = useFiscalYear();
  const queryClient = useQueryClient();

  const [comparison, setComparison] = useState<ComparisonId>("budget-actual");
  const [financialScope, setFinancialScope] = useState<FinancialScope[]>([]); // empty = Select All
  const [fiscalYear, setFiscalYear] = useState(targetYear);
  const [granularity, setGranularity] = useState<Granularity>("YTD");
  const [trendYears, setTrendYears] = useState<5 | 10>(5);
  const [scopePickerOpen, setScopePickerOpen] = useState(false);
  const [moreFiltersOpen, setMoreFiltersOpen] = useState(false);
  const [costCenter, setCostCenter] = useState("");
  const [glAccount, setGlAccount] = useState("");
  const [notesGroup, setNotesGroup] = useState<string | null>(null);
  const [noteText, setNoteText] = useState("");
  const [activePreset, setActivePreset] = useState<PresetId>("executive-summary");
  const [tableResetKey, setTableResetKey] = useState(0);

  const applyPreset = (id: PresetId) => {
    setActivePreset(id);
    setFinancialScope([]);
    if (id === "5-year-outlook") {
      setComparison("trend");
      setTrendYears(5);
    } else {
      setComparison("budget-actual");
      setGranularity("YTD");
    }
    setTableResetKey((k) => k + 1);
  };

  const period = granularity === "ANNUAL" ? "ANNUAL" : "YTD";
  // Comma-joined, not a repeated query param - axios's default array
  // serialization (financialScope[]=X) doesn't match what FastAPI's
  // list[str] query params expect (repeated financialScope=X&financialScope=Y),
  // so the backend takes one comma-joined string instead.
  const scopeParam = financialScope.length > 0 ? financialScope.join(",") : undefined;

  const { data: filterOptions = { costCenters: [], glAccounts: [], expenseGroups: [], sbus: [], financialScopes: [] } } = useQuery({
    queryKey: ["reports", "filter-options"],
    queryFn: async () => (await api2.get<ReportFilterOptions>("/reports/filter-options")).data,
  });

  const { data: summary, isLoading } = useQuery({
    queryKey: ["reports", "summary", fiscalYear, period, costCenter, glAccount, financialScope],
    queryFn: async () =>
      (
        await api2.get<ReportSummary>("/reports/cc-gl-summary", {
          params: { fiscalYear, period, costCenter: costCenter || undefined, glAccount: glAccount || undefined, financialScope: scopeParam },
        })
      ).data,
    enabled: comparison !== "trend",
  });

  const chartGranularity = granularity === "MONTHLY" || granularity === "QUARTERLY" ? granularity : "MONTHLY";
  const { data: seriesPoints = [] } = useQuery({
    queryKey: ["reports", "series", fiscalYear, chartGranularity, costCenter, glAccount, financialScope],
    queryFn: async () =>
      (
        await api2.get<ReportSeriesPoint[]>("/reports/series", {
          params: { fiscalYear, granularity: chartGranularity, costCenter: costCenter || undefined, glAccount: glAccount || undefined, financialScope: scopeParam },
        })
      ).data,
    // Note 12 - /reports/series is single-year (Budget/Actual/Forecast for
    // this fiscalYear); "LY Actual vs CY Actual" would need a genuine 2-year
    // monthly series this pass doesn't build (out of scope - flagged in the
    // plan) - the chart is skipped for that comparison, KPI cards + table
    // still show the real prior-vs-current totals.
    enabled: comparison !== "trend" && comparison !== "yoy-actual",
  });

  const { data: trendPoints = [] } = useQuery({
    queryKey: ["reports", "trend", trendYears, costCenter, glAccount, financialScope],
    queryFn: async () => (await api2.get<ReportTrendPoint[]>("/reports/trend", { params: { years: trendYears, costCenter: costCenter || undefined, glAccount: glAccount || undefined, financialScope: scopeParam } })).data,
    enabled: comparison === "trend",
  });

  const { data: notes = [] } = useQuery({
    queryKey: ["reports", "notes", fiscalYear, notesGroup],
    queryFn: async () => (await api2.get<ReportNote[]>("/reports/notes", { params: { fiscalYear, expenseGroup: notesGroup } })).data,
    enabled: !!notesGroup,
  });
  const addNoteMutation = useMutation({
    mutationFn: async () => (await api2.post<ReportNote>("/reports/notes", { fiscalYear, expenseGroup: notesGroup, text: noteText })).data,
    onSuccess: () => {
      setNoteText("");
      queryClient.invalidateQueries({ queryKey: ["reports", "notes", fiscalYear, notesGroup] });
      queryClient.invalidateQueries({ queryKey: ["reports", "summary"] });
    },
  });

  const exportExcel = async () => {
    const res = await api2.get("/reports/export", {
      params: { fiscalYear, period, costCenter: costCenter || undefined, glAccount: glAccount || undefined, financialScope: scopeParam },
      responseType: "blob",
    });
    const url = URL.createObjectURL(res.data as Blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `budget-report-${fiscalYear}.xlsx`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const rows = summary?.rows ?? [];
  const totals = summary?.totals;
  const notesRow = rows.find((r) => r.expenseGroup === notesGroup);
  const meta = comparison !== "trend" ? COMPARISON_META[comparison] : null;

  const scopeTotals: Record<FinancialScope, number> = { OPEX: 0, REVENUE: 0, NPC: 0 };
  for (const r of rows) {
    if (r.financialScope) scopeTotals[r.financialScope] += r.budgetCurrent;
  }

  const toggleScope = (scope: FinancialScope) => {
    setFinancialScope((prev) => (prev.includes(scope) ? prev.filter((s) => s !== scope) : [...prev, scope]));
  };

  return (
    <div className="mx-auto max-w-6xl space-y-3">
      <PageHeader
        actions={
          comparison !== "trend" && (
            <button onClick={exportExcel} className="rounded-md bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-600">
              Export to Excel
            </button>
          )
        }
      />

      {/* Section 0 - control bar: Primary Comparison / Financial Scope /
          Calendar Year / Time Granularity / Saved View Presets, per Note
          12's own control table. */}
      <div className="rounded-lg border border-slate-200 bg-white p-2.5 shadow-sm">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <div>
            <label className="block text-xs font-medium text-slate-600">Primary Comparison</label>
            <select className="mt-0.5 w-full rounded border border-slate-300 px-2 py-1 text-xs" value={comparison} onChange={(e) => setComparison(e.target.value as ComparisonId)}>
              {COMPARISON_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
          <div className="relative">
            <label className="block text-xs font-medium text-slate-600">Financial Scope</label>
            <button onClick={() => setScopePickerOpen((o) => !o)} className="mt-0.5 w-full rounded border border-slate-300 px-2 py-1 text-left text-xs">
              {financialScope.length === 0 ? "Select All" : financialScope.map((s) => FINANCIAL_SCOPE_OPTIONS.find((o) => o.value === s)?.label ?? s).join(", ")}
            </button>
            {scopePickerOpen && (
              <div className="absolute z-10 mt-1 w-full rounded border border-slate-300 bg-white p-2 text-xs shadow-lg">
                <label className="flex items-center gap-1.5 py-0.5">
                  <input type="checkbox" checked={financialScope.length === 0} onChange={() => setFinancialScope([])} />
                  Select All
                </label>
                {FINANCIAL_SCOPE_OPTIONS.map((o) => (
                  <label key={o.value} className="flex items-center gap-1.5 py-0.5">
                    <input type="checkbox" checked={financialScope.includes(o.value)} onChange={() => toggleScope(o.value)} />
                    {o.label}
                  </label>
                ))}
                <button onClick={() => setScopePickerOpen(false)} className="mt-1 w-full rounded bg-slate-100 px-2 py-1 text-[11px] font-medium text-slate-600 hover:bg-slate-200">
                  Done
                </button>
              </div>
            )}
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600">Calendar Year</label>
            <select className="mt-0.5 w-full rounded border border-slate-300 px-2 py-1 text-xs" value={fiscalYear} onChange={(e) => setFiscalYear(Number(e.target.value))}>
              {CALENDAR_YEARS.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600">Time Granularity</label>
            <div className="mt-0.5">
              <TabBar tabs={GRANULARITY_TABS} active={granularity} onChange={setGranularity} />
            </div>
          </div>
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-1.5 border-t border-slate-100 pt-2">
          <span className="text-[11px] font-medium text-slate-500">Saved Views:</span>
          {PRESETS.map((p) => (
            <button
              key={p.id}
              onClick={() => applyPreset(p.id)}
              className={`rounded-full px-2.5 py-1 text-[11px] font-medium ${activePreset === p.id ? "bg-emerald-700 text-white" : "border border-slate-300 text-slate-600 hover:bg-slate-50"}`}
            >
              {p.label}
            </button>
          ))}
          <button onClick={() => setMoreFiltersOpen((o) => !o)} className="ml-auto text-[11px] font-medium text-emerald-700 hover:underline">
            {moreFiltersOpen ? "Hide filters" : "More filters"}
          </button>
        </div>

        {moreFiltersOpen && (
          <div className="mt-2 grid grid-cols-2 gap-2 border-t border-slate-100 pt-2 sm:grid-cols-3">
            <div>
              <label className="block text-xs font-medium text-slate-600">Cost Center</label>
              <SearchableSelect placeholder="All cost centers…" options={filterOptions.costCenters.map((c) => ({ value: c.code, label: c.code, sublabel: c.name }))} value={costCenter} onChange={setCostCenter} />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600">GL Account</label>
              <SearchableSelect placeholder="All GL accounts…" options={filterOptions.glAccounts.map((g) => ({ value: g.code, label: g.code, sublabel: g.name }))} value={glAccount} onChange={setGlAccount} />
            </div>
          </div>
        )}
      </div>

      {comparison !== "trend" && summary?.latestActualMonth && (
        <div className="rounded-lg border border-blue-100 bg-blue-50 px-3 py-1.5 text-xs text-blue-800">
          Current YTD Reporting Period: <span className="font-semibold">Jan–{MONTH_NAMES[summary.latestActualMonth - 1]} {summary.fiscalYear}</span> (latest month with posted Actuals)
        </div>
      )}

      {comparison === "trend" ? (
        <>
          <div className="flex justify-end gap-1">
            {([5, 10] as const).map((y) => (
              <button key={y} onClick={() => setTrendYears(y)} className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${trendYears === y ? "bg-slate-700 text-white" : "border border-slate-300 text-slate-500 hover:bg-slate-50"}`}>
                {y}-Year
              </button>
            ))}
          </div>
          <ComparisonChart
            title="5-Year Trend — Budget vs Actual"
            baselineLabel="Budget"
            targetLabel="Actual"
            points={trendPoints.map((p) => ({ period: String(p.fiscalYear), baseline: p.budget, target: p.actual, variancePct: p.budget ? ((p.actual - p.budget) / p.budget) * 100 : null }))}
          />
          {trendPoints.length === 0 && <div className="text-xs text-slate-500">No historical budget/actual data yet.</div>}
        </>
      ) : (
        <>
          {totals && meta && <KpiCards baselineLabel={meta.baselineLabel} baseline={rowMetric(totals, meta.leftKey)} targetLabel={meta.targetLabel} target={rowMetric(totals, meta.rightKey)} varianceLabel={meta.varianceLabel} />}

          <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
            <div className="lg:col-span-2">
              {meta && comparison !== "yoy-actual" ? (
                <ComparisonChart title="Comparison Chart" baselineLabel={meta.baselineLabel} targetLabel={meta.targetLabel} points={seriesPoints.map((p) => ({ period: p.period, baseline: p.budget, target: comparison === "actual-forecast" ? p.forecast ?? 0 : comparison === "budget-forecast" ? p.forecast ?? 0 : p.actual, variancePct: p.variancePct }))} />
              ) : (
                <div className="flex h-full items-center justify-center rounded-lg border border-dashed border-slate-300 bg-white p-6 text-center text-xs text-slate-400">
                  A month-by-month chart isn't available for this comparison yet — see the KPI cards and table below for the Last-Year-vs-Current-Year totals.
                </div>
              )}
            </div>
            <ScopeDonutChart totalsByScope={scopeTotals} onSliceClick={(scope) => setFinancialScope([scope])} />
          </div>

          {meta && (
            <ReportTable
              key={tableResetKey}
              rows={rows}
              meta={meta}
              notesGroup={notesGroup}
              onToggleNotes={(group) => setNotesGroup(notesGroup === group ? null : group)}
              initialSortByVariance={activePreset === "variance-alert"}
              initialExpandOverThreshold={activePreset === "variance-alert"}
            />
          )}
          {isLoading && <div className="text-center text-xs text-slate-400">Loading…</div>}
        </>
      )}

      {notesGroup && (
        <div className="rounded-lg border border-slate-200 bg-white p-2.5 shadow-sm">
          <SectionLabel>Notes — {notesGroup}</SectionLabel>

          {notesRow && (
            <div className="mb-2 grid grid-cols-3 gap-2 rounded-md bg-slate-50 p-2 text-xs">
              <div>
                <div className="text-[10px] font-semibold tracking-wide text-slate-500">Budget vs Actual</div>
                <div className={`font-semibold ${notesRow.variance < 0 ? "text-red-600" : "text-slate-700"}`}>{peso(notesRow.variance)}</div>
              </div>
              <div>
                <div className="text-[10px] font-semibold tracking-wide text-slate-500">Budget vs Forecast</div>
                <div className={`font-semibold ${notesRow.varianceBudgetForecast != null && notesRow.varianceBudgetForecast < 0 ? "text-red-600" : "text-slate-700"}`}>{notesRow.varianceBudgetForecast != null ? peso(notesRow.varianceBudgetForecast) : "—"}</div>
              </div>
              <div>
                <div className="text-[10px] font-semibold tracking-wide text-slate-500">Actual vs Forecast</div>
                <div className={`font-semibold ${notesRow.varianceActualForecast != null && notesRow.varianceActualForecast < 0 ? "text-red-600" : "text-slate-700"}`}>{notesRow.varianceActualForecast != null ? peso(notesRow.varianceActualForecast) : "—"}</div>
              </div>
            </div>
          )}

          {notes.length === 0 ? (
            <div className="text-xs text-slate-500">No notes yet.</div>
          ) : (
            <ul className="space-y-1.5">
              {notes.map((n) => (
                <li key={n.id} className="border-l-2 border-emerald-200 pl-2 text-xs">
                  <div className="text-slate-700">{n.text}</div>
                  <div className="text-[10px] text-slate-400">
                    {n.authorName} · {new Date(n.createdAt).toLocaleString()}
                    {n.month && ` · ${MONTH_NAMES[n.month - 1]}`}
                  </div>
                </li>
              ))}
            </ul>
          )}
          <div className="mt-2 flex gap-2">
            <textarea className="w-full rounded border border-slate-300 px-2 py-1 text-xs" rows={2} placeholder="Add a note…" value={noteText} onChange={(e) => setNoteText(e.target.value)} />
            <button onClick={() => addNoteMutation.mutate()} disabled={!noteText.trim() || addNoteMutation.isPending} className="shrink-0 rounded-md bg-emerald-700 px-3 py-1 text-xs font-semibold text-white hover:bg-emerald-600 disabled:opacity-50">
              Add
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function rowMetric(row: ReportSummary["totals"], key: ComparisonMeta["leftKey"]): number | null {
  if (key === "varianceBudgetForecast") return row.forecastCurrent != null ? row.budgetCurrent - row.forecastCurrent : null;
  if (key === "varianceActualForecast") return row.forecastCurrent != null ? row.actualCurrent - row.forecastCurrent : null;
  if (key === "varianceActualYoY") return row.actualCurrent - row.actualPrior;
  if (key === "actualPrior") return row.actualPrior;
  return row[key];
}
