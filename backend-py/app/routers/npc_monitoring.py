"""Admin Console — lets the Budget Officer re-upload the NPC Monitoring
workbook (see app/import_npc_monitoring.py's own docstring for why this
workbook, not live workflow tables, is 2026's real NPC Budget/IO source)
instead of requiring someone with shell access to re-run that script by
hand every month. Runs the exact same import logic either way.
"""

from __future__ import annotations

import io
from datetime import datetime, timezone

import openpyxl
from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from pydantic import BaseModel
from sqlmodel import Session, select

from ..auth import AuthedUser, get_current_user
from ..db import get_session
from ..import_npc_monitoring import run_import
from ..models_npc_monitoring import NpcMonitoringIo, NpcMonitoringProject

router = APIRouter(prefix="/admin/npc-monitoring", tags=["admin-npc-monitoring"])


def _require_budget_officer(user: AuthedUser) -> None:
    if not user.has_role("BUDGET_OFFICER"):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "You do not hold a role permitted to perform this action.")


def _utc_iso(dt: datetime | None) -> str | None:
    """Stored via datetime.utcnow() - naive, no tzinfo - so a bare
    .isoformat() has no UTC marker and a browser's `new Date(...)` reads it
    as local time instead (confirmed live: an 8-hour-off "last synced"
    display in a UTC+8 browser, same root cause as routers/utilization.py's
    own copy of this same helper - see its longer comment there).
    """
    if dt is None:
        return None
    return dt.replace(tzinfo=timezone.utc).isoformat()


class NpcMonitoringStatusOut(BaseModel):
    fiscalYear: int
    sourceFile: str | None
    importedAt: str | None
    projectCount: int
    ioCount: int


class NpcMonitoringUploadOut(BaseModel):
    sourceFile: str
    fiscalYear: int
    projectCount: int
    ioCount: int
    projectsBySbu: dict[str, int]


@router.get("/status", response_model=NpcMonitoringStatusOut)
def npc_monitoring_status(
    fiscalYear: int,
    user: AuthedUser = Depends(get_current_user),
    session: Session = Depends(get_session),
):
    """What's currently loaded for this fiscal year - shown above the
    upload control so the Budget Officer can see what they're about to
    override before doing it.
    """
    _require_budget_officer(user)
    projects = session.exec(select(NpcMonitoringProject).where(NpcMonitoringProject.fiscal_year == fiscalYear)).all()
    ios = session.exec(select(NpcMonitoringIo).where(NpcMonitoringIo.fiscal_year == fiscalYear)).all()
    latest = max(ios, key=lambda io: io.imported_at, default=None)
    return NpcMonitoringStatusOut(
        fiscalYear=fiscalYear,
        sourceFile=latest.source_file if latest else None,
        importedAt=_utc_iso(latest.imported_at) if latest else None,
        projectCount=len(projects),
        ioCount=len(ios),
    )


@router.post("/upload", response_model=NpcMonitoringUploadOut)
async def npc_monitoring_upload(
    file: UploadFile = File(...),
    fiscalYear: int = Form(...),
    user: AuthedUser = Depends(get_current_user),
):
    """Replaces every NpcMonitoringProject/NpcMonitoringIo row for
    `fiscalYear` with what's in the uploaded workbook - same "upload
    replaces the whole file" convention as the CC/GL master-list upload
    (see transfers.py's cc_gl_upload), and the same two-tab-shape workbook
    the user already emails around monthly (a "Monitoring" tab plus one tab
    per SBU) - no separate template to fill in.
    """
    _require_budget_officer(user)
    contents = await file.read()
    try:
        wb = openpyxl.load_workbook(io.BytesIO(contents), read_only=True, data_only=True)
    except Exception:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Could not read this file as an .xlsx workbook.")

    source_file = file.filename or "uploaded.xlsx"
    try:
        summary = run_import(wb, fiscalYear, source_file)
    except ValueError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc))

    return NpcMonitoringUploadOut(**summary)
