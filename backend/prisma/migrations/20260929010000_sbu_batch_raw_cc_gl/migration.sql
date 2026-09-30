-- AlterTable
ALTER TABLE "BudgetRequest" ALTER COLUMN "expenseLineItemId" DROP NOT NULL;
ALTER TABLE "BudgetRequest" ADD COLUMN "costCenter" TEXT;
ALTER TABLE "BudgetRequest" ADD COLUMN "glAccount" TEXT;
