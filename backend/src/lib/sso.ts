import axios from "axios";
import { HttpError } from "../httpError";

// Microsoft 365 sign-in through the Prompters API broker
// (paba.ortigasland.com.ph):
//   1. the browser is sent to the broker's /authorize/ page (no API key) with
//      our callback URL and a random `state`;
//   2. after Microsoft sign-in the broker sends the person back to
//      <callback>?code=...&state=...;
//   3. this backend exchanges the code SERVER-SIDE with SSO_API_KEY and gets
//      who signed in.
// Settings (backend/.env):
//   SSO_API_KEY        required to enable SSO
//   SSO_BROKER_URL     default https://paba.ortigasland.com.ph/api/v1
//   SSO_APP_SLUG       default budgeting-system-sso (the sign-in app registered
//                      on the broker for the "budgeting-system-sso" key)
//   SSO_REDIRECT_URIS  comma-separated callback URLs registered on the broker
//   LOGIN_METHODS      which login options the login page offers - any of
//                      quick (testing dropdown), password, sso. Default: all
//                      three. Server/UAT: set LOGIN_METHODS=sso.
const BROKER_URL = (process.env.SSO_BROKER_URL ?? "https://paba.ortigasland.com.ph/api/v1").replace(/\/+$/, "");
const APP_SLUG = process.env.SSO_APP_SLUG ?? "budgeting-system-sso";
const REDIRECT_URIS = (process.env.SSO_REDIRECT_URIS ?? "http://localhost:5173/auth/callback,http://192.168.0.215:9090/auth/callback")
  .split(",")
  .map((u) => u.trim())
  .filter(Boolean);

export type LoginMethod = "quick" | "password" | "sso";

export function ssoConfigured(): boolean {
  return !!process.env.SSO_API_KEY?.trim();
}

export function loginMethods(): LoginMethod[] {
  const raw = process.env.LOGIN_METHODS?.trim();
  const wanted = (raw ? raw.split(",") : ["quick", "password", "sso"]).map((m) => m.trim().toLowerCase());
  const methods = (["quick", "password", "sso"] as const).filter((m) => wanted.includes(m));
  // SSO can't be offered without a key; never leave the page with no way in.
  const usable = methods.filter((m) => m !== "sso" || ssoConfigured());
  return usable.length > 0 ? usable : ["password"];
}

export function ssoAuthorizeUrl(redirectUri: string, state: string): string {
  if (!REDIRECT_URIS.includes(redirectUri)) {
    throw new HttpError(400, `This address isn't registered for Microsoft sign-in (${redirectUri}). Registered: ${REDIRECT_URIS.join(", ")}.`);
  }
  const params = new URLSearchParams({ redirect_uri: redirectUri, state });
  return `${BROKER_URL}/sso/${APP_SLUG}/authorize/?${params.toString()}`;
}

export interface SsoProfile {
  email: string;
  name: string | null;
}

// The broker's exchange response isn't documented beyond "exchange the
// code", so read the usual Microsoft / OIDC field names, at the top level or
// under user / profile / claims.
function pickProfile(data: unknown): SsoProfile | null {
  const sources: Record<string, unknown>[] = [];
  if (data && typeof data === "object") {
    const d = data as Record<string, unknown>;
    sources.push(d);
    for (const key of ["user", "profile", "claims", "identity", "data"]) {
      if (d[key] && typeof d[key] === "object") sources.push(d[key] as Record<string, unknown>);
    }
  }
  const first = (keys: string[]) => {
    for (const s of sources) {
      for (const k of keys) {
        const v = s[k];
        if (typeof v === "string" && v.trim()) return v.trim();
      }
    }
    return null;
  };
  const email = first(["email", "mail", "userPrincipalName", "upn", "preferred_username", "unique_name"]);
  if (!email || !email.includes("@")) return null;
  return { email: email.toLowerCase(), name: first(["name", "displayName", "display_name", "full_name"]) };
}

export async function exchangeSsoCode(code: string): Promise<SsoProfile> {
  const key = process.env.SSO_API_KEY?.trim();
  if (!key) throw new HttpError(503, "Microsoft sign-in isn't set up on this server (SSO_API_KEY is missing).");
  let data: unknown;
  try {
    const res = await axios.post(`${BROKER_URL}/sso/${APP_SLUG}/exchange/`, { code }, { headers: { "X-API-Key": key }, timeout: 15_000 });
    data = res.data;
  } catch (err) {
    if (axios.isAxiosError(err) && err.response) {
      const message = (err.response.data as { error?: { message?: string } } | undefined)?.error?.message;
      console.error(`[sso] exchange failed: ${err.response.status} ${message ?? ""}`);
      const reason = (message ?? `the sign-in service returned ${err.response.status}`).replace(/\.+$/, "");
      throw new HttpError(err.response.status === 401 ? 502 : 400, `Microsoft sign-in failed: ${reason}. Please try again.`);
    }
    console.error("[sso] exchange failed: sign-in service unreachable", err instanceof Error ? err.message : err);
    throw new HttpError(503, "The Microsoft sign-in service isn't responding - please try again in a minute.");
  }
  const profile = pickProfile(data);
  if (!profile) {
    // Field names only - never the values.
    const keys = data && typeof data === "object" ? Object.keys(data as object).join(", ") : typeof data;
    console.error(`[sso] exchange response had no email; fields: ${keys}`);
    throw new HttpError(502, "Microsoft sign-in didn't return an email address - please tell the Budget Officer.");
  }
  return profile;
}
