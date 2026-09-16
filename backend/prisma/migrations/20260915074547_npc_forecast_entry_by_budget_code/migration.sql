-- NpcForecastEntry moves from being keyed by budgetRequestId (requires a
-- real BudgetRequest) to budgetCode (present on every NPC Forecast row,
-- including one sourced only from the NPC Monitoring import) - table is
-- empty in every environment this migration has run against so far, so no
-- backfill is needed.

-- DropForeignKey
ALTER TABLE "NpcForecastEntry" DROP CONSTRAINT "NpcForecastEntry_budgetRequestId_fkey";

-- DropIndex
DROP INDEX "NpcForecastEntry_budgetRequestId_key";

-- DropIndex
DROP INDEX "NpcForecastEntry_budgetRequestId_fiscalYear_key";

-- AlterTable
ALTER TABLE "NpcForecastEntry"
  ADD COLUMN     "budgetCode" TEXT NOT NULL,
  ALTER COLUMN "budgetRequestId" DROP NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "NpcForecastEntry_budgetCode_fiscalYear_key" ON "NpcForecastEntry"("budgetCode", "fiscalYear");
