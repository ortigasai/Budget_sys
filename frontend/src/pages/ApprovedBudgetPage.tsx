import { useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api, api2, SBU_OPTIONS, type ApprovedBudgetOut, type FinalizedBudgetReport, type Sbu } from "../api/client";
import { PageHeader } from "../components/PageHeader";
import { SectionLabel } from "../components/TabBar";
import { useAuth } from "../context/AuthContext";
import { useFiscalYear } from "../lib/fiscalCycle";

function peso(n: number) {
  return `₱${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

interface OverviewRow {
  glAccount: string;
  costCenter: string;
  approvedBudget: number;
  actualExpenditures: number;
  commitments: number;
  totalAllotted: number;
  available: number;
}

// Note 11 §4 - one report section (DOE/Revenue/NPC/GAE) worth of
// FinalizedBudgetLine rows, rendered the same shape as
// FinalizedBudgetReportPage's table, just without the search box - this
// page is a fixed per-SBU view, not a searchable one.
function ReportSection({ title, report }: { title: string; report: FinalizedBudgetReport | null }) {
  if (!report) return null;
  return (
    <div className="space-y-2">
      <SectionLabel>{title}</SectionLabel>
      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead className="bg-emerald-50 text-left text-xs tracking-wide text-emerald-800">
            <tr>
              <th className="px-4 py-2">Cost Center</th>
              <th className="px-4 py-2">GL Account</th>
              <th className="px-4 py-2">Amount</th>
              <th className="px-4 py-2"># Requests</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {report.lines.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-4 py-4 text-center text-slate-400">
                  Nothing finalized yet.
                </td>
              </tr>
            ) : (
              report.lines.map((l, i) => (
                <tr key={i}>
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
      {report.boardBudgetChecks.map((c, i) => (
        <div key={i} className={`text-xs font-medium ${c.variance < 0 ? "text-red-700" : "text-slate-500"}`}>
          Board-approved {peso(c.boardApprovedAmount)} vs. finalized {peso(c.totalFinalizedAmount)} (variance {peso(c.variance)})
        </div>
      ))}
    </div>
  );
}

// Corporate's third panel (in place of Revenue, which doesn't apply to
// Corporate) - the existing Budget Utilization Tracking overview
// (Phase 2, Python-owned), reused as-is via api2 rather than re-modeled
// here. Mirrors UtilizationPage.tsx's own "overview" tab.
function BudgetUtilizationSection({ fiscalYear }: { fiscalYear: number }) {
  const { data: departments = [] } = useQuery({
    queryKey: ["utilization", "departments"],
    queryFn: async () => (await api2.get<{ id: string; name: string }[]>("/utilization/departments")).data,
  });
  const deptId = departments[0]?.id ?? "";

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["utilization", "overview", deptId, fiscalYear],
    queryFn: async () =>
      (
        await api2.get<OverviewRow[]>("/utilization/overview", {
          params: { departmentId: deptId, fiscalYear },
        })
      ).data,
    enabled: !!deptId,
  });

  return (
    <div className="space-y-2">
      <SectionLabel>Budget Utilization</SectionLabel>
      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead className="bg-emerald-50 text-left text-xs tracking-wide text-emerald-800">
            <tr>
              <th className="px-4 py-2">Cost Center</th>
              <th className="px-4 py-2">GL Account</th>
              <th className="px-4 py-2">Approved Budget</th>
              <th className="px-4 py-2">Actual</th>
              <th className="px-4 py-2">Commitments</th>
              <th className="px-4 py-2">Available</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {isLoading ? (
              <tr>
                <td colSpan={6} className="px-4 py-4 text-center text-slate-400">
                  Loading…
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-4 text-center text-slate-400">
                  No utilization data yet.
                </td>
              </tr>
            ) : (
              rows.map((r, i) => (
                <tr key={i}>
                  <td className="px-4 py-2">{r.costCenter}</td>
                  <td className="px-4 py-2">{r.glAccount}</td>
                  <td className="px-4 py-2">{peso(r.approvedBudget)}</td>
                  <td className="px-4 py-2">{peso(r.actualExpenditures)}</td>
                  <td className="px-4 py-2">{peso(r.commitments)}</td>
                  <td className="px-4 py-2 font-semibold text-slate-700">{peso(r.available)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function ApprovedBudgetPage() {
  const { hasRole, hasSbuRole } = useAuth();
  const { targetYear: FISCAL_YEAR } = useFiscalYear();
  const [searchParams] = useSearchParams();
  const sbu = searchParams.get("sbu") as Sbu | null;

  const isBudgetOfficer = hasRole("BUDGET_OFFICER");
  const canView = !!sbu && (isBudgetOfficer || hasSbuRole("BU_FINANCE_OFFICER", sbu) || hasSbuRole("BU_FINANCE_HEAD", sbu));

  const { data, isLoading } = useQuery({
    queryKey: ["approved-budget", sbu, FISCAL_YEAR],
    queryFn: async () => (await api.get<ApprovedBudgetOut>(`/approved-budget/${sbu}`, { params: { fiscalYear: FISCAL_YEAR } })).data,
    enabled: canView,
  });

  if (!sbu) {
    return (
      <div className="space-y-6">
        <PageHeader subtitle="Choose an SBU from the menu on the left to view its approved budget." />
      </div>
    );
  }

  if (!canView) {
    return (
      <div className="space-y-6">
        <PageHeader subtitle="You do not have Approved Budget access for this SBU." />
      </div>
    );
  }

  const label = SBU_OPTIONS.find((o) => o.value === sbu)?.label ?? sbu;
  const isCorporate = sbu === "CORPORATE";

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader subtitle={`Approved (finalized & uploaded) budget for ${label}, ${FISCAL_YEAR}.`} />

      {isLoading || !data ? (
        <div className="text-sm text-slate-400">Loading…</div>
      ) : isCorporate ? (
        <>
          <ReportSection title="General & Administrative Expenses (GAE)" report={data.gae} />
          <ReportSection title="Non-Project Capex (NPC)" report={data.npc} />
          <BudgetUtilizationSection fiscalYear={FISCAL_YEAR} />
        </>
      ) : (
        <>
          <ReportSection title="Direct Operating Expenses (DOE)" report={data.doe} />
          <ReportSection title="Revenue" report={data.revenue} />
          <ReportSection title="Non-Project Capex (NPC)" report={data.npc} />
        </>
      )}
    </div>
  );
}
