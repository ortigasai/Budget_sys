import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../api/client";

interface StageConfig {
  id: string;
  stage: string;
  dueDate: string;
}

const STAGES = [
  { stage: "FINALIZE_FORECAST", label: "Stage 1 — Finalize Forecast (centralized departments)" },
  { stage: "REQUEST_AND_AUTHORIZATION", label: "Departmental Request Creation & Authorization" },
  { stage: "CENTRALIZED_L1_REVIEW", label: "Centralized First-Level Review" },
  { stage: "CENTRALIZED_HEAD_REVIEW", label: "Centralized Department Head Review" },
  { stage: "BCA_AND_FINALIZATION", label: "BC&A Head Approval & Technical Review/Finalization" },
];

export function StageDueDatesTab() {
  const queryClient = useQueryClient();
  const { data: configs = [] } = useQuery({
    queryKey: ["workflow-stage-config"],
    queryFn: async () => (await api.get<StageConfig[]>("/admin/workflow-stage-config")).data,
  });

  const [dueDates, setDueDates] = useState<Record<string, string>>({});

  const save = useMutation({
    mutationFn: async (stage: string) =>
      (
        await api.put("/admin/workflow-stage-config", {
          stage,
          dueDate: new Date(dueDates[stage]).toISOString(),
        })
      ).data,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["workflow-stage-config"] }),
  });

  const existingFor = (stage: string) => configs.find((c) => c.stage === stage);

  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-600">
        Global due dates (apply to every department, not per-department). Once a stage's due date passes, actions at
        that stage are blocked until the Budget Officer moves it.
      </p>

      <table className="w-full overflow-hidden rounded-lg border border-slate-200 bg-white text-sm">
        <thead className="bg-emerald-50 text-left text-xs uppercase tracking-wide text-emerald-800">
          <tr>
            <th className="px-3 py-2">Stage</th>
            <th className="px-3 py-2">Current Due Date</th>
            <th className="px-3 py-2">Set New</th>
          </tr>
        </thead>
        <tbody>
          {STAGES.map((s) => {
            const existing = existingFor(s.stage);
            const isPastDue = existing && new Date(existing.dueDate).getTime() < Date.now();
            return (
              <tr key={s.stage} className="border-t border-slate-100">
                <td className="px-3 py-2">{s.label}</td>
                <td className="px-3 py-2">
                  {existing ? (
                    <span className={isPastDue ? "font-medium text-red-600" : ""}>
                      {new Date(existing.dueDate).toLocaleDateString()}
                      {isPastDue && " (past due — actions blocked)"}
                    </span>
                  ) : (
                    "Not set"
                  )}
                </td>
                <td className="px-3 py-2">
                  <div className="flex items-center gap-2">
                    <input
                      type="date"
                      className="rounded border border-slate-300 px-2 py-1"
                      value={dueDates[s.stage] ?? ""}
                      onChange={(e) => setDueDates({ ...dueDates, [s.stage]: e.target.value })}
                    />
                    <button
                      onClick={() => save.mutate(s.stage)}
                      disabled={!dueDates[s.stage]}
                      className="rounded bg-emerald-700 px-2 py-1 text-xs font-medium text-white hover:bg-emerald-600 disabled:opacity-50"
                    >
                      Save
                    </button>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
