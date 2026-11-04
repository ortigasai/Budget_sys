// Department names that were merged into another department - source
// workbooks (Expense Line Items, Employee List) may still use the old name,
// so imports read it as the surviving one instead of re-creating the old
// department. See migrations 20261104180000_merge_technical_services_department
// and 20261104190000_merge_tsg_department.
const DEPARTMENT_ALIASES: Record<string, string> = {
  "Technical Services": "Technical Services Group",
  TSG: "Technical Services Group",
};

export function canonicalDepartmentName(name: string): string {
  return DEPARTMENT_ALIASES[name] ?? name;
}
