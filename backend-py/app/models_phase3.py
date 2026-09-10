"""Phase 3 — Budget Transfer & Reallocation (Functional Spec §5, FR-3.1-3.7).

Genuinely owned here, like models_phase2.py - own registry/metadata, normal
snake_case naming, and (unlike references to Phase 1 rows, which stay plain
unconstrained str columns per the two-registry split - see
models_phase1.py's docstring) TransferReviewDecision/TransferAttachment get
a real SQLAlchemy ForeignKey back to TransferRequest, since all three live in
this same registry.
"""

from __future__ import annotations

from datetime import datetime
from typing import Optional

from sqlalchemy import Column, ForeignKey
from sqlalchemy.orm import registry as sa_registry
from sqlmodel import Field, SQLModel

phase3_registry = sa_registry()


class Phase3Model(SQLModel, registry=phase3_registry):
    pass


class TransferRequest(Phase3Model, table=True):
    __tablename__ = "transfer_request"

    id: Optional[int] = Field(default=None, primary_key=True)
    # Human-readable "TR-{fiscal_year}-{n}" identifier, generated at creation
    # (see create_transfer) - unpadded per-fiscal-year sequence, same
    # convention as the NPC budget code generator on the Node side.
    ticket_number: str = Field(index=True, unique=True)
    requestor_id: str = Field(index=True)  # -> Phase1 User.id, no FK (cross-registry)
    department_id: str = Field(index=True)  # originating dept, for Dept Head routing
    # The specific user the requestor picked at submit time (one of their own
    # department's Dept Heads) - eligibility at DEPT_HEAD_REVIEW is this exact
    # user, not "any Dept Head of the department".
    assigned_department_head_id: Optional[str] = Field(default=None, index=True)
    fiscal_year: int = Field(index=True)
    type: str  # "REALLOCATION" | "SUPPLEMENTAL"
    amount: float
    details: str
    # "To" - where the funds go. Picked directly as a CC + GL pair (2
    # independent, admin-maintained master lists - CostCenter/GlAccount
    # below, seeded from the "Budgeting System_CC-GL" file's PCCC/COA
    # sheets - spec item 11) rather than one specific catalog item, per spec
    # item 8: "Reallocation for GAE and DOE is per CC-GL, not per Expense
    # Line Item." Validated at creation against those two lists (see
    # create_transfer), then stored as the substantive identity here - kept
    # nullable at the DB level only for backward compatibility with rows
    # created before this column existed.
    target_cost_center: Optional[str] = None
    target_gl_account: Optional[str] = None
    # "From" - where the funds are drawn from, same CC+GL-pair shape as
    # above. Null when type=SUPPLEMENTAL (a net-new ask, not drawn from
    # elsewhere).
    budget_source_cost_center: Optional[str] = None
    budget_source_gl_account: Optional[str] = None
    # Spec item 11: "Put a field for Company (dropdown list of OLC, OCC,
    # OCLP)." A plain required selection, not derived from the CC/GL chosen
    # above (even though a CC's own prefix happens to imply a company in the
    # real data - 80->OCLP/81->OCC/90->OLC - the spec asks for an explicit
    # field, not an inferred one).
    company_code: Optional[str] = None  # "OLC" | "OCC" | "OCLP"
    # Chosen directly by the requestor at creation (workflow revision removed
    # the old Budget Officer classification/routing step - SBU is now known
    # up front, so SBU_FINANCE_OFFICER_REVIEW etc. can route to it directly).
    sbu: Optional[str] = None
    location: Optional[str] = None  # IoLocation.code
    # Ad hoc, per-ticket delegate set via POST /transfers/{id}/reassign -
    # while set, only this user (not the stage's normal role-holder(s)) is
    # eligible to decide at the CURRENT stage; cleared whenever the stage
    # advances.
    stage_assignee_override_id: Optional[str] = None
    current_stage: str = Field(default="DRAFT", index=True)
    status: str = Field(default="DRAFT", index=True)  # DRAFT/IN_REVIEW/RETURNED/REJECTED/CANCELLED/APPROVED/UPLOADED_TO_SAP
    sap_document_number: Optional[str] = None
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)


class TransferReviewDecision(Phase3Model, table=True):
    """Audit trail for every approve/reject/return action - mirrors Phase 1's
    ReviewDecision/ForecastReviewDecision pattern.
    """

    __tablename__ = "transfer_review_decision"

    id: Optional[int] = Field(default=None, primary_key=True)
    transfer_request_id: int = Field(sa_column=Column(ForeignKey("transfer_request.id"), nullable=False, index=True))
    stage: str
    decision: str  # "APPROVE" | "REJECT" | "RETURN" | "REASSIGN"
    decided_by_id: str
    comment: Optional[str] = None
    timestamp: datetime = Field(default_factory=datetime.utcnow)


class TransferAttachment(Phase3Model, table=True):
    __tablename__ = "transfer_attachment"

    id: Optional[int] = Field(default=None, primary_key=True)
    transfer_request_id: int = Field(sa_column=Column(ForeignKey("transfer_request.id"), nullable=False, index=True))
    file_name: str
    storage_path: str
    content_type: Optional[str] = None
    size_bytes: int
    uploaded_by_id: str
    created_at: datetime = Field(default_factory=datetime.utcnow)


class CostCenter(Phase3Model, table=True):
    """Admin-maintained Cost Center master list for the New Transfer "To"/
    "From" pickers (spec item 11) - seeded from the "Budgeting System_CC-GL"
    file's PCCC sheet (columns: Cost Center, Name), re-uploadable by the
    Budget Officer in the Admin Console (same "upload replaces the list"
    convention as the Node side's Expense Line Items catalog).
    """

    __tablename__ = "cost_center"

    id: Optional[int] = Field(default=None, primary_key=True)
    code: str = Field(index=True, unique=True)
    name: str
    # Note 11 §5 - Dash Flow tickets carry only CC/GL, not an SBU, so a
    # ticket's routed_sbu is resolved through this column (admin-editable in
    # CcGlCodesTab.tsx). One of the Sbu enum's 6 values (Node-owned, mirrored
    # here as a plain str like every other cross-registry reference), or null
    # if not yet mapped.
    sbu: Optional[str] = None


class GlAccount(Phase3Model, table=True):
    """Admin-maintained GL Account master list, same shape/purpose as
    CostCenter above - seeded from the same file's COA sheet (columns: GL
    Account Code, Account Name).
    """

    __tablename__ = "gl_account"

    id: Optional[int] = Field(default=None, primary_key=True)
    code: str = Field(index=True, unique=True)
    name: str


class IoLocation(Phase3Model, table=True):
    """Admin-configurable Location list for Internal Order Requests (spec
    item 9: "dropdown list of OE, CC, GH, CV... editable by the Budget
    Officer in the Admin Console"). Own small lookup table, same idea as
    Node's BudgetCodePrefix but owned here since it's Phase-3-specific and
    has no reason to exist before this feature.
    """

    __tablename__ = "io_location"

    id: Optional[int] = Field(default=None, primary_key=True)
    code: str = Field(index=True, unique=True)
    label: str
    sort_order: int = Field(default=0)


class InternalOrderRequest(Phase3Model, table=True):
    """Spec items 8/9 - requesting the creation of an Internal Order in SAP.
    Deliberately a separate model/table from TransferRequest (not a bolted-on
    "type") since its required fields don't overlap with a transfer's shape
    at all; it reuses the same review-decision/audit-log pattern and a stage
    machine identical in shape to TransferRequest's (see routers/
    internal_orders.py), just against its own table.
    """

    __tablename__ = "internal_order_request"

    id: Optional[int] = Field(default=None, primary_key=True)
    requestor_id: str = Field(index=True)  # -> Phase1 User.id, no FK (cross-registry)
    department_id: str = Field(index=True)  # for FR-3.2-style Dept Head routing
    fiscal_year: int = Field(index=True)

    # SBU (spec's 8-value list - Malls/Offices/Estates/Residential/Leisure/
    # Corporate IT/Corporate HR/Corporate Admin) - this is exactly the
    # existing NPC_HEAD BudgetCodePrefix list on the Node side, reused here
    # by storing its `code`; the frontend fetches label options from Node's
    # /admin/budget-code-prefixes?kind=NPC_HEAD, same as the NPC request form
    # already does.
    sbu: str
    # Derived from `sbu` at creation (the 5 regional SBUs route DOE, the 3
    # Corporate ones route GAE) - same DOE/GAE routing concept as
    # TransferRequest, but IO doesn't need a separate classification step
    # since the SBU choice already implies it unambiguously.
    classification: str  # "DOE" | "GAE"
    routing_stream: Optional[str] = None  # "BU_FINANCE" | "CORPORATE_FINANCE", set once validated

    location: str  # IoLocation.code
    project_title: str
    project_start: datetime
    project_end: datetime
    amount: float  # VAT exclusive
    cost_center: str

    is_budgeted: bool
    # Required when is_budgeted=True: the existing NPC budget code that
    # already funds this IO.
    npc_budget_code: Optional[str] = None
    # Required when is_budgeted=False.
    request_type: Optional[str] = None  # "REALLOCATION" | "SUPPLEMENT"
    # Required when request_type="REALLOCATION".
    reallocation_source_type: Optional[str] = None  # "NPC_BUDGET" | "IO_BUDGET"
    reallocation_npc_budget_code: Optional[str] = None
    # "IO Budget should have a dropdown list of the created IO in SAP. This
    # needs an automatic pull of data from SAP. Further instructions will be
    # provided later" - stored as free text for now, no live SAP-backed
    # dropdown yet (explicitly deferred by the spec itself).
    reallocation_io_budget_code: Optional[str] = None

    current_stage: str = Field(default="DRAFT", index=True)
    status: str = Field(default="DRAFT", index=True)
    sap_document_number: Optional[str] = None
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)


class IoReviewDecision(Phase3Model, table=True):
    """Audit trail for Internal Order Request decisions - mirrors
    TransferReviewDecision exactly, against its own FK.
    """

    __tablename__ = "io_review_decision"

    id: Optional[int] = Field(default=None, primary_key=True)
    internal_order_request_id: int = Field(sa_column=Column(ForeignKey("internal_order_request.id"), nullable=False, index=True))
    stage: str
    decision: str  # "APPROVE" | "REJECT" | "RETURN"
    decided_by_id: str
    comment: Optional[str] = None
    timestamp: datetime = Field(default_factory=datetime.utcnow)


class DashFlowTicket(Phase3Model, table=True):
    """Note 11 §5 - "Dash Flow Payment Request Ticket – Budget Check". A
    local mirror of tickets pulled from the external Dash Flow Payment
    Request Ticketing system (see services/dash_flow_adapter.py) - genuinely
    owned here, not a read-only Phase-1-style mirror, since these rows don't
    exist anywhere else in this database.

    The budget-check status (red/green) is deliberately NOT stored - it's
    computed live off compute_gl_cc_available() every time a ticket is
    listed, the same way Transfer's balance check works, so it always
    reflects the current FinalizedBudgetLine snapshot rather than going
    stale.
    """

    __tablename__ = "dash_flow_ticket"

    id: Optional[int] = Field(default=None, primary_key=True)
    external_ticket_id: str = Field(index=True, unique=True)
    external_ticket_url: Optional[str] = None
    cost_center: str = Field(index=True)
    gl_account: str = Field(index=True)
    request_amount: float
    fiscal_year: int = Field(index=True)
    # Resolved from CostCenter.sbu at sync time - null if that CC has no SBU
    # mapped yet, in which case the ticket is only visible to the Budget
    # Officer (nobody else's SBU Finance queue can claim it).
    routed_sbu: Optional[str] = Field(default=None, index=True)
    status: str = Field(default="OPEN", index=True)  # "OPEN" | "CLOSED"
    closed_by_id: Optional[str] = None
    closed_at: Optional[datetime] = None
    created_at: datetime = Field(default_factory=datetime.utcnow)
