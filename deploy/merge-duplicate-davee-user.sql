-- Merges a duplicate User row found on dev: the same 2026-09-26 Approval
-- Workflow import (backend/prisma/importApprovalWorkflow.ts) that created
-- Chezzka's ghost account (see merge-duplicate-chezzka-user.sql) also
-- auto-created "Davee Zuniga" (email zunigadm@ortigas.com.ph) instead of
-- matching his existing roster account "Davee M. Zuñiga" (email
-- davee.zuniga@ortigas.com.ph, created 2026-07-28) - the name didn't match
-- exactly (missing middle initial + the ñ/n spelling), so the import
-- created a second, credential-less ghost account instead and routed his
-- real CFO role and "MC" (Mancom) group membership to THAT ghost account -
-- meaning the real, logged-into account had no group membership at all and
-- fell back to the permissive legacy access rules (seeing all of Module 1
-- instead of being restricted to Inbox only, per the MC group's intended
-- access).
--
-- Run check-davee-merge-conflicts.sql first - if both conflict checks
-- return zero rows, this is safe to run.

BEGIN;

UPDATE "RoleAssignment"
SET "userId" = (SELECT id FROM "User" WHERE email = 'davee.zuniga@ortigas.com.ph')
WHERE "userId" = (SELECT id FROM "User" WHERE email = 'zunigadm@ortigas.com.ph');

UPDATE "UserGroupMembership"
SET "userId" = (SELECT id FROM "User" WHERE email = 'davee.zuniga@ortigas.com.ph')
WHERE "userId" = (SELECT id FROM "User" WHERE email = 'zunigadm@ortigas.com.ph');

UPDATE "ExpenseLineItem"
SET "centralizedReviewerId" = (SELECT id FROM "User" WHERE email = 'davee.zuniga@ortigas.com.ph')
WHERE "centralizedReviewerId" = (SELECT id FROM "User" WHERE email = 'zunigadm@ortigas.com.ph');

UPDATE "ExpenseLineItem"
SET "centralizedHeadId" = (SELECT id FROM "User" WHERE email = 'davee.zuniga@ortigas.com.ph')
WHERE "centralizedHeadId" = (SELECT id FROM "User" WHERE email = 'zunigadm@ortigas.com.ph');

-- Any live BudgetRequest already routed to the ghost account (loose string
-- references, not FKs) - covers departmentHeadId/sbuHeadId/
-- centralizedHeadId/assigneeId/createdById in one pass.
UPDATE "BudgetRequest"
SET "departmentHeadId" = (SELECT id FROM "User" WHERE email = 'davee.zuniga@ortigas.com.ph')
WHERE "departmentHeadId" = (SELECT id FROM "User" WHERE email = 'zunigadm@ortigas.com.ph');

UPDATE "BudgetRequest"
SET "sbuHeadId" = (SELECT id FROM "User" WHERE email = 'davee.zuniga@ortigas.com.ph')
WHERE "sbuHeadId" = (SELECT id FROM "User" WHERE email = 'zunigadm@ortigas.com.ph');

UPDATE "BudgetRequest"
SET "centralizedHeadId" = (SELECT id FROM "User" WHERE email = 'davee.zuniga@ortigas.com.ph')
WHERE "centralizedHeadId" = (SELECT id FROM "User" WHERE email = 'zunigadm@ortigas.com.ph');

UPDATE "BudgetRequest"
SET "assigneeId" = (SELECT id FROM "User" WHERE email = 'davee.zuniga@ortigas.com.ph')
WHERE "assigneeId" = (SELECT id FROM "User" WHERE email = 'zunigadm@ortigas.com.ph');

UPDATE "BudgetRequest"
SET "createdById" = (SELECT id FROM "User" WHERE email = 'davee.zuniga@ortigas.com.ph')
WHERE "createdById" = (SELECT id FROM "User" WHERE email = 'zunigadm@ortigas.com.ph');

DELETE FROM "User" WHERE email = 'zunigadm@ortigas.com.ph';

COMMIT;

-- Verify afterward: should return zero rows.
SELECT * FROM "User" WHERE email = 'zunigadm@ortigas.com.ph';
