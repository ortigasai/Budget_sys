// Who the visitor is according to SSO, before they have a Budgeting System
// account - used by the login page's "Request access" form to fill in (and
// lock) the requester's own name and email.
//
// SSO isn't connected yet, so this always returns null and the form asks for
// them instead. When SSO is added, return the signed-in account's display
// name and email here (e.g. from the identity provider's ID token / profile);
// nothing else in the form needs to change.
export interface SsoIdentity {
  name: string;
  email: string;
}

export function useSsoIdentity(): SsoIdentity | null {
  return null;
}
