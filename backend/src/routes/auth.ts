import { Router } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { z } from "zod";
import { prisma } from "../prisma";
import { JWT_SECRET } from "../middleware/auth";
import { computeAccess, getEffectiveMatrix } from "../lib/accessControl";
import { exchangeSsoCode, loginMethods, ssoAuthorizeUrl } from "../lib/sso";
import { canonicalDepartmentName } from "../lib/departmentAliases";
import { Prisma } from "@prisma/client";
import { asyncHandler } from "../asyncHandler";
import { HttpError } from "../httpError";

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

  // Password / quick login are switched off where only SSO is allowed
  // (LOGIN_METHODS=sso on the server). Quick login uses this same route.
  const methods = loginMethods();
  if (!methods.includes("password") && !methods.includes("quick")) {
    res.status(403).json({ error: "Sign in with Microsoft 365." });
    return;
  }

  const user = await findUserForLogin(email);
  if (!user || !user.passwordHash || !(await bcrypt.compare(password, user.passwordHash))) {
    res.status(401).json({ error: "Invalid email or password." });
    return;
  }

  res.json(await loginResponse(user));
});

const loginUserInclude = { department: true, roleAssignments: { include: { department: true } }, sbuRoleAssignments: true, groupMemberships: true } as const;

async function findUserForLogin(email: string) {
  return prisma.user.findFirst({
    where: { email: { equals: email.trim(), mode: "insensitive" } },
    include: loginUserInclude,
  });
}

// Same response for every way of logging in: a JWT (sub = user id) that
// both backends verify, plus the user's profile.
async function loginResponse(user: NonNullable<Awaited<ReturnType<typeof findUserForLogin>>>) {
  const token = jwt.sign({ sub: user.id }, JWT_SECRET, { expiresIn: "12h" });
  return {
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
  };
}

// ---- Login page options + Microsoft 365 sign-in (lib/sso.ts) ----
authRouter.get("/config", (_req, res) => {
  res.json({ methods: loginMethods() });
});

// Where to send the browser to start Microsoft sign-in. `state` is made and
// kept by the browser, and checked again when it comes back.
authRouter.get(
  "/sso/start",
  asyncHandler(async (req, res) => {
    if (!loginMethods().includes("sso")) throw new HttpError(403, "Microsoft sign-in isn't enabled here.");
    const redirectUri = String(req.query.redirectUri ?? "");
    const state = String(req.query.state ?? "");
    if (!/^[A-Za-z0-9_-]{16,128}$/.test(state)) throw new HttpError(400, "Invalid sign-in state.");
    res.json({ url: ssoAuthorizeUrl(redirectUri, state) });
  })
);

// The callback page posts the broker's `code` here. Signs in the account
// whose email matches; with no account, returns the Microsoft identity so the
// login page can open "Request access" with it filled in.
authRouter.post(
  "/sso/callback",
  asyncHandler(async (req, res) => {
    if (!loginMethods().includes("sso")) throw new HttpError(403, "Microsoft sign-in isn't enabled here.");
    const { code } = z.object({ code: z.string().min(1).max(4096) }).parse(req.body ?? {});
    const profile = await exchangeSsoCode(code);
    const user = (await findUserForLogin(profile.email)) ?? (await linkSsoByName(profile)) ?? (await createSsoAccount(profile));
    res.json(await loginResponse(user));
  })
);

// Anyone who can sign in with the organization's Microsoft 365 gets in - no
// Request access step. With no existing account (by email, or by name - see
// linkSsoByName), one is made on first sign-in: their Microsoft email and
// name, their department when Microsoft sends one that matches, no password
// (Microsoft sign-in only) and no roles - the Budget Officer assigns those in
// Admin Console > User Access as usual.
async function createSsoAccount(profile: { email: string; name: string | null; department: string | null }) {
  let departmentId: string | undefined;
  if (profile.department) {
    const department = await prisma.department.findFirst({
      where: { name: { equals: canonicalDepartmentName(profile.department.trim()), mode: "insensitive" } },
      select: { id: true },
    });
    departmentId = department?.id;
  }
  const name = profile.name?.trim() || profile.email.split("@")[0];
  try {
    await prisma.user.create({ data: { email: profile.email, name, departmentId } });
    console.log(`[sso] created an account on first Microsoft sign-in for ${profile.email}${departmentId ? "" : " (no matching department)"}`);
  } catch (err) {
    // Two sign-ins racing on the same new email - the other one made it.
    if (!(err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002")) throw err;
  }
  return (await findUserForLogin(profile.email))!;
}

// Most Employee List accounts were imported without a real email (the roster
// had only ID numbers), so they got a made-up "first.last@ortigas.com.ph"
// that Microsoft never returns - e.g. johnmark.daymiel@ortigas.com.ph vs his
// real daymieljma@capitolcommons.com.ph. When the Microsoft email matches no
// account, fall back to the person's name: if exactly one account in the
// whole system has that name, and it's one of those made-up-email accounts,
// it becomes that person's account - its email is replaced with the
// Microsoft one, so every later sign-in matches by email. Any doubt (no
// name from Microsoft, no match, more than one) makes a new account instead
// (createSsoAccount below).
const nameKey = (name: string) =>
  name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z\s]/g, " ")
    .split(/\s+/)
    // Middle initials and generational suffixes vary between the two lists.
    .filter((t) => t.length > 1 && !["jr", "sr", "ii", "iii", "iv"].includes(t))
    .sort()
    .join(" ");

const hasMadeUpEmail = (u: { email: string; employeeIdNumber: number | null }) =>
  u.employeeIdNumber !== null && /^[a-z0-9]+\.[a-z0-9]+\d*@ortigas\.com\.ph$/i.test(u.email);

async function linkSsoByName(profile: { email: string; name: string | null }) {
  if (!profile.name) {
    console.warn("[sso] no account for the Microsoft email and Microsoft returned no name to match on");
    return null;
  }
  const key = nameKey(profile.name);
  if (!key) return null;
  const all = await prisma.user.findMany({ select: { id: true, name: true, email: true, employeeIdNumber: true } });
  const sameName = all.filter((u) => nameKey(u.name) === key);
  if (sameName.length !== 1 || !hasMadeUpEmail(sameName[0])) {
    console.warn(`[sso] couldn't link a Microsoft sign-in by name (${sameName.length} account(s) with that name)`);
    return null;
  }
  const match = sameName[0];
  await prisma.user.update({ where: { id: match.id }, data: { email: profile.email } });
  console.log(`[sso] linked ${profile.email} to the existing account for ${match.name} (was ${match.email})`);
  return findUserForLogin(profile.email);
}

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
