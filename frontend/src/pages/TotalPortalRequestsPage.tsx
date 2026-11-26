import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { api } from "../api/client";
import { PageHeader } from "../components/PageHeader";
import { PortalRequestsTable, type PoolConsumingRequest } from "../components/PortalRequestsList";
import { useFiscalYear } from "../lib/fiscalCycle";

interface TotalsRequests {
  fiscalYear: number;
  groups: { department: { id: string; name: string }; total: number; requests: PoolConsumingRequest[] }[];
}

const peso = (n: number) => Math.round(n).toLocaleString();

// Drill-down behind the Budget Officer Home page's "GAE Portal Approved and
// Pending Requests" tile: every request consuming a centralized department's
// pool, grouped by the department that owns the expense line item.
export function TotalPortalRequestsPage() {
  const [searchParams] = useSearchParams();
  const { targetYear } = useFiscalYear();
  const fiscalYear = Number(searchParams.get("fiscalYear") ?? targetYear);

  const { data, isLoading } = useQuery({
    queryKey: ["dashboard", "totals", fiscalYear, "requests"],
    queryFn: async () => (await api.get<TotalsRequests>("/dashboard/totals/requests", { params: { fiscalYear } })).data,
  });
  const groups = data?.groups ?? [];
  const grandTotal = groups.reduce((s, g) => s + g.total, 0);
  const count = groups.reduce((s, g) => s + g.requests.length, 0);

  return (
    <div className="space-y-4">
      <PageHeader
        subtitle={
          <>
            <span className="font-medium text-slate-700">{fiscalYear} GAE Portal Approved and Pending Requests</span> — all centralized departments,
            grouped by the department that owns the expense line item
          </>
        }
      />
      {isLoading ? (
        <div className="text-sm text-slate-400">Loading…</div>
      ) : groups.length === 0 ? (
        <div className="rounded-lg border border-slate-200 bg-white p-4 text-sm text-slate-500">No GAE requests are currently consuming any department's pool.</div>
      ) : (
        <>
          <div className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800">
            <span className="font-bold">{peso(grandTotal)}</span> across {count} request{count === 1 ? "" : "s"} in {groups.length} department
            {groups.length === 1 ? "" : "s"}, net of budget cuts. Drafts, returned, disapproved and cancelled requests are not counted.
          </div>
          {groups.map((g) => (
            <section key={g.department.id} className="space-y-2">
              <h2 className="flex items-baseline justify-between text-sm font-semibold text-slate-700">
                <span>{g.department.name}</span>
                <span className="text-slate-500">{peso(g.total)}</span>
              </h2>
              <PortalRequestsTable requests={g.requests} />
            </section>
          ))}
        </>
      )}
    </div>
  );
}
