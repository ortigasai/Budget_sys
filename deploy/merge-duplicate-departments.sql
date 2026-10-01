-- Merges the two duplicate Department rows found on this project's dev DB:
--   "Administrative Services" -> "Admin Services"
--   "TSG"                     -> "Technical Services"
-- Only run this AFTER check-department-merge-conflicts.sql comes back clean
-- (every conflict-check query returns zero rows). Looks departments up by
-- name, not by id, since ids differ between databases.
--
-- Wrapped in a transaction - if anything unexpected errors out (e.g. a
-- unique-constraint violation this script's own pre-check didn't catch),
-- the whole thing rolls back and nothing is left half-merged.

BEGIN;

-- Merge 1: Administrative Services -> Admin Services
UPDATE "ExpenseLineItem"
SET "ownerDepartmentId" = (SELECT id FROM "Department" WHERE name = 'Admin Services')
WHERE "ownerDepartmentId" = (SELECT id FROM "Department" WHERE name = 'Administrative Services');

UPDATE "HistoricalActuals"
SET "departmentId" = (SELECT id FROM "Department" WHERE name = 'Admin Services')
WHERE "departmentId" = (SELECT id FROM "Department" WHERE name = 'Administrative Services');

DELETE FROM "Department" WHERE name = 'Administrative Services';

-- Merge 2: TSG -> Technical Services (confirmed by the user: "TSG is
-- Technical Services"). The exact target name drifts per environment - dev
-- has "Technical Services", this server has "Technical Services Group" -
-- so this picks whichever one actually exists rather than hardcoding either
-- (never "Estates & Property Management & Technical Services Group", a
-- separate, real, combined department - the exact name match below won't
-- accidentally hit it).
UPDATE "User"
SET "departmentId" = COALESCE((SELECT id FROM "Department" WHERE name = 'Technical Services'), (SELECT id FROM "Department" WHERE name = 'Technical Services Group'))
WHERE "departmentId" = (SELECT id FROM "Department" WHERE name = 'TSG');

UPDATE "ExpenseLineItem"
SET "visibleToDepartmentId" = COALESCE((SELECT id FROM "Department" WHERE name = 'Technical Services'), (SELECT id FROM "Department" WHERE name = 'Technical Services Group'))
WHERE "visibleToDepartmentId" = (SELECT id FROM "Department" WHERE name = 'TSG');

UPDATE "HistoricalActuals"
SET "departmentId" = COALESCE((SELECT id FROM "Department" WHERE name = 'Technical Services'), (SELECT id FROM "Department" WHERE name = 'Technical Services Group'))
WHERE "departmentId" = (SELECT id FROM "Department" WHERE name = 'TSG');

UPDATE "DepartmentalBudgetCap"
SET "departmentId" = COALESCE((SELECT id FROM "Department" WHERE name = 'Technical Services'), (SELECT id FROM "Department" WHERE name = 'Technical Services Group'))
WHERE "departmentId" = (SELECT id FROM "Department" WHERE name = 'TSG');

DELETE FROM "Department" WHERE name = 'TSG';

COMMIT;

-- Verify afterward: both of these should return zero rows.
SELECT * FROM "Department" WHERE name IN ('Administrative Services', 'TSG');
