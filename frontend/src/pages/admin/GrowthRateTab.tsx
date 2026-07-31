import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type Department } from "../../api/client";
import { useAuth } from "../../context/AuthContext";

interface GrowthRateData {
  default: number;
  overrides: { departmentId: string; value: number; department: Department }[];
}
interface AuditLogEntry {
  id: string;
  userId: string;
  oldValue: number | null;
  newValue: number;
  reason: string;
  timestamp: string;
  department: Department | null;
}

export function GrowthRateTab() {
  const { hasRole } = useAuth();
  const queryClient = useQueryClient();
  const { data } = useQuery({
    queryKey: ["growth-rate"],
    queryFn: async () => (await api.get<GrowthRateData>("/admin/growth-rate")).data,
  });
  const { data: departments = [] } = useQuery({
    queryKey: ["departments"],
    queryFn: async () => (await api.get<Department[]>("/admin/departments")).data,
  });
  const { data: auditLog = [] } = useQuery({
    queryKey: ["growth-rate-audit-log"],
    queryFn: async () => (await api.get<AuditLogEntry[]>("/admin/growth-rate/audit-log")).data,
  });

  const [defaultValue, setDefaultValue] = useState("");
  const [defaultReason, setDefaultReason] = useState("");
  const setDefault = useMutation({
    mutationFn: async () =>
      (await api.patch("/admin/growth-rate/default", { value: Number(defaultValue), reason: defaultReason })).data,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["growth-rate"] });
      queryClient.invalidateQueries({ queryKey: ["growth-rate-audit-log"] });
      setDefaultValue("");
      setDefaultReason("");
    },
  });

  const [overrideDept, setOverrideDept] = useState("");
  const [overrideValue, setOverrideValue] = useState("");
  const [overrideReason, setOverrideReason] = useState("");
  const setOverride = useMutation({
    mutationFn: async () =>
      (
        await api.put("/admin/growth-rate/overrides", {
          departmentId: overrideDept,
          value: Number(overrideValue),
          reason: overrideReason,
        })
      ).data,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["growth-rate"] });
      queryClient.invalidateQueries({ queryKey: ["growth-rate-audit-log"] });
      setOverrideDept("");
      setOverrideValue("");
      setOverrideReason("");
    },
  });

  const canEditDefault = hasRole("BUDGET_OFFICER");
  const canEditOverride = hasRole("BCA_HEAD") || hasRole("BUDGET_OFFICER");

  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <div className="mb-2 text-sm font-semibold">
          Default Growth Rate: <span className="text-emerald-800">{data?.default ?? 0}%</span>{" "}
          <span className="text-xs font-normal text-slate-500">(Budget Officer only — FR-1.7)</span>
        </div>
        {canEditDefault && (
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <input
              type="number"
              placeholder="New default %"
              className="w-32 rounded border border-slate-300 px-2 py-1"
              value={defaultValue}
              onChange={(e) => setDefaultValue(e.target.value)}
            />
            <input
              placeholder="Reason for change (mandatory)"
              className="flex-1 rounded border border-slate-300 px-2 py-1"
              value={defaultReason}
              onChange={(e) => setDefaultReason(e.target.value)}
            />
            <button
              onClick={() => setDefault.mutate()}
              disabled={!defaultValue || !defaultReason}
              className="rounded bg-emerald-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-600 disabled:opacity-50"
            >
              Update
            </button>
          </div>
        )}
      </div>

      <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <div className="mb-2 text-sm font-semibold">
          Departmental Exception Table{" "}
          <span className="text-xs font-normal text-slate-500">(BC&amp;A or Budget Officer — FR-1.8)</span>
        </div>
        <table className="w-full text-sm">
          <thead className="bg-emerald-50 text-left text-xs uppercase tracking-wide text-emerald-800">
            <tr>
              <th className="py-1">Department</th>
              <th className="py-1">Override %</th>
            </tr>
          </thead>
          <tbody>
            {data?.overrides.map((o) => (
              <tr key={o.departmentId} className="border-t border-slate-100">
                <td className="py-1">{o.department.name}</td>
                <td className="py-1">{o.value}%</td>
              </tr>
            ))}
          </tbody>
        </table>
        {canEditOverride && (
          <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
            <select
              className="rounded border border-slate-300 px-2 py-1"
              value={overrideDept}
              onChange={(e) => setOverrideDept(e.target.value)}
            >
              <option value="">— Department —</option>
              {departments
                .filter((d) => d.type === "CENTRALIZED")
                .map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
            </select>
            <input
              type="number"
              placeholder="Override %"
              className="w-24 rounded border border-slate-300 px-2 py-1"
              value={overrideValue}
              onChange={(e) => setOverrideValue(e.target.value)}
            />
            <input
              placeholder="Reason (mandatory)"
              className="flex-1 rounded border border-slate-300 px-2 py-1"
              value={overrideReason}
              onChange={(e) => setOverrideReason(e.target.value)}
            />
            <button
              onClick={() => setOverride.mutate()}
              disabled={!overrideDept || !overrideValue || !overrideReason}
              className="rounded bg-emerald-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-600 disabled:opacity-50"
            >
              Set Override
            </button>
          </div>
        )}
      </div>

      <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <div className="mb-2 text-sm font-semibold">Growth Rate Audit Log (FR-1.9)</div>
        <ul className="space-y-1 text-sm">
          {auditLog.map((entry) => (
            <li key={entry.id} className="border-t border-slate-100 pt-1 first:border-t-0 first:pt-0">
              {entry.department?.name ?? "Default"}: {entry.oldValue ?? "—"}% → {entry.newValue}% —{" "}
              <span className="italic text-slate-600">{entry.reason}</span>{" "}
              <span className="text-xs text-slate-400">{new Date(entry.timestamp).toLocaleString()}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
