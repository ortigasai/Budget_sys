"""Stand-in for the real Dash Flow Payment Request Ticketing API (Note 11
§5). Mirrors backend/src/services/sapMockAdapter.ts's shape exactly: a small
dataclass payload plus one async function per external operation, so a
caller never touches a raw HTTP payload directly. Swap the bodies of the two
functions below for real HTTP calls once the Dash Flow API details are
shared - no caller (routers/dash_flow.py) needs to change.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime


@dataclass
class DashFlowTicketPayload:
    external_ticket_id: str
    external_ticket_url: str
    cost_center: str
    gl_account: str
    request_amount: float
    fiscal_year: int


# Deterministic mock queue - stands in for "whatever is currently open in
# Dash Flow" until the real API is wired up. Cost Centers/GL Accounts here
# are chosen to exist in the seeded CC-GL master lists so a sync produces
# tickets that resolve to a real routed_sbu.
_MOCK_PENDING_TICKETS: list[DashFlowTicketPayload] = [
    DashFlowTicketPayload(
        external_ticket_id="DF-100234",
        external_ticket_url="https://dashflow.example.com/tickets/DF-100234",
        cost_center="80221208",
        gl_account="61731103",
        request_amount=150000.0,
        fiscal_year=datetime.utcnow().year,
    ),
    DashFlowTicketPayload(
        external_ticket_id="DF-100235",
        external_ticket_url="https://dashflow.example.com/tickets/DF-100235",
        cost_center="80133101",
        gl_account="62011103",
        request_amount=45000.0,
        fiscal_year=datetime.utcnow().year,
    ),
]


async def fetch_pending_tickets() -> list[DashFlowTicketPayload]:
    """Pull whatever's currently open in Dash Flow. Mock data for now - the
    entire integration seam for the real API.
    """
    return list(_MOCK_PENDING_TICKETS)


async def notify_ticket_closed(external_ticket_id: str) -> None:
    """Tell Dash Flow this ticket was closed on our end. No-op until the real
    API is wired up.
    """
    return None
