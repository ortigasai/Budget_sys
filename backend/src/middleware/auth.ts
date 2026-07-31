import { NextFunction, Request, Response } from "express";
import { RoleType } from "@prisma/client";
import { prisma } from "../prisma";

export interface AuthedUser {
  id: string;
  name: string;
  email: string;
  departmentId: string | null;
  roles: { roleType: RoleType; departmentId: string }[];
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthedUser;
    }
  }
}

/**
 * Demo-mode auth: the frontend's role switcher sends the selected user's id
 * as `x-user-id` on every request. There is no password check. This is a
 * stand-in for real authentication and must not be used as-is in production.
 */
export async function resolveUser(req: Request, _res: Response, next: NextFunction) {
  const userId = req.header("x-user-id");
  if (!userId) {
    next();
    return;
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { roleAssignments: true },
  });

  if (user) {
    req.user = {
      id: user.id,
      name: user.name,
      email: user.email,
      departmentId: user.departmentId,
      roles: user.roleAssignments.map((r) => ({ roleType: r.roleType, departmentId: r.departmentId })),
    };
  }

  next();
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.user) {
    res.status(401).json({ error: "Authentication required. Select a demo user first." });
    return;
  }
  next();
}

export function hasRole(user: AuthedUser | undefined, roleType: RoleType, departmentId?: string): boolean {
  if (!user) return false;
  return user.roles.some(
    (r) => r.roleType === roleType && (departmentId === undefined || r.departmentId === departmentId)
  );
}

/**
 * Guards a route to users holding at least one of the given role types,
 * anywhere (department-scoped checks are done inside the route handler where
 * the relevant department id is known, e.g. the request being reviewed).
 */
export function requireRole(...roleTypes: RoleType[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      res.status(401).json({ error: "Authentication required." });
      return;
    }
    const ok = req.user.roles.some((r) => roleTypes.includes(r.roleType));
    if (!ok) {
      res.status(403).json({ error: "You do not hold a role permitted to perform this action." });
      return;
    }
    next();
  };
}
