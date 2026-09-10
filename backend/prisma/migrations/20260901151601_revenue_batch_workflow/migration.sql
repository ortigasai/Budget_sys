-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "RequestStage" ADD VALUE 'REVENUE_BU_FINANCE_OFFICER_REVIEW';
ALTER TYPE "RequestStage" ADD VALUE 'REVENUE_BU_FINANCE_HEAD_REVIEW';
ALTER TYPE "RequestStage" ADD VALUE 'REVENUE_BUDGET_OFFICER_REVIEW';
ALTER TYPE "RequestStage" ADD VALUE 'REVENUE_BCA_HEAD_REVIEW';

-- AlterTable
ALTER TABLE "BulkUploadBatch" ADD COLUMN     "boardApprovedAmountAtUpload" DOUBLE PRECISION,
ADD COLUMN     "companyId" TEXT,
ADD COLUMN     "sbu" "Sbu";

-- AddForeignKey
ALTER TABLE "BulkUploadBatch" ADD CONSTRAINT "BulkUploadBatch_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;
