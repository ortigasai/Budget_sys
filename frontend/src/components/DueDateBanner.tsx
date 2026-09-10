import { useQuery } from "@tanstack/react-query";
import { api } from "../api/client";

interface StageConfig {
  id: string;
  stage: string;
  dueDate: string;
}

const STAGE_LABELS: Record<string, string> = {
  FINALIZE_FORECAST: "Finalize Forecast",
  REQUEST_AND_AUTHORIZATION: "Request Creation & Authorization",
  CENTRALIZED_L1_REVIEW: "Centralized First-Level Review",
  CENTRALIZED_HEAD_REVIEW: "Centralized Department Head Review",
  BCA_AND_FINALIZATION: "BC&A Approval & Finalization",
};
const STAGE_ORDER = Object.keys(STAGE_LABELS);

// Notes_2 item 6: "Put the due date on top of the Dashboard of the users."
export function DueDateBanner() {
  const { data: configs = [] } = useQuery({
    queryKey: ["workflow-stage-config"],
    queryFn: async () => (await api.get<StageConfig[]>("/admin/workflow-stage-config")).data,
  });

  if (configs.length === 0) return null;

  const sorted = [...configs].sort((a, b) => STAGE_ORDER.indexOf(a.stage) - STAGE_ORDER.indexOf(b.stage));

  return (
    <div className="rounded-lg border border-emerald-100 bg-emerald-50 p-3">
      <div className="mb-1.5 text-xs font-semibold tracking-wide text-emerald-800">Stage Due Dates</div>
      <div className="flex flex-wrap gap-2 text-sm">
        {sorted.map((c) => {
          const isPastDue = new Date(c.dueDate).getTime() < Date.now();
          return (
            <span key={c.id} className={`rounded-full px-2.5 py-1 text-xs font-medium ${isPastDue ? "bg-red-100 text-red-700" : "bg-white text-emerald-800 ring-1 ring-emerald-200"}`}>
              {STAGE_LABELS[c.stage] ?? c.stage}: {new Date(c.dueDate).toLocaleDateString()}
              {isPastDue && "⚠ past due"}
            </span>
          );
        })}
      </div>
    </div>
  );
}
