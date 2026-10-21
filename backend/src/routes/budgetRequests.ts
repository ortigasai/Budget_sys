import { Router } from "express";
import { z } from "zod";
import multer from "multer";
import path from "node:path";
import fs from "node:fs";
import ExcelJS from "exceljs";
import { Prisma, RequestCategory, RequestStage, RoleType, Sbu } from "@prisma/client";
import { prisma } from "../prisma";
import { asyncHandler } from "../asyncHandler";
import { hasRole, requireAuth, requireRole, requireRoleOrAccess } from "../middleware/auth";
import { assertFullFinalizationAccess, assertNpcSbu, finalizationViewScope, inFinalizationScope } from "../lib/groupScope";
import { HttpError } from "../httpError";
import { getFiscalCycle } from "../lib/fiscalCycle";
import { getFinalizedBudgetLineDetails, getFinalizedBudgetReport } from "../services/finalizedBudgetReportService";
import { buildSapUploadTemplate, SapTemplateError } from "../services/sapUploadTemplate";
import { computeDepartmentalCap, POOL_CONSUMING_STAGES } from "../services/budgetCalcService";
import { buildBoardApprovedPageReport, buildBoardCheckReport, NPC_UNCOUNTED_STAGES } from "../services/boardCheckReport";
import { nextBudgetCode, nextTicketNumber, sbuBudgetCodePrefix } from "../lib/budgetCode";
import { NPC_LOCATION_VALUES, NPC_SBU_OPTIONS, NPC_SBU_VALUES, npcSbuBudgetCodePrefix } from "../lib/npcSbu";
import { resolveBudgetRequestPendingReviewers } from "../lib/pendingReviewers";
import {
  applyBudgetCut,
  assertCycleOpen,
  cancelRequest,
  decideRequest,
  finalizeAtStep5,
  reassignRequest,
  returnAtStep5,
  submitRequest,
  userCanAct,
  userCanCancel,
} from "../services/workflowService";
import { ACTIVE_STAGES, chainFor, nextStageAfter, previousStageBefore } from "../services/approvalChain";

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
  // Lets a bulk-uploaded request's card offer "Download source file" without
  // an extra round trip - see bulkUpload.ts's new source-file route.
  bulkUploadBatch: { select: { id: true, sourceFileRef: true } },
} satisfies Prisma.BudgetRequestInclude;

// ---- Create (Step 1) ----
const createSchema = z.object({
  fiscalYear: z.number().int(),
  expenseLineItemId: z.string().optional(),
  customExpenseName: z.string().optional(),
  // NPC's form has no 12-month spend grid or Business Justification field
  // (see StandardRequestTab.tsx vs the new NpcRequestTab.tsx) - both are
  // optional here and auto-derived server-side for that category below.
  monthlyAmounts: z.array(z.number()).length(12).optional(),
  businessJustification: z.string().min(1).optional(),
  otherRequiredFields: z.record(z.string()).optional(),
  // Notes_8: GAE is the original "Expense" form; DOE is the same form
  // tagged with a required SBU (see StandardRequestTab.tsx).
  requestCategory: z.nativeEnum(RequestCategory).optional(),
  sbu: z.nativeEnum(Sbu).optional(),
  // NPC: superseded by npcSbu below for requests created after spec item
  // 12's revision - kept for back-compat with older rows/clients only.
  npcHeadCode: z.string().optional(),
  // NPC (spec item 12 revision) - distinct required fields from GAE/DOE.
  npcSbu: z.enum(NPC_SBU_VALUES).optional(),
  npcLocation: z.enum(NPC_LOCATION_VALUES).optional(),
  projectTitle: z.string().min(1).optional(),
  projectStartDate: z.coerce.date().optional(),
  projectEndDate: z.coerce.date().optional(),
  costCenter: z.string().min(1).optional(),
  amount: z.number().positive().optional(), // VAT exclusive
  // Approval Workflow: picked from the employee list on the submission form.
  departmentHeadId: z.string().min(1).optional(),
  sbuHeadId: z.string().min(1).optional(),
  centralizedHeadId: z.string().min(1).optional(),
});

budgetRequestsRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const body = createSchema.parse(req.body);

    await assertCycleOpen();

    // FR-1.15 #1 — Originating Department is read-only and auto-defaults to
    // the Requestor's assigned unit based on system login; it is never
    // client-supplied.
    const departmentId = req.user!.departmentId;
    if (!departmentId) {
      throw new HttpError(400, "Your account has no assigned department to originate a request from.");
    }

    const requestCategory = body.requestCategory ?? RequestCategory.GAE;

    // NPC (spec item 12 revision): its own required-fields set, distinct
    // from GAE/DOE - no expense line item picker, spend grid, or business
    // justification collected from the requestor.
    if (requestCategory === RequestCategory.NPC) {
      if (!body.npcSbu) throw new HttpError(400, "Select an SBU for this Non-Project Capex request.");
      await assertNpcSbu(req.user!, body.npcSbu);
      if (!body.npcLocation) throw new HttpError(400, "Select a Location for this Non-Project Capex request.");
      if (!body.projectTitle) throw new HttpError(400, "Enter a Project Title.");
      if (!body.projectStartDate || !body.projectEndDate) throw new HttpError(400, "Enter both a Project Start and Project End date.");
      if (!body.costCenter) throw new HttpError(400, "Enter a Cost Center.");
      if (!body.amount) throw new HttpError(400, "Enter an Amount.");

      const { targetCalendarYear } = await getFiscalCycle();
      const budgetCode = await nextBudgetCode(npcSbuBudgetCodePrefix(body.npcSbu, body.npcLocation), targetCalendarYear);
      const ticketNumber = await nextTicketNumber(targetCalendarYear);

      const expenseLineItem = await prisma.expenseLineItem.create({
        data: {
          name: body.projectTitle,
          glAccount: "PENDING",
          costCenter: body.costCenter,
          category: "Non-Project Capex",
          ownerDepartmentId: departmentId,
          isCustom: true,
          status: "PENDING_REFINEMENT",
        },
      });

      const monthlyAmounts = Array(12).fill(0);
      monthlyAmounts[0] = body.amount; // VAT-exclusive flat amount, no monthly spread collected

      const created = await prisma.budgetRequest.create({
        data: {
          departmentId,
          fiscalYear: body.fiscalYear,
          expenseLineItemId: expenseLineItem.id,
          monthlyAmounts,
          proposedAmount: body.amount,
          businessJustification: `NPC Project: ${body.projectTitle}`,
          otherRequiredFields: {},
          requestCategory,
          npcSbu: body.npcSbu,
          npcLocation: body.npcLocation,
          projectTitle: body.projectTitle,
          projectStartDate: body.projectStartDate,
          projectEndDate: body.projectEndDate,
          budgetCode,
          ticketNumber,
          departmentHeadId: body.departmentHeadId,
          sbuHeadId: body.sbuHeadId,
          createdById: req.user!.id,
        },
        include: DETAIL_INCLUDE,
      });

      res.status(201).json(created);
      return;
    }

    if (!body.expenseLineItemId && !body.customExpenseName) {
      throw new HttpError(400, "Select an expense line item or provide a custom expense name.");
    }
    if (!body.monthlyAmounts) {
      throw new HttpError(400, "Provide the monthly spend grid.");
    }
    if (!body.businessJustification) {
      throw new HttpError(400, "Provide a business justification.");
    }
    if (requestCategory === RequestCategory.DOE && !body.sbu) {
      throw new HttpError(400, "Select an SBU for this Direct Operating Expenses request.");
    }

    const { targetCalendarYear } = await getFiscalCycle();
    const ticketNumber = await nextTicketNumber(targetCalendarYear);

    // DOE gets a fresh "SBU-YY-Num" Budget Code at creation (GAE's is read
    // from expenseLineItem.budgetCode instead - see lib/budgetCode.ts).
    let budgetCode: string | undefined;
    if (requestCategory === RequestCategory.DOE) {
      budgetCode = await nextBudgetCode(sbuBudgetCodePrefix(body.sbu!), targetCalendarYear);
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
        requestCategory,
        sbu: requestCategory === RequestCategory.DOE ? body.sbu : undefined,
        budgetCode,
        ticketNumber,
        departmentHeadId: body.departmentHeadId,
        centralizedHeadId: body.centralizedHeadId,
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
    if (body.departmentHeadId !== undefined) data.departmentHeadId = body.departmentHeadId;
    if (body.sbuHeadId !== undefined) data.sbuHeadId = body.sbuHeadId;
    if (body.centralizedHeadId !== undefined) data.centralizedHeadId = body.centralizedHeadId;

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
    // The approver drop-downs can be filled in at submission time (drafts made
    // by bulk upload never had them).
    const picks = z.object({ departmentHeadId: z.string().min(1).optional(), sbuHeadId: z.string().min(1).optional(), centralizedHeadId: z.string().min(1).optional() }).parse(req.body ?? {});
    if (picks.departmentHeadId || picks.sbuHeadId || picks.centralizedHeadId) {
      await prisma.budgetRequest.update({ where: { id: req.params.id }, data: picks });
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
    const updated = await cancelRequest(req.params.id, req.user!, typeof req.body?.comment === "string" ? req.body.comment : undefined);
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
    const withPendingReviewers = await Promise.all(
      requests.map(async (r) => ({ ...r, pendingReviewers: await resolveBudgetRequestPendingReviewers(r) }))
    );
    res.json(withPendingReviewers);
  })
);

// Requests waiting on the current user's action: every request sitting at an
// active stage whose current-stage rule (a dropdown pick / reassignment, or the
// stage's role scoped to the request's department / SBU) names this user - see
// services/approvalChain.ts's canActOnStage. The Budget Officer's final
// Finalize & Upload stage is worked from Budget Finalization, not here.
budgetRequestsRouter.get(
  "/inbox",
  asyncHandler(async (req, res) => {
    const candidates = await prisma.budgetRequest.findMany({
      where: { currentStage: { in: ACTIVE_STAGES.filter((s) => s !== RequestStage.BUDGET_OFFICER_REVIEW) } },
      include: DETAIL_INCLUDE,
      orderBy: { updatedAt: "asc" },
    });
    const acted = candidates.filter((r) => userCanAct(req.user!, r));
    res.json(
      await Promise.all(
        acted.map(async (r) => {
          const nextStage = nextStageAfter(r, r.currentStage);
          return {
            ...r,
            canAct: true,
            nextStage,
            previousStage: previousStageBefore(r, r.currentStage),
            nextPendingReviewers: nextStage ? await resolveBudgetRequestPendingReviewers(r, nextStage) : [],
          };
        })
      )
    );
  })
);

// Requests this user has personally decided on, most-recent decision first —
// so an approval/return isn't a dead end once it leaves the inbox queue.
budgetRequestsRouter.get(
  "/reviewed-by-me",
  asyncHandler(async (req, res) => {
    const requests = await prisma.budgetRequest.findMany({
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

// FR-1.27 — Step 5 dashboard: Budget Officer's queue grouped by centralized
// department, GL category, and expense line item.
budgetRequestsRouter.get(
  "/step5-dashboard",
  asyncHandler(async (req, res) => {
    const allRequests = await prisma.budgetRequest.findMany({
      where: { currentStage: RequestStage.BUDGET_OFFICER_REVIEW },
      include: DETAIL_INCLUDE,
      orderBy: { updatedAt: "asc" },
    });
    // SBU Finance members only see their own SBU(s)' requests (their
    // Consolidated Board-Approved P&L compares against these).
    const scope = await finalizationViewScope(req.user!);
    const requests = scope ? allRequests.filter((r) => inFinalizationScope(scope, r)) : allRequests;
    // The "Return…" dropdown's own stages - this category's chain, minus the
    // Budget Officer Review stage every one of these requests is already at.
    res.json(
      requests.map((r) => ({
        ...r,
        returnTargets: chainFor(r as unknown as Parameters<typeof chainFor>[0]).filter((s) => s !== RequestStage.BUDGET_OFFICER_REVIEW),
      }))
    );
  })
);

// Phase 3's Internal Order Request form (spec item 9) needs a plain list of
// approved NPC budget codes to fund an IO from - open to any authenticated
// user (like the expense catalog), not Budget-Officer-gated the way the
// finalized-budget report is, since any requestor can create an IO request.
budgetRequestsRouter.get(
  "/approved-npc-codes",
  asyncHandler(async (_req, res) => {
    const requests = await prisma.budgetRequest.findMany({
      where: { requestCategory: RequestCategory.NPC, currentStage: RequestStage.APPROVED, budgetCode: { not: null } },
      include: { expenseLineItem: { select: { name: true } } },
      orderBy: { budgetCode: "asc" },
    });
    res.json(
      requests.map((r) => ({
        id: r.id,
        budgetCode: r.budgetCode,
        npcHeadCode: r.npcHeadCode,
        npcSbu: r.npcSbu,
        expenseLineItemName: r.expenseLineItem!.name,
      })),
    );
  })
);

// Note 11 §3 - Budget-Officer-only report over FinalizedBudgetLine (the
// "finalize & upload" snapshot). Mounted before the "/:id" catch-all below
// so this literal path is never shadowed by it, same ordering care already
// documented for bulkUploadRouter in app.ts.
const finalizedBudgetReportQuerySchema = z.object({
  fiscalYear: z.coerce.number().int(),
  requestCategory: z.nativeEnum(RequestCategory).optional(),
  sbu: z.nativeEnum(Sbu).optional(),
  npcSbu: z.string().optional(),
  search: z.string().optional(),
});

budgetRequestsRouter.get(
  "/finalized-budget-report",
  requireRoleOrAccess([RoleType.BUDGET_OFFICER], "finalization"),
  asyncHandler(async (req, res) => {
    const filter = finalizedBudgetReportQuerySchema.parse(req.query);
    const report = await getFinalizedBudgetReport(filter);
    // SBU Finance members (Consolidated Board-Approved P&L only) see their own SBU(s).
    const scope = await finalizationViewScope(req.user!);
    if (scope) {
      report.lines = report.lines.filter((l) => inFinalizationScope(scope, l));
      report.boardBudgetChecks = report.boardBudgetChecks.filter((c) => inFinalizationScope(scope, c));
    }
    res.json(report);
  })
);

// The individual requests behind one Finalized Budget Report row, opened
// from its "# Requests" count. Same grouping key as the report above, but
// every field required - this always names one exact row, not a filter.
const finalizedBudgetLineDetailsQuerySchema = z.object({
  fiscalYear: z.coerce.number().int(),
  requestCategory: z.nativeEnum(RequestCategory),
  sbu: z.nativeEnum(Sbu).optional(),
  npcSbu: z.string().optional(),
  glAccount: z.string(),
  costCenter: z.string(),
});

budgetRequestsRouter.get(
  "/finalized-budget-report/group-details",
  requireRoleOrAccess([RoleType.BUDGET_OFFICER], "finalization"),
  asyncHandler(async (req, res) => {
    await assertFullFinalizationAccess(req.user!);
    const filter = finalizedBudgetLineDetailsQuerySchema.parse(req.query);
    res.json(await getFinalizedBudgetLineDetails({ ...filter, sbu: filter.sbu ?? null, npcSbu: filter.npcSbu ?? null }));
  })
);

// "Board-Approved Budget vs. Total Finalized" as its own Excel report, laid
// out like the Consolidated Board-Approved P&L grid - see
// services/boardCheckReport.ts. Choices: sections (Consolidated P&L, NPC),
// figures (Board-Approved, Total Finalized, Board-Approved vs Total
// Finalized) and one SBU or all.
const csvList = <T extends string>(values: readonly [T, ...T[]]) =>
  z
    .string()
    .transform((v) => v.split(",").filter(Boolean))
    .pipe(z.array(z.enum(values)).min(1));
const boardCheckExportQuerySchema = z.object({
  fiscalYear: z.coerce.number().int(),
  sections: csvList(["PL", "NPC"] as const),
  measures: csvList(["BOARD", "FINALIZED", "VARIANCE"] as const),
  sbu: z.nativeEnum(Sbu).optional(),
});

budgetRequestsRouter.get(
  "/finalized-budget-report/board-check-export",
  requireRoleOrAccess([RoleType.BUDGET_OFFICER], "finalization"),
  asyncHandler(async (req, res) => {
    await assertFullFinalizationAccess(req.user!);
    const { buffer, filename } = await buildBoardCheckReport(boardCheckExportQuerySchema.parse(req.query));
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.send(buffer);
  })
);

// "Generate Report" on the Consolidated Board-Approved P&L and Board-Approved
// NPC Budget pages: the page as shown, as Excel (services/boardCheckReport.ts).
// SBU Finance viewers get their own SBU only, same as the pages themselves.
const boardApprovedExportQuerySchema = z.object({
  fiscalYear: z.coerce.number().int(),
  page: z.enum(["PL", "NPC"]),
  sbu: z.nativeEnum(Sbu).optional(),
});

budgetRequestsRouter.get(
  "/board-approved-export",
  requireRoleOrAccess([RoleType.BUDGET_OFFICER], "finalization"),
  asyncHandler(async (req, res) => {
    const query = boardApprovedExportQuerySchema.parse(req.query);
    const scope = await finalizationViewScope(req.user!);
    if (scope && query.page === "PL" && (!query.sbu || !scope.sbus.includes(query.sbu))) {
      throw new HttpError(403, "You can only generate the report for your own SBU.");
    }
    const { buffer, filename } = await buildBoardApprovedPageReport({ ...query, npcSbus: scope && query.page === "NPC" ? scope.npcSbus : undefined });
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.send(buffer);
  })
);

const sapTemplateQuerySchema = z.object({
  fiscalYear: z.coerce.number().int(),
  requestCategory: z.nativeEnum(RequestCategory),
  sbu: z.nativeEnum(Sbu).optional(),
});

budgetRequestsRouter.get(
  "/finalized-budget-report/sap-template",
  requireRoleOrAccess([RoleType.BUDGET_OFFICER], "finalization"),
  asyncHandler(async (req, res) => {
    await assertFullFinalizationAccess(req.user!);
    const query = sapTemplateQuerySchema.parse(req.query);
    let built;
    try {
      built = await buildSapUploadTemplate(query);
    } catch (err) {
      if (err instanceof SapTemplateError) throw new HttpError(400, err.message);
      throw err;
    }
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="${built.filename}"`);
    res.send(built.buffer);
  })
);

budgetRequestsRouter.get(
  "/finalized-budget-report/export",
  requireRoleOrAccess([RoleType.BUDGET_OFFICER], "finalization"),
  asyncHandler(async (req, res) => {
    await assertFullFinalizationAccess(req.user!);
    const filter = finalizedBudgetReportQuerySchema.parse(req.query);
    const report = await getFinalizedBudgetReport(filter);

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet(`Finalized Budget ${filter.fiscalYear}`);
    sheet.addRow(["Category", "SBU", "NPC SBU", "Ticket #", "Budget Code", "Cost Center", "Cost Center Name", "GL Account", "GL Account Name", "Request", "Budget Cut", "Approved", "# Requests"]);
    sheet.getRow(1).font = { bold: true };
    for (const line of report.lines) {
      sheet.addRow([
        line.requestCategory,
        line.sbu ?? "",
        line.npcSbu ?? "",
        line.ticketNumbers.join(", "),
        line.budgetCodes.join(", "),
        line.costCenter,
        line.costCenterName ?? "",
        line.glAccount,
        line.glAccountName ?? "",
        line.requestedAmount,
        line.budgetCutAmount,
        line.amount,
        line.lineCount,
      ]);
    }
    sheet.columns.forEach((col) => {
      col.width = 18;
    });

    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="finalized-budget-${filter.fiscalYear}.xlsx"`);
    await workbook.xlsx.write(res);
    res.end();
  })
);

// Board-Approved NPC Budget page: per NPC SBU, its Total Approved and
// Proposed NPC requests for the year, net of budget cuts - approved means
// fully approved, proposed means submitted and still in review at any stage
// (drafts, returned, rejected and cancelled requests don't count).
// Registered before GET /:id so the path isn't read as an id.
budgetRequestsRouter.get(
  "/npc-approved-totals",
  requireRoleOrAccess([RoleType.BUDGET_OFFICER], "finalization"),
  asyncHandler(async (req, res) => {
    const fiscalYear = Number(req.query.fiscalYear);
    if (!Number.isInteger(fiscalYear)) throw new HttpError(400, "fiscalYear is required.");
    // SBU Finance members only see their own NPC SBU(s).
    const scope = await finalizationViewScope(req.user!);
    const requests = await prisma.budgetRequest.findMany({
      where: { requestCategory: "NPC", fiscalYear, currentStage: { notIn: NPC_UNCOUNTED_STAGES }, ...(scope ? { npcSbu: { in: scope.npcSbus } } : {}) },
      select: {
        id: true,
        npcSbu: true,
        npcLocation: true,
        currentStage: true,
        proposedAmount: true,
        budgetCutAmount: true,
        ticketNumber: true,
        budgetCode: true,
        projectTitle: true,
        department: { select: { name: true } },
      },
      orderBy: { createdAt: "asc" },
    });
    // Per NPC SBU: the two totals, plus the requests behind them so the page
    // can list what makes up each figure.
    const totals: Record<
      string,
      {
        approved: number;
        proposed: number;
        requests: { id: string; ticketNumber: string | null; budgetCode: string | null; projectTitle: string | null; location: string | null; department: string; stage: RequestStage; amount: number }[];
      }
    > = {};
    for (const r of requests) {
      if (!r.npcSbu) continue;
      const t = (totals[r.npcSbu] ??= { approved: 0, proposed: 0, requests: [] });
      const amount = r.proposedAmount - r.budgetCutAmount;
      if (r.currentStage === RequestStage.APPROVED) t.approved += amount;
      else t.proposed += amount;
      t.requests.push({
        id: r.id,
        ticketNumber: r.ticketNumber,
        budgetCode: r.budgetCode,
        projectTitle: r.projectTitle,
        location: r.npcLocation,
        department: r.department.name,
        stage: r.currentStage,
        amount,
      });
    }
    res.json(totals);
  })
);

// The budget picture a reviewer sees beside a request (Inbox and the
// request's own page), for NPC and GAE:
//   - NPC: its NPC SBU's Total Board-Approved NPC Budget (Original +
//     Additions/Reductions); null until the Budget Officer sets it.
//   - GAE: its owning centralized department's Departmental Budget Cap (the
//     same pool as the Home page's Cap & Pool card); null when that
//     department has no forecast to build a cap from.
// Against it: other requests already fully approved, other requests still
// pending approval, and this request - all net of budget cuts, and never
// counting this request among the "other" figures.
budgetRequestsRouter.get(
  "/:id/budget-summary",
  asyncHandler(async (req, res) => {
    const request = await prisma.budgetRequest.findUniqueOrThrow({
      where: { id: req.params.id },
      include: { expenseLineItem: { select: { ownerDepartmentId: true, ownerDepartment: { select: { name: true } } } } },
    });
    const net = (rows: { proposedAmount: number; budgetCutAmount: number }[]) => rows.reduce((sum, r) => sum + r.proposedAmount - r.budgetCutAmount, 0);
    const amountFields = { proposedAmount: true, budgetCutAmount: true } as const;

    if (request.requestCategory === "NPC" && request.npcSbu) {
      const latestBoard = (isAdjustment: boolean) =>
        prisma.boardApprovedBudget.findFirst({
          where: { fiscalYear: request.fiscalYear, requestCategory: "NPC", npcSbu: request.npcSbu, isAdjustment },
          orderBy: { setAt: "desc" },
        });
      const [original, adjustment] = await Promise.all([latestBoard(false), latestBoard(true)]);
      const others = { requestCategory: RequestCategory.NPC, npcSbu: request.npcSbu, fiscalYear: request.fiscalYear, id: { not: request.id } };
      const [approved, pending] = await Promise.all([
        prisma.budgetRequest.findMany({ where: { ...others, currentStage: RequestStage.APPROVED }, select: amountFields }),
        prisma.budgetRequest.findMany({ where: { ...others, currentStage: { notIn: [...NPC_UNCOUNTED_STAGES, RequestStage.APPROVED] } }, select: amountFields }),
      ]);
      res.json({
        kind: "NPC",
        fiscalYear: request.fiscalYear,
        scope: NPC_SBU_OPTIONS.find((o) => o.value === request.npcSbu)?.label ?? request.npcSbu,
        budget: original || adjustment ? (original?.amount ?? 0) + (adjustment?.amount ?? 0) : null,
        approvedToDate: net(approved),
        approvedCount: approved.length,
        pendingOthers: net(pending),
        pendingCount: pending.length,
        thisRequest: request.proposedAmount - request.budgetCutAmount,
      });
      return;
    }

    if (request.requestCategory === "GAE" && request.expenseLineItem) {
      const ownerId = request.expenseLineItem.ownerDepartmentId;
      const cap = await computeDepartmentalCap(ownerId, request.fiscalYear);
      const hasForecast = (await prisma.historicalActuals.count({ where: { departmentId: ownerId, fiscalYear: request.fiscalYear } })) > 0;
      const others = { fiscalYear: request.fiscalYear, expenseLineItem: { ownerDepartmentId: ownerId }, id: { not: request.id } };
      const [approved, pending] = await Promise.all([
        prisma.budgetRequest.findMany({ where: { ...others, currentStage: RequestStage.APPROVED }, select: amountFields }),
        prisma.budgetRequest.findMany({ where: { ...others, currentStage: { in: POOL_CONSUMING_STAGES.filter((s) => s !== RequestStage.APPROVED) } }, select: amountFields }),
      ]);
      res.json({
        kind: "GAE",
        fiscalYear: request.fiscalYear,
        scope: request.expenseLineItem.ownerDepartment.name,
        budget: hasForecast ? cap.value : null,
        approvedToDate: net(approved),
        approvedCount: approved.length,
        pendingOthers: net(pending),
        pendingCount: pending.length,
        thisRequest: request.proposedAmount - request.budgetCutAmount,
      });
      return;
    }

    res.json(null);
  })
);

budgetRequestsRouter.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const request = await prisma.budgetRequest.findUniqueOrThrow({
      where: { id: req.params.id },
      include: DETAIL_INCLUDE,
    });
    // Who a RETURN decision sent the request to - targetStage null means the
    // requestor (not: "not recorded"; RETURN rows logged before this field
    // existed also read null, and show as "Requestor" even if they actually
    // went to an earlier stage).
    const reviewDecisions = await Promise.all(
      request.reviewDecisions.map(async (d) => ({
        ...d,
        targetPendingReviewers:
          d.decision !== "RETURN" ? undefined : d.targetStage === null ? [request.createdBy.name] : await resolveBudgetRequestPendingReviewers(request, d.targetStage),
      }))
    );
    res.json({
      ...request,
      reviewDecisions,
      canAct: userCanAct(req.user!, request),
      canCancel: userCanCancel(req.user!, request),
      pendingReviewers: await resolveBudgetRequestPendingReviewers(request),
      nextStage: nextStageAfter(request, request.currentStage),
      previousStage: previousStageBefore(request, request.currentStage),
      nextPendingReviewers: nextStageAfter(request, request.currentStage)
        ? await resolveBudgetRequestPendingReviewers(request, nextStageAfter(request, request.currentStage)!)
        : [],
    });
  })
);

// ---- Workflow decisions ----
// One decision route for every approval stage (see services/approvalChain.ts):
// proceed to the next stage, return to the previous stage, or return to the
// requestor - plus reassign the current stage to anyone.
budgetRequestsRouter.post(
  "/:id/decision",
  asyncHandler(async (req, res) => {
    const { decision, comment } = z
      .object({ decision: z.enum(["APPROVE", "RETURN_PREVIOUS", "RETURN_REQUESTOR"]), comment: z.string().optional() })
      .parse(req.body);
    res.json(await decideRequest(req.params.id, req.user!, decision, comment));
  })
);

// Inbox's "Approve Selected" - same single-request decideRequest as above,
// called once per id, sequentially (an admin action, not a high-throughput
// path - not worth the complexity of parallelizing writes that could race
// each other). Every per-item check decideRequest already enforces (role
// assignment, due dates, the GAE forecast-completeness gate, the
// Budget-Officer-stage block) still runs for each one - a failing item is
// reported, never silently skipped or force-approved.
budgetRequestsRouter.post(
  "/bulk-decision",
  asyncHandler(async (req, res) => {
    const { ids, comment } = z.object({ ids: z.array(z.string().min(1)).min(1), comment: z.string().optional() }).parse(req.body);
    const succeeded: string[] = [];
    const failed: { id: string; error: string }[] = [];
    for (const id of ids) {
      try {
        await decideRequest(id, req.user!, "APPROVE", comment);
        succeeded.push(id);
      } catch (err) {
        failed.push({ id, error: err instanceof Error ? err.message : "Unknown error" });
      }
    }
    res.json({ succeeded, failed });
  })
);

// My Requests' multi-select and the upload pages' "Submit All": submit or
// cancel several of the requestor's own requests in one go. Each item runs
// the same checks as its single-request route; failures are reported per
// item, not skipped.
budgetRequestsRouter.post(
  "/bulk-action",
  asyncHandler(async (req, res) => {
    const { ids, action, approverId } = z
      .object({ ids: z.array(z.string().min(1)).min(1), action: z.enum(["SUBMIT", "CANCEL"]), approverId: z.string().min(1).optional() })
      .parse(req.body);
    const succeeded: string[] = [];
    const failed: { id: string; error: string }[] = [];
    for (const id of ids) {
      try {
        if (action === "SUBMIT") {
          const request = await prisma.budgetRequest.findUniqueOrThrow({ where: { id } });
          if (request.createdById !== req.user!.id) throw new HttpError(403, "You can only submit your own requests.");
          // One approver picked for the whole selection: it fills whichever
          // approver this request's first stage needs - the Centralized
          // Department Head for a GAE request raised by its own centralized
          // department (see submitRequest), the Department Head otherwise.
          if (approverId && request.currentStage === "DRAFT") {
            const lineItem = request.requestCategory === "GAE" && request.expenseLineItemId ? await prisma.expenseLineItem.findUnique({ where: { id: request.expenseLineItemId } }) : null;
            const ownDept =
              !!lineItem &&
              (await prisma.roleAssignment.count({
                where: { userId: request.createdById, departmentId: lineItem.ownerDepartmentId, roleType: { in: ["CENTRALIZED_BUDGET_PREPARER", "CENTRALIZED_FIRST_LEVEL_REVIEWER"] } },
              })) > 0;
            await prisma.budgetRequest.update({ where: { id }, data: ownDept ? { centralizedHeadId: approverId } : { departmentHeadId: approverId } });
          }
          await submitRequest(id);
        } else {
          await cancelRequest(id, req.user!);
        }
        succeeded.push(id);
      } catch (err) {
        failed.push({ id, error: err instanceof Error ? err.message : "Unknown error" });
      }
    }
    res.json({ succeeded, failed });
  })
);

budgetRequestsRouter.post(
  "/:id/reassign",
  asyncHandler(async (req, res) => {
    const { userId, comment } = z.object({ userId: z.string().min(1), comment: z.string().optional() }).parse(req.body);
    res.json(await reassignRequest(req.params.id, req.user!, userId, comment));
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
          "BUDGET_OFFICER_VALIDATION",
          "SF_VALIDATION",
          "SF_HEAD_REVIEW",
          "SBU_HEAD_REVIEW",
          "BUDGET_OFFICER_ROUTING",
          "REQUESTOR",
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
