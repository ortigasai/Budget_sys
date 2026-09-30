import { BudgetCodePrefixKind } from "@prisma/client";
import { prisma } from "../prisma";
import { buildExpenseLineItemId, parseExpenseLineItemsBuffer } from "../lib/expenseLineItemCatalog";
import { formatBudgetCode, getBudgetCodePrefixCode, nextBudgetCode } from "../lib/budgetCode";
import { getFiscalCycle } from "../lib/fiscalCycle";

// Same fuzzy name-matching convention prisma/importCentralizedReviewers.ts
// uses for columns J/K, folded into the main catalog upload so a future
// re-upload keeps Centralized Dept Requestor/Reviewer and Centralized Dept
// Head in sync too, instead of needing that separate script forever.
const nameTokens = (n: string) =>
  n
    .toLowerCase()
    .replace(/[^a-zñ ]/g, " ")
    .split(/\s+/)
    .filter((t) => t && !["jr", "sr", "ii", "iii"].includes(t));

export interface ExpenseLineItemUploadResult {
  ok: boolean;
  created: number;
  updated: number;
  removed: number;
  migratedRequests: { name: string; reason: string }[];
  skippedRemovals: { name: string; reason: string }[];
  errors: string[];
}

// Admin Console "Upload Template" button (override mode): every row in the
// file is upserted by the same category+name+company id the seed importer
// uses, then any existing STANDARD item *not* present in the file is
// deleted — the file becomes the new source of truth for the catalog. Items
// still referenced by an existing BudgetRequest can't just be deleted
// (foreign key), but a request shouldn't be stuck pointing at a stale,
// unmaintained row just because the row's *category* changed and its id
// (built from category+name+company) changed with it. If a row this update
// would otherwise remove matches the same name+company among the rows just
// upserted, existing requests are moved onto that row and the stale one is
// deleted; only a genuinely-removed name+company (no match at all) falls
// back to being kept in place and reported.
export async function overrideExpenseLineItemsFromUpload(
  buffer: Buffer,
  managedBy: string
): Promise<ExpenseLineItemUploadResult> {
  const rows = await parseExpenseLineItemsBuffer(buffer);
  if (rows.length === 0) {
    return {
      ok: false,
      created: 0,
      updated: 0,
      removed: 0,
      migratedRequests: [],
      skippedRemovals: [],
      errors: ["No valid rows found in the uploaded file."],
    };
  }

  const companies = await prisma.company.findMany();
  const companyByCode = new Map(companies.map((c) => [c.code, c]));
  // Not restricted to employeeIdNumber != null - some CD-tab-only people
  // have no official employee-list record (see importCentralizedReviewers.ts).
  const allUsers = await prisma.user.findMany();
  const findUserByName = (name: string) => {
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
  // A cell can list more than one co-head, comma-separated - takes the
  // first name that resolves to a real employee.
  const firstMatchingUserId = (cellValue: string | null): string | undefined => {
    if (!cellValue) return undefined;
    for (const candidate of cellValue.split(",").map((s) => s.trim()).filter(Boolean)) {
      const user = findUserByName(candidate);
      if (user) return user.id;
    }
    return undefined;
  };
  const errors: string[] = [];
  rows.forEach((row, i) => {
    if (row.companyCode && !companyByCode.has(row.companyCode)) {
      errors.push(`Row ${i + 1} ("${row.name}"): unknown company code "${row.companyCode}".`);
    }
  });
  if (errors.length > 0) {
    return { ok: false, created: 0, updated: 0, removed: 0, migratedRequests: [], skippedRemovals: [], errors };
  }

  // Resolved ahead of the transaction below - CD-prefix lookups and Budget
  // Code sequence numbers aren't part of the catalog-row transactional
  // consistency this override needs, so there's no reason to route them
  // through `tx` (see importExpenseLineItems.ts for the same fallback logic).
  const { targetCalendarYear } = await getFiscalCycle();
  const cdPrefixCache = new Map<string, string | null>();
  const resolveBudgetCode = async (row: (typeof rows)[number]) => {
    if (row.budgetCodePrefix && row.budgetCodeNum != null) {
      return formatBudgetCode(row.budgetCodePrefix, targetCalendarYear, row.budgetCodeNum);
    }
    if (!cdPrefixCache.has(row.departmentName)) {
      cdPrefixCache.set(
        row.departmentName,
        await getBudgetCodePrefixCode(BudgetCodePrefixKind.CENTRALIZED_DEPARTMENT, row.departmentName)
      );
    }
    const prefixCode = cdPrefixCache.get(row.departmentName);
    return prefixCode ? await nextBudgetCode(prefixCode, targetCalendarYear) : null;
  };

  const result = await prisma.$transaction(
    async (tx) => {
      const departmentCache = new Map<string, string>();
      const keepIds = new Set<string>();
      let created = 0;
      let updated = 0;

      const resolveDepartmentId = async (name: string) => {
        let id = departmentCache.get(name);
        if (!id) {
          const dept = await tx.department.upsert({
            where: { name },
            update: {},
            create: { name, type: "CENTRALIZED" },
          });
          id = dept.id;
          departmentCache.set(name, id);
        }
        return id;
      };

      for (const row of rows) {
        const departmentId = await resolveDepartmentId(row.departmentName);
        const visibleToDepartmentId = row.visibleToDepartmentName
          ? await resolveDepartmentId(row.visibleToDepartmentName)
          : null;

        const companyId = row.companyCode ? companyByCode.get(row.companyCode)!.id : undefined;
        const id = buildExpenseLineItemId(row.category, row.name, row.companyCode);
        keepIds.add(id);

        const budgetCode = await resolveBudgetCode(row);
        const centralizedReviewerId = firstMatchingUserId(row.centralizedReviewerName);
        const centralizedHeadId = firstMatchingUserId(row.centralizedHeadName);
        const existing = await tx.expenseLineItem.findUnique({ where: { id } });
        await tx.expenseLineItem.upsert({
          where: { id },
          update: {
            category: row.category,
            description: row.description,
            glAccount: row.glAccount,
            costCenter: row.costCenter,
            ownerDepartmentId: departmentId,
            companyId,
            extraFieldsConfig: row.extraFieldsConfig as any,
            requiresMobilePolicy: row.requiresMobilePolicy,
            spendGridComputation: row.spendGridComputation,
            spendGridFrequency: row.spendGridFrequency,
            sampleCharges: row.sampleCharges,
            visibleToDepartmentId,
            budgetCode: budgetCode ?? undefined,
            // undefined (not null) when the cell is blank/unmatched - leaves
            // whatever's already set untouched rather than clobbering it.
            centralizedReviewerId,
            centralizedHeadId,
          },
          create: {
            id,
            name: row.name,
            category: row.category,
            description: row.description,
            glAccount: row.glAccount,
            costCenter: row.costCenter,
            ownerDepartmentId: departmentId,
            companyId,
            extraFieldsConfig: row.extraFieldsConfig as any,
            requiresMobilePolicy: row.requiresMobilePolicy,
            spendGridComputation: row.spendGridComputation,
            spendGridFrequency: row.spendGridFrequency,
            sampleCharges: row.sampleCharges,
            visibleToDepartmentId,
            managedBy,
            budgetCode,
            centralizedReviewerId,
            centralizedHeadId,
          },
        });
        if (existing) updated++;
        else created++;
      }

      const existingStandard = await tx.expenseLineItem.findMany({ where: { status: "STANDARD" } });
      const toRemove = existingStandard.filter((item) => !keepIds.has(item.id));
      let removed = 0;
      const migratedRequests: { name: string; reason: string }[] = [];
      const skippedRemovals: { name: string; reason: string }[] = [];
      for (const item of toRemove) {
        const requestCount = await tx.budgetRequest.count({ where: { expenseLineItemId: item.id } });
        if (requestCount > 0) {
          // The row itself is gone from the file, but the same name+company
          // may have resurfaced under a different category (and therefore a
          // different id) among the rows just upserted — e.g. "Accident
          // Insurance" moving from its own category into "Manpower". Follow
          // existing requests onto that row instead of stranding them on an
          // unmaintained duplicate.
          const replacement = await tx.expenseLineItem.findFirst({
            where: { id: { in: [...keepIds] }, name: item.name, companyId: item.companyId },
          });
          if (replacement) {
            await tx.budgetRequest.updateMany({
              where: { expenseLineItemId: item.id },
              data: { expenseLineItemId: replacement.id },
            });
            await tx.expenseLineItem.delete({ where: { id: item.id } });
            migratedRequests.push({
              name: item.name,
              reason: `${requestCount} existing request(s) moved to the updated "${replacement.category}" row`,
            });
            continue;
          }
          skippedRemovals.push({ name: item.name, reason: `kept — ${requestCount} existing request(s) reference it` });
          continue;
        }
        await tx.expenseLineItem.delete({ where: { id: item.id } });
        removed++;
      }

      return { created, updated, removed, migratedRequests, skippedRemovals };
    },
    { maxWait: 15000, timeout: 30000 }
  );

  return { ok: true, ...result, errors: [] };
}
