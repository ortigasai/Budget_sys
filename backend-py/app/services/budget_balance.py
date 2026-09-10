"""Shared "how much is still available against this GL-CC" computation.

Used by Phase 3's balance validation (FR-3.7 — "budget transfer is per CC and
GL") and mirrors the same Approved-minus-Actuals-minus-Commitments shape
already computed per-department in routers/utilization.py's
`_approved_budget_by_gl_cc`/`overview()`, just generalized to not require a
department id up front (a transfer's "budget source" is picked directly as a
GL-CC pair, not via a department context).
"""

from __future__ import annotations

from ..models_phase1 import FinalizedBudgetLine
from ..models_phase2 import SapActualTransaction, SapCommitment
from sqlmodel import Session, select

# Kept in sync with routers/utilization.py's OPEN_COMMITMENT_STATUSES.
OPEN_COMMITMENT_STATUSES = ["OPEN", "APPROVED_PR"]


def compute_gl_cc_breakdown(session: Session, gl_account: str, cost_center: str, fiscal_year: int) -> dict:
    """Budget/Actual/Commitment breakdown for a GL-CC pair, the building
    blocks behind compute_gl_cc_available() below and Transfer's "current
    amount" balance-impact display (routers/transfers.py's /cc-gl-balance).

    - budget: the finalized/uploaded budget for this GL-CC (Note 11 - sum of
      FinalizedBudgetLine.amount; this table is a denormalized snapshot
      written once at Budget Officer finalize time, so no join/status filter
      is needed here the way BudgetRequest+ExpenseLineItem used to require).
    - actual: actuals already posted against it.
    - commitment: open commitments against it.
    """
    finalized_rows = session.exec(
        select(FinalizedBudgetLine).where(
            FinalizedBudgetLine.glAccount == gl_account,
            FinalizedBudgetLine.costCenter == cost_center,
            FinalizedBudgetLine.fiscalYear == fiscal_year,
        )
    ).all()
    budget = sum(r.amount for r in finalized_rows)

    actuals = session.exec(
        select(SapActualTransaction).where(
            SapActualTransaction.gl_account == gl_account,
            SapActualTransaction.cost_center == cost_center,
            SapActualTransaction.fiscal_year == fiscal_year,
        )
    ).all()
    actual_total = sum(a.amount for a in actuals)

    commitments = session.exec(
        select(SapCommitment).where(
            SapCommitment.gl_account == gl_account,
            SapCommitment.cost_center == cost_center,
            SapCommitment.fiscal_year == fiscal_year,
        )
    ).all()
    commitment_total = sum(c.amount for c in commitments if c.status in OPEN_COMMITMENT_STATUSES)

    return {"budget": budget, "actual": actual_total, "commitment": commitment_total}


def compute_gl_cc_available(session: Session, gl_account: str, cost_center: str, fiscal_year: int) -> float:
    """Budget minus Actual minus Commitment for this GL-CC - the single
    "how much is still available" figure used by Transfer's submission-time
    balance check.
    """
    b = compute_gl_cc_breakdown(session, gl_account, cost_center, fiscal_year)
    return b["budget"] - b["actual"] - b["commitment"]
