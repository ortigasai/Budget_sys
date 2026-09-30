// One-time backfill for the DOE Upload Template revision (doeBatches.ts).
//
// Every DOE BudgetRequest created before this change (the old manual form,
// or the old one-shot /bulk-upload import) has bulkUploadBatchId: null -
// the new "My Requests"/DoeUploadTab UI expects every DOE request to trace
// back to a batch. This creates ONE synthetic BulkUploadBatch per existing
// row (deliberately not grouped - rows already sit at different real
// review stages, and a batch's detail view assumes every row in it shares
// one stage) and backfills that row's bulkUploadBatchId.
//
// Data-only, not a schema migration (BulkUploadBatch/bulkUploadBatchId
// already exist) - run once by hand during rollout:
//   npx tsx scripts/migrate-doe-batches.ts
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const orphanRows = await prisma.budgetRequest.findMany({
    where: { requestCategory: "DOE", bulkUploadBatchId: null },
    include: { department: true },
  });

  if (orphanRows.length === 0) {
    console.log("No un-batched DOE requests found - nothing to migrate.");
    return;
  }

  console.log(`Migrating ${orphanRows.length} DOE request(s) into one synthetic batch each...`);
  const byDepartment = new Map<string, number>();

  for (const row of orphanRows) {
    const batch = await prisma.bulkUploadBatch.create({
      data: {
        uploadedById: row.createdById,
        departmentId: row.departmentId,
        fiscalYear: row.fiscalYear,
        sourceFileRef: "(migrated - originally a manual request)",
        rowCount: 1,
        status: "COMPLETED",
        sbu: row.sbu,
        companyId: null,
      },
    });
    await prisma.budgetRequest.update({
      where: { id: row.id },
      data: { bulkUploadBatchId: batch.id },
    });
    byDepartment.set(row.department.name, (byDepartment.get(row.department.name) ?? 0) + 1);
  }

  console.log("Done. Rows migrated by department:");
  for (const [name, count] of byDepartment) {
    console.log(`  ${name}: ${count}`);
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
