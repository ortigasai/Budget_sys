import type { ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api2 } from "../api/client";

// Route guard for Phase 4 (FR-4.5/4.6: reports default to Budget-Officer-only,
// individually grantable). Mirrors RequireRole.tsx's shape, but the check
// itself is server-side (Budget Officer OR an explicit ReportAccessGrant) so
// it's a query, not a synchronous hasRole() call - renders nothing while
// that's in flight rather than flashing the page before bouncing.
export function RequireReportAccess({ children }: { children: ReactNode }) {
  const { data, isLoading } = useQuery({
    queryKey: ["reports", "my-access"],
    queryFn: async () => (await api2.get<{ hasAccess: boolean }>("/reports/my-access")).data,
  });

  if (isLoading) return null;
  if (!data?.hasAccess) return <Navigate to="/" replace />;
  return <>{children}</>;
}
