-- CreateTable
CREATE TABLE "SapSyncStatus" (
    "module" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'idle',
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "lastSuccessAt" TIMESTAMP(3),
    "resultJson" JSONB,
    "error" TEXT,

    CONSTRAINT "SapSyncStatus_pkey" PRIMARY KEY ("module")
);
