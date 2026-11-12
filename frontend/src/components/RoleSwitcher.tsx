import { useState, type FormEvent } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { startSsoLogin } from "../lib/ssoLogin";
import { useAuth } from "../context/AuthContext";
import { api } from "../api/client";
import { SearchableSelect } from "./SearchableSelect";
import { RequestAccessForm } from "./RequestAccessForm";

// Notes_7: labels follow the "Role" tab of the real "Budgeting System_Employee
// List" file exactly.
const ROLE_LABELS: Record<string, string> = {
  BUDGET_OFFICER: "Budget Officer",
  BCA_HEAD: "BCA Head",
  DEPARTMENT_HEAD: "Department Head",
  DEPARTMENT_PREPARER: "Department Preparer",
  // "Budgeting System_Approval Workflow"'s "Centralized Department Requestor" -
  // renamed from "...Preparer" since this role both creates GAE requests for
  // its department and (per that same file) is who a Centralized Department
  // Requestor's own request gets forwarded through.
  CENTRALIZED_BUDGET_PREPARER: "Centralized Department Requestor/Reviewer",
  CENTRALIZED_FIRST_LEVEL_REVIEWER: "Centralized Department Reviewer",
  CENTRALIZED_DEPARTMENT_HEAD: "Centralized Department Head",
  CFO: "CFO",
  CEO: "CEO",
  HR_ANALYST: "Manpower Preparer",
  // Phase 3 Budget Transfer & Reallocation — SBU-scoped role-type strings
  // stay BU_*, only the displayed label changed to "SBU ..." per the
  // workflow revision.
  BU_FINANCE_HEAD: "SBU Finance Head",
  BU_HEAD: "SBU Head",
  BU_FINANCE_OFFICER: "SBU Finance Officer",
};

export function roleLabel(roleType: string) {
  return ROLE_LABELS[roleType] ?? roleType;
}

// Notes_6 ("Log in account - revise"): a real email+password login form,
// replacing the old "pick any demo user from a list" switcher. Every
// seeded/imported user shares this one testing password - see
// backend/prisma/importEmployees.ts and seed.ts.
const SHARED_TEST_PASSWORD = "Ortigas12345";

// Only ever rendered while logged out (Layout.tsx's login card) - the
// logged-in state is shown by UserMenu instead.
export function RoleSwitcher() {
  const { login, users } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [quickUserId, setQuickUserId] = useState("");
  // ?requestAccess=1 - sent here by the Microsoft sign-in callback when the
  // person has no account yet; the form opens with their Microsoft identity.
  const [searchParams, setSearchParams] = useSearchParams();
  const [requestingAccess, setRequestingAccess] = useState(() => searchParams.get("requestAccess") === "1");
  const [ssoStarting, setSsoStarting] = useState(false);

  // Which login options this environment offers (backend LOGIN_METHODS):
  // local dev - testing dropdown, password and Microsoft 365; server/UAT -
  // Microsoft 365 only. Until it loads, the dropdown and form show as before.
  const { data: authConfig } = useQuery({
    queryKey: ["auth", "config"],
    queryFn: async () => (await api.get<{ methods: ("quick" | "password" | "sso")[] }>("/auth/config")).data,
    staleTime: 5 * 60_000,
  });
  const methods = authConfig?.methods ?? ["quick", "password"];
  const showQuick = methods.includes("quick");
  const showPassword = methods.includes("password");
  const showSso = methods.includes("sso");

  const signInWithMicrosoft = async () => {
    setError(null);
    setSsoStarting(true);
    try {
      await startSsoLogin();
    } catch (err: any) {
      setError(err.response?.data?.error ?? "Couldn't start Microsoft sign-in.");
      setSsoStarting(false);
    }
  };

  const doLogin = async (loginEmail: string, loginPassword: string) => {
    const res = await api.post<{ id: string; token: string }>("/auth/login", {
      email: loginEmail,
      password: loginPassword,
    });
    login(res.data.id, res.data.token);
    // The landing page after logging in is always the 4-phase menu ("/"),
    // regardless of what URL happened to be in the address bar - without
    // this, logging in while sitting on a stale deep link (e.g. /phase1
    // left over from before a reload logged you out, since login isn't
    // persisted) would drop you straight back into that page instead.
    navigate("/");
  };

  // Notes_7: "For the purpose of testing, on the log in page, allow
  // selection of users based on the Role Assignments already set by the
  // Budget Officer." Scoped to only users someone has actually assigned a
  // role to (via Admin Console > Role Assignments). Still a real, verified
  // login under the hood (every seeded user shares one known password) -
  // this just skips typing it in, it doesn't skip credential verification.
  // BC&A members (the BCA group, or anyone in the Budget, Controls &
  // Analysis department) are left out - they log in with the form only.
  const isBcaMember = (u: (typeof users)[number]) =>
    u.department?.name === "Budget, Controls & Analysis" || (u.groups ?? []).some((g) => g.group === "BCA");
  const roleAssignedUsers = users.filter((u) => u.isEmployee && !isBcaMember(u));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await doLogin(email, password);
    } catch (err: any) {
      setError(err.response?.data?.error ?? "Could not log in.");
    } finally {
      setSubmitting(false);
    }
  };

  const quickLogin = async (userId: string) => {
    setQuickUserId(userId);
    if (!userId) return;
    const picked = roleAssignedUsers.find((u) => u.id === userId);
    if (!picked) return;
    setError(null);
    setSubmitting(true);
    try {
      await doLogin(picked.email, SHARED_TEST_PASSWORD);
    } catch (err: any) {
      setError(err.response?.data?.error ?? "Could not log in.");
      setQuickUserId("");
    } finally {
      setSubmitting(false);
    }
  };

  if (requestingAccess) {
    return (
      <RequestAccessForm
        ownEmail={email}
        onBack={() => {
          setRequestingAccess(false);
          if (searchParams.has("requestAccess")) setSearchParams({}, { replace: true });
        }}
      />
    );
  }

  return (
    <div className="flex w-full flex-col gap-3">
      {showSso && (
        <div className="flex w-full flex-col gap-2">
          <button
            type="button"
            onClick={signInWithMicrosoft}
            disabled={ssoStarting || submitting}
            className="flex w-full items-center justify-center gap-2 rounded border border-slate-300 bg-white px-2 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-50 disabled:opacity-50"
          >
            <svg aria-hidden="true" viewBox="0 0 21 21" className="h-4 w-4">
              <rect x="1" y="1" width="9" height="9" fill="#f25022" />
              <rect x="11" y="1" width="9" height="9" fill="#7fba00" />
              <rect x="1" y="11" width="9" height="9" fill="#00a4ef" />
              <rect x="11" y="11" width="9" height="9" fill="#ffb900" />
            </svg>
            {ssoStarting ? "Opening Microsoft sign-in…" : "Sign in with Microsoft 365"}
          </button>
          {!showQuick && !showPassword && error && <div className="text-xs text-red-600">{error}</div>}
          {(showQuick || showPassword) && (
            <div className="flex items-center gap-2 text-xs text-slate-400">
              <div className="h-px flex-1 bg-slate-200" />
              or
              <div className="h-px flex-1 bg-slate-200" />
            </div>
          )}
        </div>
      )}
      {showQuick && roleAssignedUsers.length > 0 && (
        <div className="flex w-full flex-col gap-2">
          <div className="w-full text-xs font-semibold tracking-wide text-slate-400">Quick login (testing)</div>
          <SearchableSelect
            placeholder="Select an employee…"
            options={roleAssignedUsers.map((u) => ({
              value: u.id,
              label: u.name,
              sublabel: u.department?.name,
            }))}
            value={quickUserId}
            onChange={quickLogin}
            disabled={submitting}
            hideUntilTyped
          />
          {showPassword && (
            <div className="flex items-center gap-2 text-xs text-slate-400">
              <div className="h-px flex-1 bg-slate-200" />
              or log in
              <div className="h-px flex-1 bg-slate-200" />
            </div>
          )}
        </div>
      )}
      {showPassword && (
      <form onSubmit={submit} className="flex w-full flex-col gap-2">
        <div className="w-full text-xs font-semibold tracking-wide text-slate-400">Log in</div>
        <input type="email" required autoComplete="username" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm" />
        <input type="password" required autoComplete="current-password" placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm" />
        {error && <div className="text-xs text-red-600">{error}</div>}
        <button type="submit" disabled={submitting} className="w-full rounded bg-emerald-800 px-2 py-1.5 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50">
          {submitting ? "Logging in…" : "Log in"}
        </button>
      </form>
      )}
      {!showPassword && showQuick && error && <div className="text-xs text-red-600">{error}</div>}
      {/* With Microsoft 365 sign-in, anyone in the organization gets an
          account on first sign-in - no Request access step needed. */}
      {!showSso && (
        <div className="text-center text-xs text-slate-500">
          No access yet?{" "}
          <button type="button" onClick={() => setRequestingAccess(true)} className="font-semibold text-emerald-800 hover:underline">
            Request access
          </button>
        </div>
      )}
    </div>
  );
}
