import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type Department, type DemoUser } from "../../api/client";
import { SearchableSelect } from "../../components/SearchableSelect";

// Accounts with no department of their own - mostly people created on their
// first Microsoft sign-in when Microsoft sent no department we recognise.
// Shared with Layout.tsx's Admin Console sidebar for its badge.
export function useUsersWithoutDepartment(enabled = true) {
  const { data: users = [] } = useQuery({
    queryKey: ["auth", "users"],
    queryFn: async () => (await api.get<DemoUser[]>("/auth/users")).data,
    enabled,
  });
  return users.filter((u) => !u.department);
}

// Shown at the top of every Admin Console tab while any account has no
// department, with a department picker per person to fix it right there.
export function MissingDepartmentNotice() {
  const missing = useUsersWithoutDepartment();
  const [open, setOpen] = useState(true);
  const { data: departments = [] } = useQuery({
    queryKey: ["departments"],
    queryFn: async () => (await api.get<Department[]>("/admin/departments")).data,
    enabled: missing.length > 0,
  });

  if (missing.length === 0) return null;
  const departmentOptions = departments.map((d) => ({ value: d.id, label: d.name }));

  return (
    <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm">
      <div className="flex items-center gap-2">
        <span className="rounded-full bg-amber-500 px-1.5 text-[10px] font-semibold leading-4 text-white">{missing.length}</span>
        <span className="font-semibold text-amber-900">
          {missing.length === 1 ? "1 user has" : `${missing.length} users have`} no department assigned
        </span>
        <button type="button" onClick={() => setOpen((o) => !o)} className="ml-auto text-xs font-semibold text-amber-800 hover:underline">
          {open ? "Hide" : "Show"}
        </button>
      </div>
      {open && (
        <>
          <div className="mt-1 text-xs text-amber-800">
            Their requests and approvals are routed by department, so assign one to each. Usually these are people who signed in with Microsoft for the first time.
          </div>
          <ul className="mt-2 divide-y divide-amber-200 rounded border border-amber-200 bg-white">
            {missing.map((u) => (
              <MissingDepartmentRow key={u.id} user={u} options={departmentOptions} />
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

function MissingDepartmentRow({ user, options }: { user: DemoUser; options: { value: string; label: string }[] }) {
  const queryClient = useQueryClient();
  const [departmentId, setDepartmentId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const assign = useMutation({
    mutationFn: async () => (await api.patch(`/admin/users/${user.id}`, { departmentId })).data,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["auth", "users"] }),
    onError: (err: any) => setError(err.response?.data?.error ?? "Couldn't assign the department."),
  });

  return (
    <li className="flex flex-wrap items-center gap-2 px-3 py-2">
      <div className="min-w-0 flex-1">
        <div className="truncate font-medium text-slate-800">{user.name}</div>
        <div className="truncate text-xs text-slate-500">{user.email}</div>
      </div>
      <div className="w-72 max-w-full">
        <SearchableSelect placeholder="Select a department…" options={options} value={departmentId} onChange={setDepartmentId} disabled={assign.isPending} />
      </div>
      <button
        type="button"
        onClick={() => {
          setError(null);
          assign.mutate();
        }}
        disabled={!departmentId || assign.isPending}
        className="rounded bg-emerald-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-600 disabled:opacity-50"
      >
        {assign.isPending ? "Saving…" : "Assign"}
      </button>
      {error && <div className="w-full text-xs text-red-600">{error}</div>}
    </li>
  );
}
