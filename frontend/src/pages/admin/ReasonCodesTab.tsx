import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../api/client";

interface ReasonCode {
  id: string;
  label: string;
}

export function ReasonCodesTab() {
  const queryClient = useQueryClient();
  const { data: codes = [] } = useQuery({
    queryKey: ["reason-codes"],
    queryFn: async () => (await api.get<ReasonCode[]>("/admin/reason-codes")).data,
  });
  const [label, setLabel] = useState("");

  const createMutation = useMutation({
    mutationFn: async () => (await api.post("/admin/reason-codes", { label })).data,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["reason-codes"] });
      setLabel("");
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => (await api.delete(`/admin/reason-codes/${id}`)).data,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["reason-codes"] }),
  });

  return (
    <div className="space-y-4">
      <p className="rounded-lg border border-blue-100 bg-blue-50 p-3 text-sm text-blue-800">
        Standardized reasons the Budget Officer can select when returning a request at Step 5 (FR-1.31).
      </p>
      <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white p-3 text-sm shadow-sm">
        <input
          className="flex-1 rounded border border-slate-300 px-2 py-1"
          placeholder="New reason code label"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
        />
        <button
          onClick={() => createMutation.mutate()}
          disabled={!label}
          className="rounded-md bg-emerald-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-600 disabled:opacity-50"
        >
          Add
        </button>
      </div>
      <ul className="divide-y divide-slate-100 overflow-hidden rounded-lg border border-slate-200 bg-white text-sm shadow-sm">
        {codes.map((c) => (
          <li key={c.id} className="flex items-center justify-between px-3 py-2">
            {c.label}
            <button
              onClick={() => deleteMutation.mutate(c.id)}
              className="rounded-full px-2 py-0.5 text-xs font-medium text-red-600 hover:bg-red-50"
            >
              Deactivate
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
