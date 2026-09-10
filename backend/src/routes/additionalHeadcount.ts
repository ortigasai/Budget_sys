import { Router } from "express";
import { z } from "zod";
import { HeadcountRequestStage, Prisma, RoleType } from "@prisma/client";
import { prisma } from "../prisma";
import { asyncHandler } from "../asyncHandler";
import { hasRole, requireAuth, requireRole } from "../middleware/auth";
import { HttpError } from "../httpError";
import {
  deptHeadHeadcountDecision,
  hrAnalystHeadcountDecision,
  hrHeadHeadcountDecision,
} from "../services/headcountWorkflowService";
import { resolveHeadcountRequestPendingReviewers } from "../lib/pendingReviewers";

export const additionalHeadcountRouter = Router();

additionalHeadcountRouter.use(requireAuth);

const DETAIL_INCLUDE = {
  company: true,
  department: true,
  createdBy: true,
  reviewDecisions: { include: { decidedBy: true }, orderBy: { timestamp: "asc" as const } },
  // Notes_11: the Details page needs to show the auto-generated Office 365/
  // Mobile Phone follow-ons alongside the headcount request they came from.
  office365AccountRequest: { include: { reviewerDecidedBy: true, approverDecidedBy: true } },
  mobilePhoneBudgetRequest: { include: { reviewerDecidedBy: true, approverDecidedBy: true } },
} satisfies Prisma.AdditionalHeadcountRequestInclude;

const createSchema = z.object({
  position: z.string().min(1),
  rank: z.number().int(),
  companyId: z.string(),
  estimatedHireDate: z.string().datetime(),
  justification: z.string().min(1),
});

// Notes_8: "Submitted request will generate a code - MR-'YY'-001." Sequential
// per calendar year of submission, e.g. MR-26-001, MR-26-002. A plain
// count+1 is fine here — this is a low-volume, single-writer demo workflow,
// not a system under concurrent-submission load.
async function generateHeadcountCode(): Promise<string> {
  const yy = String(new Date().getFullYear()).slice(-2);
  const prefix = `MR-${yy}-`;
  const existing = await prisma.additionalHeadcountRequest.count({ where: { code: { startsWith: prefix } } });
  return `${prefix}${String(existing + 1).padStart(3, "0")}`;
}

additionalHeadcountRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const departmentId = req.user!.departmentId;
    if (!departmentId) throw new HttpError(400, "Your account has no assigned department.");

    const body = createSchema.parse(req.body);
    const code = await generateHeadcountCode();
    const created = await prisma.additionalHeadcountRequest.create({
      data: {
        ...body,
        code,
        estimatedHireDate: new Date(body.estimatedHireDate),
        departmentId,
        createdById: req.user!.id,
      },
      include: DETAIL_INCLUDE,
    });
    res.status(201).json(created);
  })
);

additionalHeadcountRouter.get(
  "/my-requests",
  asyncHandler(async (req, res) => {
    const requests = await prisma.additionalHeadcountRequest.findMany({
      where: { createdById: req.user!.id },
      include: DETAIL_INCLUDE,
      orderBy: { createdAt: "desc" },
    });
    const withPendingReviewers = await Promise.all(
      requests.map(async (r) => ({ ...r, pendingReviewers: await resolveHeadcountRequestPendingReviewers(r) }))
    );
    res.json(withPendingReviewers);
  })
);

// Approved requests feed the Manpower Budget's headcount + "Additional
// Headcount Request" column (manpowerService.ts).
additionalHeadcountRouter.get(
  "/approved",
  asyncHandler(async (_req, res) => {
    const requests = await prisma.additionalHeadcountRequest.findMany({
      where: { currentStage: HeadcountRequestStage.APPROVED },
      include: DETAIL_INCLUDE,
    });
    res.json(requests);
  })
);

additionalHeadcountRouter.get(
  "/inbox",
  asyncHandler(async (req, res) => {
    const clauses: Prisma.AdditionalHeadcountRequestWhereInput[] = [];

    for (const role of req.user!.roles) {
      if (role.roleType === RoleType.DEPARTMENT_HEAD) {
        clauses.push({ currentStage: HeadcountRequestStage.DEPT_HEAD_REVIEW, departmentId: role.departmentId! });
      } else if (role.roleType === RoleType.HR_ANALYST) {
        clauses.push({ currentStage: HeadcountRequestStage.HR_ANALYST_REVIEW });
      } else if (role.roleType === RoleType.CENTRALIZED_DEPARTMENT_HEAD) {
        // "HR Head" reuses Human Resources' Centralized Department Head —
        // scoped by the reviewer's own department, not the (originating)
        // request department, since HR Head reviews headcount requests from
        // every department.
        const hrDept = await prisma.department.findUnique({ where: { name: "Human Resources" } });
        if (hrDept && hrDept.id === role.departmentId) {
          clauses.push({ currentStage: HeadcountRequestStage.HR_HEAD_REVIEW });
        }
      }
    }

    if (clauses.length === 0) {
      res.json([]);
      return;
    }

    const requests = await prisma.additionalHeadcountRequest.findMany({
      where: { OR: clauses },
      include: DETAIL_INCLUDE,
      orderBy: { updatedAt: "asc" },
    });
    res.json(requests);
  })
);

// Mirrors budget-requests' /reviewed-by-me — this user's own past decisions
// on Additional Headcount Requests, most recent first.
additionalHeadcountRouter.get(
  "/reviewed-by-me",
  asyncHandler(async (req, res) => {
    const requests = await prisma.additionalHeadcountRequest.findMany({
      where: { reviewDecisions: { some: { decidedById: req.user!.id } } },
      include: DETAIL_INCLUDE,
    });
    const withMyDecision = requests
      .map((r) => {
        const mine = r.reviewDecisions.filter((d) => d.decidedById === req.user!.id);
        return { ...r, myDecision: mine[mine.length - 1] };
      })
      .sort((a, b) => b.myDecision.timestamp.getTime() - a.myDecision.timestamp.getTime())
      .slice(0, 20);
    res.json(withMyDecision);
  })
);

// Notes_14: "After the approval of Reggie (Reviewer), the request will
// route to Ronilo (Approver)" — a two-stage chain shared by Office 365 and
// Mobile Phone Budget follow-ons. Both models have the identical flat
// two-slot decision shape (see schema.prisma), so this one pair of helpers
// covers both instead of duplicating the stage-transition logic 2x.
interface FollowOnDecisionFields {
  stage: "REVIEWER_REVIEW" | "APPROVER_REVIEW" | "APPROVED" | "REJECTED";
  reviewerDecidedById: string | null;
  reviewerComment: string | null;
  reviewerDecidedAt: Date | null;
  approverDecidedById: string | null;
  approverComment: string | null;
  approverDecidedAt: Date | null;
}

function myFollowOnDecision(r: FollowOnDecisionFields, userId: string) {
  if (r.approverDecidedById === userId) {
    return {
      decision: (r.stage === "APPROVED" ? "APPROVE" : "REJECT") as "APPROVE" | "REJECT",
      stage: "APPROVER_REVIEW" as const,
      comment: r.approverComment,
      timestamp: r.approverDecidedAt!,
    };
  }
  // reviewerDecidedById === userId — a REJECTED outcome was the reviewer's
  // own call only if the approver never got involved (approverDecidedById
  // still null); otherwise the reviewer approved and it was the approver
  // who later rejected it.
  const rejectedByReviewer = r.stage === "REJECTED" && r.approverDecidedById === null;
  return {
    decision: (rejectedByReviewer ? "REJECT" : "APPROVE") as "APPROVE" | "REJECT",
    stage: "REVIEWER_REVIEW" as const,
    comment: r.reviewerComment,
    timestamp: r.reviewerDecidedAt!,
  };
}

// ---- Office 365 Account request (notes item 8) ----
// Auto-created by hrHeadHeadcountDecision once a headcount request is fully
// approved. Two-stage chain (Notes_14): IS & IT's Centralized Department
// Reviewer decides first — an APPROVE moves it to the Centralized
// Department Approver for the final decision; a REJECT at either stage is
// terminal. Registered before the single-segment "/:id" route below so
// these literal paths win the match.
const OFFICE365_INCLUDE = {
  additionalHeadcountRequest: { include: { department: true, company: true, createdBy: true } },
  reviewerDecidedBy: true,
  approverDecidedBy: true,
} satisfies Prisma.Office365AccountRequestInclude;

additionalHeadcountRouter.get(
  "/office365-inbox",
  asyncHandler(async (req, res) => {
    const isItDept = await prisma.department.findUnique({ where: { name: "IS & IT" } });
    if (!isItDept) {
      res.json([]);
      return;
    }
    const stages: ("REVIEWER_REVIEW" | "APPROVER_REVIEW")[] = [];
    if (hasRole(req.user, RoleType.CENTRALIZED_FIRST_LEVEL_REVIEWER, isItDept.id)) stages.push("REVIEWER_REVIEW");
    if (hasRole(req.user, RoleType.CENTRALIZED_DEPARTMENT_HEAD, isItDept.id)) stages.push("APPROVER_REVIEW");
    if (stages.length === 0) {
      res.json([]);
      return;
    }
    const requests = await prisma.office365AccountRequest.findMany({
      where: { stage: { in: stages } },
      include: OFFICE365_INCLUDE,
      orderBy: { createdAt: "asc" },
    });
    res.json(requests);
  })
);

additionalHeadcountRouter.get(
  "/office365/reviewed-by-me",
  asyncHandler(async (req, res) => {
    const requests = await prisma.office365AccountRequest.findMany({
      where: { OR: [{ reviewerDecidedById: req.user!.id }, { approverDecidedById: req.user!.id }] },
      include: OFFICE365_INCLUDE,
    });
    const withMyDecision = requests
      .map((r) => ({ ...r, myDecision: myFollowOnDecision(r, req.user!.id) }))
      .sort((a, b) => b.myDecision.timestamp.getTime() - a.myDecision.timestamp.getTime())
      .slice(0, 20);
    res.json(withMyDecision);
  })
);

// The requestor's own view of the Office 365 request auto-generated once
// their Additional Headcount Request was fully approved — mirrors
// budget-requests' /my-requests so it can surface on the My Requests page.
additionalHeadcountRouter.get(
  "/office365/my-requests",
  asyncHandler(async (req, res) => {
    const requests = await prisma.office365AccountRequest.findMany({
      where: { additionalHeadcountRequest: { createdById: req.user!.id } },
      include: OFFICE365_INCLUDE,
      orderBy: { createdAt: "desc" },
    });
    res.json(requests);
  })
);

// ---- Mobile Phone budget request (notes item 8, revised) ----
// Same shape, trigger point, and Reviewer-then-Approver chain (Notes_14) as
// Office 365 above, reviewed by Admin Services instead of IS & IT.
const MOBILE_PHONE_BUDGET_INCLUDE = {
  additionalHeadcountRequest: { include: { department: true, company: true, createdBy: true } },
  reviewerDecidedBy: true,
  approverDecidedBy: true,
} satisfies Prisma.MobilePhoneBudgetRequestInclude;

additionalHeadcountRouter.get(
  "/mobile-phone-budget-inbox",
  asyncHandler(async (req, res) => {
    const adminServicesDept = await prisma.department.findUnique({ where: { name: "Admin Services" } });
    if (!adminServicesDept) {
      res.json([]);
      return;
    }
    const stages: ("REVIEWER_REVIEW" | "APPROVER_REVIEW")[] = [];
    if (hasRole(req.user, RoleType.CENTRALIZED_FIRST_LEVEL_REVIEWER, adminServicesDept.id)) stages.push("REVIEWER_REVIEW");
    if (hasRole(req.user, RoleType.CENTRALIZED_DEPARTMENT_HEAD, adminServicesDept.id)) stages.push("APPROVER_REVIEW");
    if (stages.length === 0) {
      res.json([]);
      return;
    }
    const requests = await prisma.mobilePhoneBudgetRequest.findMany({
      where: { stage: { in: stages } },
      include: MOBILE_PHONE_BUDGET_INCLUDE,
      orderBy: { createdAt: "asc" },
    });
    res.json(requests);
  })
);

additionalHeadcountRouter.get(
  "/mobile-phone-budget/reviewed-by-me",
  asyncHandler(async (req, res) => {
    const requests = await prisma.mobilePhoneBudgetRequest.findMany({
      where: { OR: [{ reviewerDecidedById: req.user!.id }, { approverDecidedById: req.user!.id }] },
      include: MOBILE_PHONE_BUDGET_INCLUDE,
    });
    const withMyDecision = requests
      .map((r) => ({ ...r, myDecision: myFollowOnDecision(r, req.user!.id) }))
      .sort((a, b) => b.myDecision.timestamp.getTime() - a.myDecision.timestamp.getTime())
      .slice(0, 20);
    res.json(withMyDecision);
  })
);

// The requestor's own view of the Mobile Phone budget request auto-generated
// once their Additional Headcount Request was fully approved — mirrors
// budget-requests' /my-requests so it can surface on the My Requests page.
additionalHeadcountRouter.get(
  "/mobile-phone-budget/my-requests",
  asyncHandler(async (req, res) => {
    const requests = await prisma.mobilePhoneBudgetRequest.findMany({
      where: { additionalHeadcountRequest: { createdById: req.user!.id } },
      include: MOBILE_PHONE_BUDGET_INCLUDE,
      orderBy: { createdAt: "desc" },
    });
    res.json(requests);
  })
);

// Notes_8: "This will reflect on the list of employees for Mobile Phone and
// other sections that need employee list." Pending Additional Headcount
// Requests aren't real employees yet — their generated code stands in for a
// name until the hire is actually imported into the roster, so any
// Employee Name picker can offer both.
additionalHeadcountRouter.get(
  "/employee-options",
  asyncHandler(async (_req, res) => {
    const [users, headcountRequests] = await Promise.all([
      prisma.user.findMany({ include: { department: true }, orderBy: { name: "asc" } }),
      prisma.additionalHeadcountRequest.findMany({ include: { department: true }, orderBy: { code: "asc" } }),
    ]);
    const options = [
      ...users.map((u) => ({ id: u.id, name: u.name, department: u.department?.name ?? null })),
      ...headcountRequests.map((r) => ({
        id: r.id,
        name: `${r.code} — ${r.position} (pending hire)`,
        department: r.department.name,
      })),
    ];
    res.json(options);
  })
);

additionalHeadcountRouter.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const request = await prisma.additionalHeadcountRequest.findUniqueOrThrow({
      where: { id: req.params.id },
      include: DETAIL_INCLUDE,
    });
    res.json(request);
  })
);

const decisionSchema = z.object({ decision: z.enum(["APPROVE", "RETURN"]), comment: z.string().optional() });

additionalHeadcountRouter.post(
  "/:id/decisions/dept-head",
  requireRole(RoleType.DEPARTMENT_HEAD),
  asyncHandler(async (req, res) => {
    const request = await prisma.additionalHeadcountRequest.findUniqueOrThrow({ where: { id: req.params.id } });
    if (!hasRole(req.user, RoleType.DEPARTMENT_HEAD, request.departmentId)) {
      throw new HttpError(403, "You are not the Department Head for this request's department.");
    }
    const { decision, comment } = decisionSchema.parse(req.body);
    const updated = await deptHeadHeadcountDecision(req.params.id, req.user!.id, decision, comment);
    res.json(updated);
  })
);

additionalHeadcountRouter.post(
  "/:id/decisions/hr-analyst",
  requireRole(RoleType.HR_ANALYST),
  asyncHandler(async (req, res) => {
    const { decision, comment } = decisionSchema.parse(req.body);
    const updated = await hrAnalystHeadcountDecision(req.params.id, req.user!.id, decision, comment);
    res.json(updated);
  })
);

additionalHeadcountRouter.post(
  "/:id/decisions/hr-head",
  requireRole(RoleType.CENTRALIZED_DEPARTMENT_HEAD),
  asyncHandler(async (req, res) => {
    const hrDept = await prisma.department.findUniqueOrThrow({ where: { name: "Human Resources" } });
    if (!hasRole(req.user, RoleType.CENTRALIZED_DEPARTMENT_HEAD, hrDept.id)) {
      throw new HttpError(403, "Only the Human Resources Centralized Department Head can decide this.");
    }
    const { decision, comment } = decisionSchema.parse(req.body);
    const updated = await hrHeadHeadcountDecision(req.params.id, req.user!.id, decision, comment);
    res.json(updated);
  })
);

additionalHeadcountRouter.post(
  "/office365/:id/decision",
  requireRole(RoleType.CENTRALIZED_FIRST_LEVEL_REVIEWER, RoleType.CENTRALIZED_DEPARTMENT_HEAD),
  asyncHandler(async (req, res) => {
    const isItDept = await prisma.department.findUniqueOrThrow({ where: { name: "IS & IT" } });
    const { decision, comment } = z
      .object({ decision: z.enum(["APPROVE", "REJECT"]), comment: z.string().optional() })
      .parse(req.body);
    const existing = await prisma.office365AccountRequest.findUniqueOrThrow({ where: { id: req.params.id } });

    if (existing.stage === "REVIEWER_REVIEW") {
      if (!hasRole(req.user, RoleType.CENTRALIZED_FIRST_LEVEL_REVIEWER, isItDept.id)) {
        throw new HttpError(403, "Only the IS & IT Centralized Department Reviewer can decide this.");
      }
      const updated = await prisma.office365AccountRequest.update({
        where: { id: req.params.id },
        data: {
          // Notes_14: an APPROVE here doesn't finish it — it just hands off
          // to the Approver stage.
          stage: decision === "APPROVE" ? "APPROVER_REVIEW" : "REJECTED",
          reviewerDecidedById: req.user!.id,
          reviewerDecidedAt: new Date(),
          reviewerComment: comment ?? null,
        },
        include: OFFICE365_INCLUDE,
      });
      res.json(updated);
      return;
    }

    if (existing.stage === "APPROVER_REVIEW") {
      if (!hasRole(req.user, RoleType.CENTRALIZED_DEPARTMENT_HEAD, isItDept.id)) {
        throw new HttpError(403, "Only the IS & IT Centralized Department Approver can decide this.");
      }
      const updated = await prisma.office365AccountRequest.update({
        where: { id: req.params.id },
        data: {
          stage: decision === "APPROVE" ? "APPROVED" : "REJECTED",
          approverDecidedById: req.user!.id,
          approverDecidedAt: new Date(),
          approverComment: comment ?? null,
        },
        include: OFFICE365_INCLUDE,
      });
      res.json(updated);
      return;
    }

    throw new HttpError(409, "This Office 365 Account request has already been decided.");
  })
);

additionalHeadcountRouter.post(
  "/mobile-phone-budget/:id/decision",
  requireRole(RoleType.CENTRALIZED_FIRST_LEVEL_REVIEWER, RoleType.CENTRALIZED_DEPARTMENT_HEAD),
  asyncHandler(async (req, res) => {
    const adminServicesDept = await prisma.department.findUniqueOrThrow({ where: { name: "Admin Services" } });
    const { decision, comment } = z
      .object({ decision: z.enum(["APPROVE", "REJECT"]), comment: z.string().optional() })
      .parse(req.body);
    const existing = await prisma.mobilePhoneBudgetRequest.findUniqueOrThrow({ where: { id: req.params.id } });

    if (existing.stage === "REVIEWER_REVIEW") {
      if (!hasRole(req.user, RoleType.CENTRALIZED_FIRST_LEVEL_REVIEWER, adminServicesDept.id)) {
        throw new HttpError(403, "Only the Admin Services Centralized Department Reviewer can decide this.");
      }
      const updated = await prisma.mobilePhoneBudgetRequest.update({
        where: { id: req.params.id },
        data: {
          stage: decision === "APPROVE" ? "APPROVER_REVIEW" : "REJECTED",
          reviewerDecidedById: req.user!.id,
          reviewerDecidedAt: new Date(),
          reviewerComment: comment ?? null,
        },
        include: MOBILE_PHONE_BUDGET_INCLUDE,
      });
      res.json(updated);
      return;
    }

    if (existing.stage === "APPROVER_REVIEW") {
      if (!hasRole(req.user, RoleType.CENTRALIZED_DEPARTMENT_HEAD, adminServicesDept.id)) {
        throw new HttpError(403, "Only the Admin Services Centralized Department Approver can decide this.");
      }
      const updated = await prisma.mobilePhoneBudgetRequest.update({
        where: { id: req.params.id },
        data: {
          stage: decision === "APPROVE" ? "APPROVED" : "REJECTED",
          approverDecidedById: req.user!.id,
          approverDecidedAt: new Date(),
          approverComment: comment ?? null,
        },
        include: MOBILE_PHONE_BUDGET_INCLUDE,
      });
      res.json(updated);
      return;
    }

    throw new HttpError(409, "This Mobile Phone budget request has already been decided.");
  })
);
