# Budgeting System — Phase 1 (Annual Budget Setting)

A working implementation of Phase 1 of the Budgeting System functional spec (`Budgeting_System_Functional_Spec (1).md`):
role/admin configuration, budget request creation (incl. bulk upload), the 5-stage approval workflow with conditional
BC&A routing, real-time cap/pool calculations, the growth-rate exception table + audit log, and a mocked SAP upload
that binds a document number back to the request.

Phases 2–4 (Utilization Tracking, Transfer & Reallocation, Reporting & Analysis) are **not** built — this covers
Phase 1 only, per spec §3.

## Stack

- **Frontend:** React + Vite + TypeScript, Tailwind CSS, React Router, TanStack Query
- **Backend:** Node.js + Express + TypeScript, Prisma ORM
- **Database:** PostgreSQL 16
- **Auth:** Demo mode only — a role/user switcher, no passwords. Every seeded user can be "logged in as" via a
  dropdown; requests carry an `x-user-id` header. **Not suitable for production as-is.**
- **SAP integration:** Mocked behind `backend/src/services/sapMockAdapter.ts` — an isolated adapter that can be
  swapped for a real BAPI/RFC client later without touching any calling code.

## Prerequisites

- Node.js 20+
- PostgreSQL 16 running locally (see below — this machine has no Docker or admin rights, so a **portable, no-install**
  copy of Postgres was used instead of the usual installer/Docker route)

### Postgres (portable, no admin rights required)

Binaries live outside the repo at `C:\Users\<you>\pgsql16` (a ~600MB extracted zip — too large/binary for the repo or
OneDrive sync). The data directory is `C:\Users\<you>\pgsql16\data`.

Start it:
```bash
bash scripts/start-postgres.sh
```
Or manually:
```bash
"C:\Users\<you>\pgsql16\bin\pg_ctl.exe" -D "C:\Users\<you>\pgsql16\data" -l "C:\Users\<you>\pgsql16\server.log" -o "-p 5432" start
```
Credentials: user `budgeting` / password `budgeting`, database `budgeting_system` (matches `backend/.env.example`).

If you'd rather use Docker, `docker-compose.yml` at the repo root defines the same Postgres service — bring it up
with `docker compose up -d` instead of the portable binaries.

### A note on this OneDrive path

This project's folder name contains `&` (`Ortigas & Company, Limited Partnership`). On Windows, npm's default
`cmd.exe` script-shell mis-resolves `.cmd` shims (like `prisma`) when the working directory contains `&`, breaking
every `npm run` script. The root `.npmrc` points `script-shell` at Git Bash to work around this — don't remove it
unless you move the project to a path without special characters.

## Setup

```bash
cp backend/.env.example backend/.env
npm install
npm run db:migrate    # applies Prisma migrations
npm run db:seed        # seeds departments, demo users/roles, expense line items, reference actuals, etc.
npm run dev             # runs backend (:4000) and frontend (:5173) together
```

Open http://localhost:5173, pick a demo user from the dropdown (top right) to "log in", and explore. The seed script
prints every demo user's email/role to the console if you want the full list again — or check `backend/prisma/seed.ts`.

## Architecture notes

- **Owning vs. originating department:** every `ExpenseLineItem` has an `ownerDepartmentId` — the centralized
  department (Admin/IT/HR/Corporate Finance/Tax/Legal) that reviews requests against it at Steps 3A/3B and whose
  cap/pool the request draws down — separate from `BudgetRequest.departmentId`, the *originating* department
  (read-only, defaults from login). A Sales request for "Cloud Internet Security" routes to IT's reviewers and draws
  against IT's pool, matching the spec's G&A centralized-expenditure scope (§1.2).
- **Workflow engine:** `backend/src/services/workflowService.ts` is the single source of truth for the Step 1–5 state
  machine, transition guards, and `ReviewDecision` audit trail.
- **Cap/Pool:** `backend/src/services/budgetCalcService.ts` implements FR-1.4/1.5 exactly, resolving growth rate via
  department-override-then-default (FR-1.8). "Real-time" is implemented as always-current-on-read (React Query
  refetch), not a websocket push — a documented simplification.
- **SAP:** `HistoricalActuals` (2025 Actuals / 2026 Approved Budget / 2026 YTD Actuals) is admin-editable reference
  data standing in for a live SAP pull that doesn't exist yet — the natural place to wire in a real read later.

## Documented assumptions (spec §8 open questions, Phase-1-relevant only)

1. **Missed due dates:** informational only (an "overdue" flag), no auto-escalation/hard block.
2. **Bulk upload row errors:** valid rows are created; invalid rows are rejected individually with a per-row message.
3. **Thresholds:** variance threshold supports per-department scope; documentation threshold is a single global value.
4. **"Other Required Fields":** modeled as a per-expense-line-item list of `{label, required}`.
5. **HistoricalActuals** stands in for the live SAP pull (see above).
6. **Internal departmental realignment:** not implemented — Step 5 only offers budget cuts and return-with-reason.
7. **BOD approval:** entirely off-system; the Budget Officer enters the Board-Approved Budget figure manually.
8. **Board-Approved Budget vs. departmental caps:** displayed as an independent reference figure with a variance
   metric, not enforced as a hard ceiling on departmental caps.

Phase 2/3/4-only open questions are out of scope since those phases aren't built.

## What's not here

- Real authentication (passwords, sessions, SSO)
- Real SAP integration (BAPI/RFC) — mocked
- Phases 2–4 of the spec
- Automated tests (this was built and verified via manual end-to-end smoke testing through both the API and the UI)

---

## Amendment 1 — Real catalog, Manpower Budgeting, and notes-driven changes

Built from three real source files the user supplied afterward: `Budgeting System_Expense Line Items.xlsx` (the real
~230-row standard catalog), `Budgeting System_Manpower.xlsx` (target shape for the Manpower Budgeting module), and
`Budgeting System_Notes_071726.docx` (14 explicit change requests). Full plan/rationale is in
`C:\Users\<you>\.claude\plans\tingly-foraging-falcon.md` ("Amendment 1" section).

**Added:**
- Real expense catalog import (`backend/prisma/importExpenseLineItems.ts`, re-run from `seed.ts`) — Expense Category →
  Line Item two-level dropdown, a `Company` (business unit) dimension for line items with per-company GL-CC variants,
  and richly-typed "Additional Field" (text/number/dropdown, parsed from the source file).
- A searchable combobox (`components/SearchableSelect.tsx`) for the now ~230-row catalog.
- Per-month 2026 Remaining Forecast entry (configurable "as-of month" via `FiscalCycleConfig`), Available/Remaining
  Budget computed columns, and department-scoped forecast visibility (a centralized department can't view another's).
- Mobile Phone rank-based budget-limit policy with a conditional CFO approval workflow stage.
- Additional Headcount Request — a separate mini-workflow (Dept Head → HR Analyst → HR Head) feeding the Manpower
  Budget's headcount.
- Manpower Budgeting module — HR-Analyst-exclusive: the pay-component × company grid, mock SAP YTD pull, an HR Portal
  Excel upload/download (HR Portal isn't directly integrated), headcount override with an audit log, cascading
  headcount-driven recalculation, and its own HR Head → Budget Officer → SAP approval chain.
- Cancel-own-request (before Department Head acts) and Bulk Upload moved inside the New Request page.
- Green theme (`emerald` Tailwind scale as a placeholder for the real Ortigas Land Corporation brand color).

**New documented assumptions** (beyond the original list above) are in the Amendment 1 section of the plan file,
covering: kept Legal/Corporate Finance departments despite being absent from the (explicitly incomplete) real
catalog; Mobile Phone rank/plan entered per-request rather than from a user profile; the CFO gate's exact insertion
point; the headcount-cascade formula; and which Manpower pay components are HR-Portal- vs. manually-sourced.

---

## Amendment 2 — Notes_2: real employee directory, due-date hard blocks, forecast approval, variance removal

Built from `Budgeting System_Notes_2.docx` and `Budgeting System_Employee List.xlsx` (the real 363-person directory
across 4 legal entities — confirming Company codes OCC/OCLP/OLC map to real entity names).

**Added / changed:**
- Real employee directory imported as `User` rows (`backend/prisma/importEmployees.ts`) — 363 people, synthesized
  `@ortigas.com.ph` emails, `employeeIdNumber` for idempotent re-import. Princess Vera P. Jumalon (employee #2409969)
  is granted `BUDGET_OFFICER` with her real email.
- **Variance Threshold (FR-1.21) removed entirely** — model, admin routes, the Centralized L1 mandatory-justification
  gate, and the UI section are all gone, not just hidden.
- **Growth Rate override**: Budget Officer can now edit the Departmental Exception Table too (previously BC&A-only).
- **Stage due dates reworked**: global (not per-department), Steps 1+2 share one due date
  (`REQUEST_AND_AUTHORIZATION`), Steps 4+5 share one (`BCA_AND_FINALIZATION`), plus a new `FINALIZE_FORECAST`
  checkpoint. Passing a due date now **hard-blocks** the corresponding workflow action (`workflowService.assertDueDateNotPassed`) instead of being purely informational. Shown at the top of the Home dashboard.
- **Forecast approval workflow**: replaces the old self-service "mark complete" action — now routes through the
  Centralized Department Head (approve/return) then the Budget Officer (approve/return); only Budget Officer
  approval stamps `forecastCompletedAt`. New `ForecastSubmission`/`ForecastReviewDecision` models, an Inbox section,
  and department-scoped forecast visibility is unchanged from Amendment 1.
- **Expense Line Items admin form**: category, Company, `sampleCharges`, and a customizable additional-required-field
  builder (text/number/dropdown); the catalog table now shows Category and Company columns.
- **Searchable user pickers** everywhere a user list is selected (role switcher, Role Assignments) — the directory is
  now 397 users.
- **Manpower dashboard restructured** into separate tables per metric group (Current Headcount, YTD Actual,
  Remaining Months Forecast, Merit Increase %, Other Increase, Additional Headcount Request, Budget), mirroring the
  source workbook's column sections, plus an Excel export (`GET /manpower/export`).

**New documented assumption:** imported employees get no `departmentId`/system department mapping (the real org's
56 department names don't map cleanly onto this system's abstracted department set) — they're assignable to roles
at any department via the Role Assignments tab regardless, and only Princess Jumalon was mapped explicitly (to
Corporate Finance) per the notes' explicit instruction.

---

## Amendment 3 — Notes_4: Manpower Budgeting rewrite, left nav, UI polish

Built from `Budgeting System_PH1_Notes_4.docx` plus two new real files: `Budgeting System_Manpower Template.xlsx`
(the HR-fillable roster template — an "Employee List" sheet of Company+Level per employee, XLOOKUP'd against an
"Average Salary" sheet) and `Budgeting System_Manpower Report.xlsx` (the exact Dashboard/Excel report shape to
replicate, confirming the existing 19 pay-component rows and 6-company breakdown were already correct).

**Manpower Budgeting rebuilt around an uploaded employee roster, replacing the Amendment 1 "HR Portal company-totals"
model:**
- `ManpowerSalaryLevel` (Level 1-12 → average salary + ER contributions) and `ManpowerRosterSummary` (per-company
  headcount + monthly Basic Pay/Gov't Contribution totals) are populated by uploading the Manpower Template
  (`POST /manpower/template-upload`) — **the whole upload is rejected** if any "to be filled-out by HR" cell is
  blank (no partial accept). This is now the single source of truth for headcount; the old manual
  `ManpowerHeadcount` override + audit log is removed.
- **"Run Manpower Budget"** auto-fills Remaining Months Forecast for Basic Pay/Government Contributions (monthly
  rate × remaining months) and Guaranteed Bonus (2× monthly Basic Pay, flat) from the uploaded roster; every other
  pay component/company stays HR-Analyst-manual, same as before.
- **Merit Increase** is now a single global, editable rate per fiscal year (`ManpowerMeritRateConfig`), replacing
  the old per-cell rate. Eligibility (Basic Pay, Guaranteed Bonus, OT Pay, OT Meal Reimbursement; excludes the
  Outsourced company) and the YTD-Actual base follow the real Report file's actual formulas — **treated as
  authoritative over the Notes_4 prose**, which imprecisely said "Total Actual + Forecast" and "only Basic Pay and
  Guaranteed Bonus."
- **Additional Headcount Request** dollar amounts for Basic Pay/Guaranteed Bonus/Government Contributions are now
  computed by looking up the request's rank against `ManpowerSalaryLevel` (same table as the roster upload) instead
  of the old headcount-ratio approximation; every other pay component keeps a manual per-cell amount
  (`ManpowerEntry.additionalHeadcountManual`).
- Budget Officer's step collapses to one of two actions — Return to HR Analyst, or Upload to SAP — dropping the
  separate "Approved" stage that used to sit between HR Head approval and the SAP push.
- Added a "Budget vs Prior Year Actual + Forecast" metric table and reworked `/manpower/export` to emit the report
  file's exact two tabs (Dashboard Report totals-only, Excel Report broken out per company).

**UI:** the top header nav is now a fixed left sidebar (same links/roles, same emerald theme, role switcher moved
into the sidebar footer) — the main structural fix for the "looks raw" feedback — plus a light card/spacing polish
pass on the Home dashboard.

**New documented assumptions:**
1. Merit Increase base/component-list follows the Report file's formulas over the Notes_4 prose (see above).
2. "Budget vs Prior Year Actual + Forecast" compares against the *current* cycle's own Total Actual+Forecast — there's
   no real prior-year 2026 dataset in this demo build to diff against.
3. The Template roster upload only covers 4 of the 6 `Company` rows (OCC/OCLP/OLC/Outsourced), matching the source
   file; the 2 "...Project" companies remain HR-Analyst-manual.
4. `AdditionalHeadcountRequest.rank` is treated as the same 1-12 Level scale as the salary lookup; no proration by
   `estimatedHireDate`.
