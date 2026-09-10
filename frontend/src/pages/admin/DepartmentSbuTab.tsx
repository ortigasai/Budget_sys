import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, NPC_SBU_OPTIONS, type Department, type NpcSbu } from "../../api/client";

// Spec item 13: assigns each Department to one of NPC's 8 SBUs, so Budget
// Utilization Tracking's NPC view can scope a non-Budget-Officer user's
// visibility to their own department's SBU (see DepartmentOut/npc_utilization
// in backend-py's routers/utilization.py).
export function DepartmentSbuTab() {
  const queryClient = useQueryClient();
  const { data: departments = [] } = useQuery({
    queryKey: ["admin-departments"],
    queryFn: async () => (await api.get<Department[]>("/admin/departments")).data,
  });
  const [search, setSearch] = useState("");

  const updateMutation = useMutation({
    mutationFn: async ({ id, sbu }: { id: string; sbu: NpcSbu | null }) => (await api.patch<Department>(`/admin/departments/${id}`, { sbu })).data,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["admin-departments"] }),
  });

  const filtered = departments.filter((d) => d.name.toLowerCase().includes(search.toLowerCase()));

  return (
    <div className="space-y-4">
      <p className="rounded-lg border border-blue-100 bg-blue-50 p-3 text-sm text-blue-800">
        A department's SBU determines which NPC budget codes its users can see in Budget Utilization Tracking (Phase 2's NPC view). Departments with no SBU set are excluded from that view.
      </p>
      <input className="w-64 rounded border border-slate-300 px-2 py-1.5 text-sm" placeholder="Search departments…" value={search} onChange={(e) => setSearch(e.target.value)} />
      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs text-slate-500">
            <tr>
              <th className="px-3 py-2">Department</th>
              <th className="px-3 py-2">Type</th>
              <th className="px-3 py-2">SBU</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((d, i) => (
              <tr key={d.id} className={`border-t border-slate-100 ${i % 2 === 1 ? "bg-slate-50/60" : ""}`}>
                <td className="px-3 py-2">{d.name}</td>
                <td className="px-3 py-2 text-xs text-slate-500">{d.type}</td>
                <td className="px-3 py-2">
                  <select
                    className="rounded border border-slate-300 px-2 py-1 text-sm"
                    value={d.sbu ?? ""}
                    disabled={updateMutation.isPending}
                    onChange={(e) => updateMutation.mutate({ id: d.id, sbu: (e.target.value || null) as NpcSbu | null })}
                  >
                    <option value="">— None —</option>
                    {NPC_SBU_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
