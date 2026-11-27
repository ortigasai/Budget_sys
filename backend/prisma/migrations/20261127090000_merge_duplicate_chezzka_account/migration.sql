-- Merge Chezzka Sheen's duplicate account (Nov 2026). She has two:
--   - the Employee List account "Chezzka Sheen P. Padilla-Ballungay"
--     (chezzkasheen.padillaballungay@, employee ID, "CD"/Tax group), and
--   - "Chezzka Sheen P Padilla" (padillacsp@), created by the Approval
--     Workflow import because the names didn't match, which holds her Tax
--     reviewer role and is set as the reviewer on Tax's line items.
-- Requests routed to her went to the second account, so they never showed
-- in the Inbox of the account she signs in with. deploy/
-- merge-duplicate-chezzka-user.sql was a manual fix for this that wasn't run
-- everywhere; this applies it on every deploy.
--
-- Same method as 20261105090000_merge_duplicate_user_accounts: keep the
-- Employee List account (and its name), move every reference from the other
-- account onto it (dropping exact duplicates), delete the other account and
-- give the kept one the username-style email. Skipped unless both accounts
-- are present, so it's safe where the manual script already ran.
DO $$
DECLARE
  c RECORD;
  keep_id TEXT;
  dup_id TEXT;
BEGIN
  SELECT id INTO keep_id FROM "User" WHERE email = 'chezzkasheen.padillaballungay@ortigas.com.ph';
  SELECT id INTO dup_id FROM "User" WHERE email = 'padillacsp@ortigas.com.ph';
  IF keep_id IS NULL OR dup_id IS NULL OR keep_id = dup_id THEN
    RETURN;
  END IF;

  DELETE FROM "RoleAssignment" d USING "RoleAssignment" k
    WHERE d."userId" = dup_id AND k."userId" = keep_id
      AND k."departmentId" = d."departmentId" AND k."roleType" = d."roleType";
  DELETE FROM "SbuRoleAssignment" d USING "SbuRoleAssignment" k
    WHERE d."userId" = dup_id AND k."userId" = keep_id
      AND k.sbu = d.sbu AND k."roleType" = d."roleType";
  DELETE FROM "UserGroupMembership" d USING "UserGroupMembership" k
    WHERE d."userId" = dup_id AND k."userId" = keep_id
      AND k."group" = d."group" AND k.scope = d.scope;

  -- Every other reference (foreign keys and loose approver / reviewer /
  -- assignee columns, in both backends' tables).
  FOR c IN
    SELECT table_name, column_name FROM information_schema.columns
    WHERE table_schema = 'public' AND data_type IN ('text', 'character varying')
      AND NOT (table_name = 'User' AND column_name = 'id')
  LOOP
    EXECUTE format('UPDATE %I SET %I = $1 WHERE %I = $2', c.table_name, c.column_name, c.column_name)
      USING keep_id, dup_id;
  END LOOP;

  DELETE FROM "User" WHERE id = dup_id;
  UPDATE "User" SET email = 'padillacsp@ortigas.com.ph' WHERE id = keep_id;
END $$;
