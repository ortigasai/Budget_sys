import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { BoardApprovedGrid } from "../components/BoardApprovedGrid";
import { ConsolidatedTotalsTables, approvedProposedLookup } from "../components/ConsolidatedTotalsTables";
import { api, SBU_OPTIONS, type BudgetRequest, type FinalizedBudgetReport, type RequestCategory, type Sbu } from "../api/client";
import { SBU_BATCH_TYPES } from "../components/SbuTypeSwitch";
import { PageHeader } from "../components/PageHeader";
import { useAuth } from "../context/AuthContext";
import { useFiscalYear } from "../lib/fiscalCycle";

interface BoardBudgetRow {
  id: string;
  fiscalYear: number;
  amount: number;
  requestCategory: RequestCategory;
  sbu: Sbu | null;
  setAt: string;
}


export function Step5DashboardPage() {
  const { hasRole } = useAuth();
  // BCA members can view this whole section and extract reports (see
  // requireRoleOrAccess("finalization") on the read routes), but
  // Board-Approved edits stay Budget-Officer-only.
  const canEdit = hasRole("BUDGET_OFFICER");
  const { targetYear: FISCAL_YEAR } = useFiscalYear();
  const { data: allRequests = [] } = useQuery({
    queryKey: ["step5-dashboard"],
    queryFn: async () => (await api.get<BudgetRequest[]>("/budget-requests/step5-dashboard")).data,
  });
  const { data: boardBudget } = useQuery({
    queryKey: ["board-approved-budget", FISCAL_YEAR],
    queryFn: async () => (await api.get<{ history: BoardBudgetRow[] }>(`/admin/board-approved-budget?fiscalYear=${FISCAL_YEAR}`)).data,
  });

  // Notes_8: GAE / DOE / Revenue selector, with DOE and Revenue further
  // split by the 5 SBUs — "All" shows every SBU's requests together with a
  // per-SBU Board-Approved Budget breakdown instead of one combined figure.
  // Notes_9: the GAE/DOE/Revenue picker itself moved to the sidebar
  // sub-menu (Layout.tsx's Step5SubMenu), driven by this same `?category=`
  // query param, so the page just reads it instead of owning the state.
  // No ?category= at all means "haven't picked a category yet" - shows a
  // picker prompt below instead of silently defaulting to GAE, same as New
  // Request/Forecast. GAE is only shown once explicitly chosen
  // (?category=GAE, same as every other category).
  // Each category's own Finalize & Upload / Return pending list lives on
  // its own "Pending Requests" sidebar page now (including NPC's - see
  // Step5PendingRequestsPage.tsx / PendingFinalizationList.tsx). This page
  // is just the Board-Approved figures for GAE and the SBU-scoped
  // categories (NPC has no Board-Approved grid of its own).
  const [searchParams] = useSearchParams();
  const categoryParam = searchParams.get("category");
  // SBU_BATCH_TYPES covers DOE/Commission/Cost of Sales/Depreciation &
  // Amortization/Interest Expense - all SBU-scoped, same board-approved-
  // budget-breakdown shape Revenue already has.
  const sbuBatchCategoryValues = new Set<string>(SBU_BATCH_TYPES.map((t) => t.category));
  // "SBU" is the combined sidebar entry (Consolidated Board-Approved P&L) for
  // GAE plus every SBU-scoped category (all SBU batch types and Revenue) - one
  // Board-Approved grid covers them together.
  const sbuAll = categoryParam === "SBU";
  const sbuCategories: RequestCategory[] = sbuAll ? ["GAE", ...SBU_BATCH_TYPES.map((t) => t.category as RequestCategory), "REVENUE"] : [];
  const category: RequestCategory | null =
    categoryParam === "GAE" || categoryParam === "REVENUE" || sbuBatchCategoryValues.has(categoryParam as RequestCategory) ? (categoryParam as RequestCategory) : null;
  const usesSbuBreakdown = sbuAll || category === "REVENUE" || sbuBatchCategoryValues.has(category as RequestCategory);
  const [sbuFilter, setSbuFilter] = useState<Sbu | "ALL">("ALL");

  useEffect(() => {
    setSbuFilter("ALL");
  }, [category]);

  // Finalized (approved) amounts for the Consolidated P&L's Total and Variance tables.
  const { data: finalizedReport } = useQuery({
    queryKey: ["finalized-budget-report", FISCAL_YEAR, "CONSOLIDATED"],
    queryFn: async () => (await api.get<FinalizedBudgetReport>("/budget-requests/finalized-budget-report", { params: { fiscalYear: FISCAL_YEAR } })).data,
    enabled: sbuAll,
  });

  // One SBU: the editable grid also shows Total Approved and Proposed, Variance and % beside its board amounts.
  const consolidatedLookup = approvedProposedLookup(
    allRequests.filter((r) => sbuCategories.includes(r.requestCategory)),
    (finalizedReport?.lines ?? []).filter((l) => sbuCategories.includes(l.requestCategory)),
  );

  if (category === null && !sbuAll) {
    return (
      <div className="space-y-6">
        <PageHeader subtitle="Choose a category to get started." />
        <div className="rounded-lg border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500 shadow-sm">
          Select a category from the menu on the left to begin.
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {usesSbuBreakdown && (
        <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex flex-wrap gap-2">
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
      )}

      <div className="space-y-6">
        <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
          <h3 className="mb-3 text-sm font-semibold text-slate-800">Board-Approved P&amp;L</h3>
          <BoardApprovedGrid fiscalYear={FISCAL_YEAR} history={boardBudget?.history ?? []} sbuFilter={sbuFilter} actual={sbuAll && sbuFilter !== "ALL" ? consolidatedLookup : undefined} readOnly={!canEdit} />
        </div>

        {sbuAll && sbuFilter === "ALL" && (
          <ConsolidatedTotalsTables
            history={boardBudget?.history ?? []}
            requests={allRequests.filter((r) => sbuCategories.includes(r.requestCategory))}
            finalized={(finalizedReport?.lines ?? []).filter((l) => sbuCategories.includes(l.requestCategory))}
          />
        )}
      </div>
    </div>
  );
}
