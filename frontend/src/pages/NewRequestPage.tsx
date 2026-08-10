import { useSearchParams } from "react-router-dom";
import { PageHeader } from "../components/PageHeader";
import { StandardRequestTab } from "./newRequest/StandardRequestTab";
import { BulkUploadTab } from "./newRequest/BulkUploadTab";
import { AdditionalHeadcountTab } from "./newRequest/AdditionalHeadcountTab";

const SUBTITLES = {
  standard: "Create a standard request.",
  bulk: "Bulk-upload a batch of requests.",
  headcount: "Request additional headcount.",
};

export function NewRequestPage() {
  const [searchParams] = useSearchParams();
  const tabParam = searchParams.get("tab");
  const tab = tabParam === "bulk" || tabParam === "headcount" ? tabParam : "standard";

  return (
    <div className="space-y-4">
      <PageHeader title="New Request" subtitle={SUBTITLES[tab]} />

      {tab === "standard" && <StandardRequestTab />}
      {tab === "bulk" && <BulkUploadTab />}
      {tab === "headcount" && <AdditionalHeadcountTab />}
    </div>
  );
}
