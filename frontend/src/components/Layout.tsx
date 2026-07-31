import type { ReactNode } from "react";
import { NavLink, Outlet } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { RoleSwitcher } from "./RoleSwitcher";

const linkClass = ({ isActive }: { isActive: boolean }) =>
  `flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
    isActive
      ? "bg-emerald-700 text-white shadow-sm shadow-emerald-700/30"
      : "text-slate-600 hover:bg-emerald-50 hover:text-emerald-900"
  }`;

function Icon({ path }: { path: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" strokeWidth={1.75} stroke="currentColor" className="h-[18px] w-[18px] shrink-0">
      <path strokeLinecap="round" strokeLinejoin="round" d={path} />
    </svg>
  );
}

const ICONS = {
  home: "M3 11.5 12 4l9 7.5M5.5 10v9a1 1 0 0 0 1 1H9.5v-6h5v6H17.5a1 1 0 0 0 1-1v-9",
  newRequest: "M12 5v14M5 12h14",
  myRequests: "M6 3.5h9l3 3V20a.5.5 0 0 1-.5.5h-11a.5.5 0 0 1-.5-.5V4a.5.5 0 0 1 .5-.5ZM9 9.5h6M9 13h6M9 16.5h4",
  inbox: "M3.5 12h4l1.5 3h6l1.5-3h4M3.5 12 5 5.5a1 1 0 0 1 1-.8h12a1 1 0 0 1 1 .8L20.5 12M3.5 12v6a1 1 0 0 0 1 1h15a1 1 0 0 0 1-1v-6",
  forecast: "M4 19V9.5m5 9.5V5m5 14v-7m5 7V11M4 19h16",
  manpower: "M9 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM3.5 20c0-3 2.5-5.5 5.5-5.5S14.5 17 14.5 20M17 11a2.5 2.5 0 1 0 0-5M20.5 20c0-2.5-1.8-4.5-4-5",
  step5: "M4 20V10m6 10V4m6 16v-7m6 7V13",
  admin: "M12 3.5 4.5 6.5v5.2c0 4.6 3.2 8.6 7.5 9.8 4.3-1.2 7.5-5.2 7.5-9.8V6.5L12 3.5ZM9.5 12l1.8 1.8L14.7 10",
};

function NavItem({ to, end, icon, children }: { to: string; end?: boolean; icon: keyof typeof ICONS; children: ReactNode }) {
  return (
    <NavLink to={to} end={end} className={linkClass}>
      <Icon path={ICONS[icon]} />
      {children}
    </NavLink>
  );
}

export function Layout() {
  const { currentUser, hasRole } = useAuth();

  const isBudgetOfficer = hasRole("BUDGET_OFFICER");
  const isReviewer =
    hasRole("DEPARTMENT_HEAD") ||
    hasRole("CENTRALIZED_FIRST_LEVEL_REVIEWER") ||
    hasRole("CENTRALIZED_DEPARTMENT_HEAD") ||
    hasRole("BCA_HEAD") ||
    hasRole("CFO") ||
    isBudgetOfficer;
  const isHrAnalyst = hasRole("HR_ANALYST");
  const isHrHead = currentUser?.department?.name === "Human Resources" && hasRole("CENTRALIZED_DEPARTMENT_HEAD");

  return (
    <div className="flex min-h-screen bg-slate-100">
      <aside className="flex w-64 shrink-0 flex-col border-r border-emerald-900/10 bg-white">
        <div className="flex items-center gap-3 bg-gradient-to-br from-emerald-700 to-emerald-900 px-5 py-5">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white/15 text-lg font-bold text-white ring-1 ring-white/30">
            ₱
          </div>
          <div className="leading-tight">
            <div className="text-base font-bold tracking-tight text-white">Budgeting System</div>
            <div className="text-[11px] font-medium uppercase tracking-wider text-emerald-100/80">Ortigas Group</div>
          </div>
        </div>

        {currentUser && (
          <nav className="flex flex-1 flex-col gap-1 overflow-y-auto px-3 py-4">
            <NavItem to="/" end icon="home">
              Home
            </NavItem>
            <NavItem to="/requests/new" icon="newRequest">
              New Request
            </NavItem>
            <NavItem to="/requests/mine" icon="myRequests">
              My Requests
            </NavItem>
            {isReviewer && (
              <NavItem to="/inbox" icon="inbox">
                Inbox
              </NavItem>
            )}
            <NavItem to="/forecast" icon="forecast">
              Forecast
            </NavItem>
            {(isHrAnalyst || isBudgetOfficer || isHrHead) && (
              <NavItem to="/manpower" icon="manpower">
                Manpower Budget
              </NavItem>
            )}
            {isBudgetOfficer && (
              <>
                <div className="mb-1 mt-4 border-t border-slate-100 pt-4 text-xs font-semibold uppercase tracking-wide text-emerald-800/70">
                  Budget Officer
                </div>
                <NavItem to="/step5" icon="step5">
                  Step 5 Dashboard
                </NavItem>
                <NavItem to="/admin" icon="admin">
                  Admin Console
                </NavItem>
              </>
            )}
          </nav>
        )}

        <div className="border-t border-slate-100 bg-slate-50 px-3 py-4">
          <RoleSwitcher />
        </div>
      </aside>

      <main className="min-w-0 flex-1 px-8 py-6">
        {currentUser ? (
          <div className="mx-auto max-w-6xl">
            <Outlet />
          </div>
        ) : (
          <div className="mt-16 text-center text-slate-500">
            Select a demo user in the sidebar to log in and explore the Budgeting System.
          </div>
        )}
      </main>
    </div>
  );
}
