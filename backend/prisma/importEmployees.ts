import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { applyEmployeeImport, parseEmployeesFile as parseEmployeesFileShared, testPasswordHash } from "../src/lib/employeeImport";

// Re-runnable importer for the real "Budgeting System_Employee List" (363
// rows) — this is the pool the Budget Officer assigns roles from (Role
// Assignments tab), per Notes_2 item 4. Parsing/upsert logic lives in
// src/lib/employeeImport.ts, shared with the Admin Console's "Upload
// Employee List" button (src/routes/admin.ts).

const SOURCE_FILE = path.resolve(__dirname, "data/employee-list.xlsx");

export { testPasswordHash };

export function parseEmployeesFile(filePath: string = SOURCE_FILE) {
  return parseEmployeesFileShared(filePath);
}

export async function importEmployees(prisma: PrismaClient) {
  const employees = await parseEmployeesFile();
  const result = await applyEmployeeImport(prisma, employees);
  console.log(`Imported ${result.imported} employees, ${result.positions} distinct positions, ${result.departments} departments.`);
  return result;
}
