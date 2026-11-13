-- Maria Jennifer J. Almojuela (Id Number 1806357) becomes the 2nd
-- Centralized Department Head of Tax and of Corporate Finance: their GAE
-- requests go to the first Centralized Department Head (Tax: Kristine Mae P.
-- Villegas; Corporate Finance: Andrea Romina C. Macasero), then to her.
-- Her first-level Centralized Department Head role on Tax is replaced.
--
-- Requests already in flight on those departments' line items (not yet past
-- the Centralized Department Head Review) get the new stage too, and any of
-- them waiting on her as the FIRST head move to the department's remaining
-- Centralized Department Head when there is exactly one.
DO $$
DECLARE
  jen_id text;
  dept record;
  other_head text;
BEGIN
  SELECT id INTO jen_id FROM "User" WHERE "employeeIdNumber" = 1806357;
  IF jen_id IS NULL THEN
    RETURN;
  END IF;

  FOR dept IN SELECT id, name FROM "Department" WHERE name IN ('Tax', 'Corporate Finance') LOOP
    DELETE FROM "RoleAssignment"
    WHERE "userId" = jen_id AND "departmentId" = dept.id AND "roleType" = 'CENTRALIZED_DEPARTMENT_HEAD';

    INSERT INTO "RoleAssignment" (id, "departmentId", "roleType", "userId")
    VALUES ('ra_cdh2_' || md5(dept.id || jen_id), dept.id, 'CENTRALIZED_DEPARTMENT_HEAD_2', jen_id)
    ON CONFLICT ("departmentId", "roleType", "userId") DO NOTHING;

    SELECT min("userId") INTO other_head FROM "RoleAssignment"
    WHERE "departmentId" = dept.id AND "roleType" = 'CENTRALIZED_DEPARTMENT_HEAD'
    HAVING count(*) = 1;

    IF other_head IS NOT NULL THEN
      UPDATE "BudgetRequest" br
      SET "centralizedHeadId" = other_head
      FROM "ExpenseLineItem" eli
      WHERE eli.id = br."expenseLineItemId" AND eli."ownerDepartmentId" = dept.id
        AND br."centralizedHeadId" = jen_id
        AND br."currentStage" IN ('DRAFT', 'RETURNED_TO_REQUESTOR', 'DEPT_HEAD_REVIEW', 'CFO_APPROVAL', 'CENTRALIZED_L1_REVIEW', 'CENTRALIZED_HEAD_REVIEW');
      UPDATE "BudgetRequest" br
      SET "assigneeId" = other_head
      FROM "ExpenseLineItem" eli
      WHERE eli.id = br."expenseLineItemId" AND eli."ownerDepartmentId" = dept.id
        AND br."currentStage" = 'CENTRALIZED_HEAD_REVIEW' AND br."assigneeId" = jen_id;
    END IF;

    UPDATE "BudgetRequest" br
    SET "centralizedHead2Review" = true
    FROM "ExpenseLineItem" eli
    WHERE eli.id = br."expenseLineItemId" AND eli."ownerDepartmentId" = dept.id
      AND br."requestCategory" = 'GAE'
      AND br."currentStage" IN ('DEPT_HEAD_REVIEW', 'CFO_APPROVAL', 'CENTRALIZED_L1_REVIEW', 'CENTRALIZED_HEAD_REVIEW');
  END LOOP;
END $$;
