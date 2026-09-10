import { useQuery } from "@tanstack/react-query";
import { useParams, useSearchParams } from "react-router-dom";
import { api, type Department } from "../api/client";
import { PageHeader } from "../components/PageHeader";
import { PortalRequestsList } from "../components/PortalRequestsList";
import { useFiscalYear } from "../lib/fiscalCycle";

// Drill-down behind the "Portal Requests" stat tile — also shown inline on
// the Home dashboard now, but kept as its own route for a focused/shareable
// view of one department's breakdown.
export function PortalRequestsPage() {
  const { departmentId } = useParams<{ departmentId: string }>();
  const [searchParams] = useSearchParams();
  const { targetYear } = useFiscalYear();
  const fiscalYear = Number(searchParams.get("fiscalYear") ?? targetYear);

  const { data: department } = useQuery({
    queryKey: ["departments"],
    queryFn: async () => (await api.get<Department[]>("/admin/departments")).data,
    select: (departments) => departments.find((d) => d.id === departmentId),
  });

  return (
    <div className="space-y-4">
      <PageHeader
        subtitle={
          <>
            <span className="font-medium text-slate-700">{fiscalYear} Portal Requests</span>
            {department && <> — {department.name}, requests currently consuming this department's pool</>}
          </>
        }
      />
      {departmentId && <PortalRequestsList departmentId={departmentId} fiscalYear={fiscalYear} />}
    </div>
  );
}
