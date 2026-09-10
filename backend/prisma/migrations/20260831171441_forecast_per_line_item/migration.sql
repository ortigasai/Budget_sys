-- DropIndex
DROP INDEX "HistoricalActuals_departmentId_glAccount_costCenter_fiscalY_key";

-- AlterTable
ALTER TABLE "HistoricalActuals" ADD COLUMN     "budgetCode" TEXT,
ADD COLUMN     "expenseCategory" TEXT,
ADD COLUMN     "expenseLineItemId" TEXT,
ADD COLUMN     "requestCategory" "RequestCategory" NOT NULL DEFAULT 'GAE';

-- CreateTable
CREATE TABLE "ForecastCategoryMapping" (
    "id" TEXT NOT NULL,
    "glAccount" TEXT NOT NULL,
    "costCenter" TEXT NOT NULL,
    "category" "RequestCategory" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ForecastCategoryMapping_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ForecastCategoryMapping_glAccount_costCenter_key" ON "ForecastCategoryMapping"("glAccount", "costCenter");

-- CreateIndex
CREATE UNIQUE INDEX "HistoricalActuals_expenseLineItemId_fiscalYear_key" ON "HistoricalActuals"("expenseLineItemId", "fiscalYear");

-- AddForeignKey
ALTER TABLE "HistoricalActuals" ADD CONSTRAINT "HistoricalActuals_expenseLineItemId_fkey" FOREIGN KEY ("expenseLineItemId") REFERENCES "ExpenseLineItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

