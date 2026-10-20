import type { ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { canUseTransfersModule } from "../lib/phases";

// Module 3 route guard while the module is switched off (see
// TRANSFERS_MODULE_ENABLED in lib/phases.ts): everyone but the Budget Officer
// is sent back to the module menu.
export function RequireTransfersModule({ children }: { children: ReactNode }) {
  const { hasRole } = useAuth();
  if (!canUseTransfersModule(hasRole)) return <Navigate to="/" replace />;
  return <>{children}</>;
}
