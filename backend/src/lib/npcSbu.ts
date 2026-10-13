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

// NPC Budget Code prefixes, from "Budgeting System_CC-GL" tab CC (NPC SBU ->
// NPC Budget Code). Malls splits by location: GH -> Malls GH (JLC), any other
// location -> Malls NonGH (RFT). Leisure has no CC-tab row, so its admin Head
// code (LEI) is used. Distinct from DOE's MAL/RES/OFF/EST/LEI (see
// budgetCode.ts's SBU_CODE) so NPC requests never share a (prefixCode, year)
// budget-code sequence counter with a DOE request.
const NPC_SBU_CODE: Record<Exclude<NpcSbu, "MALLS">, string> = {
  OFFICES: "WPD",
  ESTATES: "RGM",
  RESIDENTIAL: "JJB",
  LEISURE: "LEI",
  CORPORATE_IT: "RBQ",
  CORPORATE_HR: "MGM",
  CORPORATE_ADMIN: "LPA",
};

export function npcSbuBudgetCodePrefix(sbu: NpcSbu, location: NpcLocation): string {
  if (sbu === "MALLS") return location === "GH" ? "JLC" : "RFT";
  return NPC_SBU_CODE[sbu];
}

// Spec item 12's fixed Location list — plain hardcoded list, not an
// admin-configurable table (unlike Phase 3's IoLocation), since the spec
// didn't ask for editability here. ES, like every location other than GH,
// resolves to Malls NonGH (RFT) in npcSbuBudgetCodePrefix above.
export const NPC_LOCATION_VALUES = ["OE", "CC", "GH", "CV", "ES"] as const;
export type NpcLocation = (typeof NPC_LOCATION_VALUES)[number];
export const NPC_LOCATION_OPTIONS: { value: NpcLocation; label: string }[] = [
  { value: "OE", label: "OE" },
  { value: "CC", label: "CC" },
  { value: "GH", label: "GH" },
  { value: "CV", label: "CV" },
  { value: "ES", label: "ES" },
];

// The User Management workbook's own labels for the NPC group's scope -> the
// codes above (mirrors backend-py/app/npc_sbu.py's NPC_GROUP_SCOPE_TO_SBU).
export const NPC_GROUP_SCOPE_TO_SBU: Record<string, string> = {
  Malls: "MALLS",
  Offices: "OFFICES",
  Estates: "ESTATES",
  Residential: "RESIDENTIAL",
  Leisure: "LEISURE",
  "Corporate - IT": "CORPORATE_IT",
  "Corporate - HR": "CORPORATE_HR",
  "Corporate - Admin": "CORPORATE_ADMIN",
};
