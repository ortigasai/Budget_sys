import { useAuth } from "../context/AuthContext";
import { SearchableSelect } from "./SearchableSelect";

const ROLE_LABELS: Record<string, string> = {
  DEPARTMENT_HEAD: "Department Head",
  CENTRALIZED_FIRST_LEVEL_REVIEWER: "Centralized First-Level Reviewer",
  CENTRALIZED_DEPARTMENT_HEAD: "Centralized Department Head",
  BCA_HEAD: "BC&A Head",
  CENTRALIZED_BUDGET_PREPARER: "Centralized Budget Preparer",
  BUDGET_OFFICER: "Budget Officer",
  HR_ANALYST: "HR Analyst",
  CFO: "CFO",
};

export function roleLabel(roleType: string) {
  return ROLE_LABELS[roleType] ?? roleType;
}

export function RoleSwitcher() {
  const { users, currentUser, login, logout, isLoading } = useAuth();

  if (isLoading) return <div className="text-sm text-slate-400">Loading users…</div>;

  return (
    <div className="flex w-full flex-col gap-2">
      <div className="w-full text-xs font-semibold uppercase tracking-wide text-slate-400">Logged in as</div>
      <SearchableSelect
        placeholder="— Select demo user —"
        options={users.map((u) => ({
          value: u.id,
          label: u.name,
          sublabel: u.department?.name ?? "no dept",
        }))}
        value={currentUser?.id ?? ""}
        onChange={(v) => (v ? login(v) : logout())}
      />
      {currentUser && (
        <button
          onClick={logout}
          className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm text-slate-600 hover:bg-slate-100"
        >
          Log out
        </button>
      )}
    </div>
  );
}
