import { useAuth } from "../context/AuthContext";
import type { NpcSbu, Sbu } from "../api/client";

// Mirrors backend/src/lib/groupScope.ts's finalizationViewScope: an SBU
// Finance (SF) member with Budget Finalization & Upload access only views the
// Board-Approved figures (Consolidated Board-Approved P&L and Board-Approved
// NPC Budget), for their own SBU(s). null = not limited (the Budget Officer,
// BCA members, and anyone outside the SF group).
export interface FinalizationViewScope {
  sbus: Sbu[];
  npcSbus: NpcSbu[];
}

const SF_SCOPE_TO_NPC_SBUS: Record<string, NpcSbu[]> = {
  CORPORATE: ["CORPORATE_ADMIN", "CORPORATE_HR", "CORPORATE_IT"],
  ESTATES: ["ESTATES"],
  LEISURE: ["LEISURE"],
  MALLS: ["MALLS"],
  OFFICES: ["OFFICES"],
  RESIDENTIAL: ["RESIDENTIAL"],
};

export function useFinalizationViewScope(): FinalizationViewScope | null {
  const { currentUser, hasRole } = useAuth();
  if (!currentUser || hasRole("BUDGET_OFFICER")) return null;
  const groups = currentUser.groups ?? [];
  if (groups.some((g) => g.group === "BCA")) return null;
  const sf = groups.filter((g) => g.group === "SF");
  if (sf.length === 0) return null;
  const sbus = [...new Set(sf.map((g) => g.scope.toUpperCase()))] as Sbu[];
  return { sbus, npcSbus: [...new Set(sbus.flatMap((s) => SF_SCOPE_TO_NPC_SBUS[s] ?? []))] };
}
