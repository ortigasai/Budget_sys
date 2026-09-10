from sqlalchemy import String, cast
from sqlalchemy.sql.elements import ColumnElement
from sqlmodel import Session, create_engine

from .settings import settings

engine = create_engine(settings.database_url)


def get_session():
    with Session(engine) as session:
        yield session


def enum_eq(column: ColumnElement, value: str) -> ColumnElement:
    """Compare a Prisma-owned native-Postgres-enum column (e.g.
    BudgetRequest.currentStage) against a plain Python string. Postgres
    won't compare an enum column to a bare varchar bind param directly, so
    the column is cast to text for the comparison instead of declaring a
    typed Enum column that would need every member value hardcoded here
    (see the note in app/models_phase1.py).
    """
    return cast(column, String) == value
