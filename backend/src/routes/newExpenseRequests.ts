import { Router } from "express";
import { z } from "zod";
import { BudgetCodePrefixKind, RoleType } from "@prisma/client";
import { prisma } from "../prisma";
import { asyncHandler } from "../asyncHandler";
import { requireAuth, requireRole } from "../middleware/auth";
import { HttpError } from "../httpError";
import { getFiscalCycle } from "../lib/fiscalCycle";
import { getBudgetCodePrefixCode, nextBudgetCode } from "../lib/budgetCode";
import { buildExpenseLineItemId } from "../lib/expenseLineItemCatalog";

// New GAE Request > "This expense isn't in the standard list": a request to
// add an expense line item to the standard list (schema.prisma's
// NewExpenseRequest). Not a budget request - it skips the budget approval
// chain entirely and goes to the Budget Officer only. Approving it adds the
// line item to the catalog, after which it can be budgeted like any other.
export const newExpenseRequestsRouter = Router();
newExpenseRequestsRouter.use(requireAuth);

async function withPeople<T extends { requestedById: string; decidedById: string | null }>(rows: T[]) {
  const ids = [...new Set(rows.flatMap((r) => [r.requestedById, r.decidedById]).filter((id): id is string => !!id))];
  const users = await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } });
  const nameOf = new Map(users.map((u) => [u.id, u.name]));
  return rows.map((r) => ({
    ...r,
    requestedBy: { id: r.requestedById, name: nameOf.get(r.requestedById) ?? "Unknown" },
    decidedBy: r.decidedById ? { id: r.decidedById, name: nameOf.get(r.decidedById) ?? "Unknown" } : null,
  }));
}

const include = { department: { select: { id: true, name: true } } } as const;

// Submit (any signed-in user) - only the expense's name is required.
newExpenseRequestsRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const body = z
      .object({
        name: z.string().trim().min(1, "Enter the expense's name.").max(200),
        details: z.string().trim().max(4000).optional(),
      })
      .parse(req.body);
    const departmentId = req.user!.departmentId;
    if (!departmentId) throw new HttpError(400, "Your account has no assigned department.");
    const created = await prisma.newExpenseRequest.create({
      data: { name: body.name, details: body.details || null, departmentId, requestedById: req.user!.id },
      include,
    });
    res.status(201).json(created);
  })
);

// The signed-in user's own requests (My Requests).
newExpenseRequestsRouter.get(
  "/mine",
  asyncHandler(async (req, res) => {
    const rows = await prisma.newExpenseRequest.findMany({ where: { requestedById: req.user!.id }, include, orderBy: { createdAt: "desc" } });
    res.json(await withPeople(rows));
  })
);

// Budget Officer's Inbox > New Expense Line Item Requests.
newExpenseRequestsRouter.get(
  "/pending",
  requireRole(RoleType.BUDGET_OFFICER),
  asyncHandler(async (_req, res) => {
    const rows = await prisma.newExpenseRequest.findMany({ where: { status: "PENDING" }, include, orderBy: { createdAt: "asc" } });
    res.json(await withPeople(rows));
  })
);

// Approve: adds the expense to the standard list with the GL-CC, category
// and owning department the Budget Officer fills in. Its id follows the
// catalog's own (category, name, company) scheme, so if it's later added to
// the Expense Line Items workbook too, the upload updates this same row.
newExpenseRequestsRouter.post(
  "/:id/approve",
  requireRole(RoleType.BUDGET_OFFICER),
  asyncHandler(async (req, res) => {
    const body = z
      .object({
        name: z.string().trim().min(1, "Enter the line item's name."),
        category: z.string().trim().min(1, "Enter the expense category."),
        glAccount: z.string().trim().min(1, "Enter the GL Account."),
        costCenter: z.string().trim().min(1, "Enter the Cost Center."),
        ownerDepartmentId: z.string().min(1, "Pick the owning department."),
        description: z.string().trim().optional(),
        note: z.string().trim().optional(),
      })
      .parse(req.body);
    const request = await prisma.newExpenseRequest.findUniqueOrThrow({ where: { id: req.params.id } });
    if (request.status !== "PENDING") throw new HttpError(409, "This request has already been decided.");
    const owner = await prisma.department.findUniqueOrThrow({ where: { id: body.ownerDepartmentId } });

    const id = buildExpenseLineItemId(body.category, body.name, null);
    if (await prisma.expenseLineItem.findUnique({ where: { id } })) {
      throw new HttpError(409, `"${body.name}" is already in the standard list under "${body.category}".`);
    }
    const { targetCalendarYear } = await getFiscalCycle();
    const prefix = await getBudgetCodePrefixCode(BudgetCodePrefixKind.CENTRALIZED_DEPARTMENT, owner.name);
    const budgetCode = prefix ? await nextBudgetCode(prefix, targetCalendarYear) : null;

    const updated = await prisma.$transaction(async (tx) => {
      // isCustom marks it as added through this request (not the workbook),
      // so a later Expense Line Items upload that doesn't list it keeps it.
      const item = await tx.expenseLineItem.create({
        data: {
          id,
          name: body.name,
          category: body.category,
          description: body.description || null,
          glAccount: body.glAccount,
          costCenter: body.costCenter,
          ownerDepartmentId: owner.id,
          isCustom: true,
          status: "STANDARD",
          budgetCode,
          managedBy: req.user!.id,
        },
      });
      return tx.newExpenseRequest.update({
        where: { id: request.id },
        data: { status: "APPROVED", decidedById: req.user!.id, decidedAt: new Date(), decisionNote: body.note || null, expenseLineItemId: item.id },
        include,
      });
    });
    res.json(updated);
  })
);

newExpenseRequestsRouter.post(
  "/:id/disapprove",
  requireRole(RoleType.BUDGET_OFFICER),
  asyncHandler(async (req, res) => {
    const { note } = z.object({ note: z.string().trim().min(1, "Add a comment saying why.") }).parse(req.body);
    const request = await prisma.newExpenseRequest.findUniqueOrThrow({ where: { id: req.params.id } });
    if (request.status !== "PENDING") throw new HttpError(409, "This request has already been decided.");
    res.json(
      await prisma.newExpenseRequest.update({
        where: { id: request.id },
        data: { status: "DISAPPROVED", decidedById: req.user!.id, decidedAt: new Date(), decisionNote: note },
        include,
      })
    );
  })
);
