-- AlterEnum
ALTER TYPE "Sbu" ADD VALUE 'CORPORATE';

-- CreateTable
CREATE TABLE "NpcForecastEntry" (
    "id" TEXT NOT NULL,
    "budgetRequestId" TEXT NOT NULL,
    "fiscalYear" INTEGER NOT NULL,
    "monthlyRemainingForecast" JSONB NOT NULL DEFAULT '{}',
    "updatedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NpcForecastEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FinalizedBudgetLine" (
    "id" TEXT NOT NULL,
    "budgetRequestId" TEXT NOT NULL,
    "fiscalYear" INTEGER NOT NULL,
    "requestCategory" "RequestCategory" NOT NULL,
    "sbu" "Sbu",
    "npcSbu" TEXT,
    "glAccount" TEXT NOT NULL,
    "costCenter" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "sapDocumentNumber" TEXT,
    "finalizedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finalizedById" TEXT NOT NULL,

    CONSTRAINT "FinalizedBudgetLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "NpcForecastEntry_budgetRequestId_key" ON "NpcForecastEntry"("budgetRequestId");

-- CreateIndex
CREATE UNIQUE INDEX "NpcForecastEntry_budgetRequestId_fiscalYear_key" ON "NpcForecastEntry"("budgetRequestId", "fiscalYear");

-- CreateIndex
CREATE UNIQUE INDEX "FinalizedBudgetLine_budgetRequestId_key" ON "FinalizedBudgetLine"("budgetRequestId");

-- CreateIndex
CREATE INDEX "FinalizedBudgetLine_fiscalYear_glAccount_costCenter_idx" ON "FinalizedBudgetLine"("fiscalYear", "glAccount", "costCenter");

-- CreateIndex
CREATE INDEX "FinalizedBudgetLine_fiscalYear_requestCategory_sbu_idx" ON "FinalizedBudgetLine"("fiscalYear", "requestCategory", "sbu");

-- AddForeignKey
ALTER TABLE "NpcForecastEntry" ADD CONSTRAINT "NpcForecastEntry_budgetRequestId_fkey" FOREIGN KEY ("budgetRequestId") REFERENCES "BudgetRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NpcForecastEntry" ADD CONSTRAINT "NpcForecastEntry_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinalizedBudgetLine" ADD CONSTRAINT "FinalizedBudgetLine_budgetRequestId_fkey" FOREIGN KEY ("budgetRequestId") REFERENCES "BudgetRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinalizedBudgetLine" ADD CONSTRAINT "FinalizedBudgetLine_finalizedById_fkey" FOREIGN KEY ("finalizedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
