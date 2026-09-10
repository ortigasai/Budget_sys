import { Fragment, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api, type AdditionalHeadcountRequest, type BudgetRequest, type MobilePhoneBudgetRequest, type Office365AccountRequest } from "../api/client";
import { StatusBadge } from "../components/StatusBadge";
import { PageHeader } from "../components/PageHeader";

const REQUEST_CATEGORY_LABELS: Record<string, string> = {
  GAE: "GAE",
  DOE: "DOE",
  NPC: "NPC",
  REVENUE: "Revenue",
};

// This page only queried /budget-requests/my-requests, so Additional
// Headcount Requests — a separate model with its own workflow — never
// showed up here even though the requestor submitted them. Once approved, a
// headcount request also auto-generates an Office 365 Account request and a
// Mobile Phone budget request (see headcountWorkflowService.ts) — separate
// models, but they exist *because of* that one headcount request, so they're
// nested underneath it as a sub-section rather than sorted in as their own
// top-level rows.
type TopLevelRow =
  | { kind: "budget"; id: string; createdAt: string; data: BudgetRequest }
  | {
      kind: "headcount";
      id: string;
      createdAt: string;
      data: AdditionalHeadcountRequest;
      office365: Office365AccountRequest | null;
      mobilePhone: MobilePhoneBudgetRequest | null;
    };

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

  const isLoading = budgetLoading || headcountLoading || office365Loading || mobilePhoneLoading;
  const rows = useMemo<TopLevelRow[]>(() => {
    const combined: TopLevelRow[] = [
      ...budgetRequests.map((r) => ({ kind: "budget" as const, id: r.id, createdAt: r.createdAt, data: r })),
      ...headcountRequests.map((r) => ({
        kind: "headcount" as const,
        id: r.id,
        createdAt: r.createdAt,
        data: r,
        office365: office365Requests.find((o) => o.additionalHeadcountRequest.id === r.id) ?? null,
        mobilePhone: mobilePhoneRequests.find((m) => m.additionalHeadcountRequest.id === r.id) ?? null,
      })),
    ];
    return combined.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }, [budgetRequests, headcountRequests, office365Requests, mobilePhoneRequests]);

  const totalCount = budgetRequests.length + headcountRequests.length + office365Requests.length + mobilePhoneRequests.length;

  return (
    <div className="space-y-4">
      <PageHeader subtitle={`${totalCount} request(s) submitted`} />
      {isLoading ? (
        <div className="text-sm text-slate-400">Loading…</div>
      ) : rows.length === 0 ? (
        <div className="rounded-lg border border-dashed border-slate-300 bg-white/60 p-6 text-center text-sm text-slate-400">No requests yet.</div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead className="bg-emerald-50 text-left text-xs tracking-wide text-emerald-800">
              <tr>
                <th className="px-4 py-2">Type</th>
                <th className="px-4 py-2">Item</th>
                <th className="px-4 py-2">Budget Code</th>
                <th className="px-4 py-2">Proposed Amount</th>
                <th className="px-4 py-2">Budget Cut</th>
                <th className="px-4 py-2">Approved Amount</th>
                <th className="px-4 py-2">Stage</th>
                <th className="px-4 py-2">SAP Doc #</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <Fragment key={row.id}>
                  <tr className={`border-t border-slate-100 ${i % 2 === 1 ? "bg-slate-50/60" : ""}`}>
                    {row.kind === "budget" ? (
                      <>
                        <td className="px-4 py-2 text-xs font-medium text-slate-500">{REQUEST_CATEGORY_LABELS[row.data.requestCategory] ?? row.data.requestCategory}</td>
                        <td className="px-4 py-2">
                          <Link to={`/requests/${row.data.id}`} className="font-medium text-emerald-800 hover:underline">
                            {row.data.expenseLineItem.name}
                          </Link>
                        </td>
                        <td className="px-4 py-2 text-slate-500">{row.data.budgetCode ?? row.data.expenseLineItem.budgetCode ?? "—"}</td>
                        <td className="px-4 py-2 font-medium text-slate-700">₱{row.data.proposedAmount.toLocaleString()}</td>
                        {/* Notes_10: "Budget Cut" and "Approved Amount" —
                            only the Budget Officer can set budgetCutAmount
                            (enforced at /budget-requests/:id/budget-cut,
                            requireRole(BUDGET_OFFICER), applied at Step5);
                            this just surfaces what they set, net of it. */}
                        <td className="px-4 py-2 text-slate-500">{row.data.budgetCutAmount > 0 ? `₱${row.data.budgetCutAmount.toLocaleString()}` : "—"}</td>
                        <td className="px-4 py-2 font-medium text-emerald-800">₱{(row.data.proposedAmount - row.data.budgetCutAmount).toLocaleString()}</td>
                        <td className="px-4 py-2">
                          <StatusBadge stage={row.data.currentStage} />
                          <PendingReviewers names={row.data.pendingReviewers} />
                        </td>
                        <td className="px-4 py-2 text-slate-500">{row.data.sapDocumentNumber ?? "—"}</td>
                      </>
                    ) : (
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
                        <td className="px-4 py-2">
                          <StatusBadge stage={row.data.currentStage} />
                          <PendingReviewers names={row.data.pendingReviewers} />
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
