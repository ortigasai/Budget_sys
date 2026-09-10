import { useQuery } from "@tanstack/react-query";
import { api } from "../api/client";

export interface FiscalCycleConfig {
  asOfMonth2026: number;
  targetCalendarYear: number;
  cycleOpen: boolean;
  updatedBy?: string;
  updatedAt?: string;
}

// Matches the backend's own default (lib/fiscalCycle.ts) - used only while
// the config is loading, so every page starts in a consistent state instead
// of each hardcoding its own literal.
const DEFAULT_TARGET_CALENDAR_YEAR = 2027;

export function useFiscalCycle() {
  return useQuery({
    queryKey: ["fiscal-cycle"],
    queryFn: async () => (await api.get<FiscalCycleConfig>("/admin/fiscal-cycle")).data,
  });
}

// Convenience hook for the common case: just the two derived years (forecast
// year is always one behind the target calendar year - FR-1.4/1.10).
export function useFiscalYear() {
  const { data } = useFiscalCycle();
  const targetYear = data?.targetCalendarYear ?? DEFAULT_TARGET_CALENDAR_YEAR;
  return { targetYear, forecastYear: targetYear - 1 };
}
