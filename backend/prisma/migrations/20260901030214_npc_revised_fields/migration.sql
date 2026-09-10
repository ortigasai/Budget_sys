-- AlterTable
ALTER TABLE "BudgetRequest" ADD COLUMN     "npcLocation" TEXT,
ADD COLUMN     "npcSbu" TEXT,
ADD COLUMN     "projectEndDate" TIMESTAMP(3),
ADD COLUMN     "projectStartDate" TIMESTAMP(3),
ADD COLUMN     "projectTitle" TEXT;

