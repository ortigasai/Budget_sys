-- Where a RETURN decision sent the request - null means back to the requestor (DRAFT).
ALTER TABLE "ReviewDecision" ADD COLUMN IF NOT EXISTS "targetStage" "RequestStage";
