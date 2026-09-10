-- DropIndex
DROP INDEX "HistoricalActuals_departmentId_glAccount_costCenter_key";

-- AlterTable
ALTER TABLE "HistoricalActuals" ADD COLUMN     "fiscalYear" INTEGER NOT NULL DEFAULT 2027;

-- CreateIndex
CREATE UNIQUE INDEX "HistoricalActuals_departmentId_glAccount_costCenter_fiscalY_key" ON "HistoricalActuals"("departmentId", "glAccount", "costCenter", "fiscalYear");

