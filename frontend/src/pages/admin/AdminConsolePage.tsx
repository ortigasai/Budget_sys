import { useSearchParams } from "react-router-dom";
import { ExpenseLineItemsTab } from "./ExpenseLineItemsTab";
import { GrowthRateTab } from "./GrowthRateTab";
import { ThresholdsTab } from "./ThresholdsTab";
import { ReasonCodesTab } from "./ReasonCodesTab";
import { RoleAssignmentsTab } from "./RoleAssignmentsTab";
import { SbuRoleAssignmentsTab } from "./SbuRoleAssignmentsTab";
import { IoLocationsTab } from "./IoLocationsTab";
import { CcGlCodesTab } from "./CcGlCodesTab";
import { ReportAccessTab } from "./ReportAccessTab";
import { PeriodSignOffTab } from "./PeriodSignOffTab";
import { DepartmentSbuTab } from "./DepartmentSbuTab";
import { StageDueDatesTab } from "./StageDueDatesTab";
import { BudgetCycleTab } from "./BudgetCycleTab";
import { BudgetCodesTab } from "./BudgetCodesTab";
import { ForecastCategoryMappingsTab } from "./ForecastCategoryMappingsTab";
import { ManpowerGlCcTab } from "./ManpowerGlCcTab";
import { NpcMonitoringImportTab } from "./NpcMonitoringImportTab";
import { GaePastDataImportTab } from "./GaePastDataImportTab";
import { GaeForecastImportTab } from "./GaeForecastImportTab";
import { SapSyncStatusTab } from "./SapSyncStatusTab";
import { AccessControlTab } from "./AccessControlTab";

// Shared with Layout.tsx's AdminConsoleSidebarNav, which renders this same
// list as real `?tab=` links in the leftmost sidebar, grouped by `group`
// (spec: "place the sidebar to the leftmost part of the page - same as the
// other sidebars in other modules") - exported from here so the two never
// drift apart. `group` classifies each tab by which module's data it
// actually edits (checked against each tab's own API calls/comments, not
// guessed from its label) - "General" is for a tab that's genuinely
// cross-module (applies to more than one, or the whole app) rather than
// owned by one.
export const ADMIN_GROUPS = ["General", "GAE", "DOE", "NPC", "Transfers", "Manpower", "Reports"] as const;
export type AdminGroup = (typeof ADMIN_GROUPS)[number];

export const ADMIN_TABS = [
  { id: "budget-cycle", label: "Budget Cycle", group: "General", keywords: "target calendar year fiscal year cycle" },
  { id: "due-dates", label: "Stage Due Dates", group: "General", keywords: "deadline due date stage request creation authorization finalize forecast" },
  // Feeds Forecast GAE/DOE, Manpower, Utilization/Transfer/Dash Flow/Reports
  // all at once - not one module's.
  { id: "sap-sync-status", label: "SAP Sync Status", group: "General", keywords: "sap sync last synced job error refresh" },
  // Spans GAE's CENTRALIZED_DEPARTMENT prefix and NPC's NPC_HEAD prefix.
  { id: "budget-codes", label: "Budget Codes", group: "General", keywords: "budget code prefix centralized department npc head cd-yy-num" },
  // Classifies Forecast rows across GAE/DOE/NPC/Revenue - not one module's.
  { id: "forecast-categories", label: "Forecast Categories", group: "General", keywords: "forecast category mapping doe npc revenue gl account cost center" },
  { id: "reason-codes", label: "Reason Codes", group: "General", keywords: "budget cut return reason" },
  { id: "roles", label: "Role Assignments", group: "General", keywords: "role assignment employee list upload approver budget officer preparer department head cfo ceo bca" },
  { id: "access-control", label: "Access Control", group: "General", keywords: "access group permission member cd ncd mc sf npc page access" },
  // Assigns each Department to an NPC SBU, which also scopes Utilization's
  // NPC view - spans two modules, not owned by either alone.
  { id: "department-sbu", label: "Department SBU", group: "General", keywords: "department sbu npc utilization" },
  { id: "expense-items", label: "Expense Line Items", group: "GAE", keywords: "expense line item catalog gl account cost center upload template refinement custom visibility company" },
  { id: "gae-forecast-import", label: "GAE Forecast Import", group: "GAE", keywords: "gae forecast workbook import upload template approved budget ytd actuals remaining months" },
  { id: "gae-past-data", label: "GAE Past Years Data", group: "GAE", keywords: "past years actuals budget 5-year trend workbook upload" },
  { id: "growth-rate", label: "Growth Rate", group: "GAE", keywords: "growth rate override percent audit log department" },
  { id: "thresholds", label: "Thresholds", group: "GAE", keywords: "documentation threshold attachment supporting document amount" },
  { id: "sbu-roles", label: "SBU Roles", group: "DOE", keywords: "sbu finance head division head doe approver" },
  { id: "npc-monitoring", label: "NPC Monitoring Import", group: "NPC", keywords: "npc monitoring workbook import upload io internal order" },
  { id: "io-locations", label: "IO Locations", group: "Transfers", keywords: "internal order io location" },
  { id: "cc-gl-codes", label: "CC-GL Codes", group: "Transfers", keywords: "cost center gl account code list upload dash flow transfer" },
  { id: "manpower-gl-cc", label: "Manpower GL/CC Mapping", group: "Manpower", keywords: "manpower salary pay component company cost center gl account mapping" },
  { id: "report-access", label: "Report Access", group: "Reports", keywords: "report access grant user module 4 budget report analysis" },
  { id: "period-sign-off", label: "Period Sign-off", group: "Reports", keywords: "period sign-off lock close fiscal year reports" },
] as const;

export type AdminTabId = (typeof ADMIN_TABS)[number]["id"];

// The sidebar itself now lives in Layout.tsx (AdminConsoleSidebarNav), same
// as every other module's - this page just reads `?tab=` to pick which
// section renders, same `?view=`/`?category=` pattern already used by
// Transfers/Forecast/Step5. No banner header here either (removed per
// request) - the green top bar's "Admin Console" label is enough context.
export function AdminConsolePage() {
  const [searchParams] = useSearchParams();
  const tabParam = searchParams.get("tab");
  const tab: AdminTabId = (ADMIN_TABS.find((t) => t.id === tabParam)?.id ?? "expense-items") as AdminTabId;

  return (
    <div className="space-y-4">
      {tab === "sap-sync-status" && <SapSyncStatusTab />}
      {tab === "expense-items" && <ExpenseLineItemsTab />}
      {tab === "budget-codes" && <BudgetCodesTab />}
      {tab === "forecast-categories" && <ForecastCategoryMappingsTab />}
      {tab === "growth-rate" && <GrowthRateTab />}
      {tab === "thresholds" && <ThresholdsTab />}
      {tab === "reason-codes" && <ReasonCodesTab />}
      {tab === "roles" && <RoleAssignmentsTab />}
      {tab === "access-control" && <AccessControlTab />}
      {tab === "sbu-roles" && <SbuRoleAssignmentsTab />}
      {tab === "io-locations" && <IoLocationsTab />}
      {tab === "cc-gl-codes" && <CcGlCodesTab />}
      {tab === "npc-monitoring" && <NpcMonitoringImportTab />}
      {tab === "gae-forecast-import" && <GaeForecastImportTab />}
      {tab === "gae-past-data" && <GaePastDataImportTab />}
      {tab === "manpower-gl-cc" && <ManpowerGlCcTab />}
      {tab === "department-sbu" && <DepartmentSbuTab />}
      {tab === "report-access" && <ReportAccessTab />}
      {tab === "period-sign-off" && <PeriodSignOffTab />}
      {tab === "due-dates" && <StageDueDatesTab />}
      {tab === "budget-cycle" && <BudgetCycleTab />}
    </div>
  );
}
