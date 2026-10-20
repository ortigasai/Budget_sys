import { Route, Routes } from "react-router-dom";
import { Layout } from "./components/Layout";
import { RequireRole } from "./components/RequireRole";
import { PhaseMenuPage } from "./pages/PhaseMenuPage";
import { HomePage } from "./pages/HomePage";
import { PortalRequestsPage } from "./pages/PortalRequestsPage";
import { NewRequestPage } from "./pages/NewRequestPage";
import { MyRequestsPage } from "./pages/MyRequestsPage";
import { RequestDetailPage } from "./pages/RequestDetailPage";
import { HeadcountRequestDetailPage } from "./pages/HeadcountRequestDetailPage";
import { InboxPage } from "./pages/InboxPage";
import { ForecastPage } from "./pages/ForecastPage";
import { Step5DashboardPage } from "./pages/Step5DashboardPage";
import { Step5PendingRequestsPage } from "./pages/Step5PendingRequestsPage";
import { FinalizedBudgetReportPage } from "./pages/FinalizedBudgetReportPage";
import { DashFlowBudgetCheckPage } from "./pages/DashFlowBudgetCheckPage";
import { AdminConsolePage } from "./pages/admin/AdminConsolePage";
import { ManpowerDashboardPage } from "./pages/manpower/ManpowerDashboardPage";
import { UtilizationPage } from "./pages/UtilizationPage";
import { TransfersPage } from "./pages/TransfersPage";
import { TransferDetailPage } from "./pages/TransferDetailPage";
import { InternalOrderRequestsPage } from "./pages/InternalOrderRequestsPage";
import { InternalOrderDetailPage } from "./pages/InternalOrderDetailPage";
import { ReportsPage } from "./pages/ReportsPage";
import { RequireReportAccess } from "./components/RequireReportAccess";
import { RequireTransfersModule } from "./components/RequireTransfersModule";
import { ReportsTrendPage } from "./pages/ReportsTrendPage";
import { NpcReportPage } from "./pages/NpcReportPage";
import { UploadStatusStack } from "./components/UploadStatusStack";

export default function App() {
  return (
    <>
      <Routes>
      <Route element={<Layout />}>
        <Route index element={<PhaseMenuPage />} />
        <Route path="phase1" element={<HomePage />} />
        <Route path="dashboard/:departmentId/requests" element={<PortalRequestsPage />} />
        <Route path="requests/new" element={<NewRequestPage />} />
        <Route path="requests/mine" element={<MyRequestsPage />} />
        <Route path="requests/headcount/:id" element={<HeadcountRequestDetailPage />} />
        <Route path="requests/:id" element={<RequestDetailPage />} />
        <Route path="inbox" element={<InboxPage />} />
        <Route path="forecast" element={<ForecastPage />} />
        <Route
          path="step5"
          element={
            <RequireRole role="BUDGET_OFFICER" access={["finalization"]}>
              <Step5DashboardPage />
            </RequireRole>
          }
        />
        <Route
          path="step5/pending"
          element={
            <RequireRole role="BUDGET_OFFICER" access={["finalization"]}>
              <Step5PendingRequestsPage />
            </RequireRole>
          }
        />
        <Route
          path="step5/finalized-budget"
          element={
            <RequireRole role="BUDGET_OFFICER" access={["finalization"]}>
              <FinalizedBudgetReportPage />
            </RequireRole>
          }
        />
        <Route
          path="admin"
          element={
            <RequireRole role="BUDGET_OFFICER">
              <AdminConsolePage />
            </RequireRole>
          }
        />
        <Route path="manpower" element={<ManpowerDashboardPage />} />
        <Route
          path="utilization"
          element={
            <RequireRole
              access={["util.overview", "util.reconciliation", "util.npc"]}
              role={[
                "BUDGET_OFFICER",
                "CENTRALIZED_BUDGET_PREPARER",
                "CENTRALIZED_DEPARTMENT_HEAD",
                "CENTRALIZED_FIRST_LEVEL_REVIEWER",
              ]}
            >
              <UtilizationPage />
            </RequireRole>
          }
        />
        {/* Moved here from Phase 3 - Dash Flow's own access check is
            SBU-Finance-role-based, not phase-based, so this is purely a
            navigation-grouping change (see Layout.tsx's phaseForPath and
            sidebar). */}
        <Route path="dash-flow" element={<DashFlowBudgetCheckPage />} />
        {/* Phase 3 — no RequireRole wrapper, mirroring requests/new,
            requests/mine, and inbox above: creation is open to everyone,
            same as Phase 1's own BudgetRequest creation; review/approval
            actions are gated per-decision instead (see
            TransferDetailPage.tsx's canDecide). */}
        <Route path="transfers" element={<RequireTransfersModule><TransfersPage /></RequireTransfersModule>} />
        <Route path="transfers/:id" element={<RequireTransfersModule><TransferDetailPage /></RequireTransfersModule>} />
        <Route path="internal-orders" element={<RequireTransfersModule><InternalOrderRequestsPage /></RequireTransfersModule>} />
        <Route path="internal-orders/:id" element={<RequireTransfersModule><InternalOrderDetailPage /></RequireTransfersModule>} />
        <Route
          path="reports"
          element={
            <RequireReportAccess>
              <ReportsPage />
            </RequireReportAccess>
          }
        />
        <Route
          path="reports/npc"
          element={
            <RequireReportAccess>
              <NpcReportPage />
            </RequireReportAccess>
          }
        />
        <Route
          path="reports/trend"
          element={
            <RequireReportAccess>
              <ReportsTrendPage />
            </RequireReportAccess>
          }
        />
      </Route>
      </Routes>
      <UploadStatusStack />
    </>
  );
}
