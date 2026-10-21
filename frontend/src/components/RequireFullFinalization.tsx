import type { ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { useFinalizationViewScope } from "../lib/finalizationScope";

// Pending Requests and the Finalized Budget Report: everyone who can open
// Budget Finalization & Upload except an SBU Finance viewer, who only gets
// the Board-Approved pages (see lib/finalizationScope.ts).
export function RequireFullFinalization({ children }: { children: ReactNode }) {
  if (useFinalizationViewScope()) return <Navigate to="/step5?category=SBU" replace />;
  return <>{children}</>;
}
