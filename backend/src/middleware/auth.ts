import { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { RoleType, Sbu } from "@prisma/client";
import { prisma } from "../prisma";

// Shared with backend-py (same env var name, same value) so a token signed
// by this backend's POST /auth/login is verifiable by both services.
export const JWT_SECRET: string = (() => {
  const value = process.env.JWT_SECRET;
  if (!value) throw new Error("JWT_SECRET is not set - check backend/.env");
  return value;
})();

export interface AuthedUser {
  id: string;
  name: string;
  email: string;
  departmentId: string | null;
  // Phase 3's BU_FINANCE_HEAD/BU_HEAD/BU_FINANCE_OFFICER are SBU-scoped
  // rather than department-scoped - department is null and sbu is set for
  // those, the reverse for every other (department-scoped) role.
  roles: { roleType: RoleType; departmentId: string | null; sbu?: Sbu }[];
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
 * The frontend authenticates once via POST /auth/login (real email+password
 * check against a bcrypt hash - see authRouter), which returns a JWT. Every
 * subsequent request sends that token as `Authorization: Bearer <token>`.
 * This middleware verifies the token's signature (proving it was actually
 * issued by our own /auth/login, not just claimed by the client) and trusts
 * its `sub` claim as the user id - the same shared secret is verified by
 * backend-py, so a token issued here is valid there too.
 */
export async function resolveUser(req: Request, _res: Response, next: NextFunction) {
  const header = req.header("authorization");
  const token = header?.startsWith("Bearer ") ? header.slice("Bearer ".length) : null;
  if (!token) {
    next();
    return;
  }

  let userId: string;
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    if (typeof payload !== "object" || typeof payload.sub !== "string") {
      next();
      return;
    }
    userId = payload.sub;
  } catch {
    // Expired or invalid token - treat as unauthenticated rather than erroring,
    // same as a missing header did before; requireAuth/requireRole then reject
    // the request with a proper 401/403 for routes that need a user.
    next();
    return;
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { roleAssignments: true, sbuRoleAssignments: true },
  });

  if (user) {
    req.user = {
      id: user.id,
      name: user.name,
      email: user.email,
      departmentId: user.departmentId,
      roles: [
        ...user.roleAssignments.map((r) => ({ roleType: r.roleType, departmentId: r.departmentId as string | null })),
        ...user.sbuRoleAssignments.map((r) => ({ roleType: r.roleType, departmentId: null, sbu: r.sbu })),
      ],
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

export function hasSbuRole(user: AuthedUser | undefined, roleType: RoleType, sbu?: Sbu): boolean {
  if (!user) return false;
  return user.roles.some((r) => r.roleType === roleType && (sbu === undefined || r.sbu === sbu));
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
