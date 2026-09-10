-- CreateEnum
CREATE TYPE "RequestCategory" AS ENUM ('GAE', 'DOE', 'NPC', 'REVENUE');

-- CreateEnum
CREATE TYPE "Sbu" AS ENUM ('RESIDENTIAL', 'MALLS', 'OFFICES', 'ESTATES', 'LEISURE');

-- CreateEnum
CREATE TYPE "FollowOnRequestStage" AS ENUM ('REVIEWER_REVIEW', 'APPROVER_REVIEW', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "DueDateStage" AS ENUM ('FINALIZE_FORECAST', 'REQUEST_AND_AUTHORIZATION', 'CENTRALIZED_L1_REVIEW', 'CENTRALIZED_HEAD_REVIEW', 'BCA_AND_FINALIZATION');

-- CreateEnum
CREATE TYPE "ForecastSubmissionStage" AS ENUM ('DRAFT', 'HEAD_REVIEW', 'BUDGET_OFFICER_REVIEW', 'APPROVED', 'RETURNED');

-- AlterEnum
BEGIN;
CREATE TYPE "ManpowerSubmissionStage_new" AS ENUM ('HR_ANALYST_DRAFT', 'HR_HEAD_REVIEW', 'BUDGET_OFFICER_REVIEW', 'UPLOADED_TO_SAP');
ALTER TABLE "ManpowerBudgetSubmission" ALTER COLUMN "stage" DROP DEFAULT;
ALTER TABLE "ManpowerBudgetSubmission" ALTER COLUMN "stage" TYPE "ManpowerSubmissionStage_new" USING ("stage"::text::"ManpowerSubmissionStage_new");
ALTER TYPE "ManpowerSubmissionStage" RENAME TO "ManpowerSubmissionStage_old";
ALTER TYPE "ManpowerSubmissionStage_new" RENAME TO "ManpowerSubmissionStage";
DROP TYPE "ManpowerSubmissionStage_old";
ALTER TABLE "ManpowerBudgetSubmission" ALTER COLUMN "stage" SET DEFAULT 'HR_ANALYST_DRAFT';
COMMIT;

-- AlterEnum
ALTER TYPE "RoleType" ADD VALUE 'DEPARTMENT_PREPARER';

-- DropForeignKey
ALTER TABLE "HrPortalUploadBatch" DROP CONSTRAINT "HrPortalUploadBatch_uploadedById_fkey";

-- DropForeignKey
ALTER TABLE "ManpowerHeadcount" DROP CONSTRAINT "ManpowerHeadcount_companyId_fkey";

-- DropForeignKey
ALTER TABLE "ManpowerHeadcountAuditLog" DROP CONSTRAINT "ManpowerHeadcountAuditLog_companyId_fkey";

-- DropForeignKey
ALTER TABLE "VarianceThresholdConfig" DROP CONSTRAINT "VarianceThresholdConfig_departmentId_fkey";

-- DropForeignKey
ALTER TABLE "WorkflowStageConfig" DROP CONSTRAINT "WorkflowStageConfig_departmentId_fkey";

-- DropIndex
DROP INDEX "WorkflowStageConfig_stage_departmentId_key";

-- AlterTable
ALTER TABLE "AdditionalHeadcountRequest" ADD COLUMN     "code" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "BoardApprovedBudget" ADD COLUMN     "requestCategory" "RequestCategory" NOT NULL DEFAULT 'GAE',
ADD COLUMN     "sbu" "Sbu";

-- AlterTable
ALTER TABLE "BudgetRequest" DROP COLUMN "varianceJustification",
ADD COLUMN     "requestCategory" "RequestCategory" NOT NULL DEFAULT 'GAE',
ADD COLUMN     "sbu" "Sbu";

-- AlterTable
ALTER TABLE "ExpenseLineItem" ADD COLUMN     "description" TEXT,
ADD COLUMN     "sampleCharges" TEXT,
ADD COLUMN     "spendGridComputation" TEXT,
ADD COLUMN     "spendGridFrequency" TEXT,
ADD COLUMN     "visibleToDepartmentId" TEXT;

-- AlterTable
ALTER TABLE "ManpowerEntry" DROP COLUMN "meritIncreasePercent",
ADD COLUMN     "additionalHeadcountManual" DOUBLE PRECISION NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "employeeIdNumber" INTEGER,
ADD COLUMN     "passwordHash" TEXT;

-- AlterTable
ALTER TABLE "WorkflowStageConfig" DROP COLUMN "departmentId",
DROP COLUMN "stage",
ADD COLUMN     "stage" "DueDateStage" NOT NULL;

-- DropTable
DROP TABLE "HrPortalUploadBatch";

-- DropTable
DROP TABLE "ManpowerHeadcount";

-- DropTable
DROP TABLE "ManpowerHeadcountAuditLog";

-- DropTable
DROP TABLE "VarianceThresholdConfig";

-- DropEnum
DROP TYPE "VarianceScope";

-- DropEnum
DROP TYPE "VarianceThresholdType";

-- CreateTable
CREATE TABLE "Position" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,

    CONSTRAINT "Position_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MobilePhoneBudgetRequest" (
    "id" TEXT NOT NULL,
    "additionalHeadcountRequestId" TEXT NOT NULL,
    "stage" "FollowOnRequestStage" NOT NULL DEFAULT 'REVIEWER_REVIEW',
    "reviewerDecidedById" TEXT,
    "reviewerComment" TEXT,
    "reviewerDecidedAt" TIMESTAMP(3),
    "approverDecidedById" TEXT,
    "approverComment" TEXT,
    "approverDecidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MobilePhoneBudgetRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Office365AccountRequest" (
    "id" TEXT NOT NULL,
    "additionalHeadcountRequestId" TEXT NOT NULL,
    "stage" "FollowOnRequestStage" NOT NULL DEFAULT 'REVIEWER_REVIEW',
    "reviewerDecidedById" TEXT,
    "reviewerComment" TEXT,
    "reviewerDecidedAt" TIMESTAMP(3),
    "approverDecidedById" TEXT,
    "approverComment" TEXT,
    "approverDecidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Office365AccountRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ManpowerMeritRateConfig" (
    "id" TEXT NOT NULL,
    "fiscalYear" INTEGER NOT NULL,
    "ratePercent" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "updatedBy" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ManpowerMeritRateConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ManpowerSalaryLevel" (
    "id" TEXT NOT NULL,
    "level" INTEGER NOT NULL,
    "avgSalary" DOUBLE PRECISION NOT NULL,
    "sssER" DOUBLE PRECISION NOT NULL,
    "pagibigER" DOUBLE PRECISION NOT NULL,
    "philhealthER" DOUBLE PRECISION NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ManpowerSalaryLevel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ManpowerRosterSummary" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "fiscalYear" INTEGER NOT NULL,
    "headcount" INTEGER NOT NULL DEFAULT 0,
    "basicPayMonthly" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "sssMonthly" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "pagibigMonthly" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "philhealthMonthly" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "sourceFileRef" TEXT NOT NULL,
    "uploadedById" TEXT NOT NULL,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ManpowerRosterSummary_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ManpowerHeadcountByRank" (
    "id" TEXT NOT NULL,
    "level" INTEGER NOT NULL,
    "companyId" TEXT NOT NULL,
    "fiscalYear" INTEGER NOT NULL,
    "headcount" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ManpowerHeadcountByRank_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ManpowerHeadcountAdjustment" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "fiscalYear" INTEGER NOT NULL,
    "adjustment" INTEGER NOT NULL DEFAULT 0,
    "updatedBy" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ManpowerHeadcountAdjustment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ManpowerTemplateUploadBatch" (
    "id" TEXT NOT NULL,
    "uploadedById" TEXT NOT NULL,
    "fiscalYear" INTEGER NOT NULL,
    "sourceFileRef" TEXT NOT NULL,
    "rowCount" INTEGER NOT NULL,
    "validationErrors" JSONB NOT NULL DEFAULT '[]',
    "status" "BulkUploadStatus" NOT NULL DEFAULT 'PROCESSING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ManpowerTemplateUploadBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ForecastSubmission" (
    "id" TEXT NOT NULL,
    "departmentId" TEXT NOT NULL,
    "fiscalYear" INTEGER NOT NULL,
    "stage" "ForecastSubmissionStage" NOT NULL DEFAULT 'DRAFT',
    "submittedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ForecastSubmission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ForecastReviewDecision" (
    "id" TEXT NOT NULL,
    "forecastSubmissionId" TEXT NOT NULL,
    "stage" "ForecastSubmissionStage" NOT NULL,
    "decision" "ReviewDecisionType" NOT NULL,
    "decidedById" TEXT NOT NULL,
    "comment" TEXT,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ForecastReviewDecision_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Position_title_key" ON "Position"("title");

-- CreateIndex
CREATE UNIQUE INDEX "MobilePhoneBudgetRequest_additionalHeadcountRequestId_key" ON "MobilePhoneBudgetRequest"("additionalHeadcountRequestId");

-- CreateIndex
CREATE UNIQUE INDEX "Office365AccountRequest_additionalHeadcountRequestId_key" ON "Office365AccountRequest"("additionalHeadcountRequestId");

-- CreateIndex
CREATE UNIQUE INDEX "ManpowerMeritRateConfig_fiscalYear_key" ON "ManpowerMeritRateConfig"("fiscalYear");

-- CreateIndex
CREATE UNIQUE INDEX "ManpowerSalaryLevel_level_key" ON "ManpowerSalaryLevel"("level");

-- CreateIndex
CREATE UNIQUE INDEX "ManpowerRosterSummary_companyId_fiscalYear_key" ON "ManpowerRosterSummary"("companyId", "fiscalYear");

-- CreateIndex
CREATE UNIQUE INDEX "ManpowerHeadcountByRank_level_companyId_fiscalYear_key" ON "ManpowerHeadcountByRank"("level", "companyId", "fiscalYear");

-- CreateIndex
CREATE UNIQUE INDEX "ManpowerHeadcountAdjustment_companyId_fiscalYear_key" ON "ManpowerHeadcountAdjustment"("companyId", "fiscalYear");

-- CreateIndex
CREATE UNIQUE INDEX "ForecastSubmission_departmentId_fiscalYear_key" ON "ForecastSubmission"("departmentId", "fiscalYear");

-- CreateIndex
CREATE UNIQUE INDEX "AdditionalHeadcountRequest_code_key" ON "AdditionalHeadcountRequest"("code");

-- CreateIndex
CREATE UNIQUE INDEX "User_employeeIdNumber_key" ON "User"("employeeIdNumber");

-- CreateIndex
CREATE UNIQUE INDEX "WorkflowStageConfig_stage_key" ON "WorkflowStageConfig"("stage");

-- AddForeignKey
ALTER TABLE "ExpenseLineItem" ADD CONSTRAINT "ExpenseLineItem_visibleToDepartmentId_fkey" FOREIGN KEY ("visibleToDepartmentId") REFERENCES "Department"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MobilePhoneBudgetRequest" ADD CONSTRAINT "MobilePhoneBudgetRequest_additionalHeadcountRequestId_fkey" FOREIGN KEY ("additionalHeadcountRequestId") REFERENCES "AdditionalHeadcountRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MobilePhoneBudgetRequest" ADD CONSTRAINT "MobilePhoneBudgetRequest_reviewerDecidedById_fkey" FOREIGN KEY ("reviewerDecidedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MobilePhoneBudgetRequest" ADD CONSTRAINT "MobilePhoneBudgetRequest_approverDecidedById_fkey" FOREIGN KEY ("approverDecidedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Office365AccountRequest" ADD CONSTRAINT "Office365AccountRequest_additionalHeadcountRequestId_fkey" FOREIGN KEY ("additionalHeadcountRequestId") REFERENCES "AdditionalHeadcountRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Office365AccountRequest" ADD CONSTRAINT "Office365AccountRequest_reviewerDecidedById_fkey" FOREIGN KEY ("reviewerDecidedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Office365AccountRequest" ADD CONSTRAINT "Office365AccountRequest_approverDecidedById_fkey" FOREIGN KEY ("approverDecidedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ManpowerRosterSummary" ADD CONSTRAINT "ManpowerRosterSummary_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ManpowerRosterSummary" ADD CONSTRAINT "ManpowerRosterSummary_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ManpowerHeadcountByRank" ADD CONSTRAINT "ManpowerHeadcountByRank_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ManpowerHeadcountAdjustment" ADD CONSTRAINT "ManpowerHeadcountAdjustment_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ManpowerTemplateUploadBatch" ADD CONSTRAINT "ManpowerTemplateUploadBatch_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ForecastSubmission" ADD CONSTRAINT "ForecastSubmission_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ForecastReviewDecision" ADD CONSTRAINT "ForecastReviewDecision_forecastSubmissionId_fkey" FOREIGN KEY ("forecastSubmissionId") REFERENCES "ForecastSubmission"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ForecastReviewDecision" ADD CONSTRAINT "ForecastReviewDecision_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

