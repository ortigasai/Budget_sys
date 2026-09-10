import ExcelJS from "exceljs";
import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";

// Shared employee-roster import logic - used by both the seed-time importer
// (backend/prisma/importEmployees.ts, reading the source file from disk)
// and the Admin Console's "Upload Employee List" button
// (backend/src/routes/admin.ts, reading an uploaded buffer). Lives under
// backend/src so both can import it without crossing the app's tsconfig
// rootDir boundary.

// Notes_6: "For the purpose of testing, password for all users will be
// Ortigas12345." One shared bcrypt hash, computed once and reused for every
// imported employee (and every seed.ts demo/role user).
export const TEST_PASSWORD = "Ortigas12345";
let cachedTestPasswordHash: string | null = null;
export async function testPasswordHash(): Promise<string> {
  if (!cachedTestPasswordHash) cachedTestPasswordHash = await bcrypt.hash(TEST_PASSWORD, 10);
  return cachedTestPasswordHash;
}

export interface ParsedEmployee {
  idNumber: number;
  name: string;
  emailLocalPart: string;
  position: string | null;
  // Notes_7: "Department field ... should follow the Department column
  // (column J)." The real roster's department names are a much larger, more
  // granular set than this app's curated centralized/requesting
  // departments - rather than force-fitting them, unmatched names are
  // upserted as new Department rows (same "create what the source data
  // says" precedent as importExpenseLineItems.ts).
  departmentName: string | null;
}

function slugifyEmailPart(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // strip accents (combining diacritical marks)
    .toLowerCase()
    .replace(/[^a-z]/g, "");
}

// Notes_7: the seed-time source file names its one sheet "Sheet1", but the
// real "Budgeting System_Employee List" file (uploaded via the Admin
// Console) names it "Employee List" and has a second "Role" sheet after it -
// so match by name first, falling back to the first sheet either way.
function parseWorkbook(workbook: ExcelJS.Workbook): ParsedEmployee[] {
  const sheet = workbook.getWorksheet("Sheet1") ?? workbook.getWorksheet("Employee List") ?? workbook.worksheets[0];
  if (!sheet) throw new Error("No worksheet found in workbook");

  const employees: ParsedEmployee[] = [];
  const usedEmails = new Set<string>();

  for (let r = 2; r <= sheet.rowCount; r++) {
    const row = sheet.getRow(r);
    const idNumber = Number(row.getCell(1).value);
    const firstName = String(row.getCell(3).value ?? "").trim();
    const middleInitial = String(row.getCell(4).value ?? "").trim();
    const lastName = String(row.getCell(5).value ?? "").trim();
    if (!idNumber || !firstName || !lastName) continue;

    const name = middleInitial ? `${firstName} ${middleInitial} ${lastName}` : `${firstName} ${lastName}`;
    const position = String(row.getCell(9).value ?? "").trim() || null;
    const departmentName = String(row.getCell(10).value ?? "").trim() || null;

    let emailLocalPart = `${slugifyEmailPart(firstName)}.${slugifyEmailPart(lastName)}`;
    let suffix = 2;
    while (usedEmails.has(emailLocalPart)) {
      emailLocalPart = `${slugifyEmailPart(firstName)}.${slugifyEmailPart(lastName)}${suffix}`;
      suffix++;
    }
    usedEmails.add(emailLocalPart);

    employees.push({ idNumber, name, emailLocalPart, position, departmentName });
  }

  return employees;
}

export async function parseEmployeesFile(filePath: string): Promise<ParsedEmployee[]> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);
  return parseWorkbook(workbook);
}

// Admin Console "Upload Employee List" button.
export async function parseEmployeesBuffer(buffer: Buffer): Promise<ParsedEmployee[]> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
  return parseWorkbook(workbook);
}

export interface EmployeeImportResult {
  imported: number;
  positions: number;
  departments: number;
  roleAssignmentsUpdated: number;
}

// Upserts Department (get-or-create by name from column J), User (matched
// by employeeIdNumber, so re-running with an updated roster export keeps
// existing users' emails/logins stable and just refreshes name/department),
// and Position (distinct column I values).
export async function applyEmployeeImport(prisma: PrismaClient, employees: ParsedEmployee[]): Promise<EmployeeImportResult> {
  const passwordHash = await testPasswordHash();
  const departmentCache = new Map<string, string>();

  let imported = 0;
  let roleAssignmentsUpdated = 0;
  for (const emp of employees) {
    let departmentId: string | undefined;
    if (emp.departmentName) {
      departmentId = departmentCache.get(emp.departmentName);
      if (!departmentId) {
        const dept = await prisma.department.upsert({
          where: { name: emp.departmentName },
          update: {},
          create: { name: emp.departmentName, type: "CENTRALIZED" },
        });
        departmentId = dept.id;
        departmentCache.set(emp.departmentName, departmentId);
      }
    }

    const user = await prisma.user.upsert({
      where: { employeeIdNumber: emp.idNumber },
      update: { name: emp.name, passwordHash, ...(departmentId ? { departmentId } : {}) },
      create: {
        name: emp.name,
        email: `${emp.emailLocalPart}@ortigas.com.ph`,
        employeeIdNumber: emp.idNumber,
        passwordHash,
        departmentId,
      },
    });
    imported++;

    // Notes_8: "this should also update the Department of those with Role
    // Assignment." RoleAssignmentsTab.tsx sets RoleAssignment.departmentId
    // from the user's home department at assignment time - it doesn't
    // re-derive it live from User.departmentId - so any of this user's
    // existing assignments still pointing at a different department (either
    // because the roster changed just now, or was already stale from before
    // this reconciliation existed) need to be brought in line too. Compares
    // directly against the roster's department rather than the User row's
    // previous value, so it also repairs pre-existing drift, not just new
    // changes from this run.
    if (departmentId) {
      try {
        const result = await prisma.roleAssignment.updateMany({
          where: { userId: user.id, departmentId: { not: departmentId } },
          data: { departmentId },
        });
        roleAssignmentsUpdated += result.count;
      } catch (err) {
        // Unique constraint [departmentId, roleType, userId] could in theory
        // collide if the user already held that exact role for the new
        // department - extremely unlikely, but don't let it abort the rest
        // of the import.
        console.error(`Failed to update role assignments for user ${user.id} (${emp.name}):`, err);
      }
    }
  }

  const positions = [...new Set(employees.map((e) => e.position).filter((p): p is string => Boolean(p)))];
  for (const title of positions) {
    await prisma.position.upsert({ where: { title }, update: {}, create: { title } });
  }

  return { imported, positions: positions.length, departments: departmentCache.size, roleAssignmentsUpdated };
}
