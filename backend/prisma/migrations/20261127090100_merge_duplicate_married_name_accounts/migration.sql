-- Merge two more duplicate accounts (Nov 2026), split the same way as
-- Chezzka Sheen's (20261127090000): the User Management workbook account
-- uses the maiden surname, the Employee List account the married one, so
-- they weren't matched and the access groups landed on the workbook account.
--   - Justine Alexandra M. Papa  / Justine Alexandra Machica (Finance - Property)
--   - Martha Kristina N. Serquiña / Martha Kristina Navarro   (Sales HR)
--
-- Same method as 20261105090000_merge_duplicate_user_accounts: keep the
-- Employee List account (and its name), move every reference from the other
-- account onto it (dropping exact duplicates), delete the other account and
-- give the kept one the username-style email. A pair whose accounts aren't
-- both present is skipped (safe to re-run).
CREATE TEMP TABLE merge_user_pairs (keep_email TEXT, dup_email TEXT, final_email TEXT);
INSERT INTO merge_user_pairs (keep_email, dup_email, final_email) VALUES
  ('justinealexandra.papa@ortigas.com.ph', 'machicajag@ortigas.com.ph', 'machicajag@ortigas.com.ph'),  -- Justine Alexandra M. Papa
  ('marthakristina.serquina@ortigas.com.ph', 'navarromkb@ortigas.com.ph', 'navarromkb@ortigas.com.ph')  -- Martha Kristina N. Serquiña
;

DO $$
DECLARE
  p RECORD;
  c RECORD;
  keep_id TEXT;
  dup_id TEXT;
BEGIN
  FOR p IN SELECT * FROM merge_user_pairs LOOP
    SELECT id INTO keep_id FROM "User" WHERE email = p.keep_email;
    SELECT id INTO dup_id FROM "User" WHERE email = p.dup_email;
    IF keep_id IS NULL OR dup_id IS NULL OR keep_id = dup_id THEN
      CONTINUE;
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

    FOR c IN
      SELECT table_name, column_name FROM information_schema.columns
      WHERE table_schema = 'public' AND data_type IN ('text', 'character varying')
        AND NOT (table_name = 'User' AND column_name = 'id')
    LOOP
      EXECUTE format('UPDATE %I SET %I = $1 WHERE %I = $2', c.table_name, c.column_name, c.column_name)
        USING keep_id, dup_id;
    END LOOP;

    DELETE FROM "User" WHERE id = dup_id;
    UPDATE "User" SET email = p.final_email WHERE id = keep_id;
  END LOOP;
END $$;

DROP TABLE merge_user_pairs;
