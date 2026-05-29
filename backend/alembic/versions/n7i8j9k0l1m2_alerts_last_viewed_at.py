"""Add user_settings.alerts_last_viewed_at for the home Alerts badge (#161).

Revision ID: n7i8j9k0l1m2
Revises: m6h7i8j9k0l1
Create Date: 2026-05-28 22:00:00.000000

Nullable timestamp: the home Alerts badge counts 0-score live grades whose
updated_at > this moment. NULL = teacher has never opened the page →
every existing 0 counts toward the initial badge.
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = 'n7i8j9k0l1m2'
down_revision: Union[str, Sequence[str], None] = 'm6h7i8j9k0l1'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        'user_settings',
        sa.Column(
            'alerts_last_viewed_at',
            sa.DateTime(timezone=True),
            nullable=True,
        ),
    )


def downgrade() -> None:
    op.drop_column('user_settings', 'alerts_last_viewed_at')
