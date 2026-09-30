import path from "node:path";
import ExcelJS from "exceljs";
import { PrismaClient, RoleType, Sbu } from "@prisma/client";
import { testPasswordHash } from "../src/lib/employeeImport";

// Re-runnable importer for "Budgeting System_Approval Workflow.xlsx" - applies
// who holds each named approval role (CD tab, SF tab, Rules tab) as
// RoleAssignment / SbuRoleAssignment rows. It REPLACES every assignment of the
// role types the file governs (so removing someone from the file removes the
// role); Department Head (a dropdown pick per request) and Budget Officer
// assignments are left alone.
// Usage: npx tsx prisma/importApprovalWorkflow.ts [path-to-xlsx]

const DEFAULT_FILE = path.resolve(__dirname, "../../Budgeting System_Approval Workflow.xlsx");

// Workbook department name -> Department.name (the core Forecast/Utilization spelling where one exists).
const DEPT_ALIASES: Record<string, string> = {
  "Administrative Services": "Admin Services",
  "Information System & Information Technology": "IS & IT",
};

const nameTokens = (n: string) =>
  n
    .toLowerCase()
    .replace(/[^a-z\u00f1 ]/g, " ")
    .split(/\s+/)
    .filter((t) => t && !["jr", "sr", "ii", "iii"].includes(t));

const cell = (v: unknown) => (v === null || v === undefined ? "" : typeof v === "object" && "text" in (v as object) ? String((v as { text: unknown }).text).trim() : String(v).trim());

async function main() {
  const file = process.argv[2] ? path.resolve(process.argv[2]) : DEFAULT_FILE;
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(file);
  const prisma = new PrismaClient();

  const users = await prisma.user.findMany();
  const employees = users.filter((u) => u.employeeIdNumber !== null);
  const findUser = (name: string, email: string) => {
    const e = email.replace(/\s+/g, "").toLowerCase();
    const byEmail = users.find((u) => u.email === e);
    if (byEmail) return byEmail;
    const t = nameTokens(name);
    const exact = employees.filter((u) => nameTokens(u.name).join(" ") === t.join(" "));
    if (exact.length === 1) return exact[0];
    const loose = employees.filter((u) => {
      const ut = nameTokens(u.name);
      return ut[0] === t[0] && ut[ut.length - 1] === t[t.length - 1];
    });
    return loose.length === 1 ? loose[0] : null;
  };
  const passwordHash = await testPasswordHash();
  const missing: string[] = [];
  const resolve = async (name: string, email: string) => {
    let u = findUser(name, email);
    if (!u) {
      u = await prisma.user.create({ data: { name, email: email.replace(/\s+/g, "").toLowerCase() || `${name.toLowerCase().replace(/\W+/g, ".")}@ortigas.com.ph`, passwordHash } });
      users.push(u);
      missing.push(name);
    }
    return u;
  };

  const departments = await prisma.department.findMany();
  const deptByName = new Map(departments.map((d) => [d.name.toLowerCase(), d]));
  const findDept = (n: string) => deptByName.get((DEPT_ALIASES[n] ?? n).toLowerCase()) ?? deptByName.get(n.toLowerCase()) ?? null;

  const deptRoles: { userId: string; departmentId: string; roleType: RoleType }[] = [];
  const sbuRoles: { userId: string; sbu: Sbu; roleType: RoleType }[] = [];
  const unmatchedDepts = new Set<string>();

  const cd = wb.getWorksheet("CD");
  if (cd) {
    for (let r = 2; r <= cd.rowCount; r++) {
      const [dept, name, email, role] = [1, 2, 3, 4].map((c) => cell(cd.getRow(r).getCell(c).value));
      if (!name || !dept) continue;
      const d = findDept(dept);
      if (!d) {
        unmatchedDepts.add(dept);
        continue;
      }
      const u = await resolve(name, email);
      if (role === "Centralized Department Head") deptRoles.push({ userId: u.id, departmentId: d.id, roleType: RoleType.CENTRALIZED_DEPARTMENT_HEAD });
      else {
        // The Centralized Department Requestor both initiates GAE requests and
        // holds the first review stage at their department.
        deptRoles.push({ userId: u.id, departmentId: d.id, roleType: RoleType.CENTRALIZED_BUDGET_PREPARER });
        deptRoles.push({ userId: u.id, departmentId: d.id, roleType: RoleType.CENTRALIZED_FIRST_LEVEL_REVIEWER });
      }
    }
  }

  const sf = wb.getWorksheet("SF");
  if (sf) {
    for (let r = 2; r <= sf.rowCount; r++) {
      const [name, email, sbu, role] = [1, 2, 3, 4].map((c) => cell(sf.getRow(r).getCell(c).value));
      if (!name || !sbu) continue;
      const u = await resolve(name, email);
      const sbuEnum = sbu.toUpperCase() as Sbu;
      sbuRoles.push({ userId: u.id, sbu: sbuEnum, roleType: role === "SBU Finance Head" ? RoleType.BU_FINANCE_HEAD : RoleType.BU_FINANCE_OFFICER });
    }
  }

  // Rules tab: single named holders.
  const hr = findDept("Human Resources");
  const bca = findDept("Budget, Controls & Analysis");
  const cfoDept = findDept("Office of the CFO");
  const anyBo = await prisma.roleAssignment.findFirst({ where: { roleType: RoleType.BUDGET_OFFICER } });
  const single: [string, string, RoleType, string | null][] = [
    ["Naisa S Reyes", "reyesns@ortigas.com.ph", RoleType.HR_ANALYST, hr?.id ?? null],
    ["Raymond M. Santos", "santosrm@ortigas.com.ph", RoleType.BCA_HEAD, bca?.id ?? anyBo?.departmentId ?? null],
    ["Davee M. Zuniga", "zunigadm@ortigas.com.ph", RoleType.CFO, cfoDept?.id ?? anyBo?.departmentId ?? null],
    ["Jose Emmanuel H. Jalandoni", "jalandonijeh@ortigas.com.ph", RoleType.CEO, cfoDept?.id ?? anyBo?.departmentId ?? null],
  ];
  for (const [name, email, roleType, departmentId] of single) {
    if (!departmentId) continue;
    const u = await resolve(name, email);
    deptRoles.push({ userId: u.id, departmentId, roleType });
  }

  const governed: RoleType[] = [
    RoleType.CENTRALIZED_BUDGET_PREPARER,
    RoleType.CENTRALIZED_FIRST_LEVEL_REVIEWER,
    RoleType.CENTRALIZED_DEPARTMENT_HEAD,
    RoleType.HR_ANALYST,
    RoleType.BCA_HEAD,
    RoleType.CFO,
    RoleType.CEO,
  ];
  await prisma.roleAssignment.deleteMany({ where: { roleType: { in: governed } } });
  await prisma.sbuRoleAssignment.deleteMany({ where: { roleType: { in: [RoleType.BU_FINANCE_OFFICER, RoleType.BU_FINANCE_HEAD] } } });
  await prisma.roleAssignment.createMany({ data: deptRoles, skipDuplicates: true });
  await prisma.sbuRoleAssignment.createMany({ data: sbuRoles, skipDuplicates: true });

  console.log(`Department-scoped role rows: ${deptRoles.length}; SBU Finance role rows: ${sbuRoles.length}`);
  if (missing.length) console.log(`Users created (no match in the app): ${missing.join("; ")}`);
  if (unmatchedDepts.size) console.log(`CD departments with no Department row (skipped): ${[...unmatchedDepts].join("; ")}`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
