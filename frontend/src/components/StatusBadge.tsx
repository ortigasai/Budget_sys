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
  HR_ANALYST_REVIEW: "HR Analyst Review",
  HR_HEAD_REVIEW: "HR Head Review",
  UPLOADED_TO_SAP: "Uploaded to SAP",
  PENDING: "Pending Review",
  REVIEWER_REVIEW: "Pending Reviewer",
  APPROVER_REVIEW: "Pending Approver",
  // Phase 3 — Budget Transfer & Reallocation. BUDGET_OFFICER_VALIDATION/
  // BU_FINANCE_HEAD_REVIEW/BU_HEAD_AUTHORIZATION/
  // BU_FINANCE_OFFICER_VERIFICATION/CFO_REVIEW/CFO_AUTHORIZATION are still
  // used by Internal Order Requests' own (unchanged) DOE/GAE stage machine.
  BUDGET_OFFICER_VALIDATION: "Budget Officer Validation",
  BU_FINANCE_HEAD_REVIEW: "BU Finance Head Review",
  BU_HEAD_AUTHORIZATION: "BU Head Authorization",
  BU_FINANCE_OFFICER_VERIFICATION: "BU Finance Officer Verification",
  CFO_REVIEW: "CFO Review",
  CFO_AUTHORIZATION: "CFO Authorization",
  BUDGET_OFFICER_SAP_UPLOAD: "Budget Officer SAP Upload",
  // Transfer's revised workflow (own stage names; CFO_APPROVAL's label is
  // already defined above, shared with Phase 1's generic flow).
  SBU_FINANCE_OFFICER_REVIEW: "SBU Finance Officer Review",
  SBU_FINANCE_HEAD_APPROVAL: "SBU Finance Head Approval",
  SBU_HEAD_APPROVAL: "SBU Head Approval",
  CEO_APPROVAL: "CEO Approval",
  SBU_FINANCE_OFFICER_COMPLETION: "SBU Finance Officer Completion",
  // Revenue's own 4-stage SBU-role chain (revenue batches - see
  // workflowService.ts's revenueBatchDecision).
  REVENUE_BU_FINANCE_OFFICER_REVIEW: "BU Finance Officer Review",
  REVENUE_BU_FINANCE_HEAD_REVIEW: "BU Finance Head Review",
  REVENUE_BUDGET_OFFICER_REVIEW: "Budget Officer Review",
  REVENUE_BCA_HEAD_REVIEW: "BC&A Head Review",
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
  HR_ANALYST_REVIEW: "bg-blue-100 text-blue-700",
  HR_HEAD_REVIEW: "bg-blue-100 text-blue-700",
  UPLOADED_TO_SAP: "bg-emerald-100 text-emerald-800",
  PENDING: "bg-amber-100 text-amber-700",
  REVIEWER_REVIEW: "bg-amber-100 text-amber-700",
  APPROVER_REVIEW: "bg-blue-100 text-blue-700",
  // Phase 3 — Budget Transfer & Reallocation.
  BUDGET_OFFICER_VALIDATION: "bg-amber-100 text-amber-700",
  BU_FINANCE_HEAD_REVIEW: "bg-blue-100 text-blue-700",
  BU_HEAD_AUTHORIZATION: "bg-blue-100 text-blue-700",
  BU_FINANCE_OFFICER_VERIFICATION: "bg-purple-100 text-purple-700",
  CFO_REVIEW: "bg-purple-100 text-purple-700",
  CFO_AUTHORIZATION: "bg-purple-100 text-purple-700",
  BUDGET_OFFICER_SAP_UPLOAD: "bg-amber-100 text-amber-700",
  // Transfer's revised workflow.
  SBU_FINANCE_OFFICER_REVIEW: "bg-blue-100 text-blue-700",
  SBU_FINANCE_HEAD_APPROVAL: "bg-blue-100 text-blue-700",
  SBU_HEAD_APPROVAL: "bg-blue-100 text-blue-700",
  CEO_APPROVAL: "bg-purple-100 text-purple-700",
  SBU_FINANCE_OFFICER_COMPLETION: "bg-amber-100 text-amber-700",
  // Revenue's own 4-stage SBU-role chain.
  REVENUE_BU_FINANCE_OFFICER_REVIEW: "bg-blue-100 text-blue-700",
  REVENUE_BU_FINANCE_HEAD_REVIEW: "bg-blue-100 text-blue-700",
  REVENUE_BUDGET_OFFICER_REVIEW: "bg-amber-100 text-amber-700",
  REVENUE_BCA_HEAD_REVIEW: "bg-purple-100 text-purple-700",
};

export function StatusBadge({ stage }: { stage: string }) {
  return (
    <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${STAGE_COLORS[stage] ?? "bg-slate-100"}`}>
      {STAGE_LABELS[stage] ?? stage}
    </span>
  );
}
