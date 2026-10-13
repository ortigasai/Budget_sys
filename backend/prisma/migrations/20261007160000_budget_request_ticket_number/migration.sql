-- A human-readable reference for every BudgetRequest ("TCK-YY-Num"), same counter
-- mechanism as Budget Code. Nullable: existing rows have none until backfilled.
ALTER TABLE "BudgetRequest" ADD COLUMN IF NOT EXISTS "ticketNumber" TEXT;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'BudgetRequest_ticketNumber_key') THEN
    ALTER TABLE "BudgetRequest" ADD CONSTRAINT "BudgetRequest_ticketNumber_key" UNIQUE ("ticketNumber");
  END IF;
END $$;
