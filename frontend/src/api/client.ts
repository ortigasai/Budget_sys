import axios from "axios";

export const api = axios.create({ baseURL: "/api" });
// Phase 2 (Budget Utilization Tracking) backend - separate FastAPI service,
// same JWT, different base URL/port. See vite.config.ts's /api2 proxy entry.
export const api2 = axios.create({ baseURL: "/api2" });

// The JWT tracks in-memory login state (AuthContext.login/logout set it
// directly via api.defaults) rather than being read from storage on every
// request, since login is intentionally not persisted across reloads. Set on
// both axios instances - the same token is valid on both backends.
export function setAuthToken(token: string | null) {
  for (const instance of [api, api2]) {
    if (token) {
      instance.defaults.headers.common["Authorization"] = `Bearer ${token}`;
    } else {
      delete instance.defaults.headers.common["Authorization"];
    }
  }
}

export interface RoleAssignmentSummary {
  roleType: string;
  // Phase 3's BU_FINANCE_HEAD/BU_HEAD/BU_FINANCE_OFFICER are SBU-scoped
  // rather than department-scoped - department is absent and sbu is set for
  // those, the reverse for every other (department-scoped) role.
  department?: { id: string; name: string };
  sbu?: Sbu;
}

export interface DemoUser {
  id: string;
  name: string;
  email: string;
  department: { id: string; name: string; sbu: NpcSbu | null } | null;
  roles: RoleAssignmentSummary[];
}

export interface Department {
  id: string;
  name: string;
  type: "REQUESTING" | "CENTRALIZED";
  // Spec item 13 — which NPC SBU this department belongs to, for scoping
  // Budget Utilization Tracking's NPC view. Null for departments with no SBU
  // affiliation.
  sbu: NpcSbu | null;
}

export interface Company {
  id: string;
  code: string;
  name: string;
  // SAP Requirements integration - admin-editable, maps this company to the
  // real SAP Cost Center funding Manpower's "Run Manpower Budget" pull.
  costCenter: string | null;
}

// SAP Requirements integration - admin-editable, maps this pay component to
// the real SAP GL Account funding Manpower's "Run Manpower Budget" pull.
export interface PayComponent {
  id: string;
  name: string;
  glAccount: string | null;
}

export interface ExtraFieldOption {
  label: string;
  value: number | null;
}

export interface MobilePhonePolicyTier {
  id: string;
  minRank: number;
  maxRank: number;
  budgetLimit: number;
}

// The two admin-editable Budget Code prefix lists (Admin Console > Budget
// Codes) - GAE's Centralized Department abbreviations (import-time fallback
// only) and NPC's Head-per-SBU abbreviations (used by the NPC request form).
export type BudgetCodePrefixKind = "CENTRALIZED_DEPARTMENT" | "NPC_HEAD";
export interface BudgetCodePrefix {
  id: string;
  kind: BudgetCodePrefixKind;
  label: string;
  code: string;
  sortOrder: number;
}

// Phase 3's DOE-stream roles (BU_FINANCE_HEAD/BU_HEAD/BU_FINANCE_OFFICER),
// assigned per-SBU rather than per-department (Admin Console > SBU Roles).
export type SbuRoleType = "BU_FINANCE_HEAD" | "BU_HEAD" | "BU_FINANCE_OFFICER";
export interface SbuRoleAssignment {
  id: string;
  sbu: Sbu;
  roleType: SbuRoleType;
  user: { id: string; name: string };
}

export interface ExtraField {
  label: string;
  required: boolean;
  type: "TEXT" | "NUMBER" | "DROPDOWN";
  options?: ExtraFieldOption[];
  multi?: boolean;
}

export interface ExpenseLineItem {
  id: string;
  name: string;
  category: string;
  description: string | null;
  glAccount: string;
  costCenter: string;
  ownerDepartmentId: string;
  ownerDepartment?: Department | null;
  companyId: string | null;
  company?: Company | null;
  requiresMobilePolicy: boolean;
  sampleCharges: string | null;
  spendGridComputation: string | null;
  spendGridFrequency: string | null;
  visibleToDepartmentId: string | null;
  visibleToDepartment?: Department | null;
  isCustom: boolean;
  status: "STANDARD" | "PENDING_REFINEMENT";
  extraFieldsConfig: ExtraField[];
  // GAE's pre-computed "CD-YY-Num" Budget Code, imported from the catalog
  // file. Null for legacy/custom rows without one yet.
  budgetCode: string | null;
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

// Notes_8: high-level New Request menu classification, layered on top of
// (not instead of) ExpenseLineItem.category. NPC/REVENUE are reserved for
// when those forms exist (still placeholder tabs today).
export type RequestCategory = "GAE" | "DOE" | "NPC" | "REVENUE";
// CORPORATE (Note 11) is a real SBU value now, not just a report-only bucket
// label — used by the Approved Budget report's Corporate tab and SBU role
// assignments. Distinct from the older "Corporate-GAE" report bucket string
// used elsewhere for departments with no SBU mapped at all.
export type Sbu = "RESIDENTIAL" | "MALLS" | "OFFICES" | "ESTATES" | "LEISURE" | "CORPORATE";

// Forecast's GAE/DOE/NPC/Revenue sub-menu classification — a HistoricalActuals
// row whose (glAccount, costCenter) has no entry here defaults to GAE.
export interface ForecastCategoryMapping {
  id: string;
  glAccount: string;
  costCenter: string;
  category: RequestCategory;
}

export const SBU_OPTIONS: { value: Sbu; label: string }[] = [
  { value: "RESIDENTIAL", label: "Residential" },
  { value: "MALLS", label: "Malls" },
  { value: "OFFICES", label: "Offices" },
  { value: "ESTATES", label: "Estates" },
  { value: "LEISURE", label: "Leisure" },
  { value: "CORPORATE", label: "Corporate" },
];

// Spec item 12's NPC-specific SBU list — mirrors backend/src/lib/npcSbu.ts.
// Distinct from the 5-value Sbu enum above (DOE's) since NPC also covers 3
// Corporate entries that don't apply to DOE.
export type NpcSbu = "MALLS" | "OFFICES" | "ESTATES" | "RESIDENTIAL" | "LEISURE" | "CORPORATE_IT" | "CORPORATE_HR" | "CORPORATE_ADMIN";
export const NPC_SBU_OPTIONS: { value: NpcSbu; label: string }[] = [
  { value: "MALLS", label: "Malls" },
  { value: "OFFICES", label: "Offices" },
  { value: "ESTATES", label: "Estates" },
  { value: "RESIDENTIAL", label: "Residential" },
  { value: "LEISURE", label: "Leisure" },
  { value: "CORPORATE_IT", label: "Corporate IT" },
  { value: "CORPORATE_HR", label: "Corporate HR" },
  { value: "CORPORATE_ADMIN", label: "Corporate Admin" },
];

// Spec item 12's fixed 4-value Location list for NPC requests — mirrors
// backend/src/lib/npcSbu.ts's NPC_LOCATION_OPTIONS.
export type NpcLocation = "OE" | "CC" | "GH" | "CV";
export const NPC_LOCATION_OPTIONS: { value: NpcLocation; label: string }[] = [
  { value: "OE", label: "OE" },
  { value: "CC", label: "CC" },
  { value: "GH", label: "GH" },
  { value: "CV", label: "CV" },
];

// Phase 3 — Budget Transfer & Reallocation (workflow revision). Served by
// the FastAPI backend (backend-py/), reached via the api2 client, same as
// Phase 2's Utilization Tracking.
export type TransferType = "REALLOCATION" | "SUPPLEMENTAL";
export type TransferDecision = "APPROVE" | "REJECT" | "RETURN";
// Still used by Internal Order Requests below (IO_SBU_OPTIONS/
// InternalOrderRequest.classification) - Transfer itself no longer has a
// classification concept after the workflow revision (SBU is chosen
// directly by the requestor instead).
export type TransferClassification = "DOE" | "GAE";

export interface DepartmentHeadOption {
  id: string;
  name: string;
}

// "To"/"From" dropdown options for New Transfer (spec item 11) - the
// admin-maintained Cost Center / GL Account master lists, seeded from the
// "Budgeting System_CC-GL" file's PCCC/COA sheets and editable by the
// Budget Officer in the Admin Console. GET /transfers/cc-gl-options.
export interface CcGlEntry {
  id: number;
  code: string;
  name: string;
}
// Note 11 §5 - which SBU's Dash Flow queue this Cost Center's tickets route
// to (admin-editable, PATCH /transfers/cost-centers/:id/sbu).
export interface CostCenterEntry extends CcGlEntry {
  sbu: Sbu | null;
}
export interface CcGlOptions {
  costCenters: CostCenterEntry[];
  glAccounts: CcGlEntry[];
}

// Spec item 11's fixed 3-value Company list for New Transfer.
export type CompanyCode = "OLC" | "OCC" | "OCLP";
export const COMPANY_OPTIONS: { value: CompanyCode; label: string }[] = [
  { value: "OLC", label: "OLC" },
  { value: "OCC", label: "OCC" },
  { value: "OCLP", label: "OCLP" },
];

// Spec item 9's fixed 8-value SBU list for Internal Order Requests -
// distinct from the admin-configurable NPC_HEAD BudgetCodePrefix list
// (which splits Malls into GH/NonGH and isn't a 1:1 match with this list),
// so it's its own small fixed set, mirrored exactly from
// backend-py/app/routers/internal_orders.py's IO_SBU_INFO. The 5 regional
// entries route DOE, the 3 Corporate ones route GAE.
export type IoSbuCode = "MALLS" | "OFFICES" | "ESTATES" | "RESIDENTIAL" | "LEISURE" | "CORPORATE_IT" | "CORPORATE_HR" | "CORPORATE_ADMIN";
export const IO_SBU_OPTIONS: { value: IoSbuCode; label: string; classification: TransferClassification }[] = [
  { value: "MALLS", label: "Malls", classification: "DOE" },
  { value: "OFFICES", label: "Offices", classification: "DOE" },
  { value: "ESTATES", label: "Estates", classification: "DOE" },
  { value: "RESIDENTIAL", label: "Residential", classification: "DOE" },
  { value: "LEISURE", label: "Leisure", classification: "DOE" },
  { value: "CORPORATE_IT", label: "Corporate IT", classification: "GAE" },
  { value: "CORPORATE_HR", label: "Corporate HR", classification: "GAE" },
  { value: "CORPORATE_ADMIN", label: "Corporate Admin", classification: "GAE" },
];

export interface IoLocation {
  id: number;
  code: string;
  label: string;
  sortOrder: number;
}

export type IoRequestType = "REALLOCATION" | "SUPPLEMENT";
export type IoReallocationSourceType = "NPC_BUDGET" | "IO_BUDGET";

export interface IoReviewDecisionOut {
  id: number;
  stage: string;
  decision: TransferDecision;
  comment: string | null;
  timestamp: string;
  decidedByName: string;
}

export interface InternalOrderRequest {
  id: number;
  requestorId: string;
  requestorName: string;
  departmentId: string;
  departmentName: string;
  fiscalYear: number;
  sbu: IoSbuCode;
  sbuLabel: string;
  classification: TransferClassification;
  routingStream: "BU_FINANCE" | "CORPORATE_FINANCE" | null;
  location: string;
  projectTitle: string;
  projectStart: string;
  projectEnd: string;
  amount: number;
  costCenter: string;
  isBudgeted: boolean;
  npcBudgetCode: string | null;
  requestType: IoRequestType | null;
  reallocationSourceType: IoReallocationSourceType | null;
  reallocationNpcBudgetCode: string | null;
  reallocationIoBudgetCode: string | null;
  currentStage: string;
  status: "DRAFT" | "IN_REVIEW" | "RETURNED" | "REJECTED" | "APPROVED" | "UPLOADED_TO_SAP";
  sapDocumentNumber: string | null;
  createdAt: string;
  updatedAt: string;
  reviewDecisions: IoReviewDecisionOut[];
}

// Phase 1's approved NPC budget codes, offered as a dropdown source for the
// Internal Order Request form (spec item 9). Served by the Node backend
// (BudgetRequest is Node-owned) - GET /budget-requests/approved-npc-codes.
export interface ApprovedNpcCode {
  id: string;
  budgetCode: string;
  npcHeadCode: string | null;
  npcSbu: NpcSbu | null;
  expenseLineItemName: string;
}

export interface TransferReviewDecisionOut {
  id: number;
  stage: string;
  decision: TransferDecision | "REASSIGN";
  comment: string | null;
  timestamp: string;
  decidedByName: string;
}

export interface TransferAttachmentOut {
  id: number;
  fileName: string;
}

export interface TransferBalanceOut {
  budget: number;
  actual: number;
  commitment: number;
  allotted: number;
  available: number;
}

export interface TransferRequest {
  id: number;
  ticketNumber: string;
  requestorId: string;
  requestorName: string;
  departmentId: string;
  departmentName: string;
  assignedDepartmentHeadId: string | null;
  assignedDepartmentHeadName: string | null;
  fiscalYear: number;
  type: TransferType;
  amount: number;
  details: string;
  budgetSourceCostCenter: string | null;
  budgetSourceCostCenterName: string | null;
  budgetSourceGlAccount: string | null;
  budgetSourceGlAccountName: string | null;
  targetCostCenter: string | null;
  targetCostCenterName: string | null;
  targetGlAccount: string | null;
  targetGlAccountName: string | null;
  companyCode: CompanyCode | null;
  sbu: Sbu | null;
  location: string | null;
  stageAssigneeOverrideId: string | null;
  stageAssigneeOverrideName: string | null;
  currentStage: string;
  status: "DRAFT" | "IN_REVIEW" | "RETURNED" | "REJECTED" | "CANCELLED" | "APPROVED" | "UPLOADED_TO_SAP";
  sapDocumentNumber: string | null;
  createdAt: string;
  updatedAt: string;
  reviewDecisions: TransferReviewDecisionOut[];
  attachments: TransferAttachmentOut[];
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
  requestCategory: RequestCategory;
  sbu: Sbu | null;
  // NPC's picked BudgetCodePrefix (kind=NPC_HEAD) code, e.g. "JLC". Superseded
  // by npcSbu below for requests created after spec item 12's revision - null
  // for every request except older NPC rows.
  npcHeadCode: string | null;
  // NPC (spec item 12 revision) fields - null for every other category.
  npcSbu: NpcSbu | null;
  npcLocation: NpcLocation | null;
  projectTitle: string | null;
  projectStartDate: string | null;
  projectEndDate: string | null;
  // DOE/NPC's generated "SBU-YY-Num" Budget Code, set once at creation. Null
  // for GAE (read expenseLineItem.budgetCode instead) and Revenue.
  budgetCode: string | null;
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
  // Names of whoever currently needs to act on this request, resolved
  // server-side from its stage + department (see lib/pendingReviewers.ts).
  // Only present on /my-requests responses; empty for terminal stages.
  pendingReviewers?: string[];
}

// Note 11 §3/§4 - the "Finalize & Upload" snapshot report, shared by the
// Budget-Officer-only Finalized Budget Report and the SBU-scoped Approved
// Budget report (see backend/src/services/finalizedBudgetReportService.ts).
export interface FinalizedBudgetLineOut {
  glAccount: string;
  glAccountName: string | null;
  costCenter: string;
  costCenterName: string | null;
  requestCategory: RequestCategory;
  sbu: Sbu | null;
  npcSbu: NpcSbu | null;
  amount: number;
  lineCount: number;
}

export interface BoardBudgetCheckOut {
  requestCategory: RequestCategory;
  sbu: Sbu | null;
  boardApprovedAmount: number;
  totalFinalizedAmount: number;
  variance: number;
}

export interface FinalizedBudgetReport {
  fiscalYear: number;
  lines: FinalizedBudgetLineOut[];
  boardBudgetChecks: BoardBudgetCheckOut[];
}

export interface ApprovedBudgetOut {
  sbu: Sbu;
  fiscalYear: number;
  doe: FinalizedBudgetReport | null;
  revenue: FinalizedBudgetReport | null;
  npc: FinalizedBudgetReport | null;
  gae: FinalizedBudgetReport | null;
}

// Spec item 16 - Revenue's per-CC-GL template upload. One upload creates a
// *batch* of BudgetRequest rows (one per CC-GL) that travel through the
// SBU-role approval chain together - GET /revenue-batches/... always
// returns this batch-shaped summary/detail, never the raw BudgetRequest rows
// individually (see backend/src/routes/revenueBatches.ts).
export interface RevenueBatchRow {
  id: string;
  costCenter: string;
  glAccount: string;
  monthlyAmounts: number[];
  proposedAmount: number;
}

export interface RevenueReviewDecision {
  id: string;
  stage: string;
  decision: "APPROVE" | "RETURN";
  decidedByName: string;
  comment: string | null;
  timestamp: string;
}

export interface RevenueBatchSummary {
  id: string;
  fiscalYear: number;
  sbu: Sbu | null;
  company: { id: string; name: string; code: string } | null;
  sourceFileRef: string;
  boardApprovedAmountAtUpload: number | null;
  rowCount: number;
  totalAmount: number;
  currentStage: string;
  status: string;
  createdAt: string;
}

export interface RevenueBatchDetail extends RevenueBatchSummary {
  uploadedByName: string;
  rows: RevenueBatchRow[];
  reviewDecisions: RevenueReviewDecision[];
}

export interface HeadcountReviewDecision {
  id: string;
  stage: string;
  decision: "APPROVE" | "REJECT" | "RETURN";
  comment: string | null;
  timestamp: string;
  decidedBy: { name: string };
}

// Notes_14: "After the approval of Reggie (Reviewer), the request will
// route to Ronilo (Approver)" — Office 365/Mobile Phone follow-ons are now
// a fixed two-stage chain instead of one flat approve/reject.
export type FollowOnRequestStage = "REVIEWER_REVIEW" | "APPROVER_REVIEW" | "APPROVED" | "REJECTED";

// Notes_11: the Details page shows the auto-generated Office 365/Mobile
// Phone follow-ons alongside the headcount request they came from — this is
// their status as returned nested inside a headcount request's own detail
// fetch (no `additionalHeadcountRequest` back-reference there, unlike the
// top-level Office365AccountRequest/MobilePhoneBudgetRequest below).
export interface HeadcountFollowOnStatus {
  id: string;
  stage: FollowOnRequestStage;
  reviewerDecidedBy: { name: string } | null;
  reviewerComment: string | null;
  reviewerDecidedAt: string | null;
  approverDecidedBy: { name: string } | null;
  approverComment: string | null;
  approverDecidedAt: string | null;
  createdAt: string;
}

// Only present on the /reviewed-by-me endpoints — which of the two stages
// *this* viewer personally decided, synthesized server-side.
export interface FollowOnMyDecision {
  decision: "APPROVE" | "REJECT";
  stage: "REVIEWER_REVIEW" | "APPROVER_REVIEW";
  comment: string | null;
  timestamp: string;
}

export interface AdditionalHeadcountRequest {
  id: string;
  code: string;
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
  office365AccountRequest?: HeadcountFollowOnStatus | null;
  mobilePhoneBudgetRequest?: HeadcountFollowOnStatus | null;
  // Only present on /my-requests; empty for terminal stages (see
  // lib/pendingReviewers.ts).
  pendingReviewers?: string[];
}

// Notes_8: "This will reflect on the list of employees for Mobile Phone and
// other sections that need employee list." Real employees and pending
// (not-yet-hired) Additional Headcount Requests share this shape so an
// Employee Name picker can offer both from one list.
export interface EmployeeOption {
  id: string;
  name: string;
  department: string | null;
}

// Notes_8: auto-created once an Additional Headcount Request reaches HR
// Head approval. Notes_14: Reviewer decides first, then Approver.
export interface Office365AccountRequest extends HeadcountFollowOnStatus {
  additionalHeadcountRequest: AdditionalHeadcountRequest;
  myDecision?: FollowOnMyDecision;
}

// Notes_8 (revised): auto-created alongside the Office 365 request.
// Notes_14: same Reviewer-then-Approver chain, Admin Services instead of
// IS & IT.
export interface MobilePhoneBudgetRequest extends HeadcountFollowOnStatus {
  additionalHeadcountRequest: AdditionalHeadcountRequest;
  myDecision?: FollowOnMyDecision;
}

// Phase 4 — Budget Report & Analysis (Functional Spec §6, FR-4.1-4.8; Note
// 12's dashboard redesign). Served by the FastAPI backend (backend-py/),
// reached via the api2 client, same as Phase 2/3.
export type ReportPeriod = "ANNUAL" | "Q1" | "Q2" | "Q3" | "Q4" | "MONTHLY" | "YTD";

// Note 12 - "Financial Scope": Operating Expense (GAE+DOE combined),
// Revenue, Non-Project Capex - a new grouping distinct from every other
// category concept in this app (Expense Category, SBU).
export type FinancialScope = "OPEX" | "REVENUE" | "NPC";
export const FINANCIAL_SCOPE_OPTIONS: { value: FinancialScope; label: string }[] = [
  { value: "OPEX", label: "Operating Expense" },
  { value: "REVENUE", label: "Revenue" },
  { value: "NPC", label: "Non-Project Capex" },
];

export interface ReportLineItem {
  id: string;
  name: string;
  budgetCurrent: number;
  actualCurrent: number;
  forecastCurrent: number | null;
  variance: number;
  variancePct: number | null;
}

export interface ReportRow {
  expenseGroup: string;
  financialScope: FinancialScope | "";
  budgetCurrent: number;
  actualCurrent: number;
  forecastCurrent: number | null;
  budgetPrior: number;
  actualPrior: number;
  variance: number; // Budget vs Actual
  variancePct: number | null;
  varianceBudgetForecast: number | null;
  varianceActualForecast: number | null;
  noteCount: number;
  lineItems: ReportLineItem[];
}

export interface ReportSummary {
  fiscalYear: number;
  priorFiscalYear: number;
  period: ReportPeriod;
  // Spec item 15 - "current YTD reporting period": the latest month (1-12)
  // any Actuals data exists for in fiscalYear, computed live from the data
  // rather than reused from Forecast's own as-of-month config.
  latestActualMonth: number | null;
  rows: ReportRow[];
  totals: ReportRow;
}

export interface ReportFilterOptions {
  costCenters: { code: string; name: string }[];
  glAccounts: { code: string; name: string }[];
  expenseGroups: string[];
  // Spec item 15 - fixed 5-value report-only SBU list (Malls/Offices/
  // Estates/Residential/Corporate-GAE), always returned as this same list -
  // included in the API response (not hardcoded twice) so the frontend and
  // backend never drift.
  sbus: string[];
  financialScopes: FinancialScope[];
}

export interface ReportTrendPoint {
  fiscalYear: number;
  budget: number;
  actual: number;
}

// Note 12 - Comparison Chart data (Monthly/Quarterly buckets). Rendered as
// two stacked panels (bars on budget/actual, a line below on variancePct)
// rather than one dual-axis chart - see ComparisonChart.tsx.
export interface ReportSeriesPoint {
  period: string;
  budget: number;
  actual: number;
  forecast: number | null;
  variancePct: number | null;
}

export interface ReportNote {
  id: number;
  fiscalYear: number;
  expenseGroup: string;
  month: number | null;
  text: string;
  authorName: string;
  createdAt: string;
}

export interface ReportAccessGrant {
  id: number;
  userId: string;
  userName: string;
  userEmail: string;
  createdAt: string;
}

export interface ReportPeriodLock {
  id: number;
  fiscalYear: number;
  month: number;
  lockedByName: string;
  lockedAt: string;
}
