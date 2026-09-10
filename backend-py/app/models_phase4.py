"""Phase 4 — Budget Report & Analysis (Functional Spec §6, FR-4.1-4.8).

Genuinely owned here, like models_phase2.py/models_phase3.py - own registry/
metadata, normal snake_case naming. Report *data* itself (budget, actuals,
forecast) isn't owned here at all - it's read live from Phase 1's
BudgetRequest/HistoricalActuals and Phase 2's SapActualTransaction/
SapCommitment (see routers/reports.py's aggregation). Phase 4 only owns the
report-specific overlay: who can see it, notes attached to a line item, and
which periods have been signed off.
"""

from __future__ import annotations

from datetime import datetime
from typing import Optional

from sqlalchemy import UniqueConstraint
from sqlalchemy.orm import registry as sa_registry
from sqlmodel import Field, SQLModel

phase4_registry = sa_registry()


class Phase4Model(SQLModel, registry=phase4_registry):
    pass


class ReportAccessGrant(Phase4Model, table=True):
    """FR-4.5/4.6: reports default to Budget-Officer-only; the Budget
    Officer can explicitly grant an individual user access. Being a
    Budget Officer already implies access (checked separately at the
    dependency level, see routers/reports.py's require_report_access) - a
    row here is only needed for everyone else.
    """

    __tablename__ = "report_access_grant"

    id: Optional[int] = Field(default=None, primary_key=True)
    user_id: str = Field(index=True, unique=True)  # -> Phase1 User.id, no FK (cross-registry)
    granted_by_id: str
    created_at: datetime = Field(default_factory=datetime.utcnow)


class ReportNote(Phase4Model, table=True):
    """FR-4.4: notes/analysis attached to a report line item. Comparisons
    are per Expense Category (every CC-GL maps to an ExpenseLineItem, which
    maps to a category - see routers/reports.py's _group_by_cc_gl), so
    that's the note's grain too: (fiscal year, expense category), optionally
    scoped to one month - null month reads as a whole-year note. Append-
    only, like every other decision/audit log in this app - no edit/delete,
    just a running commentary thread per category.
    """

    __tablename__ = "report_note"

    id: Optional[int] = Field(default=None, primary_key=True)
    fiscal_year: int = Field(index=True)
    expense_group: str = Field(index=True)
    month: Optional[int] = None  # 1-12, null = whole-year note
    text: str
    author_id: str
    created_at: datetime = Field(default_factory=datetime.utcnow)


class PeriodLock(Phase4Model, table=True):
    """FR-4.8: the sign-off button's lock. Phase-4-local only (per scope
    decision) - locking a period freezes this module's own report snapshot/
    notes for it; it does not reach into Phase 1's Forecast or Phase 2's
    actuals/commitments endpoints.
    """

    __tablename__ = "period_lock"
    __table_args__ = (UniqueConstraint("fiscal_year", "month"),)

    id: Optional[int] = Field(default=None, primary_key=True)
    fiscal_year: int = Field(index=True)
    month: int  # 1-12
    locked_by_id: str
    locked_at: datetime = Field(default_factory=datetime.utcnow)
