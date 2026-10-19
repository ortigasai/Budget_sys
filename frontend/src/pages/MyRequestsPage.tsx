import { Fragment, useCallback, useMemo } from "react";
import { SortableHeader } from "../components/SortableHeader";
import { ColumnFilterCell, FilterStatus } from "../components/ColumnFilters";
import { useColumnFilters } from "../lib/useColumnFilters";
import { useTableSort } from "../lib/useTableSort";
import { useQueries, useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api, downloadFile, requestLineDisplay, type AdditionalHeadcountRequest, type BudgetRequest, type DoeBatchDetail, type MobilePhoneBudgetRequest, type Office365AccountRequest, type RevenueBatchSummary } from "../api/client";
import { STAGE_LABELS, StatusBadge } from "../components/StatusBadge";
import { PageHeader } from "../components/PageHeader";
import { SBU_BATCH_TYPES } from "../components/SbuTypeSwitch";
import { STAGE_LABELS as REVENUE_STAGE_LABELS } from "./newRequest/RevenueRequestTab";

const REQUEST_CATEGORY_LABELS: Record<string, string> = {
  GAE: "GAE",
  DOE: "DOE",
  NPC: "NPC",
  REVENUE: "Revenue",
  COMMISSION: "Commission",
  COST_OF_SALES: "Cost of Sales",
  DEPRECIATION_AMORTIZATION: "Depreciation & Amortization",
  INTEREST_EXPENSE: "Interest Expense",
};

const MY_REQUEST_COLUMNS = [
  { key: "type", label: "Type" },
  { key: "item", label: "Item" },
  { key: "ticket", label: "Ticket #" },
  { key: "budgetCode", label: "Budget Code" },
  { key: "proposed", label: "Proposed Amount", numeric: true },
  { key: "cut", label: "Budget Cut", numeric: true },
  { key: "approved", label: "Approved Amount", numeric: true },
  { key: "stage", label: "Stage" },
  { key: "sap", label: "SAP Doc #" },
];

// This page only queried /budget-requests/my-requests, so Additional
// Headcount Requests — a separate model with its own workflow — never
// showed up here even though the requestor submitted them. Once approved, a
// headcount request also auto-generates an Office 365 Account request and a
// Mobile Phone budget request (see headcountWorkflowService.ts) — separate
// models, but they exist *because of* that one headcount request, so they're
// nested underneath it as a sub-section rather than sorted in as their own
// top-level rows.
// Note 11 §16 follow-up - Revenue's own "My Revenue Requests" list (inside
// the New Request/Forecast Revenue tab) was removed; revenue batches now
// show here as a third row kind instead, same as headcount above. DOE's
// analogous "Upload Template" flow (now generalized - see
// SbuBatchUploadTab.tsx/doeBatches.ts's createSbuBatchRouter - to also cover
// Commission/Cost of Sales/Depreciation & Amortization/Interest Expense)
// adds a fourth kind, but only for batches still in DRAFT - once a batch is
// submitted its rows fan out into that category's normal per-row review
// (unlike Revenue, which always keeps a batch's rows in lockstep, even once
// APPROVED), so a submitted batch's rows just show up as ordinary "budget"
// rows below, same as a manually-created request of that category always
// has.
type TopLevelRow =
  | { kind: "budget"; id: string; createdAt: string; data: BudgetRequest }
  | {
      kind: "headcount";
      id: string;
      createdAt: string;
      data: AdditionalHeadcountRequest;
      office365: Office365AccountRequest | null;
      mobilePhone: MobilePhoneBudgetRequest | null;
    }
  | { kind: "revenue"; id: string; createdAt: string; data: RevenueBatchSummary }
  | { kind: "sbu-batch"; id: string; createdAt: string; data: DoeBatchDetail; tab: string; label: string };

export function MyRequestsPage() {
  const { data: budgetRequests = [], isLoading: budgetLoading } = useQuery({
    queryKey: ["my-requests"],
    queryFn: async () => (await api.get<BudgetRequest[]>("/budget-requests/my-requests")).data,
  });
  const { data: headcountRequests = [], isLoading: headcountLoading } = useQuery({
    queryKey: ["additional-headcount", "my-requests"],
    queryFn: async () => (await api.get<AdditionalHeadcountRequest[]>("/additional-headcount/my-requests")).data,
  });
  const { data: office365Requests = [], isLoading: office365Loading } = useQuery({
    queryKey: ["additional-headcount", "office365", "my-requests"],
    queryFn: async () => (await api.get<Office365AccountRequest[]>("/additional-headcount/office365/my-requests")).data,
  });
  const { data: mobilePhoneRequests = [], isLoading: mobilePhoneLoading } = useQuery({
    queryKey: ["additional-headcount", "mobile-phone-budget", "my-requests"],
    queryFn: async () => (await api.get<MobilePhoneBudgetRequest[]>("/additional-headcount/mobile-phone-budget/my-requests")).data,
  });
  // Same query key RevenueRequestTab's own mutations already invalidate
  // (upload/override/submit/cancel), so this list stays fresh after any of
  // those actions even though it's rendered from a different page now.
  const { data: revenueBatches = [], isLoading: revenueLoading } = useQuery({
    queryKey: ["revenue-batches", "mine"],
    queryFn: async () => (await api.get<RevenueBatchSummary[]>("/revenue-batches/mine")).data,
  });
  // One query per SBU-batch category (DOE, Commission, Cost of Sales,
  // Depreciation & Amortization, Interest Expense) - same query keys each
  // category's own SbuBatchUploadTab mutations already invalidate.
  const sbuBatchQueries = useQueries({
    queries: SBU_BATCH_TYPES.map((t) => ({
      queryKey: [t.apiPath, "mine"],
      queryFn: async () => (await api.get<DoeBatchDetail[]>(`/${t.apiPath}/mine`)).data,
    })),
  });
  const sbuBatchLoading = sbuBatchQueries.some((q) => q.isLoading);
  const sbuBatchRows = useMemo(
    () =>
      SBU_BATCH_TYPES.flatMap((t, i) => (sbuBatchQueries[i].data ?? []).map((r) => ({ kind: "sbu-batch" as const, id: r.id, createdAt: r.createdAt, data: r, tab: t.tab, label: t.label }))),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sbuBatchQueries.map((q) => q.data)]
  );

  // Revenue rows are always shown as the aggregated "revenue" batch row
  // below (every stage, including APPROVED) rather than individually -
  // /budget-requests/my-requests returns every BudgetRequest unfiltered, so
  // without this a Revenue line item would show up twice: once here, once
  // inside its batch row.
  const displayedBudgetRequests = useMemo(() => budgetRequests.filter((r) => r.requestCategory !== "REVENUE"), [budgetRequests]);

  const isLoading = budgetLoading || headcountLoading || office365Loading || mobilePhoneLoading || revenueLoading || sbuBatchLoading;
  const rows = useMemo<TopLevelRow[]>(() => {
    const combined: TopLevelRow[] = [
      ...displayedBudgetRequests.map((r) => ({ kind: "budget" as const, id: r.id, createdAt: r.createdAt, data: r })),
      ...headcountRequests.map((r) => ({
        kind: "headcount" as const,
        id: r.id,
        createdAt: r.createdAt,
        data: r,
        office365: office365Requests.find((o) => o.additionalHeadcountRequest.id === r.id) ?? null,
        mobilePhone: mobilePhoneRequests.find((m) => m.additionalHeadcountRequest.id === r.id) ?? null,
      })),
      ...revenueBatches.map((r) => ({ kind: "revenue" as const, id: r.id, createdAt: r.createdAt, data: r })),
      ...sbuBatchRows,
    ];
    return combined.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }, [displayedBudgetRequests, headcountRequests, office365Requests, mobilePhoneRequests, revenueBatches, sbuBatchRows]);

  const totalCount = displayedBudgetRequests.length + headcountRequests.length + office365Requests.length + mobilePhoneRequests.length + revenueBatches.length + sbuBatchRows.length;

  // What each column shows, per row kind - shared by sorting and the per-column filters.
  const getValue = useCallback((row: TopLevelRow, key: string): string | number | null => {
    if (row.kind === "headcount") {
      const d = row.data;
      return { type: "Additional Manpower", item: `${d.code} — ${d.position} (Rank ${d.rank})`, stage: STAGE_LABELS[d.currentStage] ?? d.currentStage }[key] ?? null;
    }
    if (row.kind === "revenue" || row.kind === "sbu-batch") {
      const d = row.data;
      const item = `${d.sbu} — ${d.company?.name ?? "—"}${row.kind === "sbu-batch" ? ` (${d.rowCount} line${d.rowCount === 1 ? "" : "s"})` : ""}`;
      const stage = row.kind === "revenue" ? (REVENUE_STAGE_LABELS[d.currentStage] ?? d.currentStage) : (STAGE_LABELS[d.currentStage] ?? d.currentStage);
      return { type: row.kind === "revenue" ? "Revenue" : `${row.label} (Draft)`, item, proposed: d.totalAmount, stage }[key] ?? null;
    }
    const d = row.data;
    switch (key) {
      case "type":
        return REQUEST_CATEGORY_LABELS[d.requestCategory] ?? d.requestCategory;
      case "item":
        return requestLineDisplay(d).name;
      case "ticket":
        return d.ticketNumber ?? null;
      case "budgetCode":
        return requestLineDisplay(d).budgetCode ?? null;
      case "proposed":
        return d.proposedAmount;
      case "cut":
        return d.budgetCutAmount;
      case "approved":
        return d.proposedAmount - d.budgetCutAmount;
      case "stage":
        return STAGE_LABELS[d.currentStage] ?? d.currentStage;
      case "sap":
        return d.sapDocumentNumber ?? null;
      default:
        return null;
    }
  }, []);
  const { filtered: visibleRows, filters, setFilter, clearFilters, activeCount } = useColumnFilters(rows, getValue);
  const { sorted, sortKey, sortDir, toggle } = useTableSort(visibleRows, getValue);

  return (
    <div className="space-y-4">
      <PageHeader subtitle={`${totalCount} request(s) submitted`} />
      {isLoading ? (
        <div className="text-sm text-slate-400">Loading…</div>
      ) : rows.length === 0 ? (
        <div className="rounded-lg border border-dashed border-slate-300 bg-white/60 p-6 text-center text-sm text-slate-400">No requests yet.</div>
      ) : (
        <>
        <FilterStatus count={visibleRows.length} total={rows.length} activeCount={activeCount} onClear={clearFilters} />
        <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead className="bg-emerald-50 text-left text-xs tracking-wide text-emerald-800">
              <tr>
                <SortableHeader label="Type" sortKey="type" activeKey={sortKey} dir={sortDir} onToggle={toggle} className="px-4 py-2" />
                <SortableHeader label="Item" sortKey="item" activeKey={sortKey} dir={sortDir} onToggle={toggle} className="px-4 py-2" />
                <SortableHeader label="Ticket #" sortKey="ticket" activeKey={sortKey} dir={sortDir} onToggle={toggle} className="px-4 py-2" />
                <SortableHeader label="Budget Code" sortKey="budgetCode" activeKey={sortKey} dir={sortDir} onToggle={toggle} className="px-4 py-2" />
                <SortableHeader label="Proposed Amount" sortKey="proposed" activeKey={sortKey} dir={sortDir} onToggle={toggle} align="right" className="px-4 py-2" />
                <SortableHeader label="Budget Cut" sortKey="cut" activeKey={sortKey} dir={sortDir} onToggle={toggle} align="right" className="px-4 py-2" />
                <SortableHeader label="Approved Amount" sortKey="approved" activeKey={sortKey} dir={sortDir} onToggle={toggle} align="right" className="px-4 py-2" />
                <SortableHeader label="Stage" sortKey="stage" activeKey={sortKey} dir={sortDir} onToggle={toggle} className="px-4 py-2" />
                <SortableHeader label="SAP Doc #" sortKey="sap" activeKey={sortKey} dir={sortDir} onToggle={toggle} className="px-4 py-2" />
              </tr>
              <tr className="border-t border-emerald-100 bg-white">
                {MY_REQUEST_COLUMNS.map((c) => (
                  <ColumnFilterCell key={c.key} columnKey={c.key} label={c.label} numeric={c.numeric} filters={filters} onChange={setFilter} />
                ))}
              </tr>
            </thead>
            <tbody>
              {sorted.map((row, i) => (
                <Fragment key={row.id}>
                  <tr className={`border-t border-slate-100 ${i % 2 === 1 ? "bg-slate-50/60" : ""}`}>
                    {row.kind === "budget" ? (
                      <>
                        <td className="px-4 py-2 text-xs font-medium text-slate-500">{REQUEST_CATEGORY_LABELS[row.data.requestCategory] ?? row.data.requestCategory}</td>
                        <td className="px-4 py-2">
                          <Link to={`/requests/${row.data.id}`} className="font-medium text-emerald-800 hover:underline">
                            {requestLineDisplay(row.data).name}
                          </Link>
                          {row.data.bulkUploadBatch && (
                            <button
                              onClick={() => downloadFile(`/budget-requests/bulk-upload/${row.data.bulkUploadBatch!.id}/source-file`, row.data.bulkUploadBatch!.sourceFileRef)}
                              className="block text-xs text-emerald-700 hover:underline"
                            >
                              Download source file
                            </button>
                          )}
                        </td>
                        <td className="px-4 py-2 text-slate-500">{row.data.ticketNumber ?? "—"}</td>
                        <td className="px-4 py-2 text-slate-500">{requestLineDisplay(row.data).budgetCode ?? "—"}</td>
                        <td className="px-4 py-2 font-medium text-slate-700">{row.data.proposedAmount.toLocaleString(undefined, { maximumFractionDigits: 0 })}</td>
                        {/* Notes_10: "Budget Cut" and "Approved Amount" —
                            only the Budget Officer can set budgetCutAmount
                            (enforced at /budget-requests/:id/budget-cut,
                            requireRole(BUDGET_OFFICER), applied at Step5);
                            this just surfaces what they set, net of it. */}
                        <td className="px-4 py-2 text-slate-500">{row.data.budgetCutAmount > 0 ? `${row.data.budgetCutAmount.toLocaleString(undefined, { maximumFractionDigits: 0 })}` : "—"}</td>
                        <td className="px-4 py-2 font-medium text-emerald-800">{(row.data.proposedAmount - row.data.budgetCutAmount).toLocaleString(undefined, { maximumFractionDigits: 0 })}</td>
                        <td className="px-4 py-2">
                          <StatusBadge stage={row.data.currentStage} />
                          <PendingReviewers names={row.data.pendingReviewers} />
                        </td>
                        <td className="px-4 py-2 text-slate-500">{row.data.sapDocumentNumber ?? "—"}</td>
                      </>
                    ) : row.kind === "headcount" ? (
                      <>
                        <td className="px-4 py-2 text-xs font-medium text-slate-500">Additional Manpower</td>
                        <td className="px-4 py-2">
                          <Link to={`/requests/headcount/${row.data.id}`} className="font-medium text-emerald-800 hover:underline">
                            {row.data.code} — {row.data.position} (Rank {row.data.rank})
                          </Link>
                        </td>
                        {/* Notes_11: Additional Manpower requests carry no
                            dollar amount / SAP figure of their own — N/A
                            (not "—") makes explicit these columns just don't
                            apply here, rather than reading as missing data. */}
                        <td className="px-4 py-2 text-slate-400">N/A</td>
                        <td className="px-4 py-2 text-slate-400">N/A</td>
                        <td className="px-4 py-2 text-slate-400">N/A</td>
                        <td className="px-4 py-2 text-slate-400">N/A</td>
                        <td className="px-4 py-2 text-slate-400">N/A</td>
                        <td className="px-4 py-2">
                          <StatusBadge stage={row.data.currentStage} />
                          <PendingReviewers names={row.data.pendingReviewers} />
                        </td>
                        <td className="px-4 py-2 text-slate-400">N/A</td>
                      </>
                    ) : row.kind === "revenue" ? (
                      <>
                        <td className="px-4 py-2 text-xs font-medium text-slate-500">Revenue</td>
                        <td className="px-4 py-2">
                          <Link to={`/requests/new?tab=revenue&batch=${row.data.id}`} className="font-medium text-emerald-800 hover:underline">
                            {row.data.sbu} — {row.data.company?.name ?? "—"}
                          </Link>
                        </td>
                        {/* Revenue batches carry a total tied to the
                            Board-Approved Budget, not a per-line budget code/
                            cut/approved-amount split - N/A for the columns
                            that don't apply, same convention headcount uses
                            above. */}
                        <td className="px-4 py-2 text-slate-400">N/A</td>
                        <td className="px-4 py-2 text-slate-400">N/A</td>
                        <td className="px-4 py-2 font-medium text-slate-700">{row.data.totalAmount.toLocaleString(undefined, { maximumFractionDigits: 0 })}</td>
                        <td className="px-4 py-2 text-slate-400">N/A</td>
                        <td className="px-4 py-2 text-slate-400">N/A</td>
                        <td className="px-4 py-2">{REVENUE_STAGE_LABELS[row.data.currentStage] ?? row.data.currentStage}</td>
                        <td className="px-4 py-2 text-slate-400">N/A</td>
                      </>
                    ) : (
                      <>
                        <td className="px-4 py-2 text-xs font-medium text-slate-500">{row.label} (Draft)</td>
                        <td className="px-4 py-2">
                          <Link to={`/requests/new?tab=${row.tab}&batch=${row.data.id}`} className="font-medium text-emerald-800 hover:underline">
                            {row.data.sbu} — {row.data.company?.name ?? "—"} ({row.data.rowCount} line{row.data.rowCount === 1 ? "" : "s"})
                          </Link>
                        </td>
                        {/* A batch's rows keep their own individual Budget
                            Code/Budget Cut/Approved Amount once submitted -
                            this row only exists pre-submit, so N/A for the
                            same reason Revenue's does above. */}
                        <td className="px-4 py-2 text-slate-400">N/A</td>
                        <td className="px-4 py-2 text-slate-400">N/A</td>
                        <td className="px-4 py-2 font-medium text-slate-700">{row.data.totalAmount.toLocaleString(undefined, { maximumFractionDigits: 0 })}</td>
                        <td className="px-4 py-2 text-slate-400">N/A</td>
                        <td className="px-4 py-2 text-slate-400">N/A</td>
                        <td className="px-4 py-2">
                          <StatusBadge stage={row.data.currentStage} />
                        </td>
                        <td className="px-4 py-2 text-slate-400">N/A</td>
                      </>
                    )}
                  </tr>
                  {row.kind === "headcount" && row.office365 && (
                    <tr className="border-t border-dashed border-slate-100 bg-slate-50/40">
                      <td className="px-4 py-1.5 pl-8 text-xs text-slate-400">
                        <span className="mr-1 text-slate-300">↳</span>Office 365 Account
                      </td>
                      <td className="px-4 py-1.5">
                        <Link to={`/requests/headcount/${row.data.id}`} className="text-slate-500 hover:underline">
                          Follow-on of {row.data.code} — {row.data.position}
                        </Link>
                      </td>
                      <td className="px-4 py-1.5 text-slate-400">—</td>
                      <td className="px-4 py-1.5 text-slate-400">—</td>
                      <td className="px-4 py-1.5 text-slate-400">—</td>
                      <td className="px-4 py-1.5 text-slate-400">—</td>
                      <td className="px-4 py-1.5">
                        <StatusBadge stage={row.office365.stage} />
                      </td>
                      <td className="px-4 py-1.5 text-slate-400">—</td>
                    </tr>
                  )}
                  {row.kind === "headcount" && row.mobilePhone && (
                    <tr className="border-t border-dashed border-slate-100 bg-slate-50/40">
                      <td className="px-4 py-1.5 pl-8 text-xs text-slate-400">
                        <span className="mr-1 text-slate-300">↳</span>Mobile Phone Budget
                      </td>
                      <td className="px-4 py-1.5">
                        <Link to={`/requests/headcount/${row.data.id}`} className="text-slate-500 hover:underline">
                          Follow-on of {row.data.code} — {row.data.position}
                        </Link>
                      </td>
                      <td className="px-4 py-1.5 text-slate-400">—</td>
                      <td className="px-4 py-1.5 text-slate-400">—</td>
                      <td className="px-4 py-1.5 text-slate-400">—</td>
                      <td className="px-4 py-1.5 text-slate-400">—</td>
                      <td className="px-4 py-1.5">
                        <StatusBadge stage={row.mobilePhone.stage} />
                      </td>
                      <td className="px-4 py-1.5 text-slate-400">—</td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
        </>
      )}
    </div>
  );
}

// Who's currently holding up a request, resolved server-side from its stage
// + department (see backend's lib/pendingReviewers.ts) - only meaningful
// alongside a non-terminal StatusBadge, so it renders nothing when the list
// is empty (DRAFT, or already APPROVED/REJECTED/CANCELLED).
function PendingReviewers({ names }: { names?: string[] }) {
  if (!names || names.length === 0) return null;
  return <div className="mt-1 text-xs text-slate-500">Pending: {names.join(",")}</div>;
}
