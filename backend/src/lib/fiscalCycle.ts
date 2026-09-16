import { prisma } from "../prisma";

export interface FiscalCycle {
  targetCalendarYear: number;
  // The year Forecast/HistoricalActuals reference data is for - always one
  // year behind the target calendar year (2027 budget -> 2026 forecast).
  forecastYear: number;
  cycleOpen: boolean;
  // Which month of forecastYear is "as of" right now (Forecast's own
  // cutoff control) - not derived from targetCalendarYear, just co-located
  // here since it lives on the same FiscalCycleConfig singleton row and was
  // previously read via three separate copies of the same query
  // (forecast.ts, forecastWorkflowService.ts, manpowerService.ts). Drives
  // GAE/DOE/Revenue's own Forecast views.
  asOfMonth: number;
  // NPC Forecast's own independent cutoff - a Budget Officer changing this
  // does not move asOfMonth above (or vice versa), per the user's explicit
  // request that GAE and NPC not depend on each other here.
  npcAsOfMonth: number;
}

const DEFAULT_TARGET_CALENDAR_YEAR = 2027;
const DEFAULT_AS_OF_MONTH = 9;

// Single read of the FiscalCycleConfig singleton, computing the derived
// forecastYear so every caller (route defaults, HistoricalActuals lookups,
// dynamic label text) agrees on "forecast year = target year - 1" instead
// of each hardcoding its own literal.
export async function getFiscalCycle(): Promise<FiscalCycle> {
  const config = await prisma.fiscalCycleConfig.findUnique({ where: { id: "singleton" } });
  const targetCalendarYear = config?.targetCalendarYear ?? DEFAULT_TARGET_CALENDAR_YEAR;
  return {
    targetCalendarYear,
    forecastYear: targetCalendarYear - 1,
    cycleOpen: config?.cycleOpen ?? true,
    asOfMonth: config?.asOfMonth2026 ?? DEFAULT_AS_OF_MONTH,
    npcAsOfMonth: config?.npcAsOfMonth2026 ?? DEFAULT_AS_OF_MONTH,
  };
}
