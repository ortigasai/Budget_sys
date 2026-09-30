import path from "node:path";
import ExcelJS from "exceljs";
import { PrismaClient } from "@prisma/client";
import { testPasswordHash } from "../src/lib/employeeImport";

// Re-runnable importer for "Budgeting System_User Management.xlsx": one tab
// per access group (BCA, CD, NCD, MC, SF, NPC), each listing its members.
// Matches users by email (creating missing ones with the shared testing
// password), then replaces every UserGroupMembership row with what the file
// says. Usage: npx tsx prisma/importUserManagement.ts [path-to-xlsx]

const DEFAULT_FILE = path.resolve(__dirname, "../../Budgeting System_User Management.xlsx");
const TABS = ["BCA", "CD", "NCD", "MC", "SF", "NPC"] as const;

// Sheet department name -> Department.name candidates in the DB (the sheet
// uses cleaner names than the employee-list import did).
const DEPT_ALIASES: Record<string, string[]> = {
  "Administrative Services": ["Administrative Services Department", "Admin Services", "Admin Services Department"],
  "Information System & Information Technology": ["Information System & Information Technology", "IS & IT"],
  "Legal": ["Legal", "Legal Department"],
  "Estates": ["Estates"],
};

function cellText(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "object" && v !== null && "text" in (v as object)) return String((v as { text: unknown }).text).trim();
  return String(v).trim();
}

// Some sheet emails contain stray spaces (e.g. "abundo iiimdi@...").
const normEmail = (e: string) => e.replace(/\s+/g, "").toLowerCase();

// The sheet's emails don't always match the employee list's (e.g. sheet
// "jimenezaer@" vs employee "albertineellen.jimenez@"), so fall back to
// matching an existing employee by name (middle initials/suffixes ignored)
// before ever creating a new account - otherwise the same person ends up with
// two logins and the one holding their roles has no group.
const nameTokens = (n: string) =>
  n
    .toLowerCase()
    .replace(/[^a-zñ ]/g, " ")
    .split(/\s+/)
    .filter((t) => t && !["jr", "sr", "ii", "iii"].includes(t));

async function main() {
  const file = process.argv[2] ? path.resolve(process.argv[2]) : DEFAULT_FILE;
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(file);
  const prisma = new PrismaClient();

  const departments = await prisma.department.findMany();
  const deptByName = new Map(departments.map((d) => [d.name.toLowerCase(), d]));
  const findDept = (name: string) => {
    for (const cand of [name, ...(DEPT_ALIASES[name] ?? [])]) {
      const hit = deptByName.get(cand.toLowerCase());
      if (hit) return hit;
    }
    return null;
  };

  const employees = (await prisma.user.findMany()).filter((u) => u.employeeIdNumber !== null);
  const findByName = (name: string) => {
    const t = nameTokens(name);
    const exact = employees.filter((e) => nameTokens(e.name).join(" ") === t.join(" "));
    if (exact.length === 1) return exact[0];
    const loose = employees.filter((e) => {
      const et = nameTokens(e.name);
      return et[0] === t[0] && et[et.length - 1] === t[t.length - 1];
    });
    return loose.length === 1 ? loose[0] : null;
  };
  const emailToUserId = new Map<string, string>();

  const passwordHash = await testPasswordHash();
  const memberships: { email: string; group: string; scope: string }[] = [];
  const created: string[] = [];
  const unmatchedDepts = new Set<string>();

  for (const tab of TABS) {
    const sheet = wb.getWorksheet(tab);
    if (!sheet) {
      console.warn(`Tab "${tab}" not found - skipped.`);
      continue;
    }
    for (let r = 2; r <= sheet.rowCount; r++) {
      const row = sheet.getRow(r);
      const name = cellText(row.getCell(1).value);
      const email = normEmail(cellText(row.getCell(2).value));
      const scope = cellText(row.getCell(3).value);
      if (!name || !email) continue;

      // Group scope is only meaningful for CD/NCD (department), SF (SBU) and
      // NPC (NPC SBU); BCA/MC's third column is just a department label.
      const groupScope = tab === "BCA" || tab === "MC" ? "" : scope;

      let user = await prisma.user.findUnique({ where: { email } });
      if (!user) user = findByName(name);
      if (!user) {
        const dept = tab === "CD" || tab === "NCD" || tab === "BCA" || tab === "MC" ? findDept(scope) : null;
        if ((tab === "CD" || tab === "NCD") && !dept) unmatchedDepts.add(scope);
        user = await prisma.user.create({ data: { name, email, passwordHash, departmentId: dept?.id ?? null } });
        created.push(`${name} <${email}>`);
      }
      emailToUserId.set(email, user.id);
      memberships.push({ email, group: tab, scope: groupScope });
    }
  }

  await prisma.userGroupMembership.deleteMany();
  let count = 0;
  for (const m of memberships) {
    const userId = emailToUserId.get(m.email)!;
    await prisma.userGroupMembership.upsert({
      where: { userId_group_scope: { userId, group: m.group, scope: m.scope } },
      update: {},
      create: { userId, group: m.group, scope: m.scope },
    });
    count++;
  }

  // Rules tab: "The personnel belonged to BCA will have access to everything
  // like the Budget Officer" - mirror that on the role side too, so the
  // existing role-gated pages/routes (Admin Console, Finalization, ...) open
  // up for them, using the same department the current Budget Officer has.
  const existingBo = await prisma.roleAssignment.findFirst({ where: { roleType: "BUDGET_OFFICER" } });
  if (existingBo) {
    for (const m of memberships.filter((x) => x.group === "BCA")) {
      const userId = emailToUserId.get(m.email)!;
      await prisma.roleAssignment.upsert({
        where: { departmentId_roleType_userId: { departmentId: existingBo.departmentId, roleType: "BUDGET_OFFICER", userId } },
        update: {},
        create: { departmentId: existingBo.departmentId, roleType: "BUDGET_OFFICER", userId },
      });
    }
  }

  console.log(`Memberships written: ${count}`);
  console.log(`Users created (${created.length}):`);
  created.forEach((c) => console.log("  " + c));
  if (unmatchedDepts.size) console.log(`CD/NCD departments with no matching Department row (users created without one): ${[...unmatchedDepts].join("; ")}`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
