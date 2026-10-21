import { useQuery } from "@tanstack/react-query";
import { api, NPC_SBU_OPTIONS } from "../api/client";

interface NpcBudgetSummaryData {
  fiscalYear: number;
  npcSbu: string;
  boardApproved: number | null;
  approvedToDate: number;
  approvedCount: number;
  thisRequest: number;
}

const amount = (n: number) => (n < 0 ? `(${Math.round(-n).toLocaleString()})` : Math.round(n).toLocaleString());

// Shown to reviewers beside an NPC request (Inbox card and the request's own
// page): where it leaves its NPC SBU's Board-Approved NPC Budget.
export function NpcBudgetSummary({ requestId }: { requestId: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ["npc-budget-summary", requestId],
    queryFn: async () => (await api.get<NpcBudgetSummaryData>(`/budget-requests/${requestId}/npc-budget-summary`)).data,
  });
  if (isLoading || !data) return null;

  const sbuLabel = NPC_SBU_OPTIONS.find((o) => o.value === data.npcSbu)?.label ?? data.npcSbu;
  if (data.boardApproved === null) {
    return (
      <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
        No {data.fiscalYear} Board-Approved NPC Budget has been set for {sbuLabel} yet. The Budget Officer sets it under Board-Approved NPC Budget.
      </div>
    );
  }
  const available = data.boardApproved - data.approvedToDate;
  const after = available - data.thisRequest;
  const rows: { label: string; value: number; strong?: boolean; warn?: boolean }[] = [
    { label: "Total Board-Approved NPC Budget", value: data.boardApproved },
    { label: `Approved NPC Requests to Date (${data.approvedCount})`, value: data.approvedToDate },
    { label: "Available NPC Budget", value: available, strong: true, warn: available < 0 },
    { label: "This NPC Request", value: data.thisRequest },
    { label: "Available After Approving This Request", value: after, strong: true, warn: after < 0 },
  ];
  return (
    <div className={`rounded-lg border p-3 text-sm ${after < 0 ? "border-red-200 bg-red-50/60" : "border-emerald-200 bg-emerald-50/60"}`}>
      <div className="mb-1 text-xs font-semibold text-slate-700">
        {data.fiscalYear} NPC Budget - {sbuLabel}
      </div>
      <dl className="divide-y divide-slate-200/70">
        {rows.map((r) => (
          <div key={r.label} className="flex items-center justify-between gap-4 py-1">
            <dt className={r.strong ? "font-medium text-slate-800" : "text-slate-600"}>{r.label}</dt>
            <dd className={`tabular-nums ${r.strong ? "font-semibold" : ""} ${r.warn ? "text-red-700" : "text-slate-800"}`}>{amount(r.value)}</dd>
          </div>
        ))}
      </dl>
      {after < 0 && <div className="mt-1 text-xs text-red-700">Approving this request would go over the {sbuLabel} Board-Approved NPC Budget.</div>}
    </div>
  );
}
