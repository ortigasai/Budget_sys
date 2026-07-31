import { Router } from "express";
import { z } from "zod";
import { RoleType } from "@prisma/client";
import { prisma } from "../prisma";
import { asyncHandler } from "../asyncHandler";
import { requireAuth, requireRole } from "../middleware/auth";
import { HttpError } from "../httpError";

export const adminRouter = Router();

adminRouter.use(requireAuth);

// ---- Departments (read-only reference data, any authenticated user) ----
adminRouter.get(
  "/departments",
  asyncHandler(async (_req, res) => {
    const departments = await prisma.department.findMany({ orderBy: { name: "asc" } });
    res.json(departments);
  })
);

// ---- Companies (read-only reference data, any authenticated user) ----
adminRouter.get(
  "/companies",
  asyncHandler(async (_req, res) => {
    const companies = await prisma.company.findMany({ orderBy: { name: "asc" } });
    res.json(companies);
  })
);

// ---- Fiscal cycle (which month the 2026 cycle is "as of") ----
adminRouter.get(
  "/fiscal-cycle",
  asyncHandler(async (_req, res) => {
    const config = await prisma.fiscalCycleConfig.findUnique({ where: { id: "singleton" } });
    res.json(config ?? { asOfMonth2026: 9 });
  })
);

adminRouter.put(
  "/fiscal-cycle",
  requireRole(RoleType.BUDGET_OFFICER),
  asyncHandler(async (req, res) => {
    const { asOfMonth2026 } = z.object({ asOfMonth2026: z.number().int().min(1).max(12) }).parse(req.body);
    const updated = await prisma.fiscalCycleConfig.upsert({
      where: { id: "singleton" },
      update: { asOfMonth2026, updatedBy: req.user!.id },
      create: { id: "singleton", asOfMonth2026, updatedBy: req.user!.id },
    });
    res.json(updated);
  })
);

// ---- Mobile phone policy tiers (notes item 7) ----
adminRouter.get(
  "/mobile-policy-tiers",
  asyncHandler(async (_req, res) => {
    const tiers = await prisma.mobilePhonePolicyTier.findMany({ orderBy: { minRank: "asc" } });
    res.json(tiers);
  })
);

const mobilePolicyTierSchema = z.object({
  minRank: z.number().int(),
  maxRank: z.number().int(),
  budgetLimit: z.number().min(0),
});

adminRouter.post(
  "/mobile-policy-tiers",
  requireRole(RoleType.BUDGET_OFFICER),
  asyncHandler(async (req, res) => {
    const body = mobilePolicyTierSchema.parse(req.body);
    const created = await prisma.mobilePhonePolicyTier.create({ data: body });
    res.status(201).json(created);
  })
);

adminRouter.patch(
  "/mobile-policy-tiers/:id",
  requireRole(RoleType.BUDGET_OFFICER),
  asyncHandler(async (req, res) => {
    const body = mobilePolicyTierSchema.partial().parse(req.body);
    const updated = await prisma.mobilePhonePolicyTier.update({ where: { id: req.params.id }, data: body });
    res.json(updated);
  })
);

adminRouter.delete(
  "/mobile-policy-tiers/:id",
  requireRole(RoleType.BUDGET_OFFICER),
  asyncHandler(async (req, res) => {
    await prisma.mobilePhonePolicyTier.delete({ where: { id: req.params.id } });
    res.status(204).end();
  })
);

// ---- Role assignments (Budget Officer only) ----
adminRouter.get(
  "/role-assignments",
  requireRole(RoleType.BUDGET_OFFICER),
  asyncHandler(async (req, res) => {
    const departmentId = req.query.departmentId as string | undefined;
    const roles = await prisma.roleAssignment.findMany({
      where: departmentId ? { departmentId } : undefined,
      include: { department: true, user: true },
      orderBy: { createdAt: "desc" },
    });
    res.json(roles);
  })
);

const roleAssignmentSchema = z.object({
  departmentId: z.string(),
  roleType: z.nativeEnum(RoleType),
  userId: z.string(),
});

adminRouter.post(
  "/role-assignments",
  requireRole(RoleType.BUDGET_OFFICER),
  asyncHandler(async (req, res) => {
    const body = roleAssignmentSchema.parse(req.body);
    const created = await prisma.roleAssignment.create({
      data: { ...body, assignedById: req.user!.id },
    });
    res.status(201).json(created);
  })
);

adminRouter.delete(
  "/role-assignments/:id",
  requireRole(RoleType.BUDGET_OFFICER),
  asyncHandler(async (req, res) => {
    await prisma.roleAssignment.delete({ where: { id: req.params.id } });
    res.status(204).end();
  })
);

// ---- Expense line items ----
// `q` does a case-insensitive substring match against name (server-side
// backstop for SearchableSelect, which otherwise filters client-side against
// the already-fetched ~230-row catalog).
adminRouter.get(
  "/expense-line-items",
  asyncHandler(async (req, res) => {
    const status = (req.query.status as string | undefined) ?? "STANDARD";
    const category = req.query.category as string | undefined;
    const q = req.query.q as string | undefined;
    const items = await prisma.expenseLineItem.findMany({
      where: {
        status: status as any,
        ...(category ? { category } : {}),
        ...(q ? { name: { contains: q, mode: "insensitive" } } : {}),
      },
      include: { company: true },
      orderBy: [{ category: "asc" }, { name: "asc" }],
    });
    res.json(items);
  })
);

adminRouter.get(
  "/expense-line-items/categories",
  asyncHandler(async (_req, res) => {
    const items = await prisma.expenseLineItem.findMany({
      where: { status: "STANDARD" },
      select: { category: true },
      distinct: ["category"],
      orderBy: { category: "asc" },
    });
    res.json(items.map((i) => i.category));
  })
);

const extraFieldOptionSchema = z.object({ label: z.string(), value: z.number().nullable() });
const extraFieldSchema = z.object({
  label: z.string(),
  required: z.boolean(),
  type: z.enum(["TEXT", "NUMBER", "DROPDOWN"]),
  options: z.array(extraFieldOptionSchema).optional(),
});

const expenseLineItemSchema = z.object({
  name: z.string().min(1),
  category: z.string().min(1).optional(),
  glAccount: z.string().min(1),
  costCenter: z.string().min(1),
  ownerDepartmentId: z.string(),
  companyId: z.string().nullable().optional(),
  requiresMobilePolicy: z.boolean().optional(),
  sampleCharges: z.string().nullable().optional(),
  extraFieldsConfig: z.array(extraFieldSchema).optional(),
});

adminRouter.post(
  "/expense-line-items",
  requireRole(RoleType.BUDGET_OFFICER),
  asyncHandler(async (req, res) => {
    const body = expenseLineItemSchema.parse(req.body);
    const created = await prisma.expenseLineItem.create({
      data: { ...body, managedBy: req.user!.id },
    });
    res.status(201).json(created);
  })
);

adminRouter.patch(
  "/expense-line-items/:id",
  requireRole(RoleType.BUDGET_OFFICER),
  asyncHandler(async (req, res) => {
    const body = expenseLineItemSchema.partial().parse(req.body);
    const updated = await prisma.expenseLineItem.update({
      where: { id: req.params.id },
      data: body,
    });
    res.json(updated);
  })
);

// Custom/unlisted expense submissions awaiting Budget Officer refinement (FR-1.14).
adminRouter.get(
  "/expense-line-items/pending-refinement",
  requireRole(RoleType.BUDGET_OFFICER),
  asyncHandler(async (_req, res) => {
    const items = await prisma.expenseLineItem.findMany({
      where: { status: "PENDING_REFINEMENT" },
      orderBy: { createdAt: "asc" },
    });
    res.json(items);
  })
);

const refineSchema = z.object({
  name: z.string().min(1),
  glAccount: z.string().min(1),
  costCenter: z.string().min(1),
});

adminRouter.post(
  "/expense-line-items/:id/refine",
  requireRole(RoleType.BUDGET_OFFICER),
  asyncHandler(async (req, res) => {
    const body = refineSchema.parse(req.body);
    const updated = await prisma.expenseLineItem.update({
      where: { id: req.params.id },
      data: { ...body, status: "STANDARD" },
    });
    res.json(updated);
  })
);

// ---- Growth rate: default (Budget Officer) + department overrides (BC&A Head) ----
adminRouter.get(
  "/growth-rate",
  asyncHandler(async (_req, res) => {
    const [config, overrides] = await Promise.all([
      prisma.growthRateConfig.findUnique({ where: { id: "singleton" } }),
      prisma.growthRateOverride.findMany({ include: { department: true } }),
    ]);
    res.json({ default: config?.defaultValue ?? 0, overrides });
  })
);

const growthRateDefaultSchema = z.object({ value: z.number(), reason: z.string().min(1) });

adminRouter.patch(
  "/growth-rate/default",
  requireRole(RoleType.BUDGET_OFFICER),
  asyncHandler(async (req, res) => {
    const { value, reason } = growthRateDefaultSchema.parse(req.body);
    const existing = await prisma.growthRateConfig.findUnique({ where: { id: "singleton" } });

    const updated = await prisma.growthRateConfig.upsert({
      where: { id: "singleton" },
      update: { defaultValue: value, editedBy: req.user!.id },
      create: { id: "singleton", defaultValue: value, editedBy: req.user!.id },
    });

    await prisma.growthRateAuditLog.create({
      data: {
        userId: req.user!.id,
        oldValue: existing?.defaultValue ?? null,
        newValue: value,
        departmentId: null,
        reason,
      },
    });

    res.json(updated);
  })
);

const growthRateOverrideSchema = z.object({
  departmentId: z.string(),
  value: z.number(),
  reason: z.string().min(1),
});

adminRouter.put(
  "/growth-rate/overrides",
  // Notes_2 item 2: Budget Officer can also edit the Departmental Exception
  // Table, alongside BC&A (FR-1.8's original owner).
  requireRole(RoleType.BCA_HEAD, RoleType.BUDGET_OFFICER),
  asyncHandler(async (req, res) => {
    const { departmentId, value, reason } = growthRateOverrideSchema.parse(req.body);
    const existing = await prisma.growthRateOverride.findUnique({ where: { departmentId } });

    const updated = await prisma.growthRateOverride.upsert({
      where: { departmentId },
      update: { value, editedBy: req.user!.id },
      create: { departmentId, value, editedBy: req.user!.id },
    });

    await prisma.growthRateAuditLog.create({
      data: {
        userId: req.user!.id,
        oldValue: existing?.value ?? null,
        newValue: value,
        departmentId,
        reason,
      },
    });

    res.json(updated);
  })
);

adminRouter.delete(
  "/growth-rate/overrides/:departmentId",
  requireRole(RoleType.BCA_HEAD, RoleType.BUDGET_OFFICER),
  asyncHandler(async (req, res) => {
    await prisma.growthRateOverride.delete({ where: { departmentId: req.params.departmentId } });
    res.status(204).end();
  })
);

adminRouter.get(
  "/growth-rate/audit-log",
  requireRole(RoleType.BUDGET_OFFICER, RoleType.BCA_HEAD),
  asyncHandler(async (_req, res) => {
    const logs = await prisma.growthRateAuditLog.findMany({
      include: { department: true },
      orderBy: { timestamp: "desc" },
    });
    res.json(logs);
  })
);

// ---- Workflow stage due dates (FR-1.11) ----
// Global — Notes_2: one due date per named stage, applying to every
// department (no per-department setting).
adminRouter.get(
  "/workflow-stage-config",
  asyncHandler(async (_req, res) => {
    const configs = await prisma.workflowStageConfig.findMany({ orderBy: { stage: "asc" } });
    res.json(configs);
  })
);

const stageConfigSchema = z.object({
  stage: z.enum([
    "FINALIZE_FORECAST",
    "REQUEST_AND_AUTHORIZATION",
    "CENTRALIZED_L1_REVIEW",
    "CENTRALIZED_HEAD_REVIEW",
    "BCA_AND_FINALIZATION",
  ]),
  dueDate: z.string().datetime(),
});

adminRouter.put(
  "/workflow-stage-config",
  requireRole(RoleType.BUDGET_OFFICER),
  asyncHandler(async (req, res) => {
    const { stage, dueDate } = stageConfigSchema.parse(req.body);
    const updated = await prisma.workflowStageConfig.upsert({
      where: { stage },
      update: { dueDate: new Date(dueDate), configuredBy: req.user!.id },
      create: { stage, dueDate: new Date(dueDate), configuredBy: req.user!.id },
    });
    res.json(updated);
  })
);

// ---- Documentation threshold (Field 7) ----
adminRouter.get(
  "/documentation-threshold",
  asyncHandler(async (_req, res) => {
    const config = await prisma.documentationThresholdConfig.findUnique({ where: { id: "singleton" } });
    res.json(config ?? { amount: 0 });
  })
);

adminRouter.put(
  "/documentation-threshold",
  requireRole(RoleType.BUDGET_OFFICER),
  asyncHandler(async (req, res) => {
    const { amount } = z.object({ amount: z.number().min(0) }).parse(req.body);
    const updated = await prisma.documentationThresholdConfig.upsert({
      where: { id: "singleton" },
      update: { amount },
      create: { id: "singleton", amount },
    });
    res.json(updated);
  })
);

// ---- Reason codes (FR-1.31) ----
adminRouter.get(
  "/reason-codes",
  asyncHandler(async (_req, res) => {
    const codes = await prisma.reasonCode.findMany({ where: { active: true }, orderBy: { label: "asc" } });
    res.json(codes);
  })
);

adminRouter.post(
  "/reason-codes",
  requireRole(RoleType.BUDGET_OFFICER),
  asyncHandler(async (req, res) => {
    const { label } = z.object({ label: z.string().min(1) }).parse(req.body);
    const created = await prisma.reasonCode.create({ data: { label } });
    res.status(201).json(created);
  })
);

adminRouter.delete(
  "/reason-codes/:id",
  requireRole(RoleType.BUDGET_OFFICER),
  asyncHandler(async (req, res) => {
    await prisma.reasonCode.update({ where: { id: req.params.id }, data: { active: false } });
    res.status(204).end();
  })
);

// ---- Board-approved budget (FR-1.32) ----
adminRouter.get(
  "/board-approved-budget",
  asyncHandler(async (req, res) => {
    const fiscalYear = Number(req.query.fiscalYear ?? new Date().getFullYear());
    const history = await prisma.boardApprovedBudget.findMany({
      where: { fiscalYear },
      orderBy: { setAt: "desc" },
    });
    res.json({ current: history[0] ?? null, history });
  })
);

adminRouter.post(
  "/board-approved-budget",
  requireRole(RoleType.BUDGET_OFFICER),
  asyncHandler(async (req, res) => {
    const { fiscalYear, amount } = z
      .object({ fiscalYear: z.number().int(), amount: z.number().min(0) })
      .parse(req.body);
    const created = await prisma.boardApprovedBudget.create({
      data: { fiscalYear, amount, setBy: req.user!.id },
    });
    res.status(201).json(created);
  })
);

// ---- Historical actuals reference data (SAP-pull stand-in, FR-1.10/1.19) ----
adminRouter.get(
  "/historical-actuals",
  asyncHandler(async (req, res) => {
    const departmentId = req.query.departmentId as string | undefined;
    const rows = await prisma.historicalActuals.findMany({
      where: departmentId ? { departmentId } : undefined,
      orderBy: { glDescription: "asc" },
    });
    res.json(rows);
  })
);

adminRouter.patch(
  "/historical-actuals/:id",
  requireRole(RoleType.BUDGET_OFFICER),
  asyncHandler(async (req, res) => {
    const body = z
      .object({
        actuals2025: z.number().optional(),
        approvedBudget2026: z.number().optional(),
        ytdActuals2026: z.number().optional(),
      })
      .parse(req.body);
    const updated = await prisma.historicalActuals.update({ where: { id: req.params.id }, data: body });
    res.json(updated);
  })
);
