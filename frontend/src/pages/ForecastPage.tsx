import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type Department, type RequestCategory } from "../api/client";
import { useAuth } from "../context/AuthContext";
import { StatusBadge } from "../components/StatusBadge";
import { PageHeader } from "../components/PageHeader";
import { SectionLabel } from "../components/TabBar";
import { useFiscalYear, type FiscalCycleConfig } from "../lib/fiscalCycle";
import { NpcForecastView } from "./NpcForecastView";

interface ForecastUploadResult {
  ok: boolean;
  created?: number;
  updated?: number;
  errors?: { row: number; error: string }[];
}

interface SapSyncResult {
  ok: true;
  created: number;
  updated: number;
  unmatchedCostCenters: number;
  ambiguous: { glAccount: string; costCenter: string; itemNames: string[] }[];
}

interface HistoricalActualsRow {
  id: string;
  glAccount: string;
  costCenter: string;
  glDescription: string;
  budgetCode: string | null;
  expenseCategory: string | null;
  requestCategory: RequestCategory;
  approvedBudget2026: number;
  ytdActuals2026: number;
  monthlyRemainingForecast2026: Record<string, number>;
  remainingMonthsForecast: number;
  availableBudget2026: number;
  totalActualForecast: number;
  remainingBudget2026: number;
  forecastCompletedAt: string | null;
}

interface ForecastSubmission {
  stage: "DRAFT" | "HEAD_REVIEW" | "BUDGET_OFFICER_REVIEW" | "APPROVED" | "RETURNED";
  reviewDecisions: { decision: string; stage: string; comment: string | null; timestamp: string; decidedBy: { name: string } }[];
}

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
// Wide enough that a 7-figure peso amount ("2,500,000") never wraps.
const COL_WIDTH_PX = 100;
// Expense Category is a short label - a bit wider than the numeric columns
// so 2 lines is normally enough, but nowhere near Expense Line Item's width.
const CATEGORY_COL_WIDTH_PX = 130;
// Expense Line Item carries the longest prose (name + qualifier) of any
// column - wide enough that 2 lines is normally enough on its own, without
// clamping/hiding anything that doesn't fit.
const LINE_ITEM_COL_WIDTH_PX = 190;
// CC/GL are fixed 8-digit codes ("80123102") - much narrower than the
// generic numeric-amount columns.
const CC_GL_COL_WIDTH_PX = 70;
// Per-column widths for the 3 frozen columns (Budget Code / Expense Category
// / Expense Line Item), and their cumulative left offsets so the sticky
// cells line up with the colgroup's own widths below rather than drifting
// out of alignment.
const FROZEN_COL_WIDTHS_PX = [COL_WIDTH_PX, CATEGORY_COL_WIDTH_PX, LINE_ITEM_COL_WIDTH_PX];
const FROZEN_LEFT_PX = [0, FROZEN_COL_WIDTHS_PX[0], FROZEN_COL_WIDTHS_PX[0] + FROZEN_COL_WIDTHS_PX[1]];
// Column 0=Budget Code, 1=Expense Category, 2=Expense Line Item, 3=CC,
// 4=GL, everything after that is a plain amount column at COL_WIDTH_PX.
function colWidthPx(i: number): number {
  if (i === 1) return CATEGORY_COL_WIDTH_PX;
  if (i === 2) return LINE_ITEM_COL_WIDTH_PX;
  if (i === 3 || i === 4) return CC_GL_COL_WIDTH_PX;
  return COL_WIDTH_PX;
}

// Expense Category / Expense Line Item are fixed-width, so long content
// can't grow the column - instead of wrapping past 2 lines, step the font
// size down until roughly 2 lines' worth of characters fit at that size.
// Rough chars-per-line estimate from average glyph width at each size
// (~0.55x font-size for this sans-serif at normal weight) rather than exact
// - good enough to pick the right tier. The max-height (2x each tier's own
// line-height) below is a hard backstop for the rare outlier that still
// doesn't fit even at the smallest tier - deliberately NOT using
// line-clamp/-webkit-line-clamp for this: combined with this table's
// `position: sticky` cells, it breaks the fixed table-layout column width
// in this browser (confirmed live - a sticky cell with line-clamp-2 renders
// at the PRECEDING column's width instead of its own colgroup width).
// Plain overflow-hidden + max-height achieves the same 2-line cap without
// touching `display`, so it doesn't trip that bug.
const FIT_FONT_TIERS = [
  { className: "text-xs", fontPx: 12, lineHeightPx: 16 },
  { className: "text-[10px] leading-[13px]", fontPx: 10, lineHeightPx: 13 },
  { className: "text-[9px] leading-[12px]", fontPx: 9, lineHeightPx: 12 },
] as const;
function fitText(text: string, colPx: number): { className: string; maxHeightPx: number } {
  const usablePx = colPx - 12; // minus px-1.5 padding on both sides
  for (const tier of FIT_FONT_TIERS) {
    const charsPerLine = usablePx / (tier.fontPx * 0.55);
    if (text.length <= charsPerLine * 2) return { className: tier.className, maxHeightPx: tier.lineHeightPx * 2 };
  }
  const last = FIT_FONT_TIERS[FIT_FONT_TIERS.length - 1];
  return { className: last.className, maxHeightPx: last.lineHeightPx * 2 };
}

export function ForecastPage() {
  const { currentUser, hasRole } = useAuth();
  const isBudgetOfficer = hasRole("BUDGET_OFFICER");
  const { forecastYear, targetYear } = useFiscalYear();

  // No ?category= at all means "haven't picked a category yet" - shows a
  // picker prompt below instead of silently defaulting to GAE, same as New
  // Request. GAE is only shown once explicitly chosen (?category=GAE, same
  // as every other category).
  const [searchParams] = useSearchParams();
  const categoryParam = searchParams.get("category");
  const category: RequestCategory | null = categoryParam === "GAE" || categoryParam === "DOE" || categoryParam === "NPC" || categoryParam === "REVENUE" ? categoryParam : null;

  // Notes_6 (Forecast section): "Forecast is for Centralized Departments
  // only which are – Human Resources, Administrative Services Department,
  // Corporate Marketing, Legal Department, Corporate Finance, Tax, OMD
  // Operations." /forecast/eligible-departments is the backend's own
  // authoritative allowlist (also enforced server-side on every route), so
  // the picker here can't drift from what the API actually accepts.
  const { data: eligibleDepts = [] } = useQuery({
    queryKey: ["forecast", "eligible-departments"],
    queryFn: async () => (await api.get<Department[]>("/forecast/eligible-departments")).data,
  });
  // Notes item 7(4): a centralized department cannot view another
  // centralized department's forecast — only the Budget Officer sees all.
  const viewableDepts = isBudgetOfficer ? eligibleDepts : eligibleDepts.filter((d) => d.id === currentUser?.department?.id);

  const [departmentId, setDepartmentId] = useState(() => viewableDepts[0]?.id ?? "");
  const effectiveDeptId = departmentId || viewableDepts[0]?.id || "";

  const queryClient = useQueryClient();
  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["forecast", effectiveDeptId] });
    queryClient.invalidateQueries({ queryKey: ["forecast-submission", effectiveDeptId] });
  };

  const { data, isError } = useQuery({
    queryKey: ["forecast", effectiveDeptId],
    queryFn: async () => (await api.get<{ asOfMonth: number; rows: HistoricalActualsRow[] }>(`/forecast/${effectiveDeptId}`)).data,
    enabled: !!effectiveDeptId,
  });
  const { data: submission } = useQuery({
    queryKey: ["forecast-submission", effectiveDeptId],
    queryFn: async () => (await api.get<ForecastSubmission>(`/forecast/${effectiveDeptId}/submission`)).data,
    enabled: !!effectiveDeptId,
  });
  const rows = data?.rows ?? [];
  const categoryRows = category ? rows.filter((r) => r.requestCategory === category) : [];
  const asOfMonth = data?.asOfMonth ?? 9;
  const remainingMonths = Array.from({ length: 12 - asOfMonth }, (_, i) => asOfMonth + 1 + i);
  // Budget Code, Expense Category, Expense Line Item, CC, GL, Approved
  // Budget, YTD Actuals, Available Budget (8) + one column per remaining
  // month + Total (1) + Total Actual + Forecast, Remaining Budget (2) —
  // every column gets an equal share.
  const columnCount = 8 + remainingMonths.length + 1 + 2;

  const updateMutation = useMutation({
    mutationFn: async ({ id, month, value }: { id: string; month: number; value: number }) => (await api.patch(`/forecast/entries/${id}`, { month, value })).data,
    onSuccess: invalidate,
  });

  const [submitError, setSubmitError] = useState<string | null>(null);
  const submitMutation = useMutation({
    mutationFn: async () => (await api.post(`/forecast/${effectiveDeptId}/submit`)).data,
    onSuccess: () => {
      invalidate();
      setSubmitError(null);
    },
    onError: (err: any) => setSubmitError(err.response?.data?.error ?? "Could not submit forecast."),
  });

  // Notes_6 (Forecast section): Budget-Officer-only controls - change the
  // as-of-month cutoff (which months count as YTD Actuals vs. remaining
  // forecast), and bulk-upload Approved Budget/YTD Actuals from an Excel
  // file instead of editing rows one by one.
  const { data: fiscalCycle } = useQuery({
    queryKey: ["fiscal-cycle"],
    queryFn: async () => (await api.get<FiscalCycleConfig>("/admin/fiscal-cycle")).data,
    enabled: isBudgetOfficer,
  });
  const asOfMonthMutation = useMutation({
    mutationFn: async (month: number) => (await api.put("/admin/fiscal-cycle", { asOfMonth2026: month })).data,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["fiscal-cycle"] });
      queryClient.invalidateQueries({ queryKey: ["forecast"] });
    },
  });

  const [uploadStatus, setUploadStatus] = useState<{ ok: boolean; message: string } | null>(null);
  const uploadMutation = useMutation({
    mutationFn: async (file: File) => {
      const form = new FormData();
      form.append("file", file);
      try {
        return (await api.post<ForecastUploadResult>("/admin/historical-actuals/upload", form)).data;
      } catch (err: any) {
        if (err.response?.status === 400 && err.response.data?.errors) return err.response.data;
        throw err;
      }
    },
    onSuccess: (data) => {
      if (data.ok === false) {
        setUploadStatus({ ok: false, message: `${data.errors?.length ?? 0} row(s) rejected - fix and re-upload.` });
      } else {
        setUploadStatus({ ok: true, message: `Uploaded: ${data.created} created, ${data.updated} updated.` });
        queryClient.invalidateQueries({ queryKey: ["forecast"] });
      }
    },
  });

  const [syncStatus, setSyncStatus] = useState<{ ok: boolean; message: string } | null>(null);
  const syncMutation = useMutation({
    mutationFn: async () => (await api.post<SapSyncResult>("/admin/historical-actuals/sync-sap")).data,
    onSuccess: (data) => {
      const parts = [`${data.created} created`, `${data.updated} updated`];
      if (data.unmatchedCostCenters > 0) parts.push(`${data.unmatchedCostCenters} cost center(s) not in our catalog`);
      if (data.ambiguous.length > 0) {
        parts.push(`${data.ambiguous.length} GL-CC pair(s) shared by multiple line items (needs manual upload): ${data.ambiguous.map((a) => a.itemNames.join("/")).join("; ")}`);
      }
      setSyncStatus({ ok: true, message: parts.join(", ") + "." });
      queryClient.invalidateQueries({ queryKey: ["forecast"] });
    },
    onError: (err: any) => setSyncStatus({ ok: false, message: err.response?.data?.error ?? "Sync failed." }),
  });

  const stage = submission?.stage ?? "DRAFT";
  const isOwnDept = currentUser?.department?.id === effectiveDeptId;
  const canEditValues = (isOwnDept || isBudgetOfficer) && (stage === "DRAFT" || stage === "RETURNED");
  const allComplete = rows.length > 0 && rows.every((r) => r.forecastCompletedAt);
  const anyIncomplete = rows.some((r) => remainingMonths.some((m) => r.monthlyRemainingForecast2026[String(m)] === undefined));

  if (category === null) {
    return (
      <div className="space-y-4">
        <PageHeader subtitle="Choose a category to get started." />
        <div className="rounded-lg border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500 shadow-sm">
          Select a category from the menu on the left to begin.
        </div>
      </div>
    );
  }

  // Note 11 §8 - NPC is SBU-scoped, not department-scoped like GAE/DOE/
  // Revenue - a user whose only NPC access is via Department.sbu may not be
  // in the core centralized department list at all, so this branch must come
  // before the viewableDepts eligibility gate below (which is irrelevant to
  // NPC).
  if (category === "NPC") {
    return <NpcForecastView />;
  }

  if (viewableDepts.length === 0) {
    return <div className="text-sm text-slate-500">You don't have a centralized department to view a forecast for.</div>;
  }

  return (
    <div className="space-y-4">
      <PageHeader
        subtitle={`Months through ${MONTH_NAMES[asOfMonth - 1]} are already in Actuals — only remaining months are editable.`}
        actions={
          <div className="flex items-center gap-3">
            <StatusBadge stage={stage} />
            {canEditValues && (
              <button onClick={() => submitMutation.mutate()} disabled={rows.length === 0 || anyIncomplete || submitMutation.isPending} className="rounded-md bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-600 disabled:opacity-50">
                Submit for Approval
              </button>
            )}
          </div>
        }
      />
      <p className="rounded-lg border border-blue-100 bg-blue-50 px-4 py-2 text-sm text-blue-800">Completing this per CC-GL unblocks Centralized First-Level Review (Step 3A). Submission routes to the Centralized Department Head, then the Budget Officer, either of whom can return it.</p>

      {isBudgetOfficer && (
        <div className="flex flex-wrap items-center gap-4 rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
          <div className="flex items-center gap-2">
            <label className="text-xs font-semibold text-slate-600">YTD Actual through</label>
            <select className="rounded border border-slate-300 px-2 py-1 text-sm" value={fiscalCycle?.asOfMonth2026 ?? 9} onChange={(e) => asOfMonthMutation.mutate(Number(e.target.value))}>
              {MONTH_NAMES.map((name, i) => (
                <option key={name} value={i + 1}>
                  {name}
                </option>
              ))}
            </select>
          </div>
          {/* Note 11 §9 - live-generated, pre-populated version of the same
              template the plain upload below expects (NPC has its own
              distinct shape/page - see NpcForecastView.tsx). Gated to fiscal
              year 2027+, same cycle this reference data belongs to; 2026
              keeps only the plain upload flow. */}
          {targetYear >= 2027 && (
            <a
              href={`/api/forecast/${effectiveDeptId}/template?category=${category}`}
              className="rounded-md border border-emerald-300 bg-emerald-50 px-3 py-1.5 text-xs font-medium text-emerald-800 hover:bg-emerald-100"
            >
              Open Spreadsheet Template
            </a>
          )}
          {/* Real SAP pull (budget_kssb_v2), replacing the manual upload
              below for whatever CC-GL pairs it can match unambiguously - see
              historicalActualsService.ts's syncHistoricalActualsFromSap. The
              upload stays as a fallback/override for anything it can't
              (a GL-CC pair shared by more than one catalog item, or a CC not
              in SAP at all). */}
          <button
            onClick={() => {
              setSyncStatus(null);
              syncMutation.mutate();
            }}
            disabled={syncMutation.isPending}
            className="rounded-md bg-emerald-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-600 disabled:opacity-50"
          >
            {syncMutation.isPending ? "Syncing…" : "Sync from SAP"}
          </button>
          <label className="cursor-pointer rounded-md border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100">
            {uploadMutation.isPending ? "Uploading…" : "Upload Forecast Template"}
            <input
              type="file"
              accept=".xlsx"
              className="hidden"
              disabled={uploadMutation.isPending}
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (!file) return;
                setUploadStatus(null);
                uploadMutation.mutate(file);
              }}
            />
          </label>
          {syncStatus && <span className={`text-xs ${syncStatus.ok ? "text-emerald-700" : "text-red-600"}`}>{syncStatus.message}</span>}
          {uploadStatus && <span className={`text-xs ${uploadStatus.ok ? "text-emerald-700" : "text-red-600"}`}>{uploadStatus.message}</span>}
        </div>
      )}

      {viewableDepts.length > 1 && (
        <select className="rounded border border-slate-300 px-2 py-1.5 text-sm" value={effectiveDeptId} onChange={(e) => setDepartmentId(e.target.value)}>
          {viewableDepts.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>
      )}
      {isError && <div className="text-sm text-red-700">You can only view your own department's forecast.</div>}

      {/* Notes_9: column layout matches "Budgeting System_Forecast
          Template.xlsx" exactly — Budget Code / Expense Category leading,
          then Expense Line Item / CC / GL split into their own columns
          (not a combined "GL Description"), the month
          columns grouped under a merged "Remaining Months Forecast" header
          alongside their Total, and "2026 Total Actual + Forecast" shown as
          its own column before the final Remaining Budget. The template has
          no 2025 Actuals column, so it's dropped here too.
          Notes_9 (follow-up 1): "arrange the width of the columns... make it
          uniform in size" — table-fixed with every column pinned to the same
          width.
          Notes_9 (follow-up 2): "reflect the numbers in one line only, don't
          wrap the numbers" — a percentage-of-container width squeezed
          numbers like "2,500,000" into a wrapped mess on a 13-column table.
          Fixed pixel width per column instead (COL_WIDTH_PX, wide enough for
          the numbers) with the table free to grow past 100% — the wrapper's
          overflow-x-auto below turns that into a horizontal scroll rather
          than compressed, wrapping cells. Uniform width and single-line
          numbers can't both fit under 100% width on this many columns. */}
      {/* The sticky header/frozen columns below need their OWN scrolling box
          on both axes - a lone `overflow-x-auto` here would get silently
          upgraded to `overflow-y: auto` too per the CSS spec (visible can't
          pair with a non-visible sibling axis), making this div the sticky
          containment boundary without ever actually scrolling vertically
          itself (no height cap), which left `position: sticky; top: 0`
          inert. An explicit max-height turns this into a real 2-axis scroll
          pane instead, so both freezes have something to stick against. */}
      <div className="max-h-[70vh] overflow-auto rounded-lg border border-slate-200 bg-white shadow-sm">
        <table className="table-fixed text-xs" style={{ width: Array.from({ length: columnCount }, (_, i) => colWidthPx(i)).reduce((a, b) => a + b, 0) }}>
          <colgroup>
            {Array.from({ length: columnCount }).map((_, i) => (
              <col key={i} style={{ width: colWidthPx(i) }} />
            ))}
          </colgroup>
          <thead className="sticky top-0 z-20 bg-emerald-50 text-left text-[11px] tracking-wide text-emerald-800">
            <tr>
              <th rowSpan={2} className="sticky z-30 break-words bg-emerald-50 px-1.5 py-1 align-bottom" style={{ left: FROZEN_LEFT_PX[0] }}>
                Budget Code
              </th>
              <th rowSpan={2} className="sticky z-30 break-words bg-emerald-50 px-1.5 py-1 align-bottom" style={{ left: FROZEN_LEFT_PX[1] }}>
                Expense Category
              </th>
              <th rowSpan={2} className="sticky z-30 break-words bg-emerald-50 px-1.5 py-1 align-bottom" style={{ left: FROZEN_LEFT_PX[2] }}>
                Expense Line Item
              </th>
              <th rowSpan={2} className="break-words px-1.5 py-1 align-bottom">
                CC
              </th>
              <th rowSpan={2} className="break-words px-1.5 py-1 align-bottom">
                GL
              </th>
              <th rowSpan={2} className="break-words px-1.5 py-1 align-bottom">
                {forecastYear} Approved Budget
              </th>
              <th rowSpan={2} className="break-words px-1.5 py-1 align-bottom">
                {forecastYear} YTD Actuals
              </th>
              <th rowSpan={2} className="break-words px-1.5 py-1 align-bottom">
                {forecastYear} Available Budget
              </th>
              <th colSpan={remainingMonths.length + 1} className="break-words px-1.5 py-1 text-center">
                Remaining Months Forecast
              </th>
              <th rowSpan={2} className="break-words px-1.5 py-1 align-bottom">
                {forecastYear} Total Actual + Forecast
              </th>
              <th rowSpan={2} className="break-words px-1.5 py-1 align-bottom">
                {forecastYear} Remaining Budget
              </th>
            </tr>
            <tr>
              {remainingMonths.map((m) => (
                <th key={m} className="break-words px-1.5 py-1">
                  {MONTH_NAMES[m - 1]}
                </th>
              ))}
              <th className="break-words px-1.5 py-1">Total</th>
            </tr>
          </thead>
          <tbody>
            {categoryRows.map((r, i) => {
              const rowBg = i % 2 === 1 ? "bg-slate-50/60" : "bg-white";
              // The frozen cells need a fully OPAQUE background, not the
              // row's own translucent stripe (bg-slate-50/60) - at 60%
              // opacity the CC/GL columns scrolling underneath a frozen
              // cell show through it. bg-slate-50/60 painted over white
              // looks identical to plain bg-slate-50, so this is a visual
              // no-op for the frozen cells themselves.
              const stickyBg = i % 2 === 1 ? "bg-slate-50" : "bg-white";
              return (
              <tr key={r.id} className={`border-t border-slate-100 ${rowBg}`}>
                <td className={`sticky z-10 whitespace-nowrap px-1.5 py-0.5 align-top ${stickyBg}`} style={{ left: FROZEN_LEFT_PX[0] }}>{r.budgetCode ?? "—"}</td>
                {(() => {
                  const fit = fitText(r.expenseCategory ?? "—", CATEGORY_COL_WIDTH_PX);
                  return (
                    <td className={`sticky z-10 overflow-hidden break-words px-1.5 py-0.5 align-top ${stickyBg} ${fit.className}`} style={{ left: FROZEN_LEFT_PX[1], maxHeight: fit.maxHeightPx }}>
                      {r.expenseCategory ?? "—"}
                    </td>
                  );
                })()}
                {(() => {
                  const fit = fitText(r.glDescription, LINE_ITEM_COL_WIDTH_PX);
                  return (
                    <td className={`sticky z-10 overflow-hidden break-words px-1.5 py-0.5 align-top ${stickyBg} ${fit.className}`} style={{ left: FROZEN_LEFT_PX[2], maxHeight: fit.maxHeightPx }}>
                      {r.glDescription}
                    </td>
                  );
                })()}
                <td className="whitespace-nowrap px-1.5 py-0.5 align-top">{r.costCenter}</td>
                <td className="whitespace-nowrap px-1.5 py-0.5 align-top">{r.glAccount}</td>
                <td className="whitespace-nowrap px-1.5 py-0.5 align-top">{r.approvedBudget2026.toLocaleString()}</td>
                <td className="whitespace-nowrap px-1.5 py-0.5 align-top">{r.ytdActuals2026.toLocaleString()}</td>
                <td className="whitespace-nowrap px-1.5 py-0.5 align-top">{r.availableBudget2026.toLocaleString()}</td>
                {remainingMonths.map((m) => (
                  <td key={m} className="whitespace-nowrap px-1.5 py-0.5 align-top">
                    {canEditValues ? (
                      <input
                        type="number"
                        className="w-full rounded border border-slate-300 px-1 py-0.5 text-xs"
                        defaultValue={r.monthlyRemainingForecast2026[String(m)] ?? ""}
                        onBlur={(e) => {
                          const value = Number(e.target.value) || 0;
                          if (value !== r.monthlyRemainingForecast2026[String(m)]) {
                            updateMutation.mutate({ id: r.id, month: m, value });
                          }
                        }}
                      />
                    ) : (
                      (r.monthlyRemainingForecast2026[String(m)] ?? "—")
                    )}
                  </td>
                ))}
                <td className="whitespace-nowrap px-1.5 py-0.5 align-top font-medium text-slate-700">{r.remainingMonthsForecast.toLocaleString()}</td>
                <td className="whitespace-nowrap px-1.5 py-0.5 align-top">{r.totalActualForecast.toLocaleString()}</td>
                <td className="whitespace-nowrap px-1.5 py-0.5 align-top font-semibold text-emerald-800">{r.remainingBudget2026.toLocaleString()}</td>
              </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {rows.length > 0 && categoryRows.length === 0 && <div className="text-sm text-slate-500">No line items in this category yet.</div>}

      {!canEditValues && stage !== "APPROVED" && (isOwnDept || isBudgetOfficer) && <div className="text-sm text-slate-500">Waiting on review — editing is locked while a submission is pending.</div>}
      {allComplete && stage === "APPROVED" && <div className="inline-block rounded-full bg-emerald-100 px-3 py-1 text-sm font-medium text-emerald-800">Forecast Approved ✓</div>}
      {submitError && <div className="text-sm text-red-700">{submitError}</div>}

      {submission && submission.reviewDecisions.length > 0 && (
        <div className="rounded-lg border border-slate-200 bg-white p-4 text-sm shadow-sm">
          <SectionLabel>Review History</SectionLabel>
          <ul className="space-y-1">
            {submission.reviewDecisions.map((d, i) => (
              <li key={i} className="border-l-2 border-emerald-200 pl-3 py-0.5">
                {d.decision} at {d.stage} — {d.decidedBy.name}
                {d.comment && <span className="text-slate-600"> — {d.comment}</span>}
                <span className="ml-1 text-xs text-slate-400">{new Date(d.timestamp).toLocaleString()}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
