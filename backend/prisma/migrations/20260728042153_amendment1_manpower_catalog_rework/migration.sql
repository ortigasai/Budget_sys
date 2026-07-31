/*
  Warnings:

  - You are about to drop the column `remainingForecast2026` on the `HistoricalActuals` table. All the data in the column will be lost.

*/
-- CreateEnum
CREATE TYPE "HeadcountRequestStage" AS ENUM ('DEPT_HEAD_REVIEW', 'HR_ANALYST_REVIEW', 'HR_HEAD_REVIEW', 'APPROVED', 'RETURNED');

-- CreateEnum
CREATE TYPE "ManpowerForecastSource" AS ENUM ('HR_PORTAL', 'MANUAL');

-- CreateEnum
CREATE TYPE "ManpowerSubmissionStage" AS ENUM ('HR_ANALYST_DRAFT', 'HR_HEAD_REVIEW', 'BUDGET_OFFICER_REVIEW', 'APPROVED', 'UPLOADED_TO_SAP');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "RequestStage" ADD VALUE 'CFO_APPROVAL';
ALTER TYPE "RequestStage" ADD VALUE 'CANCELLED';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "RoleType" ADD VALUE 'HR_ANALYST';
ALTER TYPE "RoleType" ADD VALUE 'CFO';

-- AlterTable
ALTER TABLE "BudgetRequest" ADD COLUMN     "requiresCfoApproval" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "ExpenseLineItem" ADD COLUMN     "category" TEXT NOT NULL DEFAULT 'Uncategorized',
ADD COLUMN     "companyId" TEXT,
ADD COLUMN     "requiresMobilePolicy" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "HistoricalActuals" DROP COLUMN "remainingForecast2026",
ADD COLUMN     "monthlyRemainingForecast2026" JSONB NOT NULL DEFAULT '{}';

-- CreateTable
CREATE TABLE "Company" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "Company_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FiscalCycleConfig" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "asOfMonth2026" INTEGER NOT NULL DEFAULT 9,
    "updatedBy" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FiscalCycleConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MobilePhonePolicyTier" (
    "id" TEXT NOT NULL,
    "minRank" INTEGER NOT NULL,
    "maxRank" INTEGER NOT NULL,
    "budgetLimit" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "MobilePhonePolicyTier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdditionalHeadcountRequest" (
    "id" TEXT NOT NULL,
    "position" TEXT NOT NULL,
    "rank" INTEGER NOT NULL,
    "companyId" TEXT NOT NULL,
    "departmentId" TEXT NOT NULL,
    "estimatedHireDate" TIMESTAMP(3) NOT NULL,
    "justification" TEXT NOT NULL,
    "currentStage" "HeadcountRequestStage" NOT NULL DEFAULT 'DEPT_HEAD_REVIEW',
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AdditionalHeadcountRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HeadcountReviewDecision" (
    "id" TEXT NOT NULL,
    "additionalHeadcountRequestId" TEXT NOT NULL,
    "stage" "HeadcountRequestStage" NOT NULL,
    "decision" "ReviewDecisionType" NOT NULL,
    "decidedById" TEXT NOT NULL,
    "comment" TEXT,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HeadcountReviewDecision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayComponent" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isHeadcountDriven" BOOLEAN NOT NULL DEFAULT false,
    "appliesMeritIncrease" BOOLEAN NOT NULL DEFAULT false,
    "forecastSource" "ManpowerForecastSource" NOT NULL DEFAULT 'MANUAL',

    CONSTRAINT "PayComponent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ManpowerEntry" (
    "id" TEXT NOT NULL,
    "payComponentId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "fiscalYear" INTEGER NOT NULL,
    "ytdActual" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "remainingForecast" JSONB NOT NULL DEFAULT '{}',
    "meritIncreasePercent" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "otherIncrease" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ManpowerEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ManpowerHeadcount" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "fiscalYear" INTEGER NOT NULL,
    "value" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ManpowerHeadcount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ManpowerHeadcountAuditLog" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "oldValue" INTEGER,
    "newValue" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ManpowerHeadcountAuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HrPortalUploadBatch" (
    "id" TEXT NOT NULL,
    "uploadedById" TEXT NOT NULL,
    "fiscalYear" INTEGER NOT NULL,
    "sourceFileRef" TEXT NOT NULL,
    "rowCount" INTEGER NOT NULL,
    "validationErrors" JSONB NOT NULL DEFAULT '[]',
    "status" "BulkUploadStatus" NOT NULL DEFAULT 'PROCESSING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HrPortalUploadBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ManpowerBudgetSubmission" (
    "id" TEXT NOT NULL,
    "fiscalYear" INTEGER NOT NULL,
    "stage" "ManpowerSubmissionStage" NOT NULL DEFAULT 'HR_ANALYST_DRAFT',
    "sapDocumentNumber" TEXT,
    "submittedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ManpowerBudgetSubmission_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Company_code_key" ON "Company"("code");

-- CreateIndex
CREATE UNIQUE INDEX "PayComponent_name_key" ON "PayComponent"("name");

-- CreateIndex
CREATE UNIQUE INDEX "ManpowerEntry_payComponentId_companyId_fiscalYear_key" ON "ManpowerEntry"("payComponentId", "companyId", "fiscalYear");

-- CreateIndex
CREATE UNIQUE INDEX "ManpowerHeadcount_companyId_fiscalYear_key" ON "ManpowerHeadcount"("companyId", "fiscalYear");

-- CreateIndex
CREATE UNIQUE INDEX "ManpowerBudgetSubmission_fiscalYear_key" ON "ManpowerBudgetSubmission"("fiscalYear");

-- AddForeignKey
ALTER TABLE "ExpenseLineItem" ADD CONSTRAINT "ExpenseLineItem_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdditionalHeadcountRequest" ADD CONSTRAINT "AdditionalHeadcountRequest_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdditionalHeadcountRequest" ADD CONSTRAINT "AdditionalHeadcountRequest_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdditionalHeadcountRequest" ADD CONSTRAINT "AdditionalHeadcountRequest_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HeadcountReviewDecision" ADD CONSTRAINT "HeadcountReviewDecision_additionalHeadcountRequestId_fkey" FOREIGN KEY ("additionalHeadcountRequestId") REFERENCES "AdditionalHeadcountRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HeadcountReviewDecision" ADD CONSTRAINT "HeadcountReviewDecision_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ManpowerEntry" ADD CONSTRAINT "ManpowerEntry_payComponentId_fkey" FOREIGN KEY ("payComponentId") REFERENCES "PayComponent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ManpowerEntry" ADD CONSTRAINT "ManpowerEntry_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ManpowerHeadcount" ADD CONSTRAINT "ManpowerHeadcount_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ManpowerHeadcountAuditLog" ADD CONSTRAINT "ManpowerHeadcountAuditLog_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HrPortalUploadBatch" ADD CONSTRAINT "HrPortalUploadBatch_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
