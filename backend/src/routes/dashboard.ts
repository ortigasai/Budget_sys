import { Router } from "express";
import { prisma } from "../prisma";
import { asyncHandler } from "../asyncHandler";
import { requireAuth } from "../middleware/auth";
import { computeRemainingPool } from "../services/budgetCalcService";

export const dashboardRouter = Router();

dashboardRouter.use(requireAuth);

// FR-1.6 — Cap / Remaining Pool, recomputed live on every read.
dashboardRouter.get(
  "/:departmentId",
  asyncHandler(async (req, res) => {
    const fiscalYear = Number(req.query.fiscalYear ?? 2027);
    const result = await computeRemainingPool(req.params.departmentId, fiscalYear);
    res.json(result);
  })
);

dashboardRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const fiscalYear = Number(req.query.fiscalYear ?? 2027);
    const departments = await prisma.department.findMany();
    const results = await Promise.all(
      departments.map(async (d) => ({
        department: d,
        ...(await computeRemainingPool(d.id, fiscalYear)),
      }))
    );
    res.json(results);
  })
);
