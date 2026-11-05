import { api } from "../api/client";

// Microsoft 365 sign-in, browser side (backend: src/lib/sso.ts). The callback
// URL is this site's own /auth/callback - registered on the broker for
// http://localhost:5173 and http://192.168.0.215:9090.
export const SSO_STATE_KEY = "ssoState";

export function ssoCallbackUrl() {
  return `${window.location.origin}/auth/callback`;
}

function randomState() {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

// Sends the browser to Microsoft sign-in. `state` is remembered for this tab
// and checked again on the way back, so a callback this tab didn't start is
// refused.
export async function startSsoLogin() {
  const state = randomState();
  sessionStorage.setItem(SSO_STATE_KEY, state);
  const { data } = await api.get<{ url: string }>("/auth/sso/start", { params: { redirectUri: ssoCallbackUrl(), state } });
  window.location.assign(data.url);
}
