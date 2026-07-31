import { Router } from "express";
import { z } from "zod";
import multer from "multer";
import path from "node:path";
import fs from "node:fs";
import { Prisma, RequestStage, RoleType } from "@prisma/client";
import { prisma } from "../prisma";
import { asyncHandler } from "../asyncHandler";
import { hasRole, requireAuth, requireRole } from "../middleware/auth";
import { HttpError } from "../httpError";
import {
  applyBudgetCut,
  bcaHeadDecision,
  cancelRequest,
  centralizedHeadDecision,
  centralizedL1Decision,
  cfoDecision,
  deptHeadDecision,
  finalizeAtStep5,
  returnAtStep5,
  submitRequest,
} from "../services/workflowService";

export const budgetRequestsRouter = Router();

budgetRequestsRouter.use(requireAuth);

const uploadDir = path.resolve(process.env.UPLOAD_DIR ?? "./uploads");
fs.mkdirSync(uploadDir, { recursive: true });
const upload = multer({
  dest: uploadDir,
  limits: { fileSize: 10 * 1024 * 1024 },
});

const DETAIL_INCLUDE = {
  department: true,
  expenseLineItem: { include: { ownerDepartment: true } },
  attachments: true,
  reviewDecisions: { include: { decidedBy: true }, orderBy: { timestamp: "asc" as const } },
  createdBy: true,
} satisfies Prisma.BudgetRequestInclude;

// ---- Create (Step 1) ----
const createSchema = z.object({
  fiscalYear: z.number().int(),
  expenseLineItemId: z.string().optional(),
  customExpenseName: z.string().optional(),
  monthlyAmounts: z.array(z.number()).length(12),
  businessJustification: z.string().min(1),
  otherRequiredFields: z.record(z.string()).optional(),
});

budgetRequestsRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const body = createSchema.parse(req.body);

    // FR-1.15 #1 — Originating Department is read-only and auto-defaults to
    // the Requestor's assigned unit based on system login; it is never
    // client-supplied.
    const departmentId = req.user!.departmentId;
    if (!departmentId) {
      throw new HttpError(400, "Your account has no assigned department to originate a request from.");
    }

    if (!body.expenseLineItemId && !body.customExpenseName) {
      throw new HttpError(400, "Select an expense line item or provide a custom expense name.");
    }

    let expenseLineItemId = body.expenseLineItemId;

    if (!expenseLineItemId && body.customExpenseName) {
      // FR-1.14 — unlisted expense: free-text entry routes to the Budget
      // Officer for refinement + GL-CC assignment. We park it under the
      // requestor's own department until the Budget Officer assigns the
      // real owner.
      const created = await prisma.expenseLineItem.create({
        data: {
          name: body.customExpenseName,
          glAccount: "PENDING",
          costCenter: "PENDING",
          ownerDepartmentId: departmentId,
          isCustom: true,
          status: "PENDING_REFINEMENT",
        },
      });
      expenseLineItemId = created.id;
    }

    const proposedAmount = body.monthlyAmounts.reduce((a, b) => a + b, 0);

    const created = await prisma.budgetRequest.create({
      data: {
        departmentId,
        fiscalYear: body.fiscalYear,
        expenseLineItemId: expenseLineItemId!,
        monthlyAmounts: body.monthlyAmounts,
        proposedAmount,
        businessJustification: body.businessJustification,
        otherRequiredFields: body.otherRequiredFields ?? {},
        createdById: req.user!.id,
      },
      include: DETAIL_INCLUDE,
    });

    res.status(201).json(created);
  })
);

const updateSchema = createSchema.partial().omit({ fiscalYear: true });

budgetRequestsRouter.patch(
  "/:id",
  asyncHandler(async (req, res) => {
    const existing = await prisma.budgetRequest.findUniqueOrThrow({ where: { id: req.params.id } });
    if (existing.currentStage !== RequestStage.DRAFT) {
      throw new HttpError(409, "Only draft requests can be edited.");
    }
    if (existing.createdById !== req.user!.id) {
      throw new HttpError(403, "You can only edit your own requests.");
    }

    const body = updateSchema.parse(req.body);
    const data: Prisma.BudgetRequestUpdateInput = {};
    if (body.businessJustification !== undefined) data.businessJustification = body.businessJustification;
    if (body.otherRequiredFields !== undefined) data.otherRequiredFields = body.otherRequiredFields;
    if (body.monthlyAmounts !== undefined) {
      data.monthlyAmounts = body.monthlyAmounts;
      data.proposedAmount = body.monthlyAmounts.reduce((a, b) => a + b, 0);
    }
    if (body.expenseLineItemId !== undefined) data.expenseLineItem = { connect: { id: body.expenseLineItemId } };

    const updated = await prisma.budgetRequest.update({
      where: { id: req.params.id },
      data,
      include: DETAIL_INCLUDE,
    });
    res.json(updated);
  })
);

budgetRequestsRouter.post(
  "/:id/attachments",
  upload.single("file"),
  asyncHandler(async (req, res) => {
    if (!req.file) throw new HttpError(400, "No file uploaded.");
    const request = await prisma.budgetRequest.findUniqueOrThrow({ where: { id: req.params.id } });
    if (request.createdById !== req.user!.id) {
      throw new HttpError(403, "You can only attach files to your own requests.");
    }
    const attachment = await prisma.attachment.create({
      data: {
        budgetRequestId: req.params.id,
        fileName: req.file.originalname,
        storagePath: req.file.filename,
        uploadedById: req.user!.id,
      },
    });
    res.status(201).json(attachment);
  })
);

budgetRequestsRouter.post(
  "/:id/submit",
  asyncHandler(async (req, res) => {
    const request = await prisma.budgetRequest.findUniqueOrThrow({ where: { id: req.params.id } });
    if (request.createdById !== req.user!.id) {
      throw new HttpError(403, "You can only submit your own requests.");
    }
    const updated = await submitRequest(req.params.id);
    res.json(updated);
  })
);

// Notes item: a Requestor can cancel their own request while it hasn't yet
// been acted on by the Department Head (DRAFT or DEPT_HEAD_REVIEW).
budgetRequestsRouter.post(
  "/:id/cancel",
  asyncHandler(async (req, res) => {
    const updated = await cancelRequest(req.params.id, req.user!.id);
    res.json(updated);
  })
);

// ---- Reads ----
budgetRequestsRouter.get(
  "/my-requests",
  asyncHandler(async (req, res) => {
    const requests = await prisma.budgetRequest.findMany({
      where: { createdById: req.user!.id },
      include: DETAIL_INCLUDE,
      orderBy: { createdAt: "desc" },
    });
    res.json(requests);
  })
);

const STAGE_BY_ROLE: Partial<Record<RoleType, RequestStage>> = {
  [RoleType.DEPARTMENT_HEAD]: RequestStage.DEPT_HEAD_REVIEW,
  [RoleType.CFO]: RequestStage.CFO_APPROVAL,
  [RoleType.CENTRALIZED_FIRST_LEVEL_REVIEWER]: RequestStage.CENTRALIZED_L1_REVIEW,
  [RoleType.CENTRALIZED_DEPARTMENT_HEAD]: RequestStage.CENTRALIZED_HEAD_REVIEW,
  [RoleType.BCA_HEAD]: RequestStage.BCA_HEAD_REVIEW,
  [RoleType.BUDGET_OFFICER]: RequestStage.BUDGET_OFFICER_REVIEW,
};

// Requests waiting on the current user's action, scoped to the
// department(s) where they hold the relevant role. Department Heads are
// scoped by the request's *originating* department; the centralized roles
// (L1 reviewer / centralized head / BC&A) are scoped by the expense line
// item's *owning* department, per FR-1.18.
budgetRequestsRouter.get(
  "/inbox",
  asyncHandler(async (req, res) => {
    const clauses: Prisma.BudgetRequestWhereInput[] = [];

    for (const role of req.user!.roles) {
      const stage = STAGE_BY_ROLE[role.roleType];
      if (!stage) continue;

      if (role.roleType === RoleType.DEPARTMENT_HEAD) {
        clauses.push({ currentStage: stage, departmentId: role.departmentId });
      } else if (
        role.roleType === RoleType.CENTRALIZED_FIRST_LEVEL_REVIEWER ||
        role.roleType === RoleType.CENTRALIZED_DEPARTMENT_HEAD
      ) {
        clauses.push({ currentStage: stage, expenseLineItem: { ownerDepartmentId: role.departmentId } });
      } else {
        clauses.push({ currentStage: stage });
      }
    }

    if (clauses.length === 0) {
      res.json([]);
      return;
    }

    const requests = await prisma.budgetRequest.findMany({
      where: { OR: clauses },
      include: DETAIL_INCLUDE,
      orderBy: { updatedAt: "asc" },
    });
    res.json(requests);
  })
);

// FR-1.27 — Step 5 dashboard: Budget Officer's queue grouped by centralized
// department, GL category, and expense line item.
budgetRequestsRouter.get(
  "/step5-dashboard",
  asyncHandler(async (req, res) => {
    const requests = await prisma.budgetRequest.findMany({
      where: { currentStage: RequestStage.BUDGET_OFFICER_REVIEW },
      include: DETAIL_INCLUDE,
      orderBy: { updatedAt: "asc" },
    });
    res.json(requests);
  })
);

// Finalized requests still awaiting the Budget Officer's manual SAP upload
// trigger (FR-1.33).
budgetRequestsRouter.get(
  "/approved-pending-sap",
  requireRole(RoleType.BUDGET_OFFICER),
  asyncHandler(async (_req, res) => {
    const requests = await prisma.budgetRequest.findMany({
      where: { currentStage: RequestStage.APPROVED, sapDocumentNumber: null },
      include: DETAIL_INCLUDE,
      orderBy: { updatedAt: "asc" },
    });
    res.json(requests);
  })
);

budgetRequestsRouter.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const request = await prisma.budgetRequest.findUniqueOrThrow({
      where: { id: req.params.id },
      include: DETAIL_INCLUDE,
    });
    res.json(request);
  })
);

// ---- Workflow decisions ----
budgetRequestsRouter.post(
  "/:id/decisions/dept-head",
  requireRole(RoleType.DEPARTMENT_HEAD),
  asyncHandler(async (req, res) => {
    const request = await prisma.budgetRequest.findUniqueOrThrow({ where: { id: req.params.id } });
    if (!hasRole(req.user, RoleType.DEPARTMENT_HEAD, request.departmentId)) {
      throw new HttpError(403, "You are not the Department Head for this request's originating department.");
    }
    const { decision, comment } = z
      .object({ decision: z.enum(["APPROVE", "RETURN"]), comment: z.string().optional() })
      .parse(req.body);
    const updated = await deptHeadDecision(req.params.id, req.user!.id, decision, comment);
    res.json(updated);
  })
);

budgetRequestsRouter.post(
  "/:id/decisions/centralized-l1",
  requireRole(RoleType.CENTRALIZED_FIRST_LEVEL_REVIEWER),
  asyncHandler(async (req, res) => {
    const request = await prisma.budgetRequest.findUniqueOrThrow({
      where: { id: req.params.id },
      include: { expenseLineItem: true },
    });
    if (!hasRole(req.user, RoleType.CENTRALIZED_FIRST_LEVEL_REVIEWER, request.expenseLineItem.ownerDepartmentId)) {
      throw new HttpError(403, "You are not the First-Level Reviewer for this expense line item's owning department.");
    }
    const { decision, comment } = z
      .object({ decision: z.enum(["APPROVE", "REJECT"]), comment: z.string().optional() })
      .parse(req.body);
    const updated = await centralizedL1Decision(req.params.id, req.user!.id, decision, comment);
    res.json(updated);
  })
);

budgetRequestsRouter.post(
  "/:id/decisions/centralized-head",
  requireRole(RoleType.CENTRALIZED_DEPARTMENT_HEAD),
  asyncHandler(async (req, res) => {
    const request = await prisma.budgetRequest.findUniqueOrThrow({
      where: { id: req.params.id },
      include: { expenseLineItem: true },
    });
    if (!hasRole(req.user, RoleType.CENTRALIZED_DEPARTMENT_HEAD, request.expenseLineItem.ownerDepartmentId)) {
      throw new HttpError(403, "You are not the Centralized Department Head for this expense line item's owning department.");
    }
    const { decision, comment } = z
      .object({ decision: z.enum(["APPROVE", "RETURN"]), comment: z.string().optional() })
      .parse(req.body);
    const updated = await centralizedHeadDecision(req.params.id, req.user!.id, decision, comment);
    res.json(updated);
  })
);

budgetRequestsRouter.post(
  "/:id/decisions/cfo",
  requireRole(RoleType.CFO),
  asyncHandler(async (req, res) => {
    const { decision, comment } = z
      .object({ decision: z.enum(["APPROVE", "RETURN"]), comment: z.string().optional() })
      .parse(req.body);
    const updated = await cfoDecision(req.params.id, req.user!.id, decision, comment);
    res.json(updated);
  })
);

budgetRequestsRouter.post(
  "/:id/decisions/bca-head",
  requireRole(RoleType.BCA_HEAD),
  asyncHandler(async (req, res) => {
    const { decision, comment } = z
      .object({ decision: z.enum(["APPROVE", "RETURN"]), comment: z.string().optional() })
      .parse(req.body);
    const updated = await bcaHeadDecision(req.params.id, req.user!.id, decision, comment);
    res.json(updated);
  })
);

budgetRequestsRouter.post(
  "/:id/budget-cut",
  requireRole(RoleType.BUDGET_OFFICER),
  asyncHandler(async (req, res) => {
    const { cutAmount } = z.object({ cutAmount: z.number().min(0) }).parse(req.body);
    const updated = await applyBudgetCut(req.params.id, req.user!.id, cutAmount);
    res.json(updated);
  })
);

budgetRequestsRouter.post(
  "/:id/return-to-stage",
  requireRole(RoleType.BUDGET_OFFICER),
  asyncHandler(async (req, res) => {
    const { targetStage, reasonCodeId } = z
      .object({
        targetStage: z.enum([
          "DEPT_HEAD_REVIEW",
          "CENTRALIZED_L1_REVIEW",
          "CENTRALIZED_HEAD_REVIEW",
          "BCA_HEAD_REVIEW",
        ]),
        reasonCodeId: z.string(),
      })
      .parse(req.body);
    const updated = await returnAtStep5(req.params.id, req.user!.id, targetStage, reasonCodeId);
    res.json(updated);
  })
);

budgetRequestsRouter.post(
  "/:id/finalize",
  requireRole(RoleType.BUDGET_OFFICER),
  asyncHandler(async (req, res) => {
    const updated = await finalizeAtStep5(req.params.id, req.user!.id);
    res.json(updated);
  })
);
