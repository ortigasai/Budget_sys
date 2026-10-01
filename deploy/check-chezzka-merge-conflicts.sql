-- Read-only pre-merge check for merge-duplicate-chezzka-user.sql. Run this
-- FIRST - if both conflict queries return zero rows, the merge is safe.

-- Confirms both accounts actually exist on this database and shows their
-- current roles/employeeIdNumber, for a sanity check before merging.
SELECT email, name, "employeeIdNumber", "departmentId" FROM "User"
WHERE email IN ('padillacsp@ortigas.com.ph', 'chezzkasheen.padillaballungay@ortigas.com.ph');

-- CONFLICT CHECK 1: RoleAssignment is unique on (departmentId, roleType,
-- userId) - conflict only if the real account already holds the SAME role
-- in the SAME department the ghost account also holds.
SELECT a."departmentId", a."roleType"
FROM "RoleAssignment" a
JOIN "RoleAssignment" b ON a."departmentId" = b."departmentId" AND a."roleType" = b."roleType"
WHERE a."userId" = (SELECT id FROM "User" WHERE email = 'padillacsp@ortigas.com.ph')
  AND b."userId" = (SELECT id FROM "User" WHERE email = 'chezzkasheen.padillaballungay@ortigas.com.ph');

-- CONFLICT CHECK 2: UserGroupMembership is unique on (userId, group,
-- scope) - conflict only if the real account already has the SAME
-- group+scope membership the ghost account also has.
SELECT a."group", a."scope"
FROM "UserGroupMembership" a
JOIN "UserGroupMembership" b ON a."group" = b."group" AND a."scope" = b."scope"
WHERE a."userId" = (SELECT id FROM "User" WHERE email = 'padillacsp@ortigas.com.ph')
  AND b."userId" = (SELECT id FROM "User" WHERE email = 'chezzkasheen.padillaballungay@ortigas.com.ph');
