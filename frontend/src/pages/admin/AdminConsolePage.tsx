import { useState } from "react";
import { PageHeader } from "../../components/PageHeader";
import { TabBar } from "../../components/TabBar";
import { ExpenseLineItemsTab } from "./ExpenseLineItemsTab";
import { GrowthRateTab } from "./GrowthRateTab";
import { ThresholdsTab } from "./ThresholdsTab";
import { ReasonCodesTab } from "./ReasonCodesTab";
import { RoleAssignmentsTab } from "./RoleAssignmentsTab";
import { StageDueDatesTab } from "./StageDueDatesTab";

const TABS = [
  { id: "expense-items", label: "Expense Line Items" },
  { id: "growth-rate", label: "Growth Rate" },
  { id: "thresholds", label: "Thresholds" },
  { id: "reason-codes", label: "Reason Codes" },
  { id: "roles", label: "Role Assignments" },
  { id: "due-dates", label: "Stage Due Dates" },
] as const;

type TabId = (typeof TABS)[number]["id"];

export function AdminConsolePage() {
  const [tab, setTab] = useState<TabId>("expense-items");

  return (
    <div className="space-y-4">
      <PageHeader title="Budget Officer Admin Console" subtitle="Configure the catalog, workflow, and reference data that drive the budgeting system." />
      <TabBar tabs={TABS} active={tab} onChange={setTab} />

      {tab === "expense-items" && <ExpenseLineItemsTab />}
      {tab === "growth-rate" && <GrowthRateTab />}
      {tab === "thresholds" && <ThresholdsTab />}
      {tab === "reason-codes" && <ReasonCodesTab />}
      {tab === "roles" && <RoleAssignmentsTab />}
      {tab === "due-dates" && <StageDueDatesTab />}
    </div>
  );
}
