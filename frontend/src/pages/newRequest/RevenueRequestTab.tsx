import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, SBU_OPTIONS, type Company, type RevenueBatchDetail, type RevenueBatchSummary, type Sbu } from "../../api/client";
import { PageHeader } from "../../components/PageHeader";
import { SectionLabel } from "../../components/TabBar";
import { useFiscalYear } from "../../lib/fiscalCycle";

interface BoardBudgetRow {
  id: string;
  fiscalYear: number;
  amount: number;
  requestCategory: string;
  sbu: Sbu | null;
  setAt: string;
}

const STAGE_LABELS: Record<string, string> = {
  DRAFT: "Draft",
  REVENUE_BU_FINANCE_OFFICER_REVIEW: "BU Finance Officer Review",
  REVENUE_BU_FINANCE_HEAD_REVIEW: "BU Finance Head Review",
  REVENUE_BUDGET_OFFICER_REVIEW: "Budget Officer Review",
  REVENUE_BCA_HEAD_REVIEW: "BC&A Head Review",
  APPROVED: "Approved",
  CANCELLED: "Cancelled",
  RETURNED_TO_REQUESTOR: "Returned",
};

function peso(n: number) {
  return `₱${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

// Spec item 16 - Revenue's own New Request form: no expense line item picker
// or spend grid (that's per-CC-GL data inside the uploaded template
// instead) - just SBU/Company plus the upload widget. Everything else
// (parsing, the Board-Approved Budget tie-out check, batch creation) happens
// server-side - see backend/src/routes/revenueBatches.ts.
export function RevenueRequestTab({ subtitle }: { subtitle: string }) {
  const queryClient = useQueryClient();
  const { targetYear: FISCAL_YEAR } = useFiscalYear();
  const [sbu, setSbu] = useState<Sbu | "">("");
  const [companyId, setCompanyId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [activeBatchId, setActiveBatchId] = useState<string | null>(null);

  const { data: companies = [] } = useQuery({
    queryKey: ["companies"],
    queryFn: async () => (await api.get<Company[]>("/admin/companies")).data,
  });
  const { data: boardBudget } = useQuery({
    queryKey: ["board-approved-budget", FISCAL_YEAR],
    queryFn: async () => (await api.get<{ history: BoardBudgetRow[] }>(`/admin/board-approved-budget?fiscalYear=${FISCAL_YEAR}`)).data,
  });
  const boardAmountForSbu = sbu ? boardBudget?.history.find((h) => h.requestCategory === "REVENUE" && h.sbu === sbu)?.amount : undefined;

  const { data: myBatches = [] } = useQuery({
    queryKey: ["revenue-batches", "mine"],
    queryFn: async () => (await api.get<RevenueBatchSummary[]>("/revenue-batches/mine")).data,
  });

  const { data: activeBatch, refetch: refetchActive } = useQuery({
    queryKey: ["revenue-batches", activeBatchId],
    queryFn: async () => (await api.get<RevenueBatchDetail>(`/revenue-batches/${activeBatchId}`)).data,
    enabled: !!activeBatchId,
  });

  const uploadMutation = useMutation({
    mutationFn: async (file: File) => {
      const form = new FormData();
      form.append("file", file);
      form.append("sbu", sbu);
      form.append("companyId", companyId);
      form.append("fiscalYear", String(FISCAL_YEAR));
      return (await api.post<RevenueBatchDetail>("/revenue-batches", form)).data;
    },
    onSuccess: (data) => {
      setActiveBatchId(data.id);
      setError(null);
      queryClient.invalidateQueries({ queryKey: ["revenue-batches", "mine"] });
    },
    onError: (err: any) => setError(err.response?.data?.error ?? "Failed to upload the template."),
  });

  const overrideMutation = useMutation({
    mutationFn: async (file: File) => {
      const form = new FormData();
      form.append("file", file);
      return (await api.post<RevenueBatchDetail>(`/revenue-batches/${activeBatchId}/upload`, form)).data;
    },
    onSuccess: () => {
      setError(null);
      refetchActive();
      queryClient.invalidateQueries({ queryKey: ["revenue-batches", "mine"] });
    },
    onError: (err: any) => setError(err.response?.data?.error ?? "Failed to override the template."),
  });

  const submitMutation = useMutation({
    mutationFn: async () => (await api.post<RevenueBatchDetail>(`/revenue-batches/${activeBatchId}/submit`)).data,
    onSuccess: () => {
      setError(null);
      refetchActive();
      queryClient.invalidateQueries({ queryKey: ["revenue-batches", "mine"] });
    },
    onError: (err: any) => setError(err.response?.data?.error ?? "Failed to submit."),
  });

  const cancelMutation = useMutation({
    mutationFn: async (batchId: string) => (await api.post<RevenueBatchDetail>(`/revenue-batches/${batchId}/cancel`)).data,
    onSuccess: (data) => {
      if (data.id === activeBatchId) refetchActive();
      queryClient.invalidateQueries({ queryKey: ["revenue-batches", "mine"] });
    },
  });

  const canUpload = !!sbu && !!companyId;
  const isDraft = activeBatch?.currentStage === "DRAFT";

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <PageHeader subtitle={subtitle} />

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
                {SBU_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
              {sbu && (
                <div className="mt-1 text-xs text-slate-500">
                  {boardAmountForSbu !== undefined ? (
                    <>
                      {FISCAL_YEAR} Board-Approved Budget: <span className="font-semibold text-emerald-700">{peso(boardAmountForSbu)}</span> — your template's grand total (cell O1) must tie up with this figure.
                    </>
                  ) : (
                    <span className="text-red-600">The Budget Officer hasn't set the {FISCAL_YEAR} Board-Approved Budget for this SBU yet — uploads will be rejected until they do.</span>
                  )}
                </div>
              )}
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-600">
                Company <span className="text-red-500">*</span>
              </label>
              <select className="mt-1 w-full rounded border border-slate-300 px-2 py-1.5 text-sm" value={companyId} onChange={(e) => setCompanyId(e.target.value)}>
                <option value="">— Select —</option>
                {companies.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-slate-100 pt-4">
            <a href="/api/revenue-batches/template" className="rounded-md border border-emerald-300 bg-emerald-50 px-4 py-2 text-sm font-medium text-emerald-800 hover:bg-emerald-100">
              Download Template (.xlsx)
            </a>
            <label className={`rounded-md border px-4 py-2 text-sm font-medium ${canUpload ? "cursor-pointer border-slate-300 text-slate-700 hover:bg-slate-100" : "cursor-not-allowed border-slate-200 text-slate-400"}`}>
              {uploadMutation.isPending ? "Uploading…" : "Upload Completed Template"}
              <input
                type="file"
                accept=".xlsx"
                className="hidden"
                disabled={!canUpload || uploadMutation.isPending}
                onChange={(e) => e.target.files?.[0] && uploadMutation.mutate(e.target.files[0])}
              />
            </label>
          </div>
          {error && <div className="mt-3 rounded bg-red-50 p-2 text-sm text-red-700">{error}</div>}
        </div>
      )}

      {activeBatch && (
        <div className="space-y-4">
          <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <SectionLabel>{activeBatch.sbu} · {activeBatch.company?.name}</SectionLabel>
                <div className="text-sm text-slate-600">
                  {activeBatch.rowCount} CC-GL row(s) · Total <span className="font-semibold text-emerald-700">{peso(activeBatch.totalAmount)}</span> · Stage: <span className="font-medium">{STAGE_LABELS[activeBatch.currentStage] ?? activeBatch.currentStage}</span>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {isDraft && (
                  <>
                    <label className="cursor-pointer rounded-md border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100">
                      {overrideMutation.isPending ? "Uploading…" : "Override File"}
                      <input type="file" accept=".xlsx" className="hidden" disabled={overrideMutation.isPending} onChange={(e) => e.target.files?.[0] && overrideMutation.mutate(e.target.files[0])} />
                    </label>
                    <button onClick={() => submitMutation.mutate()} disabled={submitMutation.isPending} className="rounded-md bg-emerald-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-600 disabled:opacity-50">
                      Submit for Approval
                    </button>
                    <button onClick={() => cancelMutation.mutate(activeBatch.id)} disabled={cancelMutation.isPending} className="rounded-md border border-red-300 px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50">
                      Cancel
                    </button>
                  </>
                )}
                <button onClick={() => setActiveBatchId(null)} className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100">
                  New Upload
                </button>
              </div>
            </div>
            {error && <div className="mt-3 rounded bg-red-50 p-2 text-sm text-red-700">{error}</div>}
          </div>

          <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white shadow-sm">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs text-slate-500">
                <tr>
                  <th className="px-3 py-2">CC</th>
                  <th className="px-3 py-2">GL</th>
                  <th className="px-3 py-2 text-right">Total</th>
                </tr>
              </thead>
              <tbody>
                {activeBatch.rows.map((r) => (
                  <tr key={r.id} className="border-t border-slate-100">
                    <td className="px-3 py-2">{r.costCenter}</td>
                    <td className="px-3 py-2">{r.glAccount}</td>
                    <td className="px-3 py-2 text-right">{peso(r.proposedAmount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {activeBatch.reviewDecisions.length > 0 && (
            <div className="rounded-lg border border-slate-200 bg-white p-4 text-sm shadow-sm">
              <SectionLabel>Review History</SectionLabel>
              <ul className="space-y-2">
                {activeBatch.reviewDecisions.map((d) => (
                  <li key={d.id} className="border-l-2 border-emerald-200 pl-3">
                    <div className="font-medium">
                      {d.decision} at {STAGE_LABELS[d.stage] ?? d.stage} — {d.decidedByName}
                    </div>
                    <div className="text-xs text-slate-500">{new Date(d.timestamp).toLocaleString()}</div>
                    {d.comment && <div className="text-slate-600">{d.comment}</div>}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      <div className="rounded-lg border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-100 px-4 py-2 text-xs font-semibold tracking-wide text-emerald-800">My Revenue Requests</div>
        {myBatches.length === 0 ? (
          <div className="px-4 py-6 text-center text-sm text-slate-400">None yet.</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs text-slate-500">
              <tr>
                <th className="px-3 py-2">SBU</th>
                <th className="px-3 py-2">Company</th>
                <th className="px-3 py-2 text-right">Total</th>
                <th className="px-3 py-2">Stage</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {myBatches.map((b, i) => (
                <tr key={b.id} className={`border-t border-slate-100 ${i % 2 === 1 ? "bg-slate-50/60" : ""}`}>
                  <td className="px-3 py-2">{b.sbu}</td>
                  <td className="px-3 py-2">{b.company?.name}</td>
                  <td className="px-3 py-2 text-right">{peso(b.totalAmount)}</td>
                  <td className="px-3 py-2">{STAGE_LABELS[b.currentStage] ?? b.currentStage}</td>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2">
                      <button onClick={() => setActiveBatchId(b.id)} className="text-xs font-medium text-emerald-700 hover:underline">
                        View
                      </button>
                      {b.currentStage === "DRAFT" && (
                        <button onClick={() => cancelMutation.mutate(b.id)} className="text-xs font-medium text-red-600 hover:underline">
                          Cancel
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
