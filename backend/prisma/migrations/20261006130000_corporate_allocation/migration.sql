-- CreateTable
CREATE TABLE "CorporateAllocation" (
    "id" TEXT NOT NULL,
    "fiscalYear" INTEGER NOT NULL,
    "requestCategory" "RequestCategory" NOT NULL,
    "sbu" "Sbu" NOT NULL,
    "percent" DOUBLE PRECISION NOT NULL,
    "setBy" TEXT NOT NULL,
    "setAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CorporateAllocation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CorporateAllocation_fiscalYear_requestCategory_sbu_key" ON "CorporateAllocation"("fiscalYear", "requestCategory", "sbu");
