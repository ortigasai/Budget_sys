import { Router } from "express";
import { z } from "zod";
import multer from "multer";
import path from "node:path";
import fs from "node:fs";
import crypto from "node:crypto";
import { RequestCategory, RequestStage, Sbu } from "@prisma/client";
import { prisma } from "../prisma";
import { asyncHandler } from "../asyncHandler";
import { requireAuth } from "../middleware/auth";
import { HttpError } from "../httpError";
import { assertSfSbu } from "../lib/groupScope";
import { assertCycleOpen, submitRequest } from "../services/workflowService";
import { getFiscalCycle } from "../lib/fiscalCycle";
import { nextBudgetCode, sbuBudgetCodePrefix } from "../lib/budgetCode";
import { sbuBatchCategoryLabel } from "../lib/sbuBatchCategories";
import { parseRevenueTemplate, type RevenueTemplateRow } from "../lib/revenueTemplate";

// DOE's own "Upload Template" flow - same draft-first, review-as-one-batch
// mechanics Revenue's batches use (revenueBatches.ts), but deliberately NOT
// Revenue's dedicated SBU-Finance review chain: once a batch is submitted,
// its rows fan out into the category's normal review chain (submitRequest
// below) and are tracked individually from then on, same as a
// manually-created request of that category always has been. That's why
// this router only ever deals with DRAFT batches - once submitted, a batch's
// rows can diverge in stage (different reviewers, different days), so
// there's nothing left for a "batch view" to usefully show; the existing
// /budget-requests/my-requests, Inbox, and Step5 already surface those rows
// individually, unchanged.
//
// Originally DOE-only; generalized into a factory so Commission, Cost of
// Sales, Depreciation & Amortization, and Interest Expense (which share
// DOE's exact SBU+Company template/upload/routing shape - see
// approvalChain.ts's SBU_BATCH_CATEGORIES) reuse the same logic instead of
// four near-duplicate route files.
//
// Row shape: a raw Cost Center + GL Account pair, NOT a catalog Expense Line
// Item - confirmed against the real "SAP Upload validation.xlsx" sample,
// every one of these categories' SAP tabs (MallsDOE/OfficesDOE/EstatesDOE/
// RBUcommission/RBUcos/Depreciation/Interest) is Cost Center/Cost Element/
// Jan-Dec, never a line-item name, and none of those CC/GL codes exist in
// this app's (GAE-shaped) ExpenseLineItem catalog at all. So this reuses
// Revenue's exact CC/GL template shape/parser (lib/revenueTemplate.ts) and
// creates each BudgetRequest with expenseLineItemId left null and
// costCenter/glAccount set directly instead - unlike Revenue, no ad-hoc
// ExpenseLineItem row is created per row.
export function createSbuBatchRouter(category: RequestCategory): Router {
  const router = Router();

  router.use(requireAuth);

  const uploadDir = path.resolve(process.env.UPLOAD_DIR ?? "./uploads");
  fs.mkdirSync(uploadDir, { recursive: true });
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

  const uploadFieldsSchema = z.object({
    sbu: z.nativeEnum(Sbu),
    companyId: z.string().min(1),
    fiscalYear: z.coerce.number().int(),
  });

  async function createBatchRows(
    batchId: string,
    departmentId: string,
    fiscalYear: number,
    sbu: Sbu,
    createdById: string,
    targetCalendarYear: number,
    parsedRows: RevenueTemplateRow[]
  ) {
    for (const row of parsedRows) {
      // Same fresh-Budget-Code-per-row convention the old one-shot DOE bulk
      // upload used (lib/budgetCode.ts) - this upload is many independent
      // requests riding through review together, not one combined total.
      const budgetCode = await nextBudgetCode(sbuBudgetCodePrefix(sbu), targetCalendarYear);
      await prisma.budgetRequest.create({
        data: {
          departmentId,
          fiscalYear,
          monthlyAmounts: row.monthlyAmounts,
          proposedAmount: row.total,
          businessJustification: `${sbuBatchCategoryLabel(category)} Budget Request - CC ${row.costCenter} / GL ${row.glAccount}`,
          costCenter: row.costCenter,
          glAccount: row.glAccount,
          requestCategory: category,
          sbu,
          budgetCode,
          bulkUploadBatchId: batchId,
          createdById,
        },
      });
    }
  }

router.post(
  "/",
  upload.single("file"),
  asyncHandler(async (req, res) => {
    if (!req.file) throw new HttpError(400, "Upload the completed Budget Request Template.");
    await assertCycleOpen();
    const departmentId = req.user!.departmentId;
    if (!departmentId) throw new HttpError(400, "Your account has no assigned department to originate a request from.");

    const { sbu, companyId, fiscalYear } = uploadFieldsSchema.parse(req.body);
    await assertSfSbu(req.user!, sbu);
    await prisma.company.findUniqueOrThrow({ where: { id: companyId } }).catch(() => {
      throw new HttpError(400, "Unrecognized Company selection.");
    });

    const { targetCalendarYear } = await getFiscalCycle();
    const parsed = await parseRevenueTemplate(req.file.buffer);

    const fileName = `${crypto.randomUUID()}-${req.file.originalname}`;
    fs.writeFileSync(path.join(uploadDir, fileName), req.file.buffer);

    const batch = await prisma.bulkUploadBatch.create({
      data: {
        uploadedById: req.user!.id,
        departmentId,
        fiscalYear,
        sourceFileRef: fileName,
        rowCount: parsed.rows.length,
        status: "COMPLETED",
        sbu,
        companyId,
      },
    });
    await createBatchRows(batch.id, departmentId, fiscalYear, sbu, req.user!.id, targetCalendarYear, parsed.rows);

    res.status(201).json(await loadBatchDetail(batch.id));
  })
);

router.post(
  "/:id/upload",
  upload.single("file"),
  asyncHandler(async (req, res) => {
    if (!req.file) throw new HttpError(400, "Upload the completed Budget Request Template.");
    const batch = await prisma.bulkUploadBatch.findUniqueOrThrow({ where: { id: req.params.id } });
    if (batch.uploadedById !== req.user!.id) {
      throw new HttpError(403, "You can only override your own requests.");
    }
    const existingRows = await prisma.budgetRequest.findMany({ where: { bulkUploadBatchId: batch.id } });
    if (existingRows.some((r) => r.currentStage !== RequestStage.DRAFT)) {
      throw new HttpError(409, "This request has already been sent for review and can no longer be overridden - cancel it and create a new one instead.");
    }
    if (!batch.sbu) throw new HttpError(500, "Batch is missing its SBU.");

    const { targetCalendarYear } = await getFiscalCycle();
    const parsed = await parseRevenueTemplate(req.file.buffer);

    const fileName = `${crypto.randomUUID()}-${req.file.originalname}`;
    fs.writeFileSync(path.join(uploadDir, fileName), req.file.buffer);

    await prisma.$transaction([
      prisma.budgetRequest.deleteMany({ where: { bulkUploadBatchId: batch.id } }),
      prisma.bulkUploadBatch.update({
        where: { id: batch.id },
        data: {
          sourceFileRef: fileName,
          rowCount: parsed.rows.length,
          status: "COMPLETED",
        },
      }),
    ]);
    await createBatchRows(batch.id, batch.departmentId, batch.fiscalYear, batch.sbu, req.user!.id, targetCalendarYear, parsed.rows);

    res.json(await loadBatchDetail(batch.id));
  })
);

router.post(
  "/:id/submit",
  asyncHandler(async (req, res) => {
    const batch = await prisma.bulkUploadBatch.findUniqueOrThrow({ where: { id: req.params.id } });
    if (batch.uploadedById !== req.user!.id) {
      throw new HttpError(403, "You can only submit your own requests.");
    }
    const rows = await prisma.budgetRequest.findMany({ where: { bulkUploadBatchId: batch.id } });
    if (rows.length === 0) throw new HttpError(404, "Batch has no rows.");
    if (!rows.every((r) => r.currentStage === RequestStage.DRAFT)) {
      throw new HttpError(409, "This batch has already been submitted.");
    }

    // Each row travels DOE's normal review chain independently from here on
    // (same submitRequest the old one-shot DOE bulk upload already used, in
    // the same per-row try/catch shape) - a row that can't auto-submit (the
    // attachment-threshold case) is left in DRAFT for the requestor to
    // finish manually rather than failing the whole batch.
    const submitErrors: { row: string; error: string }[] = [];
    for (const row of rows) {
      try {
        await submitRequest(row.id);
      } catch (err) {
        if (err instanceof HttpError && err.message.includes("attachments")) {
          submitErrors.push({ row: row.budgetCode ?? row.id, error: err.message });
          continue;
        }
        throw err;
      }
    }

    res.json({ ...(await loadBatchDetail(batch.id)), submitErrors });
  })
);

router.post(
  "/:id/cancel",
  asyncHandler(async (req, res) => {
    const batch = await prisma.bulkUploadBatch.findUniqueOrThrow({ where: { id: req.params.id } });
    if (batch.uploadedById !== req.user!.id) {
      throw new HttpError(403, "You can only cancel your own requests.");
    }
    const rows = await prisma.budgetRequest.findMany({ where: { bulkUploadBatchId: batch.id } });
    if (!rows.every((r) => r.currentStage === RequestStage.DRAFT)) {
      throw new HttpError(409, "This batch has already been submitted and can no longer be cancelled here.");
    }
    await prisma.budgetRequest.updateMany({
      where: { bulkUploadBatchId: batch.id },
      data: { currentStage: RequestStage.CANCELLED, status: "CANCELLED" },
    });
    res.json(await loadBatchDetail(batch.id));
  })
);

async function loadBatchDetail(batchId: string) {
  const batch = await prisma.bulkUploadBatch.findUniqueOrThrow({ where: { id: batchId } });
  const rows = await prisma.budgetRequest.findMany({
    where: { bulkUploadBatchId: batchId },
    orderBy: { createdAt: "asc" },
  });
  const company = batch.companyId ? await prisma.company.findUnique({ where: { id: batch.companyId } }) : null;
  return {
    id: batch.id,
    fiscalYear: batch.fiscalYear,
    sbu: batch.sbu,
    company: company ? { id: company.id, name: company.name, code: company.code } : null,
    sourceFileRef: batch.sourceFileRef,
    rowCount: rows.length,
    totalAmount: rows.reduce((sum, r) => sum + r.proposedAmount, 0),
    currentStage: rows[0]?.currentStage ?? RequestStage.CANCELLED,
    status: rows[0]?.status ?? "CANCELLED",
    createdAt: batch.createdAt,
    validationErrors: (batch.validationErrors as { row: number; error: string }[] | null) ?? [],
    rows: rows.map((r) => ({
      id: r.id,
      costCenter: r.costCenter,
      glAccount: r.glAccount,
      budgetCode: r.budgetCode,
      proposedAmount: r.proposedAmount,
      currentStage: r.currentStage,
    })),
  };
}

// Only DRAFT batches - see the module comment above for why a submitted
// batch's rows are no longer meaningfully "one batch" to list here.
router.get(
  "/mine",
  asyncHandler(async (req, res) => {
    const batches = await prisma.bulkUploadBatch.findMany({
      where: { uploadedById: req.user!.id, sbu: { not: null } },
      include: { budgetRequests: true },
      orderBy: { createdAt: "desc" },
    });
    const draftDoeBatchIds = batches
      .filter((b) => b.budgetRequests.length > 0 && b.budgetRequests.every((r) => r.requestCategory === category && r.currentStage === RequestStage.DRAFT))
      .map((b) => b.id);
    res.json(await Promise.all(draftDoeBatchIds.map(loadBatchDetail)));
  })
);

router.get(
  "/:id",
  asyncHandler(async (req, res) => {
    res.json(await loadBatchDetail(req.params.id));
  })
);

  return router;
}

export const doeBatchesRouter = createSbuBatchRouter(RequestCategory.DOE);
