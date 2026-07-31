-- CreateEnum
CREATE TYPE "DepartmentType" AS ENUM ('REQUESTING', 'CENTRALIZED');

-- CreateEnum
CREATE TYPE "RoleType" AS ENUM ('DEPARTMENT_HEAD', 'CENTRALIZED_FIRST_LEVEL_REVIEWER', 'CENTRALIZED_DEPARTMENT_HEAD', 'BCA_HEAD', 'CENTRALIZED_BUDGET_PREPARER', 'BUDGET_OFFICER');

-- CreateEnum
CREATE TYPE "ExpenseLineItemStatus" AS ENUM ('STANDARD', 'PENDING_REFINEMENT');

-- CreateEnum
CREATE TYPE "RequestStage" AS ENUM ('DRAFT', 'DEPT_HEAD_REVIEW', 'CENTRALIZED_L1_REVIEW', 'CENTRALIZED_HEAD_REVIEW', 'BCA_HEAD_REVIEW', 'BUDGET_OFFICER_REVIEW', 'APPROVED', 'RETURNED_TO_REQUESTOR', 'REJECTED');

-- CreateEnum
CREATE TYPE "RequestStatus" AS ENUM ('DRAFT', 'IN_REVIEW', 'RETURNED', 'REJECTED', 'APPROVED', 'UPLOADED_TO_SAP');

-- CreateEnum
CREATE TYPE "ReviewDecisionType" AS ENUM ('APPROVE', 'REJECT', 'RETURN');

-- CreateEnum
CREATE TYPE "VarianceScope" AS ENUM ('GLOBAL', 'DEPARTMENT');

-- CreateEnum
CREATE TYPE "VarianceThresholdType" AS ENUM ('AMOUNT', 'PERCENT');

-- CreateEnum
CREATE TYPE "BulkUploadStatus" AS ENUM ('PROCESSING', 'COMPLETED', 'COMPLETED_WITH_ERRORS', 'FAILED');

-- CreateTable
CREATE TABLE "Department" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "DepartmentType" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Department_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "departmentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RoleAssignment" (
    "id" TEXT NOT NULL,
    "departmentId" TEXT NOT NULL,
    "roleType" "RoleType" NOT NULL,
    "userId" TEXT NOT NULL,
    "assignedById" TEXT,
    "effectiveDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RoleAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkflowStageConfig" (
    "id" TEXT NOT NULL,
    "stage" INTEGER NOT NULL,
    "departmentId" TEXT NOT NULL,
    "dueDate" TIMESTAMP(3) NOT NULL,
    "configuredBy" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkflowStageConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExpenseLineItem" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "glAccount" TEXT NOT NULL,
    "costCenter" TEXT NOT NULL,
    "isCustom" BOOLEAN NOT NULL DEFAULT false,
    "status" "ExpenseLineItemStatus" NOT NULL DEFAULT 'STANDARD',
    "extraFieldsConfig" JSONB NOT NULL DEFAULT '[]',
    "managedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExpenseLineItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GrowthRateConfig" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "defaultValue" DOUBLE PRECISION NOT NULL,
    "editedBy" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GrowthRateConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GrowthRateOverride" (
    "id" TEXT NOT NULL,
    "departmentId" TEXT NOT NULL,
    "value" DOUBLE PRECISION NOT NULL,
    "editedBy" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GrowthRateOverride_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GrowthRateAuditLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "oldValue" DOUBLE PRECISION,
    "newValue" DOUBLE PRECISION NOT NULL,
    "departmentId" TEXT,
    "reason" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GrowthRateAuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HistoricalActuals" (
    "id" TEXT NOT NULL,
    "departmentId" TEXT NOT NULL,
    "glAccount" TEXT NOT NULL,
    "costCenter" TEXT NOT NULL,
    "glDescription" TEXT NOT NULL,
    "actuals2025" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "approvedBudget2026" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "ytdActuals2026" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "remainingForecast2026" DOUBLE PRECISION,
    "forecastCompletedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HistoricalActuals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DepartmentalBudgetCap" (
    "id" TEXT NOT NULL,
    "departmentId" TEXT NOT NULL,
    "fiscalYear" INTEGER NOT NULL,
    "value" DOUBLE PRECISION NOT NULL,
    "actualsYtd2026" DOUBLE PRECISION NOT NULL,
    "remainingForecast2026" DOUBLE PRECISION NOT NULL,
    "growthRateUsed" DOUBLE PRECISION NOT NULL,
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DepartmentalBudgetCap_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VarianceThresholdConfig" (
    "id" TEXT NOT NULL,
    "scope" "VarianceScope" NOT NULL,
    "departmentId" TEXT,
    "thresholdType" "VarianceThresholdType" NOT NULL,
    "value" DOUBLE PRECISION NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VarianceThresholdConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentationThresholdConfig" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "amount" DOUBLE PRECISION NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DocumentationThresholdConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReasonCode" (
    "id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "ReasonCode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BoardApprovedBudget" (
    "id" TEXT NOT NULL,
    "fiscalYear" INTEGER NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "setBy" TEXT NOT NULL,
    "setAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BoardApprovedBudget_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BudgetRequest" (
    "id" TEXT NOT NULL,
    "departmentId" TEXT NOT NULL,
    "fiscalYear" INTEGER NOT NULL,
    "expenseLineItemId" TEXT NOT NULL,
    "monthlyAmounts" JSONB NOT NULL,
    "proposedAmount" DOUBLE PRECISION NOT NULL,
    "businessJustification" TEXT NOT NULL,
    "otherRequiredFields" JSONB NOT NULL DEFAULT '{}',
    "currentStage" "RequestStage" NOT NULL DEFAULT 'DRAFT',
    "status" "RequestStatus" NOT NULL DEFAULT 'DRAFT',
    "budgetCutAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "isOverBudget" BOOLEAN NOT NULL DEFAULT false,
    "varianceJustification" TEXT,
    "reasonCode" TEXT,
    "sapDocumentNumber" TEXT,
    "createdById" TEXT NOT NULL,
    "bulkUploadBatchId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BudgetRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Attachment" (
    "id" TEXT NOT NULL,
    "budgetRequestId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "storagePath" TEXT NOT NULL,
    "uploadedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Attachment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReviewDecision" (
    "id" TEXT NOT NULL,
    "budgetRequestId" TEXT NOT NULL,
    "stage" "RequestStage" NOT NULL,
    "decision" "ReviewDecisionType" NOT NULL,
    "decidedById" TEXT NOT NULL,
    "comment" TEXT,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReviewDecision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BulkUploadBatch" (
    "id" TEXT NOT NULL,
    "uploadedById" TEXT NOT NULL,
    "departmentId" TEXT NOT NULL,
    "fiscalYear" INTEGER NOT NULL,
    "sourceFileRef" TEXT NOT NULL,
    "rowCount" INTEGER NOT NULL,
    "validationErrors" JSONB NOT NULL DEFAULT '[]',
    "status" "BulkUploadStatus" NOT NULL DEFAULT 'PROCESSING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BulkUploadBatch_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Department_name_key" ON "Department"("name");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "RoleAssignment_departmentId_roleType_userId_key" ON "RoleAssignment"("departmentId", "roleType", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "WorkflowStageConfig_stage_departmentId_key" ON "WorkflowStageConfig"("stage", "departmentId");

-- CreateIndex
CREATE UNIQUE INDEX "GrowthRateOverride_departmentId_key" ON "GrowthRateOverride"("departmentId");

-- CreateIndex
CREATE UNIQUE INDEX "HistoricalActuals_departmentId_glAccount_costCenter_key" ON "HistoricalActuals"("departmentId", "glAccount", "costCenter");

-- CreateIndex
CREATE UNIQUE INDEX "DepartmentalBudgetCap_departmentId_fiscalYear_key" ON "DepartmentalBudgetCap"("departmentId", "fiscalYear");

-- CreateIndex
CREATE UNIQUE INDEX "VarianceThresholdConfig_departmentId_key" ON "VarianceThresholdConfig"("departmentId");

-- CreateIndex
CREATE UNIQUE INDEX "ReasonCode_label_key" ON "ReasonCode"("label");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoleAssignment" ADD CONSTRAINT "RoleAssignment_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoleAssignment" ADD CONSTRAINT "RoleAssignment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkflowStageConfig" ADD CONSTRAINT "WorkflowStageConfig_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GrowthRateOverride" ADD CONSTRAINT "GrowthRateOverride_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GrowthRateAuditLog" ADD CONSTRAINT "GrowthRateAuditLog_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HistoricalActuals" ADD CONSTRAINT "HistoricalActuals_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DepartmentalBudgetCap" ADD CONSTRAINT "DepartmentalBudgetCap_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VarianceThresholdConfig" ADD CONSTRAINT "VarianceThresholdConfig_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BudgetRequest" ADD CONSTRAINT "BudgetRequest_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BudgetRequest" ADD CONSTRAINT "BudgetRequest_expenseLineItemId_fkey" FOREIGN KEY ("expenseLineItemId") REFERENCES "ExpenseLineItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BudgetRequest" ADD CONSTRAINT "BudgetRequest_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BudgetRequest" ADD CONSTRAINT "BudgetRequest_bulkUploadBatchId_fkey" FOREIGN KEY ("bulkUploadBatchId") REFERENCES "BulkUploadBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attachment" ADD CONSTRAINT "Attachment_budgetRequestId_fkey" FOREIGN KEY ("budgetRequestId") REFERENCES "BudgetRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attachment" ADD CONSTRAINT "Attachment_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewDecision" ADD CONSTRAINT "ReviewDecision_budgetRequestId_fkey" FOREIGN KEY ("budgetRequestId") REFERENCES "BudgetRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewDecision" ADD CONSTRAINT "ReviewDecision_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BulkUploadBatch" ADD CONSTRAINT "BulkUploadBatch_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BulkUploadBatch" ADD CONSTRAINT "BulkUploadBatch_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
