-- A 2nd Centralized Department Head per department: a second Centralized
-- Department Head Review stage, right after the first, for GAE requests on
-- that department's line items.
ALTER TYPE "RoleType" ADD VALUE IF NOT EXISTS 'CENTRALIZED_DEPARTMENT_HEAD_2';
ALTER TYPE "RequestStage" ADD VALUE IF NOT EXISTS 'CENTRALIZED_HEAD_2_REVIEW' AFTER 'CENTRALIZED_HEAD_REVIEW';

ALTER TABLE "BudgetRequest" ADD COLUMN "centralizedHead2Review" BOOLEAN NOT NULL DEFAULT false;
