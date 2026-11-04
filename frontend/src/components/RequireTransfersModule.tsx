import type { ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { useFeatureToggles } from "../lib/featureToggles";
import { canUseTransfersModule } from "../lib/phases";

// Module 3 route guard while the module is switched off (Admin Console >
// Hidden Menus): everyone but the Budget Officer is sent back to the module
// menu.
export function RequireTransfersModule({ children }: { children: ReactNode }) {
  const { hasRole } = useAuth();
  const { isOn, isLoading } = useFeatureToggles();
  if (isLoading) return null;
  if (!canUseTransfersModule(hasRole, isOn("transfersModule"))) return <Navigate to="/" replace />;
  return <>{children}</>;
}
