import { useState } from "react";
import { PageHeader } from "../components/PageHeader";
import { TabBar } from "../components/TabBar";
import { StandardRequestTab } from "./newRequest/StandardRequestTab";
import { BulkUploadTab } from "./newRequest/BulkUploadTab";
import { AdditionalHeadcountTab } from "./newRequest/AdditionalHeadcountTab";

const TABS = [
  { id: "standard", label: "Standard Request" },
  { id: "bulk", label: "Bulk Upload" },
  { id: "headcount", label: "Additional Headcount Request" },
] as const;

type TabId = (typeof TABS)[number]["id"];

export function NewRequestPage() {
  const [tab, setTab] = useState<TabId>("standard");

  return (
    <div className="space-y-4">
      <PageHeader title="New Request" subtitle="Create a standard request, bulk-upload a batch, or request additional headcount." />
      <TabBar tabs={TABS} active={tab} onChange={setTab} />

      {tab === "standard" && <StandardRequestTab />}
      {tab === "bulk" && <BulkUploadTab />}
      {tab === "headcount" && <AdditionalHeadcountTab />}
    </div>
  );
}
