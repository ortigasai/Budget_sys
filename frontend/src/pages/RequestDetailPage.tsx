import { useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type BudgetRequest } from "../api/client";
import { StatusBadge } from "../components/StatusBadge";
import { useAuth } from "../context/AuthContext";
import { SectionLabel } from "../components/TabBar";

const CANCELLABLE_STAGES = new Set(["DRAFT", "DEPT_HEAD_REVIEW"]);

export function RequestDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { currentUser } = useAuth();
  const queryClient = useQueryClient();
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

  if (isLoading || !request) return <div className="text-sm text-slate-400">Loading…</div>;

  const canCancel = request.createdById === currentUser?.id && CANCELLABLE_STAGES.has(request.currentStage);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-gradient-to-r from-emerald-700 to-emerald-600 px-5 py-4 text-white shadow-sm">
        <h1 className="text-xl font-bold tracking-tight">{request.expenseLineItem.name}</h1>
        <div className="flex items-center gap-2">
          <StatusBadge stage={request.currentStage} />
          {canCancel && (
            <button
              onClick={() => cancelMutation.mutate()}
              disabled={cancelMutation.isPending}
              className="rounded-md bg-white/15 px-2.5 py-1 text-xs font-semibold text-red-200 ring-1 ring-white/30 hover:bg-white/25 hover:text-red-100 disabled:opacity-50"
            >
              Cancel Request
            </button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 rounded-lg border border-slate-200 bg-white p-4 text-sm shadow-sm sm:grid-cols-3">
        <Field label="Originating Department" value={request.department.name} />
        <Field label="Owning (Centralized) Department" value={request.expenseLineItem.ownerDepartment.name} />
        <Field label="GL-CC" value={`${request.expenseLineItem.glAccount} / ${request.expenseLineItem.costCenter}`} />
        <Field label="Fiscal Year" value={String(request.fiscalYear)} />
        <Field label="Proposed Amount" value={`₱${request.proposedAmount.toLocaleString()}`} accent />
        {request.budgetCutAmount > 0 && (
          <Field label="Budget Cut" value={`₱${request.budgetCutAmount.toLocaleString()}`} />
        )}
        {request.isOverBudget && <Field label="Flag" value="Over-budget / Requires Realignment" />}
        {request.sapDocumentNumber && <Field label="SAP Document #" value={request.sapDocumentNumber} />}
        {request.reasonCode && <Field label="Return Reason" value={request.reasonCode} />}
        <Field label="Created By" value={request.createdBy.name} />
      </div>

      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
        <div className="bg-emerald-50 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-emerald-800">
          Monthly Spend Grid
        </div>
        <div className="grid grid-cols-6 gap-2 p-4 text-sm sm:grid-cols-12">
          {["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"].map((m, i) => (
            <div key={m} className="text-center">
              <div className="text-xs text-slate-400">{m}</div>
              <div className="font-medium text-slate-700">{request.monthlyAmounts[i].toLocaleString()}</div>
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
      <div className="text-xs uppercase text-slate-500">{label}</div>
      <div className={accent ? "text-base font-bold text-emerald-800" : "font-medium"}>{value}</div>
    </div>
  );
}
