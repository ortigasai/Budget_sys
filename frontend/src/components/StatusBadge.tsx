const STAGE_LABELS: Record<string, string> = {
  DRAFT: "Draft",
  DEPT_HEAD_REVIEW: "Dept Head Review",
  CFO_APPROVAL: "CFO Approval",
  CENTRALIZED_L1_REVIEW: "Centralized L1 Review",
  CENTRALIZED_HEAD_REVIEW: "Centralized Head Review",
  BCA_HEAD_REVIEW: "BC&A Head Review",
  BUDGET_OFFICER_REVIEW: "Budget Officer Review",
  APPROVED: "Approved",
  RETURNED_TO_REQUESTOR: "Returned to Requestor",
  REJECTED: "Rejected",
  CANCELLED: "Cancelled",
  HEAD_REVIEW: "Centralized Head Review",
  RETURNED: "Returned",
  HR_ANALYST_DRAFT: "HR Analyst Draft",
  HR_HEAD_REVIEW: "HR Head Review",
  UPLOADED_TO_SAP: "Uploaded to SAP",
};

const STAGE_COLORS: Record<string, string> = {
  DRAFT: "bg-slate-100 text-slate-700",
  DEPT_HEAD_REVIEW: "bg-blue-100 text-blue-700",
  CFO_APPROVAL: "bg-purple-100 text-purple-700",
  CENTRALIZED_L1_REVIEW: "bg-blue-100 text-blue-700",
  CENTRALIZED_HEAD_REVIEW: "bg-blue-100 text-blue-700",
  BCA_HEAD_REVIEW: "bg-purple-100 text-purple-700",
  BUDGET_OFFICER_REVIEW: "bg-amber-100 text-amber-700",
  APPROVED: "bg-emerald-100 text-emerald-800",
  RETURNED_TO_REQUESTOR: "bg-red-100 text-red-700",
  REJECTED: "bg-red-100 text-red-700",
  CANCELLED: "bg-slate-200 text-slate-600",
  HEAD_REVIEW: "bg-blue-100 text-blue-700",
  RETURNED: "bg-red-100 text-red-700",
  HR_ANALYST_DRAFT: "bg-slate-100 text-slate-700",
  HR_HEAD_REVIEW: "bg-blue-100 text-blue-700",
  UPLOADED_TO_SAP: "bg-emerald-100 text-emerald-800",
};

export function StatusBadge({ stage }: { stage: string }) {
  return (
    <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${STAGE_COLORS[stage] ?? "bg-slate-100"}`}>
      {STAGE_LABELS[stage] ?? stage}
    </span>
  );
}
