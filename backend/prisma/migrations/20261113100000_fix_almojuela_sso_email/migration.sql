-- Maria Jennifer J. Almojuela (Id Number 1806357, Centralized Department
-- Head) was imported as almojuelamjj@ortigas.com.ph, but Microsoft 365 signs
-- her in as almojuelajj@ortigas.com.ph under the name "Jennifer J.
-- Almojuela". Neither the email nor the name matched her account, so her
-- Microsoft sign-in sent her to Request access (and, after Microsoft sign-in
-- started creating accounts, would have made her a second, empty one).
--
-- Point her account at her Microsoft email. If a Microsoft sign-in already
-- created that second account (no Id Number, no roles), its records are
-- moved to her real account and it is deleted first. Does nothing if her
-- account isn't found or the email is held by any other kind of account.
DO $$
DECLARE
  keep_id text;
  dup_id text;
  col record;
BEGIN
  SELECT id INTO keep_id FROM "User" WHERE "employeeIdNumber" = 1806357;
  IF keep_id IS NULL THEN
    RETURN;
  END IF;
  SELECT id INTO dup_id FROM "User" WHERE lower("email") = 'almojuelajj@ortigas.com.ph';
  IF dup_id = keep_id THEN
    RETURN;
  END IF;

  IF dup_id IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM "User" WHERE id = dup_id AND "employeeIdNumber" IS NOT NULL)
       OR EXISTS (SELECT 1 FROM "RoleAssignment" WHERE "userId" = dup_id)
       OR EXISTS (SELECT 1 FROM "SbuRoleAssignment" WHERE "userId" = dup_id) THEN
      RAISE NOTICE 'almojuelajj@ortigas.com.ph belongs to an account with roles or an Id Number - left unchanged';
      RETURN;
    END IF;
    DELETE FROM "UserGroupMembership" WHERE "userId" = dup_id;
    FOR col IN
      SELECT c.table_name, c.column_name
      FROM information_schema.columns c
      JOIN information_schema.tables t
        ON t.table_schema = c.table_schema AND t.table_name = c.table_name AND t.table_type = 'BASE TABLE'
      WHERE c.table_schema = 'public'
        AND c.data_type IN ('text', 'character varying')
        AND c.table_name NOT IN ('User', '_prisma_migrations')
    LOOP
      EXECUTE format('UPDATE %I SET %I = $1 WHERE %I = $2', col.table_name, col.column_name, col.column_name)
        USING keep_id, dup_id;
    END LOOP;
    DELETE FROM "User" WHERE id = dup_id;
  END IF;

  UPDATE "User" SET "email" = 'almojuelajj@ortigas.com.ph' WHERE id = keep_id;
END $$;
