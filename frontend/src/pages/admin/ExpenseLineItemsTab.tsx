import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type Company, type Department, type ExpenseLineItem, type ExtraField } from "../../api/client";

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
  const { data: departments = [] } = useQuery({
    queryKey: ["departments"],
    queryFn: async () => (await api.get<Department[]>("/admin/departments")).data,
  });
  const { data: companies = [] } = useQuery({
    queryKey: ["companies"],
    queryFn: async () => (await api.get<Company[]>("/admin/companies")).data,
  });
  const centralizedDepts = departments.filter((d) => d.type === "CENTRALIZED");

  const [form, setForm] = useState({
    name: "",
    category: "",
    glAccount: "",
    costCenter: "",
    ownerDepartmentId: "",
    companyId: "",
    sampleCharges: "",
  });

  // A single customizable "Additional Required Field" builder — matches the
  // real catalog's one-field-per-item shape (see importExpenseLineItems.ts).
  const [extraField, setExtraField] = useState({
    label: "",
    type: "TEXT" as ExtraField["type"],
    required: true,
    options: "", // comma-separated, DROPDOWN only
  });

  const createMutation = useMutation({
    mutationFn: async () => {
      const extraFieldsConfig: ExtraField[] =
        extraField.label.trim().length > 0
          ? [
              {
                label: extraField.label,
                required: extraField.required,
                type: extraField.type,
                options:
                  extraField.type === "DROPDOWN"
                    ? extraField.options.split(",").map((o) => ({ label: o.trim(), value: null })).filter((o) => o.label)
                    : undefined,
              },
            ]
          : [];
      return (
        await api.post("/admin/expense-line-items", {
          name: form.name,
          category: form.category || undefined,
          glAccount: form.glAccount,
          costCenter: form.costCenter,
          ownerDepartmentId: form.ownerDepartmentId,
          companyId: form.companyId || null,
          sampleCharges: form.sampleCharges || null,
          extraFieldsConfig,
        })
      ).data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["expense-line-items"] });
      setForm({ name: "", category: "", glAccount: "", costCenter: "", ownerDepartmentId: "", companyId: "", sampleCharges: "" });
      setExtraField({ label: "", type: "TEXT", required: true, options: "" });
    },
  });

  const [refineForm, setRefineForm] = useState<Record<string, { name: string; glAccount: string; costCenter: string }>>(
    {}
  );

  const refineMutation = useMutation({
    mutationFn: async (id: string) => (await api.post(`/admin/expense-line-items/${id}/refine`, refineForm[id])).data,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["expense-line-items"] });
      queryClient.invalidateQueries({ queryKey: ["expense-line-items", "pending-refinement"] });
    },
  });

  return (
    <div className="space-y-6">
      {pending.length > 0 && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-4">
          <h2 className="mb-2 text-sm font-semibold text-amber-800">
            Custom Expense Submissions Awaiting Refinement (FR-1.14)
          </h2>
          <div className="space-y-3">
            {pending.map((item) => {
              const state = refineForm[item.id] ?? { name: item.name, glAccount: "", costCenter: "" };
              return (
                <div key={item.id} className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="italic text-slate-600">"{item.name}"</span>
                  <input
                    placeholder="Standardized name"
                    className="rounded border border-slate-300 px-2 py-1"
                    value={state.name}
                    onChange={(e) => setRefineForm({ ...refineForm, [item.id]: { ...state, name: e.target.value } })}
                  />
                  <input
                    placeholder="GL Account"
                    className="w-28 rounded border border-slate-300 px-2 py-1"
                    value={state.glAccount}
                    onChange={(e) =>
                      setRefineForm({ ...refineForm, [item.id]: { ...state, glAccount: e.target.value } })
                    }
                  />
                  <input
                    placeholder="Cost Center"
                    className="w-28 rounded border border-slate-300 px-2 py-1"
                    value={state.costCenter}
                    onChange={(e) =>
                      setRefineForm({ ...refineForm, [item.id]: { ...state, costCenter: e.target.value } })
                    }
                  />
                  <button
                    onClick={() => refineMutation.mutate(item.id)}
                    disabled={!state.glAccount || !state.costCenter}
                    className="rounded bg-emerald-700 px-3 py-1 text-xs font-medium text-white hover:bg-emerald-600 disabled:opacity-50"
                  >
                    Assign &amp; Standardize
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div>
        <h2 className="mb-2 text-sm font-semibold text-slate-700">Add Standard Expense Line Item</h2>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <input
            placeholder="Name"
            className="rounded border border-slate-300 px-2 py-1"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
          />
          <input
            placeholder="Expense Category"
            className="rounded border border-slate-300 px-2 py-1"
            value={form.category}
            onChange={(e) => setForm({ ...form, category: e.target.value })}
          />
          <input
            placeholder="GL Account"
            className="w-28 rounded border border-slate-300 px-2 py-1"
            value={form.glAccount}
            onChange={(e) => setForm({ ...form, glAccount: e.target.value })}
          />
          <input
            placeholder="Cost Center"
            className="w-28 rounded border border-slate-300 px-2 py-1"
            value={form.costCenter}
            onChange={(e) => setForm({ ...form, costCenter: e.target.value })}
          />
          <select
            className="rounded border border-slate-300 px-2 py-1"
            value={form.ownerDepartmentId}
            onChange={(e) => setForm({ ...form, ownerDepartmentId: e.target.value })}
          >
            <option value="">— Owning department —</option>
            {centralizedDepts.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
          <select
            className="rounded border border-slate-300 px-2 py-1"
            value={form.companyId}
            onChange={(e) => setForm({ ...form, companyId: e.target.value })}
          >
            <option value="">— Company (optional) —</option>
            {companies.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <input
            placeholder="Sample charges (e.g. plates, air fryer)"
            className="w-56 rounded border border-slate-300 px-2 py-1"
            value={form.sampleCharges}
            onChange={(e) => setForm({ ...form, sampleCharges: e.target.value })}
          />
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
          <span className="text-xs font-medium text-slate-500">Additional Required Field:</span>
          <input
            placeholder="Field label (e.g. Headcount)"
            className="rounded border border-slate-300 px-2 py-1"
            value={extraField.label}
            onChange={(e) => setExtraField({ ...extraField, label: e.target.value })}
          />
          <select
            className="rounded border border-slate-300 px-2 py-1"
            value={extraField.type}
            onChange={(e) => setExtraField({ ...extraField, type: e.target.value as ExtraField["type"] })}
          >
            <option value="TEXT">Text</option>
            <option value="NUMBER">Number</option>
            <option value="DROPDOWN">Dropdown</option>
          </select>
          {extraField.type === "DROPDOWN" && (
            <input
              placeholder="Options (comma-separated)"
              className="w-56 rounded border border-slate-300 px-2 py-1"
              value={extraField.options}
              onChange={(e) => setExtraField({ ...extraField, options: e.target.value })}
            />
          )}
          <label className="flex items-center gap-1 text-xs">
            <input
              type="checkbox"
              checked={extraField.required}
              onChange={(e) => setExtraField({ ...extraField, required: e.target.checked })}
            />
            Required
          </label>
          <button
            onClick={() => createMutation.mutate()}
            disabled={!form.name || !form.glAccount || !form.costCenter || !form.ownerDepartmentId}
            className="rounded bg-emerald-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-600 disabled:opacity-50"
          >
            Add
          </button>
        </div>
      </div>

      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead className="bg-emerald-50 text-left text-xs uppercase tracking-wide text-emerald-800">
            <tr>
              <th className="px-3 py-2">Name</th>
              <th className="px-3 py-2">Category</th>
              <th className="px-3 py-2">Company</th>
              <th className="px-3 py-2">GL Account</th>
              <th className="px-3 py-2">Cost Center</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id} className="border-t border-slate-100">
                <td className="px-3 py-2">{item.name}</td>
                <td className="px-3 py-2">{item.category}</td>
                <td className="px-3 py-2">{item.company?.code ?? "—"}</td>
                <td className="px-3 py-2">{item.glAccount}</td>
                <td className="px-3 py-2">{item.costCenter}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
