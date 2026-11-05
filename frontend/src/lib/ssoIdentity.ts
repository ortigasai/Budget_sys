import { useState } from "react";

// Who the visitor is according to Microsoft 365 sign-in, when they signed in
// but have no Budgeting System account yet - the login page's "Request
// access" form fills in (and locks) the requester's own name and email from
// it. Set by the /auth/callback page (pages/SsoCallbackPage.tsx) for this
// browser tab only.
export interface SsoIdentity {
  name: string;
  email: string;
}

const STORAGE_KEY = "ssoIdentity";

export function saveSsoIdentity(identity: { email: string; name: string | null }) {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ email: identity.email, name: identity.name ?? identity.email }));
  } catch {
    // Storage blocked - the form just asks for name and email instead.
  }
}

export function clearSsoIdentity() {
  try {
    sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}

function readSsoIdentity(): SsoIdentity | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<SsoIdentity>;
    return parsed.email ? { email: parsed.email, name: parsed.name || parsed.email } : null;
  } catch {
    return null;
  }
}

export function useSsoIdentity(): SsoIdentity | null {
  const [identity] = useState(readSsoIdentity);
  return identity;
}
