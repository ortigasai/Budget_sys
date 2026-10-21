import { Router } from "express";
import { prisma } from "../prisma";
import { asyncHandler } from "../asyncHandler";
import { RequestCategory, RoleType } from "@prisma/client";
import { requireAuth, requireRoleOrAccess } from "../middleware/auth";
import { computeRemainingPool, listPoolConsumingRequests } from "../services/budgetCalcService";
import { getFiscalCycle } from "../lib/fiscalCycle";
import { CORE_CENTRALIZED_DEPARTMENT_NAMES } from "../lib/coreDepartments";
import { NPC_UNCOUNTED_STAGES } from "../services/boardCheckReport";

export const dashboardRouter = Router();

dashboardRouter.use(requireAuth);

// The Budget Officer's Home page: company-wide totals instead of one
// department's card. GAE = every core department's Cap & Pool added up (each
// with its own growth rate), plus the Board-Approved G&A figure; NPC = the
// Board-Approved NPC Budget (Original + Additions/Reductions, all NPC SBUs)
// against its Total Approved and Proposed requests. Registered before
// "/:departmentId" so "totals" isn't read as a department id.
dashboardRouter.get(
  "/totals",
  requireRoleOrAccess([RoleType.BUDGET_OFFICER], "finalization"),
  asyncHandler(async (req, res) => {
    const { targetCalendarYear } = await getFiscalCycle();
    const fiscalYear = Number(req.query.fiscalYear ?? targetCalendarYear);

    const core = await prisma.department.findMany({ where: { name: { in: CORE_CENTRALIZED_DEPARTMENT_NAMES } } });
    const pools = await Promise.all(core.map((d) => computeRemainingPool(d.id, fiscalYear)));
    const sum = (pick: (p: (typeof pools)[number]) => number) => pools.reduce((s, p) => s + pick(p), 0);

    const history = await prisma.boardApprovedBudget.findMany({ where: { fiscalYear }, orderBy: { setAt: "desc" } });
    const boardGae = history.find((h) => h.requestCategory === RequestCategory.GAE)?.amount ?? null;
    // Latest Original + latest Additions/Reductions per NPC SBU.
    const npcLatest = new Map<string, number>();
    for (const h of history) {
      if (h.requestCategory !== RequestCategory.NPC || !h.npcSbu) continue;
      const k = `${h.npcSbu}|${h.isAdjustment}`;
      if (!npcLatest.has(k)) npcLatest.set(k, h.amount);
    }
    const boardNpc = npcLatest.size ? [...npcLatest.values()].reduce((s, v) => s + v, 0) : null;
    const npcRequests = await prisma.budgetRequest.findMany({
      where: { requestCategory: RequestCategory.NPC, fiscalYear, currentStage: { notIn: NPC_UNCOUNTED_STAGES } },
      select: { proposedAmount: true, budgetCutAmount: true, currentStage: true },
    });
    const npcApproved = npcRequests.filter((r) => r.currentStage === "APPROVED").reduce((s, r) => s + r.proposedAmount - r.budgetCutAmount, 0);
    const npcProposed = npcRequests.filter((r) => r.currentStage !== "APPROVED").reduce((s, r) => s + r.proposedAmount - r.budgetCutAmount, 0);

    res.json({
      fiscalYear,
      gae: {
        departmentCount: core.length,
        cap: sum((p) => p.value),
        actualsYtd2026: sum((p) => p.actualsYtd2026),
        remainingForecast2026: sum((p) => p.remainingForecast2026),
        portalRequests: sum((p) => p.totalPortalRequests),
        remainingPool: sum((p) => p.remainingPool),
        boardApproved: boardGae,
      },
      npc: {
        boardApproved: boardNpc,
        approved: npcApproved,
        proposed: npcProposed,
        requestCount: npcRequests.length,
        available: (boardNpc ?? 0) - npcApproved - npcProposed,
      },
    });
  })
);

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
