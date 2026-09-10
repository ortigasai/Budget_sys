import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, NPC_SBU_OPTIONS, type NpcSbu } from "../api/client";
import { useAuth } from "../context/AuthContext";
import { PageHeader } from "../components/PageHeader";
import { useFiscalYear } from "../lib/fiscalCycle";

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

interface NpcForecastRow {
  budgetRequestId: string;
  budgetCode: string;
  projectTitle: string;
  npcBudget: number;
  ioCodes: string[];
  ioBudget: number;
  ioActual: number | null;
  npcAvailableBudget: number;
  monthlyRemainingForecast: Record<string, number>;
  remainingMonthsForecast: number;
  totalActualForecast: number;
  npcSurplus: number;
}

function peso(n: number) {
  return `₱${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

// Note 11 §8 - NPC Forecast. Genuinely new (not a filtered view of the
// generic HistoricalActuals table the GAE/DOE/Revenue tabs use) - NPC's
// real data lives in BudgetRequest/FinalizedBudgetLine/InternalOrderRequest,
// never in HistoricalActuals. SBU-scoped rather than department-scoped:
// Budget Officer picks any of the 8 NPC SBUs, everyone else is pinned to
// their own department's Department.sbu (same pattern Utilization's NPC
// view already uses).
export function NpcForecastView() {
  const { currentUser, hasRole } = useAuth();
  const isBudgetOfficer = hasRole("BUDGET_OFFICER");
  const { targetYear } = useFiscalYear();
  const queryClient = useQueryClient();

  const ownSbu = currentUser?.department?.sbu ?? null;
  const [pickedSbu, setPickedSbu] = useState<NpcSbu | "">("");
  const effectiveSbu = isBudgetOfficer ? pickedSbu || NPC_SBU_OPTIONS[0].value : ownSbu ?? "";

  const { data, isLoading, isError } = useQuery({
    queryKey: ["forecast", "npc", effectiveSbu],
    queryFn: async () => (await api.get<{ asOfMonth: number; rows: NpcForecastRow[] }>(`/forecast/npc/${effectiveSbu}`)).data,
    enabled: !!effectiveSbu,
  });
  const rows = data?.rows ?? [];
  const asOfMonth = data?.asOfMonth ?? 9;
  const remainingMonths = Array.from({ length: 12 - asOfMonth }, (_, i) => asOfMonth + 1 + i);

  const updateMutation = useMutation({
    mutationFn: async ({ budgetRequestId, month, value }: { budgetRequestId: string; month: number; value: number }) =>
      (await api.patch(`/forecast/npc/entries/${budgetRequestId}`, { month, value })).data,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["forecast", "npc", effectiveSbu] }),
  });

  const [uploadStatus, setUploadStatus] = useState<{ ok: boolean; message: string } | null>(null);
  const uploadMutation = useMutation({
    mutationFn: async (file: File) => {
      const form = new FormData();
      form.append("file", file);
      form.append("npcSbu", effectiveSbu);
      try {
        return (await api.post<{ ok: boolean; updated?: number; errors?: { row: number; error: string }[] }>("/forecast/npc/upload", form)).data;
      } catch (err: any) {
        if (err.response?.status === 400 && err.response.data?.errors) return err.response.data;
        throw err;
      }
    },
    onSuccess: (data) => {
      if (data.ok === false) {
        setUploadStatus({ ok: false, message: `${data.errors?.length ?? 0} row(s) rejected - fix and re-upload.` });
      } else {
        setUploadStatus({ ok: true, message: `Updated ${data.updated} row(s).` });
        queryClient.invalidateQueries({ queryKey: ["forecast", "npc", effectiveSbu] });
      }
    },
  });

  if (!effectiveSbu) {
    return (
      <div className="space-y-4">
        <PageHeader subtitle="Your department has no NPC SBU assigned - ask the Budget Officer to set one in the Admin Console." />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <PageHeader
        subtitle={`Months through ${MONTH_NAMES[asOfMonth - 1]} are already in Actuals - only remaining months are editable.`}
        actions={
          isBudgetOfficer ? (
            <select className="rounded border border-slate-300 px-2 py-1.5 text-sm" value={effectiveSbu} onChange={(e) => setPickedSbu(e.target.value as NpcSbu)}>
              {NPC_SBU_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          ) : undefined
        }
      />

      {targetYear >= 2027 && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
          <a
            href={`/api/forecast/npc/template?npcSbu=${effectiveSbu}`}
            className="rounded-md border border-emerald-300 bg-emerald-50 px-3 py-1.5 text-xs font-medium text-emerald-800 hover:bg-emerald-100"
          >
            Open Spreadsheet Template
          </a>
          <label className="cursor-pointer rounded-md border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100">
            {uploadMutation.isPending ? "Uploading…" : "Upload Completed Template"}
            <input
              type="file"
              accept=".xlsx"
              className="hidden"
              disabled={uploadMutation.isPending}
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (!file) return;
                setUploadStatus(null);
                uploadMutation.mutate(file);
              }}
            />
          </label>
          {uploadStatus && <span className={`text-xs ${uploadStatus.ok ? "text-emerald-700" : "text-red-600"}`}>{uploadStatus.message}</span>}
        </div>
      )}

      {isError && <div className="text-sm text-red-700">You do not have access to this SBU's NPC forecast.</div>}

      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white shadow-sm">
        <table className="w-full text-xs">
          <thead className="bg-emerald-50 text-left tracking-wide text-emerald-800">
            <tr>
              <th className="px-2 py-2">Budget Code</th>
              <th className="px-2 py-2">Project Title</th>
              <th className="px-2 py-2">NPC Budget</th>
              <th className="px-2 py-2">IO Code(s)</th>
              <th className="px-2 py-2">IO Budget</th>
              <th className="px-2 py-2">IO Actual</th>
              <th className="px-2 py-2">NPC Available Budget</th>
              {remainingMonths.map((m) => (
                <th key={m} className="px-2 py-2">
                  {MONTH_NAMES[m - 1]}
                </th>
              ))}
              <th className="px-2 py-2">Total Remaining Forecast</th>
              <th className="px-2 py-2">Total Actual + Forecast</th>
              <th className="px-2 py-2">NPC Surplus/(Deficit)</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {isLoading ? (
              <tr>
                <td colSpan={10 + remainingMonths.length} className="px-2 py-6 text-center text-slate-400">
                  Loading…
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={10 + remainingMonths.length} className="px-2 py-6 text-center text-slate-400">
                  No finalized NPC projects for this SBU yet.
                </td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr key={r.budgetRequestId}>
                  <td className="whitespace-nowrap px-2 py-1">{r.budgetCode}</td>
                  <td className="px-2 py-1">{r.projectTitle}</td>
                  <td className="whitespace-nowrap px-2 py-1">{peso(r.npcBudget)}</td>
                  <td className="px-2 py-1">{r.ioCodes.join(", ") || "—"}</td>
                  <td className="whitespace-nowrap px-2 py-1">{peso(r.ioBudget)}</td>
                  <td className="whitespace-nowrap px-2 py-1">{r.ioActual === null ? "—" : peso(r.ioActual)}</td>
                  <td className="whitespace-nowrap px-2 py-1">{peso(r.npcAvailableBudget)}</td>
                  {remainingMonths.map((m) => (
                    <td key={m} className="px-2 py-1">
                      <input
                        type="number"
                        className="w-20 rounded border border-slate-300 px-1 py-0.5"
                        defaultValue={r.monthlyRemainingForecast[String(m)] ?? ""}
                        onBlur={(e) => {
                          const value = Number(e.target.value) || 0;
                          if (value !== (r.monthlyRemainingForecast[String(m)] ?? 0)) {
                            updateMutation.mutate({ budgetRequestId: r.budgetRequestId, month: m, value });
                          }
                        }}
                      />
                    </td>
                  ))}
                  <td className="whitespace-nowrap px-2 py-1 font-medium text-slate-700">{peso(r.remainingMonthsForecast)}</td>
                  <td className="whitespace-nowrap px-2 py-1">{peso(r.totalActualForecast)}</td>
                  <td className="whitespace-nowrap px-2 py-1 font-semibold text-emerald-800">{peso(r.npcSurplus)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
