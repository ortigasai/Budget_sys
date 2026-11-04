-- Merge the "Technical Services" department into "Technical Services Group"
-- and remove "Technical Services" (Nov 2026 - the Expense Line Items workbook
-- now names the department "Technical Services Group").
--
-- Looks both up by name (ids differ between databases). Safe to re-run and
-- safe on a database that only has one of the two:
--   - only "Technical Services" exists -> it's simply renamed;
--   - neither / only the Group exists  -> nothing to do.
-- Never touches "TSG" or "Estates & Property Management & Technical
-- Services Group" (exact name match only).
DO $$
DECLARE
  old_id TEXT;
  new_id TEXT;
BEGIN
  SELECT id INTO old_id FROM "Department" WHERE name = 'Technical Services';
  SELECT id INTO new_id FROM "Department" WHERE name = 'Technical Services Group';

  IF old_id IS NULL THEN
    RETURN;
  END IF;

  IF new_id IS NULL THEN
    UPDATE "Department" SET name = 'Technical Services Group' WHERE id = old_id;
    UPDATE "UserGroupMembership" SET scope = 'Technical Services Group' WHERE scope = 'Technical Services';
    RETURN;
  END IF;

  -- One-per-department-per-year rows: if both have one, stop rather than
  -- guess which submission to keep.
  IF EXISTS (
    SELECT 1 FROM "ForecastSubmission" o JOIN "ForecastSubmission" n
      ON n."fiscalYear" = o."fiscalYear" AND n."departmentId" = new_id
    WHERE o."departmentId" = old_id
  ) THEN
    RAISE EXCEPTION 'Both Technical Services and Technical Services Group have a Forecast submission for the same year - resolve that first.';
  END IF;

  -- Budget caps are computed figures: where both have one for a year, keep
  -- the most recently computed.
  DELETE FROM "DepartmentalBudgetCap" n
  USING "DepartmentalBudgetCap" o
  WHERE n."departmentId" = new_id AND o."departmentId" = old_id
    AND n."fiscalYear" = o."fiscalYear" AND n."computedAt" <= o."computedAt";
  DELETE FROM "DepartmentalBudgetCap" o
  USING "DepartmentalBudgetCap" n
  WHERE o."departmentId" = old_id AND n."departmentId" = new_id
    AND n."fiscalYear" = o."fiscalYear";

  -- One growth-rate override per department: the Group's own wins.
  IF EXISTS (SELECT 1 FROM "GrowthRateOverride" WHERE "departmentId" = new_id) THEN
    DELETE FROM "GrowthRateOverride" WHERE "departmentId" = old_id;
  END IF;

  -- Role assignments: drop ones the Group already has, move the rest.
  DELETE FROM "RoleAssignment" o
  USING "RoleAssignment" n
  WHERE o."departmentId" = old_id AND n."departmentId" = new_id
    AND n."roleType" = o."roleType" AND n."userId" = o."userId";

  UPDATE "AccessRequest"              SET "departmentId" = new_id WHERE "departmentId" = old_id;
  UPDATE "AdditionalHeadcountRequest" SET "departmentId" = new_id WHERE "departmentId" = old_id;
  UPDATE "BudgetRequest"              SET "departmentId" = new_id WHERE "departmentId" = old_id;
  UPDATE "BulkUploadBatch"            SET "departmentId" = new_id WHERE "departmentId" = old_id;
  UPDATE "DepartmentalBudgetCap"      SET "departmentId" = new_id WHERE "departmentId" = old_id;
  UPDATE "ExpenseLineItem"            SET "ownerDepartmentId" = new_id WHERE "ownerDepartmentId" = old_id;
  UPDATE "ExpenseLineItem"            SET "visibleToDepartmentId" = new_id WHERE "visibleToDepartmentId" = old_id;
  UPDATE "ForecastSubmission"         SET "departmentId" = new_id WHERE "departmentId" = old_id;
  UPDATE "GrowthRateAuditLog"         SET "departmentId" = new_id WHERE "departmentId" = old_id;
  UPDATE "GrowthRateOverride"         SET "departmentId" = new_id WHERE "departmentId" = old_id;
  UPDATE "HistoricalActuals"          SET "departmentId" = new_id WHERE "departmentId" = old_id;
  UPDATE "RoleAssignment"             SET "departmentId" = new_id WHERE "departmentId" = old_id;
  UPDATE "User"                       SET "departmentId" = new_id WHERE "departmentId" = old_id;

  -- Access Control scopes are stored as department names.
  DELETE FROM "UserGroupMembership" o
  USING "UserGroupMembership" n
  WHERE o.scope = 'Technical Services' AND n.scope = 'Technical Services Group'
    AND n."userId" = o."userId" AND n."group" = o."group";
  UPDATE "UserGroupMembership" SET scope = 'Technical Services Group' WHERE scope = 'Technical Services';

  DELETE FROM "Department" WHERE id = old_id;
END $$;
