import { Router } from "express";
import { prisma } from "../prisma";
import { asyncHandler } from "../asyncHandler";
import { requireAuth } from "../middleware/auth";
import { computeRemainingPool, listPoolConsumingRequests } from "../services/budgetCalcService";
import { getFiscalCycle } from "../lib/fiscalCycle";

export const dashboardRouter = Router();

dashboardRouter.use(requireAuth);

// FR-1.6 — Cap / Remaining Pool, recomputed live on every read.
dashboardRouter.get(
  "/:departmentId",
  asyncHandler(async (req, res) => {
    const { targetCalendarYear } = await getFiscalCycle();
    const fiscalYear = Number(req.query.fiscalYear ?? targetCalendarYear);
    const result = await computeRemainingPool(req.params.departmentId, fiscalYear);
    res.json(result);
  })
);

// Drill-down for the "Portal Requests" stat tile — the individual requests
// that make up computeRemainingPool's totalPortalRequests sum.
dashboardRouter.get(
  "/:departmentId/requests",
  asyncHandler(async (req, res) => {
    const { targetCalendarYear } = await getFiscalCycle();
    const fiscalYear = Number(req.query.fiscalYear ?? targetCalendarYear);
    const requests = await listPoolConsumingRequests(req.params.departmentId, fiscalYear);
    res.json(requests);
  })
);

dashboardRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const { targetCalendarYear } = await getFiscalCycle();
    const fiscalYear = Number(req.query.fiscalYear ?? targetCalendarYear);
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
