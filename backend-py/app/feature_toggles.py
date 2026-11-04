"""Admin Console > Hidden Menus switches (the Node backend's FeatureToggle
table, listed in backend/src/lib/featureToggles.ts). A key with no row is off.
"""

from sqlalchemy import text
from sqlmodel import Session


def feature_enabled(session: Session, key: str) -> bool:
    row = session.execute(text('select enabled from "FeatureToggle" where key = :key'), {"key": key}).first()
    return bool(row[0]) if row else False
