import axios from "axios";

export const api = axios.create({ baseURL: "/api" });

api.interceptors.request.use((config) => {
  const userId = localStorage.getItem("demoUserId");
  if (userId) {
    config.headers["x-user-id"] = userId;
  }
  return config;
});

export interface RoleAssignmentSummary {
  roleType: string;
  department: { id: string; name: string };
}

export interface DemoUser {
  id: string;
  name: string;
  email: string;
  department: { id: string; name: string } | null;
  roles: RoleAssignmentSummary[];
}

export interface Department {
  id: string;
  name: string;
  type: "REQUESTING" | "CENTRALIZED";
}

export interface Company {
  id: string;
  code: string;
  name: string;
}

export interface ExtraFieldOption {
  label: string;
  value: number | null;
}

export interface ExtraField {
  label: string;
  required: boolean;
  type: "TEXT" | "NUMBER" | "DROPDOWN";
  options?: ExtraFieldOption[];
}

export interface ExpenseLineItem {
  id: string;
  name: string;
  category: string;
  glAccount: string;
  costCenter: string;
  ownerDepartmentId: string;
  companyId: string | null;
  company?: Company | null;
  requiresMobilePolicy: boolean;
  sampleCharges: string | null;
  isCustom: boolean;
  status: "STANDARD" | "PENDING_REFINEMENT";
  extraFieldsConfig: ExtraField[];
}

export interface Attachment {
  id: string;
  fileName: string;
  storagePath: string;
}

export interface ReviewDecision {
  id: string;
  stage: string;
  decision: "APPROVE" | "REJECT" | "RETURN";
  comment: string | null;
  timestamp: string;
  decidedBy: { name: string };
}

export interface BudgetRequest {
  id: string;
  departmentId: string;
  fiscalYear: number;
  expenseLineItemId: string;
  monthlyAmounts: number[];
  proposedAmount: number;
  businessJustification: string;
  otherRequiredFields: Record<string, string>;
  currentStage: string;
  status: string;
  budgetCutAmount: number;
  isOverBudget: boolean;
  requiresCfoApproval: boolean;
  varianceJustification: string | null;
  reasonCode: string | null;
  sapDocumentNumber: string | null;
  createdAt: string;
  createdById: string;
  department: Department;
  expenseLineItem: ExpenseLineItem & { ownerDepartment: Department };
  attachments: Attachment[];
  reviewDecisions: ReviewDecision[];
  createdBy: { name: string; email: string };
}

export interface HeadcountReviewDecision {
  id: string;
  stage: string;
  decision: "APPROVE" | "REJECT" | "RETURN";
  comment: string | null;
  timestamp: string;
  decidedBy: { name: string };
}

export interface AdditionalHeadcountRequest {
  id: string;
  position: string;
  rank: number;
  companyId: string;
  company: Company;
  departmentId: string;
  department: Department;
  estimatedHireDate: string;
  justification: string;
  currentStage: "DEPT_HEAD_REVIEW" | "HR_ANALYST_REVIEW" | "HR_HEAD_REVIEW" | "APPROVED" | "RETURNED";
  createdAt: string;
  createdBy: { name: string; email: string };
  reviewDecisions: HeadcountReviewDecision[];
}
