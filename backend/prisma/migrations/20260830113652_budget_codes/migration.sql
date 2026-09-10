-- CreateEnum
CREATE TYPE "BudgetCodePrefixKind" AS ENUM ('CENTRALIZED_DEPARTMENT', 'NPC_HEAD');

-- AlterTable
ALTER TABLE "BudgetRequest" ADD COLUMN     "budgetCode" TEXT,
ADD COLUMN     "npcHeadCode" TEXT;

-- AlterTable
ALTER TABLE "ExpenseLineItem" ADD COLUMN     "budgetCode" TEXT;

-- CreateTable
CREATE TABLE "BudgetCodePrefix" (
    "id" TEXT NOT NULL,
    "kind" "BudgetCodePrefixKind" NOT NULL,
    "label" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BudgetCodePrefix_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BudgetCodeSequence" (
    "id" TEXT NOT NULL,
    "prefixCode" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "lastNumber" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "BudgetCodeSequence_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BudgetCodePrefix_kind_label_key" ON "BudgetCodePrefix"("kind", "label");

-- CreateIndex
CREATE UNIQUE INDEX "BudgetCodeSequence_prefixCode_year_key" ON "BudgetCodeSequence"("prefixCode", "year");

