import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api, type FinalizedBudgetLineDetail, type NpcSbu, type RequestCategory, type Sbu } from "../api/client";
import { STAGE_LABELS } from "./StatusBadge";

const peso = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 0 });
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function Field({ label, value }: { label: string; value: string | number }) {
  return (
    <div>
      <div className="text-xs text-slate-500">{label}</div>
      <div className="text-sm text-slate-900">{value || "—"}</div>
    </div>
  );
}

function RequestCard({ d }: { d: FinalizedBudgetLineDetail }) {
  const net = d.proposedAmount - d.budgetCutAmount;
  return (
    <div className="rounded-lg border border-slate-200 bg-white">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 p-3">
        <div>
          <Link to={`/requests/${d.budgetRequestId}`} className="font-medium text-emerald-800 hover:underline">
            {d.itemName}
          </Link>
          <div className="mt-0.5 text-xs text-slate-500">
            {d.ticketNumber && <>Ticket #{d.ticketNumber} · </>}
            {d.budgetCode && <>{d.budgetCode} · </>}
            {d.departmentName}
          </div>
        </div>
        <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800">{STAGE_LABELS[d.currentStage] ?? d.currentStage}</span>
      </div>

      <div className="grid grid-cols-2 gap-3 p-3 sm:grid-cols-4">
        <Field label="Requested by" value={d.requestedBy} />
        <Field label="Proposed Amount" value={peso(d.proposedAmount)} />
        <Field label="Budget Cut" value={d.budgetCutAmount > 0 ? peso(d.budgetCutAmount) : "—"} />
        <Field label="Finalized Amount" value={peso(net)} />
        <Field label="Finalized" value={`${new Date(d.finalizedAt).toLocaleDateString()} by ${d.finalizedBy}`} />
        <Field label="SAP Document #" value={d.sapDocumentNumber ?? "—"} />
        {d.npcLocation && <Field label="Location" value={d.npcLocation} />}
        {d.projectStartDate && d.projectEndDate && (
          <Field label="Project Dates" value={`${new Date(d.projectStartDate).toLocaleDateString()} – ${new Date(d.projectEndDate).toLocaleDateString()}`} />
        )}
      </div>

      <div className="border-t border-slate-100 p-3">
        <div className="text-xs text-slate-500">Business Justification</div>
        <div className="text-sm text-slate-700">{d.businessJustification || "—"}</div>
      </div>

      <div className="border-t border-slate-100">
        <div className="bg-slate-50 px-3 py-1.5 text-xs font-semibold tracking-wide text-slate-600">Monthly Spend Grid</div>
        <div className="grid grid-cols-3 divide-x divide-y divide-slate-100 border-t border-slate-100 text-sm sm:grid-cols-4 lg:grid-cols-6">
          {MONTHS.map((m, i) => (
            <div key={m} className="px-2 py-2 text-center">
              <div className="text-xs font-medium tracking-wide text-slate-400">{m}</div>
              <div className="mt-0.5 font-semibold tabular-nums text-slate-700">{(d.monthlyAmounts[i] ?? 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// Pop-up listing the individual requests behind one Finalized Budget Report
// row - opened from that row's "# Requests" count. Same grouping key the
// report itself used (requestCategory/sbu/npcSbu/glAccount/costCenter).
export function FinalizedBudgetLineDetailModal({
  fiscalYear,
  requestCategory,
  sbu,
  npcSbu,
  glAccount,
  costCenter,
  label,
  onClose,
}: {
  fiscalYear: number;
  requestCategory: RequestCategory;
  sbu: Sbu | null;
  npcSbu: NpcSbu | null;
  glAccount: string;
  costCenter: string;
  label: string;
  onClose: () => void;
}) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ["finalized-budget-report", "group-details", fiscalYear, requestCategory, sbu, npcSbu, glAccount, costCenter],
    queryFn: async () =>
      (
        await api.get<FinalizedBudgetLineDetail[]>("/budget-requests/finalized-budget-report/group-details", {
          params: { fiscalYear, requestCategory, sbu: sbu ?? undefined, npcSbu: npcSbu ?? undefined, glAccount, costCenter },
        })
      ).data,
  });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const total = (data ?? []).reduce((s, d) => s + d.amount, 0);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" onClick={onClose}>
      <div className="max-h-[85vh] w-full max-w-4xl overflow-y-auto rounded-xl bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            <div className="text-xs font-semibold tracking-wide text-slate-500">Requests finalized into this line</div>
            <div className="text-lg font-semibold text-emerald-800">{label}</div>
            {data && (
              <div className="mt-0.5 text-xs text-slate-500">
                {data.length} request{data.length === 1 ? "" : "s"} · Total {peso(total)}
              </div>
            )}
          </div>
          <button onClick={onClose} aria-label="Close" className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700">
            ✕
          </button>
        </div>

        {isLoading && <div className="text-sm text-slate-500">Loading…</div>}
        {isError && <div className="text-sm text-red-600">Could not load these requests.</div>}

        {data && (
          <div className="space-y-3">
            {data.length === 0 ? <div className="text-sm text-slate-400">No requests found.</div> : data.map((d) => <RequestCard key={d.id} d={d} />)}
          </div>
        )}
      </div>
    </div>
  );
}
