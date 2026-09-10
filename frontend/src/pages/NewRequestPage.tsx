import { useSearchParams } from "react-router-dom";
import { PageHeader } from "../components/PageHeader";
import { StandardRequestTab } from "./newRequest/StandardRequestTab";
import { NpcRequestTab } from "./newRequest/NpcRequestTab";
import { RevenueRequestTab } from "./newRequest/RevenueRequestTab";
import { AdditionalHeadcountTab } from "./newRequest/AdditionalHeadcountTab";

type RequestTab = "standard" | "doe" | "headcount" | "npc" | "revenue";

const SUBTITLES: Record<RequestTab, string> = {
  standard: "Create a General & Administrative Expenses (GAE) request.",
  doe: "Create a Direct Operating Expenses (DOE) request.",
  headcount: "Request additional manpower.",
  npc: "Request non-project capital expenditure.",
  revenue: "Submit a revenue request.",
};

// Shown at the bare /requests/new URL (no ?tab= yet) - relies on the
// sidebar's New Request sub-menu (already auto-expanded on landing here) to
// pick a category, rather than duplicating that choice in the main content
// area too.
function NoCategorySelected() {
  return (
    <div className="rounded-lg border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500 shadow-sm">
      Select a request type from the menu on the left to begin.
    </div>
  );
}

export function NewRequestPage() {
  const [searchParams] = useSearchParams();
  const tabParam = searchParams.get("tab");
  // No ?tab= at all means "haven't picked a category yet" - shows the tile
  // picker below instead of silently defaulting to GAE, per Amendment
  // request. GAE is only shown once explicitly chosen (?tab=standard, same
  // as every other category).
  const tab: RequestTab | null =
    tabParam === "standard" || tabParam === "doe" || tabParam === "headcount" || tabParam === "npc" || tabParam === "revenue"
      ? tabParam
      : null;

  // StandardRequestTab (GAE/DOE), NpcRequestTab, RevenueRequestTab, and
  // AdditionalHeadcountTab all own their PageHeader now, so their submit
  // button can live in the header's actions slot instead of the bottom of
  // the form - the shared header here only covers the states that don't
  // have one of their own (i.e. no category picked yet).
  const usesOwnHeader = tab !== null;

  return (
    <div className="space-y-4">
      {!usesOwnHeader && <PageHeader subtitle="Choose a request type to get started." />}

      {tab === null && <NoCategorySelected />}
      {tab === "standard" && <StandardRequestTab requestCategory="GAE" subtitle={SUBTITLES.standard} />}
      {tab === "doe" && <StandardRequestTab requestCategory="DOE" subtitle={SUBTITLES.doe} />}
      {tab === "headcount" && <AdditionalHeadcountTab subtitle={SUBTITLES.headcount} />}
      {tab === "npc" && <NpcRequestTab subtitle={SUBTITLES.npc} />}
      {tab === "revenue" && <RevenueRequestTab subtitle={SUBTITLES.revenue} />}
    </div>
  );
}
