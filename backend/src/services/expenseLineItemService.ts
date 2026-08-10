import { prisma } from "../prisma";
import { buildExpenseLineItemId, parseExpenseLineItemsBuffer } from "../lib/expenseLineItemCatalog";

export interface ExpenseLineItemUploadResult {
  ok: boolean;
  created: number;
  updated: number;
  removed: number;
  skippedRemovals: { name: string; reason: string }[];
  errors: string[];
}

// Admin Console "Upload Template" button (override mode): every row in the
// file is upserted by the same category+name+company id the seed importer
// uses, then any existing STANDARD item *not* present in the file is
// deleted — the file becomes the new source of truth for the catalog. Items
// still referenced by an existing BudgetRequest are kept (deleting them
// would violate that request's foreign key) and reported back instead.
export async function overrideExpenseLineItemsFromUpload(
  buffer: Buffer,
  managedBy: string
): Promise<ExpenseLineItemUploadResult> {
  const rows = await parseExpenseLineItemsBuffer(buffer);
  if (rows.length === 0) {
    return { ok: false, created: 0, updated: 0, removed: 0, skippedRemovals: [], errors: ["No valid rows found in the uploaded file."] };
  }

  const companies = await prisma.company.findMany();
  const companyByCode = new Map(companies.map((c) => [c.code, c]));
  const errors: string[] = [];
  rows.forEach((row, i) => {
    if (row.companyCode && !companyByCode.has(row.companyCode)) {
      errors.push(`Row ${i + 1} ("${row.name}"): unknown company code "${row.companyCode}".`);
    }
  });
  if (errors.length > 0) {
    return { ok: false, created: 0, updated: 0, removed: 0, skippedRemovals: [], errors };
  }

  const result = await prisma.$transaction(
    async (tx) => {
      const departmentCache = new Map<string, string>();
      const keepIds = new Set<string>();
      let created = 0;
      let updated = 0;

      for (const row of rows) {
        let departmentId = departmentCache.get(row.departmentName);
        if (!departmentId) {
          const dept = await tx.department.upsert({
            where: { name: row.departmentName },
            update: {},
            create: { name: row.departmentName, type: "CENTRALIZED" },
          });
          departmentId = dept.id;
          departmentCache.set(row.departmentName, departmentId);
        }

        const companyId = row.companyCode ? companyByCode.get(row.companyCode)!.id : undefined;
        const id = buildExpenseLineItemId(row.category, row.name, row.companyCode);
        keepIds.add(id);

        const existing = await tx.expenseLineItem.findUnique({ where: { id } });
        await tx.expenseLineItem.upsert({
          where: { id },
          update: {
            category: row.category,
            glAccount: row.glAccount,
            costCenter: row.costCenter,
            ownerDepartmentId: departmentId,
            companyId,
            extraFieldsConfig: row.extraFieldsConfig as any,
            requiresMobilePolicy: row.requiresMobilePolicy,
          },
          create: {
            id,
            name: row.name,
            category: row.category,
            glAccount: row.glAccount,
            costCenter: row.costCenter,
            ownerDepartmentId: departmentId,
            companyId,
            extraFieldsConfig: row.extraFieldsConfig as any,
            requiresMobilePolicy: row.requiresMobilePolicy,
            managedBy,
          },
        });
        if (existing) updated++;
        else created++;
      }

      const existingStandard = await tx.expenseLineItem.findMany({ where: { status: "STANDARD" } });
      const toRemove = existingStandard.filter((item) => !keepIds.has(item.id));
      let removed = 0;
      const skippedRemovals: { name: string; reason: string }[] = [];
      for (const item of toRemove) {
        const requestCount = await tx.budgetRequest.count({ where: { expenseLineItemId: item.id } });
        if (requestCount > 0) {
          skippedRemovals.push({ name: item.name, reason: `kept — ${requestCount} existing request(s) reference it` });
          continue;
        }
        await tx.expenseLineItem.delete({ where: { id: item.id } });
        removed++;
      }

      return { created, updated, removed, skippedRemovals };
    },
    { maxWait: 15000, timeout: 30000 }
  );

  return { ok: true, ...result, errors: [] };
}
