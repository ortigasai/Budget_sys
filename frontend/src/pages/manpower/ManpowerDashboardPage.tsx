import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../api/client";
import { useAuth } from "../../context/AuthContext";
import { StatusBadge } from "../../components/StatusBadge";

const FISCAL_YEAR = 2027;
const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

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

  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: ["manpower-grid"] });
    queryClient.invalidateQueries({ queryKey: ["manpower-submission"] });
    queryClient.invalidateQueries({ queryKey: ["manpower-merit-rate"] });
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

  const [selected, setSelected] = useState<{ payComponentId: string; companyId: string } | null>(null);
  const [uploadErrors, setUploadErrors] = useState<{ sheet: string; row: number; error: string }[] | null>(null);
  const [uploadSuccess, setUploadSuccess] = useState<{ levelsUpdated: number; companiesUpdated: number; employeesProcessed: number } | null>(null);

  const uploadMutation = useMutation({
    mutationFn: async (file: File) => {
      const form = new FormData();
      form.append("file", file);
      form.append("fiscalYear", String(FISCAL_YEAR));
      try {
        return (await api.post("/manpower/template-upload", form)).data;
      } catch (err: any) {
        if (err.response?.status === 400 && err.response.data?.errors) return err.response.data;
        throw err;
      }
    },
    onSuccess: (data) => {
      if (data.ok === false) {
        setUploadSuccess(null);
        setUploadErrors(data.errors);
      } else {
        setUploadErrors(null);
        setUploadSuccess(data);
        invalidateAll();
      }
    },
  });

  const entryMutation = useMutation({
    mutationFn: async (body: Record<string, unknown>) => (await api.patch("/manpower/entries", body)).data,
    onSuccess: invalidateAll,
  });

  if (isLoading || !grid) return <div className="text-sm text-slate-400">Loading…</div>;

  const selectedRow = grid.rows.find((r) => r.payComponent.id === selected?.payComponentId);
  const selectedCell = selectedRow?.cells.find((c) => c.companyId === selected?.companyId);
  const remainingMonths = Array.from({ length: 12 - grid.asOfMonth }, (_, i) => grid.asOfMonth + 1 + i);

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
          <a
            href="/api/manpower/template"
            className="rounded-md border border-emerald-300 bg-emerald-50 px-3 py-1.5 text-sm font-medium text-emerald-800 hover:bg-emerald-100"
          >
            Download Manpower Template
          </a>
          <label className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-100">
            Upload Manpower Template
            <input
              type="file"
              accept=".xlsx"
              className="hidden"
              onChange={(e) => e.target.files?.[0] && uploadMutation.mutate(e.target.files[0])}
            />
          </label>
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
      {uploadErrors && (
        <div className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          <div className="mb-1 font-medium">Upload rejected — fix these rows and re-upload:</div>
          <ul className="list-inside list-disc">
            {uploadErrors.map((e, i) => (
              <li key={i}>
                {e.sheet} row {e.row}: {e.error}
              </li>
            ))}
          </ul>
        </div>
      )}
      {uploadSuccess && (
        <div className="rounded border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">
          Uploaded: {uploadSuccess.employeesProcessed} employee(s) across {uploadSuccess.companiesUpdated} compan
          {uploadSuccess.companiesUpdated === 1 ? "y" : "ies"}, {uploadSuccess.levelsUpdated} salary level(s) updated.
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

      {/* Moved to the top per user feedback: the selected-cell detail/edit
          panel used to sit below all the metric tables. */}
      {selectedRow && selectedCell ? (
        <div className="rounded-lg border border-emerald-200 bg-white p-4 text-sm shadow-sm">
          <div className="mb-3 flex items-center gap-2">
            <span className="rounded bg-emerald-700 px-2 py-0.5 text-xs font-bold text-white">{selectedCell.companyCode}</span>
            <span className="font-semibold text-slate-800">{selectedRow.payComponent.name}</span>
          </div>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Stat label="YTD Actual (SAP)" value={peso(selectedCell.ytdActual)} />
            <Stat label="Remaining Months Forecast" value={peso(selectedCell.remainingForecast)} />
            <Stat label="Total Actual + Forecast" value={peso(selectedCell.totalActualForecast)} />
            <Stat
              label="Additional Headcount Add-on"
              value={`${peso(selectedCell.additionalHeadcountAmount)} (+${selectedCell.additionalHeadcountCount})`}
            />
          </div>

          {isHrAnalyst && (
            <div className="mt-4 space-y-3 border-t border-slate-100 pt-3">
              {selectedRow.payComponent.forecastSource === "MANUAL" && (
                <div>
                  <div className="mb-1 text-xs font-medium text-slate-500">Remaining Months Forecast by month</div>
                  <div className="flex flex-wrap gap-2">
                    {remainingMonths.map((m) => (
                      <div key={m}>
                        <label className="block text-xs text-slate-400">{MONTH_NAMES[m - 1]}</label>
                        <input
                          type="number"
                          className="w-20 rounded border border-slate-300 px-1 py-0.5"
                          defaultValue={0}
                          onBlur={(e) =>
                            entryMutation.mutate({
                              payComponentId: selectedRow.payComponent.id,
                              companyId: selectedCell.companyId,
                              fiscalYear: FISCAL_YEAR,
                              month: m,
                              remainingForecastValue: Number(e.target.value) || 0,
                            })
                          }
                        />
                      </div>
                    ))}
                  </div>
                </div>
              )}
              <div className="flex flex-wrap items-end gap-4">
                <div>
                  <label className="block text-xs text-slate-500">Other Increase (₱)</label>
                  <input
                    type="number"
                    className="w-32 rounded border border-slate-300 px-2 py-1"
                    defaultValue={selectedCell.otherIncrease}
                    onBlur={(e) =>
                      entryMutation.mutate({
                        payComponentId: selectedRow.payComponent.id,
                        companyId: selectedCell.companyId,
                        fiscalYear: FISCAL_YEAR,
                        otherIncrease: Number(e.target.value) || 0,
                      })
                    }
                  />
                </div>
                {!selectedRow.payComponent.isHeadcountDriven && (
                  <div>
                    <label className="block text-xs text-slate-500">Additional Headcount Request (₱, manual)</label>
                    <input
                      type="number"
                      className="w-32 rounded border border-slate-300 px-2 py-1"
                      defaultValue={0}
                      onBlur={(e) =>
                        entryMutation.mutate({
                          payComponentId: selectedRow.payComponent.id,
                          companyId: selectedCell.companyId,
                          fiscalYear: FISCAL_YEAR,
                          additionalHeadcountManual: Number(e.target.value) || 0,
                        })
                      }
                    />
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="rounded-lg border border-dashed border-slate-300 bg-white/60 p-4 text-center text-sm text-slate-400">
          Click any figure in the tables below to view its detail and edit it here.
        </div>
      )}

      {/* Notes_4: column sections mirroring the source workbook's Dashboard
          Report - Current Headcount, YTD Actual, Remaining Months Forecast,
          Merit Increase, Other Increase, Additional Headcount Request,
          Budget, and Budget vs Prior Year Actual+Forecast. Clicking any cell
          opens the shared edit panel above. */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <HeadcountStat label="Current Headcount" value={totalCurrentHeadcount} accent="slate" />
        <HeadcountStat label="Additional Headcount Request" value={totalAdditionalHeadcount} accent="amber" prefix="+" />
        <HeadcountStat label="Total Headcount" value={totalHeadcount} accent="emerald" />
      </div>

      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white shadow-sm">
        <div className="bg-emerald-50 px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-emerald-900">
          Current Headcount by Company
        </div>
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
            <tr>
              <th className="whitespace-nowrap px-3 py-2">&nbsp;</th>
              {grid.companies.map((c) => (
                <th key={c.id} className="whitespace-nowrap px-3 py-2">
                  {c.code}
                </th>
              ))}
              <th className="whitespace-nowrap px-3 py-2">Total</th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-t border-slate-100">
              <td className="whitespace-nowrap px-3 py-2 font-medium">Headcount</td>
              {grid.headcountRow.map((h) => (
                <td key={h.companyId} className="whitespace-nowrap px-3 py-2">
                  {h.baseHeadcount}
                </td>
              ))}
              <td className="whitespace-nowrap px-3 py-2 font-medium">{totalCurrentHeadcount}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <MetricTable title="YTD Actual" grid={grid} selected={selected} onSelect={setSelected} valueOf={(c) => c.ytdActual} format={peso} />
      <MetricTable
        title="Remaining Months Forecast"
        grid={grid}
        selected={selected}
        onSelect={setSelected}
        valueOf={(c) => c.remainingForecast}
        format={peso}
      />
      <MetricTable title="Merit Increase" grid={grid} selected={selected} onSelect={setSelected} valueOf={(c) => c.meritAmount} format={peso} />
      <MetricTable title="Other Increase" grid={grid} selected={selected} onSelect={setSelected} valueOf={(c) => c.otherIncrease} format={peso} />
      <MetricTable
        title="Additional Headcount Request"
        grid={grid}
        selected={selected}
        onSelect={setSelected}
        valueOf={(c) => c.additionalHeadcountAmount}
        format={peso}
      />
      <MetricTable
        title="Budget"
        grid={grid}
        selected={selected}
        onSelect={setSelected}
        valueOf={(c) => c.budget}
        format={peso}
        totalOf={(row) => row.totalBudget}
      />
      <MetricTable
        title="Budget vs Prior Year Actual + Forecast"
        grid={grid}
        selected={selected}
        onSelect={setSelected}
        valueOf={(c) => c.budgetVsPriorAmount}
        format={(n, c) => `${peso(n)} (${pct(c?.budgetVsPriorPercent ?? 0)})`}
      />
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs uppercase text-slate-500">{label}</div>
      <div className="font-medium">{value}</div>
    </div>
  );
}

function HeadcountStat({
  label,
  value,
  accent,
  prefix,
}: {
  label: string;
  value: number;
  accent: "slate" | "amber" | "emerald";
  prefix?: string;
}) {
  const styles = {
    slate: "border-slate-200 bg-white text-slate-800",
    amber: "border-amber-200 bg-amber-50 text-amber-800",
    emerald: "border-emerald-200 bg-emerald-50 text-emerald-900",
  }[accent];
  return (
    <div className={`rounded-lg border p-4 shadow-sm ${styles}`}>
      <div className="text-xs font-semibold uppercase tracking-wide opacity-70">{label}</div>
      <div className="mt-1 text-2xl font-bold">
        {prefix}
        {value.toLocaleString()}
      </div>
    </div>
  );
}

function MetricTable({
  title,
  grid,
  selected,
  onSelect,
  valueOf,
  format,
  totalOf,
}: {
  title: string;
  grid: GridResponse;
  selected: { payComponentId: string; companyId: string } | null;
  onSelect: (sel: { payComponentId: string; companyId: string }) => void;
  valueOf: (cell: GridCell) => number;
  format: (n: number, cell?: GridCell) => string;
  totalOf?: (row: GridRow) => number;
}) {
  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white shadow-sm">
      <div className="bg-emerald-50 px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-emerald-900">{title}</div>
      <table className="w-full text-sm">
        <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
          <tr>
            <th className="whitespace-nowrap px-3 py-2">Pay Component</th>
            {grid.companies.map((c) => (
              <th key={c.id} className="whitespace-nowrap px-3 py-2">
                {c.code}
              </th>
            ))}
            <th className="whitespace-nowrap px-3 py-2">Total</th>
          </tr>
        </thead>
        <tbody>
          {grid.rows.map((row, i) => (
            <tr key={row.payComponent.id} className={`border-t border-slate-100 ${i % 2 === 1 ? "bg-slate-50/60" : ""}`}>
              <td className="whitespace-nowrap px-3 py-2">{row.payComponent.name}</td>
              {row.cells.map((cell) => (
                <td key={cell.companyId} className="whitespace-nowrap px-3 py-2">
                  <button
                    onClick={() => onSelect({ payComponentId: row.payComponent.id, companyId: cell.companyId })}
                    className={`rounded px-1.5 py-0.5 hover:bg-emerald-100 ${
                      selected?.payComponentId === row.payComponent.id && selected?.companyId === cell.companyId
                        ? "bg-emerald-200 font-semibold text-emerald-900"
                        : ""
                    }`}
                  >
                    {format(valueOf(cell), cell)}
                  </button>
                </td>
              ))}
              <td className="whitespace-nowrap px-3 py-2 font-semibold text-slate-700">
                {format(totalOf ? totalOf(row) : row.cells.reduce((s, c) => s + valueOf(c), 0))}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
