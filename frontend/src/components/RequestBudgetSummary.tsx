import { useQuery } from "@tanstack/react-query";
import { api } from "../api/client";

interface BudgetSummaryData {
  kind: "NPC" | "GAE";
  fiscalYear: number;
  // NPC SBU label (NPC) or owning centralized department name (GAE).
  scope: string;
  budget: number | null;
  approvedToDate: number;
  approvedCount: number;
  pendingOthers: number;
  pendingCount: number;
  thisRequest: number;
}

const amount = (n: number) => (n < 0 ? `(${Math.round(-n).toLocaleString()})` : Math.round(n).toLocaleString());

// Shown to reviewers beside an NPC or GAE request (Inbox card and the
// request's own page): where it leaves the budget it draws on - its NPC SBU's
// Board-Approved NPC Budget, or its owning department's Departmental Budget
// Cap for GAE (see GET /budget-requests/:id/budget-summary).
export function RequestBudgetSummary({ requestId }: { requestId: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ["budget-summary", requestId],
    queryFn: async () => (await api.get<BudgetSummaryData | null>(`/budget-requests/${requestId}/budget-summary`)).data,
  });
  if (isLoading || !data) return null;

  const npc = data.kind === "NPC";
  const noun = npc ? "NPC" : "GAE";
  const budgetLabel = npc ? "Total Board-Approved NPC Budget" : `${data.fiscalYear} Departmental Budget Cap`;
  if (data.budget === null) {
    return (
      <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
        {npc
          ? `No ${data.fiscalYear} Board-Approved NPC Budget has been set for ${data.scope} yet. The Budget Officer sets it under Board-Approved NPC Budget.`
          : `${data.scope} has no ${data.fiscalYear} Departmental Budget Cap yet - its forecast hasn't been loaded.`}
      </div>
    );
  }
  const available = data.budget - data.approvedToDate - data.pendingOthers;
  const after = available - data.thisRequest;
  const rows: { label: string; value: number; strong?: boolean; warn?: boolean }[] = [
    { label: budgetLabel, value: data.budget },
    { label: `Approved ${noun} Requests to Date (${data.approvedCount})`, value: data.approvedToDate },
    { label: `Other ${noun} Requests Pending Approval (${data.pendingCount})`, value: data.pendingOthers },
    { label: `Available ${noun} Budget`, value: available, strong: true, warn: available < 0 },
    { label: `This ${noun} Request`, value: data.thisRequest },
    { label: "Available After Approving This Request", value: after, strong: true, warn: after < 0 },
  ];
  return (
    <div className={`rounded-lg border p-3 text-sm ${after < 0 ? "border-red-200 bg-red-50/60" : "border-emerald-200 bg-emerald-50/60"}`}>
      <div className="mb-1 text-xs font-semibold text-slate-700">
        {data.fiscalYear} {noun} Budget - {data.scope}
      </div>
      <dl className="divide-y divide-slate-200/70">
        {rows.map((r) => (
          <div key={r.label} className="flex items-center justify-between gap-4 py-1">
            <dt className={r.strong ? "font-medium text-slate-800" : "text-slate-600"}>{r.label}</dt>
            <dd className={`tabular-nums ${r.strong ? "font-semibold" : ""} ${r.warn ? "text-red-700" : "text-slate-800"}`}>{amount(r.value)}</dd>
          </div>
        ))}
      </dl>
      {after < 0 && (
        <div className="mt-1 text-xs text-red-700">
          Approving this request would go over {npc ? `the ${data.scope} Board-Approved NPC Budget` : `${data.scope}'s Departmental Budget Cap`}.
        </div>
      )}
    </div>
  );
}
