-- John Mark A. Daymiel's account was imported with a made-up email
-- (johnmark.daymiel@ortigas.com.ph); Microsoft 365 signs him in as
-- daymieljma@capitolcommons.com.ph, so his sign-in matched no account and
-- landed on Request access. Point his account at his real email. Does nothing
-- if it was already changed or that email is already in use.
UPDATE "User"
SET "email" = 'daymieljma@capitolcommons.com.ph'
WHERE "email" = 'johnmark.daymiel@ortigas.com.ph'
  AND NOT EXISTS (SELECT 1 FROM "User" WHERE lower("email") = 'daymieljma@capitolcommons.com.ph');
