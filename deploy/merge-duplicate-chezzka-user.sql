-- Merges a duplicate User row found on dev: the Approval Workflow import
-- (backend/prisma/importApprovalWorkflow.ts) auto-created "Chezzka Sheen
-- Padilla" (email padillacsp@ortigas.com.ph) on 2026-09-26 instead of
-- matching her existing roster account "Chezzka Sheen P.
-- Padilla-Ballungay" (email chezzkasheen.padillaballungay@ortigas.com.ph,
-- employeeIdNumber set) - the name didn't match exactly (missing middle
-- initial + maiden/married surname), so the import created a second,
-- credential-less "ghost" account instead and routed her real
-- CENTRALIZED_BUDGET_PREPARER/CENTRALIZED_FIRST_LEVEL_REVIEWER roles, her
-- "CD"/Tax group membership, and 21 catalog items' centralizedReviewerId to
-- THAT ghost account - meaning requests routed to her for review were
-- invisible in the real, logged-into account's Inbox. A broad scan of every
-- other user in the database (same department + name-token overlap) found
-- no other instances of this - this looks like an isolated case, not a
-- widespread problem, but run the conflict check below before merging
-- regardless.
--
-- Run check-chezzka-merge-conflicts.sql first - if both conflict checks
-- return zero rows, this is safe to run.

BEGIN;

UPDATE "RoleAssignment"
SET "userId" = (SELECT id FROM "User" WHERE email = 'chezzkasheen.padillaballungay@ortigas.com.ph')
WHERE "userId" = (SELECT id FROM "User" WHERE email = 'padillacsp@ortigas.com.ph');

UPDATE "UserGroupMembership"
SET "userId" = (SELECT id FROM "User" WHERE email = 'chezzkasheen.padillaballungay@ortigas.com.ph')
WHERE "userId" = (SELECT id FROM "User" WHERE email = 'padillacsp@ortigas.com.ph');

UPDATE "ExpenseLineItem"
SET "centralizedReviewerId" = (SELECT id FROM "User" WHERE email = 'chezzkasheen.padillaballungay@ortigas.com.ph')
WHERE "centralizedReviewerId" = (SELECT id FROM "User" WHERE email = 'padillacsp@ortigas.com.ph');

-- centralizedHeadId never pointed at the duplicate on dev, but harmless to
-- cover here too in case this server's data differs.
UPDATE "ExpenseLineItem"
SET "centralizedHeadId" = (SELECT id FROM "User" WHERE email = 'chezzkasheen.padillaballungay@ortigas.com.ph')
WHERE "centralizedHeadId" = (SELECT id FROM "User" WHERE email = 'padillacsp@ortigas.com.ph');

-- Any live BudgetRequest already routed to the ghost account (loose string
-- references, not FKs) - covers departmentHeadId/sbuHeadId/
-- centralizedHeadId/assigneeId in one pass.
UPDATE "BudgetRequest"
SET "departmentHeadId" = (SELECT id FROM "User" WHERE email = 'chezzkasheen.padillaballungay@ortigas.com.ph')
WHERE "departmentHeadId" = (SELECT id FROM "User" WHERE email = 'padillacsp@ortigas.com.ph');

UPDATE "BudgetRequest"
SET "sbuHeadId" = (SELECT id FROM "User" WHERE email = 'chezzkasheen.padillaballungay@ortigas.com.ph')
WHERE "sbuHeadId" = (SELECT id FROM "User" WHERE email = 'padillacsp@ortigas.com.ph');

UPDATE "BudgetRequest"
SET "centralizedHeadId" = (SELECT id FROM "User" WHERE email = 'chezzkasheen.padillaballungay@ortigas.com.ph')
WHERE "centralizedHeadId" = (SELECT id FROM "User" WHERE email = 'padillacsp@ortigas.com.ph');

UPDATE "BudgetRequest"
SET "assigneeId" = (SELECT id FROM "User" WHERE email = 'chezzkasheen.padillaballungay@ortigas.com.ph')
WHERE "assigneeId" = (SELECT id FROM "User" WHERE email = 'padillacsp@ortigas.com.ph');

DELETE FROM "User" WHERE email = 'padillacsp@ortigas.com.ph';

COMMIT;

-- Verify afterward: should return zero rows.
SELECT * FROM "User" WHERE email = 'padillacsp@ortigas.com.ph';
