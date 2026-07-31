import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api, type BudgetRequest } from "../api/client";
import { StatusBadge } from "../components/StatusBadge";
import { PageHeader } from "../components/PageHeader";

export function MyRequestsPage() {
  const { data: requests = [], isLoading } = useQuery({
    queryKey: ["my-requests"],
    queryFn: async () => (await api.get<BudgetRequest[]>("/budget-requests/my-requests")).data,
  });

  return (
    <div className="space-y-4">
      <PageHeader title="My Requests" subtitle={`${requests.length} request(s) submitted`} />
      {isLoading ? (
        <div className="text-sm text-slate-400">Loading…</div>
      ) : requests.length === 0 ? (
        <div className="rounded-lg border border-dashed border-slate-300 bg-white/60 p-6 text-center text-sm text-slate-400">
          No requests yet.
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead className="bg-emerald-50 text-left text-xs uppercase tracking-wide text-emerald-800">
              <tr>
                <th className="px-4 py-2">Expense Line Item</th>
                <th className="px-4 py-2">Proposed Amount</th>
                <th className="px-4 py-2">Stage</th>
                <th className="px-4 py-2">SAP Doc #</th>
              </tr>
            </thead>
            <tbody>
              {requests.map((r, i) => (
                <tr key={r.id} className={`border-t border-slate-100 ${i % 2 === 1 ? "bg-slate-50/60" : ""}`}>
                  <td className="px-4 py-2">
                    <Link to={`/requests/${r.id}`} className="font-medium text-emerald-800 hover:underline">
                      {r.expenseLineItem.name}
                    </Link>
                  </td>
                  <td className="px-4 py-2 font-medium text-slate-700">₱{r.proposedAmount.toLocaleString()}</td>
                  <td className="px-4 py-2">
                    <StatusBadge stage={r.currentStage} />
                  </td>
                  <td className="px-4 py-2 text-slate-500">{r.sapDocumentNumber ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
