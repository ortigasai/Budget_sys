import type { ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

// The sidebar (Layout.tsx) only hides nav links for roles that shouldn't see
// them — it doesn't stop someone from navigating straight to the URL. Routes
// restricted to a role in the sidebar need this guard too, or the page (and
// whatever data its unguarded GET endpoints return) renders for anyone.
// Sends anyone without the role straight back to Home rather than showing a
// denial message — the page should simply not exist for them.
//
// `role` accepts a single role or a list (OR semantics: any one match is
// enough) — matches the ad hoc multi-role gates Layout.tsx already builds
// for nav visibility (isReviewer, isHrHead, etc.), so a route needing the
// same kind of gate extends this one shared guard instead of a bespoke one.
export function RequireRole({ role, children }: { role: string | string[]; children: ReactNode }) {
  const { hasRole } = useAuth();
  const roles = Array.isArray(role) ? role : [role];

  if (!roles.some((r) => hasRole(r))) {
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
}
