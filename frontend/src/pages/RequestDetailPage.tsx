import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type BudgetRequest } from "../api/client";
import { StatusBadge } from "../components/StatusBadge";
import { useAuth } from "../context/AuthContext";
import { SectionLabel } from "../components/TabBar";

const CANCELLABLE_STAGES = new Set(["DRAFT", "DEPT_HEAD_REVIEW"]);
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function RequestDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { currentUser } = useAuth();
  const queryClient = useQueryClient();
  const [submitError, setSubmitError] = useState<string | null>(null);
  const { data: request, isLoading } = useQuery({
    queryKey: ["budget-request", id],
    queryFn: async () => (await api.get<BudgetRequest>(`/budget-requests/${id}`)).data,
  });

  const cancelMutation = useMutation({
    mutationFn: async () => (await api.post<BudgetRequest>(`/budget-requests/${id}/cancel`)).data,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["budget-request", id] });
      queryClient.invalidateQueries({ queryKey: ["my-requests"] });
    },
  });

  const submitMutation = useMutation({
    mutationFn: async () => (await api.post<BudgetRequest>(`/budget-requests/${id}/submit`)).data,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["budget-request", id] });
      queryClient.invalidateQueries({ queryKey: ["my-requests"] });
      setSubmitError(null);
    },
    onError: (err: any) => setSubmitError(err.response?.data?.error ?? "Could not submit request."),
  });

  if (isLoading || !request) return <div className="text-sm text-slate-400">Loading…</div>;

  const canCancel = request.createdById === currentUser?.id && CANCELLABLE_STAGES.has(request.currentStage);
  const canSubmit = request.createdById === currentUser?.id && request.currentStage === "DRAFT";

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <button type="button" onClick={() => navigate(-1)} className="flex items-center gap-1 text-sm font-medium text-slate-500 hover:text-emerald-700">
        <svg viewBox="0 0 24 24" fill="none" strokeWidth={2} stroke="currentColor" className="h-4 w-4">
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
        </svg>
        Back
      </button>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-lg font-bold tracking-tight text-slate-800">{request.expenseLineItem.name}</h1>
        <div className="flex items-center gap-2">
          <StatusBadge stage={request.currentStage} />
          {canSubmit && (
            <button onClick={() => submitMutation.mutate()} disabled={submitMutation.isPending} className="rounded-md bg-emerald-700 px-2.5 py-1 text-xs font-semibold text-white hover:bg-emerald-600 disabled:opacity-50">
              Submit for Approval
            </button>
          )}
          {canCancel && (
            <button onClick={() => cancelMutation.mutate()} disabled={cancelMutation.isPending} className="rounded-md border border-red-300 px-2.5 py-1 text-xs font-semibold text-red-700 hover:bg-red-50 disabled:opacity-50">
              Cancel Request
            </button>
          )}
        </div>
      </div>

      {submitError && <div className="rounded bg-red-50 p-3 text-sm text-red-700">{submitError}</div>}

      <div className="grid grid-cols-2 gap-4 rounded-lg border border-slate-200 bg-white p-4 text-sm shadow-sm sm:grid-cols-3">
        <Field label="Originating Department" value={request.department.name} />
        <Field label="Owning (Centralized) Department" value={request.expenseLineItem.ownerDepartment.name} />
        <Field label="GL-CC" value={`${request.expenseLineItem.glAccount} / ${request.expenseLineItem.costCenter}`} />
        <Field label="Budget Code" value={request.budgetCode ?? request.expenseLineItem.budgetCode ?? "—"} />
        <Field label="Fiscal Year" value={String(request.fiscalYear)} />
        <Field label="Proposed Amount" value={`₱${request.proposedAmount.toLocaleString()}`} accent />
        {request.requestCategory === "NPC" && request.npcSbu && <Field label="SBU" value={request.npcSbu} />}
        {request.requestCategory === "NPC" && request.npcLocation && <Field label="Location" value={request.npcLocation} />}
        {request.requestCategory === "NPC" && request.projectStartDate && <Field label="Project Start" value={new Date(request.projectStartDate).toLocaleDateString()} />}
        {request.requestCategory === "NPC" && request.projectEndDate && <Field label="Project End" value={new Date(request.projectEndDate).toLocaleDateString()} />}
        {request.budgetCutAmount > 0 && <Field label="Budget Cut" value={`₱${request.budgetCutAmount.toLocaleString()}`} />}
        {request.isOverBudget && <Field label="Flag" value="Over-budget / Requires Realignment" />}
        {request.sapDocumentNumber && <Field label="SAP Document #" value={request.sapDocumentNumber} />}
        {request.reasonCode && <Field label="Return Reason" value={request.reasonCode} />}
        <Field label="Created By" value={request.createdBy.name} />
      </div>

      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
        <div className="bg-emerald-50 px-4 py-2 text-xs font-semibold tracking-wide text-emerald-800">Monthly Spend Grid</div>
        <div className="grid grid-cols-3 divide-x divide-y divide-slate-100 border-t border-slate-100 text-sm sm:grid-cols-4 lg:grid-cols-6">
          {MONTHS.map((m, i) => (
            <div key={m} className="px-2 py-3 text-center">
              <div className="text-xs font-medium tracking-wide text-slate-400">{m}</div>
              <div className="mt-1 font-semibold tabular-nums text-slate-700">{request.monthlyAmounts[i].toLocaleString()}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-lg border border-slate-200 bg-white p-4 text-sm shadow-sm">
        <SectionLabel>Business Justification</SectionLabel>
        <p className="text-slate-600">{request.businessJustification}</p>
      </div>

      {Object.keys(request.otherRequiredFields).length > 0 && (
        <div className="rounded-lg border border-slate-200 bg-white p-4 text-sm shadow-sm">
          <SectionLabel>Other Fields</SectionLabel>
          {Object.entries(request.otherRequiredFields).map(([k, v]) => (
            <div key={k}>
              <span className="font-medium">{k}:</span> {v}
            </div>
          ))}
        </div>
      )}

      <div className="rounded-lg border border-slate-200 bg-white p-4 text-sm shadow-sm">
        <SectionLabel>Attachments</SectionLabel>
        {request.attachments.length === 0 ? (
          <div className="text-slate-500">None</div>
        ) : (
          <ul className="list-inside list-disc">
            {request.attachments.map((a) => (
              <li key={a.id}>
                <a className="text-emerald-800 hover:underline" href={`/uploads/${a.storagePath}`} target="_blank" rel="noreferrer">
                  {a.fileName}
                </a>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="rounded-lg border border-slate-200 bg-white p-4 text-sm shadow-sm">
        <SectionLabel>Review History</SectionLabel>
        {request.reviewDecisions.length === 0 ? (
          <div className="text-slate-500">No decisions recorded yet.</div>
        ) : (
          <ul className="space-y-2">
            {request.reviewDecisions.map((d) => (
              <li key={d.id} className="border-l-2 border-emerald-200 pl-3">
                <div className="font-medium">
                  {d.decision} at {d.stage} — {d.decidedBy.name}
                </div>
                <div className="text-xs text-slate-500">{new Date(d.timestamp).toLocaleString()}</div>
                {d.comment && <div className="text-slate-600">{d.comment}</div>}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function Field({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div>
      <div className="text-xs text-slate-500">{label}</div>
      <div className={accent ? "text-base font-bold text-emerald-800" : "font-medium"}>{value}</div>
    </div>
  );
}
