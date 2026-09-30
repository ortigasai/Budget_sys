import path from "node:path";
import ExcelJS from "exceljs";
import { PrismaClient } from "@prisma/client";
import { buildExpenseLineItemId } from "../src/lib/expenseLineItemCatalog";

// Re-runnable importer for "Budgeting System_Expense Line Items.xlsx" columns
// J ("Centralized Dept Requestor/Reviewer") and K ("Centralized Dept Head") -
// sets ExpenseLineItem.centralizedReviewerId/centralizedHeadId (see
// approvalChain.ts's chainFor for the Reviewer's own use as the automatic
// Centralized L1 Review assignee, and routes/forecast.ts for both fields'
// use scoping the GAE Forecast page down to just a viewer's own assigned
// line items) on the ALREADY-IMPORTED catalog rows. Deliberately narrow:
// this does NOT touch any other field (unlike expenseLineItemService.ts's
// full "upload replaces the catalog" override) - it only reads columns J/K
// (plus name/category/company, to build the same id the catalog importer
// uses) and writes those two columns back. Usage:
// npx tsx prisma/importCentralizedReviewers.ts [path]
//
// The source file's own columns shifted once "Centralized Dept Requestor/
// Reviewer" (J) and "Centralized Dept Head" (K) were inserted - Cost Center/
// GL Account/Additional Field/etc. that used to start at column 10 now start
// at column 12. lib/expenseLineItemCatalog.ts's own parseWorkbook still reads
// the OLD offsets (columns 10-16) and hasn't been updated to match, since
// re-running that importer against this file's new shape would need its own
// careful pass - this script only reads columns 1/5/6/7 (id) and 10/11 (J/K).

const DEFAULT_FILE = path.resolve(__dirname, "../../Budgeting System_Expense Line Items.xlsx");

const nameTokens = (n: string) =>
  n
    .toLowerCase()
    .replace(/[^a-zñ ]/g, " ")
    .split(/\s+/)
    .filter((t) => t && !["jr", "sr", "ii", "iii"].includes(t));

function cellText(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "object" && v !== null && "result" in (v as object)) return String((v as { result: unknown }).result ?? "");
  if (typeof v === "object" && v !== null && "richText" in (v as object)) return (v as any).richText.map((t: any) => t.text).join("");
  return String(v).trim();
}

async function main() {
  const file = process.argv[2] ? path.resolve(process.argv[2]) : DEFAULT_FILE;
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(file);
  const sheet = wb.getWorksheet("GAE") ?? wb.worksheets[0];
  const prisma = new PrismaClient();

  // Not restricted to employeeIdNumber != null - some CD-tab-only people
  // (e.g. Lino Arboleda, Chezzka Sheen Padilla) were created straight from
  // the Approval Workflow import, with no official employee-list record.
  const allUsers = await prisma.user.findMany();
  const findByName = (name: string) => {
    const t = nameTokens(name);
    if (t.length === 0) return null;
    const exact = allUsers.filter((e) => nameTokens(e.name).join(" ") === t.join(" "));
    if (exact.length === 1) return exact[0];
    const loose = allUsers.filter((e) => {
      const et = nameTokens(e.name);
      return et[0] === t[0] && et[et.length - 1] === t[t.length - 1];
    });
    return loose.length === 1 ? loose[0] : null;
  };

  let updatedReviewer = 0;
  let updatedHead = 0;
  let noMatchInDb = 0;
  let noMatchByName = 0;
  const unmatchedNames = new Set<string>();
  const unmatchedRows: string[] = [];
  const multiHeadRows: string[] = [];

  // Column K sometimes lists more than one co-head, comma-separated (e.g.
  // "Andrea Romina C. Macasero, Maria Jennifer J. Almojuela") - centralizedHeadId
  // is a single value (same convention as centralizedReviewerId), so this
  // takes the first name that resolves to a real employee rather than
  // failing the whole cell.
  const firstMatchingName = (cellValue: string): { user: ReturnType<typeof findByName>; multiple: boolean } => {
    const candidates = cellValue.split(",").map((s) => s.trim()).filter(Boolean);
    for (const candidate of candidates) {
      const user = findByName(candidate);
      if (user) return { user, multiple: candidates.length > 1 };
    }
    return { user: null, multiple: candidates.length > 1 };
  };

  for (let r = 3; r <= sheet.rowCount; r++) {
    const row = sheet.getRow(r);
    const category = cellText(row.getCell(5).value);
    const name = cellText(row.getCell(6).value);
    const companyRaw = cellText(row.getCell(7).value);
    const companyCode = companyRaw === "OLCP" ? "OCLP" : companyRaw || null;
    const reviewerName = cellText(row.getCell(10).value);
    const headName = cellText(row.getCell(11).value);
    if (!category || !name) continue;

    const id = buildExpenseLineItemId(category, name, companyCode);
    const existing = await prisma.expenseLineItem.findUnique({ where: { id } });
    if (!existing) {
      noMatchInDb++;
      unmatchedRows.push(`${name} (${companyCode ?? "any"})`);
      continue;
    }
    if (!reviewerName && !headName) continue;

    const data: { centralizedReviewerId?: string; centralizedHeadId?: string } = {};
    if (reviewerName) {
      const user = findByName(reviewerName);
      if (!user) {
        noMatchByName++;
        unmatchedNames.add(reviewerName);
      } else if (existing.centralizedReviewerId !== user.id) {
        data.centralizedReviewerId = user.id;
      }
    }
    if (headName) {
      const { user, multiple } = firstMatchingName(headName);
      if (multiple) multiHeadRows.push(`${name}: "${headName}"`);
      if (!user) {
        noMatchByName++;
        unmatchedNames.add(headName);
      } else if (existing.centralizedHeadId !== user.id) {
        data.centralizedHeadId = user.id;
      }
    }
    if (Object.keys(data).length > 0) {
      await prisma.expenseLineItem.update({ where: { id }, data });
      if (data.centralizedReviewerId) updatedReviewer++;
      if (data.centralizedHeadId) updatedHead++;
    }
  }

  console.log(`Updated centralizedReviewerId on ${updatedReviewer} expense line item(s).`);
  console.log(`Updated centralizedHeadId on ${updatedHead} expense line item(s).`);
  console.log(`Rows with no matching catalog id in the DB: ${noMatchInDb}`);
  if (unmatchedRows.length) console.log("  " + unmatchedRows.slice(0, 20).join("; ") + (unmatchedRows.length > 20 ? ` ... (+${unmatchedRows.length - 20} more)` : ""));
  console.log(`Reviewer/Head names with no matching employee: ${noMatchByName}`);
  if (unmatchedNames.size) console.log("  " + [...unmatchedNames].join("; "));
  console.log(`Rows listing more than one Centralized Dept Head (first match used): ${multiHeadRows.length}`);
  if (multiHeadRows.length) console.log("  " + multiHeadRows.slice(0, 20).join("; ") + (multiHeadRows.length > 20 ? ` ... (+${multiHeadRows.length - 20} more)` : ""));
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
