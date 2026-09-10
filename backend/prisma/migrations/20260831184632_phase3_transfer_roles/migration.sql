-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "RoleType" ADD VALUE 'BU_FINANCE_HEAD';
ALTER TYPE "RoleType" ADD VALUE 'BU_HEAD';
ALTER TYPE "RoleType" ADD VALUE 'BU_FINANCE_OFFICER';

-- CreateTable
CREATE TABLE "SbuRoleAssignment" (
    "id" TEXT NOT NULL,
    "sbu" "Sbu" NOT NULL,
    "roleType" "RoleType" NOT NULL,
    "userId" TEXT NOT NULL,
    "assignedById" TEXT,
    "effectiveDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SbuRoleAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SbuRoleAssignment_sbu_roleType_userId_key" ON "SbuRoleAssignment"("sbu", "roleType", "userId");

-- AddForeignKey
ALTER TABLE "SbuRoleAssignment" ADD CONSTRAINT "SbuRoleAssignment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

