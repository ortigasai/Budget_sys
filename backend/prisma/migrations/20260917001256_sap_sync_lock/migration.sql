-- CreateTable
CREATE TABLE "SapSyncLock" (
    "id" TEXT NOT NULL DEFAULT 'global',
    "heldBy" TEXT,
    "heldAt" TIMESTAMP(3),

    CONSTRAINT "SapSyncLock_pkey" PRIMARY KEY ("id")
);

-- Seed the one row every claim attempt conditionally UPDATEs - without this,
-- `UPDATE ... WHERE id = 'global' AND "heldBy" IS NULL` matches zero rows
-- forever (nothing to claim), not "free to claim".
INSERT INTO "SapSyncLock" ("id", "heldBy", "heldAt") VALUES ('global', NULL, NULL);
