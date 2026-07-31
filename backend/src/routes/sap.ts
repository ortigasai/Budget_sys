import { Router } from "express";
import { z } from "zod";
import { RequestStage, RoleType } from "@prisma/client";
import { prisma } from "../prisma";
import { asyncHandler } from "../asyncHandler";
import { requireAuth, requireRole } from "../middleware/auth";
import { HttpError } from "../httpError";
import { uploadCostCenterPlanning } from "../services/sapMockAdapter";

export const sapRouter = Router();

sapRouter.use(requireAuth);

// FR-1.33-35 — Budget Officer manually triggers the SAP upload for one or
// more finalized (APPROVED) requests, binds the returned document number,
// and closes the ticket.
sapRouter.post(
  "/upload",
  requireRole(RoleType.BUDGET_OFFICER),
  asyncHandler(async (req, res) => {
    const { budgetRequestIds } = z.object({ budgetRequestIds: z.array(z.string()).min(1) }).parse(req.body);

    const requests = await prisma.budgetRequest.findMany({
      where: { id: { in: budgetRequestIds } },
      include: { expenseLineItem: true },
    });

    const notApproved = requests.filter((r) => r.currentStage !== RequestStage.APPROVED);
    if (notApproved.length > 0) {
      throw new HttpError(400, `${notApproved.length} request(s) are not yet at Approved status.`);
    }
    const alreadyUploaded = requests.filter((r) => r.sapDocumentNumber);
    if (alreadyUploaded.length > 0) {
      throw new HttpError(400, `${alreadyUploaded.length} request(s) already have a bound SAP document number.`);
    }

    const result = await uploadCostCenterPlanning(
      requests.map((r) => ({
        budgetRequestId: r.id,
        glAccount: r.expenseLineItem.glAccount,
        costCenter: r.expenseLineItem.costCenter,
        fiscalYear: r.fiscalYear,
        monthlyAmounts: r.monthlyAmounts as number[],
      }))
    );

    await prisma.budgetRequest.updateMany({
      where: { id: { in: budgetRequestIds } },
      data: { sapDocumentNumber: result.documentNumber, status: "UPLOADED_TO_SAP" },
    });

    res.json(result);
  })
);
