import { prisma } from "../prisma";
import { CORE_CENTRALIZED_DEPARTMENT_NAMES } from "./coreDepartments";

// The User Management workbook names a CD member's department in its own
// words ("Administrative Services", "Legal"), and accounts imported from the
// employee list carry yet other spellings ("Administrative Services
// Department", "Legal Department") - neither necessarily equals the Forecast
// department list's name. Maps the workbook's CD scope to that list's name;
// scopes with no entry have no Forecast department at all.
const CD_SCOPE_TO_FORECAST_DEPARTMENT: Record<string, string> = {
  "Administrative Services": "Admin Services",
  "Corporate Finance": "Corporate Finance",
  "Corporate Marketing": "Corporate Marketing",
  Tax: "Tax",
  Legal: "Legal",
  "Office of the CFO": "Office of the CFO",
  "Human Resources": "Human Resources",
  "External Affairs": "External Affairs",
  "Information System & Information Technology": "Information System & Information Technology",
  "Internal Audit": "Internal Audit",
  "OMD Operations": "OMD Operations",
  Procurement: "Procurement",
};

/** Forecast departments (by id) this user may view/enter: their own department if it's on the list, plus the ones their CD memberships name. */
export async function forecastDepartmentIdsForUser(userId: string, ownDepartmentId: string | null): Promise<string[]> {
  const names = new Set<string>();
  const memberships = await prisma.userGroupMembership.findMany({ where: { userId, group: "CD" } });
  for (const m of memberships) {
    const mapped = CD_SCOPE_TO_FORECAST_DEPARTMENT[m.scope];
    if (mapped) names.add(mapped);
  }
  const departments = await prisma.department.findMany({ where: { name: { in: CORE_CENTRALIZED_DEPARTMENT_NAMES } } });
  return departments.filter((d) => names.has(d.name) || d.id === ownDepartmentId).map((d) => d.id);
}
