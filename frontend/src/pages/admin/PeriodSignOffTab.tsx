import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api2, type ReportPeriodLock } from "../../api/client";
import { useFiscalYear } from "../../lib/fiscalCycle";

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// Spec item 13: Budget Report & Analysis's Period Sign-off (FR-4.8) moved
// out of the report page itself and into the Admin Console, alongside the
// rest of the Budget Officer's configuration actions - and now confirms
// before locking, since a lock can't be undone from the UI once set.
export function PeriodSignOffTab() {
  const { targetYear } = useFiscalYear();
  const queryClient = useQueryClient();
  const [fiscalYear, setFiscalYear] = useState(targetYear);

  const { data: periodLocks = [] } = useQuery({
    queryKey: ["reports", "period-locks", fiscalYear],
    queryFn: async () => (await api2.get<ReportPeriodLock[]>("/reports/period-locks", { params: { fiscalYear } })).data,
  });
  const lockedMonths = new Set(periodLocks.map((l) => l.month));

  const lockMutation = useMutation({
    mutationFn: async (m: number) => (await api2.post<ReportPeriodLock>("/reports/period-locks", { fiscalYear, month: m })).data,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["reports", "period-locks", fiscalYear] }),
  });

  return (
    <div className="space-y-4">
      <div className="flex items-end gap-2 text-sm">
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-500">Fiscal Year</label>
          <input type="number" className="w-32 rounded border border-slate-300 px-2 py-1.5" value={fiscalYear} onChange={(e) => setFiscalYear(Number(e.target.value) || targetYear)} />
        </div>
      </div>

      <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <div className="mb-2 text-sm font-semibold text-slate-700">Period Sign-off ({fiscalYear})</div>
        <div className="mb-3 text-xs text-slate-500">
          Signing off a month locks the Budget Report & Analysis data and notes for it against further modification. This cannot be undone from here.
        </div>
        <div className="flex flex-wrap gap-2">
          {MONTH_NAMES.map((m, i) => {
            const monthNum = i + 1;
            const locked = lockedMonths.has(monthNum);
            return (
              <button
                key={m}
                disabled={locked || lockMutation.isPending}
                onClick={() => {
                  if (!window.confirm(`Sign off ${m} ${fiscalYear}? This locks the report's data and notes for this month against further modification and cannot be undone from here.`)) return;
                  lockMutation.mutate(monthNum);
                }}
                className={`rounded-full px-3 py-1 text-xs font-medium ${locked ? "bg-slate-200 text-slate-500" : "border border-emerald-300 text-emerald-700 hover:bg-emerald-50"}`}
              >
                {m} {locked ? "🔒" : ""}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
