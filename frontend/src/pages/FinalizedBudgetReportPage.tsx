import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, downloadFile, NPC_SBU_OPTIONS, SBU_OPTIONS, type FinalizedBudgetLineOut, type FinalizedBudgetReport, type NpcSbu, type RequestCategory, type Sbu } from "../api/client";
import { FinalizedBudgetLineDetailModal } from "../components/FinalizedBudgetLineDetailModal";
import { PageHeader } from "../components/PageHeader";
import { SectionLabel } from "../components/TabBar";
import { useFiscalYear } from "../lib/fiscalCycle";

function peso(n: number) {
  return `${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

const CATEGORY_OPTIONS: { value: RequestCategory; label: string }[] = [
  { value: "GAE", label: "General & Administrative Expenses (GAE)" },
  { value: "DOE", label: "Direct Operating Expenses (DOE)" },
  { value: "COMMISSION", label: "Commission" },
  { value: "COST_OF_SALES", label: "Cost of Sales" },
  { value: "DEPRECIATION_AMORTIZATION", label: "Depreciation & Amortization" },
  { value: "INTEREST_EXPENSE", label: "Interest Expense" },
  { value: "NPC", label: "Non-Project Capex (NPC)" },
  { value: "REVENUE", label: "Revenue" },
];

// Categories that always belong to the Corporate SBU - their SBU filter is fixed.
const CORPORATE_ONLY_CATEGORIES: RequestCategory[] = ["GAE", "DEPRECIATION_AMORTIZATION", "INTEREST_EXPENSE"];

// Note 11 §3 - Budget-Officer-only view over the "Finalize & Upload"
// snapshot (FinalizedBudgetLine), replacing the old page-level "Ready for
// SAP Upload" panel. Filterable by CC-GL search, shows CC/GL names, and
// retains the existing board-approved-budget-vs-total-finalized check.
export function FinalizedBudgetReportPage() {
  const { targetYear: FISCAL_YEAR } = useFiscalYear();
  const [category, setCategory] = useState<RequestCategory | "">("");
  const [sbu, setSbu] = useState<Sbu | "">("");
  const [npcSbu, setNpcSbu] = useState<NpcSbu | "">("");
  // Budget Code / Ticket # - filtered client-side against the already-
  // fetched rows below (category/sbu/npcSbu alone are what's worth a round
  // trip to the server; narrowing further by these two is cheap on an
  // already-small result set, and keeps each visible column independently
  // filterable instead of one shared free-text box).
  const [budgetCodeFilter, setBudgetCodeFilter] = useState("");
  const [ticketFilter, setTicketFilter] = useState("");
  const [exportError, setExportError] = useState<string | null>(null);
  const [detailLine, setDetailLine] = useState<FinalizedBudgetLineOut | null>(null);

  const filterParams = {
    fiscalYear: FISCAL_YEAR,
    requestCategory: category || undefined,
    // These categories' finalized lines are saved without an SBU, so filtering by Corporate would drop them.
    sbu: CORPORATE_ONLY_CATEGORIES.includes(category as RequestCategory) ? undefined : sbu || undefined,
    npcSbu: category === "NPC" ? npcSbu || undefined : undefined,
  };

  const { data, isLoading } = useQuery({
    queryKey: ["finalized-budget-report", filterParams],
    queryFn: async () => (await api.get<FinalizedBudgetReport>("/budget-requests/finalized-budget-report", { params: filterParams })).data,
  });

  const lines = (data?.lines ?? []).filter((l) => {
    if (budgetCodeFilter && !l.budgetCodes.some((c) => c.toLowerCase().includes(budgetCodeFilter.toLowerCase()))) return false;
    if (ticketFilter && !l.ticketNumbers.some((t) => t.toLowerCase().includes(ticketFilter.toLowerCase()))) return false;
    return true;
  });
  const boardBudgetChecks = data?.boardBudgetChecks ?? [];

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader
        subtitle="The finalized/uploaded budget per CC-GL, from every category's one-click Finalize & Upload action."
        actions={
          <button
            type="button"
            onClick={() => {
              const qs = new URLSearchParams();
              for (const [key, value] of Object.entries(filterParams)) if (value !== undefined) qs.set(key, String(value));
              downloadFile(`/budget-requests/finalized-budget-report/export?${qs.toString()}`, `finalized-budget-report-${FISCAL_YEAR}.xlsx`).catch(() => setExportError("Failed to export the report."));
            }}
            className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100"
          >
            Generate Report
          </button>
        }
      />
      {exportError && <div className="rounded bg-red-50 p-2 text-sm text-red-700">{exportError}</div>}

      <div className="flex flex-wrap items-center gap-2">
        <select
          className="rounded border border-slate-300 px-2 py-1.5 text-sm"
          value={category}
          onChange={(e) => {
            const next = e.target.value as RequestCategory | "";
            setCategory(next);
            // GAE, Depreciation & Amortization and Interest Expense are always the Corporate SBU,
            // so it's set (and fixed) here rather than picked.
            setSbu(CORPORATE_ONLY_CATEGORIES.includes(next as RequestCategory) ? "CORPORATE" : "");
            setNpcSbu("");
          }}
        >
          <option value="">All Categories</option>
          {CATEGORY_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        {category === "NPC" ? (
          <select className="rounded border border-slate-300 px-2 py-1.5 text-sm" value={npcSbu} onChange={(e) => setNpcSbu(e.target.value as NpcSbu | "")}>
            <option value="">All SBUs</option>
            {NPC_SBU_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        ) : CORPORATE_ONLY_CATEGORIES.includes(category as RequestCategory) ? (
          <select className="rounded border border-slate-300 bg-slate-50 px-2 py-1.5 text-sm" value="CORPORATE" disabled>
            <option value="CORPORATE">Corporate</option>
          </select>
        ) : (
          <select className="rounded border border-slate-300 px-2 py-1.5 text-sm" value={sbu} onChange={(e) => setSbu(e.target.value as Sbu | "")}>
            <option value="">All SBUs</option>
            {SBU_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        )}
        {(category || sbu || npcSbu || budgetCodeFilter || ticketFilter) && (
          <button
            type="button"
            onClick={() => {
              setCategory("");
              setSbu("");
              setNpcSbu("");
              setBudgetCodeFilter("");
              setTicketFilter("");
            }}
            className="text-xs font-medium text-slate-500 hover:text-emerald-700"
          >
            Clear filters
          </button>
        )}
      </div>

      {boardBudgetChecks.length > 0 && (
        <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
          <SectionLabel>Board-Approved Budget vs. Total Finalized</SectionLabel>
          <table className="mt-2 w-full text-xs">
            <thead className="text-left tracking-wide text-slate-500">
              <tr>
                <th className="py-1 pr-3">Category</th>
                <th className="py-1 pr-3">SBU</th>
                <th className="py-1 pr-3">Board-Approved</th>
                <th className="py-1 pr-3">Total Finalized</th>
                <th className="py-1 pr-3">Variance</th>
                <th className="py-1 pr-3"></th>
              </tr>
            </thead>
            <tbody>
              {boardBudgetChecks.map((c, i) => (
                <tr key={i} className="border-t border-slate-100">
                  <td className="py-1 pr-3">{c.requestCategory}</td>
                  <td className="py-1 pr-3">{c.sbu ?? (CORPORATE_ONLY_CATEGORIES.includes(c.requestCategory) ? "Corporate" : "—")}</td>
                  <td className="py-1 pr-3">{peso(c.boardApprovedAmount)}</td>
                  <td className="py-1 pr-3">{peso(c.totalFinalizedAmount)}</td>
                  <td className={`py-1 pr-3 font-semibold ${c.variance < 0 ? "text-red-700" : "text-slate-700"}`}>{peso(c.variance)}</td>
                  <td className="py-1 pr-3">
                    {c.requestCategory !== "NPC" && (
                      <button
                        type="button"
                        onClick={() => {
                          const qs = new URLSearchParams({ fiscalYear: String(FISCAL_YEAR), requestCategory: c.requestCategory });
                          if (c.sbu) qs.set("sbu", c.sbu);
                          const label = c.sbu ? `${c.requestCategory}-${c.sbu}` : c.requestCategory;
                          downloadFile(`/budget-requests/finalized-budget-report/sap-template?${qs.toString()}`, `SAP Upload Template - ${label} - ${FISCAL_YEAR}.xlsx`).catch(() => setExportError("Failed to generate the SAP upload template."));
                        }}
                        className="rounded-md border border-emerald-300 bg-emerald-50 px-2 py-1 text-[11px] font-medium text-emerald-800 hover:bg-emerald-100"
                      >
                        Generate SAP Upload Template
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead className="bg-emerald-50 text-left text-xs tracking-wide text-emerald-800">
            <tr>
              <th className="px-4 py-2">Category</th>
              <th className="px-4 py-2">SBU</th>
              <th className="px-4 py-2">Budget Code</th>
              <th className="px-4 py-2">Request</th>
              <th className="px-4 py-2">Budget Cut</th>
              <th className="px-4 py-2">Approved</th>
              <th className="px-4 py-2">Ticket #</th>
            </tr>
            {/* Per-column filter row - Category/SBU reuse the dropdowns above
                (so there's one source of truth for them, not two), Budget
                Code and Ticket # get their own inputs here since nothing
                else filters by those. */}
            <tr className="border-t border-emerald-100 bg-white">
              <th className="px-4 py-1.5 font-normal normal-case text-slate-400">{category ? CATEGORY_OPTIONS.find((o) => o.value === category)?.label.split(" (")[0] : "All"}</th>
              <th className="px-4 py-1.5 font-normal normal-case text-slate-400">{sbu || npcSbu || (CORPORATE_ONLY_CATEGORIES.includes(category as RequestCategory) ? "Corporate" : "All")}</th>
              <th className="px-4 py-1.5">
                <input
                  className="w-full rounded border border-slate-300 px-1.5 py-0.5 text-xs font-normal normal-case text-slate-700"
                  placeholder="Filter…"
                  value={budgetCodeFilter}
                  onChange={(e) => setBudgetCodeFilter(e.target.value)}
                />
              </th>
              <th className="px-4 py-1.5" />
              <th className="px-4 py-1.5" />
              <th className="px-4 py-1.5" />
              <th className="px-4 py-1.5">
                <input
                  className="w-full rounded border border-slate-300 px-1.5 py-0.5 text-xs font-normal normal-case text-slate-700"
                  placeholder="Filter…"
                  value={ticketFilter}
                  onChange={(e) => setTicketFilter(e.target.value)}
                />
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {isLoading ? (
              <tr>
                <td colSpan={7} className="px-4 py-6 text-center text-slate-400">
                  Loading…
                </td>
              </tr>
            ) : lines.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-6 text-center text-slate-400">
                  Nothing finalized yet for {FISCAL_YEAR}.
                </td>
              </tr>
            ) : (
              lines.map((l, i) => (
                <tr key={i}>
                  <td className="px-4 py-2">{l.requestCategory}</td>
                  <td className="px-4 py-2">{l.sbu ?? l.npcSbu ?? (CORPORATE_ONLY_CATEGORIES.includes(l.requestCategory) ? "Corporate" : "—")}</td>
                  <td className="px-4 py-2">{l.budgetCodes.length > 0 ? l.budgetCodes.join(", ") : "—"}</td>
                  <td className="px-4 py-2">{peso(l.requestedAmount)}</td>
                  <td className="px-4 py-2 text-slate-600">{l.budgetCutAmount > 0 ? peso(l.budgetCutAmount) : "—"}</td>
                  <td className="px-4 py-2 font-semibold text-slate-700">{peso(l.amount)}</td>
                  <td className="px-4 py-2">
                    <button type="button" onClick={() => setDetailLine(l)} className="text-emerald-700 underline hover:text-emerald-800">
                      {l.ticketNumbers.length > 0 ? l.ticketNumbers.join(", ") : `${l.lineCount} request${l.lineCount === 1 ? "" : "s"}`}
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {detailLine && (
        <FinalizedBudgetLineDetailModal
          fiscalYear={FISCAL_YEAR}
          requestCategory={detailLine.requestCategory}
          sbu={detailLine.sbu}
          npcSbu={detailLine.npcSbu}
          glAccount={detailLine.glAccount}
          costCenter={detailLine.costCenter}
          label={`${detailLine.costCenter}${detailLine.costCenterName ? ` (${detailLine.costCenterName})` : ""} / ${detailLine.glAccount}`}
          onClose={() => setDetailLine(null)}
        />
      )}
    </div>
  );
}
