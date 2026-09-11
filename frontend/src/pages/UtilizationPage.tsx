import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api2 } from "../api/client";
import { useAuth } from "../context/AuthContext";
import { PageHeader } from "../components/PageHeader";
import { SearchableSelect } from "../components/SearchableSelect";
import { useFiscalYear } from "../lib/fiscalCycle";

type ViewTab = "overview" | "reconciliation" | "npc";

// Phase 2 (Functional Spec §4) - "Budget Utilization Tracking". Served by
// the FastAPI backend (backend-py/), reached via the api2 client / /api2
// proxy rather than Node's api client. The Target Calendar Year itself still
// comes from the Node backend's FiscalCycleConfig singleton (shared Postgres
// DB) via useFiscalYear() - the one config both backends' UIs read.

interface Department {
  id: string;
  name: string;
}

interface OverviewRow {
  glAccount: string;
  costCenter: string;
  approvedBudget: number;
  actualExpenditures: number;
  commitments: number;
  totalAllotted: number;
  available: number;
}

interface ReconciliationRow {
  expenseLineItemId: string;
  expenseLineItemName: string;
  approvedBudget: number;
  sapActual: number;
  statusText: string;
}

interface UnmappedRow {
  id: number;
  itemText: string;
  amount: number;
  glAccount: string;
  costCenter: string;
  postedAt: string;
}

interface LineItem {
  id: string;
  name: string;
}

interface ReconciliationResponse {
  rows: ReconciliationRow[];
  unmapped: UnmappedRow[];
  lineItems: LineItem[];
}

interface NpcSbuOption {
  value: string;
  label: string;
}

interface NpcUtilizationRow {
  budgetCode: string;
  projectTitle: string;
  amount: number;
  location: string | null;
  sbu: string;
  ioCodes: string[];
  ioAmount: number;
  balance: number;
}

function peso(n: number) {
  return `₱${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

interface SapSyncStatus {
  status: "idle" | "running" | "success" | "error";
  fiscalYear: number | null;
  startedAt: string | null;
  finishedAt: string | null;
  actualsSynced?: number | null;
  commitmentsSynced?: number | null;
  error?: string | null;
}

export function UtilizationPage() {
  const { hasRole } = useAuth();
  const isBudgetOfficer = hasRole("BUDGET_OFFICER");
  // forecastYear, not targetYear - Budget Utilization Tracking follows the
  // current (already-in-force) calendar year, tracking actual spend against
  // the budget already finalized for it - not the next year's ask still
  // being prepared (that's targetYear, used by New Request/Approved Budget).
  const { forecastYear: FISCAL_YEAR } = useFiscalYear();
  // Which view is active lives in `?view=`, driven by Layout.tsx's
  // UtilizationSidebarNav (spec item 17 - moved out of this page's own
  // in-page TabBar into the sidebar, same pattern Phase 3 already uses).
  const [searchParams] = useSearchParams();
  const viewParam = searchParams.get("view");
  const tab: ViewTab = viewParam === "reconciliation" || viewParam === "npc" ? viewParam : "overview";

  const { data: departments = [] } = useQuery({
    queryKey: ["utilization", "departments"],
    queryFn: async () => (await api2.get<Department[]>("/utilization/departments")).data,
  });

  const [departmentId, setDepartmentId] = useState("");
  const effectiveDeptId = departmentId || departments[0]?.id || "";

  const { data: overviewRows = [], isLoading: overviewLoading } = useQuery({
    queryKey: ["utilization", "overview", effectiveDeptId],
    queryFn: async () =>
      (
        await api2.get<OverviewRow[]>("/utilization/overview", {
          params: { departmentId: effectiveDeptId, fiscalYear: FISCAL_YEAR },
        })
      ).data,
    enabled: !!effectiveDeptId && tab === "overview",
  });

  const queryClient = useQueryClient();
  const reconciliationKey = ["utilization", "reconciliation", effectiveDeptId];
  const { data: reconciliation, isLoading: reconciliationLoading } = useQuery({
    queryKey: reconciliationKey,
    queryFn: async () =>
      (
        await api2.get<ReconciliationResponse>("/utilization/reconciliation", {
          params: { departmentId: effectiveDeptId, fiscalYear: FISCAL_YEAR },
        })
      ).data,
    enabled: !!effectiveDeptId && tab === "reconciliation",
  });

  const { data: npcSbus = [] } = useQuery({
    queryKey: ["utilization", "npc-sbus"],
    queryFn: async () => (await api2.get<NpcSbuOption[]>("/utilization/npc/sbus")).data,
    enabled: tab === "npc",
  });
  const [npcSbuFilter, setNpcSbuFilter] = useState("");
  const effectiveNpcSbu = npcSbuFilter || npcSbus[0]?.value || "";

  const { data: npcRows = [], isLoading: npcLoading } = useQuery({
    queryKey: ["utilization", "npc", effectiveNpcSbu, FISCAL_YEAR],
    queryFn: async () =>
      (
        await api2.get<NpcUtilizationRow[]>("/utilization/npc", {
          params: { sbu: effectiveNpcSbu, fiscalYear: FISCAL_YEAR },
        })
      ).data,
    enabled: !!effectiveNpcSbu && tab === "npc",
  });

  // A full sync takes several minutes (hundreds of paginated, rate-limited
  // broker requests - see sap_sync_service.py), so the button only starts it
  // in the background and this polls GET /sync-sap/status for the result
  // instead of waiting on one long-lived POST that IIS's reverse proxy would
  // time out on long before it finished.
  const [syncStatus, setSyncStatus] = useState<{ ok: boolean; message: string } | null>(null);
  const [isPolling, setIsPolling] = useState(false);

  const startSyncMutation = useMutation({
    mutationFn: async () => (await api2.post("/utilization/sync-sap", null, { params: { fiscalYear: FISCAL_YEAR } })).data,
    onSuccess: () => {
      setSyncStatus({ ok: true, message: "Sync started - this can take several minutes, feel free to keep working elsewhere and check back." });
      setIsPolling(true);
    },
    onError: (err: any) => setSyncStatus({ ok: false, message: err.response?.data?.detail ?? "Could not start sync." }),
  });

  const { data: syncPollData } = useQuery({
    queryKey: ["utilization", "sync-sap-status"],
    queryFn: async () => (await api2.get<SapSyncStatus>("/utilization/sync-sap/status")).data,
    enabled: isPolling,
    refetchInterval: isPolling ? 5000 : false,
  });

  useEffect(() => {
    if (!syncPollData) return;
    if (syncPollData.status === "success") {
      setIsPolling(false);
      setSyncStatus({ ok: true, message: `Synced ${syncPollData.actualsSynced} actual(s), ${syncPollData.commitmentsSynced} commitment(s).` });
      queryClient.invalidateQueries({ queryKey: ["utilization", "overview", effectiveDeptId] });
      queryClient.invalidateQueries({ queryKey: reconciliationKey });
    } else if (syncPollData.status === "error") {
      setIsPolling(false);
      setSyncStatus({ ok: false, message: syncPollData.error ?? "Sync failed." });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [syncPollData?.status, syncPollData?.finishedAt]);

  const syncInProgress = isPolling || syncPollData?.status === "running";

  const [mappingId, setMappingId] = useState<number | null>(null);
  const mapMutation = useMutation({
    mutationFn: async ({ transactionId, expenseLineItemId }: { transactionId: number; expenseLineItemId: string }) => (await api2.patch(`/utilization/reconciliation/unmapped/${transactionId}`, { expenseLineItemId })).data,
    onSuccess: () => {
      setMappingId(null);
      queryClient.invalidateQueries({ queryKey: reconciliationKey });
    },
  });

  return (
    <div className="space-y-6">
      <PageHeader
        actions={
          <>
            {tab === "overview" && isBudgetOfficer && (
              <button
                onClick={() => {
                  setSyncStatus(null);
                  startSyncMutation.mutate();
                }}
                disabled={startSyncMutation.isPending || syncInProgress}
                className="rounded-md border border-emerald-300 bg-emerald-50 px-3 py-1.5 text-xs font-medium text-emerald-800 hover:bg-emerald-100 disabled:opacity-50"
              >
                {startSyncMutation.isPending || syncInProgress ? "Syncing…" : "Sync from SAP"}
              </button>
            )}
            {tab !== "npc" && departments.length > 1 && (
              <select value={effectiveDeptId} onChange={(e) => setDepartmentId(e.target.value)} className="rounded border border-slate-300 px-2 py-1.5 text-sm">
                {departments.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            )}
            {tab === "npc" && npcSbus.length > 1 && (
              <select value={effectiveNpcSbu} onChange={(e) => setNpcSbuFilter(e.target.value)} className="rounded border border-slate-300 px-2 py-1.5 text-sm">
                {npcSbus.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </select>
            )}
          </>
        }
      />

      {tab === "overview" && syncStatus && <div className={`text-sm ${syncStatus.ok ? "text-emerald-700" : "text-red-600"}`}>{syncStatus.message}</div>}

      {tab !== "npc" && !effectiveDeptId && <div className="rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-500">No centralized department is available for your account.</div>}
      {tab === "npc" && !effectiveNpcSbu && <div className="rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-500">Your department has no SBU assigned — ask the Budget Officer to set one in the Admin Console.</div>}

      {effectiveDeptId && tab === "overview" && (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-2 text-left">GL Account</th>
                <th className="px-4 py-2 text-left">Cost Center</th>
                <th className="px-4 py-2 text-right">Approved Budget</th>
                <th className="px-4 py-2 text-right">Actual Expenditures</th>
                <th className="px-4 py-2 text-right">Commitments</th>
                <th className="px-4 py-2 text-right">Total Allotted</th>
                <th className="px-4 py-2 text-right">Available</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {overviewLoading ? (
                <tr>
                  <td colSpan={7} className="px-4 py-6 text-center text-slate-400">
                    Loading…
                  </td>
                </tr>
              ) : overviewRows.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-6 text-center text-slate-400">
                    No approved budget lines for this department yet.
                  </td>
                </tr>
              ) : (
                overviewRows.map((r) => (
                  <tr key={`${r.glAccount}-${r.costCenter}`}>
                    <td className="px-4 py-2">{r.glAccount}</td>
                    <td className="px-4 py-2">{r.costCenter}</td>
                    <td className="px-4 py-2 text-right">{peso(r.approvedBudget)}</td>
                    <td className="px-4 py-2 text-right">{peso(r.actualExpenditures)}</td>
                    <td className="px-4 py-2 text-right">{peso(r.commitments)}</td>
                    <td className="px-4 py-2 text-right font-medium">{peso(r.totalAllotted)}</td>
                    <td className={`px-4 py-2 text-right font-medium ${r.available < 0 ? "text-red-600" : ""}`}>{peso(r.available)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      {effectiveDeptId && tab === "reconciliation" && (
        <div className="space-y-6">
          <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-xs tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-2 text-left">Expense Line Item</th>
                  <th className="px-4 py-2 text-right">{FISCAL_YEAR} Approved Budget</th>
                  <th className="px-4 py-2 text-right">SAP Actual</th>
                  <th className="px-4 py-2 text-left">Item Status / Text</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {reconciliationLoading ? (
                  <tr>
                    <td colSpan={4} className="px-4 py-6 text-center text-slate-400">
                      Loading…
                    </td>
                  </tr>
                ) : !reconciliation || reconciliation.rows.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-4 py-6 text-center text-slate-400">
                      No approved budget lines for this department yet.
                    </td>
                  </tr>
                ) : (
                  reconciliation.rows.map((r) => (
                    <tr key={r.expenseLineItemId}>
                      <td className="px-4 py-2">{r.expenseLineItemName}</td>
                      <td className="px-4 py-2 text-right">{peso(r.approvedBudget)}</td>
                      <td className="px-4 py-2 text-right">{peso(r.sapActual)}</td>
                      <td className="px-4 py-2 text-slate-600">{r.statusText}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white">
            <div className="border-b border-slate-100 px-4 py-3 text-xs font-semibold tracking-wide text-slate-500">
              Unmapped SAP Actuals
              {reconciliation && reconciliation.unmapped.length > 0 && <span className="ml-1.5 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold text-amber-800">{reconciliation.unmapped.length} pending</span>}
            </div>
            {!reconciliation || reconciliation.unmapped.length === 0 ? (
              <div className="px-4 py-6 text-center text-sm text-slate-400">{reconciliation ? "0 exceptions pending." : "Loading…"}</div>
            ) : (
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-xs tracking-wide text-slate-500">
                  <tr>
                    <th className="px-4 py-2 text-left">Item Text</th>
                    <th className="px-4 py-2 text-left">GL-CC</th>
                    <th className="px-4 py-2 text-right">Amount</th>
                    {isBudgetOfficer && <th className="px-4 py-2 text-left">Map to</th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {reconciliation.unmapped.map((u) => (
                    <tr key={u.id}>
                      <td className="px-4 py-2 text-amber-700">{u.itemText}</td>
                      <td className="px-4 py-2 text-slate-500">
                        {u.glAccount} / {u.costCenter}
                      </td>
                      <td className="px-4 py-2 text-right">{peso(u.amount)}</td>
                      {isBudgetOfficer && (
                        <td className="px-4 py-2">
                          {mappingId === u.id ? (
                            <div className="w-64">
                              <SearchableSelect placeholder="Select expense line item…" options={reconciliation.lineItems.map((li) => ({ value: li.id, label: li.name }))} value="" disabled={mapMutation.isPending} onChange={(v) => mapMutation.mutate({ transactionId: u.id, expenseLineItemId: v })} />
                            </div>
                          ) : (
                            <button onClick={() => setMappingId(u.id)} className="rounded border border-slate-300 px-2 py-1 text-xs text-slate-600 hover:bg-slate-100">
                              Map…
                            </button>
                          )}
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {effectiveNpcSbu && tab === "npc" && (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-2 text-left">Budget Code</th>
                <th className="px-4 py-2 text-left">Project Title</th>
                <th className="px-4 py-2 text-right">Amount (VAT excl.)</th>
                <th className="px-4 py-2 text-left">Location</th>
                <th className="px-4 py-2 text-left">SBU</th>
                <th className="px-4 py-2 text-left">IO Code</th>
                <th className="px-4 py-2 text-right">IO Amount</th>
                <th className="px-4 py-2 text-right">Balance</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {npcLoading ? (
                <tr>
                  <td colSpan={8} className="px-4 py-6 text-center text-slate-400">
                    Loading…
                  </td>
                </tr>
              ) : npcRows.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-6 text-center text-slate-400">
                    No approved NPC budget codes for this SBU yet.
                  </td>
                </tr>
              ) : (
                npcRows.map((r) => (
                  <tr key={r.budgetCode}>
                    <td className="px-4 py-2 font-mono text-xs text-emerald-700">{r.budgetCode}</td>
                    <td className="px-4 py-2">{r.projectTitle}</td>
                    <td className="px-4 py-2 text-right">{peso(r.amount)}</td>
                    <td className="px-4 py-2">{r.location ?? "—"}</td>
                    <td className="px-4 py-2">{r.sbu}</td>
                    <td className="px-4 py-2 font-mono text-xs text-slate-600">{r.ioCodes.length > 0 ? r.ioCodes.join(", ") : "—"}</td>
                    <td className="px-4 py-2 text-right">{peso(r.ioAmount)}</td>
                    <td className={`px-4 py-2 text-right font-medium ${r.balance < 0 ? "text-red-600" : ""}`}>{peso(r.balance)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
