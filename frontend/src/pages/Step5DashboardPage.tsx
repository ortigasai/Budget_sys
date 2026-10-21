import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { BoardApprovedGrid, type BoardBudgetRow } from "../components/BoardApprovedGrid";
import { BoardApprovedNpcBudget } from "../components/BoardApprovedNpcBudget";
import { ConsolidatedTotalsTables, approvedProposedLookup } from "../components/ConsolidatedTotalsTables";
import { api, downloadFile, SBU_OPTIONS, type BudgetRequest, type FinalizedBudgetReport, type RequestCategory, type Sbu } from "../api/client";
import { SBU_BATCH_TYPES } from "../components/SbuTypeSwitch";
import { PageHeader } from "../components/PageHeader";
import { useAuth } from "../context/AuthContext";
import { useFiscalYear } from "../lib/fiscalCycle";
import { useFinalizationViewScope } from "../lib/finalizationScope";

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
  // NPC rows (per NPC SBU) feed the Board-Approved NPC Budget section only,
  // not the P&L grid or its totals.
  const allBoardHistory = (boardBudget?.history ?? []) as (BoardBudgetRow & { npcSbu?: string | null })[];
  const plBoardHistory = allBoardHistory.filter((h) => (h.requestCategory as string) !== "NPC");

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
  // SBU Finance viewers see only their own SBU(s) - no "All SBUs" view.
  const viewScope = useFinalizationViewScope();
  const sbuChoices = viewScope ? SBU_OPTIONS.filter((o) => viewScope.sbus.includes(o.value)) : SBU_OPTIONS;
  const activeSbu: Sbu | "ALL" = viewScope && (sbuFilter === "ALL" || !viewScope.sbus.includes(sbuFilter)) ? (sbuChoices[0]?.value ?? "ALL") : sbuFilter;

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

  // "Board-Approved NPC Budget" sidebar entry (?category=NPC): its own page.
  if (categoryParam === "NPC") {
    return (
      <div className="space-y-6">
        <PageHeader subtitle={`${FISCAL_YEAR} Board-Approved NPC Budget, one figure per NPC SBU. Reviewers see each NPC request against its SBU's figure in the Inbox.`} />
        <div className="mx-auto max-w-5xl rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
          <div className="mb-3 flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-slate-800">Board-Approved NPC Budget</h3>
            <GenerateReportButton fiscalYear={FISCAL_YEAR} page="NPC" />
          </div>
          <BoardApprovedNpcBudget fiscalYear={FISCAL_YEAR} history={allBoardHistory} readOnly={!canEdit} sbus={viewScope?.npcSbus} />
        </div>
      </div>
    );
  }

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
            {!viewScope && (
              <button onClick={() => setSbuFilter("ALL")} className={`rounded-full px-2.5 py-1 text-xs font-medium ${activeSbu === "ALL" ? "bg-slate-700 text-white" : "border border-slate-300 text-slate-500 hover:bg-slate-50"}`}>
                All SBUs
              </button>
            )}
            {sbuChoices.map((o) => (
              <button key={o.value} onClick={() => setSbuFilter(o.value)} className={`rounded-full px-2.5 py-1 text-xs font-medium ${activeSbu === o.value ? "bg-slate-700 text-white" : "border border-slate-300 text-slate-500 hover:bg-slate-50"}`}>
                {o.label}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="space-y-6">
        <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
          <div className="mb-3 flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-slate-800">Board-Approved P&amp;L</h3>
            {sbuAll && <GenerateReportButton fiscalYear={FISCAL_YEAR} page="PL" sbu={activeSbu === "ALL" ? undefined : activeSbu} />}
          </div>
          <BoardApprovedGrid fiscalYear={FISCAL_YEAR} history={plBoardHistory} sbuFilter={activeSbu} actual={sbuAll && activeSbu !== "ALL" ? consolidatedLookup : undefined} readOnly={!canEdit} />
        </div>

        {sbuAll && activeSbu === "ALL" && (
          <ConsolidatedTotalsTables
            history={plBoardHistory}
            requests={allRequests.filter((r) => sbuCategories.includes(r.requestCategory))}
            finalized={(finalizedReport?.lines ?? []).filter((l) => sbuCategories.includes(l.requestCategory))}
          />
        )}
      </div>
    </div>
  );
}

// "Generate Report": the page as shown, as Excel - the Consolidated P&L for the
// SBU picked above (or every SBU), or the Board-Approved NPC Budget table.
function GenerateReportButton({ fiscalYear, page, sbu }: { fiscalYear: number; page: "PL" | "NPC"; sbu?: Sbu }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const generate = async () => {
    setBusy(true);
    setError(null);
    const qs = new URLSearchParams({ fiscalYear: String(fiscalYear), page });
    if (sbu) qs.set("sbu", sbu);
    const sbuLabel = sbu ? ` - ${SBU_OPTIONS.find((o) => o.value === sbu)?.label ?? sbu}` : "";
    const name = page === "PL" ? `Consolidated Board-Approved P&L ${fiscalYear}${sbuLabel}.xlsx` : `Board-Approved NPC Budget ${fiscalYear}.xlsx`;
    try {
      await downloadFile(`/budget-requests/board-approved-export?${qs.toString()}`, name);
    } catch {
      setError("Failed to generate the report.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex items-center gap-2">
      {error && <span className="text-xs text-red-600">{error}</span>}
      <button
        type="button"
        onClick={generate}
        disabled={busy}
        className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100 disabled:opacity-50"
      >
        {busy ? "Generating…" : "Generate Report"}
      </button>
    </div>
  );
}
