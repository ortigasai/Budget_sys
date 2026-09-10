-- AlterTable
ALTER TABLE "FiscalCycleConfig" ADD COLUMN     "cycleOpen" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "targetCalendarYear" INTEGER NOT NULL DEFAULT 2027;

