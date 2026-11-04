import { useQuery } from "@tanstack/react-query";
import { api } from "../api/client";
import { useAuth } from "../context/AuthContext";

// Admin Console > Hidden Menus: parts of the app that are built but not open
// yet, switched on/off by the Budget Officer (see backend/src/lib/featureToggles.ts
// for the list). Everything reads as off until the switches have loaded.
export type FeatureToggleKey = "manpowerBudget" | "dashFlow" | "transfersModule";

export interface FeatureToggle {
  key: FeatureToggleKey;
  label: string;
  module: string;
  whenOff: string;
  whenOn: string;
  enabled: boolean;
  updatedAt: string | null;
  updatedBy: string | null;
}

export function useFeatureToggles() {
  const { currentUser } = useAuth();
  const { data, isLoading } = useQuery({
    queryKey: ["feature-toggles"],
    queryFn: async () => (await api.get<FeatureToggle[]>("/admin/feature-toggles")).data,
    enabled: !!currentUser,
    staleTime: 60_000,
  });
  const isOn = (key: FeatureToggleKey) => data?.find((t) => t.key === key)?.enabled ?? false;
  return { toggles: data ?? [], isLoading, isOn };
}
