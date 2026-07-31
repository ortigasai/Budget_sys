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

export const additionalHeadcountRouter = Router();

additionalHeadcountRouter.use(requireAuth);

const DETAIL_INCLUDE = {
  company: true,
  department: true,
  createdBy: true,
  reviewDecisions: { include: { decidedBy: true }, orderBy: { timestamp: "asc" as const } },
} satisfies Prisma.AdditionalHeadcountRequestInclude;

const createSchema = z.object({
  position: z.string().min(1),
  rank: z.number().int(),
  companyId: z.string(),
  estimatedHireDate: z.string().datetime(),
  justification: z.string().min(1),
});

additionalHeadcountRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const departmentId = req.user!.departmentId;
    if (!departmentId) throw new HttpError(400, "Your account has no assigned department.");

    const body = createSchema.parse(req.body);
    const created = await prisma.additionalHeadcountRequest.create({
      data: {
        ...body,
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
    res.json(requests);
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
        clauses.push({ currentStage: HeadcountRequestStage.DEPT_HEAD_REVIEW, departmentId: role.departmentId });
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
