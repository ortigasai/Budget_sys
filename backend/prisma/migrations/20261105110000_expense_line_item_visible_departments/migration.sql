-- A line item can be "Visible only to" several departments (Expense Line
-- Items column R, e.g. "Office of the CFO, Corporate Finance"). The full
-- list lives in this table; no rows = visible to every department.
-- ExpenseLineItem.visibleToDepartmentId stays, holding the first one.

-- CreateTable
CREATE TABLE "ExpenseLineItemVisibleDepartment" (
    "expenseLineItemId" TEXT NOT NULL,
    "departmentId" TEXT NOT NULL,

    CONSTRAINT "ExpenseLineItemVisibleDepartment_pkey" PRIMARY KEY ("expenseLineItemId","departmentId")
);

-- CreateIndex
CREATE INDEX "ExpenseLineItemVisibleDepartment_departmentId_idx" ON "ExpenseLineItemVisibleDepartment"("departmentId");

-- AddForeignKey
ALTER TABLE "ExpenseLineItemVisibleDepartment" ADD CONSTRAINT "ExpenseLineItemVisibleDepartment_expenseLineItemId_fkey" FOREIGN KEY ("expenseLineItemId") REFERENCES "ExpenseLineItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExpenseLineItemVisibleDepartment" ADD CONSTRAINT "ExpenseLineItemVisibleDepartment_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Existing single restrictions carry over as-is.
INSERT INTO "ExpenseLineItemVisibleDepartment" ("expenseLineItemId", "departmentId")
SELECT id, "visibleToDepartmentId" FROM "ExpenseLineItem" WHERE "visibleToDepartmentId" IS NOT NULL;

-- The one multi-department cell imported so far became a single made-up
-- department named "Office of the CFO, Corporate Finance". Split it into the
-- two real departments and remove the made-up one (by exact name; skipped
-- if any of the three isn't there).
DO $$
DECLARE
  combined_id TEXT;
  ocfo_id TEXT;
  cf_id TEXT;
BEGIN
  SELECT id INTO combined_id FROM "Department" WHERE name = 'Office of the CFO, Corporate Finance';
  SELECT id INTO ocfo_id FROM "Department" WHERE name = 'Office of the CFO';
  SELECT id INTO cf_id FROM "Department" WHERE name = 'Corporate Finance';
  IF combined_id IS NULL OR ocfo_id IS NULL OR cf_id IS NULL THEN
    RETURN;
  END IF;

  INSERT INTO "ExpenseLineItemVisibleDepartment" ("expenseLineItemId", "departmentId")
  SELECT v."expenseLineItemId", d.id
  FROM "ExpenseLineItemVisibleDepartment" v CROSS JOIN (VALUES (ocfo_id), (cf_id)) AS d(id)
  WHERE v."departmentId" = combined_id
  ON CONFLICT DO NOTHING;
  DELETE FROM "ExpenseLineItemVisibleDepartment" WHERE "departmentId" = combined_id;
  UPDATE "ExpenseLineItem" SET "visibleToDepartmentId" = ocfo_id WHERE "visibleToDepartmentId" = combined_id;

  -- Only if nothing else still points at it.
  BEGIN
    DELETE FROM "Department" WHERE id = combined_id;
  EXCEPTION WHEN foreign_key_violation THEN
    RAISE NOTICE 'Kept department "Office of the CFO, Corporate Finance" - still referenced elsewhere.';
  END;
END $$;
