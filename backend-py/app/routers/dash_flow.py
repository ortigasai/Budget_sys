"""Note 11 §5 — Dash Flow Payment Request Ticket – Budget Check.

Restricted to SBU Finance Officers (each scoped to their own SBU via
SbuRoleAssignment, same mechanism Transfers/Approved Budget already use),
plus unconditional Budget Officer oversight. A ticket's budget-check status
(red "No sufficient budget" / green "Budget available") is computed live off
compute_gl_cc_available() - never stored - so it always reflects the current
FinalizedBudgetLine snapshot.
"""

from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlmodel import Session, select

from ..auth import AuthedUser, get_current_user
from ..db import get_session
from ..models_phase1 import User
from ..models_phase3 import CostCenter, DashFlowTicket
from ..services.budget_balance import compute_gl_cc_available
from ..services.dash_flow_adapter import fetch_pending_tickets, notify_ticket_closed

router = APIRouter(prefix="/dash-flow", tags=["dash-flow"])


def _require_dash_flow_access(user: AuthedUser = Depends(get_current_user)) -> AuthedUser:
    if user.has_role("BUDGET_OFFICER") or user.has_sbu_role("BU_FINANCE_OFFICER"):
        return user
    raise HTTPException(status.HTTP_403_FORBIDDEN, "You do not have access to Dash Flow Budget Check.")


def _my_sbus(user: AuthedUser) -> list[str]:
    return [r.sbu for r in user.roles if r.roleType == "BU_FINANCE_OFFICER" and r.sbu]


class SyncResultOut(BaseModel):
    created: int
    updated: int


@router.post("/sync", response_model=SyncResultOut)
async def sync_tickets(
    user: AuthedUser = Depends(_require_dash_flow_access),
    session: Session = Depends(get_session),
):
    """Pull whatever's currently open in Dash Flow (via the mock adapter for
    now) and upsert into DashFlowTicket, resolving each ticket's routed_sbu
    from CostCenter.sbu.
    """
    payloads = await fetch_pending_tickets()
    cc_sbu_by_code = {c.code: c.sbu for c in session.exec(select(CostCenter)).all()}

    created = 0
    updated = 0
    for p in payloads:
        existing = session.exec(
            select(DashFlowTicket).where(DashFlowTicket.external_ticket_id == p.external_ticket_id)
        ).first()
        routed_sbu = cc_sbu_by_code.get(p.cost_center)
        if existing is None:
            session.add(
                DashFlowTicket(
                    external_ticket_id=p.external_ticket_id,
                    external_ticket_url=p.external_ticket_url,
                    cost_center=p.cost_center,
                    gl_account=p.gl_account,
                    request_amount=p.request_amount,
                    fiscal_year=p.fiscal_year,
                    routed_sbu=routed_sbu,
                )
            )
            created += 1
        elif existing.status == "OPEN":
            existing.request_amount = p.request_amount
            existing.routed_sbu = routed_sbu
            session.add(existing)
            updated += 1
    session.commit()
    return SyncResultOut(created=created, updated=updated)


class DashFlowTicketOut(BaseModel):
    id: int
    externalTicketId: str
    externalTicketUrl: str | None
    costCenter: str
    glAccount: str
    requestAmount: float
    fiscalYear: int
    routedSbu: str | None
    status: str
    budgetAvailable: bool
    availableAmount: float
    closedByName: str | None
    closedAt: datetime | None
    createdAt: datetime


def _serialize(t: DashFlowTicket, session: Session, users_by_id: dict[str, str]) -> DashFlowTicketOut:
    available = compute_gl_cc_available(session, t.gl_account, t.cost_center, t.fiscal_year)
    return DashFlowTicketOut(
        id=t.id,
        externalTicketId=t.external_ticket_id,
        externalTicketUrl=t.external_ticket_url,
        costCenter=t.cost_center,
        glAccount=t.gl_account,
        requestAmount=t.request_amount,
        fiscalYear=t.fiscal_year,
        routedSbu=t.routed_sbu,
        status=t.status,
        budgetAvailable=t.request_amount <= available,
        availableAmount=round(available, 2),
        closedByName=users_by_id.get(t.closed_by_id) if t.closed_by_id else None,
        closedAt=t.closed_at,
        createdAt=t.created_at,
    )


@router.get("/tickets", response_model=list[DashFlowTicketOut])
def list_tickets(
    status_filter: str = "OPEN",
    user: AuthedUser = Depends(_require_dash_flow_access),
    session: Session = Depends(get_session),
):
    """The caller's own SBU queue (Budget Officer sees every SBU). status
    defaults to OPEN for the active queue; pass status_filter=CLOSED for
    history.
    """
    query = select(DashFlowTicket).where(DashFlowTicket.status == status_filter)
    if not user.has_role("BUDGET_OFFICER"):
        my_sbus = _my_sbus(user)
        if not my_sbus:
            return []
        query = query.where(DashFlowTicket.routed_sbu.in_(my_sbus))
    tickets = session.exec(query.order_by(DashFlowTicket.created_at.desc())).all()

    closer_ids = {t.closed_by_id for t in tickets if t.closed_by_id}
    users_by_id = {u.id: u.name for u in session.exec(select(User).where(User.id.in_(closer_ids))).all()} if closer_ids else {}
    return [_serialize(t, session, users_by_id) for t in tickets]


@router.post("/tickets/{ticket_id}/close", response_model=DashFlowTicketOut)
async def close_ticket(
    ticket_id: int,
    user: AuthedUser = Depends(_require_dash_flow_access),
    session: Session = Depends(get_session),
):
    ticket = session.get(DashFlowTicket, ticket_id)
    if ticket is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Ticket not found.")
    if not user.has_role("BUDGET_OFFICER") and ticket.routed_sbu not in _my_sbus(user):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "This ticket is not routed to your SBU.")
    if ticket.status == "CLOSED":
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "This ticket is already closed.")

    ticket.status = "CLOSED"
    ticket.closed_by_id = user.id
    ticket.closed_at = datetime.utcnow()
    session.add(ticket)
    session.commit()
    session.refresh(ticket)

    await notify_ticket_closed(ticket.external_ticket_id)

    closer = session.get(User, user.id)
    users_by_id = {user.id: closer.name} if closer else {}
    return _serialize(ticket, session, users_by_id)
