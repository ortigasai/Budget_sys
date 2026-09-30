import { RoleType } from "@prisma/client";
import { prisma } from "../prisma";
import { HttpError } from "../httpError";
import { NPC_GROUP_SCOPE_TO_SBU } from "./npcSbu";
import type { AuthedUser } from "../middleware/auth";

const isBudgetOfficer = (user: AuthedUser) => user.roles.some((r) => r.roleType === RoleType.BUDGET_OFFICER);

/** DOE/Revenue SBUs this user is limited to via their SF (SBU Finance) memberships; null = not limited (Budget Officer, or no SF membership). */
export async function allowedSfSbus(user: AuthedUser): Promise<string[] | null> {
  if (isBudgetOfficer(user)) return null;
  const ms = await prisma.userGroupMembership.findMany({ where: { userId: user.id, group: "SF" } });
  if (ms.length === 0) return null;
  return [...new Set(ms.map((m) => m.scope.toUpperCase()))];
}

/** NPC SBU codes this user is limited to via their NPC-group memberships; null = not limited. */
export async function allowedNpcSbus(user: AuthedUser): Promise<string[] | null> {
  if (isBudgetOfficer(user)) return null;
  const ms = await prisma.userGroupMembership.findMany({ where: { userId: user.id, group: "NPC" } });
  const sbus = ms.map((m) => NPC_GROUP_SCOPE_TO_SBU[m.scope]).filter((v): v is string => Boolean(v));
  return sbus.length > 0 ? [...new Set(sbus)] : null;
}

export async function assertSfSbu(user: AuthedUser, sbu: string) {
  const allowed = await allowedSfSbus(user);
  if (allowed && !allowed.includes(sbu)) throw new HttpError(403, "You can only submit requests for your own SBU.");
}

export async function assertNpcSbu(user: AuthedUser, sbu: string) {
  const allowed = await allowedNpcSbus(user);
  if (allowed && !allowed.includes(sbu)) throw new HttpError(403, "You can only submit requests for your own NPC SBU.");
}
