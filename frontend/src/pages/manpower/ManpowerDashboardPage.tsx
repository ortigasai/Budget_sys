import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../api/client";
import { useAuth } from "../../context/AuthContext";
import { StatusBadge } from "../../components/StatusBadge";

const FISCAL_YEAR = 2027;

interface Company {
  id: string;
  code: string;
  name: string;
}
interface GridCell {
  companyId: string;
  companyCode: string;
  ytdActual: number;
  remainingForecast: number;
  totalActualForecast: number;
  meritAmount: number;
  otherIncrease: number;
  additionalHeadcountCount: number;
  additionalHeadcountAmount: number;
  budget: number;
  budgetVsPriorAmount: number;
  budgetVsPriorPercent: number;
}
interface GridRow {
  payComponent: { id: string; name: string; isHeadcountDriven: boolean; appliesMeritIncrease: boolean; forecastSource: string };
  cells: GridCell[];
  totalBudget: number;
}
interface HeadcountRowEntry {
  companyId: string;
  companyCode: string;
  baseHeadcount: number;
  additionalHeadcountCount: number;
  effectiveHeadcount: number;
}
interface GridResponse {
  companies: Company[];
  rows: GridRow[];
  headcountRow: HeadcountRowEntry[];
  asOfMonth: number;
  meritRate: number;
}
interface Submission {
  fiscalYear: number;
  stage: "HR_ANALYST_DRAFT" | "HR_HEAD_REVIEW" | "BUDGET_OFFICER_REVIEW" | "UPLOADED_TO_SAP";
  sapDocumentNumber: string | null;
}
interface MeritRateConfig {
  fiscalYear: number;
  ratePercent: number;
}
interface SalaryLevel {
  level: number;
  avgSalary: number;
  sssER: number;
  pagibigER: number;
  philhealthER: number;
}
interface HeadcountByRankCell {
  level: number;
  companyId: string;
  companyCode: string;
  headcount: number;
}
interface HeadcountByRankResponse {
  companies: Company[];
  cells: HeadcountByRankCell[];
}
interface DashboardSummaryRow {
  payComponentId: string;
  payComponentName: string;
  ytdActual: number;
  remainingForecast: number;
  totalActualForecast: number;
  meritAmount: number;
  additionalHeadcountAmount: number;
  budget: number;
  budgetVsPriorAmount: number;
  budgetVsPriorPercent: number;
}
interface DashboardSummaryResponse {
  companyId: string | null;
  rows: DashboardSummaryRow[];
  total: DashboardSummaryRow;
}

// Notes_5: the 5 roster-driven "Salary" category components shown in the
// simplified Dashboard Report summary; everything else is "Other Pay
// Components".
const SALARY_COMPONENT_NAMES = [
  "Basic Pay",
  "Guaranteed Bonus",
  "Government Contributions (ER) - SSS",
  "Government Contributions (ER) - Pag-Ibig",
  "Government Contributions (ER) - Philhealth",
];

// Notes_5's "Headcount per Company" sheet only covers these 3 companies -
// used solely by the rank-based manual-entry panel below, which has no
// rank/salary data for OCLP_PROJECT/OLC_PROJECT/OUTSOURCED. Per user
// request, these 3 are NOT merged into OCC/OCLP/OLC anywhere else on this
// page - every company keeps its own column/total.
const RANK_ENTRY_COMPANY_CODES = ["OCC", "OCLP", "OLC"];

function peso(n: number) {
  return `₱${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}
function pct(n: number) {
  return `${(n * 100).toFixed(1)}%`;
}

export function ManpowerDashboardPage() {
  const { hasRole, currentUser } = useAuth();
  const isHrAnalyst = hasRole("HR_ANALYST");
  const isHrHead = currentUser?.department?.name === "Human Resources" && hasRole("CENTRALIZED_DEPARTMENT_HEAD");
  const isBudgetOfficer = hasRole("BUDGET_OFFICER");

  const queryClient = useQueryClient();
  const { data: grid, isLoading } = useQuery({
    queryKey: ["manpower-grid"],
    queryFn: async () => (await api.get<GridResponse>(`/manpower/grid?fiscalYear=${FISCAL_YEAR}`)).data,
  });
  const { data: submission } = useQuery({
    queryKey: ["manpower-submission"],
    queryFn: async () => (await api.get<Submission>(`/manpower/submission?fiscalYear=${FISCAL_YEAR}`)).data,
  });
  const { data: meritRateConfig } = useQuery({
    queryKey: ["manpower-merit-rate"],
    queryFn: async () => (await api.get<MeritRateConfig>(`/manpower/merit-rate?fiscalYear=${FISCAL_YEAR}`)).data,
  });
  const { data: salaryLevels } = useQuery({
    queryKey: ["manpower-salary-levels"],
    queryFn: async () => (await api.get<SalaryLevel[]>(`/manpower/salary-levels`)).data,
  });
  const { data: headcountByRank } = useQuery({
    queryKey: ["manpower-headcount-by-rank"],
    queryFn: async () => (await api.get<HeadcountByRankResponse>(`/manpower/headcount-by-rank?fiscalYear=${FISCAL_YEAR}`)).data,
  });

  // Per user request: OCLP_PROJECT/OLC_PROJECT/OUTSOURCED are no longer
  // merged into OCC/OCLP/OLC anywhere - the Dashboard Report filter lists
  // every company separately again.
  const [summaryCompanyId, setSummaryCompanyId] = useState<string>("ALL");
  const { data: dashboardSummary } = useQuery({
    queryKey: ["manpower-dashboard-summary", summaryCompanyId],
    queryFn: async () =>
      (
        await api.get<DashboardSummaryResponse>(
          `/manpower/dashboard-summary?fiscalYear=${FISCAL_YEAR}${summaryCompanyId !== "ALL" ? `&companyId=${summaryCompanyId}` : ""}`
        )
      ).data,
  });

  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: ["manpower-grid"] });
    queryClient.invalidateQueries({ queryKey: ["manpower-submission"] });
    queryClient.invalidateQueries({ queryKey: ["manpower-merit-rate"] });
    queryClient.invalidateQueries({ queryKey: ["manpower-salary-levels"] });
    queryClient.invalidateQueries({ queryKey: ["manpower-headcount-by-rank"] });
    queryClient.invalidateQueries({ queryKey: ["manpower-dashboard-summary"] });
  };

  const runMutation = useMutation({
    mutationFn: async () => (await api.post("/manpower/run", { fiscalYear: FISCAL_YEAR })).data,
    onSuccess: invalidateAll,
  });
  const submitMutation = useMutation({
    mutationFn: async () => (await api.post("/manpower/submit", { fiscalYear: FISCAL_YEAR })).data,
    onSuccess: invalidateAll,
  });
  const hrHeadDecisionMutation = useMutation({
    mutationFn: async (decision: "APPROVE" | "RETURN") =>
      (await api.post("/manpower/hr-head-decision", { fiscalYear: FISCAL_YEAR, decision })).data,
    onSuccess: invalidateAll,
  });
  const budgetOfficerDecisionMutation = useMutation({
    mutationFn: async (decision: "RETURN" | "UPLOAD_TO_SAP") =>
      (await api.post("/manpower/budget-officer-decision", { fiscalYear: FISCAL_YEAR, decision })).data,
    onSuccess: invalidateAll,
  });
  const meritRateMutation = useMutation({
    mutationFn: async (ratePercent: number) => (await api.put("/manpower/merit-rate", { fiscalYear: FISCAL_YEAR, ratePercent })).data,
    onSuccess: invalidateAll,
  });
  const salaryLevelMutation = useMutation({
    mutationFn: async (body: SalaryLevel) => (await api.put("/manpower/salary-levels", body)).data,
    onSuccess: invalidateAll,
  });
  const headcountByRankMutation = useMutation({
    mutationFn: async (body: { level: number; companyId: string; headcount: number }) =>
      (await api.put("/manpower/headcount-by-rank", { ...body, fiscalYear: FISCAL_YEAR })).data,
    onSuccess: invalidateAll,
  });

  // "Fill Average Salary" / "Fill Headcount per Company" now live as sidebar
  // links (Layout.tsx) that deep-link here via ?panel=salary|headcount, so
  // this reads from the URL instead of local-only state - mutually
  // exclusive per user request, opening one closes the other.
  const [searchParams] = useSearchParams();
  const panelParam = searchParams.get("panel");
  const openPanel = panelParam === "salary" || panelParam === "headcount" ? panelParam : null;
  const showSalaryPanel = openPanel === "salary";
  const showHeadcountPanel = openPanel === "headcount";

  if (isLoading || !grid) return <div className="text-sm text-slate-400">Loading…</div>;

  const stage = submission?.stage ?? "HR_ANALYST_DRAFT";

  // Notes: Additional Headcount Request is a single total across all
  // companies (not broken out per company) - Current Headcount + Additional
  // Headcount Request = Total Headcount.
  const totalCurrentHeadcount = grid.headcountRow.reduce((s, h) => s + h.baseHeadcount, 0);
  const totalAdditionalHeadcount = grid.headcountRow.reduce((s, h) => s + h.additionalHeadcountCount, 0);
  const totalHeadcount = totalCurrentHeadcount + totalAdditionalHeadcount;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between rounded-xl bg-gradient-to-r from-emerald-800 to-emerald-700 px-5 py-4 text-white shadow-sm">
        <div>
          <h1 className="text-xl font-bold tracking-tight">Manpower Budgeting</h1>
          <div className="mt-1.5 flex items-center gap-2 text-sm text-emerald-50">
            <StatusBadge stage={stage} />
            {submission?.sapDocumentNumber && <span className="text-emerald-100">SAP #{submission.sapDocumentNumber}</span>}
          </div>
        </div>
        <a
          href={`/api/manpower/export?fiscalYear=${FISCAL_YEAR}`}
          className="rounded-lg bg-white/15 px-3 py-1.5 text-xs font-semibold text-white ring-1 ring-white/30 hover:bg-white/25"
        >
          Export to Excel
        </a>
      </div>

      {isHrAnalyst && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
          <button
            onClick={() => runMutation.mutate()}
            disabled={runMutation.isPending}
            className="rounded-md bg-emerald-700 px-3 py-1.5 text-sm font-semibold text-white hover:bg-emerald-600 disabled:opacity-50"
          >
            Run Manpower Budget
          </button>
          <div className="ml-2 flex items-center gap-2 rounded-md bg-amber-50 px-3 py-1.5 ring-1 ring-amber-200">
            <label className="text-xs font-semibold text-amber-800">Merit Increase Rate</label>
            <input
              type="number"
              className="w-16 rounded border border-amber-300 bg-white px-2 py-0.5 text-sm"
              defaultValue={meritRateConfig?.ratePercent ?? 0}
              key={meritRateConfig?.ratePercent}
              onBlur={(e) => meritRateMutation.mutate(Number(e.target.value) || 0)}
            />
            <span className="text-xs font-semibold text-amber-800">%</span>
          </div>
          {stage === "HR_ANALYST_DRAFT" && (
            <button
              onClick={() => submitMutation.mutate()}
              className="ml-auto rounded-md bg-slate-800 px-3 py-1.5 text-sm font-semibold text-white hover:bg-slate-700"
            >
              Submit for HR Head Approval
            </button>
          )}
        </div>
      )}

      {isHrAnalyst && showSalaryPanel && (
        <div className="overflow-x-auto rounded-lg border border-emerald-200 bg-white shadow-sm">
          <div className="bg-emerald-50 px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-emerald-900">
            Average Salary & Gov't Contributions per Rank
          </div>
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
              <tr>
                <th className="px-3 py-2">Rank</th>
                <th className="px-3 py-2">Average Salary</th>
                <th className="px-3 py-2">SSS (ER)</th>
                <th className="px-3 py-2">Pag-Ibig (ER)</th>
                <th className="px-3 py-2">Philhealth (ER)</th>
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: 12 }, (_, i) => i + 1).map((level) => {
                const existing = salaryLevels?.find((l) => l.level === level);
                return (
                  <SalaryLevelRow
                    key={level}
                    level={level}
                    existing={existing}
                    onSave={(fields) => salaryLevelMutation.mutate({ level, ...fields })}
                  />
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {isHrAnalyst && showHeadcountPanel && headcountByRank && (
        <div className="overflow-x-auto rounded-lg border border-emerald-200 bg-white shadow-sm">
          <div className="bg-emerald-50 px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-emerald-900">
            Current Headcount per Rank per Company
          </div>
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
              <tr>
                <th className="px-3 py-2">Rank</th>
                {headcountByRank.companies.map((c) => (
                  <th key={c.id} className="px-3 py-2">
                    {c.code}
                  </th>
                ))}
                <th className="px-3 py-2">Total</th>
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: 12 }, (_, i) => i + 1).map((level) => {
                const rowTotal = headcountByRank.companies.reduce(
                  (s, c) => s + (headcountByRank.cells.find((x) => x.level === level && x.companyId === c.id)?.headcount ?? 0),
                  0
                );
                return (
                  <tr key={level} className="border-t border-slate-100">
                    <td className="px-3 py-2 font-medium">{level}</td>
                    {headcountByRank.companies.map((c) => {
                      const cell = headcountByRank.cells.find((x) => x.level === level && x.companyId === c.id);
                      return (
                        <td key={c.id} className="px-3 py-2">
                          <input
                            type="number"
                            className="w-20 rounded border border-slate-300 px-1.5 py-0.5"
                            defaultValue={cell?.headcount ?? 0}
                            key={cell?.headcount}
                            onBlur={(e) =>
                              headcountByRankMutation.mutate({ level, companyId: c.id, headcount: Number(e.target.value) || 0 })
                            }
                          />
                        </td>
                      );
                    })}
                    <td className="px-3 py-2 font-medium text-slate-700">{rowTotal}</td>
                  </tr>
                );
              })}
              <tr className="border-t border-slate-200 bg-emerald-50/60 font-semibold text-emerald-900">
                <td className="px-3 py-2">Total</td>
                {headcountByRank.companies.map((c) => {
                  const companyTotal = headcountByRank.cells
                    .filter((x) => x.companyId === c.id)
                    .reduce((s, x) => s + x.headcount, 0);
                  return (
                    <td key={c.id} className="px-3 py-2">
                      {companyTotal}
                    </td>
                  );
                })}
                <td className="px-3 py-2">{headcountByRank.cells.reduce((s, x) => s + x.headcount, 0)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      )}

      {isHrHead && stage === "HR_HEAD_REVIEW" && (
        <div className="flex gap-2">
          <button
            onClick={() => hrHeadDecisionMutation.mutate("APPROVE")}
            className="rounded-md bg-emerald-700 px-3 py-1.5 text-sm font-semibold text-white hover:bg-emerald-600"
          >
            Approve
          </button>
          <button
            onClick={() => hrHeadDecisionMutation.mutate("RETURN")}
            className="rounded-md bg-red-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-red-500"
          >
            Return to HR Analyst
          </button>
        </div>
      )}

      {isBudgetOfficer && stage === "BUDGET_OFFICER_REVIEW" && (
        <div className="flex gap-2">
          <button
            onClick={() => budgetOfficerDecisionMutation.mutate("UPLOAD_TO_SAP")}
            className="rounded-md bg-emerald-700 px-3 py-1.5 text-sm font-semibold text-white hover:bg-emerald-600"
          >
            Upload to SAP
          </button>
          <button
            onClick={() => budgetOfficerDecisionMutation.mutate("RETURN")}
            className="rounded-md bg-red-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-red-500"
          >
            Return to HR Analyst
          </button>
        </div>
      )}

      {/* Per user request: the Headcount and Dashboard Report sections only
          show on the plain "Dashboard" view - they're hidden while a "Fill
          ..." panel is open, since that panel is its own dedicated section. */}
      {!openPanel && (
        <>
          <HeadcountByCompanyTable
            headcountRow={grid.headcountRow}
            totalCurrentHeadcount={totalCurrentHeadcount}
            totalAdditionalHeadcount={totalAdditionalHeadcount}
            totalHeadcount={totalHeadcount}
          />

          {/* Notes_5: simplified Dashboard Report summary (Salary category
              only), with a company filter dropdown. */}
          <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white shadow-sm">
            <table className="w-full text-sm">
              {/* A <caption> (rather than a sibling <div>) always renders at
                  the table's actual rendered width, so the green header
                  still reaches the end of the table even when it's wide
                  enough to scroll horizontally. */}
              <caption className="caption-top bg-emerald-50 p-0 text-left">
                <div className="flex items-center gap-3 px-3 py-1.5">
                  <span className="text-xs font-semibold uppercase tracking-wide text-emerald-900">Dashboard Report</span>
                  <select
                    className="rounded border border-emerald-300 bg-white px-2 py-1 text-xs"
                    value={summaryCompanyId}
                    onChange={(e) => setSummaryCompanyId(e.target.value)}
                  >
                    <option value="ALL">All Companies</option>
                    {grid.companies.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.code}
                      </option>
                    ))}
                  </select>
                </div>
              </caption>
              {dashboardSummary && (
                <>
                <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                  <tr>
                    <th className="whitespace-nowrap px-3 py-2">Account</th>
                    <th className="whitespace-nowrap px-3 py-2">YTD Actual</th>
                    <th className="whitespace-nowrap px-3 py-2">Remaining Forecast</th>
                    <th className="whitespace-nowrap px-3 py-2">Actual + Forecast</th>
                    <th className="whitespace-nowrap px-3 py-2">Merit Increase</th>
                    <th className="whitespace-nowrap px-3 py-2">Additional Headcount</th>
                    <th className="whitespace-nowrap px-3 py-2">Budget</th>
                    <th className="whitespace-nowrap px-3 py-2">Inc/Dec (Amount)</th>
                    <th className="whitespace-nowrap px-3 py-2">Inc/Dec (%)</th>
                  </tr>
                </thead>
                <tbody>
                  {dashboardSummary.rows.map((row, i) => (
                    <tr key={row.payComponentId} className={`border-t border-slate-100 ${i % 2 === 1 ? "bg-slate-50/60" : ""}`}>
                      <td className="whitespace-nowrap px-3 py-2">{row.payComponentName}</td>
                      <td className="whitespace-nowrap px-3 py-2">{peso(row.ytdActual)}</td>
                      <td className="whitespace-nowrap px-3 py-2">{peso(row.remainingForecast)}</td>
                      <td className="whitespace-nowrap px-3 py-2">{peso(row.totalActualForecast)}</td>
                      <td className="whitespace-nowrap px-3 py-2">{peso(row.meritAmount)}</td>
                      <td className="whitespace-nowrap px-3 py-2">{peso(row.additionalHeadcountAmount)}</td>
                      <td className="whitespace-nowrap px-3 py-2 font-medium">{peso(row.budget)}</td>
                      <td className="whitespace-nowrap px-3 py-2">{peso(row.budgetVsPriorAmount)}</td>
                      <td className="whitespace-nowrap px-3 py-2">{pct(row.budgetVsPriorPercent)}</td>
                    </tr>
                  ))}
                  <tr className="border-t border-slate-200 bg-emerald-50/60 font-semibold text-emerald-900">
                    <td className="whitespace-nowrap px-3 py-2">Total</td>
                    <td className="whitespace-nowrap px-3 py-2">{peso(dashboardSummary.total.ytdActual)}</td>
                    <td className="whitespace-nowrap px-3 py-2">{peso(dashboardSummary.total.remainingForecast)}</td>
                    <td className="whitespace-nowrap px-3 py-2">{peso(dashboardSummary.total.totalActualForecast)}</td>
                    <td className="whitespace-nowrap px-3 py-2">{peso(dashboardSummary.total.meritAmount)}</td>
                    <td className="whitespace-nowrap px-3 py-2">{peso(dashboardSummary.total.additionalHeadcountAmount)}</td>
                    <td className="whitespace-nowrap px-3 py-2">{peso(dashboardSummary.total.budget)}</td>
                    <td className="whitespace-nowrap px-3 py-2">{peso(dashboardSummary.total.budgetVsPriorAmount)}</td>
                    <td className="whitespace-nowrap px-3 py-2">{pct(dashboardSummary.total.budgetVsPriorPercent)}</td>
                  </tr>
                </tbody>
                </>
              )}
            </table>
          </div>
        </>
      )}

      {/* Notes_5 (temporary): "Other Pay Components" table removed for now
          per user request - they're redesigning how these 14 non-Salary
          components should be presented. The underlying data/entry
          mechanism (grid.rows, /manpower/entries) is untouched, so it can
          be re-surfaced later without any backend changes. */}
    </div>
  );
}

// Current + Additional Headcount by Company. Every company gets its own
// column - per user request, OCLP_PROJECT/OLC_PROJECT/OUTSOURCED are not
// merged into OCC/OCLP/OLC here.
function HeadcountByCompanyTable({
  headcountRow,
  totalCurrentHeadcount,
  totalAdditionalHeadcount,
  totalHeadcount,
}: {
  headcountRow: HeadcountRowEntry[];
  totalCurrentHeadcount: number;
  totalAdditionalHeadcount: number;
  totalHeadcount: number;
}) {
  // CSS grid (not <table>) so every data column is exactly the same width
  // regardless of content - table-layout:fixed still lets browsers widen a
  // column to fit an unbreakable string like "OCLP_PROJECT", which a grid
  // with a fixed track size doesn't.
  // minmax(7rem, 1fr) keeps every data column exactly equal to the others
  // while letting them all grow together to fill the card's full width
  // (fixed 7rem tracks left a gap on the right instead of stretching).
  const gridTemplateColumns = `12rem repeat(${headcountRow.length + 1}, minmax(7rem, 1fr))`;
  const cellClass = "min-w-0 overflow-hidden text-ellipsis whitespace-nowrap px-3 py-2";

  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white shadow-sm">
      <div className="bg-emerald-50 px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-emerald-900">
        Headcount
      </div>
      <div className="w-full text-sm" style={{ display: "grid", gridTemplateColumns }}>
        <div className={`${cellClass} bg-slate-50 text-xs font-medium uppercase text-slate-500`}>&nbsp;</div>
        {headcountRow.map((h) => (
          <div key={h.companyId} className={`${cellClass} bg-slate-50 text-xs font-medium uppercase text-slate-500`} title={h.companyCode}>
            {h.companyCode}
          </div>
        ))}
        <div className={`${cellClass} bg-slate-50 text-xs font-medium uppercase text-slate-500`}>Total</div>

        <div className={`${cellClass} border-t border-slate-100 font-medium`}>Current Headcount</div>
        {headcountRow.map((h) => (
          <div key={h.companyId} className={`${cellClass} border-t border-slate-100`}>
            {h.baseHeadcount}
          </div>
        ))}
        <div className={`${cellClass} border-t border-slate-100 font-medium`}>{totalCurrentHeadcount}</div>

        <div className={`${cellClass} border-t border-slate-100 bg-amber-50/50 font-medium`}>Additional Headcount</div>
        {headcountRow.map((h) => (
          <div key={h.companyId} className={`${cellClass} border-t border-slate-100 bg-amber-50/50`}>
            +{h.additionalHeadcountCount}
          </div>
        ))}
        <div className={`${cellClass} border-t border-slate-100 bg-amber-50/50 font-medium`}>+{totalAdditionalHeadcount}</div>

        <div className={`${cellClass} border-t border-slate-200 bg-emerald-50/60 font-semibold text-emerald-900`}>Total Headcount</div>
        {headcountRow.map((h) => (
          <div key={h.companyId} className={`${cellClass} border-t border-slate-200 bg-emerald-50/60 font-semibold text-emerald-900`}>
            {h.effectiveHeadcount}
          </div>
        ))}
        <div className={`${cellClass} border-t border-slate-200 bg-emerald-50/60 font-semibold text-emerald-900`}>{totalHeadcount}</div>
      </div>
    </div>
  );
}

function SalaryLevelRow({
  level,
  existing,
  onSave,
}: {
  level: number;
  existing: SalaryLevel | undefined;
  onSave: (fields: { avgSalary: number; sssER: number; pagibigER: number; philhealthER: number }) => void;
}) {
  const [fields, setFields] = useState({
    avgSalary: existing?.avgSalary ?? 0,
    sssER: existing?.sssER ?? 0,
    pagibigER: existing?.pagibigER ?? 0,
    philhealthER: existing?.philhealthER ?? 0,
  });

  const field = (key: keyof typeof fields, label: string) => (
    <td className="px-3 py-2">
      <input
        type="number"
        aria-label={label}
        className="w-28 rounded border border-slate-300 px-1.5 py-0.5"
        value={fields[key]}
        onChange={(e) => setFields({ ...fields, [key]: Number(e.target.value) || 0 })}
        onBlur={() => onSave(fields)}
      />
    </td>
  );

  return (
    <tr className="border-t border-slate-100">
      <td className="px-3 py-2 font-medium">{level}</td>
      {field("avgSalary", "Average Salary")}
      {field("sssER", "SSS ER")}
      {field("pagibigER", "Pag-Ibig ER")}
      {field("philhealthER", "Philhealth ER")}
    </tr>
  );
}

