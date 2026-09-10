// Spec item 12's NPC-specific SBU list — distinct from both the 5-value
// `Sbu` enum DOE uses (3 Corporate entries don't apply to DOE) and the
// admin-configurable NPC_HEAD BudgetCodePrefix list this replaces (which
// split Malls into GH/NonGH and isn't a 1:1 match with this fixed 8-value
// list). Kept as a plain string on BudgetRequest.npcSbu rather than widening
// the Sbu enum.
export const NPC_SBU_VALUES = [
  "MALLS",
  "OFFICES",
  "ESTATES",
  "RESIDENTIAL",
  "LEISURE",
  "CORPORATE_IT",
  "CORPORATE_HR",
  "CORPORATE_ADMIN",
] as const;
export type NpcSbu = (typeof NPC_SBU_VALUES)[number];

export const NPC_SBU_OPTIONS: { value: NpcSbu; label: string }[] = [
  { value: "MALLS", label: "Malls" },
  { value: "OFFICES", label: "Offices" },
  { value: "ESTATES", label: "Estates" },
  { value: "RESIDENTIAL", label: "Residential" },
  { value: "LEISURE", label: "Leisure" },
  { value: "CORPORATE_IT", label: "Corporate IT" },
  { value: "CORPORATE_HR", label: "Corporate HR" },
  { value: "CORPORATE_ADMIN", label: "Corporate Admin" },
];

// Deliberately distinct 3-letter codes from DOE's MAL/RES/OFF/EST/LEI (see
// budgetCode.ts's SBU_CODE) so NPC requests never share a (prefixCode, year)
// budget-code sequence counter with a DOE request.
const NPC_SBU_CODE: Record<NpcSbu, string> = {
  MALLS: "NMA",
  OFFICES: "NOF",
  ESTATES: "NES",
  RESIDENTIAL: "NRE",
  LEISURE: "NLE",
  CORPORATE_IT: "NIT",
  CORPORATE_HR: "NHR",
  CORPORATE_ADMIN: "NAD",
};

export function npcSbuBudgetCodePrefix(sbu: NpcSbu): string {
  return NPC_SBU_CODE[sbu];
}

// Spec item 12's fixed 4-value Location list — plain hardcoded list, not an
// admin-configurable table (unlike Phase 3's IoLocation), since the spec
// didn't ask for editability here.
export const NPC_LOCATION_VALUES = ["OE", "CC", "GH", "CV"] as const;
export type NpcLocation = (typeof NPC_LOCATION_VALUES)[number];
export const NPC_LOCATION_OPTIONS: { value: NpcLocation; label: string }[] = [
  { value: "OE", label: "OE" },
  { value: "CC", label: "CC" },
  { value: "GH", label: "GH" },
  { value: "CV", label: "CV" },
];
