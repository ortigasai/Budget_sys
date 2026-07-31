import { useQuery } from "@tanstack/react-query";
import { useAuth } from "../context/AuthContext";
import { roleLabel } from "../components/RoleSwitcher";
import { CapPoolWidget } from "../components/CapPoolWidget";
import { DueDateBanner } from "../components/DueDateBanner";
import { api, type Department } from "../api/client";

export function HomePage() {
  const { currentUser } = useAuth();
  const { data: departments = [] } = useQuery({
    queryKey: ["departments"],
    queryFn: async () => (await api.get<Department[]>("/admin/departments")).data,
  });

  if (!currentUser) return null;

  const homeDept = departments.find((d) => d.id === currentUser.department?.id);
  const centralizedDeptIds = new Set(
    currentUser.roles
      .filter((r) => r.roleType !== "DEPARTMENT_HEAD")
      .map((r) => r.department.id)
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
                  {roleLabel(r.roleType)} ({r.department.name})
                </span>
              ))}
            </>
          )}
        </p>
      </div>

      {homeDept?.type === "CENTRALIZED" && (
        <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="mb-2 text-sm font-semibold text-slate-700">{homeDept.name} — Budget Cap &amp; Pool</h2>
          <CapPoolWidget departmentId={homeDept.id} />
        </section>
      )}

      {[...centralizedDeptIds]
        .filter((id) => id !== homeDept?.id)
        .map((id) => {
          const dept = departments.find((d) => d.id === id);
          if (!dept) return null;
          return (
            <section key={id} className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
              <h2 className="mb-2 text-sm font-semibold text-slate-700">{dept.name} — Budget Cap &amp; Pool</h2>
              <CapPoolWidget departmentId={dept.id} />
            </section>
          );
        })}
    </div>
  );
}
