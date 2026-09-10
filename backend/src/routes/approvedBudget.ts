import { Router } from "express";
import { z } from "zod";
import { RequestCategory, RoleType, Sbu } from "@prisma/client";
import { asyncHandler } from "../asyncHandler";
import { hasRole, hasSbuRole, requireAuth } from "../middleware/auth";
import { HttpError } from "../httpError";
import { getFiscalCycle } from "../lib/fiscalCycle";
import { getFinalizedBudgetReport, type FinalizedBudgetReport } from "../services/finalizedBudgetReportService";

export const approvedBudgetRouter = Router();

approvedBudgetRouter.use(requireAuth);

// Note 11 §4 - "Approved Budget" (new Module 1 sidebar section). Access is
// SBU Finance Officer/Head (SbuRoleAssignment, same roles Transfers already
// use) scoped to their own SBU, or the Budget Officer for any SBU - not
// ReportAccessTab.tsx's flat per-user grant, which is a different, unscoped
// mechanism used only by Phase 4 Reports.
const CORPORATE_NPC_SBUS = ["CORPORATE_IT", "CORPORATE_HR", "CORPORATE_ADMIN"];
// The 5 real-estate Sbu enum values and NPC's own 8-value SBU list share the
// same literal strings for these 5 - see lib/npcSbu.ts.
const REAL_ESTATE_SBUS: Sbu[] = [Sbu.RESIDENTIAL, Sbu.MALLS, Sbu.OFFICES, Sbu.ESTATES, Sbu.LEISURE];

approvedBudgetRouter.get(
  "/:sbu",
  asyncHandler(async (req, res) => {
    const sbu = z.nativeEnum(Sbu).parse(req.params.sbu);
    const canViewAny = hasRole(req.user, RoleType.BUDGET_OFFICER);
    const canViewThisSbu = canViewAny || hasSbuRole(req.user, RoleType.BU_FINANCE_OFFICER, sbu) || hasSbuRole(req.user, RoleType.BU_FINANCE_HEAD, sbu);
    if (!canViewThisSbu) {
      throw new HttpError(403, "You do not have Approved Budget access for this SBU.");
    }

    const { targetCalendarYear } = await getFiscalCycle();
    const fiscalYear = Number(req.query.fiscalYear ?? targetCalendarYear);

    let doe: FinalizedBudgetReport | null = null;
    let revenue: FinalizedBudgetReport | null = null;
    let npc: FinalizedBudgetReport | null = null;
    let gae: FinalizedBudgetReport | null = null;

    if (REAL_ESTATE_SBUS.includes(sbu)) {
      [doe, revenue] = await Promise.all([
        getFinalizedBudgetReport({ fiscalYear, requestCategory: RequestCategory.DOE, sbu }),
        getFinalizedBudgetReport({ fiscalYear, requestCategory: RequestCategory.REVENUE, sbu }),
      ]);
      npc = await getFinalizedBudgetReport({ fiscalYear, requestCategory: RequestCategory.NPC, npcSbu: sbu });
    } else {
      // CORPORATE: GAE has no sbu (always null), and NPC's 3 Corporate
      // entries are combined into one report (fetched separately per value
      // and merged, since getFinalizedBudgetReport takes one npcSbu at a time).
      gae = await getFinalizedBudgetReport({ fiscalYear, requestCategory: RequestCategory.GAE });
      const corporateNpcReports = await Promise.all(
        CORPORATE_NPC_SBUS.map((npcSbu) => getFinalizedBudgetReport({ fiscalYear, requestCategory: RequestCategory.NPC, npcSbu }))
      );
      npc = {
        fiscalYear,
        lines: corporateNpcReports.flatMap((r) => r.lines),
        boardBudgetChecks: corporateNpcReports.flatMap((r) => r.boardBudgetChecks),
      };
    }

    res.json({ sbu, fiscalYear, doe, revenue, npc, gae });
  })
);
