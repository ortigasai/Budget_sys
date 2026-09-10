import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { PHASES } from "../lib/phases";
import { useAuth } from "../context/AuthContext";
import { api2 } from "../api/client";

// Post-login landing screen (Functional Spec §1.1's four phases). Phase 1-3
// are built and link straight in; Phase 4 (Budget Report & Analysis) is
// also built, but FR-4.5/4.6 restrict it to the Budget Officer plus
// whoever's been individually granted access - its tile shows a
// "Restricted" state instead of linking in for anyone else, same idea as
// the disabled "Coming soon" tile pattern, just a different reason.
export function PhaseMenuPage() {
  const { currentUser, hasRole } = useAuth();
  const isBudgetOfficer = hasRole("BUDGET_OFFICER");
  const { data: reportAccess } = useQuery({
    queryKey: ["reports", "my-access"],
    queryFn: async () => (await api2.get<{ hasAccess: boolean }>("/reports/my-access")).data,
    enabled: !!currentUser,
  });
  const hasReportAccess = reportAccess?.hasAccess ?? false;

  return (
    <div className="mx-auto max-w-3xl py-8">
      <h1 className="mb-8 text-center text-lg font-semibold text-slate-600">Select a module to continue</h1>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {PHASES.map((phase) => {
          const restricted = phase.number === 4 && !hasReportAccess;
          return phase.to && !restricted ? (
            <Link key={phase.number} to={phase.to} className="group flex flex-col rounded-xl border border-slate-200 bg-white p-5 shadow-sm transition-colors hover:border-emerald-300 hover:shadow-md">
              <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-700 text-sm font-bold text-white">{phase.number}</div>
              <div title={phase.description} className="text-base font-semibold text-slate-900 group-hover:text-emerald-800">
                {phase.title}
              </div>
            </Link>
          ) : (
            <div key={phase.number} className="flex flex-col rounded-xl border border-slate-200 bg-slate-50 p-5 opacity-60">
              <div className="mb-3 flex items-center gap-2">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-slate-400 text-sm font-bold text-white">{phase.number}</div>
                <span className="rounded-full bg-slate-200 px-2 py-0.5 text-[10px] font-semibold tracking-wide text-slate-500">{restricted ? "Restricted" : "Coming soon"}</span>
              </div>
              <div title={phase.description} className="text-base font-semibold text-slate-700">
                {phase.title}
              </div>
              {restricted && <div className="mt-1 text-xs text-slate-500">Ask the Budget Officer for access.</div>}
            </div>
          );
        })}
      </div>

      {/* Spec item 10: "Remove the Admin Console section inside the modules.
          Make a separate Admin Console outside the modules." - kept out of
          the numbered module grid above (it isn't module 5, it configures
          all of them) and visually separated below a divider; Budget-Officer
          only, matching the route's own RequireRole gate in App.tsx. */}
      {isBudgetOfficer && (
        <div className="mt-8 border-t border-slate-200 pt-6">
          <Link to="/admin" className="group flex items-center justify-between rounded-xl border border-slate-200 bg-white p-5 shadow-sm transition-colors hover:border-emerald-300 hover:shadow-md">
            <div>
              <div className="text-base font-semibold text-slate-900 group-hover:text-emerald-800">Admin Console</div>
              <div className="mt-0.5 text-sm text-slate-500">Configure the catalog, workflow, and reference data that drive the budgeting system.</div>
            </div>
            <svg viewBox="0 0 24 24" fill="none" strokeWidth={2} stroke="currentColor" className="h-5 w-5 shrink-0 text-slate-400 group-hover:text-emerald-700">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 6l6 6-6 6" />
            </svg>
          </Link>
        </div>
      )}
    </div>
  );
}
