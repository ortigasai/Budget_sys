"""Budget Utilization Tracking (Functional Spec §4). View A (FR-2.2) is the
per-department/GL-CC Approved/Actual/Commitments/Available rollup; View B
(FR-2.3-2.6) is the per-expense-line-item reconciliation against mock SAP
actuals, plus the Unmapped SAP Actuals exception queue.

Response models use camelCase field names (not idiomatic Python) to match
the rest of this app's API surface - the frontend consumes one JSON
convention across both backends.
"""

from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlmodel import Session, select

from ..auth import AuthedUser, get_current_user, require_role
from ..db import enum_eq, get_session
from ..models_phase1 import BudgetRequest, Department, ExpenseLineItem, FinalizedBudgetLine
from ..models_phase2 import SapActualTransaction, SapCommitment
from ..models_phase3 import InternalOrderRequest
from ..npc_sbu import NPC_SBU_LABELS
from ..services.sap_sync_service import get_sync_status, start_sync_in_background

router = APIRouter(prefix="/utilization", tags=["utilization"])

# Same list as backend/src/lib/coreDepartments.ts's CORE_CENTRALIZED_DEPARTMENT_NAMES
# - the "real", budget-cap-tracked centralized departments, not every
# CENTRALIZED-typed Department row (most of those are employee-roster
# bookkeeping noise). Keep in sync with the TS source if it changes.
CORE_CENTRALIZED_DEPARTMENT_NAMES = [
    "Admin Services",
    "Corporate Finance",
    "External Affairs",
    "Human Resources",
    "IS & IT",
    "Legal",
    "Office of the CFO",
    "Tax",
]

OPEN_COMMITMENT_STATUSES = ["OPEN", "APPROVED_PR"]

# The three role types this codebase names as "centralized department"
# roles (see RoleSwitcher.tsx's ROLE_LABELS: Centralized Department
# Preparer/Reviewer/Approver). Utilization Tracking is open to all of them,
# not just Preparers/Heads as FR-2.1 originally stated - widened per request.
CENTRALIZED_ROLE_TYPES = ("CENTRALIZED_BUDGET_PREPARER", "CENTRALIZED_DEPARTMENT_HEAD", "CENTRALIZED_FIRST_LEVEL_REVIEWER")


class DepartmentOut(BaseModel):
    id: str
    name: str


class OverviewRow(BaseModel):
    glAccount: str
    costCenter: str
    approvedBudget: float
    actualExpenditures: float
    commitments: float
    totalAllotted: float
    available: float


class ReconciliationRow(BaseModel):
    expenseLineItemId: str
    expenseLineItemName: str
    approvedBudget: float
    sapActual: float
    statusText: str


class UnmappedRow(BaseModel):
    id: int
    itemText: str
    amount: float
    glAccount: str
    costCenter: str
    postedAt: datetime


class LineItemOut(BaseModel):
    id: str
    name: str


class ReconciliationOut(BaseModel):
    rows: list[ReconciliationRow]
    unmapped: list[UnmappedRow]
    # This department's expense line items, for the Budget Officer's "map to"
    # picker on an unmapped row - saves the frontend a second cross-backend
    # call to Node's catalog endpoint.
    lineItems: list[LineItemOut]


class MapUnmappedIn(BaseModel):
    expenseLineItemId: str


class NpcSbuOut(BaseModel):
    value: str
    label: str


class NpcUtilizationRow(BaseModel):
    budgetCode: str
    projectTitle: str
    amount: float  # NPC's approved amount (VAT exclusive), net of any budget cut
    location: str | None
    sbu: str
    # A budget code can fund more than one Internal Order Request, so this is
    # a list rather than a single value - each entry is that IO's SAP
    # document number (blank until BUDGET_OFFICER_SAP_UPLOAD - see
    # routers/internal_orders.py), joined for display on the frontend.
    ioCodes: list[str]
    ioAmount: float
    balance: float  # amount - ioAmount


def _is_utilization_eligible(user: AuthedUser) -> bool:
    """Open to all centralized department roles (Preparer, Head, Reviewer),
    plus the Budget Officer, matching this app's existing pattern of
    Budget-Officer-always-has-oversight (e.g. Forecast's own eligibility
    rule) - FR-2.6 explicitly gives the Budget Officer an action on this same
    dashboard, which only makes sense if they can also see it.
    """
    return user.has_role("BUDGET_OFFICER") or any(r.roleType in CENTRALIZED_ROLE_TYPES for r in user.roles)


def _require_utilization_access(user: AuthedUser = Depends(get_current_user)) -> AuthedUser:
    if not _is_utilization_eligible(user):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "You do not have access to Budget Utilization Tracking.")
    return user


def _assert_department_access(user: AuthedUser, department_id: str, session: Session) -> Department:
    dept = session.get(Department, department_id)
    if dept is None or dept.name not in CORE_CENTRALIZED_DEPARTMENT_NAMES:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Department not found.")
    if user.has_role("BUDGET_OFFICER"):
        return dept
    if any(user.has_role(role_type, department_id) for role_type in CENTRALIZED_ROLE_TYPES):
        return dept
    raise HTTPException(status.HTTP_403_FORBIDDEN, "You do not have access to this department's utilization data.")


@router.get("/departments", response_model=list[DepartmentOut])
def list_departments(
    user: AuthedUser = Depends(_require_utilization_access),
    session: Session = Depends(get_session),
):
    core = session.exec(
        select(Department).where(Department.name.in_(CORE_CENTRALIZED_DEPARTMENT_NAMES)).order_by(Department.name)
    ).all()
    if user.has_role("BUDGET_OFFICER"):
        eligible = core
    else:
        my_dept_ids = {
            r.departmentId for r in user.roles if r.roleType in CENTRALIZED_ROLE_TYPES
        }
        eligible = [d for d in core if d.id in my_dept_ids]
    return [DepartmentOut(id=d.id, name=d.name) for d in eligible]


def _approved_budget_by_gl_cc(session: Session, department_id: str, fiscal_year: int) -> dict[tuple[str, str], float]:
    """Sum(FinalizedBudgetLine.amount) for this department's catalog, grouped
    by (glAccount, costCenter) - Note 11: reads the finalized/uploaded budget
    snapshot instead of live-joining BudgetRequest+ExpenseLineItem by
    currentStage=APPROVED (the snapshot is written once, at Budget Officer
    finalize time, so this is no longer computed fresh from request status).
    Still joined through BudgetRequest/ExpenseLineItem (via the snapshot's
    informational budgetRequestId) only to resolve which catalog department
    owns each line - not for the amount itself.
    """
    rows = session.exec(
        select(FinalizedBudgetLine, ExpenseLineItem)
        .join(BudgetRequest, FinalizedBudgetLine.budgetRequestId == BudgetRequest.id)
        .join(ExpenseLineItem, BudgetRequest.expenseLineItemId == ExpenseLineItem.id)
        .where(
            ExpenseLineItem.ownerDepartmentId == department_id,
            FinalizedBudgetLine.fiscalYear == fiscal_year,
        )
    ).all()
    totals: dict[tuple[str, str], float] = {}
    for line, _ in rows:
        key = (line.glAccount, line.costCenter)
        totals[key] = totals.get(key, 0.0) + line.amount
    return totals


def _approved_budget_by_line_item(session: Session, department_id: str, fiscal_year: int) -> dict[str, float]:
    rows = session.exec(
        select(FinalizedBudgetLine, ExpenseLineItem)
        .join(BudgetRequest, FinalizedBudgetLine.budgetRequestId == BudgetRequest.id)
        .join(ExpenseLineItem, BudgetRequest.expenseLineItemId == ExpenseLineItem.id)
        .where(
            ExpenseLineItem.ownerDepartmentId == department_id,
            FinalizedBudgetLine.fiscalYear == fiscal_year,
        )
    ).all()
    totals: dict[str, float] = {}
    for line, line_item in rows:
        totals[line_item.id] = totals.get(line_item.id, 0.0) + line.amount
    return totals


class SapSyncStartOut(BaseModel):
    status: str  # "started"


class SapSyncStatusOut(BaseModel):
    status: str  # "idle" | "running" | "success" | "error"
    fiscalYear: int | None
    startedAt: str | None
    finishedAt: str | None
    actualsSynced: int | None = None
    commitmentsSynced: int | None = None
    error: str | None = None


@router.post("/sync-sap", response_model=SapSyncStartOut, status_code=status.HTTP_202_ACCEPTED)
def sync_sap_route(
    fiscalYear: int,
    user: AuthedUser = Depends(require_role("BUDGET_OFFICER")),
):
    """Real-SAP-data replacement for app/seed_mock_sap.py's manual CLI seed -
    see services/sap_sync_service.py. Populates SapActualTransaction (from
    FBL3N) and SapCommitment (from KSSB V2's Commitment field) for
    `fiscalYear`; Overview, Reconciliation, Transfer's balance check, Dash
    Flow's budget check, and Reports' Budget vs Actual all read those tables
    live and pick up the synced figures once it finishes.

    A full sync easily takes several minutes (hundreds of paginated broker
    requests, deliberately paced under the broker's own rate limit) - too
    long to run inline on this request without sitting past IIS/ARR's
    reverse-proxy timeout, so this only starts the sync in the background
    and returns immediately. Poll GET /sync-sap/status for the result.
    """
    started = start_sync_in_background(fiscalYear)
    if not started:
        raise HTTPException(status.HTTP_409_CONFLICT, "A SAP sync is already in progress.")
    return SapSyncStartOut(status="started")


@router.get("/sync-sap/status", response_model=SapSyncStatusOut)
def sync_sap_status_route(user: AuthedUser = Depends(_require_utilization_access)):
    state = get_sync_status()
    result = state.get("result") or {}
    return SapSyncStatusOut(
        status=state["status"],
        fiscalYear=state["fiscalYear"],
        startedAt=state["startedAt"],
        finishedAt=state["finishedAt"],
        actualsSynced=result.get("actualsSynced"),
        commitmentsSynced=result.get("commitmentsSynced"),
        error=state.get("error"),
    )


@router.get("/overview", response_model=list[OverviewRow])
def overview(
    departmentId: str,
    fiscalYear: int,
    user: AuthedUser = Depends(_require_utilization_access),
    session: Session = Depends(get_session),
):
    _assert_department_access(user, departmentId, session)

    approved = _approved_budget_by_gl_cc(session, departmentId, fiscalYear)

    actuals = session.exec(
        select(SapActualTransaction).where(SapActualTransaction.fiscal_year == fiscalYear)
    ).all()
    commitments = session.exec(
        select(SapCommitment).where(SapCommitment.fiscal_year == fiscalYear)
    ).all()

    # Mock actuals/commitments are only ever generated against an approved
    # request's own GL-CC (see app/seed_mock_sap.py), so their keys are
    # always a subset of approved's - rows are driven by approved GL-CC
    # lines, same as FR-2.2's "per department/GL-CC" framing.
    gl_cc_keys = set(approved.keys())
    actual_totals: dict[tuple[str, str], float] = {}
    for a in actuals:
        key = (a.gl_account, a.cost_center)
        actual_totals[key] = actual_totals.get(key, 0.0) + a.amount
    commitment_totals: dict[tuple[str, str], float] = {}
    for c in commitments:
        if c.status not in OPEN_COMMITMENT_STATUSES:
            continue
        key = (c.gl_account, c.cost_center)
        commitment_totals[key] = commitment_totals.get(key, 0.0) + c.amount

    rows: list[OverviewRow] = []
    for gl_account, cost_center in sorted(gl_cc_keys):
        approved_amount = approved.get((gl_account, cost_center), 0.0)
        actual_amount = actual_totals.get((gl_account, cost_center), 0.0)
        commitment_amount = commitment_totals.get((gl_account, cost_center), 0.0)
        total_allotted = actual_amount + commitment_amount
        rows.append(
            OverviewRow(
                glAccount=gl_account,
                costCenter=cost_center,
                approvedBudget=round(approved_amount, 2),
                actualExpenditures=round(actual_amount, 2),
                commitments=round(commitment_amount, 2),
                totalAllotted=round(total_allotted, 2),
                available=round(approved_amount - total_allotted, 2),
            )
        )
    return rows


@router.get("/reconciliation", response_model=ReconciliationOut)
def reconciliation(
    departmentId: str,
    fiscalYear: int,
    user: AuthedUser = Depends(_require_utilization_access),
    session: Session = Depends(get_session),
):
    _assert_department_access(user, departmentId, session)

    line_items = session.exec(
        select(ExpenseLineItem).where(ExpenseLineItem.ownerDepartmentId == departmentId)
    ).all()
    line_items_by_id = {li.id: li for li in line_items}
    dept_gl_cc = {(li.glAccount, li.costCenter) for li in line_items}
    # GAE's Budget Code is on the catalog item itself.
    line_item_id_by_budget_code = {li.budgetCode: li.id for li in line_items if li.budgetCode}
    # DOE/NPC's Budget Code is per-request instead (generated at creation,
    # not pre-computed on the catalog item) - resolve it through this
    # department's own approved requests for the year.
    doe_npc_requests = session.exec(
        select(BudgetRequest)
        .join(ExpenseLineItem, BudgetRequest.expenseLineItemId == ExpenseLineItem.id)
        .where(
            ExpenseLineItem.ownerDepartmentId == departmentId,
            BudgetRequest.fiscalYear == fiscalYear,
            BudgetRequest.budgetCode.is_not(None),
        )
    ).all()
    line_item_id_by_request_budget_code = {r.budgetCode: r.expenseLineItemId for r in doe_npc_requests}

    approved_by_item = _approved_budget_by_line_item(session, departmentId, fiscalYear)

    actuals = session.exec(
        select(SapActualTransaction).where(SapActualTransaction.fiscal_year == fiscalYear)
    ).all()

    matched_by_item: dict[str, float] = {}
    unmapped: list[UnmappedRow] = []
    for a in actuals:
        # Budget Code (GL-CC + code) is the primary match now - what SAP PR
        # creators/accounting staff will actually post against. A manually
        # mapped expense_line_item_id (Budget Officer's "Map to" action on a
        # previously-unmapped row) still takes effect as a fallback so that
        # override path keeps working even without a Budget Code.
        target_id = (
            line_item_id_by_budget_code.get(a.budget_code)
            or line_item_id_by_request_budget_code.get(a.budget_code)
            or a.expense_line_item_id
        )
        if target_id and target_id in line_items_by_id:
            matched_by_item[target_id] = matched_by_item.get(target_id, 0.0) + a.amount
        elif target_id is None and (a.gl_account, a.cost_center) in dept_gl_cc:
            unmapped.append(
                UnmappedRow(
                    id=a.id,
                    itemText=a.item_text,
                    amount=a.amount,
                    glAccount=a.gl_account,
                    costCenter=a.cost_center,
                    postedAt=a.posted_at,
                )
            )

    rows: list[ReconciliationRow] = []
    for li in sorted(line_items, key=lambda x: x.name):
        approved_amount = approved_by_item.get(li.id, 0.0)
        actual_amount = matched_by_item.get(li.id, 0.0)
        if approved_amount <= 0:
            continue  # nothing approved this cycle - not part of the reconciliation view
        if actual_amount <= 0:
            status_text = "No Activity"
        elif actual_amount >= approved_amount:
            status_text = "Fully Utilized"
        else:
            pct = round(actual_amount / approved_amount * 100)
            status_text = f"Partially Utilized ({pct}%)"
        rows.append(
            ReconciliationRow(
                expenseLineItemId=li.id,
                expenseLineItemName=li.name,
                approvedBudget=round(approved_amount, 2),
                sapActual=round(actual_amount, 2),
                statusText=status_text,
            )
        )

    return ReconciliationOut(
        rows=rows,
        unmapped=unmapped,
        lineItems=[LineItemOut(id=li.id, name=li.name) for li in sorted(line_items, key=lambda x: x.name)],
    )


@router.patch("/reconciliation/unmapped/{transaction_id}", response_model=UnmappedRow)
def map_unmapped(
    transaction_id: int,
    body: MapUnmappedIn,
    user: AuthedUser = Depends(require_role("BUDGET_OFFICER")),
    session: Session = Depends(get_session),
):
    txn = session.get(SapActualTransaction, transaction_id)
    if txn is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Transaction not found.")
    line_item = session.get(ExpenseLineItem, body.expenseLineItemId)
    if line_item is None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Expense line item not found.")

    txn.expense_line_item_id = line_item.id
    session.add(txn)
    session.commit()
    session.refresh(txn)

    return UnmappedRow(
        id=txn.id,
        itemText=txn.item_text,
        amount=txn.amount,
        glAccount=txn.gl_account,
        costCenter=txn.cost_center,
        postedAt=txn.posted_at,
    )


# ---- NPC Utilization (spec item 13) ----
# Only counts IOs actually committed against an NPC budget - a DRAFT/
# IN_REVIEW/RETURNED IO hasn't cleared review yet, so it shouldn't reduce the
# NPC balance shown here (mirrors this app's existing convention of only
# counting APPROVED BudgetRequests as consuming budget).
ACTIVE_IO_STATUSES = ["APPROVED", "UPLOADED_TO_SAP"]


def _my_department(user: AuthedUser, session: Session) -> Department | None:
    return session.get(Department, user.departmentId) if user.departmentId else None


def _resolve_npc_sbu_scope(user: AuthedUser, requested_sbu: str | None, session: Session) -> str:
    """Budget Officer may pick any SBU; everyone else is pinned to their own
    department's SBU (spec: "users can only view the NPC approved for the
    SBU they belong to") - same shape as _assert_department_access above,
    just keyed by SBU instead of department id.
    """
    if user.has_role("BUDGET_OFFICER"):
        if not requested_sbu:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "sbu is required.")
        if requested_sbu not in NPC_SBU_LABELS:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Unrecognized SBU.")
        return requested_sbu
    dept = _my_department(user, session)
    if dept is None or not dept.sbu:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Your department has no SBU assigned - ask the Budget Officer to set one in the Admin Console.")
    return dept.sbu


@router.get("/npc/sbus", response_model=list[NpcSbuOut])
def npc_sbu_options(
    user: AuthedUser = Depends(_require_utilization_access),
    session: Session = Depends(get_session),
):
    if user.has_role("BUDGET_OFFICER"):
        return [NpcSbuOut(value=v, label=l) for v, l in NPC_SBU_LABELS.items()]
    dept = _my_department(user, session)
    if dept is None or not dept.sbu:
        return []
    return [NpcSbuOut(value=dept.sbu, label=NPC_SBU_LABELS.get(dept.sbu, dept.sbu))]


@router.get("/npc", response_model=list[NpcUtilizationRow])
def npc_utilization(
    fiscalYear: int,
    sbu: str | None = None,
    user: AuthedUser = Depends(_require_utilization_access),
    session: Session = Depends(get_session),
):
    effective_sbu = _resolve_npc_sbu_scope(user, sbu, session)

    # Note 11 - reads the finalized/uploaded budget snapshot instead of
    # live-joining BudgetRequest by currentStage=APPROVED (this function
    # predated the Note 11 switch and was missed in the first pass - the
    # snapshot is the one place every "approved budget" reader should query).
    # projectTitle/npcLocation/budgetCode aren't duplicated onto the
    # snapshot - they're stable once approved, so still read from the live
    # BudgetRequest row via the snapshot's informational budgetRequestId.
    finalized_lines = session.exec(
        select(FinalizedBudgetLine, BudgetRequest).join(
            BudgetRequest, FinalizedBudgetLine.budgetRequestId == BudgetRequest.id
        ).where(
            enum_eq(FinalizedBudgetLine.requestCategory, "NPC"),
            FinalizedBudgetLine.fiscalYear == fiscalYear,
            FinalizedBudgetLine.npcSbu == effective_sbu,
        )
    ).all()

    ios = session.exec(
        select(InternalOrderRequest).where(
            InternalOrderRequest.fiscal_year == fiscalYear,
            InternalOrderRequest.is_budgeted == True,  # noqa: E712 - SQLAlchemy comparison, not a truthiness check
            InternalOrderRequest.status.in_(ACTIVE_IO_STATUSES),
        )
    ).all()
    ios_by_npc_code: dict[str, list[InternalOrderRequest]] = {}
    for io in ios:
        if io.npc_budget_code:
            ios_by_npc_code.setdefault(io.npc_budget_code, []).append(io)

    rows: list[NpcUtilizationRow] = []
    for line, req in finalized_lines:
        if not req.budgetCode:
            continue
        matched = ios_by_npc_code.get(req.budgetCode, [])
        io_amount = sum(io.amount for io in matched)
        npc_amount = line.amount
        rows.append(
            NpcUtilizationRow(
                budgetCode=req.budgetCode,
                projectTitle=req.projectTitle or "",
                amount=round(npc_amount, 2),
                location=req.npcLocation,
                sbu=req.npcSbu or effective_sbu,
                ioCodes=sorted(io.sap_document_number for io in matched if io.sap_document_number),
                ioAmount=round(io_amount, 2),
                balance=round(npc_amount - io_amount, 2),
            )
        )
    return sorted(rows, key=lambda r: r.budgetCode)
