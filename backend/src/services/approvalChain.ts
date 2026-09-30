import { RequestCategory, RequestStage, RoleType, Sbu } from "@prisma/client";
import type { AuthedUser } from "../middleware/auth";

// "Budgeting System_Approval Workflow" - the New Request approval chains.
// Column order in that workbook is the stage order:
//   Requestor -> Department Head (dropdown) -> Centralized Department
//   Requestor -> Centralized Department Head -> Budget Officer Validation ->
//   SBU Finance Validation -> SBU Finance Head -> SBU or Division Head
//   (dropdown) -> Budget Officer Validation -> BCA Head -> BCA Head (1M and
//   above) -> CFO -> CEO -> Budget Officer Review and Upload.
// A request's chain is the subset of those stages its category uses.
//
// Per-user revision: Centralized L1 Review's assignee is automatic - the
// specific person named in "Budgeting System_Expense Line Items" column J
// ("Centralized Dept Requestor/Reviewer") for the request's own line item,
// not a department-wide role lookup. A Centralized Department Requestor
// raising a GAE request for their own department has no Department Head to
// pick either, so their own Submit sends it straight into Centralized L1
// Review - which, for many line items, resolves right back to themselves as
// the manual "forward this to my Centralized Department Head" step.

export const BCA_THRESHOLD = 1_000_000;

// DOE, Commission, Cost of Sales, Depreciation & Amortization, and Interest
// Expense are all the same kind of submission (SBU + Company upload
// template, see routes/doeBatches.ts) and share this identical chain per the
// Approval Workflow file's own matrix rows - Automatic/Automatic SF
// Validation/SF Head, Automatic final Review & Upload, no BCA/CFO/CEO stages.
export const SBU_BATCH_CATEGORIES: RequestCategory[] = [
  RequestCategory.DOE,
  RequestCategory.COMMISSION,
  RequestCategory.COST_OF_SALES,
  RequestCategory.DEPRECIATION_AMORTIZATION,
  RequestCategory.INTEREST_EXPENSE,
];

export interface ChainRequest {
  requestCategory: RequestCategory;
  proposedAmount: number;
  requiresCfoApproval: boolean;
  sbu: Sbu | null;
  npcSbu: string | null;
  departmentId: string;
  departmentHeadId: string | null;
  sbuHeadId: string | null;
  centralizedHeadId: string | null;
  assigneeId: string | null;
  ownDeptInitiated: boolean;
  // Null for the SBU-batch categories (raw Cost Center/GL Account, no
  // catalog line item - see SBU_BATCH_CATEGORIES below). Only ever
  // dereferenced by the GAE-only stages (CENTRALIZED_L1_REVIEW/
  // CENTRALIZED_HEAD_REVIEW), which those categories' chain never includes.
  expenseLineItem: { ownerDepartmentId: string; centralizedReviewerId: string | null } | null;
}

// NPC's 8 SBUs -> the 6-value SBU enum SBU Finance roles are scoped by (the
// three Corporate NPC SBUs all belong to the Corporate SBU).
const NPC_SBU_TO_SBU: Record<string, Sbu> = {
  MALLS: Sbu.MALLS,
  OFFICES: Sbu.OFFICES,
  ESTATES: Sbu.ESTATES,
  RESIDENTIAL: Sbu.RESIDENTIAL,
  LEISURE: Sbu.LEISURE,
  CORPORATE_IT: Sbu.CORPORATE,
  CORPORATE_HR: Sbu.CORPORATE,
  CORPORATE_ADMIN: Sbu.CORPORATE,
};

export function requestSbu(r: Pick<ChainRequest, "sbu" | "npcSbu">): Sbu | null {
  if (r.sbu) return r.sbu;
  return r.npcSbu ? NPC_SBU_TO_SBU[r.npcSbu] ?? null : null;
}

/** The ordered stages after DRAFT for this request (the last is always BUDGET_OFFICER_REVIEW - Finalize & Upload). */
export function chainFor(r: ChainRequest): RequestStage[] {
  const S = RequestStage;
  if (SBU_BATCH_CATEGORIES.includes(r.requestCategory)) {
    return [S.SF_VALIDATION, S.SF_HEAD_REVIEW, S.BUDGET_OFFICER_REVIEW];
  }
  if (r.requestCategory === RequestCategory.NPC) {
    return [S.DEPT_HEAD_REVIEW, S.SF_VALIDATION, S.SF_HEAD_REVIEW, S.SBU_HEAD_REVIEW, S.BUDGET_OFFICER_VALIDATION, S.BCA_HEAD_REVIEW, S.BUDGET_OFFICER_REVIEW];
  }
  // GAE (and anything else on the shared expense chain). No Centralized L1
  // Review stage - a Centralized Department Requestor raising it for their
  // own department has no Department Head to pick either, so their own
  // Submit is what sends it to their Centralized Department Head.
  const chain: RequestStage[] = [];
  if (!r.ownDeptInitiated) chain.push(S.DEPT_HEAD_REVIEW);
  if (r.requiresCfoApproval) chain.push(S.CFO_APPROVAL);
  // Centralized L1 Review is automatic - its assignee is this specific
  // expense line item's own designated Centralized Dept Requestor/Reviewer
  // ("Budgeting System_Expense Line Items" column J), not a department-wide
  // role lookup (see assigneeForStage below).
  chain.push(S.CENTRALIZED_L1_REVIEW, S.CENTRALIZED_HEAD_REVIEW, S.BUDGET_OFFICER_VALIDATION);
  if (r.proposedAmount >= BCA_THRESHOLD) chain.push(S.BCA_HEAD_REVIEW);
  chain.push(S.BUDGET_OFFICER_REVIEW);
  return chain;
}

export function nextStageAfter(r: ChainRequest, stage: RequestStage): RequestStage | null {
  const chain = chainFor(r);
  const i = chain.indexOf(stage);
  return i >= 0 && i + 1 < chain.length ? chain[i + 1] : null;
}

/** Previous stage in the chain; null means "back to the requestor" (DRAFT). */
export function previousStageBefore(r: ChainRequest, stage: RequestStage): RequestStage | null {
  const chain = chainFor(r);
  const i = chain.indexOf(stage);
  return i > 0 ? chain[i - 1] : null;
}

/** Who a stage is assigned to by pick rather than by role (dropdown selections). */
export function assigneeForStage(r: ChainRequest, stage: RequestStage): string | null {
  if (stage === RequestStage.DEPT_HEAD_REVIEW) return r.departmentHeadId;
  if (stage === RequestStage.SBU_HEAD_REVIEW) return r.sbuHeadId;
  // Own-department GAE: the Centralized Department Head review is a manual
  // assignment (the requestor picks the person), not a role lookup - falls
  // through to the role-based check in canActOnStage when unset (the
  // regular, Department-Head-then-Centralized-Head chain).
  if (stage === RequestStage.CENTRALIZED_HEAD_REVIEW && r.centralizedHeadId) return r.centralizedHeadId;
  if (stage === RequestStage.CENTRALIZED_L1_REVIEW) return r.expenseLineItem?.centralizedReviewerId ?? null;
  return null;
}

function hasDeptRole(user: AuthedUser, roleType: RoleType, departmentId: string) {
  return user.roles.some((x) => x.roleType === roleType && x.departmentId === departmentId);
}
function hasAnyRole(user: AuthedUser, roleType: RoleType) {
  return user.roles.some((x) => x.roleType === roleType);
}
function hasSbuRole(user: AuthedUser, roleType: RoleType, sbu: Sbu | null) {
  return user.roles.some((x) => x.roleType === roleType && (sbu === null || x.sbu === sbu));
}

/** May this user act (approve / return / reassign / cancel) on the request's CURRENT stage? */
export function canActOnStage(user: AuthedUser, r: ChainRequest, stage: RequestStage): boolean {
  // An explicit assignment (dropdown pick or a manual reassignment) wins over the role rule.
  if (r.assigneeId) return user.id === r.assigneeId;
  const S = RequestStage;
  switch (stage) {
    case S.DEPT_HEAD_REVIEW:
      // Legacy rows created before the Department Head dropdown existed.
      return hasDeptRole(user, RoleType.DEPARTMENT_HEAD, r.departmentId);
    case S.CFO_APPROVAL:
      return hasAnyRole(user, RoleType.CFO);
    case S.CENTRALIZED_L1_REVIEW:
      // Falls back to the department's Centralized Requestor/Reviewer role
      // only when the line item has no column-J reviewer of its own set.
      // (Unreachable for SBU-batch categories - their chain has no
      // CENTRALIZED_L1_REVIEW stage - so expenseLineItem is never null here
      // in practice; the fallback is purely for type safety.)
      return !!r.expenseLineItem && (hasDeptRole(user, RoleType.CENTRALIZED_BUDGET_PREPARER, r.expenseLineItem.ownerDepartmentId) || hasDeptRole(user, RoleType.CENTRALIZED_FIRST_LEVEL_REVIEWER, r.expenseLineItem.ownerDepartmentId));
    case S.CENTRALIZED_HEAD_REVIEW:
      return !!r.expenseLineItem && hasDeptRole(user, RoleType.CENTRALIZED_DEPARTMENT_HEAD, r.expenseLineItem.ownerDepartmentId);
    case S.SF_VALIDATION:
      return hasSbuRole(user, RoleType.BU_FINANCE_OFFICER, requestSbu(r)) || hasSbuRole(user, RoleType.BU_FINANCE_HEAD, requestSbu(r));
    case S.SF_HEAD_REVIEW:
      return hasSbuRole(user, RoleType.BU_FINANCE_HEAD, requestSbu(r));
    case S.SBU_HEAD_REVIEW:
      return false; // only ever via assigneeId (the dropdown pick)
    case S.BUDGET_OFFICER_VALIDATION:
    case S.BUDGET_OFFICER_REVIEW:
      return hasAnyRole(user, RoleType.BUDGET_OFFICER);
    case S.BCA_HEAD_REVIEW:
      return hasAnyRole(user, RoleType.BCA_HEAD);
    default:
      return false;
  }
}

export const ACTIVE_STAGES: RequestStage[] = [
  RequestStage.DEPT_HEAD_REVIEW,
  RequestStage.CFO_APPROVAL,
  RequestStage.CENTRALIZED_L1_REVIEW,
  RequestStage.CENTRALIZED_HEAD_REVIEW,
  RequestStage.SF_VALIDATION,
  RequestStage.SF_HEAD_REVIEW,
  RequestStage.SBU_HEAD_REVIEW,
  RequestStage.BUDGET_OFFICER_VALIDATION,
  RequestStage.BCA_HEAD_REVIEW,
  RequestStage.BUDGET_OFFICER_REVIEW,
];
