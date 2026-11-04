import { Fragment, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../api/client";
import { SearchableSelect } from "../../components/SearchableSelect";
import { roleLabel } from "../../components/RoleSwitcher";
import { ROLE_TYPES } from "./RoleAssignmentsTab";
import { NPC_SCOPES, SCOPED_GROUPS, SF_SCOPES, scopeLabel, type AccessControlData } from "./AccessControlTab";

export interface AccessRequest {
  id: string;
  requestFor: "SELF" | "OTHER";
  email: string;
  fullName: string;
  username: string;
  department: { id: string; name: string };
  requesterEmail: string | null;
  requesterName: string | null;
  status: "PENDING" | "APPROVED" | "DISAPPROVED";
  decidedAt: string | null;
  decidedBy: string | null;
  decisionNote: string | null;
  createdAt: string;
}

export const ACCESS_REQUESTS_QUERY_KEY = ["admin", "access-requests"] as const;

export function useAccessRequests(enabled = true) {
  return useQuery({
    queryKey: ACCESS_REQUESTS_QUERY_KEY,
    queryFn: async () => (await api.get<AccessRequest[]>("/admin/access-requests")).data,
    enabled,
    staleTime: 30_000,
  });
}

const STATUS_STYLES: Record<AccessRequest["status"], string> = {
  PENDING: "bg-amber-100 text-amber-800",
  APPROVED: "bg-emerald-100 text-emerald-800",
  DISAPPROVED: "bg-red-100 text-red-700",
};
const STATUS_LABELS: Record<AccessRequest["status"], string> = { PENDING: "Pending", APPROVED: "Approved", DISAPPROVED: "Disapproved" };

// Self-requests were filed by the person themselves; requests for another
// user carry the requester's typed name (older ones may not have it).
const requestedBy = (r: AccessRequest) => (r.requestFor === "SELF" ? r.fullName : (r.requesterName ?? r.requesterEmail ?? "Another user"));
const fmt = (d: string) => new Date(d).toLocaleString();

// Inbox for the login page's "Request access" form - the Budget Officer
// reviews each request, picks the person's role assignments and access
// groups, then approves (creates the account with those) or disapproves it.
export function AccessRequestsTab() {
  const { data: requests = [], isLoading } = useAccessRequests();
  const [reviewingId, setReviewingId] = useState<string | null>(null);
  const [showDecided, setShowDecided] = useState(false);

  const pending = requests.filter((r) => r.status === "PENDING");
  const decided = requests.filter((r) => r.status !== "PENDING");

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <div className="text-sm font-semibold text-slate-800">Access Requests</div>
        <p className="mt-1 text-xs text-slate-500">
          Sent from the login page by people with no access yet. Click Review to set their role assignments and access control, then approve (creates their account under their full name in the requested department; sign-in is through SSO) or disapprove.
        </p>
      </div>

      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-100 px-4 py-2 text-xs font-semibold text-slate-600">Pending ({pending.length})</div>
        {isLoading ? (
          <div className="px-4 py-6 text-sm text-slate-500">Loading…</div>
        ) : pending.length === 0 ? (
          <div className="px-4 py-6 text-sm text-slate-500">No pending access requests.</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-emerald-50 text-left text-xs tracking-wide text-emerald-800">
              <tr>
                <th className="px-4 py-2">Full name</th>
                <th className="px-4 py-2">Username</th>
                <th className="px-4 py-2">Email</th>
                <th className="px-4 py-2">Department</th>
                <th className="px-4 py-2">Requested by</th>
                <th className="px-4 py-2">Sent</th>
                <th className="px-4 py-2 text-right">Action</th>
              </tr>
            </thead>
            <tbody>
              {pending.map((r) => {
                const open = reviewingId === r.id;
                return (
                  <Fragment key={r.id}>
                    <tr className={`border-t border-slate-100 align-top ${open ? "bg-emerald-50/40" : ""}`}>
                      <td className="px-4 py-3 font-medium text-slate-800">{r.fullName}</td>
                      <td className="px-4 py-3 text-slate-700">{r.username}</td>
                      <td className="px-4 py-3 text-slate-700">{r.email}</td>
                      <td className="px-4 py-3 text-slate-700">{r.department.name}</td>
                      <td className="px-4 py-3 text-slate-700">{requestedBy(r)}</td>
                      <td className="px-4 py-3 text-xs text-slate-500">{fmt(r.createdAt)}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-right">
                        <button
                          type="button"
                          onClick={() => setReviewingId(open ? null : r.id)}
                          className={open ? "rounded border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100" : "rounded bg-emerald-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-600"}
                        >
                          {open ? "Close" : "Review"}
                        </button>
                      </td>
                    </tr>
                    {open && (
                      <tr className="bg-emerald-50/40">
                        <td colSpan={7} className="px-4 pb-4">
                          <ReviewPanel request={r} onDone={() => setReviewingId(null)} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {decided.length > 0 && (
        <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
          <button type="button" onClick={() => setShowDecided((s) => !s)} className="flex w-full items-center justify-between px-4 py-2 text-left text-xs font-semibold text-slate-600 hover:bg-slate-50">
            <span>Decided ({decided.length})</span>
            <span>{showDecided ? "Hide" : "Show"}</span>
          </button>
          {showDecided && (
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs tracking-wide text-slate-600">
                <tr>
                  <th className="px-4 py-2">Full name</th>
                  <th className="px-4 py-2">Username</th>
                  <th className="px-4 py-2">Email</th>
                  <th className="px-4 py-2">Department</th>
                  <th className="px-4 py-2">Requested by</th>
                  <th className="px-4 py-2">Status</th>
                  <th className="px-4 py-2">Decided</th>
                  <th className="px-4 py-2">Note</th>
                </tr>
              </thead>
              <tbody>
                {decided.map((r) => (
                  <tr key={r.id} className="border-t border-slate-100 align-top">
                    <td className="px-4 py-2 font-medium text-slate-800">{r.fullName}</td>
                    <td className="px-4 py-2 text-slate-700">{r.username}</td>
                    <td className="px-4 py-2 text-slate-700">{r.email}</td>
                    <td className="px-4 py-2 text-slate-700">{r.department.name}</td>
                    <td className="px-4 py-2 text-slate-700">{requestedBy(r)}</td>
                    <td className="px-4 py-2">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[r.status]}`}>{STATUS_LABELS[r.status]}</span>
                    </td>
                    <td className="px-4 py-2 text-xs text-slate-500">
                      {r.decidedAt ? fmt(r.decidedAt) : "—"}
                      {r.decidedBy && <> by {r.decidedBy}</>}
                    </td>
                    <td className="px-4 py-2 text-xs text-slate-600">{r.decisionNote ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}

interface RolePick {
  departmentId: string;
  roleType: string;
}
interface GroupPick {
  group: string;
  scope: string;
}

// The approval screen for one request: the same choices Role Assignments
// and Access Control offer, saved together with the approval.
function ReviewPanel({ request, onDone }: { request: AccessRequest; onDone: () => void }) {
  const queryClient = useQueryClient();
  const { data: departments = [] } = useQuery({
    queryKey: ["admin", "departments"],
    queryFn: async () => (await api.get<{ id: string; name: string }[]>("/admin/departments")).data,
  });
  const { data: accessData } = useQuery({
    queryKey: ["admin", "access-control"],
    queryFn: async () => (await api.get<AccessControlData>("/admin/access-control")).data,
  });

  // The dropdowns start empty; a selection that's complete when Approve is
  // clicked counts even if "Add role" / "Add access" wasn't pressed.
  const [roles, setRoles] = useState<RolePick[]>([]);
  const [roleType, setRoleType] = useState("");
  const [roleDeptId, setRoleDeptId] = useState(request.department.id);

  const [groups, setGroups] = useState<GroupPick[]>([]);
  const [group, setGroup] = useState("");
  const [scope, setScope] = useState("");

  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);

  const deptName = (id: string) => departments.find((d) => d.id === id)?.name ?? "—";
  const groupLabel = (g: string) => accessData?.groups.find((x) => x.group === g)?.label;
  const isScoped = SCOPED_GROUPS.includes(group);

  // Same scope choices as Access Control's Add member: fixed SBU lists, or
  // every department plus any scope already used in that group.
  const scopeOptions = useMemo(() => {
    const used = accessData?.groups.find((g) => g.group === group)?.members.map((m) => m.scope).filter(Boolean) ?? [];
    if (group === "SF") return [...new Set([...SF_SCOPES, ...used])];
    if (group === "NPC") return [...new Set([...NPC_SCOPES, ...used])];
    return [...new Set([...departments.map((d) => d.name), ...used])].sort((a, b) => a.localeCompare(b));
  }, [group, departments, accessData]);

  // What's currently selected in the dropdowns, if complete.
  const draftRole: RolePick | null = roleType && roleDeptId ? { roleType, departmentId: roleDeptId } : null;
  const draftGroup: GroupPick | null = group && (!isScoped || scope) ? { group, scope: isScoped ? scope : "" } : null;
  const hasRole = (r: RolePick) => roles.some((x) => x.roleType === r.roleType && x.departmentId === r.departmentId);
  const hasGroup = (g: GroupPick) => groups.some((x) => x.group === g.group && x.scope === g.scope);
  const finalRoles = draftRole && !hasRole(draftRole) ? [...roles, draftRole] : roles;
  const finalGroups = draftGroup && !hasGroup(draftGroup) ? [...groups, draftGroup] : groups;

  const addRole = () => {
    if (!draftRole || hasRole(draftRole)) return;
    setRoles((rs) => [...rs, draftRole]);
    setRoleType("");
  };
  const addGroup = () => {
    if (!draftGroup || hasGroup(draftGroup)) return;
    setGroups((gs) => [...gs, draftGroup]);
    setGroup("");
    setScope("");
  };

  const decide = useMutation({
    mutationFn: async (action: "approve" | "disapprove") =>
      (await api.post(`/admin/access-requests/${request.id}/${action}`, action === "approve" ? { note: note || null, roles: finalRoles, groups: finalGroups } : { note: note || null })).data,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ACCESS_REQUESTS_QUERY_KEY });
      queryClient.invalidateQueries({ queryKey: ["auth", "users"] });
      queryClient.invalidateQueries({ queryKey: ["role-assignments"] });
      queryClient.invalidateQueries({ queryKey: ["admin", "access-control"] });
      onDone();
    },
    onError: (err: any) => setError(err.response?.data?.error ?? "Could not save the decision."),
  });

  const chip = "inline-flex items-center gap-1.5 rounded-full bg-white px-2.5 py-1 text-xs text-slate-700 ring-1 ring-slate-200";
  const sectionTitle = "text-xs font-semibold text-slate-700";
  const smallLabel = "mb-1 block text-[11px] font-medium text-slate-500";

  return (
    <div className="space-y-4 rounded-lg border border-emerald-100 bg-white p-4">
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Role Assignments */}
        <div className="space-y-2">
          <div className={sectionTitle}>Role Assignments</div>
          <div className="flex flex-wrap items-end gap-2">
            <div>
              <label className={smallLabel}>Role</label>
              <select value={roleType} onChange={(e) => setRoleType(e.target.value)} className="rounded border border-slate-300 px-2 py-2 text-sm">
                <option value="">Select a role…</option>
                {ROLE_TYPES.map((r) => (
                  <option key={r} value={r}>
                    {roleLabel(r)}
                  </option>
                ))}
              </select>
            </div>
            <div className="w-64">
              <label className={smallLabel}>Department</label>
              <SearchableSelect placeholder="Select a department…" options={departments.map((d) => ({ value: d.id, label: d.name }))} value={roleDeptId} onChange={setRoleDeptId} />
            </div>
            <button type="button" onClick={addRole} disabled={!draftRole} className="rounded border border-emerald-700 px-3 py-2 text-xs font-medium text-emerald-800 hover:bg-emerald-50 disabled:opacity-50">
              Add role
            </button>
          </div>
          <div className="flex flex-wrap gap-2">
            {roles.length === 0 && <span className="text-xs text-slate-400">No roles added.</span>}
            {roles.map((r, i) => (
              <span key={`${r.roleType}-${r.departmentId}`} className={chip}>
                {roleLabel(r.roleType)} · {deptName(r.departmentId)}
                <button type="button" aria-label="Remove role" onClick={() => setRoles((rs) => rs.filter((_, j) => j !== i))} className="text-slate-400 hover:text-red-600">
                  ×
                </button>
              </span>
            ))}
          </div>
        </div>

        {/* Access Control */}
        <div className="space-y-2">
          <div className={sectionTitle}>Access Control</div>
          <div className="flex flex-wrap items-end gap-2">
            <div>
              <label className={smallLabel}>Access group</label>
              <select
                value={group}
                onChange={(e) => {
                  const g = e.target.value;
                  setGroup(g);
                  setScope(g === "CD" || g === "NCD" ? request.department.name : "");
                }}
                className="rounded border border-slate-300 px-2 py-2 text-sm"
              >
                <option value="">Select a group…</option>
                {(accessData?.groups.map((g) => g.group) ?? ["BCA", "CD", "NCD", "MC", "SF", "NPC"]).map((g) => (
                  <option key={g} value={g}>
                    {g}
                    {groupLabel(g) ? ` – ${groupLabel(g)}` : ""}
                  </option>
                ))}
              </select>
            </div>
            {isScoped && (
              <div className="w-64">
                <label className={smallLabel}>{scopeLabel(group)}</label>
                <SearchableSelect placeholder={`Select ${scopeLabel(group) === "Department" ? "a department" : "an SBU"}…`} options={scopeOptions.map((s) => ({ value: s, label: s }))} value={scope} onChange={setScope} />
              </div>
            )}
            <button type="button" onClick={addGroup} disabled={!draftGroup} className="rounded border border-emerald-700 px-3 py-2 text-xs font-medium text-emerald-800 hover:bg-emerald-50 disabled:opacity-50">
              Add access
            </button>
          </div>
          <div className="flex flex-wrap gap-2">
            {groups.length === 0 && <span className="text-xs text-slate-400">No access groups added.</span>}
            {groups.map((g, i) => (
              <span key={`${g.group}-${g.scope}`} className={chip}>
                {g.group}
                {g.scope && <> · {g.scope}</>}
                <button type="button" aria-label="Remove access group" onClick={() => setGroups((gs) => gs.filter((_, j) => j !== i))} className="text-slate-400 hover:text-red-600">
                  ×
                </button>
              </span>
            ))}
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-2 border-t border-slate-100 pt-3">
        <div className="min-w-[16rem] flex-1">
          <label className={smallLabel}>Note (optional)</label>
          <input type="text" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Reason / remarks" className="w-full rounded border border-slate-300 px-2 py-2 text-sm" />
        </div>
        <button
          type="button"
          disabled={decide.isPending}
          onClick={() => decide.mutate("approve")}
          className="rounded bg-emerald-700 px-4 py-2 text-xs font-medium text-white hover:bg-emerald-600 disabled:opacity-50"
        >
          {decide.isPending && decide.variables === "approve" ? "Approving…" : "Approve"}
        </button>
        <button
          type="button"
          disabled={decide.isPending}
          onClick={() => decide.mutate("disapprove")}
          className="rounded border border-red-300 px-4 py-2 text-xs font-medium text-red-700 hover:bg-red-50 disabled:opacity-50"
        >
          {decide.isPending && decide.variables === "disapprove" ? "Saving…" : "Disapprove"}
        </button>
      </div>
      <div className="text-xs text-slate-500">
        Approving will give them:{" "}
        {finalRoles.length === 0 && finalGroups.length === 0 ? (
          <span className="text-amber-700">no roles and no access groups yet (they can be added later under Role Assignments / Access Control).</span>
        ) : (
          <span className="text-slate-700">
            {[...finalRoles.map((r) => `${roleLabel(r.roleType)} (${deptName(r.departmentId)})`), ...finalGroups.map((g) => (g.scope ? `${g.group} – ${g.scope}` : g.group))].join(", ")}
          </span>
        )}
      </div>
      {error && <div className="text-xs text-red-600">{error}</div>}
    </div>
  );
}
