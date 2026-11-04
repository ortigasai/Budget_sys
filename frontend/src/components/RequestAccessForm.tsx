import { useState, type FormEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../api/client";
import { SearchableSelect } from "./SearchableSelect";
import { useSsoIdentity } from "../lib/ssoIdentity";

type RequestFor = "SELF" | "OTHER";

// Login page > "Request access": for someone with no account yet. Goes to
// Admin Console > Access Requests for the Budget Officer to approve or
// disapprove. No password - access is through SSO.
//
// `ownEmail` is the requester's own email (today: what they typed in the
// login form; once SSO is connected, the SSO account's email). It fills the
// Email field when the request is for themselves.
export function RequestAccessForm({ ownEmail, onBack }: { ownEmail: string; onBack: () => void }) {
  // Once SSO is connected, the requester's own name and email come from it
  // and can't be edited (see lib/ssoIdentity.ts).
  const sso = useSsoIdentity();
  const [requestFor, setRequestFor] = useState<RequestFor>("SELF");
  const [email, setEmail] = useState(sso?.email ?? ownEmail);
  const [requesterEmail, setRequesterEmail] = useState(sso?.email ?? ownEmail);
  const [requesterName, setRequesterName] = useState(sso?.name ?? "");
  const [firstName, setFirstName] = useState("");
  const [middleInitial, setMiddleInitial] = useState("");
  const [lastName, setLastName] = useState("");
  const [username, setUsername] = useState("");
  const [departmentId, setDepartmentId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [sentFor, setSentFor] = useState<string | null>(null);

  const { data: departments = [] } = useQuery({
    queryKey: ["public-departments"],
    queryFn: async () => (await api.get<{ id: string; name: string }[]>("/auth/departments")).data,
    staleTime: 5 * 60_000,
  });

  // Switching to "for myself" puts your own email back; switching to "for
  // another user" clears it for theirs.
  const chooseRequestFor = (value: RequestFor) => {
    if (value === requestFor) return;
    setRequestFor(value);
    setEmail(value === "SELF" ? requesterEmail : "");
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!departmentId) {
      setError("Choose a department.");
      return;
    }
    setSubmitting(true);
    try {
      await api.post("/auth/access-requests", {
        requestFor,
        requesterName: requestFor === "OTHER" ? requesterName : null,
        email,
        firstName,
        middleInitial: middleInitial || null,
        lastName,
        username,
        departmentId,
      });
      setSentFor(email.trim().toLowerCase());
    } catch (err: any) {
      setError(err.response?.data?.error ?? "Could not send the request.");
    } finally {
      setSubmitting(false);
    }
  };

  if (sentFor) {
    return (
      <div className="flex w-full flex-col gap-3">
        <div className="rounded border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">
          Access request sent for <span className="font-semibold">{sentFor}</span>. The Budget Officer will review it; once approved, sign in with your SSO account.
        </div>
        <button type="button" onClick={onBack} className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm text-slate-700 hover:bg-slate-50">
          Back to sign in
        </button>
      </div>
    );
  }

  const inputClass = "w-full rounded border border-slate-300 px-2 py-1.5 text-sm disabled:bg-slate-50";
  const labelClass = "text-xs font-medium text-slate-600";

  return (
    <form onSubmit={submit} className="flex w-full flex-col gap-3">
      <div className="text-xs font-semibold tracking-wide text-slate-400">Request access</div>

      <fieldset className="flex flex-col gap-1">
        <legend className={labelClass}>
          This request is for <span className="text-red-600">*</span>
        </legend>
        <div className="mt-1 flex gap-4 text-sm text-slate-700">
          {(
            [
              ["SELF", "Myself"],
              ["OTHER", "Another user"],
            ] as const
          ).map(([value, label]) => (
            <label key={value} className="flex items-center gap-1.5">
              <input type="radio" name="requestFor" value={value} checked={requestFor === value} onChange={() => chooseRequestFor(value)} />
              {label}
            </label>
          ))}
        </div>
      </fieldset>

      {requestFor === "OTHER" && (
        <label className="flex flex-col gap-1">
          <span className={labelClass}>
            Your name <span className="text-red-600">*</span>
          </span>
          <input
            type="text"
            required
            readOnly={!!sso}
            value={requesterName}
            onChange={(e) => setRequesterName(e.target.value)}
            className={`${inputClass} read-only:bg-slate-50 read-only:text-slate-600`}
            placeholder="Name of the person requesting"
          />
          {sso && <span className="text-[11px] text-slate-500">From your SSO account.</span>}
        </label>
      )}

      {requestFor === "OTHER" && (
        <div className="mt-1 border-t border-slate-200 pt-3">
          <div className="text-xs font-semibold text-emerald-800">Person you want to add</div>
          <div className="text-[11px] text-slate-500">The details below are for the person who needs access.</div>
        </div>
      )}

      <label className="flex flex-col gap-1">
        <span className={labelClass}>
          Email <span className="text-red-600">*</span>
        </span>
        <input
          type="email"
          required
          readOnly={!!sso && requestFor === "SELF"}
          value={email}
          onChange={(e) => {
            setEmail(e.target.value);
            if (requestFor === "SELF") setRequesterEmail(e.target.value);
          }}
          className={`${inputClass} read-only:bg-slate-50 read-only:text-slate-600`}
          placeholder="name@ortigas.com.ph"
        />
        {sso && requestFor === "SELF" && <span className="text-[11px] text-slate-500">From your SSO account.</span>}
      </label>

      <fieldset className="flex flex-col gap-1">
        <legend className={labelClass}>
          Full name <span className="text-red-600">*</span>
        </legend>
        <div className="mt-1 grid grid-cols-[1fr_4.5rem_1fr] gap-2">
          <input type="text" required aria-label="First name" placeholder="First name" value={firstName} onChange={(e) => setFirstName(e.target.value)} className={inputClass} />
          <input type="text" aria-label="Middle initial" placeholder="M.I." maxLength={4} value={middleInitial} onChange={(e) => setMiddleInitial(e.target.value)} className={inputClass} />
          <input type="text" required aria-label="Surname" placeholder="Surname" value={lastName} onChange={(e) => setLastName(e.target.value)} className={inputClass} />
        </div>
      </fieldset>

      <label className="flex flex-col gap-1">
        <span className={labelClass}>
          Username <span className="text-red-600">*</span>
        </span>
        <input type="text" required value={username} onChange={(e) => setUsername(e.target.value)} className={inputClass} />
      </label>

      <div className="flex flex-col gap-1">
        <span className={labelClass}>
          Department <span className="text-red-600">*</span>
        </span>
        <SearchableSelect placeholder="Select a department…" options={departments.map((d) => ({ value: d.id, label: d.name }))} value={departmentId} onChange={setDepartmentId} disabled={submitting} />
      </div>

      {error && <div className="text-xs text-red-600">{error}</div>}

      <button type="submit" disabled={submitting} className="w-full rounded bg-emerald-800 px-2 py-1.5 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50">
        {submitting ? "Sending…" : "Send request"}
      </button>
      <button type="button" onClick={onBack} className="text-xs text-slate-500 hover:text-slate-700 hover:underline">
        Back to sign in
      </button>
    </form>
  );
}
