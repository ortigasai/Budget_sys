import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type ExpenseLineItem } from "../../api/client";

export function ExpenseLineItemsTab() {
  const queryClient = useQueryClient();
  const { data: items = [] } = useQuery({
    queryKey: ["expense-line-items"],
    queryFn: async () => (await api.get<ExpenseLineItem[]>("/admin/expense-line-items")).data,
  });
  const { data: pending = [] } = useQuery({
    queryKey: ["expense-line-items", "pending-refinement"],
    queryFn: async () => (await api.get<ExpenseLineItem[]>("/admin/expense-line-items/pending-refinement")).data,
  });

  const [refineForm, setRefineForm] = useState<Record<string, { name: string; glAccount: string; costCenter: string }>>({});

  const refineMutation = useMutation({
    mutationFn: async (id: string) => (await api.post(`/admin/expense-line-items/${id}/refine`, refineForm[id])).data,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["expense-line-items"] });
      queryClient.invalidateQueries({ queryKey: ["expense-line-items", "pending-refinement"] });
    },
  });

  const removeMutation = useMutation({
    mutationFn: async (id: string) => (await api.delete(`/admin/expense-line-items/${id}`)).data,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["expense-line-items"] }),
    onError: (err: any) => {
      setUploadStatus({ ok: false, message: err.response?.data?.error ?? "Failed to remove line item." });
    },
  });

  const [uploadStatus, setUploadStatus] = useState<{ ok: boolean; message: string } | null>(null);
  const uploadMutation = useMutation({
    mutationFn: async (file: File) => {
      const form = new FormData();
      form.append("file", file);
      try {
        return (await api.post("/admin/expense-line-items/template-upload", form)).data;
      } catch (err: any) {
        if (err.response?.status === 400 && err.response.data?.errors) return err.response.data;
        throw err;
      }
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["expense-line-items"] });
      if (data.ok === false) {
        setUploadStatus({ ok: false, message: data.errors.join("") });
        return;
      }
      const migrated = data.migratedRequests.length > 0 ? ` ${data.migratedRequests.length} row(s) re-mapped (category changed): ${data.migratedRequests.map((s: any) => s.name).join(",")}.` : "";
      const skipped = data.skippedRemovals.length > 0 ? ` ${data.skippedRemovals.length} kept (in use): ${data.skippedRemovals.map((s: any) => s.name).join(",")}.` : "";
      setUploadStatus({
        ok: true,
        message: `Catalog updated: ${data.created} added, ${data.updated} updated, ${data.removed} removed.${migrated}${skipped}`,
      });
    },
  });

  return (
    <div className="space-y-6">
      {pending.length > 0 && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-4">
          <h2 className="mb-2 text-sm font-semibold text-amber-800">Custom Expense Submissions Awaiting Refinement (FR-1.14)</h2>
          <div className="space-y-3">
            {pending.map((item) => {
              const state = refineForm[item.id] ?? { name: item.name, glAccount: "", costCenter: "" };
              return (
                <div key={item.id} className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="italic text-slate-600">"{item.name}"</span>
                  <input placeholder="Standardized name" className="rounded border border-slate-300 px-2 py-1" value={state.name} onChange={(e) => setRefineForm({ ...refineForm, [item.id]: { ...state, name: e.target.value } })} />
                  <input placeholder="GL Account" className="w-28 rounded border border-slate-300 px-2 py-1" value={state.glAccount} onChange={(e) => setRefineForm({ ...refineForm, [item.id]: { ...state, glAccount: e.target.value } })} />
                  <input placeholder="Cost Center" className="w-28 rounded border border-slate-300 px-2 py-1" value={state.costCenter} onChange={(e) => setRefineForm({ ...refineForm, [item.id]: { ...state, costCenter: e.target.value } })} />
                  <button onClick={() => refineMutation.mutate(item.id)} disabled={!state.glAccount || !state.costCenter} className="rounded bg-emerald-700 px-3 py-1 text-xs font-medium text-white hover:bg-emerald-600 disabled:opacity-50">
                    Assign &amp; Standardize
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <div className="text-sm">
          <div className="font-semibold text-slate-700">Upload Template</div>
          <div className="text-xs text-slate-500">Overrides the standard catalog with the uploaded file — added/changed rows are applied, and existing rows missing from the file are removed (unless a request already references them).</div>
        </div>
        <label className="cursor-pointer rounded bg-emerald-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-600">
          {uploadMutation.isPending ? "Uploading…" : "Upload Template (.xlsx)"}
          <input
            type="file"
            accept=".xlsx"
            className="hidden"
            disabled={uploadMutation.isPending}
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (!file) return;
              if (!window.confirm(`This will override the standard catalog with"${file.name}". Continue?`)) return;
              setUploadStatus(null);
              uploadMutation.mutate(file);
            }}
          />
        </label>
        {uploadStatus && <div className={`text-xs leading-snug ${uploadStatus.ok ? "text-emerald-700" : "text-red-600"}`}>{uploadStatus.message}</div>}
      </div>

      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead className="bg-emerald-50 text-left text-xs tracking-wide text-emerald-800">
            <tr>
              <th className="whitespace-nowrap px-3 py-2">Budget Code</th>
              <th className="whitespace-nowrap px-3 py-2">Expense Category</th>
              <th className="whitespace-nowrap px-3 py-2">Expense Line Item</th>
              <th className="whitespace-nowrap px-3 py-2">Company</th>
              <th className="whitespace-nowrap px-3 py-2">Description</th>
              <th className="whitespace-nowrap px-3 py-2">Centralized Department</th>
              <th className="whitespace-nowrap px-3 py-2">Cost Center (CC)</th>
              <th className="whitespace-nowrap px-3 py-2">GL Account (GL)</th>
              <th className="whitespace-nowrap px-3 py-2">Additional Field</th>
              <th className="whitespace-nowrap px-3 py-2">Spend Grid Computation</th>
              <th className="whitespace-nowrap px-3 py-2">Spend Grid Frequency</th>
              <th className="whitespace-nowrap px-3 py-2">Sample Charges</th>
              <th className="whitespace-nowrap px-3 py-2">Visible Only To</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id} className="border-t border-slate-100">
                <td className="px-3 py-2 font-mono text-xs text-emerald-700">{item.budgetCode ?? "—"}</td>
                <td className="px-3 py-2">{item.category}</td>
                <td className="px-3 py-2">{item.name}</td>
                <td className="px-3 py-2">{item.company?.code ?? "—"}</td>
                <td className="px-3 py-2 text-slate-500">{item.description ?? "—"}</td>
                <td className="px-3 py-2">{item.ownerDepartment?.name ?? "—"}</td>
                <td className="px-3 py-2">{item.costCenter}</td>
                <td className="px-3 py-2">{item.glAccount}</td>
                <td className="px-3 py-2 text-slate-500">{item.extraFieldsConfig.length > 0 ? item.extraFieldsConfig.map((f) => `${f.label}${f.required ? "*" : ""}`).join(",") : "—"}</td>
                <td className="px-3 py-2 text-slate-500">{item.spendGridComputation ?? "—"}</td>
                <td className="px-3 py-2 text-slate-500">{item.spendGridFrequency ?? "—"}</td>
                <td className="px-3 py-2 text-slate-500">{item.sampleCharges ?? "—"}</td>
                <td className="px-3 py-2 text-slate-500">{item.visibleToDepartment?.name ?? "Everyone"}</td>
                <td className="px-3 py-2 text-right">
                  <button
                    onClick={() => {
                      if (window.confirm(`Remove"${item.name}"?`)) removeMutation.mutate(item.id);
                    }}
                    disabled={removeMutation.isPending}
                    className="rounded bg-red-50 px-2 py-1 text-xs font-medium text-red-600 hover:bg-red-100 disabled:opacity-50"
                  >
                    Remove
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
