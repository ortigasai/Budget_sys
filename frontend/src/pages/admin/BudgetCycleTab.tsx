import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../../api/client";
import { useFiscalCycle, type FiscalCycleConfig } from "../../lib/fiscalCycle";

// FR-1.15 #2: "Target Calendar Year ... Back-end admin control lets the
// Budget Officer manually open/close the budget cycle." Closing it blocks
// new budget requests (POST /budget-requests, bulk upload) - enforced by
// assertCycleOpen() in workflowService.ts; requests already in flight are
// unaffected.
export function BudgetCycleTab() {
  const queryClient = useQueryClient();
  const { data: config } = useFiscalCycle();

  const [year, setYear] = useState("");
  useEffect(() => {
    if (config) setYear(String(config.targetCalendarYear));
  }, [config]);

  const updateCycle = useMutation({
    mutationFn: async (next: { targetCalendarYear: number; cycleOpen: boolean }) => (await api.put<FiscalCycleConfig>("/admin/fiscal-cycle", next)).data,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["fiscal-cycle"] }),
  });

  if (!config) return null;

  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <div className="mb-1 flex items-center gap-2 text-sm font-semibold">
          Budget Cycle Status
          <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold tracking-wide ${config.cycleOpen ? "bg-emerald-100 text-emerald-800" : "bg-red-100 text-red-700"}`}>{config.cycleOpen ? "Open" : "Closed"}</span>
        </div>
        <p className="mb-4 text-xs text-slate-500">While closed, Requestors can no longer create new budget requests (Field 2) for the target calendar year. Requests already in progress are not affected.</p>

        <div className="flex flex-wrap items-end gap-4">
          <div>
            <label className="mb-1 block text-xs font-semibold tracking-wide text-slate-400">Target Calendar Year</label>
            <input type="number" className="w-32 rounded border border-slate-300 px-2 py-1.5 text-sm" value={year} onChange={(e) => setYear(e.target.value)} />
          </div>

          <button onClick={() => updateCycle.mutate({ targetCalendarYear: Number(year), cycleOpen: config.cycleOpen })} disabled={!year || Number(year) === config.targetCalendarYear || updateCycle.isPending} className="rounded bg-emerald-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-600 disabled:opacity-50">
            Save Year
          </button>

          <button onClick={() => updateCycle.mutate({ targetCalendarYear: config.targetCalendarYear, cycleOpen: !config.cycleOpen })} disabled={updateCycle.isPending} className={`rounded px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50 ${config.cycleOpen ? "bg-red-600 hover:bg-red-500" : "bg-emerald-700 hover:bg-emerald-600"}`}>
            {config.cycleOpen ? "Close Cycle" : "Reopen Cycle"}
          </button>
        </div>
      </div>
    </div>
  );
}
