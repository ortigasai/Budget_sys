import { HeadcountRequestStage, RequestStage, RoleType } from "@prisma/client";
import { prisma } from "../prisma";

// Reverse of budgetRequests.ts's STAGE_BY_ROLE (role -> stage) — given a
// stage, which role currently owns it. Department Heads are scoped by the
// request's *originating* department; the centralized roles are scoped by
// the expense line item's *owning* department (matching the /inbox route's
// own scoping, per FR-1.18); BC&A Head/CFO/Budget Officer aren't
// department-scoped at all.
const BUDGET_STAGE_ROLE: Partial<Record<RequestStage, RoleType>> = {
  [RequestStage.DEPT_HEAD_REVIEW]: RoleType.DEPARTMENT_HEAD,
  [RequestStage.CFO_APPROVAL]: RoleType.CFO,
  [RequestStage.CENTRALIZED_L1_REVIEW]: RoleType.CENTRALIZED_FIRST_LEVEL_REVIEWER,
  [RequestStage.CENTRALIZED_HEAD_REVIEW]: RoleType.CENTRALIZED_DEPARTMENT_HEAD,
  [RequestStage.BCA_HEAD_REVIEW]: RoleType.BCA_HEAD,
  [RequestStage.BUDGET_OFFICER_REVIEW]: RoleType.BUDGET_OFFICER,
};
const DEPARTMENT_SCOPED_ROLES = new Set<RoleType>([RoleType.DEPARTMENT_HEAD]);
const OWNER_DEPARTMENT_SCOPED_ROLES = new Set<RoleType>([
  RoleType.CENTRALIZED_FIRST_LEVEL_REVIEWER,
  RoleType.CENTRALIZED_DEPARTMENT_HEAD,
]);

let humanResourcesDeptIdPromise: Promise<string | null> | null = null;
function humanResourcesDeptId() {
  humanResourcesDeptIdPromise ??= prisma.department
    .findUnique({ where: { name: "Human Resources" } })
    .then((d) => d?.id ?? null);
  return humanResourcesDeptIdPromise;
}

async function reviewerNamesForRole(roleType: RoleType, departmentId: string | null): Promise<string[]> {
  const assignments = await prisma.roleAssignment.findMany({
    where: { roleType, ...(departmentId ? { departmentId } : {}) },
    include: { user: true },
  });
  return [...new Set(assignments.map((a) => a.user.name))];
}

// Who's currently holding up a BudgetRequest, for My Requests' "Pending:
// <name>" display. Empty for stages nobody is actively reviewing (DRAFT,
// terminal stages).
export async function resolveBudgetRequestPendingReviewers(request: {
  currentStage: RequestStage;
  departmentId: string;
  expenseLineItem: { ownerDepartmentId: string };
}): Promise<string[]> {
  const roleType = BUDGET_STAGE_ROLE[request.currentStage];
  if (!roleType) return [];

  const departmentId = DEPARTMENT_SCOPED_ROLES.has(roleType)
    ? request.departmentId
    : OWNER_DEPARTMENT_SCOPED_ROLES.has(roleType)
      ? request.expenseLineItem.ownerDepartmentId
      : null;
  return reviewerNamesForRole(roleType, departmentId);
}

// Same idea for AdditionalHeadcountRequest — a separate stage enum/workflow
// (headcountWorkflowService.ts), mirrored from additionalHeadcount.ts's own
// /inbox route rather than BUDGET_STAGE_ROLE above.
export async function resolveHeadcountRequestPendingReviewers(request: {
  currentStage: HeadcountRequestStage;
  departmentId: string;
}): Promise<string[]> {
  switch (request.currentStage) {
    case HeadcountRequestStage.DEPT_HEAD_REVIEW:
      return reviewerNamesForRole(RoleType.DEPARTMENT_HEAD, request.departmentId);
    case HeadcountRequestStage.HR_ANALYST_REVIEW:
      return reviewerNamesForRole(RoleType.HR_ANALYST, null);
    case HeadcountRequestStage.HR_HEAD_REVIEW: {
      const hrDeptId = await humanResourcesDeptId();
      return hrDeptId ? reviewerNamesForRole(RoleType.CENTRALIZED_DEPARTMENT_HEAD, hrDeptId) : [];
    }
    default:
      return [];
  }
}
