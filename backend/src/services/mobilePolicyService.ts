import { prisma } from "../prisma";

interface ExtraFieldOption {
  label: string;
  value: number | null;
}
interface ExtraField {
  label: string;
  required: boolean;
  type: "TEXT" | "NUMBER" | "DROPDOWN";
  options?: ExtraFieldOption[];
}

async function resolveTierLimit(rank: number): Promise<number | null> {
  const tier = await prisma.mobilePhonePolicyTier.findFirst({
    where: { minRank: { lte: rank }, maxRank: { gte: rank } },
  });
  return tier?.budgetLimit ?? null;
}

/**
 * Notes item 7 — a Mobile Phone request needs CFO approval when the selected
 * plan's peso value exceeds the requestor-entered rank's budget-limit tier.
 * An unrecognized rank (no matching tier) or a non-standard plan ("Others",
 * whose value can't be verified) both fail safe toward requiring CFO review.
 */
export async function determineRequiresCfoApproval(
  extraFieldsConfig: ExtraField[],
  otherRequiredFields: Record<string, string>
): Promise<boolean> {
  const planField = extraFieldsConfig.find((f) => f.type === "DROPDOWN" && f.label === "Plan");
  if (!planField) return false; // not a mobile-policy line item

  const rankRaw = otherRequiredFields["Employee Rank"];
  const planLabel = otherRequiredFields["Plan"];
  const rank = Number(rankRaw);
  if (!rankRaw || Number.isNaN(rank)) return true;

  const selectedOption = planField.options?.find((o) => o.label === planLabel);
  if (!selectedOption || selectedOption.value === null) return true;

  const limit = await resolveTierLimit(rank);
  if (limit === null) return true;

  return selectedOption.value > limit;
}
