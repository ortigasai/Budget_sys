"""Tables Phase 2 owns outright - the mock-SAP cache backing Budget
Utilization Tracking (FR-2.2-2.6). These ARE what Alembic manages (see
alembic/env.py, which points target_metadata at this file's registry only).

Unlike app/models_phase1.py's shadow models (which mirror Prisma's camelCase
naming since they're read-only mirrors of an externally-owned schema), these
are genuinely Phase 2's own tables - normal snake_case Python/SQL naming
throughout, which also makes it visually obvious at a glance which schema a
given table belongs to.
"""

from __future__ import annotations

from datetime import datetime
from typing import Optional

from sqlalchemy.orm import registry as sa_registry
from sqlmodel import Field, SQLModel

# Separate from phase1_registry (app/models_phase1.py) - this is the only
# metadata Alembic's autogenerate ever compares against.
phase2_registry = sa_registry()


class Phase2Model(SQLModel, registry=phase2_registry):
    pass


class SapActualTransaction(Phase2Model, table=True):
    """A posted invoice/journal-entry line, mock-standing-in for a real SAP
    pull (FR-2.2's Actual Expenditures, FR-2.3-2.6's reconciliation). Matched
    to an expense line item via CC-GL + Budget Code at generation time (see
    app/services/sap_mock.py) - real SAP PR creators/accounting staff will
    reference the Budget Code (Phase 1's ExpenseLineItem.budgetCode for GAE,
    BudgetRequest.budgetCode for DOE/NPC) instead of standardized item text
    going forward. `budget_code` is null for anything that didn't match -
    the "Unmapped SAP Actuals" queue (FR-2.6) is just a query for those rows,
    and the Budget Officer's mapping action (PATCH .../unmapped/{id}) is
    exactly setting `expense_line_item_id` (kept for that manual-override
    path, even though generation itself now keys off the Budget Code).
    """

    __tablename__ = "sap_actual_transaction"

    id: Optional[int] = Field(default=None, primary_key=True)
    gl_account: str = Field(index=True)
    cost_center: str = Field(index=True)
    fiscal_year: int = Field(index=True)
    month: int  # 1-12
    item_text: str
    amount: float
    source_type: str  # "INVOICE" | "JOURNAL_ENTRY"
    # The Budget Code as posted by SAP (e.g. "AS-26-1", "MAL-27-3") - the new
    # primary matching key (with gl_account/cost_center) for reconciliation.
    budget_code: Optional[str] = Field(default=None, index=True)
    # No formal FK constraint: the referenced table (ExpenseLineItem) lives in
    # phase1_registry's metadata, not this one, and SQLAlchemy resolves
    # ForeignKey targets by table name within a single MetaData - reaching
    # across would require registering Prisma's table here too, which is
    # exactly the coupling the two-registry split exists to avoid. Integrity
    # is enforced at the application layer instead (this column only ever
    # gets set to a real ExpenseLineItem.id, by app/services/sap_mock.py or
    # the reconciliation-mapping endpoint).
    expense_line_item_id: Optional[str] = Field(default=None, index=True)
    posted_at: datetime
    created_at: datetime = Field(default_factory=datetime.utcnow)


class SapCommitment(Phase2Model, table=True):
    """An open PO / approved PR, mock-standing-in for SAP (FR-2.2's
    Commitments). Same matching convention as SapActualTransaction.
    """

    __tablename__ = "sap_commitment"

    id: Optional[int] = Field(default=None, primary_key=True)
    gl_account: str = Field(index=True)
    cost_center: str = Field(index=True)
    fiscal_year: int = Field(index=True)
    po_number: str
    item_text: str
    amount: float
    status: str  # "OPEN" | "APPROVED_PR"
    # No formal FK constraint - see SapActualTransaction's field comment above.
    expense_line_item_id: Optional[str] = Field(default=None, index=True)
    created_at: datetime = Field(default_factory=datetime.utcnow)
