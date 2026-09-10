import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, SBU_OPTIONS, type DemoUser, type Sbu, type SbuRoleAssignment, type SbuRoleType } from "../../api/client";
import { SearchableSelect } from "../../components/SearchableSelect";
import { roleLabel } from "../../components/RoleSwitcher";

// Phase 3's DOE-stream approval chain (FR-3.4/3.5/3.6) is scoped per-SBU
// rather than per-department - see backend/prisma/schema.prisma's
// SbuRoleAssignment. Mirrors RoleAssignmentsTab.tsx's shape exactly, just
// keyed by Sbu instead of Department.
const ROLE_TYPES: SbuRoleType[] = ["BU_FINANCE_HEAD", "BU_HEAD", "BU_FINANCE_OFFICER"];

export function SbuRoleAssignmentsTab() {
  const queryClient = useQueryClient();
  const { data: assignments = [] } = useQuery({
    queryKey: ["sbu-role-assignments"],
    queryFn: async () => (await api.get<SbuRoleAssignment[]>("/admin/sbu-role-assignments")).data,
  });
  const { data: users = [] } = useQuery({
    queryKey: ["auth", "users"],
    queryFn: async () => (await api.get<DemoUser[]>("/auth/users")).data,
  });

  const sortedAssignments = useMemo(
    () => [...assignments].sort((a, b) => a.sbu.localeCompare(b.sbu) || a.roleType.localeCompare(b.roleType) || a.user.name.localeCompare(b.user.name)),
    [assignments],
  );

  const [userId, setUserId] = useState("");
  const [sbu, setSbu] = useState<Sbu>(SBU_OPTIONS[0].value);
  const [roleType, setRoleType] = useState<SbuRoleType>(ROLE_TYPES[0]);
  const selectedUser = users.find((u) => u.id === userId);

  const assignMutation = useMutation({
    mutationFn: async () => {
      if (!selectedUser) throw new Error("Select an employee.");
      return (await api.post("/admin/sbu-role-assignments", { sbu, roleType, userId: selectedUser.id })).data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["sbu-role-assignments"] });
      setUserId("");
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => (await api.delete(`/admin/sbu-role-assignments/${id}`)).data,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["sbu-role-assignments"] }),
  });

  return (
    <div className="space-y-4">
      <p className="rounded-lg border border-blue-100 bg-blue-50 p-3 text-sm text-blue-800">
        Assigns the three Phase 3 DOE-stream roles (BU Finance Head, BU Head, BU Finance Officer) per SBU — a DOE
        transfer request routes to its SBU's assignees at each stage.
      </p>

      <div className="flex flex-wrap items-end gap-2 text-sm">
        <div className="w-56">
          <label className="mb-1 block text-xs font-medium text-slate-500">Username</label>
          <SearchableSelect
            placeholder="Search employees…"
            options={users.map((u) => ({ value: u.id, label: u.name, sublabel: u.department?.name ?? "no dept" }))}
            value={userId}
            onChange={setUserId}
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-500">SBU</label>
          <select className="rounded border border-slate-300 px-2 py-1.5" value={sbu} onChange={(e) => setSbu(e.target.value as Sbu)}>
            {SBU_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-500">Role</label>
          <select className="rounded border border-slate-300 px-2 py-1.5" value={roleType} onChange={(e) => setRoleType(e.target.value as SbuRoleType)}>
            {ROLE_TYPES.map((r) => (
              <option key={r} value={r}>
                {roleLabel(r)}
              </option>
            ))}
          </select>
        </div>
        <button onClick={() => assignMutation.mutate()} disabled={!selectedUser || assignMutation.isPending} className="rounded bg-emerald-700 px-3 py-2 text-xs font-medium text-white hover:bg-emerald-600 disabled:opacity-50">
          Assign
        </button>
      </div>
      {assignMutation.isError && <div className="text-xs text-red-600">{(assignMutation.error as any)?.response?.data?.error ?? "Could not assign this role."}</div>}

      <table className="w-full overflow-hidden rounded-lg border border-slate-200 bg-white text-sm">
        <thead className="bg-emerald-50 text-left text-xs tracking-wide text-emerald-800">
          <tr>
            <th className="px-3 py-2">SBU</th>
            <th className="px-3 py-2">Role</th>
            <th className="px-3 py-2">User</th>
            <th className="px-3 py-2" />
          </tr>
        </thead>
        <tbody>
          {sortedAssignments.length === 0 && (
            <tr>
              <td colSpan={4} className="px-3 py-4 text-center text-slate-400">
                None configured yet.
              </td>
            </tr>
          )}
          {sortedAssignments.map((a) => (
            <tr key={a.id} className="border-t border-slate-100">
              <td className="px-3 py-2">{SBU_OPTIONS.find((o) => o.value === a.sbu)?.label ?? a.sbu}</td>
              <td className="px-3 py-2">{roleLabel(a.roleType)}</td>
              <td className="px-3 py-2">{a.user.name}</td>
              <td className="px-3 py-2 text-right">
                <button onClick={() => deleteMutation.mutate(a.id)} className="text-xs text-red-600 hover:underline">
                  Remove
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
