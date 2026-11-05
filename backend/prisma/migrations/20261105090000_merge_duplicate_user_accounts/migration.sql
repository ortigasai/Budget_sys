-- Merge duplicate user accounts (Nov 2026). 55 people had two accounts:
--   - the Employee List account (employee ID, email like first.last@, name
--     with periods, e.g. "Reggie T. Acbang"), and
--   - a User Management workbook account (no employee ID, username email
--     like acbangrt@, e.g. "Reggie T Acbang"),
-- with their roles / access groups split between the two.
--
-- For each pair below: keep the Employee List account (and its name), move
-- every reference to the other account onto it, delete the other account,
-- and give the kept account the username-style email. Two workbook emails
-- were malformed and are corrected ("dela reajpm@" -> "delareajpm@",
-- "sueñolfs@" -> "suenolfs@").
--
-- Pairs are looked up by email, so ids don't matter; a pair whose accounts
-- aren't both present is skipped (safe to re-run).
CREATE TEMP TABLE merge_user_pairs (keep_email TEXT, dup_email TEXT, final_email TEXT);
INSERT INTO merge_user_pairs (keep_email, dup_email, final_email) VALUES
  ('alaiza.enriquez@ortigas.com.ph', 'enriquezab@ortigas.com.ph', 'enriquezab@ortigas.com.ph'),  -- Alaiza B. Enriquez
  ('alben.corpin@ortigas.com.ph', 'corpinag@ortigas.com.ph', 'corpinag@ortigas.com.ph'),  -- Alben G. Corpin
  ('albertineellen.jimenez@ortigas.com.ph', 'jimenezaer@ortigas.com.ph', 'jimenezaer@ortigas.com.ph'),  -- Albertine Ellen R. Jimenez
  ('aldwin.cabatay@ortigas.com.ph', 'cabatayad@ortigas.com.ph', 'cabatayad@ortigas.com.ph'),  -- Aldwin D. Cabatay
  ('alona.agustin@ortigas.com.ph', 'agustinac@ortigas.com.ph', 'agustinac@ortigas.com.ph'),  -- Alona C. Agustin
  ('andrearomina.macasero@ortigas.com.ph', 'macaseroarc@ortigas.com.ph', 'macaseroarc@ortigas.com.ph'),  -- Andrea Romina C. Macasero
  ('benedictnicholas.sandejas@ortigas.com.ph', 'sandejasbna@ortigas.com.ph', 'sandejasbna@ortigas.com.ph'),  -- Benedict Nicholas A. Sandejas
  ('betsy.macaraeg@ortigas.com.ph', 'macaraegbc@ortigas.com.ph', 'macaraegbc@ortigas.com.ph'),  -- Betsy C. Macaraeg
  ('carolina.tenedero@ortigas.com.ph', 'tenederocc@ortigas.com.ph', 'tenederocc@ortigas.com.ph'),  -- Carolina C. Tenedero
  ('ceasar.buenaventura@ortigas.com.ph', 'buenaventuracd@ortigas.com.ph', 'buenaventuracd@ortigas.com.ph'),  -- Ceasar D. Buenaventura
  ('charleneangeli.jose@ortigas.com.ph', 'josecah@ortigas.com.ph', 'josecah@ortigas.com.ph'),  -- Charlene Angeli H. Jose
  ('chasty.villamin@ortigas.com.ph', 'villaminca@ortigas.com.ph', 'villaminca@ortigas.com.ph'),  -- Chasty A. Villamin
  ('cheryl.panganiban@ortigas.com.ph', 'panganibancj@ortigas.com.ph', 'panganibancj@ortigas.com.ph'),  -- Cheryl J. Panganiban
  ('daisy.abendanio@ortigas.com.ph', 'abendaniod@ortigas.com.ph', 'abendaniod@ortigas.com.ph'),  -- Daisy Abendanio
  ('davee.zuniga@ortigas.com.ph', 'zunigadm@ortigas.com.ph', 'zunigadm@ortigas.com.ph'),  -- Davee M. Zuñiga
  ('eleonor.honra@ortigas.com.ph', 'honraef@ortigas.com.ph', 'honraef@ortigas.com.ph'),  -- Eleonor F. Honra
  ('eliasisagani.elacio@ortigas.com.ph', 'elacioeia@ortigas.com.ph', 'elacioeia@ortigas.com.ph'),  -- Elias Isagani A. Elacio
  ('gamayca.casem@ortigas.com.ph', 'casemgq@ortigas.com.ph', 'casemgq@ortigas.com.ph'),  -- Gamayca Q. Casem
  ('jamespaul.delarea@ortigas.com.ph', 'dela reajpm@ortigas.com.ph', 'delareajpm@ortigas.com.ph'),  -- James Paul M. Dela Rea
  ('janeenaariellemarie.lansangan@ortigas.com.ph', 'lansanganjamm@ortigas.com.ph', 'lansanganjamm@ortigas.com.ph'),  -- Janeena Arielle Marie M. Lansangan
  ('jazminnejoy.pante@ortigas.com.ph', 'pantejjb@ortigas.com.ph', 'pantejjb@ortigas.com.ph'),  -- Jazminne Joy B. Pante
  ('jean.leonor@ortigas.com.ph', 'leonorjd@ortigas.com.ph', 'leonorjd@ortigas.com.ph'),  -- Jean D. Leonor
  ('jennifer.vallecera@ortigas.com.ph', 'valleceraje@ortigas.com.ph', 'valleceraje@ortigas.com.ph'),  -- Jennifer E. Vallecera
  ('jercee.selda@ortigas.com.ph', 'seldajp@capitolcommons.com.ph', 'seldajp@capitolcommons.com.ph'),  -- Jercee P. Selda
  ('johncarmelo.ledesma@ortigas.com.ph', 'ledesmajcl@ortigas.com.ph', 'ledesmajcl@ortigas.com.ph'),  -- John Carmelo L. Ledesma
  ('joseantonioiii.evangelista@ortigas.com.ph', 'evangelistajaiv@ortigas.com.ph', 'evangelistajaiv@ortigas.com.ph'),  -- Jose Antonio III V. Evangelista
  ('joseclydeevans.solemne@ortigas.com.ph', 'solemnejcep@ortigas.com.ph', 'solemnejcep@ortigas.com.ph'),  -- Jose Clyde Evans P. Solemne
  ('joseemmanuel.jalandoni@ortigas.com.ph', 'jalandonijeh@ortigas.com.ph', 'jalandonijeh@ortigas.com.ph'),  -- Jose Emmanuel H. Jalandoni
  ('justinebianca.lagman@ortigas.com.ph', 'lagmanjbb@ortigas.com.ph', 'lagmanjbb@ortigas.com.ph'),  -- Justine Bianca B. Lagman
  ('kenry.navarro@ortigas.com.ph', 'navarrokf@ortigas.com.ph', 'navarrokf@ortigas.com.ph'),  -- Kenry F. Navarro
  ('kristinemae.villegas@ortigas.com.ph', 'villegaskmp@ortigas.com.ph', 'villegaskmp@ortigas.com.ph'),  -- Kristine Mae P. Villegas
  ('kristinemay.alcantara@ortigas.com.ph', 'alcantarakmo@ortigas.com.ph', 'alcantarakmo@ortigas.com.ph'),  -- Kristine May O. Alcantara
  ('laarnimae.tapang@ortigas.com.ph', 'tapanglmg@ortigas.com.ph', 'tapanglmg@ortigas.com.ph'),  -- Laarni Mae G. Tapang
  ('leafatima.sueno@ortigas.com.ph', 'sueñolfs@ortigas.com.ph', 'suenolfs@ortigas.com.ph'),  -- Lea Fatima S. Sueño
  ('makaren.caparas@ortigas.com.ph', 'caparasmki@ortigas.com.ph', 'caparasmki@ortigas.com.ph'),  -- Ma. Karen I. Caparas
  ('mailyn.esperano@ortigas.com.ph', 'esperanomc@ortigas.com.ph', 'esperanomc@ortigas.com.ph'),  -- Mailyn C. Esperano
  ('mariajasmin.badilla@ortigas.com.ph', 'badillamjj@ortigas.com.ph', 'badillamjj@ortigas.com.ph'),  -- Maria Jasmin J. Badilla
  ('mariajennifer.almojuela@ortigas.com.ph', 'almojuelamjj@ortigas.com.ph', 'almojuelamjj@ortigas.com.ph'),  -- Maria Jennifer J. Almojuela
  ('marife.blaquera@ortigas.com.ph', 'blaqueramc@ortigas.com.ph', 'blaqueramc@ortigas.com.ph'),  -- Marife C. Blaquera
  ('markchristian.gotos@ortigas.com.ph', 'gotosmcr@ortigas.com.ph', 'gotosmcr@ortigas.com.ph'),  -- Mark Christian R. Gotos
  ('markraven.alsola@ortigas.com.ph', 'alsolamrn@capitolcommons.com.ph', 'alsolamrn@capitolcommons.com.ph'),  -- Mark Raven N. Alsola
  ('marybeth.monis@ortigas.com.ph', 'monismg@ortigas.com.ph', 'monismg@ortigas.com.ph'),  -- Marybeth G. Monis
  ('naisa.reyes@ortigas.com.ph', 'reyesns@ortigas.com.ph', 'reyesns@ortigas.com.ph'),  -- Naisa S. Reyes
  ('priscilla.magabilin@ortigas.com.ph', 'magabilinpr@ortigas.com.ph', 'magabilinpr@ortigas.com.ph'),  -- Priscilla R. Magabilin
  ('queneeann.solidum@ortigas.com.ph', 'solidumqal@ortigas.com.ph', 'solidumqal@ortigas.com.ph'),  -- Quenee Ann L. Solidum
  ('raymond.santos@ortigas.com.ph', 'santosrm@ortigas.com.ph', 'santosrm@ortigas.com.ph'),  -- Raymond M. Santos
  ('reggie.acbang@ortigas.com.ph', 'acbangrt@ortigas.com.ph', 'acbangrt@ortigas.com.ph'),  -- Reggie T. Acbang
  ('reniel.matining@ortigas.com.ph', 'matiningrf@capitolcommons.com.ph', 'matiningrf@capitolcommons.com.ph'),  -- Reñiel F. Matining
  ('reyharold.quijano@ortigas.com.ph', 'quijanorhc@ortigas.com.ph', 'quijanorhc@ortigas.com.ph'),  -- Rey Harold C. Quijano
  ('rhiza.deocariza@ortigas.com.ph', 'deocarizarb@ortigas.com.ph', 'deocarizarb@ortigas.com.ph'),  -- Rhiza B. Deocariza
  ('rodolfo.lansangan@ortigas.com.ph', 'lansanganrv@ortigas.com.ph', 'lansanganrv@ortigas.com.ph'),  -- Rodolfo V. Lansangan
  ('ronilo.quiat@ortigas.com.ph', 'quiatrb@ortigas.com.ph', 'quiatrb@ortigas.com.ph'),  -- Ronilo B. Quiat
  ('roselda.gonzales@ortigas.com.ph', 'gonzalesrd@ortigas.com.ph', 'gonzalesrd@ortigas.com.ph'),  -- Roselda D. Gonzales
  ('sharieanne.tabilin@ortigas.com.ph', 'tabilinsa@ortigas.com.ph', 'tabilinsa@ortigas.com.ph'),  -- Sharieanne A. Tabilin
  ('william.simacon@ortigas.com.ph', 'simaconwm@ortigas.com.ph', 'simaconwm@ortigas.com.ph')  -- William M. Simacon
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

    -- Rows the kept account already has (unique per user) - drop the copy.
    DELETE FROM "RoleAssignment" d USING "RoleAssignment" k
      WHERE d."userId" = dup_id AND k."userId" = keep_id
        AND k."departmentId" = d."departmentId" AND k."roleType" = d."roleType";
    DELETE FROM "SbuRoleAssignment" d USING "SbuRoleAssignment" k
      WHERE d."userId" = dup_id AND k."userId" = keep_id
        AND k.sbu = d.sbu AND k."roleType" = d."roleType";
    DELETE FROM "UserGroupMembership" d USING "UserGroupMembership" k
      WHERE d."userId" = dup_id AND k."userId" = keep_id
        AND k."group" = d."group" AND k.scope = d.scope;

    -- Every other reference: user ids are cuids, so any text column holding
    -- exactly the extra account's id is a reference to it (foreign keys and
    -- loose ones like approver / reviewer / "updated by" columns, in both
    -- backends' tables).
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
