-- One row per successful Expense Line Items catalog upload (Admin Console), so the tab can show the last upload's date and uploader.
CREATE TABLE IF NOT EXISTS "ExpenseLineItemCatalogUpload" (
    "id" TEXT NOT NULL,
    "uploadedById" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "created" INTEGER NOT NULL,
    "updated" INTEGER NOT NULL,
    "removed" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExpenseLineItemCatalogUpload_pkey" PRIMARY KEY ("id")
);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ExpenseLineItemCatalogUpload_uploadedById_fkey') THEN
    ALTER TABLE "ExpenseLineItemCatalogUpload" ADD CONSTRAINT "ExpenseLineItemCatalogUpload_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;
