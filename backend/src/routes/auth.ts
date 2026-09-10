import { Router } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { z } from "zod";
import { prisma } from "../prisma";
import { JWT_SECRET } from "../middleware/auth";

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
    },
    orderBy: { name: "asc" },
  });

  res.json(
    users.map((u) => ({
      id: u.id,
      name: u.name,
      email: u.email,
      department: u.department ? { id: u.department.id, name: u.department.name, sbu: u.department.sbu } : null,
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
    include: { department: true, roleAssignments: { include: { department: true } }, sbuRoleAssignments: true },
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
    roles: [
      ...user.roleAssignments.map((r) => ({
        roleType: r.roleType,
        department: { id: r.department.id, name: r.department.name },
      })),
      ...user.sbuRoleAssignments.map((r) => ({ roleType: r.roleType, sbu: r.sbu })),
    ],
  });
});

authRouter.get("/me", async (req, res) => {
  if (!req.user) {
    res.status(401).json({ error: "No user selected." });
    return;
  }
  res.json(req.user);
});
