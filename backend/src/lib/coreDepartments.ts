// Notes_7: "Update the list of centralized departments." The canonical set
// of "real", budget-cap-tracked centralized departments — drives both
// Forecast eligibility (routes/forecast.ts) and which departments get a
// Cap & Pool card on the Home dashboard.
//
// This is deliberately a much smaller set than every Department row typed
// CENTRALIZED (there are 65 of those, mostly auto-created from importing
// the real employee roster for role/department tracking — see
// employeeImport.ts). Those exist for employee/role bookkeeping; they
// aren't all budget-cap-tracked business units.
export const CORE_CENTRALIZED_DEPARTMENT_NAMES = [
  "Administrative Services",
  "Budget, Controls & Analysis",
  "Corporate Finance",
  "Corporate Marketing",
  "External Affairs",
  "Human Resources",
  "Information System & Information Technology",
  "Internal Audit",
  "Legal",
  "Office of the CFO",
  // OMD Operations is no longer a centralized department (Expense Line Items
  // update, Nov 2026 - its Non HQ items moved to Administrative Services).
  "Procurement",
  "Tax",
  // Renamed from "Technical Services" in the same workbook update.
  "Technical Services Group",
];
