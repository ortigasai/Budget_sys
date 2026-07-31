/*
  Warnings:

  - Added the required column `ownerDepartmentId` to the `ExpenseLineItem` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "ExpenseLineItem" ADD COLUMN     "ownerDepartmentId" TEXT NOT NULL;

-- AddForeignKey
ALTER TABLE "ExpenseLineItem" ADD CONSTRAINT "ExpenseLineItem_ownerDepartmentId_fkey" FOREIGN KEY ("ownerDepartmentId") REFERENCES "Department"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
