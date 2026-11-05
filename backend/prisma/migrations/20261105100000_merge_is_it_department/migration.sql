-- Merge the "IS & IT" department into "Information System & Information
-- Technology" and remove "IS & IT" (Nov 2026). The Expense Line Items
-- workbook's "Visible only to" column says "IS & IT" for 39 of IS&IT's own
-- line items; the import created a separate, empty "IS & IT" department for
-- it, so those items were visible to nobody (e.g. Reggie T. Acbang's GAE
-- template showed 26 of the 58 Systems & Applications items). Imports now
-- read "IS & IT" as the full name (lib/departmentAliases.ts).
--
-- Same merge as 20261104190000_merge_tsg_department: by exact name, safe to
-- re-run, renames instead if only "IS & IT" exists.
DO $$
DECLARE
  old_id TEXT;
  new_id TEXT;
BEGIN
  SELECT id INTO old_id FROM "Department" WHERE name = 'IS & IT';
  SELECT id INTO new_id FROM "Department" WHERE name = 'Information System & Information Technology';

  IF old_id IS NULL THEN
    RETURN;
  END IF;

  IF new_id IS NULL THEN
    UPDATE "Department" SET name = 'Information System & Information Technology' WHERE id = old_id;
    UPDATE "UserGroupMembership" SET scope = 'Information System & Information Technology' WHERE scope = 'IS & IT';
    RETURN;
  END IF;

  -- One-per-department-per-year rows: if both have one, stop rather than
  -- guess which submission to keep.
  IF EXISTS (
    SELECT 1 FROM "ForecastSubmission" o JOIN "ForecastSubmission" n
      ON n."fiscalYear" = o."fiscalYear" AND n."departmentId" = new_id
    WHERE o."departmentId" = old_id
  ) THEN
    RAISE EXCEPTION 'Both IS & IT and Information System & Information Technology have a Forecast submission for the same year - resolve that first.';
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
  WHERE o.scope = 'IS & IT' AND n.scope = 'Information System & Information Technology'
    AND n."userId" = o."userId" AND n."group" = o."group";
  UPDATE "UserGroupMembership" SET scope = 'Information System & Information Technology' WHERE scope = 'IS & IT';

  DELETE FROM "Department" WHERE id = old_id;
END $$;
