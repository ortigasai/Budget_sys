-- OMD Operations is no longer a centralized department (Expense Line Items
-- update, Nov 2026): drop its "OM" budget code prefix from Admin Console >
-- Budget Codes. Its catalog rows are moved/removed by re-uploading the
-- workbook (Admin Console > Expense Line Items > Upload Template).
DELETE FROM "BudgetCodePrefix" WHERE "kind" = 'CENTRALIZED_DEPARTMENT' AND "label" = 'OMD Operations';
