// One-time fix for NPC requests still carrying the old "NMA" Malls budget
// code prefix. Malls NPC codes switched to the CC-GL workbook's JLC (Malls
// GH) / RFT (every other Malls location) in commit 5a0838d, but a budget
// code is assigned once at creation, so Malls requests made before that keep
// NMA-YY-N. This gives each one the next JLC/RFT number for its location
// (lib/npcSbu.ts's npcSbuBudgetCodePrefix), oldest request first.
//
// BudgetRequest.budgetCode is the only place the code is stored (reports and
// the SAP template read it from the request), so nothing else needs updating.
//
// Data-only, run once by hand. Without --apply it only lists what it would do:
//   npx tsx scripts/recode-nma-budget-codes.ts
//   npx tsx scripts/recode-nma-budget-codes.ts --apply
import { prisma } from "../src/prisma";
import { formatBudgetCode, nextBudgetCode } from "../src/lib/budgetCode";
import { npcSbuBudgetCodePrefix, type NpcLocation, type NpcSbu } from "../src/lib/npcSbu";

const apply = process.argv.includes("--apply");

async function main() {
  const rows = await prisma.budgetRequest.findMany({
    where: { budgetCode: { startsWith: "NMA-" } },
    orderBy: { createdAt: "asc" },
  });
  if (rows.length === 0) {
    console.log("No requests with an NMA budget code - nothing to do.");
    return;
  }

  console.log(`${rows.length} request(s) with an NMA budget code${apply ? "" : " (dry run - add --apply to change them)"}:`);
  // Dry run: preview the numbers each prefix's counter would hand out next.
  const previewNext = new Map<string, number>();
  for (const r of rows) {
    if (r.requestCategory !== "NPC" || r.npcSbu !== "MALLS" || !r.npcLocation) {
      console.log(`  ${r.ticketNumber} ${r.budgetCode}: skipped - not a Malls NPC request with a location (category ${r.requestCategory}, SBU ${r.npcSbu ?? "-"}).`);
      continue;
    }
    const prefix = npcSbuBudgetCodePrefix(r.npcSbu as NpcSbu, r.npcLocation as NpcLocation);
    const year = 2000 + Number(r.budgetCode!.split("-")[1]);
    let newCode: string;
    if (apply) {
      newCode = await nextBudgetCode(prefix, year);
      await prisma.budgetRequest.update({ where: { id: r.id }, data: { budgetCode: newCode } });
    } else {
      const key = `${prefix}|${year}`;
      if (!previewNext.has(key)) {
        const seq = await prisma.budgetCodeSequence.findUnique({ where: { prefixCode_year: { prefixCode: prefix, year } } });
        previewNext.set(key, seq?.lastNumber ?? 0);
      }
      const n = previewNext.get(key)! + 1;
      previewNext.set(key, n);
      newCode = formatBudgetCode(prefix, year, n);
    }
    console.log(`  ${r.ticketNumber} ${r.budgetCode} -> ${newCode}  (location ${r.npcLocation}, ${r.currentStage}, ${r.projectTitle ?? ""})`);
  }
  console.log(apply ? "Done." : "Nothing changed. Run again with --apply to re-code these.");
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
