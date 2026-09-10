import { useEffect, useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { PHASES } from "../lib/phases";

// Compact account menu for a top bar's upper-right corner: click the name to
// open a list of the 4 phases (to jump straight to any built one) and "Log
// out". Used on the sidebar-free Phase Menu screen and the in-phase top bar
// (Layout.tsx).
export function UserMenu({ dark = false }: { dark?: boolean }) {
  const { currentUser, hasRole, logout } = useAuth();
  const location = useLocation();
  const isBudgetOfficer = hasRole("BUDGET_OFFICER");
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  if (!currentUser) return null;

  const isAtPhaseMenu = location.pathname === "/";

  return (
    <div ref={containerRef} className="relative">
      <button onClick={() => setOpen((o) => !o)} className={`flex items-center gap-1.5 rounded px-2 py-1 text-sm font-medium ${dark ? "text-white hover:bg-white/10" : "text-slate-700 hover:bg-slate-100"}`}>
        {currentUser.name}
        {currentUser.department && <span className={dark ? "text-emerald-100/70" : "text-slate-400"}>({currentUser.department.name})</span>}
        <svg viewBox="0 0 24 24" fill="none" strokeWidth={2} stroke="currentColor" className={`h-3.5 w-3.5 ${dark ? "text-emerald-100/70" : "text-slate-400"}`}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 9l6 6 6-6" />
        </svg>
      </button>

      {open && (
        <div className="absolute right-0 z-50 mt-1 w-56 rounded-lg border border-slate-200 bg-white py-1 shadow-lg">
          <div className="border-b border-slate-100 px-3 py-2">
            <div className="text-sm font-medium text-slate-700">{currentUser.name}</div>
            <div className="truncate text-xs text-slate-400">{currentUser.email}</div>
          </div>
          {!isAtPhaseMenu && (
            <div className="border-b border-slate-100 py-1">
              {PHASES.map((phase) =>
                phase.to ? (
                  <Link key={phase.number} to={phase.to} onClick={() => setOpen(false)} className="block px-3 py-1.5 text-left text-sm text-slate-600 hover:bg-slate-50">
                    {phase.title}
                  </Link>
                ) : (
                  <div key={phase.number} className="flex items-center justify-between px-3 py-1.5 text-left text-sm text-slate-300">
                    <span>{phase.title}</span>
                    <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[9px] font-semibold tracking-wide text-slate-400">Soon</span>
                  </div>
                ),
              )}
            </div>
          )}
          {/* Admin Console (spec item 10) lives outside the module system -
              same "outside the modules" placement as the landing page's own
              card, so it's kept out of the numbered PHASES list above and
              given its own section here too. Hidden on the landing page
              itself for the same reason the module list above is: it's
              already shown there as its own card. */}
          {!isAtPhaseMenu && isBudgetOfficer && (
            <div className="border-b border-slate-100 py-1">
              <Link to="/admin" onClick={() => setOpen(false)} className="block px-3 py-1.5 text-left text-sm text-slate-600 hover:bg-slate-50">
                Admin Console
              </Link>
            </div>
          )}
          <button onClick={logout} className="block w-full px-3 py-1.5 text-left text-sm text-slate-600 hover:bg-slate-50">
            Log out
          </button>
        </div>
      )}
    </div>
  );
}
