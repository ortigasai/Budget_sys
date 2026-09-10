"""One-time seed script populating Phase 2's mock SAP cache from real
approved BudgetRequest data. Re-runnable: clears this fiscal year's existing
mock rows first, same idempotent-by-truncation spirit as backend/prisma's
importers. Run manually - `python -m app.seed_mock_sap` from backend-py/,
mirroring backend/prisma/seed.ts's convention.

Superseded by the real SAP Requirements integration (see
services/sap_sync_service.py, wired to the Budget Officer's "Sync from SAP"
button on the Utilization page) for any environment with real broker
credentials - that sync populates the same two tables from live FBL3N/KSSB
V2 data instead of fabricating it. This script is kept for a from-scratch
dev DB with no SAP API key, which still needs *something* to populate
SapActualTransaction/SapCommitment for local testing.
"""

from __future__ import annotations

import random
from datetime import datetime

from sqlmodel import Session, delete, select

from .db import engine, enum_eq
from .models_phase1 import BudgetRequest, ExpenseLineItem
from .models_phase2 import SapActualTransaction, SapCommitment
from .services.sap_mock import generate_for_request

FISCAL_YEAR = 2027
# Arbitrary demo "as of" point (not tied to the real calendar - this mock
# data exists purely to exercise the Utilization dashboard, same spirit as
# Phase 1's HistoricalActuals reference data).
AS_OF_MONTH = 6
SEED = 20260828  # fixed, so re-running produces the same demo numbers


def main() -> None:
    rng = random.Random(SEED)
    with Session(engine) as session:
        session.exec(delete(SapActualTransaction).where(SapActualTransaction.fiscal_year == FISCAL_YEAR))
        session.exec(delete(SapCommitment).where(SapCommitment.fiscal_year == FISCAL_YEAR))

        approved = session.exec(
            select(BudgetRequest).where(
                BudgetRequest.fiscalYear == FISCAL_YEAR, enum_eq(BudgetRequest.currentStage, "APPROVED")
            )
        ).all()
        line_items_by_id = {li.id: li for li in session.exec(select(ExpenseLineItem)).all()}

        actual_count = 0
        commitment_count = 0
        for req in approved:
            line_item = line_items_by_id.get(req.expenseLineItemId)
            if line_item is None:
                continue
            net_amount = req.proposedAmount - req.budgetCutAmount
            # GAE reads its Budget Code from the catalog item; DOE/NPC carry
            # their own (generated at request creation) - see lib/budgetCode.ts.
            budget_code = req.budgetCode or line_item.budgetCode
            actuals, commitments = generate_for_request(
                rng,
                expense_line_item_id=line_item.id,
                expense_line_item_name=line_item.name,
                budget_code=budget_code,
                approved_amount=net_amount,
                as_of_month=AS_OF_MONTH,
            )
            for a in actuals:
                session.add(
                    SapActualTransaction(
                        gl_account=line_item.glAccount,
                        cost_center=line_item.costCenter,
                        fiscal_year=FISCAL_YEAR,
                        month=a.month,
                        item_text=a.item_text,
                        amount=a.amount,
                        source_type=a.source_type,
                        expense_line_item_id=a.expense_line_item_id,
                        budget_code=a.budget_code,
                        posted_at=datetime(FISCAL_YEAR, a.month, 15),
                    )
                )
                actual_count += 1
            for c in commitments:
                session.add(
                    SapCommitment(
                        gl_account=line_item.glAccount,
                        cost_center=line_item.costCenter,
                        fiscal_year=FISCAL_YEAR,
                        po_number=c.po_number,
                        item_text=c.item_text,
                        amount=c.amount,
                        status=c.status,
                        expense_line_item_id=c.expense_line_item_id,
                    )
                )
                commitment_count += 1

        session.commit()
        print(
            f"Seeded {actual_count} actual transaction(s) and {commitment_count} commitment(s) "
            f"across {len(approved)} approved request(s) for FY{FISCAL_YEAR}."
        )


if __name__ == "__main__":
    main()
