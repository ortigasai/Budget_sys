-- Board-Approved NPC Budget: Additions/Reductions kept apart from the Original figure.
ALTER TABLE "BoardApprovedBudget" ADD COLUMN "isAdjustment" BOOLEAN NOT NULL DEFAULT false;
