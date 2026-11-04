import { Router } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { z } from "zod";
import { prisma } from "../prisma";
import { JWT_SECRET } from "../middleware/auth";
import { computeAccess, getEffectiveMatrix } from "../lib/accessControl";

// No group membership at all (e.g. accounts not listed in the User Management
// workbook) => access is null, which the frontend/route guards treat as "not
// group-restricted" so existing users are never locked out by the new layer.
async function groupsAndAccess(memberships: { group: string; scope: string }[]) {
  const groups = memberships.map((m) => ({ group: m.group, scope: m.scope }));
  return { groups, access: groups.length > 0 ? computeAccess(groups.map((g) => g.group), await getEffectiveMatrix()) : null };
}

export const authRouter = Router();

// Lists all seeded users with their role assignments - used by the
// Username SearchableSelect pickers elsewhere in the app (e.g. Admin
// Console's Role Assignments tab). No longer used for logging in directly
// (see POST /login below).
authRouter.get("/users", async (_req, res) => {
  const users = await prisma.user.findMany({
    include: {
      department: true,
      roleAssignments: { include: { department: true } },
      sbuRoleAssignments: true,
      groupMemberships: true,
    },
    orderBy: { name: "asc" },
  });

  const matrix = await getEffectiveMatrix();
  // Accounts created by approving a login-page access request.
  const approvedRequestUserIds = new Set(
    (await prisma.accessRequest.findMany({ where: { status: "APPROVED", createdUserId: { not: null } }, select: { createdUserId: true } })).map((r) => r.createdUserId)
  );
  res.json(
    users.map((u) => ({
      id: u.id,
      name: u.name,
      email: u.email,
      // True for people on the Employee List or approved through Access
      // Requests (vs. accounts created only from other workbooks) - the
      // quick-login picker lists these.
      isEmployee: u.employeeIdNumber !== null || approvedRequestUserIds.has(u.id),
      department: u.department ? { id: u.department.id, name: u.department.name, sbu: u.department.sbu } : null,
      groups: u.groupMemberships.map((m) => ({ group: m.group, scope: m.scope })),
      access: u.groupMemberships.length > 0 ? computeAccess(u.groupMemberships.map((m) => m.group), matrix) : null,
      roles: [
        ...u.roleAssignments.map((r) => ({
          roleType: r.roleType,
          department: { id: r.department.id, name: r.department.name },
        })),
        ...u.sbuRoleAssignments.map((r) => ({ roleType: r.roleType, sbu: r.sbu })),
      ],
    }))
  );
});

const loginSchema = z.object({ email: z.string().email(), password: z.string().min(1) });

// Notes_6 ("Log in account - revise"): real email+password login, replacing
// the old "pick a user from a list" switcher. Every user shares one bcrypt
// hash of the notes' testing password ("Ortigas12345") - this is explicitly
// a testing-only credential, not meant to be production-secure. On success
// this signs a JWT (sub = user id) that both this backend's resolveUser
// middleware and backend-py verify with the same JWT_SECRET - the frontend
// sends it as `Authorization: Bearer <token>` on every subsequent request to
// either backend.
authRouter.post("/login", async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Enter a valid email and password." });
    return;
  }
  const { email, password } = parsed.data;

  const user = await prisma.user.findUnique({
    where: { email: email.trim().toLowerCase() },
    include: { department: true, roleAssignments: { include: { department: true } }, sbuRoleAssignments: true, groupMemberships: true },
  });

  if (!user || !user.passwordHash || !(await bcrypt.compare(password, user.passwordHash))) {
    res.status(401).json({ error: "Invalid email or password." });
    return;
  }

  const token = jwt.sign({ sub: user.id }, JWT_SECRET, { expiresIn: "12h" });

  res.json({
    token,
    id: user.id,
    name: user.name,
    email: user.email,
    department: user.department ? { id: user.department.id, name: user.department.name, sbu: user.department.sbu } : null,
    ...(await groupsAndAccess(user.groupMemberships)),
    roles: [
      ...user.roleAssignments.map((r) => ({
        roleType: r.roleType,
        department: { id: r.department.id, name: r.department.name },
      })),
      ...user.sbuRoleAssignments.map((r) => ({ roleType: r.roleType, sbu: r.sbu })),
    ],
  });
});

// ---- Login page > "Request access" (no login needed) ----
// Department dropdown for the request form - names only.
authRouter.get("/departments", async (_req, res) => {
  const departments = await prisma.department.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } });
  res.json(departments);
});

const accessRequestSchema = z.object({
  requestFor: z.enum(["SELF", "OTHER"]),
  // Required when requesting for another user (checked below).
  requesterName: z.string().trim().max(200).optional().nullable(),
  email: z.string().trim().toLowerCase().email("Enter a valid email."),
  firstName: z.string({ required_error: "Enter the first name." }).trim().min(1, "Enter the first name.").max(100),
  // Optional - not everyone has one. Stored without the period ("M").
  middleInitial: z
    .string()
    .optional()
    .nullable()
    .transform((v) => (v ?? "").replace(/[.\s]/g, "").toUpperCase() || null)
    .refine((v) => v === null || v.length <= 3, "Middle initial should be at most 3 letters."),
  lastName: z.string({ required_error: "Enter the surname." }).trim().min(1, "Enter the surname.").max(100),
  username: z.string({ required_error: "Enter a username." }).trim().min(1, "Enter a username.").max(200),
  departmentId: z.string().min(1, "Choose a department."),
});

// Lands in Admin Console > Access Requests for the Budget Officer to approve
// or disapprove.
authRouter.post("/access-requests", async (req, res) => {
  const parsed = accessRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Check the form and try again." });
    return;
  }
  const { requestFor, email, firstName, middleInitial, lastName, username, departmentId } = parsed.data;
  const requesterName = requestFor === "OTHER" ? parsed.data.requesterName || null : null;
  if (requestFor === "OTHER" && !requesterName) {
    res.status(400).json({ error: "Enter your name." });
    return;
  }

  const department = await prisma.department.findUnique({ where: { id: departmentId } });
  if (!department) {
    res.status(400).json({ error: "Choose a department." });
    return;
  }
  if (await prisma.user.findUnique({ where: { email } })) {
    res.status(409).json({ error: `${email} already has access to the Budgeting System.` });
    return;
  }
  if (await prisma.accessRequest.findFirst({ where: { email, status: "PENDING" } })) {
    res.status(409).json({ error: `There is already a pending access request for ${email}.` });
    return;
  }

  const created = await prisma.accessRequest.create({
    data: { requestFor, requesterName, email, firstName, middleInitial, lastName, username, departmentId },
  });
  res.status(201).json({ id: created.id });
});

authRouter.get("/me", async (req, res) => {
  if (!req.user) {
    res.status(401).json({ error: "No user selected." });
    return;
  }
  res.json(req.user);
});
