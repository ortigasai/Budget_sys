import { Router } from "express";
import { prisma } from "../prisma";

export const authRouter = Router();

// Demo mode: list all seeded users with their role assignments so the
// frontend can render a "log in as" switcher. No password involved.
authRouter.get("/users", async (_req, res) => {
  const users = await prisma.user.findMany({
    include: {
      department: true,
      roleAssignments: { include: { department: true } },
    },
    orderBy: { name: "asc" },
  });

  res.json(
    users.map((u) => ({
      id: u.id,
      name: u.name,
      email: u.email,
      department: u.department ? { id: u.department.id, name: u.department.name } : null,
      roles: u.roleAssignments.map((r) => ({
        roleType: r.roleType,
        department: { id: r.department.id, name: r.department.name },
      })),
    }))
  );
});

authRouter.get("/me", async (req, res) => {
  if (!req.user) {
    res.status(401).json({ error: "No user selected." });
    return;
  }
  res.json(req.user);
});
