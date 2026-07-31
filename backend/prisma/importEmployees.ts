import path from "node:path";
import ExcelJS from "exceljs";
import { PrismaClient } from "@prisma/client";

// Re-runnable importer for the real "Budgeting System_Employee List" (363
// rows) — this is the pool the Budget Officer assigns roles from (Role
// Assignments tab), per Notes_2 item 4.

const SOURCE_FILE = path.resolve(__dirname, "data/employee-list.xlsx");

interface ParsedEmployee {
  idNumber: number;
  name: string;
  emailLocalPart: string;
}

function slugifyEmailPart(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // strip accents (combining diacritical marks)
    .toLowerCase()
    .replace(/[^a-z]/g, "");
}

export async function parseEmployeesFile(filePath: string = SOURCE_FILE): Promise<ParsedEmployee[]> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);
  const sheet = workbook.getWorksheet("Sheet1");
  if (!sheet) throw new Error(`Sheet1 not found in ${filePath}`);

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

    let emailLocalPart = `${slugifyEmailPart(firstName)}.${slugifyEmailPart(lastName)}`;
    let suffix = 2;
    while (usedEmails.has(emailLocalPart)) {
      emailLocalPart = `${slugifyEmailPart(firstName)}.${slugifyEmailPart(lastName)}${suffix}`;
      suffix++;
    }
    usedEmails.add(emailLocalPart);

    employees.push({ idNumber, name, emailLocalPart });
  }

  return employees;
}

export async function importEmployees(prisma: PrismaClient) {
  const employees = await parseEmployeesFile();

  let imported = 0;
  for (const emp of employees) {
    await prisma.user.upsert({
      where: { employeeIdNumber: emp.idNumber },
      update: { name: emp.name },
      create: {
        name: emp.name,
        email: `${emp.emailLocalPart}@ortigas.com.ph`,
        employeeIdNumber: emp.idNumber,
      },
    });
    imported++;
  }

  console.log(`Imported ${imported} employees.`);
  return { imported };
}
