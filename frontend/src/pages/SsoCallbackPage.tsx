import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { api } from "../api/client";
import { useAuth } from "../context/AuthContext";
import { saveSsoIdentity, clearSsoIdentity } from "../lib/ssoIdentity";
import { SSO_STATE_KEY } from "../lib/ssoLogin";

// /auth/callback - where Microsoft 365 sign-in (via the API broker) sends the
// browser back with ?code=...&state=... The code is exchanged by the backend
// (POST /auth/sso/callback); a matching account is logged in, otherwise the
// login page opens "Request access" with the Microsoft name and email.
export function SsoCallbackPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { login } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);

  useEffect(() => {
    // StrictMode runs effects twice in development; a code can only be used once.
    if (started.current) return;
    started.current = true;

    const code = params.get("code");
    const state = params.get("state");
    const expectedState = sessionStorage.getItem(SSO_STATE_KEY);
    sessionStorage.removeItem(SSO_STATE_KEY);
    const brokerError = params.get("error_description") ?? params.get("error");

    if (brokerError) {
      setError(`Microsoft sign-in didn't complete: ${brokerError}`);
      return;
    }
    if (!code) {
      setError("Microsoft sign-in didn't return a sign-in code.");
      return;
    }
    if (!state || !expectedState || state !== expectedState) {
      setError("This sign-in link has expired or wasn't started from this browser tab. Please sign in again.");
      return;
    }

    api
      .post<{ id: string; token: string }>("/auth/sso/callback", { code })
      .then((res) => {
        clearSsoIdentity();
        login(res.data.id, res.data.token);
        navigate("/", { replace: true });
      })
      .catch((err) => {
        const sso = err.response?.data?.sso as { email: string; name: string | null } | undefined;
        if (err.response?.status === 404 && sso) {
          // Signed in with Microsoft, but no account here yet.
          saveSsoIdentity(sso);
          navigate("/?requestAccess=1", { replace: true });
          return;
        }
        setError(err.response?.data?.error ?? "Microsoft sign-in failed. Please try again.");
      });
  }, [params, login, navigate]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 p-6">
      <div className="w-full max-w-md rounded-lg border border-slate-200 bg-white p-6 text-center shadow-sm">
        <div className="text-lg font-semibold text-emerald-900">Budgeting System</div>
        {error ? (
          <>
            <p className="mt-3 text-sm text-red-700">{error}</p>
            <Link to="/" replace className="mt-4 inline-block rounded bg-emerald-800 px-3 py-1.5 text-sm font-semibold text-white hover:bg-emerald-700">
              Back to sign in
            </Link>
          </>
        ) : (
          <p className="mt-3 text-sm text-slate-600">Signing you in with Microsoft 365…</p>
        )}
      </div>
    </div>
  );
}
