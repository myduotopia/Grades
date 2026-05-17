"""user_settings.item_order

Revision ID: c6d7e8f9a0b1
Revises: b5c6d7e8f9a0
Create Date: 2026-05-18 12:00:00.000000

Per-user display order for items on /admin/items. JSONB list of item UUIDs
(as strings). Items not present in the list fall back to created_at desc
on the frontend (newest first).
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = 'c6d7e8f9a0b1'
down_revision: Union[str, Sequence[str], None] = 'b5c6d7e8f9a0'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "user_settings",
        sa.Column(
            "item_order",
            sa.dialects.postgresql.JSONB(),
            nullable=False,
            server_default=sa.text("'[]'::jsonb"),
        ),
    )


def downgrade() -> None:
    op.drop_column("user_settings", "item_order")
