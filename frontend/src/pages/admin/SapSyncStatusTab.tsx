import { useQuery } from "@tanstack/react-query";
import { api, api2 } from "../../api/client";
import { useFiscalYear } from "../../lib/fiscalCycle";
import { timeAgo } from "../../lib/timeAgo";

interface SyncStatus {
  status: "idle" | "running" | "success" | "error";
  startedAt: string | null;
  finishedAt: string | null;
  lastSuccessAt: string | null;
  error: string | null;
}

const STATUS_STYLE: Record<SyncStatus["status"], string> = {
  idle: "bg-slate-100 text-slate-600",
  running: "bg-amber-100 text-amber-800",
  success: "bg-emerald-100 text-emerald-800",
  error: "bg-red-100 text-red-700",
};

function StatusBadge({ status }: { status: SyncStatus["status"] }) {
  return <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS_STYLE[status]}`}>{status}</span>;
}

// One place to see all three background SAP sync jobs (this app's whole SAP
// surface, per module) at once - each one used to be a separate button
// tucked into its own page (Utilization/Forecast/Manpower), with no way to
// tell "did last night's automatic run actually succeed" without visiting
// each page individually and reading a transient banner that's long gone by
// the time anyone checks. Every 15s poll here just reads the same persisted
// SapSyncStatus rows the automatic scheduler and each page's own "last
// synced" label already read (see backend/src/lib/backgroundSync.ts and
// backend-py/app/services/sap_sync_service.py) - nothing new is computed,
// this is purely a combined view of state that already exists.
export function SapSyncStatusTab() {
  const { forecastYear } = useFiscalYear();

  const jobs = [
    {
      key: "historicalActuals",
      label: "GAE/DOE Forecast",
      detail: "FBL3N → HistoricalActuals",
      query: useQuery({
        queryKey: ["admin", "sap-sync-status", "historicalActuals"],
        queryFn: async () => (await api.get<SyncStatus>("/admin/historical-actuals/sync-sap/status")).data,
        refetchInterval: 15000,
      }),
    },
    {
      key: "manpower",
      label: "Manpower Budget",
      detail: "KSSB V1 → ManpowerEntry",
      query: useQuery({
        queryKey: ["admin", "sap-sync-status", "manpower"],
        queryFn: async () => (await api.get<SyncStatus>("/manpower/run/status")).data,
        refetchInterval: 15000,
      }),
    },
    {
      key: "sap",
      label: "Utilization / Transfer / Dash Flow / Reports",
      detail: "FBL3N + KSSB V2 → SapActualTransaction / SapCommitment",
      query: useQuery({
        queryKey: ["admin", "sap-sync-status", "sap", forecastYear],
        queryFn: async () => (await api2.get<SyncStatus>("/utilization/sync-sap/status", { params: { fiscalYear: forecastYear } })).data,
        refetchInterval: 15000,
      }),
    },
  ] as const;

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-slate-200 bg-white p-3 text-sm text-slate-600 shadow-sm">
        All three run automatically every 10 minutes (never more than one at a time - they share a lock so they don't all hit the SAP broker
        simultaneously), independent of anyone visiting the pages that use this data. This just shows their current status; each page also has its own
        "Sync Now" button and "Last synced" label for an on-demand refresh.
      </div>

      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-2">Job</th>
              <th className="px-4 py-2">Status</th>
              <th className="px-4 py-2">Last Synced Successfully</th>
              <th className="px-4 py-2">Last Attempt</th>
              <th className="px-4 py-2">Error</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {jobs.map(({ key, label, detail, query }) => {
              const data = query.data;
              return (
                <tr key={key}>
                  <td className="px-4 py-2 align-top">
                    <div className="font-medium text-slate-700">{label}</div>
                    <div className="text-xs text-slate-400">{detail}</div>
                  </td>
                  <td className="px-4 py-2 align-top">{data ? <StatusBadge status={data.status} /> : <span className="text-xs text-slate-400">Loading…</span>}</td>
                  <td className="px-4 py-2 align-top text-slate-600">{data?.lastSuccessAt ? timeAgo(data.lastSuccessAt) : "Never"}</td>
                  <td className="px-4 py-2 align-top text-slate-600">{data?.startedAt ? timeAgo(data.startedAt) : "—"}</td>
                  <td className="max-w-sm px-4 py-2 align-top text-xs text-red-600">{data?.status === "error" ? data.error : ""}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
