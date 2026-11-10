-- Remove the "Bea Officer" demo account (budget.officer@ortigas.com.ph) that
-- prisma/seed.ts created as a stand-in Budget Officer. It showed up as a
-- pending Budget Officer Validation reviewer beside the real one, Princess
-- Vera P. Jumalon (jumalonpvp@ortigas.com.ph).
--
-- Bea's own role assignments are dropped; every other reference to Bea's user
-- id (records seeded "by" Bea - line items' managedBy, growth-rate edits and
-- audit rows, a board-approved budget, roles Bea assigned) is moved to
-- Princess, then the account is deleted. Does nothing if Bea is already gone.
DO $$
DECLARE
  bea_id text;
  princess_id text;
  col record;
BEGIN
  SELECT id INTO bea_id FROM "User" WHERE email = 'budget.officer@ortigas.com.ph';
  IF bea_id IS NULL THEN
    RETURN;
  END IF;
  SELECT id INTO princess_id FROM "User" WHERE email = 'jumalonpvp@ortigas.com.ph';
  IF princess_id IS NULL THEN
    RAISE EXCEPTION 'Cannot remove Bea Officer: the Budget Officer account jumalonpvp@ortigas.com.ph to move its records to was not found';
  END IF;

  DELETE FROM "RoleAssignment" WHERE "userId" = bea_id;
  DELETE FROM "SbuRoleAssignment" WHERE "userId" = bea_id;
  DELETE FROM "UserGroupMembership" WHERE "userId" = bea_id;

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
      USING princess_id, bea_id;
  END LOOP;

  DELETE FROM "User" WHERE id = bea_id;
END $$;
