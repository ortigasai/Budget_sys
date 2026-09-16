import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, NPC_SBU_OPTIONS, type NpcSbu } from "../api/client";
import { useAuth } from "../context/AuthContext";
import { PageHeader } from "../components/PageHeader";
import { ExpandableSection } from "../components/ExpandableSection";
import { useFiscalCycle, useFiscalYear } from "../lib/fiscalCycle";

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// Frozen on row 2 / column 3 (spreadsheet "Freeze Panes" convention): the
// header row (1) and TOTAL row (2) stay pinned while scrolling down through
// projects, and Budget Code/Project Title (columns 1-2) stay pinned while
// scrolling right through the month columns - everything from column 3
// onward scrolls normally. Column 0 = Budget Code, column 1 = Project
// Title; every other column shares one default width.
const DEFAULT_COL_WIDTH_PX = 100;
// Wide enough for the real Budget Code format ("JLC-2026B-NPC018", ~17
// chars) on one line - 110px was clipping it.
const BUDGET_CODE_COL_WIDTH_PX = 160;
const PROJECT_TITLE_COL_WIDTH_PX = 280;
const IO_CODES_COL_WIDTH_PX = 110;
const IO_DESCRIPTION_COL_WIDTH_PX = 240;
// Column indices: 0 Budget Code, 1 Project Title, 2 NPC Budget, 3 IO
// Code(s), 4 IO Description, 5 IO Budget, 6 IO Actual, 7 NPC Available
// Budget, then one column per remaining month, then the 3 trailing totals.
function colWidthPx(i: number): number {
  if (i === 0) return BUDGET_CODE_COL_WIDTH_PX;
  if (i === 1) return PROJECT_TITLE_COL_WIDTH_PX;
  if (i === 3) return IO_CODES_COL_WIDTH_PX;
  if (i === 4) return IO_DESCRIPTION_COL_WIDTH_PX;
  return DEFAULT_COL_WIDTH_PX;
}
const FROZEN_LEFT_PX = [0, BUDGET_CODE_COL_WIDTH_PX];

interface NpcForecastRow {
  // Null for a row sourced only from the NPC Monitoring import (a temporary
  // 2026-only data source, see backend/src/services/npcForecastService.ts) -
  // there's no real request behind it, so Remaining Months Forecast can't
  // be edited for it.
  budgetRequestId: string | null;
  budgetCode: string;
  projectTitle: string;
  npcBudget: number;
  ioCodes: string[];
  // Per-IO breakdown backing ioCodes above - each shown on its own line,
  // not lumped into the summed ioBudget/ioActual below (see the table).
  ios: { code: string; description: string; budget: number; actual: number | null }[];
  ioBudget: number;
  ioActual: number | null;
  npcAvailableBudget: number;
  monthlyRemainingForecast: Record<string, number>;
  remainingMonthsForecast: number;
  totalActualForecast: number;
  npcSurplus: number;
  // True only for a standalone "Carry-over" IO row (no Budget Code, no
  // NPC-approved project behind it) - npcBudget is set equal to ioBudget
  // for these (confirmed with the user), still counted in the TOTAL row
  // (see the totals block below) since the source workbook's own per-SBU
  // total counts them too.
  isCarryOver: boolean;
}

// Sortable columns - string or (number | null) fields only, matched against
// each other in toggleSort/the sort comparator above.
type SortColumn = "budgetCode" | "projectTitle" | "npcBudget" | "ioBudget" | "ioActual" | "npcAvailableBudget" | "totalActualForecast" | "npcSurplus" | "remainingMonthsForecast";

function peso(n: number) {
  return `₱${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

// Display only - ioCodes stays the full 12-digit zero-padded AUFNR
// everywhere else (matching against the broker/import data still needs the
// real value) - this just drops the padding's leading "0000" for a
// shorter, more scannable IO Code(s) column.
function formatAufnr(code: string): string {
  return code.length > 4 ? code.slice(4) : code;
}

// Note 11 §8 - NPC Forecast. Genuinely new (not a filtered view of the
// generic HistoricalActuals table the GAE/DOE/Revenue tabs use) - NPC's
// real data lives in BudgetRequest/FinalizedBudgetLine/InternalOrderRequest,
// never in HistoricalActuals. SBU-scoped rather than department-scoped:
// Budget Officer picks any of the 8 NPC SBUs, everyone else is pinned to
// their own department's Department.sbu (same pattern Utilization's NPC
// view already uses).
export function NpcForecastView() {
  const { currentUser, hasRole } = useAuth();
  const isBudgetOfficer = hasRole("BUDGET_OFFICER");
  const { targetYear } = useFiscalYear();
  const queryClient = useQueryClient();

  // Budget-Officer-only control, same as ForecastPage.tsx's GAE/DOE view -
  // NPC's own asOfMonth (used just above for remainingMonths) is driven by
  // this same shared fiscal-cycle setting, so editing it here rather than
  // only from GAE keeps NPC's own cutoff reachable from its own page.
  const { data: fiscalCycle } = useFiscalCycle();
  const asOfMonthMutation = useMutation({
    mutationFn: async (month: number) => (await api.put("/admin/fiscal-cycle", { npcAsOfMonth2026: month })).data,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["fiscal-cycle"] });
      queryClient.invalidateQueries({ queryKey: ["forecast"] });
    },
  });

  const ownSbu = currentUser?.department?.sbu ?? null;
  const [pickedSbu, setPickedSbu] = useState<NpcSbu | "">("");
  const effectiveSbu = isBudgetOfficer ? pickedSbu || NPC_SBU_OPTIONS[0].value : ownSbu ?? "";

  const { data, isLoading, isError } = useQuery({
    queryKey: ["forecast", "npc", effectiveSbu],
    queryFn: async () => (await api.get<{ asOfMonth: number; rows: NpcForecastRow[] }>(`/forecast/npc/${effectiveSbu}`)).data,
    enabled: !!effectiveSbu,
  });
  const rows = data?.rows ?? [];
  const asOfMonth = data?.asOfMonth ?? 9;
  const remainingMonths = Array.from({ length: 12 - asOfMonth }, (_, i) => asOfMonth + 1 + i);
  // Budget Code, Project Title, NPC Budget, IO Code(s), IO Description, IO
  // Budget, IO Actual, NPC Available Budget (8) + one column per remaining
  // month + Total Remaining Forecast, Total Actual + Forecast, NPC Surplus (3).
  const columnCount = 8 + remainingMonths.length + 3;

  // Carry-over IOs (appended at the end of the table - see the render
  // below) still count toward the SBU's approved NPC total - the source
  // workbook's own per-SBU tab total (Amount - Cut, summed top to bottom)
  // includes its "Carryover" rows exactly the same as new-budget-code
  // rows, and each carry-over row's npcBudget is already set equal to its
  // ioBudget (no fresh ask this cycle, but a real approved figure), so
  // excluding them here would only make this total diverge from the
  // workbook's.
  // ioActual is only summed across rows that actually have one - a project
  // with no live/imported Actual yet shouldn't silently count as ₱0 and
  // understate the total, same "—" semantics each row's own cell already
  // uses (see the table below).
  const rowsWithActual = rows.filter((r) => r.ioActual !== null);
  const totals = {
    npcBudget: rows.reduce((sum, r) => sum + r.npcBudget, 0),
    ioBudget: rows.reduce((sum, r) => sum + r.ioBudget, 0),
    ioActual: rowsWithActual.length > 0 ? rowsWithActual.reduce((sum, r) => sum + (r.ioActual ?? 0), 0) : null,
    npcAvailableBudget: rows.reduce((sum, r) => sum + r.npcAvailableBudget, 0),
    monthlyRemainingForecast: remainingMonths.reduce<Record<string, number>>((acc, m) => {
      acc[String(m)] = rows.reduce((sum, r) => sum + (r.monthlyRemainingForecast[String(m)] ?? 0), 0);
      return acc;
    }, {}),
    remainingMonthsForecast: rows.reduce((sum, r) => sum + r.remainingMonthsForecast, 0),
    totalActualForecast: rows.reduce((sum, r) => sum + r.totalActualForecast, 0),
    npcSurplus: rows.reduce((sum, r) => sum + r.npcSurplus, 0),
  };

  // Filtering/sorting only ever changes what's rendered in the body below -
  // the TOTAL row above always reflects the full SBU, not the filtered/
  // sorted subset, same as a spreadsheet's own grand total staying put
  // under an AutoFilter.
  const [filterText, setFilterText] = useState("");
  const [sortColumn, setSortColumn] = useState<SortColumn | null>(null);
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("asc");

  const filteredRows = filterText.trim()
    ? rows.filter((r) => {
        const needle = filterText.trim().toLowerCase();
        return (
          r.budgetCode.toLowerCase().includes(needle) ||
          r.projectTitle.toLowerCase().includes(needle) ||
          r.ios.some((io) => io.code.includes(needle) || io.description.toLowerCase().includes(needle))
        );
      })
    : rows;

  const displayRows = sortColumn
    ? [...filteredRows].sort((a, b) => {
        const av = a[sortColumn];
        const bv = b[sortColumn];
        // null (no Actual yet) always sorts last, in either direction -
        // otherwise it's indistinguishable from a real ₱0.
        if (av === null && bv === null) return 0;
        if (av === null) return 1;
        if (bv === null) return -1;
        const cmp = typeof av === "string" ? av.localeCompare(bv as string) : (av as number) - (bv as number);
        return sortDirection === "asc" ? cmp : -cmp;
      })
    : filteredRows;

  function toggleSort(column: SortColumn) {
    if (sortColumn === column) {
      setSortDirection((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortColumn(column);
      setSortDirection("asc");
    }
  }

  function sortHeader(column: SortColumn, label: string) {
    const active = sortColumn === column;
    return (
      <button type="button" onClick={() => toggleSort(column)} className={`inline-flex items-center gap-0.5 hover:underline ${active ? "text-emerald-900" : ""}`}>
        {label}
        <span className="text-[10px]">{active ? (sortDirection === "asc" ? "▲" : "▼") : ""}</span>
      </button>
    );
  }

  // Keyed by budgetCode, not budgetRequestId (see NpcForecastEntry's own
  // schema comment on the Node side) - every row has one, including a row
  // sourced only from the NPC Monitoring import (no real BudgetRequest
  // behind it), so every row's cells below are editable, same as GAE's.
  const updateMutation = useMutation({
    mutationFn: async ({ budgetCode, month, value }: { budgetCode: string; month: number; value: number }) =>
      (await api.patch(`/forecast/npc/entries/${encodeURIComponent(budgetCode)}`, { month, value })).data,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["forecast", "npc", effectiveSbu] }),
  });

  const [uploadStatus, setUploadStatus] = useState<{ ok: boolean; message: string } | null>(null);
  const uploadMutation = useMutation({
    mutationFn: async (file: File) => {
      const form = new FormData();
      form.append("file", file);
      form.append("npcSbu", effectiveSbu);
      try {
        return (await api.post<{ ok: boolean; updated?: number; errors?: { row: number; error: string }[] }>("/forecast/npc/upload", form)).data;
      } catch (err: any) {
        if (err.response?.status === 400 && err.response.data?.errors) return err.response.data;
        throw err;
      }
    },
    onSuccess: (data) => {
      if (data.ok === false) {
        setUploadStatus({ ok: false, message: `${data.errors?.length ?? 0} row(s) rejected - fix and re-upload.` });
      } else {
        setUploadStatus({ ok: true, message: `Updated ${data.updated} row(s).` });
        queryClient.invalidateQueries({ queryKey: ["forecast", "npc", effectiveSbu] });
      }
    },
  });

  if (!effectiveSbu) {
    return (
      <div className="space-y-4">
        <PageHeader subtitle="Your department has no NPC SBU assigned - ask the Budget Officer to set one in the Admin Console." />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <PageHeader
        subtitle={`Months through ${MONTH_NAMES[asOfMonth - 1]} are already in Actuals - only remaining months are editable.`}
        actions={
          isBudgetOfficer ? (
            <select className="rounded border border-slate-300 px-2 py-1.5 text-sm" value={effectiveSbu} onChange={(e) => setPickedSbu(e.target.value as NpcSbu)}>
              {NPC_SBU_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          ) : undefined
        }
      />

      {isBudgetOfficer && (
        <div className="flex flex-wrap items-center gap-4 rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
          <div className="flex items-center gap-2">
            <label className="text-xs font-semibold text-slate-600">YTD Actual through</label>
            <select className="rounded border border-slate-300 px-2 py-1 text-sm" value={fiscalCycle?.npcAsOfMonth2026 ?? 9} onChange={(e) => asOfMonthMutation.mutate(Number(e.target.value))}>
              {MONTH_NAMES.map((name, i) => (
                <option key={name} value={i + 1}>
                  {name}
                </option>
              ))}
            </select>
          </div>
        </div>
      )}

      {targetYear >= 2027 && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
          <a
            href={`/api/forecast/npc/template?npcSbu=${effectiveSbu}`}
            className="rounded-md border border-emerald-300 bg-emerald-50 px-3 py-1.5 text-xs font-medium text-emerald-800 hover:bg-emerald-100"
          >
            Open Spreadsheet Template
          </a>
          <label className="cursor-pointer rounded-md border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100">
            {uploadMutation.isPending ? "Uploading…" : "Upload Completed Template"}
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
          {uploadStatus && <span className={`text-xs ${uploadStatus.ok ? "text-emerald-700" : "text-red-600"}`}>{uploadStatus.message}</span>}
        </div>
      )}

      {isError && <div className="text-sm text-red-700">You do not have access to this SBU's NPC forecast.</div>}

      <div className="flex items-center gap-2">
        <input
          type="text"
          placeholder="Filter by Budget Code, Project Title, or IO Code…"
          value={filterText}
          onChange={(e) => setFilterText(e.target.value)}
          className="w-80 rounded border border-slate-300 px-2 py-1 text-sm"
        />
        {filterText && (
          <button type="button" onClick={() => setFilterText("")} className="text-xs text-slate-500 hover:underline">
            Clear
          </button>
        )}
        {filterText && (
          <span className="text-xs text-slate-500">
            {displayRows.length} of {rows.length} row(s)
          </span>
        )}
      </div>

      <ExpandableSection title="NPC Forecast">
        {/* max-h + overflow-auto (not a lone overflow-x-auto) so this is a
            real 2-axis scroll pane - a bare overflow-x-auto gets silently
            upgraded to overflow-y: auto too per the CSS spec once any
            sticky descendant needs a containing block, which leaves
            `position: sticky` inert with no explicit height cap (same fix
            ForecastPage.tsx's GAE/DOE grid already needed). */}
        <div className="max-h-[70vh] overflow-auto rounded-lg border border-slate-200 bg-white shadow-sm">
          <table className="table-fixed text-xs" style={{ width: Array.from({ length: columnCount }, (_, i) => colWidthPx(i)).reduce((a, b) => a + b, 0) }}>
            <colgroup>
              {Array.from({ length: columnCount }).map((_, i) => (
                <col key={i} style={{ width: colWidthPx(i) }} />
              ))}
            </colgroup>
            {/* The whole thead (header row + TOTAL row) sticks together as
                one unit - sticky on <thead> itself, not each <tr>, sticks
                every row inside it without needing to hand-compute a `top`
                offset per row. */}
            <thead className="sticky top-0 z-20 bg-emerald-50 text-left tracking-wide text-emerald-800">
              <tr>
                <th rowSpan={2} className="sticky z-30 whitespace-nowrap bg-emerald-50 px-2 py-2 align-bottom" style={{ left: FROZEN_LEFT_PX[0] }}>
                  {sortHeader("budgetCode", "Budget Code")}
                </th>
                <th rowSpan={2} className="sticky z-30 whitespace-nowrap bg-emerald-50 px-2 py-2 align-bottom" style={{ left: FROZEN_LEFT_PX[1] }}>
                  {sortHeader("projectTitle", "Project Title")}
                </th>
                <th rowSpan={2} className="px-2 py-2 text-right align-bottom">
                  {sortHeader("npcBudget", "NPC Budget")}
                </th>
                <th rowSpan={2} className="px-2 py-2 align-bottom">
                  IO Code(s)
                </th>
                <th rowSpan={2} className="px-2 py-2 align-bottom">
                  IO Description
                </th>
                <th rowSpan={2} className="px-2 py-2 text-right align-bottom">
                  {sortHeader("ioBudget", "IO Budget")}
                </th>
                <th rowSpan={2} className="px-2 py-2 text-right align-bottom">
                  {sortHeader("ioActual", "IO Actual")}
                </th>
                <th rowSpan={2} className="px-2 py-2 text-right align-bottom">
                  {sortHeader("npcAvailableBudget", "NPC Available Budget")}
                </th>
                <th colSpan={remainingMonths.length + 1} className="px-2 py-2 text-center">
                  Forecast
                </th>
                <th rowSpan={2} className="px-2 py-2 text-right align-bottom">
                  {sortHeader("totalActualForecast", "Total Actual + Forecast")}
                </th>
                <th rowSpan={2} className="px-2 py-2 text-right align-bottom">
                  {sortHeader("npcSurplus", "NPC Surplus/(Deficit)")}
                </th>
              </tr>
              <tr>
                {remainingMonths.map((m) => (
                  <th key={m} className="px-2 py-2 text-right">
                    {MONTH_NAMES[m - 1]}
                  </th>
                ))}
                <th className="px-2 py-2 text-right">
                  {sortHeader("remainingMonthsForecast", "Total Forecast")}
                </th>
              </tr>
              {rows.length > 0 && (
                <tr className="border-t-2 border-slate-200 bg-slate-50 font-semibold text-slate-700">
                  <td className="sticky z-30 whitespace-nowrap bg-slate-50 px-2 py-1" style={{ left: FROZEN_LEFT_PX[0] }} colSpan={2}>
                    TOTAL
                  </td>
                  <td className="whitespace-nowrap px-2 py-1 text-right">{peso(totals.npcBudget)}</td>
                  <td className="px-2 py-1" />
                  <td className="px-2 py-1" />
                  <td className="whitespace-nowrap px-2 py-1 text-right">{peso(totals.ioBudget)}</td>
                  <td className="whitespace-nowrap px-2 py-1 text-right">{totals.ioActual === null ? "—" : peso(totals.ioActual)}</td>
                  <td className="whitespace-nowrap px-2 py-1 text-right">{peso(totals.npcAvailableBudget)}</td>
                  {remainingMonths.map((m) => (
                    <td key={m} className="whitespace-nowrap px-2 py-1 text-right">
                      {peso(totals.monthlyRemainingForecast[String(m)] ?? 0)}
                    </td>
                  ))}
                  <td className="whitespace-nowrap px-2 py-1 text-right">{peso(totals.remainingMonthsForecast)}</td>
                  <td className="whitespace-nowrap px-2 py-1 text-right">{peso(totals.totalActualForecast)}</td>
                  <td className="whitespace-nowrap px-2 py-1 text-right text-emerald-800">{peso(totals.npcSurplus)}</td>
                </tr>
              )}
            </thead>
            <tbody className="divide-y divide-slate-100">
              {isLoading ? (
                <tr>
                  <td colSpan={columnCount} className="px-2 py-6 text-center text-slate-400">
                    Loading…
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={columnCount} className="px-2 py-6 text-center text-slate-400">
                    No finalized NPC projects for this SBU yet.
                  </td>
                </tr>
              ) : displayRows.length === 0 ? (
                <tr>
                  <td colSpan={columnCount} className="px-2 py-6 text-center text-slate-400">
                    No rows match "{filterText}".
                  </td>
                </tr>
              ) : (
                displayRows.map((r, i) => {
                  // Frozen cells need a fully OPAQUE background (not
                  // "inherit"/transparent) - otherwise the columns
                  // scrolling underneath a sticky cell show through it
                  // (same fix ForecastPage.tsx's grid already needed).
                  // A top border marks where the Carry-over section starts
                  // (rows are already sorted with every real project first -
                  // see npcForecastService.ts) - only meaningful while
                  // unsorted/unfiltered, same as a spreadsheet's own
                  // grouping visually breaking once you sort by something
                  // else.
                  const isFirstCarryOver = r.isCarryOver && !displayRows[i - 1]?.isCarryOver;
                  return (
                    <tr key={r.budgetCode} className={isFirstCarryOver ? "border-t-2 border-slate-200" : undefined}>
                      <td className={`sticky z-10 whitespace-nowrap bg-white px-2 py-1 ${r.isCarryOver ? "italic text-slate-400" : ""}`} style={{ left: FROZEN_LEFT_PX[0] }}>
                        {r.isCarryOver ? "Carry-over" : r.budgetCode}
                      </td>
                      <td className="sticky z-10 truncate bg-white px-2 py-1" style={{ left: FROZEN_LEFT_PX[1] }} title={r.projectTitle}>
                        {r.projectTitle}
                      </td>
                      <td className="whitespace-nowrap px-2 py-1 text-right">{peso(r.npcBudget)}</td>
                      {r.ios.length > 0 ? (
                        <>
                          <td className="px-2 py-1">
                            {r.ios.map((io) => (
                              <div key={io.code}>{formatAufnr(io.code)}</div>
                            ))}
                          </td>
                          <td className="px-2 py-1">
                            {r.ios.map((io) => (
                              <div key={io.code} className="truncate" title={io.description}>
                                {io.description}
                              </div>
                            ))}
                          </td>
                          <td className="whitespace-nowrap px-2 py-1 text-right">
                            {r.ios.map((io) => (
                              <div key={io.code}>{peso(io.budget)}</div>
                            ))}
                          </td>
                          <td className="whitespace-nowrap px-2 py-1 text-right">
                            {r.ios.map((io) => (
                              <div key={io.code}>{io.actual === null ? "—" : peso(io.actual)}</div>
                            ))}
                          </td>
                        </>
                      ) : (
                        <>
                          <td className="px-2 py-1">—</td>
                          <td className="px-2 py-1">—</td>
                          <td className="whitespace-nowrap px-2 py-1 text-right">{peso(0)}</td>
                          <td className="whitespace-nowrap px-2 py-1 text-right">—</td>
                        </>
                      )}
                      <td className="whitespace-nowrap px-2 py-1 text-right">{peso(r.npcAvailableBudget)}</td>
                      {/* Same input styling/onBlur pattern as ForecastPage.tsx's
                          GAE/DOE grid - editable for every row (including a
                          Carry-over row and one sourced only from the NPC
                          Monitoring import), keyed by budgetCode rather than
                          budgetRequestId so a row with no real BudgetRequest
                          still has somewhere to save its own entry. */}
                      {remainingMonths.map((m) => (
                        <td key={m} className="whitespace-nowrap px-2 py-1 text-right">
                          <input
                            type="number"
                            className="w-full rounded border border-slate-300 px-1 py-0.5 text-right text-xs"
                            defaultValue={r.monthlyRemainingForecast[String(m)] ?? ""}
                            onBlur={(e) => {
                              const value = Number(e.target.value) || 0;
                              if (value !== (r.monthlyRemainingForecast[String(m)] ?? 0)) {
                                updateMutation.mutate({ budgetCode: r.budgetCode, month: m, value });
                              }
                            }}
                          />
                        </td>
                      ))}
                      <td className="whitespace-nowrap px-2 py-1 text-right font-medium text-slate-700">{peso(r.remainingMonthsForecast)}</td>
                      <td className="whitespace-nowrap px-2 py-1 text-right">{peso(r.totalActualForecast)}</td>
                      <td className="whitespace-nowrap px-2 py-1 text-right font-semibold text-emerald-800">{peso(r.npcSurplus)}</td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </ExpandableSection>
    </div>
  );
}
