import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api, requestLineDisplay, type BudgetRequest } from "../api/client";
import { STAGE_LABELS } from "./StatusBadge";

interface ReasonCode {
  id: string;
  label: string;
}

export function PendingFinalizationList({ requests, canEdit }: { requests: BudgetRequest[]; canEdit: boolean }) {
  const queryClient = useQueryClient();
  const { data: reasonCodes = [] } = useQuery({
    queryKey: ["reason-codes"],
    queryFn: async () => (await api.get<ReasonCode[]>("/admin/reason-codes")).data,
  });

  const applyCut = useMutation({
    mutationFn: async ({ id, cutAmount }: { id: string; cutAmount: number }) => (await api.post(`/budget-requests/${id}/budget-cut`, { cutAmount })).data,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["step5-dashboard"] }),
  });

  // Note 11: one click now does both jobs (finalize + the mock SAP upload,
  // see workflowService.ts's finalizeAtStep5) - the row leaves this "awaiting
  // finalization" list immediately, so there's no persistent place left to
  // show anything "inline"; a short banner naming the ticket stands in. The
  // SAP upload is still a mock, so its generated document number isn't shown.
  const [lastFinalized, setLastFinalized] = useState<{ lineItemName: string } | null>(null);
  const finalize = useMutation({
    mutationFn: async (r: BudgetRequest) => (await api.post<BudgetRequest>(`/budget-requests/${r.id}/finalize`)).data,
    onSuccess: (_updated, r) => {
      setLastFinalized({ lineItemName: requestLineDisplay(r).name });
      queryClient.invalidateQueries({ queryKey: ["step5-dashboard"] });
    },
  });

  const [returning, setReturning] = useState<string | null>(null);
  const [targetStage, setTargetStage] = useState("");
  const [reasonCodeId, setReasonCodeId] = useState("");

  const returnRequest = useMutation({
    mutationFn: async (id: string) => (await api.post(`/budget-requests/${id}/return-to-stage`, { targetStage, reasonCodeId })).data,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["step5-dashboard"] });
      setReturning(null);
    },
  });

  const grouped = requests.reduce<Record<string, BudgetRequest[]>>((acc, r) => {
    // SBU-batch categories (no owning centralized department) group by SBU instead.
    const key = requestLineDisplay(r).ownerDepartmentName ?? (r.sbu ? `${r.sbu} SBU` : r.requestCategory);
    acc[key] = acc[key] ?? [];
    acc[key].push(r);
    return acc;
  }, {});

  return (
    <div className="space-y-6">
      {Object.entries(grouped).map(([deptName, items]) => (
        <div key={deptName} className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
          <div className="bg-emerald-50 px-4 py-2 text-sm font-semibold tracking-wide text-emerald-800">{deptName}</div>
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs text-slate-500">
              <tr>
                <th className="px-3 py-2">Expense Line Item</th>
                <th className="px-3 py-2">Proposed</th>
                <th className="px-3 py-2">Budget Cut</th>
                <th className="px-3 py-2">Net</th>
                <th className="px-3 py-2">Flag</th>
                <th className="px-3 py-2">Actions</th>
              </tr>
            </thead>
            <tbody>
              {items.map((r, i) => (
                <tr key={r.id} className={`border-t border-slate-100 ${i % 2 === 1 ? "bg-slate-50/60" : ""}`}>
                  <td className="px-3 py-2">
                    <Link to={`/requests/${r.id}`} className="font-medium text-emerald-800 hover:underline">
                      {requestLineDisplay(r).name}
                    </Link>
                  </td>
                  <td className="px-3 py-2">{r.proposedAmount.toLocaleString(undefined, { maximumFractionDigits: 0 })}</td>
                  <td className="px-3 py-2">
                    {canEdit ? (
                      <input
                        type="number"
                        defaultValue={r.budgetCutAmount}
                        className="w-24 rounded border border-slate-300 px-1 py-0.5"
                        onBlur={(e) => {
                          const cutAmount = Number(e.target.value) || 0;
                          if (cutAmount !== r.budgetCutAmount) applyCut.mutate({ id: r.id, cutAmount });
                        }}
                      />
                    ) : (
                      r.budgetCutAmount.toLocaleString(undefined, { maximumFractionDigits: 0 })
                    )}
                  </td>
                  <td className="px-3 py-2 font-semibold text-slate-700">{(r.proposedAmount - r.budgetCutAmount).toLocaleString(undefined, { maximumFractionDigits: 0 })}</td>
                  <td className="px-3 py-2">{r.isOverBudget && <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">Over-budget / Requires Realignment</span>}</td>
                  <td className="px-3 py-2">
                    {canEdit ? (
                      <>
                        <div className="flex flex-wrap items-center gap-2">
                          <button onClick={() => finalize.mutate(r)} disabled={finalize.isPending} className="rounded-md bg-emerald-700 px-2 py-1 text-xs font-semibold text-white hover:bg-emerald-600 disabled:opacity-50">
                            Finalize & Upload
                          </button>
                          <button
                            onClick={() => {
                              const opening = returning !== r.id;
                              setReturning(opening ? r.id : null);
                              if (opening) setTargetStage(r.returnTargets?.[0] ?? "");
                            }}
                            className="rounded-md border border-slate-300 px-2 py-1 text-xs hover:bg-slate-100"
                          >
                            Return…
                          </button>
                        </div>
                        {returning === r.id && (
                          <div className="mt-2 flex flex-wrap items-center gap-2">
                            <select className="rounded border border-slate-300 px-1 py-1 text-xs" value={targetStage} onChange={(e) => setTargetStage(e.target.value)}>
                              {(r.returnTargets ?? []).map((stage) => (
                                <option key={stage} value={stage}>
                                  {STAGE_LABELS[stage] ?? stage}
                                </option>
                              ))}
                              <option value="REQUESTOR">Requestor</option>
                            </select>
                            <select className="rounded border border-slate-300 px-1 py-1 text-xs" value={reasonCodeId} onChange={(e) => setReasonCodeId(e.target.value)}>
                              <option value="">— Reason —</option>
                              {reasonCodes.map((rc) => (
                                <option key={rc.id} value={rc.id}>
                                  {rc.label}
                                </option>
                              ))}
                            </select>
                            <button onClick={() => returnRequest.mutate(r.id)} disabled={!reasonCodeId || !targetStage} className="rounded bg-red-600 px-2 py-1 text-xs font-medium text-white hover:bg-red-500 disabled:opacity-50">
                              Confirm Return
                            </button>
                          </div>
                        )}
                      </>
                    ) : (
                      <span className="text-xs text-slate-400">View only</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}

      {requests.length === 0 && <div className="text-sm text-slate-500">No requests awaiting finalization.</div>}

      {lastFinalized && (
        <div className="inline-block rounded-full bg-emerald-100 px-3 py-1 text-sm font-medium text-emerald-800">
          Finalized "{lastFinalized.lineItemName}"
        </div>
      )}
    </div>
  );
}
