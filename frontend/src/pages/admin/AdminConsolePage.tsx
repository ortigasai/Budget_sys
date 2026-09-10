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

// Shared with Layout.tsx's AdminConsoleSidebarNav, which renders this same
// list as real `?tab=` links in the leftmost sidebar (spec: "place the
// sidebar to the leftmost part of the page - same as the other sidebars in
// other modules") - exported from here so the two never drift apart.
export const ADMIN_TABS = [
  { id: "budget-cycle", label: "Budget Cycle" },
  { id: "due-dates", label: "Stage Due Dates" },
  { id: "expense-items", label: "Expense Line Items" },
  { id: "budget-codes", label: "Budget Codes" },
  { id: "forecast-categories", label: "Forecast Categories" },
  { id: "growth-rate", label: "Growth Rate" },
  { id: "thresholds", label: "Thresholds" },
  { id: "reason-codes", label: "Reason Codes" },
  { id: "roles", label: "Role Assignments" },
  { id: "sbu-roles", label: "SBU Roles" },
  { id: "io-locations", label: "IO Locations" },
  { id: "cc-gl-codes", label: "CC-GL Codes" },
  { id: "manpower-gl-cc", label: "Manpower GL/CC Mapping" },
  { id: "department-sbu", label: "Department SBU" },
  { id: "report-access", label: "Report Access" },
  { id: "period-sign-off", label: "Period Sign-off" },
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
      {tab === "expense-items" && <ExpenseLineItemsTab />}
      {tab === "budget-codes" && <BudgetCodesTab />}
      {tab === "forecast-categories" && <ForecastCategoryMappingsTab />}
      {tab === "growth-rate" && <GrowthRateTab />}
      {tab === "thresholds" && <ThresholdsTab />}
      {tab === "reason-codes" && <ReasonCodesTab />}
      {tab === "roles" && <RoleAssignmentsTab />}
      {tab === "sbu-roles" && <SbuRoleAssignmentsTab />}
      {tab === "io-locations" && <IoLocationsTab />}
      {tab === "cc-gl-codes" && <CcGlCodesTab />}
      {tab === "manpower-gl-cc" && <ManpowerGlCcTab />}
      {tab === "department-sbu" && <DepartmentSbuTab />}
      {tab === "report-access" && <ReportAccessTab />}
      {tab === "period-sign-off" && <PeriodSignOffTab />}
      {tab === "due-dates" && <StageDueDatesTab />}
      {tab === "budget-cycle" && <BudgetCycleTab />}
    </div>
  );
}
