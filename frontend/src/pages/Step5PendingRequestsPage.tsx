import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { PendingFinalizationList } from "../components/PendingFinalizationList";
import { api, NPC_SBU_OPTIONS, SBU_OPTIONS, type BudgetRequest, type NpcSbu, type RequestCategory, type Sbu } from "../api/client";
import { SBU_BATCH_TYPES } from "../components/SbuTypeSwitch";
import { PageHeader } from "../components/PageHeader";
import { useAuth } from "../context/AuthContext";

// GAE plus every SBU-scoped category (all SBU batch types and Revenue), plus
// NPC - every category that goes through Finalize & Upload, all in one list
// now (NPC used to have its own separate page for this).
const SBU_CATEGORIES: RequestCategory[] = ["GAE", ...SBU_BATCH_TYPES.map((t) => t.category as RequestCategory), "REVENUE"];

// GAE (and Depreciation & Amortization / Interest Expense, if/when they gain
// their own bulk-upload tab) are always Corporate but don't carry an actual
// `sbu` value on the request - same fixed-Corporate handling
// FinalizedBudgetReportPage.tsx's CORPORATE_ONLY_CATEGORIES already does.
const CORPORATE_ONLY_CATEGORIES: RequestCategory[] = ["GAE", "DEPRECIATION_AMORTIZATION", "INTEREST_EXPENSE"];

export function Step5PendingRequestsPage() {
  const { hasRole } = useAuth();
  // BCA members can view and extract reports (see requireRoleOrAccess
  // ("finalization") on the read routes), but Finalize & Upload / Return /
  // Budget Cut edits stay Budget-Officer-only.
  const canEdit = hasRole("BUDGET_OFFICER");
  const { data: allRequests = [] } = useQuery({
    queryKey: ["step5-dashboard"],
    queryFn: async () => (await api.get<BudgetRequest[]>("/budget-requests/step5-dashboard")).data,
  });

  const [sbuFilter, setSbuFilter] = useState<Sbu | "ALL">("ALL");
  const [npcHeadFilter, setNpcHeadFilter] = useState<NpcSbu | "ALL">("ALL");

  const sbuRequests = useMemo(
    () =>
      allRequests.filter((r) => {
        if (!SBU_CATEGORIES.includes(r.requestCategory)) return false;
        if (sbuFilter === "ALL") return true;
        if (CORPORATE_ONLY_CATEGORIES.includes(r.requestCategory)) return sbuFilter === "CORPORATE";
        return r.sbu === sbuFilter;
      }),
    [allRequests, sbuFilter],
  );
  const npcRequests = useMemo(
    () => allRequests.filter((r) => r.requestCategory === "NPC" && (npcHeadFilter === "ALL" || r.npcSbu === npcHeadFilter)),
    [allRequests, npcHeadFilter],
  );

  return (
    <div className="space-y-6">
      <PageHeader subtitle="Requests awaiting Finalize & Upload, grouped by department / SBU." />

      <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">GAE / DOE / Commission / Cost of Sales / Depreciation &amp; Amortization / Interest Expense / Revenue — SBU</div>
        <div className="mt-2 flex flex-wrap gap-2">
          <button onClick={() => setSbuFilter("ALL")} className={`rounded-full px-2.5 py-1 text-xs font-medium ${sbuFilter === "ALL" ? "bg-slate-700 text-white" : "border border-slate-300 text-slate-500 hover:bg-slate-50"}`}>
            All SBUs
          </button>
          {SBU_OPTIONS.map((o) => (
            <button key={o.value} onClick={() => setSbuFilter(o.value)} className={`rounded-full px-2.5 py-1 text-xs font-medium ${sbuFilter === o.value ? "bg-slate-700 text-white" : "border border-slate-300 text-slate-500 hover:bg-slate-50"}`}>
              {o.label}
            </button>
          ))}
        </div>
      </div>

      <PendingFinalizationList requests={sbuRequests} canEdit={canEdit} />

      <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">Non-Project Capex (NPC) — SBU</div>
        <div className="mt-2 flex flex-wrap gap-2">
          <button onClick={() => setNpcHeadFilter("ALL")} className={`rounded-full px-2.5 py-1 text-xs font-medium ${npcHeadFilter === "ALL" ? "bg-slate-700 text-white" : "border border-slate-300 text-slate-500 hover:bg-slate-50"}`}>
            All SBUs
          </button>
          {NPC_SBU_OPTIONS.map((o) => (
            <button key={o.value} onClick={() => setNpcHeadFilter(o.value)} className={`rounded-full px-2.5 py-1 text-xs font-medium ${npcHeadFilter === o.value ? "bg-slate-700 text-white" : "border border-slate-300 text-slate-500 hover:bg-slate-50"}`}>
              {o.label}
            </button>
          ))}
        </div>
      </div>

      <PendingFinalizationList requests={npcRequests} canEdit={canEdit} />
    </div>
  );
}
