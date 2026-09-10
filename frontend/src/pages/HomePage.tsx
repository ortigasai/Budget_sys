import { useQuery } from "@tanstack/react-query";
import { useAuth } from "../context/AuthContext";
import { roleLabel } from "../components/RoleSwitcher";
import { CapPoolWidget } from "../components/CapPoolWidget";
import { DueDateBanner } from "../components/DueDateBanner";
import { PortalRequestsList } from "../components/PortalRequestsList";
import { SectionLabel } from "../components/TabBar";
import { api, type Department } from "../api/client";
import { useFiscalYear } from "../lib/fiscalCycle";

export function HomePage() {
  const { currentUser } = useAuth();
  const { targetYear: FISCAL_YEAR } = useFiscalYear();
  const { data: departments = [] } = useQuery({
    queryKey: ["departments"],
    queryFn: async () => (await api.get<Department[]>("/admin/departments")).data,
  });
  // Notes_7: "Update the list of centralized departments" — Cap & Pool
  // cards are now restricted to this curated list, not every Department
  // typed CENTRALIZED (there are ~65 of those, mostly from importing the
  // real employee roster for role tracking, not real budget-cap units).
  const { data: coreDepartments = [] } = useQuery({
    queryKey: ["core-departments"],
    queryFn: async () => (await api.get<Department[]>("/admin/core-departments")).data,
  });
  const coreDepartmentIds = new Set(coreDepartments.map((d) => d.id));

  if (!currentUser) return null;

  const homeDept = departments.find((d) => d.id === currentUser.department?.id);
  const centralizedDeptIds = new Set(
    currentUser.roles
      .filter((r) => r.roleType !== "DEPARTMENT_HEAD" && r.department)
      .map((r) => r.department!.id)
  );

  return (
    <div className="space-y-6">
      <DueDateBanner />

      <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
        <h1 className="text-xl font-semibold text-slate-800">Welcome, {currentUser.name}</h1>
        <p className="mt-1 text-sm text-slate-600">
          Department: {currentUser.department?.name ?? "—"}
          {currentUser.roles.length > 0 && (
            <>
              {" · "}
              Roles:{" "}
              {currentUser.roles.map((r, i) => (
                <span key={i}>
                  {i > 0 && ", "}
                  {roleLabel(r.roleType)} ({r.department?.name ?? r.sbu ?? "—"})
                </span>
              ))}
            </>
          )}
        </p>
      </div>

      {homeDept && coreDepartmentIds.has(homeDept.id) && (
        <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="mb-2 text-sm font-semibold text-slate-700">{homeDept.name} — Budget Cap &amp; Pool</h2>
          <CapPoolWidget departmentId={homeDept.id} />
          <div className="mt-4">
            <SectionLabel>{FISCAL_YEAR} Portal Requests Breakdown</SectionLabel>
            <PortalRequestsList departmentId={homeDept.id} fiscalYear={FISCAL_YEAR} />
          </div>
        </section>
      )}

      {[...centralizedDeptIds]
        .filter((id) => id !== homeDept?.id && coreDepartmentIds.has(id))
        .map((id) => {
          const dept = departments.find((d) => d.id === id);
          if (!dept) return null;
          return (
            <section key={id} className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
              <h2 className="mb-2 text-sm font-semibold text-slate-700">{dept.name} — Budget Cap &amp; Pool</h2>
              <CapPoolWidget departmentId={dept.id} />
              <div className="mt-4">
                <SectionLabel>{FISCAL_YEAR} Portal Requests Breakdown</SectionLabel>
                <PortalRequestsList departmentId={dept.id} fiscalYear={FISCAL_YEAR} />
              </div>
            </section>
          );
        })}
    </div>
  );
}
