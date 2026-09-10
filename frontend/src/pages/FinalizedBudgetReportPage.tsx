import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, type FinalizedBudgetReport } from "../api/client";
import { PageHeader } from "../components/PageHeader";
import { SectionLabel } from "../components/TabBar";
import { useFiscalYear } from "../lib/fiscalCycle";

function peso(n: number) {
  return `₱${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

// Note 11 §3 - Budget-Officer-only view over the "Finalize & Upload"
// snapshot (FinalizedBudgetLine), replacing the old page-level "Ready for
// SAP Upload" panel. Filterable by CC-GL search, shows CC/GL names, and
// retains the existing board-approved-budget-vs-total-finalized check.
export function FinalizedBudgetReportPage() {
  const { targetYear: FISCAL_YEAR } = useFiscalYear();
  const [search, setSearch] = useState("");

  const { data, isLoading } = useQuery({
    queryKey: ["finalized-budget-report", FISCAL_YEAR, search],
    queryFn: async () =>
      (
        await api.get<FinalizedBudgetReport>("/budget-requests/finalized-budget-report", {
          params: { fiscalYear: FISCAL_YEAR, search: search || undefined },
        })
      ).data,
  });

  const lines = data?.lines ?? [];
  const boardBudgetChecks = data?.boardBudgetChecks ?? [];

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader
        subtitle="The finalized/uploaded budget per CC-GL, from every category's one-click Finalize & Upload action."
        actions={
          <a
            href={`/api/budget-requests/finalized-budget-report/export?fiscalYear=${FISCAL_YEAR}${search ? `&search=${encodeURIComponent(search)}` : ""}`}
            className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100"
          >
            Export to Excel
          </a>
        }
      />

      <input
        className="w-72 rounded border border-slate-300 px-2 py-1.5 text-sm"
        placeholder="Search Cost Center or GL Account…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />

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
              </tr>
            </thead>
            <tbody>
              {boardBudgetChecks.map((c, i) => (
                <tr key={i} className="border-t border-slate-100">
                  <td className="py-1 pr-3">{c.requestCategory}</td>
                  <td className="py-1 pr-3">{c.sbu ?? "—"}</td>
                  <td className="py-1 pr-3">{peso(c.boardApprovedAmount)}</td>
                  <td className="py-1 pr-3">{peso(c.totalFinalizedAmount)}</td>
                  <td className={`py-1 pr-3 font-semibold ${c.variance < 0 ? "text-red-700" : "text-slate-700"}`}>{peso(c.variance)}</td>
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
              <th className="px-4 py-2">Cost Center</th>
              <th className="px-4 py-2">GL Account</th>
              <th className="px-4 py-2">Amount</th>
              <th className="px-4 py-2"># Requests</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {isLoading ? (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-slate-400">
                  Loading…
                </td>
              </tr>
            ) : lines.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-slate-400">
                  Nothing finalized yet for {FISCAL_YEAR}.
                </td>
              </tr>
            ) : (
              lines.map((l, i) => (
                <tr key={i}>
                  <td className="px-4 py-2">{l.requestCategory}</td>
                  <td className="px-4 py-2">{l.sbu ?? l.npcSbu ?? "—"}</td>
                  <td className="px-4 py-2">
                    {l.costCenter} {l.costCenterName && <span className="text-slate-500">({l.costCenterName})</span>}
                  </td>
                  <td className="px-4 py-2">
                    {l.glAccount} {l.glAccountName && <span className="text-slate-500">({l.glAccountName})</span>}
                  </td>
                  <td className="px-4 py-2 font-semibold text-slate-700">{peso(l.amount)}</td>
                  <td className="px-4 py-2 text-slate-500">{l.lineCount}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
