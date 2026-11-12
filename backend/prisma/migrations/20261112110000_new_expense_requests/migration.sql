-- New GAE Request > "This expense isn't in the standard list" is now a
-- request to add a line item to the standard list (NewExpenseRequest), not a
-- budget request. See schema.prisma.
CREATE TABLE "NewExpenseRequest" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "details" TEXT,
    "departmentId" TEXT NOT NULL,
    "requestedById" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decisionNote" TEXT,
    "expenseLineItemId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NewExpenseRequest_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "NewExpenseRequest_status_createdAt_idx" ON "NewExpenseRequest"("status", "createdAt");
CREATE INDEX "NewExpenseRequest_requestedById_idx" ON "NewExpenseRequest"("requestedById");

ALTER TABLE "NewExpenseRequest" ADD CONSTRAINT "NewExpenseRequest_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Custom-expense GAE budget requests still open from the old flow become
-- new-expense requests (same name, justification, requestor and date), and
-- the budget request itself is cancelled - it isn't a budget request anymore.
INSERT INTO "NewExpenseRequest" ("id", "name", "details", "departmentId", "requestedById", "status", "createdAt")
SELECT 'ner_' || br."id", eli."name", NULLIF(btrim(br."businessJustification"), ''), br."departmentId", br."createdById", 'PENDING', br."createdAt"
FROM "BudgetRequest" br
JOIN "ExpenseLineItem" eli ON eli."id" = br."expenseLineItemId"
WHERE br."requestCategory" = 'GAE'
  AND eli."isCustom" = true
  AND eli."status" = 'PENDING_REFINEMENT'
  AND br."currentStage" NOT IN ('APPROVED', 'CANCELLED', 'REJECTED');

UPDATE "BudgetRequest" br
SET "currentStage" = 'CANCELLED', "status" = 'CANCELLED', "assigneeId" = NULL
FROM "ExpenseLineItem" eli
WHERE eli."id" = br."expenseLineItemId"
  AND br."requestCategory" = 'GAE'
  AND eli."isCustom" = true
  AND eli."status" = 'PENDING_REFINEMENT'
  AND br."currentStage" NOT IN ('APPROVED', 'CANCELLED', 'REJECTED');
