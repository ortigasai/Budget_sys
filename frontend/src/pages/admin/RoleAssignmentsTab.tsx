import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type Department, type DemoUser } from "../../api/client";
import { SearchableSelect } from "../../components/SearchableSelect";

interface RoleAssignment {
  id: string;
  roleType: string;
  department: Department;
  user: { id: string; name: string; email: string };
}

const ROLE_TYPES = [
  "DEPARTMENT_HEAD",
  "CENTRALIZED_FIRST_LEVEL_REVIEWER",
  "CENTRALIZED_DEPARTMENT_HEAD",
  "BCA_HEAD",
  "CENTRALIZED_BUDGET_PREPARER",
  "BUDGET_OFFICER",
];

export function RoleAssignmentsTab() {
  const queryClient = useQueryClient();
  const { data: assignments = [] } = useQuery({
    queryKey: ["role-assignments"],
    queryFn: async () => (await api.get<RoleAssignment[]>("/admin/role-assignments")).data,
  });
  const { data: departments = [] } = useQuery({
    queryKey: ["departments"],
    queryFn: async () => (await api.get<Department[]>("/admin/departments")).data,
  });
  const { data: users = [] } = useQuery({
    queryKey: ["auth", "users"],
    queryFn: async () => (await api.get<DemoUser[]>("/auth/users")).data,
  });

  const [form, setForm] = useState({ departmentId: "", roleType: ROLE_TYPES[0], userId: "" });

  const createMutation = useMutation({
    mutationFn: async () => (await api.post("/admin/role-assignments", form)).data,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["role-assignments"] });
      setForm({ departmentId: "", roleType: ROLE_TYPES[0], userId: "" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => (await api.delete(`/admin/role-assignments/${id}`)).data,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["role-assignments"] }),
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <select
          className="rounded border border-slate-300 px-2 py-1"
          value={form.departmentId}
          onChange={(e) => setForm({ ...form, departmentId: e.target.value })}
        >
          <option value="">— Department —</option>
          {departments.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>
        <select
          className="rounded border border-slate-300 px-2 py-1"
          value={form.roleType}
          onChange={(e) => setForm({ ...form, roleType: e.target.value })}
        >
          {ROLE_TYPES.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
        <div className="w-64">
          <SearchableSelect
            placeholder="Search users…"
            options={users.map((u) => ({ value: u.id, label: u.name, sublabel: u.email }))}
            value={form.userId}
            onChange={(v) => setForm({ ...form, userId: v })}
          />
        </div>
        <button
          onClick={() => createMutation.mutate()}
          disabled={!form.departmentId || !form.userId}
          className="rounded bg-emerald-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-600 disabled:opacity-50"
        >
          Assign
        </button>
      </div>

      <table className="w-full overflow-hidden rounded-lg border border-slate-200 bg-white text-sm">
        <thead className="bg-emerald-50 text-left text-xs uppercase tracking-wide text-emerald-800">
          <tr>
            <th className="px-3 py-2">Department</th>
            <th className="px-3 py-2">Role</th>
            <th className="px-3 py-2">User</th>
            <th className="px-3 py-2" />
          </tr>
        </thead>
        <tbody>
          {assignments.map((a) => (
            <tr key={a.id} className="border-t border-slate-100">
              <td className="px-3 py-2">{a.department.name}</td>
              <td className="px-3 py-2">{a.roleType}</td>
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
