import { useLayoutEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "../../context/AuthContext";
import { sfSbus } from "../../lib/groupScope";
import { api, downloadFile, SBU_OPTIONS, type DoeBatchDetail, type RequestCategory, type Sbu } from "../../api/client";
import { PageHeader } from "../../components/PageHeader";
import { SectionLabel } from "../../components/TabBar";
import { StatusBadge } from "../../components/StatusBadge";
import { useFiscalYear } from "../../lib/fiscalCycle";
import { startUpload, useUploadTaskBySlot } from "../../lib/uploadManager";

function peso(n: number) {
  return `${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

// Generalized from DOE's own "Upload Template" form - same shape
// (SBU picker, download/upload, active-batch view) reused by Commission, Cost
// of Sales, Depreciation & Amortization, and Interest Expense (see
// backend/src/routes/doeBatches.ts's createSbuBatchRouter and
// approvalChain.ts's SBU_BATCH_CATEGORIES - all five share this exact
// SBU template/upload/routing flow; Company only applies to Revenue, which
// has its own tab/router). Rows are real catalog Expense
// Line Items (not ad-hoc CC/GL rows) and, once submitted, fan out into the
// category's normal per-row review chain rather than traveling together -
// see doeBatches.ts's own comment. That's why there's no Review History
// section here: by the time a batch leaves DRAFT its rows are independently
// tracked BudgetRequests, already visible via My Requests/Inbox/Step5.
export function SbuBatchUploadTab({ category, apiPath, subtitle, forecast = false }: { category: RequestCategory; apiPath: string; subtitle: string; forecast?: boolean }) {
  const queryClient = useQueryClient();
  const { targetYear, forecastYear } = useFiscalYear();
  const FISCAL_YEAR = forecast ? forecastYear : targetYear;
  const [sbu, setSbu] = useState<Sbu | "">("");
  const { currentUser: authUser, hasRole: authHasRole } = useAuth();
  const mySfSbus = sfSbus(authUser, authHasRole("BUDGET_OFFICER"));
  const [error, setError] = useState<string | null>(null);
  const [submitErrors, setSubmitErrors] = useState<{ row: string; error: string }[]>([]);
  const [searchParams] = useSearchParams();
  const [activeBatchId, setActiveBatchId] = useState<string | null>(searchParams.get("batch"));

  const { data: activeBatch, refetch: refetchActive } = useQuery({
    queryKey: [apiPath, activeBatchId],
    queryFn: async () => (await api.get<DoeBatchDetail>(`/${apiPath}/${activeBatchId}`)).data,
    enabled: !!activeBatchId,
  });

  // Both uploads run through the shared uploadManager (see
  // lib/uploadManager.ts) instead of a local mutation, so progress and the
  // result toast survive navigating to a different page mid-upload - looked
  // up by slot so a rejected-rows list also survives switching tabs.
  const uploadTask = useUploadTaskBySlot(`${category}-upload`);
  function startBatchUpload(file: File) {
    const form = new FormData();
    form.append("file", file);
    form.append("sbu", sbu);
    form.append("fiscalYear", String(FISCAL_YEAR));
    startUpload<DoeBatchDetail>({
      label: `${category} bulk upload (${file.name})`,
      slot: `${category}-upload`,
      url: `/${apiPath}`,
      form,
      invalidateKeys: [[apiPath, "mine"]],
      onDone: (data) => setActiveBatchId(data.id),
    });
  }

  const overrideTask = useUploadTaskBySlot(`${category}-override`);
  function startOverrideUpload(file: File) {
    const form = new FormData();
    form.append("file", file);
    startUpload<DoeBatchDetail>({
      label: `${category} override file (${file.name})`,
      slot: `${category}-override`,
      url: `/${apiPath}/${activeBatchId}/upload`,
      form,
      invalidateKeys: [[apiPath, "mine"]],
      onDone: () => refetchActive(),
    });
  }

  const submitMutation = useMutation({
    mutationFn: async () => (await api.post<DoeBatchDetail & { submitErrors: { row: string; error: string }[] }>(`/${apiPath}/${activeBatchId}/submit`)).data,
    onSuccess: (data) => {
      setError(null);
      setSubmitErrors(data.submitErrors ?? []);
      refetchActive();
      queryClient.invalidateQueries({ queryKey: [apiPath, "mine"] });
      queryClient.invalidateQueries({ queryKey: ["my-requests"] });
    },
    onError: (err: any) => setError(err.response?.data?.error ?? "Failed to submit."),
  });

  const cancelMutation = useMutation({
    mutationFn: async () => (await api.post<DoeBatchDetail>(`/${apiPath}/${activeBatchId}/cancel`)).data,
    onSuccess: () => {
      refetchActive();
      queryClient.invalidateQueries({ queryKey: [apiPath, "mine"] });
    },
  });

  // Board-Approved figure for this category and the batch's SBU (latest history row wins).
  const { data: boardHistory = [] } = useQuery({
    queryKey: ["board-approved-budget", FISCAL_YEAR],
    queryFn: async () => (await api.get<{ history: { requestCategory: string; sbu: string | null; amount: number }[] }>(`/admin/board-approved-budget?fiscalYear=${FISCAL_YEAR}`)).data.history,
  });
  const boardApproved = activeBatch
    ? boardHistory.find((h) => h.requestCategory === category && h.sbu === activeBatch.sbu)?.amount ?? null
    : null;
  const canUpload = !!sbu;
  const isDraft = activeBatch?.currentStage === "DRAFT";
  const [frozenHeaderEl, setFrozenHeaderEl] = useState<HTMLDivElement | null>(null);
  const [frozenHeaderHeight, setFrozenHeaderHeight] = useState(0);
  useLayoutEffect(() => {
    if (frozenHeaderEl) setFrozenHeaderHeight(frozenHeaderEl.offsetHeight);
  });

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <div ref={setFrozenHeaderEl} className="sticky top-0 z-30 space-y-4 bg-slate-50 pb-3 pt-1">
        <PageHeader subtitle={subtitle} />
        <div className="grid grid-cols-2 gap-4 rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm shadow-sm">
          <div>
            <label className="block font-medium text-emerald-800">Originating Department</label>
            <div className="mt-1 rounded border border-emerald-200 bg-white px-2 py-1.5 text-emerald-950">{authUser?.department?.name}</div>
          </div>
          <div>
            <label className="block font-medium text-emerald-800">{forecast ? "Forecast Year" : "Target Calendar Year"}</label>
            <div className="mt-1 rounded border border-emerald-200 bg-white px-2 py-1.5 text-emerald-950">{FISCAL_YEAR}</div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
      <div className="space-y-4 lg:col-span-3">
      {!activeBatch && (
        <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
          <SectionLabel>Upload Template</SectionLabel>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="block text-sm font-medium text-slate-600">
                SBU <span className="text-red-500">*</span>
              </label>
              <select className="mt-1 w-full rounded border border-slate-300 px-2 py-1.5 text-sm" value={sbu} onChange={(e) => setSbu(e.target.value as Sbu)}>
                <option value="">— Select —</option>
                {SBU_OPTIONS.filter((o) => !mySfSbus || mySfSbus.includes(o.value)).map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-slate-100 pt-4">
            <button
              type="button"
              disabled={!sbu}
              onClick={() => downloadFile(`/budget-requests/sap-template-blank?requestCategory=${category}&sbu=${sbu}&fiscalYear=${FISCAL_YEAR}`, `SAP Upload Template - ${category}-${sbu} - ${FISCAL_YEAR}.xlsx`).catch(() => setError("Failed to download the template."))}
              className={`rounded-md border px-4 py-2 text-sm font-medium ${sbu ? "border-emerald-300 bg-emerald-50 text-emerald-800 hover:bg-emerald-100" : "cursor-not-allowed border-slate-200 text-slate-400"}`}
            >
              Open Template
            </button>
            <label className={`rounded-md border px-4 py-2 text-sm font-medium ${canUpload ? "cursor-pointer border-slate-300 text-slate-700 hover:bg-slate-100" : "cursor-not-allowed border-slate-200 text-slate-400"}`}>
              {uploadTask?.status === "uploading" ? `Uploading… ${uploadTask.progress}%` : "Upload Completed Template"}
              <input
                type="file"
                accept=".xlsx"
                className="hidden"
                disabled={!canUpload || uploadTask?.status === "uploading"}
                onChange={(e) => e.target.files?.[0] && startBatchUpload(e.target.files[0])}
              />
            </label>
          </div>
          {error && <div className="mt-3 rounded bg-red-50 p-2 text-sm text-red-700">{error}</div>}
          {uploadTask && uploadTask.status !== "uploading" && (
            <div className={`mt-3 rounded p-2 text-sm ${uploadTask.status === "success" ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"}`}>{uploadTask.message}</div>
          )}
        </div>
      )}

      {activeBatch && (
        <div className="space-y-4">
          <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <SectionLabel>
                  {activeBatch.sbu}
                  {activeBatch.company?.name ? ` · ${activeBatch.company.name}` : ""}
                </SectionLabel>
                <div className="text-sm text-slate-600">
                  {activeBatch.rowCount} request(s) · Total <span className="font-semibold text-emerald-700">{peso(activeBatch.totalAmount)}</span> ·{" "}
                  <StatusBadge stage={activeBatch.currentStage} />
                </div>
                <div className="mt-2 text-sm text-slate-600">
                  Board-Approved <span className="font-semibold text-slate-800">{boardApproved === null ? "not set" : peso(boardApproved)}</span>
                  {boardApproved !== null && (() => { const variance = boardApproved - activeBatch.totalAmount; return (<> · Variance <span className={`font-semibold ${variance < 0 ? "text-red-700" : "text-emerald-700"}`}>{variance < 0 ? `over by ${peso(-variance)}` : `under by ${peso(variance)}`}</span></>); })()}
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {isDraft && (
                  <>
                    <label className="cursor-pointer rounded-md border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100">
                      {overrideTask?.status === "uploading" ? `Uploading… ${overrideTask.progress}%` : "Override File"}
                      <input type="file" accept=".xlsx" className="hidden" disabled={overrideTask?.status === "uploading"} onChange={(e) => e.target.files?.[0] && startOverrideUpload(e.target.files[0])} />
                    </label>
                    <button onClick={() => submitMutation.mutate()} disabled={submitMutation.isPending} className="rounded-md bg-emerald-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-600 disabled:opacity-50">
                      Submit for Approval
                    </button>
                    <button onClick={() => cancelMutation.mutate()} disabled={cancelMutation.isPending} className="rounded-md border border-red-300 px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50">
                      Cancel
                    </button>
                  </>
                )}
                <button
                  onClick={() => {
                    setActiveBatchId(null);
                    setSubmitErrors([]);
                  }}
                  className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100"
                >
                  New Upload
                </button>
              </div>
            </div>
            {error && <div className="mt-3 rounded bg-red-50 p-2 text-sm text-red-700">{error}</div>}
            {activeBatch.validationErrors.length > 0 && (
              <div className="mt-3 rounded bg-amber-50 p-2 text-sm text-amber-800">
                {activeBatch.validationErrors.length} row(s) in the uploaded file were skipped:
                <ul className="ml-4 list-disc">
                  {activeBatch.validationErrors.map((e, i) => (
                    <li key={i}>
                      Row {e.row}: {e.error}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          {!isDraft && (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">
              Submitted — every request below is now tracked individually in <span className="font-semibold">My Requests</span>, going through the same review chain a manually-created request of this category would.
            </div>
          )}
          {submitErrors.length > 0 && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
              {submitErrors.length} request(s) need a supporting attachment before they can be submitted — find them by Budget Code in <span className="font-semibold">My Requests</span> and finish them individually:
              <ul className="ml-4 list-disc">
                {submitErrors.map((e, i) => (
                  <li key={i}>
                    {e.row}: {e.error}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white shadow-sm">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs text-slate-500">
                <tr>
                  <th className="px-3 py-2">Budget Code</th>
                  <th className="px-3 py-2">Cost Center</th>
                  <th className="px-3 py-2">GL Account</th>
                  <th className="px-3 py-2 text-right">Proposed Amount</th>
                  <th className="px-3 py-2">Stage</th>
                </tr>
              </thead>
              <tbody>
                {activeBatch.rows.map((r) => (
                  <tr key={r.id} className="border-t border-slate-100">
                    <td className="px-3 py-2">{r.budgetCode ?? "—"}</td>
                    <td className="px-3 py-2">{r.costCenter ?? "—"}</td>
                    <td className="px-3 py-2">{r.glAccount ?? "—"}</td>
                    <td className="px-3 py-2 text-right">{peso(r.proposedAmount)}</td>
                    <td className="px-3 py-2">
                      <StatusBadge stage={r.currentStage} />
                    </td>
                  </tr>
                ))}
                <tr className="border-t-2 border-emerald-200 bg-[#edf6f1] font-semibold text-[#164b33]">
                  <td colSpan={3} className="px-3 py-2">Total</td>
                  <td className="px-3 py-2 text-right">{peso(activeBatch.totalAmount)}</td>
                  <td />
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}
      </div>

      <div className="space-y-4 lg:col-span-2">
        <div className="space-y-2 rounded-lg border border-emerald-200 bg-emerald-50/60 p-4 text-sm shadow-sm lg:sticky" style={{ top: frozenHeaderHeight + 16 }}>
          <SectionLabel>Quick Guide</SectionLabel>
          <ol className="list-decimal space-y-1.5 pl-5 text-xs text-slate-700">
            <li>Choose the SBU.</li>
            <li>Download the template and fill in one row per Cost Center and GL Account, with the amount for each month.</li>
            <li>Upload the completed template. Once it's in, the batch shows below.</li>
            <li>Check the rows, then Submit for Approval. Use Override File to replace the upload while it's still a draft.</li>
            <li>Any rows that fail validation are listed with the reason.</li>
          </ol>
        </div>
      </div>
      </div>
    </div>
  );
}
