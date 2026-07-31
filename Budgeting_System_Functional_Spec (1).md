# Functional Specification — Budgeting System (BS)

**Version:** 2.0 (Draft)
**Source:** Budgeting_System_Process_Flow_072326_sent.docx
**Prepared for:** Engineering / Implementation handoff

---

## 1. Overview

### 1.1 Objective
Automate and streamline the end-to-end budgeting process via an **Application Program Interface (API) integration with SAP** — eliminating manual data entry and giving teams real-time visibility into actual spending. The system covers four phases:

1. **Phase 1 — Annual Budget Setting:** Requestors choose expenses from a standardized dropdown, which locks in the correct SAP CC-GL codes and shows the allowable spending limit while letting the Requestor enter a realistic amount. The final budget is based on **Board of Directors (BOD) approval** and is allocated to departments; the portal then pushes the finalized budget into SAP, eliminating manual uploads.
2. **Phase 2 — Budget Utilization Tracking:** The system reports actuals vs. budget per GL account (month and YTD), identifying the nature of each expense via a keyword/standard-text mapping mechanism.
3. **Phase 3 — Budget Transfer & Reallocation:** Simplifies fund transfers and supplemental budget requests while maintaining financial oversight and audit tracking.
4. **Phase 4 — Budget Report & Analysis:** Provides dynamic dashboards and reports without manual data consolidation.

### 1.2 Scope
The system is designated for **General and Administrative (G&A)** expenses — centralized expenditures across the **Admin, IT, Human Resources, Corporate Finance, Tax, and Legal** departments.

### 1.3 Glossary

| Term | Definition |
|---|---|
| GL-CC | General Ledger Account + Cost Center combination |
| BAPI | Business Application Programming Interface (SAP integration method) |
| BC&A | Budget, Control & Analysis department |
| PO / PR | Purchase Order / Purchase Requisition |
| GAE | General & Administrative Expenses |
| DOE | Direct Operating Expenses |
| BU | Business Unit |
| YTD | Year to Date |
| BOD | Board of Directors |

### 1.4 Actors / Roles

| Role | Responsibilities |
|---|---|
| Requestor | Creates departmental budget requests |
| Department Head | First approval gate for a requestor's own department |
| Centralized First-Level Reviewer | Per centralized department (HR, Admin, IT, Legal, Corporate Finance, Tax) — e.g. IT Analyst, HR Specialist. Reviews requests grouped per expense line item and decides Approve/Reject at Step 3A |
| Centralized Department Head | HR Head, Admin Head, IT Head, Legal Head, Corporate Finance Head, or Tax Head — decides Approve/Return at Step 3B |
| BC&A Head | Approves high-value expense line items (> ₱1,000,000) |
| Budget Officer | Owns master data (Expense Line Item catalog, GL-CC mappings), performs technical review/finalization at Step 5, applies budget cuts, sets the Board-Approved Budget figure, manually triggers the SAP upload, sole default user of the Phase 4 reporting module, assigns reviewer/approver roles and Centralized Department Budget Preparers (back-end), sets per-stage due dates |
| BU Finance Officer / BU Finance Head | Reviews/approves DOE reallocation requests |
| Corporate Finance Team / CFO | Reviews/approves GAE reallocation requests |
| BC&A (org unit, distinct from BC&A Head) | Owns the Departmental Exception Table (growth-rate overrides) |
| Centralized Department Budget Preparer | One or more assigned per centralized department (HR, Admin, IT, Legal, Corporate Finance, Tax) by the Budget Officer; submits budget requests on behalf of that centralized department's own operational needs |
| Board of Directors (BOD) | Approves the final overall 2027 budget. This approval appears to happen outside the portal — the Budget Officer records the resulting Board-Approved Budget figure in the system (see Section 8, Open Questions) |

---

## 2. Data Entities (for schema design)

This is not an exhaustive data model — it lists the entities and key attributes implied by the business rules, for the engineering team to formalize into a schema.

- **Department** — id, name, type (Requesting / Centralized), assigned Department Head
- **RoleAssignment** — department_id, role_type (Department Head / Centralized First-Level Reviewer / Centralized Department Head / BC&A Head / Centralized Department Budget Preparer), assigned_user_id, assigned_by (Budget Officer), effective_date
- **WorkflowStageConfig** — stage_id (Step 1–5), department_id, due_date, configured_by (Budget Officer)
- **BulkUploadBatch** — id, uploaded_by, department_id, fiscal_year, source_file_ref, row_count, validation_errors[], status
- **BudgetRequest** — id, department_id, fiscal_year, status, originating_department (read-only), target_calendar_year (read-only, hardcoded), expense_line_item_id, monthly_spend_grid[12], proposed_amount (computed), business_justification, supporting_attachments[], other_required_fields{}, current_stage, reason_code (if returned), budget_cut_amount (Step 5), review_decision_log[] (Approve/Reject/Return per stage)
- **ExpenseLineItem** — id, name, GL_account, cost_center, is_custom (bool), status (standard/pending-refinement), managed_by (Budget Officer)
- **DepartmentalBudgetCap** — department_id, fiscal_year, value, formula inputs (2026 actuals YTD, 2026 remaining forecast, growth rate)
- **GrowthRate** — default_value, department_overrides[] (Departmental Exception Table), edited_by; effective logic: department override > default
- **GrowthRateAuditLog** — id, user_id, old_value, new_value, timestamp, reason (mandatory free text)
- **RemainingDepartmentalPool** — department_id, fiscal_year, value = cap − sum(approved requests)
- **ForecastEntry** — department_id, CC-GL, GL description, 2026 remaining months forecast (must be completed before Centralized First-Level Review)
- **VarianceThresholdConfig** — scope (global/department), threshold_type (amount or percent), value, configured_by (Budget Officer)
- **BoardApprovedBudget** — fiscal_year, amount, set_by (Budget Officer), revision_history[] (timestamped)
- **StandardExpenseTextDirectory** — CC-GL, standard item text, expense_line_item_id (source: external reference file "Budgeting System_Expense Line Items" — see Section 8)
- **SAPTransaction (cached)** — type (PR/PO/Invoice/Journal Entry), GL account, cost center, item text, amount, posted status
- **ReconciliationRecord** — expense_line_item_id, matched_text, amount, status (matched / unmapped exception)
- **TransferRequest** — id, requestor, type (reallocation / supplemental), amount, expense_line_item_id, budget_source (if transfer), reason, attachments[], classification (DOE/GAE), routing_stream, status
- **ReportPeriod** — period, lock_status, signed_off_by
- **ReportAccessGrant** — user_id, granted_by (Budget Officer), granted_at, scope (e.g., specific period/report or module-wide)
- **ReportNote** — report_line_item_ref, note_text, author (Budget Officer), timestamp

---

## 3. Phase 1 — Annual Budget Setting

### 3.1 Role Assignment & Access Configuration

**FR-1.1** The Budget Officer can assign/reassign, via a back-end admin interface and **without requiring a code redeployment**, which individual holds each of the following roles per department: Department Head, Centralized First-Level Reviewer, Centralized Department Head, BC&A Head.

**FR-1.2** The Budget Officer can assign one or more **Centralized Department Budget Preparers** per centralized unit (HR, Admin, IT, Legal, Corporate Finance, Tax) via the same back-end interface.

**FR-1.3** Centralized Departments operate in **two distinct roles** in the system:
- Reviewing/approving incoming requests routed from other (Requesting) departments (Steps 3A/3B).
- Originating their own departmental budget requests via their assigned Preparer(s), following the same standard workflow as any other Requestor (Step 1 onward).

### 3.2 Budget Setting & Ceiling Methodology

**FR-1.4 — Departmental Budget Cap calculation**
```
2027 Departmental Budget Cap =
    (2026 Actuals YTD + 2026 Remaining Months Forecast) x (1 + Growth Rate / 100)
```

**FR-1.5 — Remaining Departmental Pool calculation**
```
Remaining Departmental Pool =
    2027 Departmental Budget Cap - Sum of Approved Portal Requests
```

**FR-1.6** Both figures must **recalculate in real time across all relevant user dashboards** (Requestor, Department Head, Centralized Department Head, BC&A) whenever an input changes — a new approved request, an updated forecast, or a modified growth rate.

**FR-1.7** Growth Rate edits are restricted **exclusively to the Budget Officer**, via the portal admin dashboard.

**FR-1.8** A **Departmental Exception Table** allows **BC&A** to override the growth rate per department. Resolution order: a department-level override (if present) takes precedence over the default growth rate.

**FR-1.9 — Growth Rate audit log** — every edit must write an audit record capturing:
1. Who changed it (user id)
2. Old value
3. New value
4. Timestamp
5. Reason for change (mandatory free-text field)

**FR-1.10 — Forecast completion gate** — the portal blocks Centralized First-Level Review (Step 3A) from proceeding until the **2026 Remaining Months Forecast** is completed via a clickable dashboard trigger. The forecast view must show **2025 Actuals, 2026 Approved Budget, and 2026 YTD Actuals per CC-GL**, with GL description, for the given department.

### 3.3 Workflow Timeline

**FR-1.11** Each of the five workflow stages (Section 3.4) follows a timeline managed in the system back-end: the Budget Officer sets a **specific due date** per stage for completion.

> **Open item:** the source material does not specify system behavior when a stage's due date is missed (e.g., auto-escalation, reminder notifications, or hard block). See Section 8.

### 3.4 End-to-End Budget Request Workflow

#### Step 1 — Departmental Request Creation (Requestor)

**FR-1.12** All requests are built via the standard dropdown list. Free-text entry for standard budget lines is prohibited.

**FR-1.13** Selected line items automatically map to pre-configured GL Account + Cost Center (GL-CC) combinations managed exclusively by the Budget Officer. The GL-CC field is **locked from user modification**.

**FR-1.14 — Unlisted Expenses**
- Free-text entry is allowed for expenses not found in the standard dropdown.
- Custom submissions route directly to the Budget Officer's dashboard for review.
- The Budget Officer can refine the expense title for standardized naming and must assign the appropriate CC-GL mapping.

**FR-1.15 — Required Request Fields (submission blocked until complete)**

| # | Field | Type | Behavior |
|---|---|---|---|
| 1 | Originating Department | Read-only | Auto-defaults to the Requestor's assigned unit based on system login |
| 2 | Target Calendar Year | Read-only | Hardcoded to 2027 for the current cycle. Back-end admin control lets the Budget Officer manually open/close the budget cycle |
| 3 | Expense Line Item | Drop-down | Standardized catalog managed by the Budget Officer (e.g., "Company Summer Outing") |
| 4 | Monthly Spend Grid (Jan–Dec) | Numeric grid | Requestor enters amounts per month |
| 5 | 2027 Proposed Amount | Read-only, computed | Sum(Jan..Dec) from the Monthly Spend Grid, real-time. Must be > 0 to submit |
| 6 | Business Justification | Text area | Mandatory narrative |
| 7 | Supporting Attachments | File upload | Mandatory only if 2027 Proposed Amount exceeds a configurable corporate documentation threshold |
| 8 | Other Required Fields | Text area | Automatically adjusts per line item based on validation rules pre-configured by the Budget Officer |

**FR-1.16 — Bulk Upload via Excel Template**
- The portal provides a downloadable Excel template (per fiscal year) mirroring the standard request fields above.
- A Requestor can fill in the template offline and upload it to the portal to create multiple budget requests in one action.
- Uploaded rows must follow the **same validation rules** as manually created requests.

> **Open item:** row-level error handling for bulk upload (e.g., whether one invalid row blocks the whole batch or only that row) is not specified. See Section 8.

#### Step 2 — Departmental Authorization (Department Head)

**FR-1.17** The ticket routes to the immediate Department Head of the originating unit. Decision: **Approve** (advances the request) or **Return to Requestor**.

#### Step 3A — Centralized First-Level Review (HR, Admin, IT, Legal, Corporate Finance, or Tax)

**FR-1.18** Incoming requests route **per expense line item** (with GL account category grouping) to the designated First-Level Reviewer (e.g., IT Analyst, HR Specialist).

**FR-1.19** The review screen must display: **2025 Actuals, 2026 Approved Budget, 2026 YTD Actuals, 2026 Remaining Months Forecast, 2027 Departmental Budget Cap, 2027 Portal Requests, and 2027 Remaining Departmental Pool.**

**FR-1.20** For each expense line item, the Reviewer decides **Approve** or **Reject**. A Reject deducts the item from the 2027 Portal Requests total.

**FR-1.21 — Variance check** — if the total 2027 Portal Requests exceeds the calculated 2027 Budget Cap by a **configurable threshold** (amount or percentage, set by the Budget Officer in the back-end), the portal blocks submission and requires the First-Level Reviewer to enter a mandatory variance justification.

#### Step 3B — Centralized Department Head Review

**FR-1.22** After Step 3A, requests route to the relevant Centralized Department Head (HR Head, Admin Head, IT Head, Legal Head, Corporate Finance Head, or Tax Head).

**FR-1.23** The review screen must display the same data set as FR-1.19: 2025 Actuals, 2026 Approved Budget, 2026 YTD Actuals, 2026 Remaining Months Forecast, 2027 Departmental Budget Cap, 2027 Approved Portal Requests, and 2027 Remaining Departmental Pool.

**FR-1.24** For each expense line item, the Head decides **Approve** or **Return** (back to the Centralized First-Level Reviewer at Step 3A). A Return requires a mandatory explanation.

#### Step 4 — BC&A Head Approval (conditional)

**FR-1.25** If the value of an expense line item is greater than **₱1,000,000**, the portal automatically routes the ticket directly to the BC&A Head.

**FR-1.26** Expense items of ₱1,000,000 or less automatically skip this step and route directly to Step 5.

#### Step 5 — Technical Review & Finalization (Budget Officer)

**FR-1.27** Requests route to the Budget Officer's dashboard with detail grouped by **Centralized Department, GL category, and expense line item**, including monthly amounts, subtotals, and totals. Each row has a **"Detail" button** giving access to the requestor's justifications, remarks, and attachments.

**FR-1.28** If requests exceed the centralized departmental budget cap, the portal automatically tags them as **"Over-budget / Requires Realignment."**

**FR-1.29** In a separate column, the Budget Officer can **apply budget cuts** at the individual expense-line-item level.

**FR-1.30** The dashboard includes monthly columns for **2026 YTD Actuals** and **2026 Remaining Months Forecast**, compared against **2027 Portal Requests**, displaying variance as both an absolute amount and a percentage increase/decrease.

**FR-1.31** The Budget Officer can return a request to the appropriate prior stage using a **standardized reason** (e.g., Insufficient Documentation, Unrealistic 2026 Forecast, Incorrect Expense Item Selection) that is configurable in the system back-end.

**FR-1.32** At the top of the dashboard, an **editable field** lets the Budget Officer set the **2027 Board-Approved Budget**, with time-stamped revision tracking. The dashboard also displays the **2027 Total Proposed Budget** and a live **Variance** metric (absolute amount and percentage) between the two.

### 3.5 Automated SAP Integration

**FR-1.33** Upon final approval at Step 5, the portal allows the Budget Officer to **manually trigger** the upload of approved requests to SAP (this is a change from a prior fully-automatic-on-approval model — the trigger is now a deliberate Budget Officer action).

**FR-1.34** The upload triggers the appropriate standard SAP transaction (e.g., **KP06** for Cost Center Cost Planning).

**FR-1.35** The portal must: (1) capture the SAP Document Number or success log returned by SAP; (2) bind it permanently to the portal ticket for audit trail purposes; (3) close the ticket; (4) automatically notify the Requestor.

---

## 4. Phase 2 — Budget Utilization Tracking

### 4.1 Access Scope

**FR-2.1** The Budget Utilization Dashboard is visible **only to Centralized Department Preparers and Heads.**

> **Open item:** this appears to exclude Requesting Departments and their Department Heads from any utilization visibility into their own submitted budgets. Confirm whether this is intentional. See Section 8.

### 4.2 View A — Departmental Overview

**FR-2.2** Per department/GL-CC, the dashboard computes and displays:
```
Approved Budget       = Jan-Dec Approved Amounts from Budget Setting stage
Actual Expenditures   = Total Posted and Cleared Invoices/Expenses in SAP
Commitments            = Open POs and Approved Purchase Requisitions (PRs) in SAP
Total Allotted            = Actual Expenditures + Commitments
Available                    = Approved Budget - Total Allotted
```

### 4.3 View B — Live Reconciliation

**FR-2.3** SAP PR creators and accounting staff use **standardized item text** when posting transactions. This standard text list is maintained in a separate external reference file, **"Budgeting System_Expense Line Items"** (an Excel workbook outside the portal — see Section 8 for integration/sync questions).

**FR-2.4** The portal pulls posted actuals from SAP and matches them against the expense directory using **CC-GL + standard text** (referencing the external "Budgeting System_Expense Line Items" file).

**FR-2.5 — Successful match:** the transaction amount is automatically deducted from the matched line item's running balance.

**FR-2.6 — Unmapped exception:** if the posted text doesn't match any expense line item (e.g., "Fee April"), the item is placed in an **"Unmapped SAP Actuals"** row. The **Budget Officer** can click this row at any time to manually assign the expense to its proper line item via a dropdown.

#### Sample Reconciliation View (View B)

| Expense Line Item | 2027 Approved Budget | SAP Actual | Item Status / Text |
|---|---|---|---|
| Cloud Internet Security | ₱800,000.00 | ₱800,000.00 | Fully Utilized [security] |
| Annual Maintenance of Network Advance Threat Protection | ₱500,000.00 | ₱500,000.00 | Fully Utilized [maintenance] |
| Unmapped SAP Actuals | ₱0.00 | ₱0.00 | 0 Exceptions Pending [Click to map unparsed lines] |
| **Total** | **₱1,300,000.00** | **₱1,300,000.00** | **Match Verified with SAP** |

---

## 5. Phase 3 — Budget Transfer & Reallocation

**FR-3.1 — Request Creation** — a user initiates a request for a budget reallocation or additional budget. Required fields: **amount, expense line item (dropdown), budget source (if transfer), reason, and applicable attachments.**

**FR-3.2 — Department Head Review & Approval**

**FR-3.3 — Budget Officer Validation** — the Budget Officer validates technical details and reassigns the request by expense classification:
- **DOE** (Direct Operating Expenses) → reassigned to the **BU Finance team**
- **GAE** → reassigned to the **Corporate Finance team**

**FR-3.4 — BU Finance Head or Corporate Finance Review & Approval** (per stream from FR-3.3)

**FR-3.5 — BU Head / CFO Authorization**

**FR-3.6 — SAP Upload & Ticket Completion** — upon final authorization, the ticket returns to the Budget Officer, who triggers the data upload to SAP to execute the transfer/allocation:
- **DOE:** managed and verified by the BU Finance Officer.
- **GAE:** managed and verified by the Budget Officer.

**FR-3.7 — Balance Validation** — the system performs an automated check to ensure the **budget source** has sufficient remaining funds for the requested transfer amount.

> **Open item:** the prior version of this process flow specified an explicit audit-trail requirement (timestamps, user IDs, justification notes logged for every transfer action). The current source no longer states this explicitly. Confirm whether Phase 3 still requires dedicated audit logging beyond the general logging implied in Section 7. See Section 8.

---

## 6. Phase 4 — Budget Report & Analysis

### 6.1 Automated Ledger Close & Budget Officer Report Dashboard

**FR-4.1** Upon closing of the monthly accounting period — **integrating directly with a separately developed financial closing system** — the portal automatically produces the following report at the **CC-GL level** (with expense grouping):
- Budgets vs. actuals
- Budgets vs. forecasts
- Current year (budget/actual/forecast) vs. prior year figures

**FR-4.2** The Budget Officer can filter reports by **cost centers, GL accounts, expense groups, and periods** (monthly, quarterly, annual).

**FR-4.3** The Budget Officer can select **5-year or 10-year** trend comparisons for budgets and actuals.

**FR-4.4** The Budget Officer can attach **notes/analysis to each line item.**

> **Open item:** the interface/data contract with the "separately developed financial closing system" referenced in FR-4.1 is not specified (push vs. pull, format, timing). See Section 8.

### 6.2 User Access

**FR-4.5** Reports are accessible **by default only to the Budget Officer.**

**FR-4.6** The Budget Officer can **grant access to individual users upon request** — the system must support explicitly authorizing a specific user's access to the reporting module.

### 6.3 Data Extraction to Excel

**FR-4.7** The Budget Officer can extract reports into an Excel file.

### 6.4 Period Lock

**FR-4.8** A sign-off button lets the Budget Officer conclude the report cycle, which **locks the period's data against modification.**

> **Open item:** the prior process-flow version specified encrypted, restricted-database archiving on period lock. The current source only states the data is locked against modification and does not mention archiving or encryption. Confirm whether archiving/encryption is still a requirement. See Section 8.

---

## 7. Cross-Cutting Requirements

- **Configurability owned by Budget Officer:** Expense Line Item catalog & GL-CC mappings, default Growth Rate, documentation threshold, variance threshold (amount or %), budget cycle open/close control, standardized Reason Codes, per-stage due dates, Board-Approved Budget figure.
- **Configurability owned by BC&A:** Departmental Exception Table (growth rate overrides).
- **Immutable/system-controlled fields:** GL-CC assignment (Requestor cannot edit), Originating Department, Target Calendar Year.
- **Audit logging** is explicitly required for: Growth Rate changes (FR-1.9), SAP document binding (FR-1.35), and Board-Approved Budget revisions (FR-1.32, "time-stamped revision tracking"). Whether a general-purpose audit log should also cover every workflow approve/reject/return action and Phase 3 transfers is not explicit in the current source — see Section 8.

---

## 8. Open Questions / Assumptions for Engineering

These were not explicitly specified in the source document and should be confirmed before/during build:

1. **Missed due dates (FR-1.11):** what happens when a workflow stage's Budget-Officer-set due date passes without action — auto-escalation, reminder, hard block, or no system behavior at all?
2. **Bulk upload error handling (FR-1.16):** does one invalid row block the entire batch, or are valid rows accepted while invalid rows are rejected individually?
3. **Documentation threshold (Field 7) and variance threshold (FR-1.21):** confirm these are configurable per the Budget Officer's back-end settings as stated, and whether they are global constants or configurable per department/line item.
4. **Phase 2 dashboard access scope (FR-2.1):** the dashboard is stated as visible only to Centralized Department Preparers and Heads. Does this intentionally exclude Requesting Departments from visibility into their own budget utilization, or is that an omission?
5. **"Budgeting System_Expense Line Items" file (FR-2.3/2.4):** this is referenced as an external Excel workbook maintaining the standard text/expense directory. How does the portal ingest or sync this file — manual upload by the Budget Officer, a scheduled import, or a live connection? Is it the same artifact as the ExpenseLineItem catalog managed by the Budget Officer in Phase 1, or a separate reference source?
6. **SAP data refresh mechanism (Phase 2):** the current source does not specify how or how often the portal pulls data from SAP for Phase 2 tracking (a prior version specified a two-tier real-time-read + 30-minute batch-sync pipeline; this is no longer stated). Confirm the intended sync mechanism and cadence.
7. **SAP upload trigger wording (FR-3.6):** the source says the ticket "returns to the Budget Officer to trigger an automatic data upload" — confirm whether this upload is a manual action by the Budget Officer (consistent with the Phase 1 change in FR-1.33) or system-automatic once the ticket reaches the Budget Officer.
8. **Phase 3 audit trail:** confirm whether Phase 3 still requires the explicit audit-trail logging (timestamps, user IDs, justification notes) specified in a prior version, since the current source only states balance validation.
9. **Financial closing system integration (FR-4.1):** what is the data contract (push/pull, format, timing) with the separately developed financial closing system?
10. **Period lock archiving (FR-4.8):** confirm whether encrypted/restricted-database archiving is still required on period lock, or whether "locks the data against modification" is the complete requirement.
11. **Internal Departmental Budget Realignment:** a prior version of this process allowed the Budget Officer to reallocate surplus funds between line items within a department's cap to clear an over-budget request without rejection. This capability is not present in the current source (Step 5 now only offers budget cuts and return-with-reason). Confirm whether this capability should still exist.
12. **BOD approval mechanics:** the objective states the final budget is "based on the BOD approval." The workflow only shows the Budget Officer entering a Board-Approved Budget figure (FR-1.32) — confirm whether the BOD needs any direct system access/role, or whether their approval is entirely off-system with the Budget Officer recording the outcome.
13. **Board-Approved Budget vs. Departmental Caps:** how does the top-level 2027 Board-Approved Budget entered at Step 5 (FR-1.32) reconcile with or constrain the per-department Budget Caps calculated in FR-1.4? Is the Board-Approved figure a top-down ceiling that departmental caps must sum to, or an independent reference figure?
