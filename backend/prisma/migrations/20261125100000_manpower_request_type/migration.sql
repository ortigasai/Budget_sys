-- Manpower Request: Additional Manpower or Replacement of a resigned employee.
-- Existing requests are all Additional Manpower (the column default).
CREATE TYPE "ManpowerRequestType" AS ENUM ('ADDITIONAL', 'REPLACEMENT');

ALTER TABLE "AdditionalHeadcountRequest"
  ADD COLUMN "requestType" "ManpowerRequestType" NOT NULL DEFAULT 'ADDITIONAL',
  ADD COLUMN "resignedEmployeeName" TEXT;
