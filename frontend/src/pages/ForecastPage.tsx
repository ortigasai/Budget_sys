import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type Department } from "../api/client";
import { useAuth } from "../context/AuthContext";
import { StatusBadge } from "../components/StatusBadge";
import { PageHeader } from "../components/PageHeader";
import { SectionLabel } from "../components/TabBar";

interface HistoricalActualsRow {
  id: string;
  glAccount: string;
  costCenter: string;
  glDescription: string;
  actuals2025: number;
  approvedBudget2026: number;
  ytdActuals2026: number;
  monthlyRemainingForecast2026: Record<string, number>;
  remainingMonthsForecast: number;
  availableBudget2026: number;
  remainingBudget2026: number;
  forecastCompletedAt: string | null;
}

interface ForecastSubmission {
  stage: "DRAFT" | "HEAD_REVIEW" | "BUDGET_OFFICER_REVIEW" | "APPROVED" | "RETURNED";
  reviewDecisions: { decision: string; stage: string; comment: string | null; timestamp: string; decidedBy: { name: string } }[];
}

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function ForecastPage() {
  const { currentUser, hasRole } = useAuth();
  const isBudgetOfficer = hasRole("BUDGET_OFFICER");

  const { data: departments = [] } = useQuery({
    queryKey: ["departments"],
    queryFn: async () => (await api.get<Department[]>("/admin/departments")).data,
  });
  const centralizedDepts = departments.filter((d) => d.type === "CENTRALIZED");
  // Notes item 7(4): a centralized department cannot view another
  // centralized department's forecast — only the Budget Officer sees all.
  const viewableDepts = isBudgetOfficer
    ? centralizedDepts
    : centralizedDepts.filter((d) => d.id === currentUser?.department?.id);

  const [departmentId, setDepartmentId] = useState(() => viewableDepts[0]?.id ?? "");
  const effectiveDeptId = departmentId || viewableDepts[0]?.id || "";

  const queryClient = useQueryClient();
  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["forecast", effectiveDeptId] });
    queryClient.invalidateQueries({ queryKey: ["forecast-submission", effectiveDeptId] });
  };

  const { data, isError } = useQuery({
    queryKey: ["forecast", effectiveDeptId],
    queryFn: async () =>
      (await api.get<{ asOfMonth: number; rows: HistoricalActualsRow[] }>(`/forecast/${effectiveDeptId}`)).data,
    enabled: !!effectiveDeptId,
  });
  const { data: submission } = useQuery({
    queryKey: ["forecast-submission", effectiveDeptId],
    queryFn: async () => (await api.get<ForecastSubmission>(`/forecast/${effectiveDeptId}/submission`)).data,
    enabled: !!effectiveDeptId,
  });
  const rows = data?.rows ?? [];
  const asOfMonth = data?.asOfMonth ?? 9;
  const remainingMonths = Array.from({ length: 12 - asOfMonth }, (_, i) => asOfMonth + 1 + i);

  const updateMutation = useMutation({
    mutationFn: async ({ id, month, value }: { id: string; month: number; value: number }) =>
      (await api.patch(`/forecast/entries/${id}`, { month, value })).data,
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

  const stage = submission?.stage ?? "DRAFT";
  const isOwnDept = currentUser?.department?.id === effectiveDeptId;
  const canEditValues = (isOwnDept || isBudgetOfficer) && (stage === "DRAFT" || stage === "RETURNED");
  const allComplete = rows.length > 0 && rows.every((r) => r.forecastCompletedAt);
  const anyIncomplete = rows.some((r) => remainingMonths.some((m) => r.monthlyRemainingForecast2026[String(m)] === undefined));

  if (viewableDepts.length === 0) {
    return <div className="text-sm text-slate-500">You don't have a centralized department to view a forecast for.</div>;
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="2026 Remaining Months Forecast"
        subtitle={`Months through ${MONTH_NAMES[asOfMonth - 1]} are already in Actuals — only remaining months are editable.`}
        actions={<StatusBadge stage={stage} />}
      />
      <p className="rounded-lg border border-blue-100 bg-blue-50 px-4 py-2 text-sm text-blue-800">
        Completing this per CC-GL unblocks Centralized First-Level Review (Step 3A). Submission routes to the
        Centralized Department Head, then the Budget Officer, either of whom can return it.
      </p>

      {viewableDepts.length > 1 && (
        <select
          className="rounded border border-slate-300 px-2 py-1.5 text-sm"
          value={effectiveDeptId}
          onChange={(e) => setDepartmentId(e.target.value)}
        >
          {viewableDepts.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>
      )}
      {isError && <div className="text-sm text-red-700">You can only view your own department's forecast.</div>}

      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead className="bg-emerald-50 text-left text-xs uppercase tracking-wide text-emerald-800">
            <tr>
              <th className="whitespace-nowrap px-3 py-2">GL Description</th>
              <th className="whitespace-nowrap px-3 py-2">2025 Actuals</th>
              <th className="whitespace-nowrap px-3 py-2">2026 Approved Budget</th>
              <th className="whitespace-nowrap px-3 py-2">2026 YTD Actuals</th>
              <th className="whitespace-nowrap px-3 py-2">2026 Available Budget</th>
              {remainingMonths.map((m) => (
                <th key={m} className="whitespace-nowrap px-3 py-2">
                  {MONTH_NAMES[m - 1]} Forecast
                </th>
              ))}
              <th className="whitespace-nowrap px-3 py-2">2026 Remaining Budget</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.id} className={`border-t border-slate-100 ${i % 2 === 1 ? "bg-slate-50/60" : ""}`}>
                <td className="whitespace-nowrap px-3 py-2">{r.glDescription}</td>
                <td className="whitespace-nowrap px-3 py-2">{r.actuals2025.toLocaleString()}</td>
                <td className="whitespace-nowrap px-3 py-2">{r.approvedBudget2026.toLocaleString()}</td>
                <td className="whitespace-nowrap px-3 py-2">{r.ytdActuals2026.toLocaleString()}</td>
                <td className="whitespace-nowrap px-3 py-2">{r.availableBudget2026.toLocaleString()}</td>
                {remainingMonths.map((m) => (
                  <td key={m} className="whitespace-nowrap px-3 py-2">
                    {canEditValues ? (
                      <input
                        type="number"
                        className="w-24 rounded border border-slate-300 px-2 py-1"
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
                <td className="whitespace-nowrap px-3 py-2 font-semibold text-emerald-800">{r.remainingBudget2026.toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {canEditValues && (
        <button
          onClick={() => submitMutation.mutate()}
          disabled={rows.length === 0 || anyIncomplete || submitMutation.isPending}
          className="rounded-md bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-600 disabled:opacity-50"
        >
          Submit for Approval
        </button>
      )}
      {!canEditValues && stage !== "APPROVED" && (isOwnDept || isBudgetOfficer) && (
        <div className="text-sm text-slate-500">Waiting on review — editing is locked while a submission is pending.</div>
      )}
      {allComplete && stage === "APPROVED" && (
        <div className="inline-block rounded-full bg-emerald-100 px-3 py-1 text-sm font-medium text-emerald-800">
          Forecast Approved ✓
        </div>
      )}
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
