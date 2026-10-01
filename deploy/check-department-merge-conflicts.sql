-- Read-only pre-merge check for merging "Administrative Services" -> "Admin
-- Services" and "TSG" -> "Technical Services". Run this FIRST and look at
-- the output before running merge-duplicate-departments.sql - if any of the
-- "conflict" queries return rows, STOP and report back instead of merging.

-- Row counts per source department (matches what was found on the dev DB:
-- Administrative Services had 33 ExpenseLineItem rows + 28 HistoricalActuals
-- rows; TSG had 3 Users + 1 visible-to item + 1 HistoricalActuals row + 1
-- DepartmentalBudgetCap row). Different counts here just mean the server's
-- data differs from dev - not itself a problem.
SELECT 'Administrative Services' AS dept, 'ExpenseLineItem (owner)' AS table, count(*) FROM "ExpenseLineItem" WHERE "ownerDepartmentId" = (SELECT id FROM "Department" WHERE name = 'Administrative Services')
UNION ALL
SELECT 'Administrative Services', 'HistoricalActuals', count(*) FROM "HistoricalActuals" WHERE "departmentId" = (SELECT id FROM "Department" WHERE name = 'Administrative Services')
UNION ALL
SELECT 'TSG', 'User', count(*) FROM "User" WHERE "departmentId" = (SELECT id FROM "Department" WHERE name = 'TSG')
UNION ALL
SELECT 'TSG', 'ExpenseLineItem (visibleTo)', count(*) FROM "ExpenseLineItem" WHERE "visibleToDepartmentId" = (SELECT id FROM "Department" WHERE name = 'TSG')
UNION ALL
SELECT 'TSG', 'HistoricalActuals', count(*) FROM "HistoricalActuals" WHERE "departmentId" = (SELECT id FROM "Department" WHERE name = 'TSG')
UNION ALL
SELECT 'TSG', 'DepartmentalBudgetCap', count(*) FROM "DepartmentalBudgetCap" WHERE "departmentId" = (SELECT id FROM "Department" WHERE name = 'TSG');

-- CONFLICT CHECK 1: GrowthRateOverride.departmentId is @unique - if BOTH the
-- source and target department have a row, merging would violate that.
SELECT 'GrowthRateOverride conflict' AS check, d.name, gro."departmentId"
FROM "GrowthRateOverride" gro JOIN "Department" d ON d.id = gro."departmentId"
WHERE d.name IN ('Administrative Services', 'Admin Services', 'TSG', 'Technical Services');

-- CONFLICT CHECK 2: DepartmentalBudgetCap is unique on (departmentId,
-- fiscalYear) - conflict only if BOTH source and target have a cap for the
-- SAME fiscalYear.
SELECT a."fiscalYear", a."departmentId" AS source_id, b."departmentId" AS target_id
FROM "DepartmentalBudgetCap" a
JOIN "DepartmentalBudgetCap" b ON a."fiscalYear" = b."fiscalYear"
WHERE a."departmentId" = (SELECT id FROM "Department" WHERE name = 'TSG')
  AND b."departmentId" = (SELECT id FROM "Department" WHERE name = 'Technical Services');

-- CONFLICT CHECK 3: ForecastSubmission is unique on (departmentId,
-- fiscalYear) - same shape of check, for both merges.
SELECT 'Administrative Services/Admin Services' AS pair, a."fiscalYear"
FROM "ForecastSubmission" a
JOIN "ForecastSubmission" b ON a."fiscalYear" = b."fiscalYear"
WHERE a."departmentId" = (SELECT id FROM "Department" WHERE name = 'Administrative Services')
  AND b."departmentId" = (SELECT id FROM "Department" WHERE name = 'Admin Services')
UNION ALL
SELECT 'TSG/Technical Services', a."fiscalYear"
FROM "ForecastSubmission" a
JOIN "ForecastSubmission" b ON a."fiscalYear" = b."fiscalYear"
WHERE a."departmentId" = (SELECT id FROM "Department" WHERE name = 'TSG')
  AND b."departmentId" = (SELECT id FROM "Department" WHERE name = 'Technical Services');

-- CONFLICT CHECK 4: RoleAssignment is unique on (departmentId, roleType,
-- userId) - conflict only if the SAME person holds the SAME role in BOTH
-- the source and target department already.
SELECT 'Administrative Services/Admin Services' AS pair, a."roleType", a."userId"
FROM "RoleAssignment" a
JOIN "RoleAssignment" b ON a."roleType" = b."roleType" AND a."userId" = b."userId"
WHERE a."departmentId" = (SELECT id FROM "Department" WHERE name = 'Administrative Services')
  AND b."departmentId" = (SELECT id FROM "Department" WHERE name = 'Admin Services')
UNION ALL
SELECT 'TSG/Technical Services', a."roleType", a."userId"
FROM "RoleAssignment" a
JOIN "RoleAssignment" b ON a."roleType" = b."roleType" AND a."userId" = b."userId"
WHERE a."departmentId" = (SELECT id FROM "Department" WHERE name = 'TSG')
  AND b."departmentId" = (SELECT id FROM "Department" WHERE name = 'Technical Services');
