import { Router } from "express";
import { z } from "zod";
import multer from "multer";
import { BudgetCodePrefixKind, RequestCategory, RoleType, Sbu } from "@prisma/client";
import { prisma } from "../prisma";
import { asyncHandler } from "../asyncHandler";
import { requireAuth, requireRole } from "../middleware/auth";
import { HttpError } from "../httpError";
import { overrideExpenseLineItemsFromUpload } from "../services/expenseLineItemService";
import { parseForecastTemplate, syncHistoricalActualsFromSap } from "../services/historicalActualsService";
import { applyEmployeeImport, parseEmployeesBuffer } from "../lib/employeeImport";
import { CORE_CENTRALIZED_DEPARTMENT_NAMES } from "../lib/coreDepartments";
import { getFiscalCycle } from "../lib/fiscalCycle";
import { NPC_SBU_VALUES } from "../lib/npcSbu";

export const adminRouter = Router();

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

adminRouter.use(requireAuth);

// ---- Departments (read-only reference data, any authenticated user) ----
adminRouter.get(
  "/departments",
  asyncHandler(async (_req, res) => {
    const departments = await prisma.department.findMany({ orderBy: { name: "asc" } });
    res.json(departments);
  })
);

// Spec item 13: assigns a Department to one of NPC's 8 SBUs, so Budget
// Utilization Tracking's NPC view can scope a user's visibility by their own
// department's SBU (see backend-py's routers/utilization.py).
const departmentSbuSchema = z.object({ sbu: z.enum(NPC_SBU_VALUES).nullable() });

adminRouter.patch(
  "/departments/:id",
  requireRole(RoleType.BUDGET_OFFICER),
  asyncHandler(async (req, res) => {
    const { sbu } = departmentSbuSchema.parse(req.body);
    const updated = await prisma.department.update({ where: { id: req.params.id }, data: { sbu } });
    res.json(updated);
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

// SAP Requirements integration - Manpower's admin-configurable Company ->
// Cost Center / Pay Component -> GL Account mapping (see
// manpowerService.ts's runManpowerRecompute, which pulls real KSSB V1
// actuals for any (payComponent, company) pair with both set).
const companyCostCenterSchema = z.object({ costCenter: z.string().trim().min(1).nullable() });

adminRouter.patch(
  "/companies/:id",
  requireRole(RoleType.BUDGET_OFFICER),
  asyncHandler(async (req, res) => {
    const { costCenter } = companyCostCenterSchema.parse(req.body);
    const updated = await prisma.company.update({ where: { id: req.params.id }, data: { costCenter } });
    res.json(updated);
  })
);

adminRouter.get(
  "/pay-components",
  asyncHandler(async (_req, res) => {
    const payComponents = await prisma.payComponent.findMany({ orderBy: { sortOrder: "asc" } });
    res.json(payComponents);
  })
);

const payComponentGlAccountSchema = z.object({ glAccount: z.string().trim().min(1).nullable() });

adminRouter.patch(
  "/pay-components/:id",
  requireRole(RoleType.BUDGET_OFFICER),
  asyncHandler(async (req, res) => {
    const { glAccount } = payComponentGlAccountSchema.parse(req.body);
    const updated = await prisma.payComponent.update({ where: { id: req.params.id }, data: { glAccount } });
    res.json(updated);
  })
);

// Notes_7: the curated "real" centralized departments (see
// lib/coreDepartments.ts) — gates the Home dashboard's Cap & Pool cards and
// the sidebar's Forecast link, as distinct from the ~65 CENTRALIZED
// Department rows that exist just for employee/role tracking.
adminRouter.get(
  "/core-departments",
  asyncHandler(async (_req, res) => {
    const departments = await prisma.department.findMany({
      where: { name: { in: CORE_CENTRALIZED_DEPARTMENT_NAMES } },
      orderBy: { name: "asc" },
    });
    res.json(departments);
  })
);

// ---- Positions (read-only reference data, from Employee List column I) -
// Notes_6: backs the Additional Headcount Request form's Position dropdown.
adminRouter.get(
  "/positions",
  asyncHandler(async (_req, res) => {
    const positions = await prisma.position.findMany({ orderBy: { title: "asc" } });
    res.json(positions);
  })
);

// Notes_7: "Upload Employee List to update the list of employees to choose
// from and their corresponding departments" - re-runs the same import the
// seed script uses, from an uploaded file instead of the fixed source file.
// Matches by employeeIdNumber, so existing users keep their email/login;
// only name/department/positions refresh. New department names (column J)
// not already in the system are created rather than force-mapped onto the
// existing curated department list.
adminRouter.post(
  "/employees/upload",
  requireRole(RoleType.BUDGET_OFFICER),
  upload.single("file"),
  asyncHandler(async (req, res) => {
    if (!req.file) throw new HttpError(400, "No file uploaded.");
    const employees = await parseEmployeesBuffer(req.file.buffer);
    if (employees.length === 0) throw new HttpError(400, "No valid employee rows found in the uploaded file.");
    const result = await applyEmployeeImport(prisma, employees);
    res.json(result);
  })
);

// ---- Fiscal cycle: which month the 2026 cycle is "as of" (Forecast's own
// control), plus the Target Calendar Year + open/close gate (FR-1.15 #2,
// Budget Cycle admin tab). One singleton row, one route - callers send
// whichever fields they own; unset fields keep their current value (or the
// schema default on first-ever create). Closing cycleOpen blocks new budget
// requests via assertCycleOpen() in workflowService.ts.
adminRouter.get(
  "/fiscal-cycle",
  asyncHandler(async (_req, res) => {
    const config = await prisma.fiscalCycleConfig.findUnique({ where: { id: "singleton" } });
    res.json(config ?? { asOfMonth2026: 9, targetCalendarYear: 2027, cycleOpen: true });
  })
);

const fiscalCycleUpdateSchema = z.object({
  asOfMonth2026: z.number().int().min(1).max(12).optional(),
  targetCalendarYear: z.number().int().min(2000).max(2100).optional(),
  cycleOpen: z.boolean().optional(),
});

adminRouter.put(
  "/fiscal-cycle",
  requireRole(RoleType.BUDGET_OFFICER),
  asyncHandler(async (req, res) => {
    const fields = fiscalCycleUpdateSchema.parse(req.body);
    const updated = await prisma.fiscalCycleConfig.upsert({
      where: { id: "singleton" },
      update: { ...fields, updatedBy: req.user!.id },
      create: {
        id: "singleton",
        asOfMonth2026: fields.asOfMonth2026 ?? 9,
        targetCalendarYear: fields.targetCalendarYear ?? 2027,
        cycleOpen: fields.cycleOpen ?? true,
        updatedBy: req.user!.id,
      },
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

// ---- Budget Code prefixes: GAE's Centralized Department abbreviations
// (kind=CENTRALIZED_DEPARTMENT, import-time fallback only) and NPC's
// Head-per-SBU abbreviations (kind=NPC_HEAD, used by the NPC request form's
// Head picker and validated server-side at request creation). Read is public
// to any authenticated user (the NPC form needs NPC_HEAD options); writes are
// Budget-Officer-only, same as every other admin config list.
adminRouter.get(
  "/budget-code-prefixes",
  asyncHandler(async (req, res) => {
    const kind = req.query.kind as BudgetCodePrefixKind | undefined;
    const prefixes = await prisma.budgetCodePrefix.findMany({
      where: kind ? { kind } : undefined,
      orderBy: [{ kind: "asc" }, { sortOrder: "asc" }, { label: "asc" }],
    });
    res.json(prefixes);
  })
);

const budgetCodePrefixSchema = z.object({
  kind: z.nativeEnum(BudgetCodePrefixKind),
  label: z.string().min(1),
  code: z.string().min(1),
  sortOrder: z.number().int().optional(),
});

adminRouter.post(
  "/budget-code-prefixes",
  requireRole(RoleType.BUDGET_OFFICER),
  asyncHandler(async (req, res) => {
    const body = budgetCodePrefixSchema.parse(req.body);
    const created = await prisma.budgetCodePrefix.create({ data: body });
    res.status(201).json(created);
  })
);

adminRouter.patch(
  "/budget-code-prefixes/:id",
  requireRole(RoleType.BUDGET_OFFICER),
  asyncHandler(async (req, res) => {
    const body = budgetCodePrefixSchema.partial().parse(req.body);
    const updated = await prisma.budgetCodePrefix.update({ where: { id: req.params.id }, data: body });
    res.json(updated);
  })
);

adminRouter.delete(
  "/budget-code-prefixes/:id",
  requireRole(RoleType.BUDGET_OFFICER),
  asyncHandler(async (req, res) => {
    await prisma.budgetCodePrefix.delete({ where: { id: req.params.id } });
    res.status(204).end();
  })
);

// Forecast's GAE/DOE/NPC/Revenue sub-menu classification. A HistoricalActuals
// row whose (glAccount, costCenter) has no entry here defaults to GAE — see
// historicalActualsService.ts.
adminRouter.get(
  "/forecast-category-mappings",
  asyncHandler(async (_req, res) => {
    const mappings = await prisma.forecastCategoryMapping.findMany({ orderBy: [{ category: "asc" }, { glAccount: "asc" }] });
    res.json(mappings);
  })
);

const forecastCategoryMappingSchema = z.object({
  glAccount: z.string().min(1),
  costCenter: z.string().min(1),
  category: z.nativeEnum(RequestCategory),
});

adminRouter.post(
  "/forecast-category-mappings",
  requireRole(RoleType.BUDGET_OFFICER),
  asyncHandler(async (req, res) => {
    const body = forecastCategoryMappingSchema.parse(req.body);
    const created = await prisma.forecastCategoryMapping.create({ data: body });
    res.status(201).json(created);
  })
);

adminRouter.patch(
  "/forecast-category-mappings/:id",
  requireRole(RoleType.BUDGET_OFFICER),
  asyncHandler(async (req, res) => {
    const body = forecastCategoryMappingSchema.partial().parse(req.body);
    const updated = await prisma.forecastCategoryMapping.update({ where: { id: req.params.id }, data: body });
    res.json(updated);
  })
);

adminRouter.delete(
  "/forecast-category-mappings/:id",
  requireRole(RoleType.BUDGET_OFFICER),
  asyncHandler(async (req, res) => {
    await prisma.forecastCategoryMapping.delete({ where: { id: req.params.id } });
    res.status(204).end();
  })
);

// Phase 3's DOE-stream roles (BU_FINANCE_HEAD/BU_HEAD/BU_FINANCE_OFFICER) are
// assigned per-SBU rather than per-Department - see SbuRoleAssignment in
// schema.prisma. Mirrors the /role-assignments routes below exactly.
const SBU_ROLE_TYPES = [RoleType.BU_FINANCE_HEAD, RoleType.BU_HEAD, RoleType.BU_FINANCE_OFFICER] as const;

adminRouter.get(
  "/sbu-role-assignments",
  requireRole(RoleType.BUDGET_OFFICER),
  asyncHandler(async (req, res) => {
    const sbu = req.query.sbu as Sbu | undefined;
    const assignments = await prisma.sbuRoleAssignment.findMany({
      where: sbu ? { sbu } : undefined,
      include: { user: true },
      orderBy: [{ sbu: "asc" }, { roleType: "asc" }],
    });
    res.json(assignments);
  })
);

const sbuRoleAssignmentSchema = z.object({
  sbu: z.nativeEnum(Sbu),
  roleType: z.enum(SBU_ROLE_TYPES),
  userId: z.string().min(1),
});

adminRouter.post(
  "/sbu-role-assignments",
  requireRole(RoleType.BUDGET_OFFICER),
  asyncHandler(async (req, res) => {
    const body = sbuRoleAssignmentSchema.parse(req.body);
    const created = await prisma.sbuRoleAssignment.create({
      data: { ...body, assignedById: req.user!.id },
      include: { user: true },
    });
    res.status(201).json(created);
  })
);

adminRouter.delete(
  "/sbu-role-assignments/:id",
  requireRole(RoleType.BUDGET_OFFICER),
  asyncHandler(async (req, res) => {
    await prisma.sbuRoleAssignment.delete({ where: { id: req.params.id } });
    res.status(204).end();
  })
);

// Notes_6: Role Assignments tab's new "Email address" field - lets the
// Budget Officer correct a user's login email (e.g. the auto-generated
// first.last@ortigas.com.ph placeholder from the Employee List import)
// before assigning them a role.
const updateUserSchema = z.object({ email: z.string().email() });
adminRouter.patch(
  "/users/:id",
  requireRole(RoleType.BUDGET_OFFICER),
  asyncHandler(async (req, res) => {
    const { email } = updateUserSchema.parse(req.body);
    try {
      const updated = await prisma.user.update({
        where: { id: req.params.id },
        data: { email: email.trim().toLowerCase() },
      });
      res.json(updated);
    } catch (err: any) {
      if (err.code === "P2002") throw new HttpError(409, "Another user already has that email address.");
      throw err;
    }
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
// `requesterDepartmentId` is the Notes_7 visibility filter: pass the current
// user's own department id (as the Standard Request picker does) to only
// get back rows with no visibility restriction, or restricted to that exact
// department. Omit it (as the Admin Console's catalog table does) to see
// every row regardless of restriction — a management view, not the picker.
// The Budget department is exempt from the restriction — Budget Officers see
// every expense line item regardless of its `visibleToDepartmentId`.
adminRouter.get(
  "/expense-line-items",
  asyncHandler(async (req, res) => {
    const status = (req.query.status as string | undefined) ?? "STANDARD";
    const category = req.query.category as string | undefined;
    const q = req.query.q as string | undefined;
    const requesterDepartmentId = req.query.requesterDepartmentId as string | undefined;
    const requesterDepartment = requesterDepartmentId
      ? await prisma.department.findUnique({ where: { id: requesterDepartmentId } })
      : null;
    const applyVisibilityFilter = !!requesterDepartmentId && requesterDepartment?.name !== "Budget";
    const items = await prisma.expenseLineItem.findMany({
      where: {
        status: status as any,
        ...(category ? { category } : {}),
        ...(q ? { name: { contains: q, mode: "insensitive" } } : {}),
        ...(applyVisibilityFilter
          ? { OR: [{ visibleToDepartmentId: null }, { visibleToDepartmentId: requesterDepartmentId }] }
          : {}),
      },
      include: { company: true, ownerDepartment: true, visibleToDepartment: true },
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
  description: z.string().nullable().optional(),
  glAccount: z.string().min(1),
  costCenter: z.string().min(1),
  ownerDepartmentId: z.string(),
  companyId: z.string().nullable().optional(),
  requiresMobilePolicy: z.boolean().optional(),
  sampleCharges: z.string().nullable().optional(),
  spendGridComputation: z.string().nullable().optional(),
  spendGridFrequency: z.string().nullable().optional(),
  visibleToDepartmentId: z.string().nullable().optional(),
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

// "Upload Template" (override mode): the uploaded file becomes the new
// source of truth for the STANDARD catalog — rows in the file are
// created/updated, existing rows not in the file are removed (unless an
// existing request references them, in which case they're kept and
// reported back rather than breaking that request's foreign key).
adminRouter.post(
  "/expense-line-items/template-upload",
  requireRole(RoleType.BUDGET_OFFICER),
  upload.single("file"),
  asyncHandler(async (req, res) => {
    if (!req.file) throw new HttpError(400, "No file uploaded.");
    const result = await overrideExpenseLineItemsFromUpload(req.file.buffer, req.user!.id);
    res.status(result.ok ? 200 : 400).json(result);
  })
);

adminRouter.delete(
  "/expense-line-items/:id",
  requireRole(RoleType.BUDGET_OFFICER),
  asyncHandler(async (req, res) => {
    const requestCount = await prisma.budgetRequest.count({ where: { expenseLineItemId: req.params.id } });
    if (requestCount > 0) {
      throw new HttpError(409, `Can't remove — ${requestCount} existing request(s) reference this line item.`);
    }
    await prisma.expenseLineItem.delete({ where: { id: req.params.id } });
    res.status(204).end();
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
// Notes_8: "put separate fields for" GAE / DOE x 5 SBUs / Revenue x 5 SBUs
// (11 figures total) instead of one flat number. Returns every history row
// for the fiscal year across all category/SBU scopes in one call — Step5
// derives the "current" figure per scope client-side (latest setAt wins),
// same append-only history-log pattern as before, just no longer scoped to
// a single row per year.
adminRouter.get(
  "/board-approved-budget",
  asyncHandler(async (req, res) => {
    const { targetCalendarYear } = await getFiscalCycle();
    const fiscalYear = Number(req.query.fiscalYear ?? targetCalendarYear);
    const history = await prisma.boardApprovedBudget.findMany({
      where: { fiscalYear },
      orderBy: { setAt: "desc" },
    });
    res.json({ history });
  })
);

adminRouter.post(
  "/board-approved-budget",
  requireRole(RoleType.BUDGET_OFFICER),
  asyncHandler(async (req, res) => {
    const { fiscalYear, amount, requestCategory, sbu } = z
      .object({
        fiscalYear: z.number().int(),
        amount: z.number().min(0),
        requestCategory: z.nativeEnum(RequestCategory).default(RequestCategory.GAE),
        sbu: z.nativeEnum(Sbu).optional(),
      })
      .parse(req.body);
    // GAE and NPC each get one flat figure (NPC's breakdown dimension is
    // Head, not SBU - a separate concept, not tracked per-Head here); DOE
    // and Revenue are broken down per the 5 SBUs and require one.
    if ((requestCategory === RequestCategory.DOE || requestCategory === RequestCategory.REVENUE) && !sbu) {
      throw new HttpError(400, "Select an SBU for this category.");
    }
    const created = await prisma.boardApprovedBudget.create({
      data: {
        fiscalYear,
        amount,
        requestCategory,
        sbu: requestCategory === RequestCategory.GAE ? undefined : sbu,
        setBy: req.user!.id,
      },
    });
    res.status(201).json(created);
  })
);

// ---- Historical actuals reference data (SAP-pull stand-in, FR-1.10/1.19) ----
adminRouter.get(
  "/historical-actuals",
  asyncHandler(async (req, res) => {
    const departmentId = req.query.departmentId as string | undefined;
    const { targetCalendarYear } = await getFiscalCycle();
    const rows = await prisma.historicalActuals.findMany({
      where: { fiscalYear: targetCalendarYear, ...(departmentId ? { departmentId } : {}) },
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

// Notes_6 (Forecast section): Budget Officer uploads an Excel with Expense
// Line Item / 2026 Approved Budget / 2026 YTD Actuals - these then show on
// the requesting departments' Forecast page, where they only edit the
// remaining months.
adminRouter.post(
  "/historical-actuals/upload",
  requireRole(RoleType.BUDGET_OFFICER),
  upload.single("file"),
  asyncHandler(async (req, res) => {
    if (!req.file) throw new HttpError(400, "No file uploaded.");
    const result = await parseForecastTemplate(req.file.buffer);
    res.status(result.ok ? 200 : 400).json(result);
  })
);

// Real-SAP-data alternative to the manual upload above - see
// syncHistoricalActualsFromSap()'s own doc comment for the CC-GL matching
// limitation (a GL-CC pair shared by more than one catalog item can't be
// auto-resolved and is reported back instead, not silently guessed at).
adminRouter.post(
  "/historical-actuals/sync-sap",
  requireRole(RoleType.BUDGET_OFFICER),
  asyncHandler(async (_req, res) => {
    const result = await syncHistoricalActualsFromSap();
    res.json(result);
  })
);
