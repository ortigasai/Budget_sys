import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type AdditionalHeadcountRequest, type BudgetRequest, type HeadcountReviewDecision, type MobilePhoneBudgetRequest, type Office365AccountRequest, type ReviewDecision, type RevenueBatchSummary } from "../api/client";
import { StatusBadge } from "../components/StatusBadge";
import { PageHeader } from "../components/PageHeader";
import { roleLabel } from "../components/RoleSwitcher";
import { useFiscalYear } from "../lib/fiscalCycle";

// Mirrors workflowService.ts's approve-path transitions so the reviewer can
// see where a request goes next before they act. Only the stages that pass
// through this Inbox (not BUDGET_OFFICER_REVIEW, which lives on Step5) need
// a "what happens on approve" entry — approving from BUDGET_OFFICER_REVIEW
// itself isn't done from here.
const BCA_THRESHOLD = 1_000_000;

function nextApprovalTarget(r: BudgetRequest): string {
  const ownerDept = r.expenseLineItem.ownerDepartment.name;
  switch (r.currentStage) {
    case "DEPT_HEAD_REVIEW":
      return r.requiresCfoApproval ? roleLabel("CFO") : `${roleLabel("CENTRALIZED_FIRST_LEVEL_REVIEWER")} (${ownerDept})`;
    case "CFO_APPROVAL":
      return `${roleLabel("CENTRALIZED_FIRST_LEVEL_REVIEWER")} (${ownerDept})`;
    case "CENTRALIZED_L1_REVIEW":
      return `${roleLabel("CENTRALIZED_DEPARTMENT_HEAD")} (${ownerDept})`;
    case "CENTRALIZED_HEAD_REVIEW":
      return r.proposedAmount > BCA_THRESHOLD ? roleLabel("BCA_HEAD") : roleLabel("BUDGET_OFFICER");
    case "BCA_HEAD_REVIEW":
      return roleLabel("BUDGET_OFFICER");
    default:
      return roleLabel("BUDGET_OFFICER");
  }
}

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
      // An HR Head APPROVE here may have just created a new Office 365
      // Account request for IS & IT and a Mobile Phone budget request for
      // Admin Services — refresh both queues too.
      queryClient.invalidateQueries({ queryKey: ["office365-inbox"] });
      queryClient.invalidateQueries({ queryKey: ["mobile-phone-budget-inbox"] });
      queryClient.invalidateQueries({ queryKey: ["reviewed-by-me"] });
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
        <h2 className="text-sm font-semibold tracking-wide text-emerald-800">Additional Manpower Requests</h2>
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
                  {r.department.name} · by {r.createdBy.name} · est. hire{""}
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
                <DecisionHistoryList decisions={r.reviewDecisions} />
                <label className="block text-xs font-medium text-slate-600">Comment (required to Return)</label>
                <textarea className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm" rows={2} value={comment} onChange={(e) => setComment(e.target.value)} />
                {error && <div className="text-red-700">{error}</div>}
                <div className="flex gap-2">
                  <button onClick={() => decide.mutate({ request: r, decision: "APPROVE" })} disabled={decide.isPending} className="rounded bg-emerald-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-600 disabled:opacity-50">
                    Approve
                  </button>
                  <button onClick={() => decide.mutate({ request: r, decision: "RETURN" })} disabled={decide.isPending} className="rounded bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-500 disabled:opacity-50">
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

// Notes_8: "Request of Additional Headcount will automatically trigger
// request for additional Office 365 Account. This will route to IS & IT for
// review and approval." A single Approve/Reject decision, unlike the
// headcount request's own multi-stage chain — this runs in parallel and
// doesn't gate it.
function Office365InboxSection() {
  const queryClient = useQueryClient();
  const { data: requests = [] } = useQuery({
    queryKey: ["office365-inbox"],
    queryFn: async () => (await api.get<Office365AccountRequest[]>("/additional-headcount/office365-inbox")).data,
  });
  const [expanded, setExpanded] = useState<string | null>(null);
  const [comment, setComment] = useState("");
  const [error, setError] = useState<string | null>(null);

  const decide = useMutation({
    mutationFn: async ({ id, decision }: { id: string; decision: "APPROVE" | "REJECT" }) => (await api.post(`/additional-headcount/office365/${id}/decision`, { decision, comment: comment || undefined })).data,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["office365-inbox"] });
      queryClient.invalidateQueries({ queryKey: ["reviewed-by-me"] });
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
        <h2 className="text-sm font-semibold tracking-wide text-emerald-800">Office 365 Account Requests</h2>
      </div>
      {requests.map((r) => {
        const isOpen = expanded === r.id;
        const hr = r.additionalHeadcountRequest;
        return (
          <div key={r.id} className="rounded-lg border border-slate-200 border-l-4 border-l-purple-400 bg-white p-4 text-sm shadow-sm">
            <div className="flex items-center justify-between">
              <div>
                <span className="font-medium">
                  {hr.code} — {hr.position} (Rank {hr.rank}) — {hr.company.code}
                </span>
                <div className="text-xs text-slate-500">
                  {hr.department.name} · headcount approved for {hr.createdBy.name}
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
                <label className="block text-xs font-medium text-slate-600">Comment (required to Reject)</label>
                <textarea className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm" rows={2} value={comment} onChange={(e) => setComment(e.target.value)} />
                {error && <div className="text-red-700">{error}</div>}
                <div className="flex gap-2">
                  <button onClick={() => decide.mutate({ id: r.id, decision: "APPROVE" })} disabled={decide.isPending} className="rounded bg-emerald-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-600 disabled:opacity-50">
                    Approve
                  </button>
                  <button onClick={() => decide.mutate({ id: r.id, decision: "REJECT" })} disabled={decide.isPending} className="rounded bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-500 disabled:opacity-50">
                    Reject
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

// Notes_8 (revised): "Request of Additional Headcount will also
// automatically trigger request for Mobile Phone budget once the Additional
// Headcount is approved. This will route to Admin Services for review and
// approval." Same single-stage shape as Office365InboxSection above, just a
// different reviewing department.
function MobilePhoneBudgetInboxSection() {
  const queryClient = useQueryClient();
  const { data: requests = [] } = useQuery({
    queryKey: ["mobile-phone-budget-inbox"],
    queryFn: async () => (await api.get<MobilePhoneBudgetRequest[]>("/additional-headcount/mobile-phone-budget-inbox")).data,
  });
  const [expanded, setExpanded] = useState<string | null>(null);
  const [comment, setComment] = useState("");
  const [error, setError] = useState<string | null>(null);

  const decide = useMutation({
    mutationFn: async ({ id, decision }: { id: string; decision: "APPROVE" | "REJECT" }) =>
      (
        await api.post(`/additional-headcount/mobile-phone-budget/${id}/decision`, {
          decision,
          comment: comment || undefined,
        })
      ).data,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["mobile-phone-budget-inbox"] });
      queryClient.invalidateQueries({ queryKey: ["reviewed-by-me"] });
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
        <h2 className="text-sm font-semibold tracking-wide text-emerald-800">Mobile Phone Budget Requests</h2>
      </div>
      {requests.map((r) => {
        const isOpen = expanded === r.id;
        const hr = r.additionalHeadcountRequest;
        return (
          <div key={r.id} className="rounded-lg border border-slate-200 border-l-4 border-l-purple-400 bg-white p-4 text-sm shadow-sm">
            <div className="flex items-center justify-between">
              <div>
                <span className="font-medium">
                  {hr.code} — {hr.position} (Rank {hr.rank}) — {hr.company.code}
                </span>
                <div className="text-xs text-slate-500">
                  {hr.department.name} · headcount approved for {hr.createdBy.name}
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
                <label className="block text-xs font-medium text-slate-600">Comment (required to Reject)</label>
                <textarea className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm" rows={2} value={comment} onChange={(e) => setComment(e.target.value)} />
                {error && <div className="text-red-700">{error}</div>}
                <div className="flex gap-2">
                  <button onClick={() => decide.mutate({ id: r.id, decision: "APPROVE" })} disabled={decide.isPending} className="rounded bg-emerald-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-600 disabled:opacity-50">
                    Approve
                  </button>
                  <button onClick={() => decide.mutate({ id: r.id, decision: "REJECT" })} disabled={decide.isPending} className="rounded bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-500 disabled:opacity-50">
                    Reject
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
  reviewDecisions: ReviewDecision[];
}

const FORECAST_DECISION_ENDPOINT: Record<string, string> = {
  HEAD_REVIEW: "head-decision",
  BUDGET_OFFICER_REVIEW: "budget-officer-decision",
};

function ForecastInboxSection() {
  const queryClient = useQueryClient();
  const { forecastYear } = useFiscalYear();
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
      queryClient.invalidateQueries({ queryKey: ["reviewed-by-me"] });
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
        <h2 className="text-sm font-semibold tracking-wide text-emerald-800">Forecast Approvals</h2>
      </div>
      {submissions.map((s) => {
        const isOpen = expanded === s.id;
        return (
          <div key={s.id} className="rounded-lg border border-slate-200 border-l-4 border-l-blue-400 bg-white p-4 text-sm shadow-sm">
            <div className="flex items-center justify-between">
              <div>
                <Link to="/forecast" className="font-medium text-emerald-800 hover:underline">
                  {s.department.name} — {forecastYear} Remaining Months Forecast
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
                <DecisionHistoryList decisions={s.reviewDecisions} />
                <label className="block text-xs font-medium text-slate-600">Comment (required to Return)</label>
                <textarea className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm" rows={2} value={comment} onChange={(e) => setComment(e.target.value)} />
                {error && <div className="text-red-700">{error}</div>}
                <div className="flex gap-2">
                  <button onClick={() => decide.mutate({ submission: s, decision: "APPROVE" })} disabled={decide.isPending} className="rounded bg-emerald-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-600 disabled:opacity-50">
                    Approve
                  </button>
                  <button onClick={() => decide.mutate({ submission: s, decision: "RETURN" })} disabled={decide.isPending} className="rounded bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-500 disabled:opacity-50">
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

function peso(n: number) {
  return `₱${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

const REVENUE_DECISION_ENDPOINT: Record<string, string> = {
  REVENUE_BU_FINANCE_OFFICER_REVIEW: "bu-finance-officer",
  REVENUE_BU_FINANCE_HEAD_REVIEW: "bu-finance-head",
  REVENUE_BUDGET_OFFICER_REVIEW: "budget-officer",
  REVENUE_BCA_HEAD_REVIEW: "bca-head",
};

// Merged in per user request - Revenue batches used to have their own
// standalone "Revenue Approvals" page (RevenueInboxPage.tsx); a Revenue
// batch always travels through its 4-stage SBU-role chain as one unit (see
// workflowService.ts's revenueBatchDecision), so reviewing it is one action
// per batch, not per CC-GL row - a separate shape from the generic
// BudgetRequest section below, which never sees Revenue's rows (they never
// hold one of its stage values).
function RevenueBatchInboxSection() {
  const queryClient = useQueryClient();
  const { data: batches = [] } = useQuery({
    queryKey: ["revenue-batches", "inbox"],
    queryFn: async () => (await api.get<RevenueBatchSummary[]>("/revenue-batches/inbox")).data,
  });
  const [expanded, setExpanded] = useState<string | null>(null);
  const [comment, setComment] = useState("");
  const [error, setError] = useState<string | null>(null);

  const decide = useMutation({
    mutationFn: async ({ batch, decision }: { batch: RevenueBatchSummary; decision: "APPROVE" | "RETURN" }) => {
      const endpoint = REVENUE_DECISION_ENDPOINT[batch.currentStage];
      return (await api.post(`/revenue-batches/${batch.id}/decisions/${endpoint}`, { decision, comment: comment || undefined })).data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["revenue-batches"] });
      queryClient.invalidateQueries({ queryKey: ["reviewed-by-me"] });
      setExpanded(null);
      setComment("");
      setError(null);
    },
    onError: (err: any) => setError(err.response?.data?.error ?? "Action failed."),
  });

  if (batches.length === 0) return null;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <span className="rounded bg-emerald-700 px-2 py-0.5 text-xs font-bold text-white">{batches.length}</span>
        <h2 className="text-sm font-semibold tracking-wide text-emerald-800">Revenue Approvals</h2>
      </div>
      {batches.map((b) => {
        const isOpen = expanded === b.id;
        return (
          <div key={b.id} className="rounded-lg border border-slate-200 border-l-4 border-l-teal-400 bg-white p-4 text-sm shadow-sm">
            <div className="flex items-center justify-between">
              <div>
                <span className="font-medium">
                  {b.sbu} · {b.company?.name}
                </span>
                <div className="text-xs text-slate-500">
                  {b.rowCount} CC-GL row(s) · {peso(b.totalAmount)}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <StatusBadge stage={b.currentStage} />
                <button
                  onClick={() => {
                    setExpanded(isOpen ? null : b.id);
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
                <textarea className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm" rows={2} value={comment} onChange={(e) => setComment(e.target.value)} />
                {error && <div className="text-red-700">{error}</div>}
                <div className="flex gap-2">
                  <button onClick={() => decide.mutate({ batch: b, decision: "APPROVE" })} disabled={decide.isPending} className="rounded bg-emerald-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-600 disabled:opacity-50">
                    Approve
                  </button>
                  <button onClick={() => decide.mutate({ batch: b, decision: "RETURN" })} disabled={decide.isPending || !comment.trim()} className="rounded bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-500 disabled:opacity-50">
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

const DECISION_LABELS: Record<string, string> = { APPROVE: "Approved", REJECT: "Rejected", RETURN: "Returned" };
const DECISION_COLORS: Record<string, string> = {
  APPROVE: "bg-emerald-100 text-emerald-800",
  REJECT: "bg-red-100 text-red-700",
  RETURN: "bg-red-100 text-red-700",
};

function DecisionBadge({ decision }: { decision: string }) {
  return <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${DECISION_COLORS[decision] ?? "bg-slate-100"}`}>{DECISION_LABELS[decision] ?? decision}</span>;
}

interface DecisionLike {
  id: string;
  stage: string;
  decision: string;
  comment: string | null;
  timestamp: string;
  decidedBy: { name: string };
}

// Notes_9: "include also the history of approval" — a pending item's own
// past decisions (e.g. Dept Head already approved, now waiting on you)
// weren't visible anywhere in the Inbox itself; ReviewHistorySection below
// only covers what *this* user has personally decided on. Every
// inbox query already fetches `reviewDecisions` (DETAIL_INCLUDE), so this
// just renders what was already there.
function DecisionHistoryList({ decisions }: { decisions: DecisionLike[] }) {
  if (decisions.length === 0) return null;
  return (
    <div className="space-y-1.5 border-t border-slate-100 pt-2">
      <div className="text-xs font-medium tracking-wide text-slate-400">Approval History</div>
      {decisions.map((d) => (
        <div key={d.id} className="flex items-center justify-between gap-3 text-xs">
          <div className="min-w-0 text-slate-600">
            <span className="font-medium text-slate-700">{d.decidedBy.name}</span> — {StageLabel(d.stage)}
            {d.comment && <span className="italic text-slate-500"> —"{d.comment}"</span>}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <DecisionBadge decision={d.decision} />
            <span className="text-slate-400">{new Date(d.timestamp).toLocaleDateString()}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

const STAGE_DISPLAY: Record<string, string> = {
  DEPT_HEAD_REVIEW: "Department Head",
  CFO_APPROVAL: "CFO",
  CENTRALIZED_L1_REVIEW: "Centralized First-Level Reviewer",
  CENTRALIZED_HEAD_REVIEW: "Centralized Department Head",
  BCA_HEAD_REVIEW: "BC&A Head",
  BUDGET_OFFICER_REVIEW: "Budget Officer",
  HR_ANALYST_REVIEW: "HR Analyst",
  HR_HEAD_REVIEW: "HR Head",
  HEAD_REVIEW: "Centralized Department Head",
  REVIEWER_REVIEW: "Centralized Department Reviewer",
  APPROVER_REVIEW: "Centralized Department Approver",
  REVENUE_BU_FINANCE_OFFICER_REVIEW: "BU Finance Officer",
  REVENUE_BU_FINANCE_HEAD_REVIEW: "BU Finance Head",
  REVENUE_BUDGET_OFFICER_REVIEW: "Budget Officer",
  REVENUE_BCA_HEAD_REVIEW: "BC&A Head",
};

function StageLabel(stage: string): string {
  return STAGE_DISPLAY[stage] ?? stage;
}

interface ForecastReviewedItem {
  id: string;
  department: { name: string };
  myDecision: ReviewDecision;
}

// Once a decision moves an item past the current user's stage, it vanishes
// from the queues above with no trace — this collects everything the user
// has personally decided on (across all three inbox categories) so that
// history isn't lost, only out of the way. Collapsed by default since it's
// a reference trail, not something waiting on action.
function ReviewHistorySection() {
  const { forecastYear } = useFiscalYear();
  const { data: budgetHistory = [] } = useQuery({
    queryKey: ["reviewed-by-me", "budget-requests"],
    queryFn: async () => (await api.get<(BudgetRequest & { myDecision: ReviewDecision })[]>("/budget-requests/reviewed-by-me")).data,
  });
  const { data: headcountHistory = [] } = useQuery({
    queryKey: ["reviewed-by-me", "headcount"],
    queryFn: async () => (await api.get<(AdditionalHeadcountRequest & { myDecision: HeadcountReviewDecision })[]>("/additional-headcount/reviewed-by-me")).data,
  });
  const { data: forecastHistory = [] } = useQuery({
    queryKey: ["reviewed-by-me", "forecast"],
    queryFn: async () => (await api.get<ForecastReviewedItem[]>("/forecast/reviewed-by-me")).data,
  });
  const { data: office365History = [] } = useQuery({
    queryKey: ["reviewed-by-me", "office365"],
    queryFn: async () => (await api.get<Office365AccountRequest[]>("/additional-headcount/office365/reviewed-by-me")).data,
  });
  const { data: mobilePhoneBudgetHistory = [] } = useQuery({
    queryKey: ["reviewed-by-me", "mobile-phone-budget"],
    queryFn: async () => (await api.get<MobilePhoneBudgetRequest[]>("/additional-headcount/mobile-phone-budget/reviewed-by-me")).data,
  });
  const { data: revenueBatchHistory = [] } = useQuery({
    queryKey: ["reviewed-by-me", "revenue-batches"],
    queryFn: async () => (await api.get<(RevenueBatchSummary & { myDecision: ReviewDecision })[]>("/revenue-batches/reviewed-by-me")).data,
  });

  const [open, setOpen] = useState(false);

  const entries = [
    ...budgetHistory.map((r) => ({
      id: `budget-${r.id}`,
      label: r.expenseLineItem.name,
      sublabel: `${r.department.name} → ${r.expenseLineItem.ownerDepartment.name} · ₱${r.proposedAmount.toLocaleString()}`,
      link: `/requests/${r.id}`,
      decision: r.myDecision,
    })),
    ...headcountHistory.map((r) => ({
      id: `headcount-${r.id}`,
      label: `${r.position} (Rank ${r.rank}) — ${r.company.code}`,
      sublabel: r.department.name,
      link: undefined,
      decision: r.myDecision,
    })),
    ...forecastHistory.map((s) => ({
      id: `forecast-${s.id}`,
      label: `${s.department.name} — ${forecastYear} Remaining Months Forecast`,
      sublabel: undefined,
      link: "/forecast",
      decision: s.myDecision,
    })),
    // Notes_14: Office 365/Mobile Phone follow-ons are now a two-stage
    // chain (Reviewer, then Approver) — the backend already resolves which
    // of the two stages *this* viewer decided into `myDecision`, so it's
    // used directly rather than re-derived here.
    ...office365History.map((r) => ({
      id: `office365-${r.id}`,
      label: `Office 365 Account — ${r.additionalHeadcountRequest.code} — ${r.additionalHeadcountRequest.position} (${r.additionalHeadcountRequest.company.code})`,
      sublabel: `${r.additionalHeadcountRequest.department.name} · ${StageLabel(r.myDecision!.stage)}`,
      link: undefined,
      decision: r.myDecision!,
    })),
    ...mobilePhoneBudgetHistory.map((r) => ({
      id: `mobile-phone-budget-${r.id}`,
      label: `Mobile Phone Budget — ${r.additionalHeadcountRequest.code} — ${r.additionalHeadcountRequest.position} (${r.additionalHeadcountRequest.company.code})`,
      sublabel: `${r.additionalHeadcountRequest.department.name} · ${StageLabel(r.myDecision!.stage)}`,
      link: undefined,
      decision: r.myDecision!,
    })),
    ...revenueBatchHistory.map((b) => ({
      id: `revenue-batch-${b.id}`,
      label: `Revenue Batch — ${b.sbu} · ${b.company?.name}`,
      sublabel: `${b.rowCount} CC-GL row(s) · ${peso(b.totalAmount)} · ${StageLabel(b.myDecision.stage)}`,
      link: undefined,
      decision: b.myDecision,
    })),
  ].sort((a, b) => new Date(b.decision.timestamp).getTime() - new Date(a.decision.timestamp).getTime());

  if (entries.length === 0) return null;

  return (
    <div className="space-y-3">
      <button onClick={() => setOpen((o) => !o)} className="flex items-center gap-2 text-sm font-semibold tracking-wide text-slate-500 hover:text-emerald-800">
        <span className="rounded bg-slate-200 px-2 py-0.5 text-xs font-bold text-slate-600">{entries.length}</span>
        Review History
        <span className="text-xs font-normal normal-case text-slate-400">{open ? "(hide)" : "(show)"}</span>
      </button>
      {open && (
        <div className="space-y-2">
          {entries.map((e) => (
            <div key={e.id} className="rounded-lg border border-slate-200 bg-white p-3 text-sm shadow-sm">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  {e.link ? (
                    <Link to={e.link} className="font-medium text-emerald-800 hover:underline">
                      {e.label}
                    </Link>
                  ) : (
                    <span className="font-medium text-slate-700">{e.label}</span>
                  )}
                  {e.sublabel && <div className="text-xs text-slate-500">{e.sublabel}</div>}
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <DecisionBadge decision={e.decision.decision} />
                  <span className="text-xs text-slate-400">{new Date(e.decision.timestamp).toLocaleDateString()}</span>
                </div>
              </div>
              {e.decision.comment && <div className="mt-1 text-xs italic text-slate-500">"{e.decision.comment}"</div>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

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
    mutationFn: async ({ request, decision }: { request: BudgetRequest; decision: "APPROVE" | "REJECT" | "RETURN" }) => {
      const endpoint = DECISION_ENDPOINT[request.currentStage];
      const body = request.currentStage === "CENTRALIZED_L1_REVIEW" ? { decision, varianceJustification: comment || undefined } : { decision, comment: comment || undefined };
      return (await api.post(`/budget-requests/${request.id}/decisions/${endpoint}`, body)).data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["inbox"] });
      queryClient.invalidateQueries({ queryKey: ["reviewed-by-me"] });
      setExpanded(null);
      setComment("");
      setError(null);
    },
    onError: (err: any) => setError(err.response?.data?.error ?? "Action failed."),
  });

  if (isLoading) return <div className="text-sm text-slate-400">Loading…</div>;

  return (
    <div className="space-y-6">
      <PageHeader subtitle="Requests, headcount asks, forecast, and Revenue batch approvals waiting on your review." />
      <HeadcountInboxSection />
      <Office365InboxSection />
      <MobilePhoneBudgetInboxSection />
      <ForecastInboxSection />
      <RevenueBatchInboxSection />
      {requests.length === 0 ? (
        <div className="rounded-lg border border-dashed border-slate-300 bg-white/60 p-6 text-center text-sm text-slate-400">Nothing waiting on you right now.</div>
      ) : (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <span className="rounded bg-emerald-700 px-2 py-0.5 text-xs font-bold text-white">{requests.length}</span>
            <h2 className="text-sm font-semibold tracking-wide text-emerald-800">Budget Requests</h2>
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
                    <div className="text-xs font-medium tracking-wide text-slate-400">{r.expenseLineItem.category}</div>
                    <Link to={`/requests/${r.id}`} className="font-medium text-emerald-800 hover:underline">
                      {r.expenseLineItem.name}
                    </Link>
                    <div className="text-xs text-slate-500">
                      {r.department.name} → {r.expenseLineItem.ownerDepartment.name} · ₱{r.proposedAmount.toLocaleString()} · by {r.createdBy.name}
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
                    <div className="text-xs text-slate-500">
                      If approved, this moves to:{""}
                      <span className="font-medium text-slate-700">{nextApprovalTarget(r)}</span>
                    </div>
                    <DecisionHistoryList decisions={r.reviewDecisions} />
                    <label className="block text-xs font-medium text-slate-600">{r.currentStage === "CENTRALIZED_L1_REVIEW" ? "Variance justification (required only if the department is over its cap)" : "Comment (required to Return)"}</label>
                    <textarea className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm" rows={2} value={comment} onChange={(e) => setComment(e.target.value)} />
                    {error && <div className="text-red-700">{error}</div>}
                    <div className="flex gap-2">
                      <button onClick={() => decide.mutate({ request: r, decision: "APPROVE" })} disabled={decide.isPending} className="rounded bg-emerald-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-600 disabled:opacity-50">
                        {approveLabel}
                      </button>
                      <button onClick={() => decide.mutate({ request: r, decision: negativeDecision as any })} disabled={decide.isPending} className="rounded bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-500 disabled:opacity-50">
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
      <ReviewHistorySection />
    </div>
  );
}
