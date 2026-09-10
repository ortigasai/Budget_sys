import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, api2, type DemoUser, type ReportAccessGrant } from "../../api/client";
import { SearchableSelect } from "../../components/SearchableSelect";

// Spec FR-4.5/4.6: reports default to Budget-Officer-only; this tab is
// where the Budget Officer grants individual users access. Calls api2 (this
// is backend-py-owned data), same as SBU Roles/IO Locations/CC-GL Codes.
export function ReportAccessTab() {
  const queryClient = useQueryClient();
  const { data: grants = [] } = useQuery({
    queryKey: ["reports", "access"],
    queryFn: async () => (await api2.get<ReportAccessGrant[]>("/reports/access")).data,
  });
  const { data: users = [] } = useQuery({
    queryKey: ["auth", "users"],
    queryFn: async () => (await api.get<DemoUser[]>("/auth/users")).data,
  });

  const [userId, setUserId] = useState("");

  const grantMutation = useMutation({
    mutationFn: async () => (await api2.post("/reports/access", { userId })).data,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["reports", "access"] });
      setUserId("");
    },
  });

  const revokeMutation = useMutation({
    mutationFn: async (id: number) => (await api2.delete(`/reports/access/${id}`)).data,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["reports", "access"] }),
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-2 text-sm">
        <div className="w-64">
          <label className="mb-1 block text-xs font-medium text-slate-500">Grant access to</label>
          <SearchableSelect placeholder="Search employees…" options={users.map((u) => ({ value: u.id, label: u.name, sublabel: u.email }))} value={userId} onChange={setUserId} />
        </div>
        <button onClick={() => grantMutation.mutate()} disabled={!userId || grantMutation.isPending} className="rounded bg-emerald-700 px-3 py-2 text-xs font-medium text-white hover:bg-emerald-600 disabled:opacity-50">
          Grant Access
        </button>
      </div>
      {grantMutation.isError && <div className="text-xs text-red-600">{(grantMutation.error as any)?.response?.data?.detail ?? "Could not grant access."}</div>}

      <table className="w-full overflow-hidden rounded-lg border border-slate-200 bg-white text-sm">
        <thead className="bg-emerald-50 text-left text-xs tracking-wide text-emerald-800">
          <tr>
            <th className="px-3 py-2">User</th>
            <th className="px-3 py-2">Email</th>
            <th className="px-3 py-2">Granted</th>
            <th className="px-3 py-2" />
          </tr>
        </thead>
        <tbody>
          {grants.length === 0 ? (
            <tr>
              <td colSpan={4} className="px-3 py-6 text-center text-slate-400">
                No one has been individually granted access yet — the Budget Officer always has access.
              </td>
            </tr>
          ) : (
            grants.map((g) => (
              <tr key={g.id} className="border-t border-slate-100">
                <td className="px-3 py-2">{g.userName}</td>
                <td className="px-3 py-2 text-slate-500">{g.userEmail}</td>
                <td className="px-3 py-2 text-slate-500">{new Date(g.createdAt).toLocaleDateString()}</td>
                <td className="px-3 py-2 text-right">
                  <button onClick={() => revokeMutation.mutate(g.id)} className="text-xs text-red-600 hover:underline">
                    Revoke
                  </button>
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
