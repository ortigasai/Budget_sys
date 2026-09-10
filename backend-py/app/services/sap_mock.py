"""Mock stand-in for a real SAP pull, mirroring the Node backend's own
sapMockAdapter.ts pattern: an isolated, swappable adapter - the function
interface is the integration seam, not this generation logic. See
app/seed_mock_sap.py, the one-time script that calls this and writes the
results - now superseded by services/sap_sync_service.py's real broker pull
wherever SAP API keys are configured, but still useful for a from-scratch
dev DB with none.
"""

from __future__ import annotations

import random
from dataclasses import dataclass


@dataclass
class MockActual:
    item_text: str
    amount: float
    month: int
    source_type: str
    expense_line_item_id: str | None  # None = deliberately unmapped
    budget_code: str | None  # None = deliberately unmapped (posted by item text instead)


@dataclass
class MockCommitment:
    item_text: str
    amount: float
    po_number: str
    status: str
    expense_line_item_id: str | None


# A handful of deliberately-garbled item texts SAP PR creators might type by
# hand (FR-2.6's own example: "Fee April") - a fixed fraction of generated
# actuals use one of these instead of the real line-item name, landing in the
# "Unmapped SAP Actuals" exception queue on purpose so there's something to
# demo (FR-2.6).
UNMATCHED_ITEM_TEXTS = ["Fee April", "Misc Charge", "Svc Payment", "Adj Entry", "Q3 True-up"]


def generate_for_request(
    rng: random.Random,
    *,
    expense_line_item_id: str,
    expense_line_item_name: str,
    budget_code: str | None,
    approved_amount: float,
    as_of_month: int,
) -> tuple[list[MockActual], list[MockCommitment]]:
    """One approved BudgetRequest's worth of plausible SAP activity."""
    if approved_amount <= 0:
        return [], []

    actuals: list[MockActual] = []
    commitments: list[MockCommitment] = []

    # Most of the approved amount is "spent" (posted actuals) by now, a
    # smaller slice is "committed" (open PO/PR), and some stays unspent -
    # ratios randomized per request so the dashboard doesn't look uniform.
    spent_fraction = rng.uniform(0.35, 0.85)
    committed_fraction = rng.uniform(0.0, 0.20)

    spent_total = round(approved_amount * spent_fraction, 2)
    committed_total = round(approved_amount * committed_fraction, 2)

    if spent_total > 0:
        n = rng.randint(1, min(3, as_of_month))
        is_unmatched = rng.random() < 0.08
        for amount in _random_split(rng, spent_total, n):
            actuals.append(
                MockActual(
                    item_text=rng.choice(UNMATCHED_ITEM_TEXTS) if is_unmatched else expense_line_item_name,
                    amount=amount,
                    month=rng.randint(1, as_of_month),
                    source_type=rng.choice(["INVOICE", "JOURNAL_ENTRY"]),
                    expense_line_item_id=None if is_unmatched else expense_line_item_id,
                    budget_code=None if is_unmatched else budget_code,
                )
            )

    if committed_total > 0:
        commitments.append(
            MockCommitment(
                item_text=expense_line_item_name,
                amount=committed_total,
                po_number=f"PO{rng.randint(100000, 999999)}",
                status=rng.choice(["OPEN", "APPROVED_PR"]),
                expense_line_item_id=expense_line_item_id,
            )
        )

    return actuals, commitments


def _random_split(rng: random.Random, total: float, n: int) -> list[float]:
    """Split `total` into n positive amounts that sum back to it exactly."""
    if n == 1:
        return [round(total, 2)]
    cuts = sorted(rng.uniform(0, total) for _ in range(n - 1))
    parts = [cuts[0]] + [cuts[i] - cuts[i - 1] for i in range(1, len(cuts))] + [total - cuts[-1]]
    parts = [round(p, 2) for p in parts]
    # Rounding can leave the split off by a cent or two - push any remainder
    # onto the last part so it still sums exactly to `total`.
    parts[-1] = round(total - sum(parts[:-1]), 2)
    return parts
