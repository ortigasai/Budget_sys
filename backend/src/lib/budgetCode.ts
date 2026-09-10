import { BudgetCodePrefixKind, Sbu } from "@prisma/client";
import { prisma } from "../prisma";

// GAE: CD-YY-Num, built from the catalog's own CD+Num (columns A/C) plus the
// *current* Target Calendar Year - not the file's own YY column (B), which
// is frozen to whichever year the file was last edited in. DOE: SBU-YY-Num.
// NPC: HEAD-YY-Num. Every generated code shares this one formatting rule and
// (for DOE/NPC, and GAE's import-time fallback) counter mechanism, keyed by
// whichever prefix code (CD/SBU/Head abbreviation) and calendar year it's for.

// "AS" + 2027 + 1 -> "AS-27-1" - no zero-padding, matching the live source
// catalog's own numbering convention. Pure formatting, no DB read - used
// wherever the sequence number is already known (GAE's own per-CD Num
// column) rather than generated fresh (see nextBudgetCode below for that).
export function formatBudgetCode(prefixCode: string, year: number, num: number): string {
  return `${prefixCode}-${String(year).slice(-2)}-${num}`;
}

// DOE's SBU->code map is a small hardcoded constant (not admin-configurable
// like the CD/NPC-Head lists) since it's tied 1:1 to the Sbu enum - adding a
// new SBU already requires a schema migration, so there's no case where this
// map needs to change independently of that.
// CORPORATE (Note 11) is a real Sbu value now (for the Approved Budget
// report / SBU role assignments), but DOE requests are still only ever
// tagged with one of the 5 real-estate SBUs in practice - this entry exists
// purely so Record<Sbu, string> stays exhaustive, not because a DOE request
// is expected to generate a "COR-YY-Num" code.
const SBU_CODE: Record<Sbu, string> = {
  MALLS: "MAL",
  RESIDENTIAL: "RES",
  OFFICES: "OFF",
  ESTATES: "EST",
  LEISURE: "LEI",
  CORPORATE: "COR",
};

export function sbuBudgetCodePrefix(sbu: Sbu): string {
  return SBU_CODE[sbu];
}

// Looks up a BudgetCodePrefix's abbreviation by its admin-configured label
// (e.g. kind=NPC_HEAD, label="Malls GH" -> "JLC"). Used for NPC's Head picker
// and as GAE's import-time fallback (kind=CENTRALIZED_DEPARTMENT).
export async function getBudgetCodePrefixCode(kind: BudgetCodePrefixKind, label: string): Promise<string | null> {
  const row = await prisma.budgetCodePrefix.findUnique({ where: { kind_label: { kind, label } } });
  return row?.code ?? null;
}

// Atomically advances the (prefixCode, year) counter and formats the result
// (e.g. "AS-27-1", "MAL-27-3") - used for DOE/NPC (no pre-existing Num to
// reuse) and as GAE's fallback for a catalog row missing CD/Num. Postgres's
// upsert-on-unique-constraint is safe under concurrent calls without extra
// locking.
export async function nextBudgetCode(prefixCode: string, year: number): Promise<string> {
  const seq = await prisma.budgetCodeSequence.upsert({
    where: { prefixCode_year: { prefixCode, year } },
    create: { prefixCode, year, lastNumber: 1 },
    update: { lastNumber: { increment: 1 } },
  });
  return formatBudgetCode(prefixCode, year, seq.lastNumber);
}
