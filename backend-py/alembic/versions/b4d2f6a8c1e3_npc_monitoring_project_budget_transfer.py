"""npc_monitoring_project_budget_transfer

Revision ID: b4d2f6a8c1e3
Revises: a7c3e91f5b20
Create Date: 2026-10-19 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'b4d2f6a8c1e3'
down_revision: Union[str, None] = 'a7c3e91f5b20'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('npc_monitoring_project', sa.Column('budget_transfer', sa.Float(), nullable=False, server_default='0'))


def downgrade() -> None:
    op.drop_column('npc_monitoring_project', 'budget_transfer')
