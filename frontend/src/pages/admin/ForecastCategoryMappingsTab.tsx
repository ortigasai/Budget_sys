import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type ForecastCategoryMapping, type RequestCategory } from "../../api/client";

const CATEGORY_OPTIONS: { value: RequestCategory; label: string }[] = [
  { value: "DOE", label: "Direct Operating Expenses (DOE)" },
  { value: "NPC", label: "Non-Project Capex (NPC)" },
  { value: "REVENUE", label: "Revenue" },
];

export function ForecastCategoryMappingsTab() {
  const queryClient = useQueryClient();
  const { data: mappings = [] } = useQuery({
    queryKey: ["forecast-category-mappings"],
    queryFn: async () => (await api.get<ForecastCategoryMapping[]>("/admin/forecast-category-mappings")).data,
  });
  const [glAccount, setGlAccount] = useState("");
  const [costCenter, setCostCenter] = useState("");
  const [category, setCategory] = useState<RequestCategory>("DOE");

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["forecast-category-mappings"] });

  const createMutation = useMutation({
    mutationFn: async () => (await api.post("/admin/forecast-category-mappings", { glAccount, costCenter, category })).data,
    onSuccess: () => {
      invalidate();
      setGlAccount("");
      setCostCenter("");
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => (await api.delete(`/admin/forecast-category-mappings/${id}`)).data,
    onSuccess: invalidate,
  });

  return (
    <div className="space-y-6">
      <p className="rounded-lg border border-blue-100 bg-blue-50 p-3 text-sm text-blue-800">
        Classifies each Forecast row into the GAE/DOE/NPC/Revenue sub-menu by its GL account and Cost Center. Any
        row whose GL-CC isn't listed here defaults to GAE, so only DOE/NPC/Revenue pairs need to be added.
      </p>
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 bg-white p-3 text-sm shadow-sm">
        <input className="w-32 rounded border border-slate-300 px-2 py-1" placeholder="GL account" value={glAccount} onChange={(e) => setGlAccount(e.target.value)} />
        <input className="w-32 rounded border border-slate-300 px-2 py-1" placeholder="Cost Center" value={costCenter} onChange={(e) => setCostCenter(e.target.value)} />
        <select className="rounded border border-slate-300 px-2 py-1" value={category} onChange={(e) => setCategory(e.target.value as RequestCategory)}>
          {CATEGORY_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <button
          onClick={() => createMutation.mutate()}
          disabled={!glAccount || !costCenter}
          className="rounded-md bg-emerald-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-600 disabled:opacity-50"
        >
          Add
        </button>
      </div>
      <ul className="divide-y divide-slate-100 overflow-hidden rounded-lg border border-slate-200 bg-white text-sm shadow-sm">
        {mappings.length === 0 && <li className="px-3 py-2 text-slate-400">None configured yet — everything defaults to GAE.</li>}
        {mappings.map((m) => (
          <li key={m.id} className="flex items-center justify-between px-3 py-2">
            <span>
              <span className="font-mono text-xs text-emerald-700">
                {m.glAccount} / {m.costCenter}
              </span>
              <span className="ml-2 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">{m.category}</span>
            </span>
            <button onClick={() => deleteMutation.mutate(m.id)} className="rounded-full px-2 py-0.5 text-xs font-medium text-red-600 hover:bg-red-50">
              Remove
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
