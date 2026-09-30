"""Small helpers shared between sap_raw_sync_service.py (the broker-calling
raw cache sync) and sap_sync_service.py (the mapping that used to call the
broker directly too, before the raw-cache consolidation) - split out to its
own module so neither of those two needs to import the other.
"""

from __future__ import annotations

from sqlmodel import Session, select

from ..models_phase3 import CostCenter


def padded_cost_centers(session: Session) -> list[str]:
    """Every admin-maintained Cost Center (Phase 3's own master list, already
    used by Transfer's own CC/GL pickers), padded to SAP's "00"+8-digit shape.
    Only clean numeric codes can ever match a real SAP KOSTL/ProfitCenter.
    """
    codes = session.exec(select(CostCenter.code)).all()
    return [f"00{c}" for c in codes if c.isdigit()]


def strip_pad(value: str) -> str:
    """Undo the "00"+8-digit padding SAP-side CC/GL codes carry, back to the
    bare 8-digit form this app's catalogs use elsewhere - mirrors the Node
    side's `.replace(/^00/, "")` convention exactly (strip only a literal
    leading "00", not every leading zero, since a code's own digits may
    legitimately start with one).
    """
    return value[2:] if value.startswith("00") else value
