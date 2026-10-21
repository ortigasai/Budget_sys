-- The forecast workbook's monthly Actual columns, stored as-uploaded.
ALTER TABLE "HistoricalActuals" ADD COLUMN "monthlyActuals2026" JSONB NOT NULL DEFAULT '{}';
