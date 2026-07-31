import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type AdditionalHeadcountRequest, type BudgetRequest } from "../api/client";
import { StatusBadge } from "../components/StatusBadge";
import { PageHeader } from "../components/PageHeader";

const HEADCOUNT_DECISION_ENDPOINT: Record<string, string> = {
  DEPT_HEAD_REVIEW: "dept-head",
  HR_ANALYST_REVIEW: "hr-analyst",
  HR_HEAD_REVIEW: "hr-head",
};

function HeadcountInboxSection() {
  const queryClient = useQueryClient();
  const { data: requests = [] } = useQuery({
    queryKey: ["additional-headcount-inbox"],
    queryFn: async () => (await api.get<AdditionalHeadcountRequest[]>("/additional-headcount/inbox")).data,
  });
  const [expanded, setExpanded] = useState<string | null>(null);
  const [comment, setComment] = useState("");
  const [error, setError] = useState<string | null>(null);

  const decide = useMutation({
    mutationFn: async ({ request, decision }: { request: AdditionalHeadcountRequest; decision: "APPROVE" | "RETURN" }) => {
      const endpoint = HEADCOUNT_DECISION_ENDPOINT[request.currentStage];
      return (await api.post(`/additional-headcount/${request.id}/decisions/${endpoint}`, { decision, comment: comment || undefined })).data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["additional-headcount-inbox"] });
      setExpanded(null);
      setComment("");
      setError(null);
    },
    onError: (err: any) => setError(err.response?.data?.error ?? "Action failed."),
  });

  if (requests.length === 0) return null;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <span className="rounded bg-emerald-700 px-2 py-0.5 text-xs font-bold text-white">{requests.length}</span>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-emerald-800">Additional Headcount Requests</h2>
      </div>
      {requests.map((r) => {
        const isOpen = expanded === r.id;
        return (
          <div key={r.id} className="rounded-lg border border-slate-200 border-l-4 border-l-emerald-400 bg-white p-4 text-sm shadow-sm">
            <div className="flex items-center justify-between">
              <div>
                <span className="font-medium">
                  {r.position} (Rank {r.rank}) — {r.company.code}
                </span>
                <div className="text-xs text-slate-500">
                  {r.department.name} · by {r.createdBy.name} · est. hire{" "}
                  {new Date(r.estimatedHireDate).toLocaleDateString()}
                </div>
              </div>
              <button
                onClick={() => {
                  setExpanded(isOpen ? null : r.id);
                  setComment("");
                  setError(null);
                }}
                className="rounded border border-slate-300 px-2 py-1 text-xs hover:bg-slate-100"
              >
                {isOpen ? "Close" : "Review"}
              </button>
            </div>
            {isOpen && (
              <div className="mt-3 space-y-2 border-t border-slate-100 pt-3">
                <div className="text-slate-600">{r.justification}</div>
                <label className="block text-xs font-medium text-slate-600">Comment (required to Return)</label>
                <textarea
                  className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm"
                  rows={2}
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                />
                {error && <div className="text-red-700">{error}</div>}
                <div className="flex gap-2">
                  <button
                    onClick={() => decide.mutate({ request: r, decision: "APPROVE" })}
                    disabled={decide.isPending}
                    className="rounded bg-emerald-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-600 disabled:opacity-50"
                  >
                    Approve
                  </button>
                  <button
                    onClick={() => decide.mutate({ request: r, decision: "RETURN" })}
                    disabled={decide.isPending}
                    className="rounded bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-500 disabled:opacity-50"
                  >
                    Return
                  </button>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

interface ForecastSubmissionListItem {
  id: string;
  departmentId: string;
  stage: string;
  department: { name: string };
}

const FORECAST_DECISION_ENDPOINT: Record<string, string> = {
  HEAD_REVIEW: "head-decision",
  BUDGET_OFFICER_REVIEW: "budget-officer-decision",
};

function ForecastInboxSection() {
  const queryClient = useQueryClient();
  const { data: submissions = [] } = useQuery({
    queryKey: ["forecast-inbox"],
    queryFn: async () => (await api.get<ForecastSubmissionListItem[]>("/forecast/inbox/pending")).data,
  });
  const [expanded, setExpanded] = useState<string | null>(null);
  const [comment, setComment] = useState("");
  const [error, setError] = useState<string | null>(null);

  const decide = useMutation({
    mutationFn: async ({ submission, decision }: { submission: ForecastSubmissionListItem; decision: "APPROVE" | "RETURN" }) => {
      const endpoint = FORECAST_DECISION_ENDPOINT[submission.stage];
      return (await api.post(`/forecast/${submission.departmentId}/${endpoint}`, { decision, comment: comment || undefined })).data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["forecast-inbox"] });
      setExpanded(null);
      setComment("");
      setError(null);
    },
    onError: (err: any) => setError(err.response?.data?.error ?? "Action failed."),
  });

  if (submissions.length === 0) return null;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <span className="rounded bg-emerald-700 px-2 py-0.5 text-xs font-bold text-white">{submissions.length}</span>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-emerald-800">Forecast Approvals</h2>
      </div>
      {submissions.map((s) => {
        const isOpen = expanded === s.id;
        return (
          <div key={s.id} className="rounded-lg border border-slate-200 border-l-4 border-l-blue-400 bg-white p-4 text-sm shadow-sm">
            <div className="flex items-center justify-between">
              <div>
                <Link to="/forecast" className="font-medium text-emerald-800 hover:underline">
                  {s.department.name} — 2026 Remaining Months Forecast
                </Link>
              </div>
              <div className="flex items-center gap-2">
                <StatusBadge stage={s.stage} />
                <button
                  onClick={() => {
                    setExpanded(isOpen ? null : s.id);
                    setComment("");
                    setError(null);
                  }}
                  className="rounded border border-slate-300 px-2 py-1 text-xs hover:bg-slate-100"
                >
                  {isOpen ? "Close" : "Review"}
                </button>
              </div>
            </div>
            {isOpen && (
              <div className="mt-3 space-y-2 border-t border-slate-100 pt-3">
                <label className="block text-xs font-medium text-slate-600">Comment (required to Return)</label>
                <textarea
                  className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm"
                  rows={2}
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                />
                {error && <div className="text-red-700">{error}</div>}
                <div className="flex gap-2">
                  <button
                    onClick={() => decide.mutate({ submission: s, decision: "APPROVE" })}
                    disabled={decide.isPending}
                    className="rounded bg-emerald-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-600 disabled:opacity-50"
                  >
                    Approve
                  </button>
                  <button
                    onClick={() => decide.mutate({ submission: s, decision: "RETURN" })}
                    disabled={decide.isPending}
                    className="rounded bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-500 disabled:opacity-50"
                  >
                    Return
                  </button>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

const DECISION_ENDPOINT: Record<string, string> = {
  DEPT_HEAD_REVIEW: "dept-head",
  CFO_APPROVAL: "cfo",
  CENTRALIZED_L1_REVIEW: "centralized-l1",
  CENTRALIZED_HEAD_REVIEW: "centralized-head",
  BCA_HEAD_REVIEW: "bca-head",
};

export function InboxPage() {
  const queryClient = useQueryClient();
  const { data: requests = [], isLoading } = useQuery({
    queryKey: ["inbox"],
    queryFn: async () => (await api.get<BudgetRequest[]>("/budget-requests/inbox")).data,
  });

  const [expanded, setExpanded] = useState<string | null>(null);
  const [comment, setComment] = useState("");
  const [error, setError] = useState<string | null>(null);

  const decide = useMutation({
    mutationFn: async ({
      request,
      decision,
    }: {
      request: BudgetRequest;
      decision: "APPROVE" | "REJECT" | "RETURN";
    }) => {
      const endpoint = DECISION_ENDPOINT[request.currentStage];
      const body =
        request.currentStage === "CENTRALIZED_L1_REVIEW"
          ? { decision, varianceJustification: comment || undefined }
          : { decision, comment: comment || undefined };
      return (await api.post(`/budget-requests/${request.id}/decisions/${endpoint}`, body)).data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["inbox"] });
      setExpanded(null);
      setComment("");
      setError(null);
    },
    onError: (err: any) => setError(err.response?.data?.error ?? "Action failed."),
  });

  if (isLoading) return <div className="text-sm text-slate-400">Loading…</div>;

  return (
    <div className="space-y-6">
      <PageHeader title="Inbox" subtitle="Requests, headcount asks, and forecast approvals waiting on your review." />
      <HeadcountInboxSection />
      <ForecastInboxSection />
      {requests.length === 0 ? (
        <div className="rounded-lg border border-dashed border-slate-300 bg-white/60 p-6 text-center text-sm text-slate-400">
          Nothing waiting on you right now.
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <span className="rounded bg-emerald-700 px-2 py-0.5 text-xs font-bold text-white">{requests.length}</span>
            <h2 className="text-sm font-semibold uppercase tracking-wide text-emerald-800">Budget Requests</h2>
          </div>
          {requests.map((r) => {
            const isOpen = expanded === r.id;
            const approveLabel = r.currentStage === "CENTRALIZED_L1_REVIEW" ? "Approve" : "Approve";
            const negativeLabel = r.currentStage === "CENTRALIZED_L1_REVIEW" ? "Reject" : "Return";
            const negativeDecision = r.currentStage === "CENTRALIZED_L1_REVIEW" ? "REJECT" : "RETURN";

            return (
              <div key={r.id} className="rounded-lg border border-slate-200 border-l-4 border-l-amber-400 bg-white p-4 text-sm shadow-sm">
                <div className="flex items-center justify-between">
                  <div>
                    <Link to={`/requests/${r.id}`} className="font-medium text-emerald-800 hover:underline">
                      {r.expenseLineItem.name}
                    </Link>
                    <div className="text-xs text-slate-500">
                      {r.department.name} → {r.expenseLineItem.ownerDepartment.name} · ₱
                      {r.proposedAmount.toLocaleString()} · by {r.createdBy.name}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <StatusBadge stage={r.currentStage} />
                    <button
                      onClick={() => {
                        setExpanded(isOpen ? null : r.id);
                        setComment("");
                        setError(null);
                      }}
                      className="rounded border border-slate-300 px-2 py-1 text-xs hover:bg-slate-100"
                    >
                      {isOpen ? "Close" : "Review"}
                    </button>
                  </div>
                </div>

                {isOpen && (
                  <div className="mt-3 space-y-2 border-t border-slate-100 pt-3">
                    <div className="text-slate-600">{r.businessJustification}</div>
                    <label className="block text-xs font-medium text-slate-600">
                      {r.currentStage === "CENTRALIZED_L1_REVIEW"
                        ? "Variance justification (required only if the department is over its cap)"
                        : "Comment (required to Return)"}
                    </label>
                    <textarea
                      className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm"
                      rows={2}
                      value={comment}
                      onChange={(e) => setComment(e.target.value)}
                    />
                    {error && <div className="text-red-700">{error}</div>}
                    <div className="flex gap-2">
                      <button
                        onClick={() => decide.mutate({ request: r, decision: "APPROVE" })}
                        disabled={decide.isPending}
                        className="rounded bg-emerald-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-600 disabled:opacity-50"
                      >
                        {approveLabel}
                      </button>
                      <button
                        onClick={() => decide.mutate({ request: r, decision: negativeDecision as any })}
                        disabled={decide.isPending}
                        className="rounded bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-500 disabled:opacity-50"
                      >
                        {negativeLabel}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
