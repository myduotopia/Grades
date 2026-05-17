"""user_settings.subject_order

Revision ID: a4b5c6d7e8f9
Revises: f3a4b5c6d7e8
Create Date: 2026-05-17 16:00:00.000000

Per-user display order for non-academic subjects on /admin/subjects. JSONB
list of subject UUIDs. Academic built-ins (chinese / english / math / science
/ social_studies) are always rendered first in fixed order by the frontend;
this column only affects the relative order of every other subject.
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = 'a4b5c6d7e8f9'
down_revision: Union[str, Sequence[str], None] = 'f3a4b5c6d7e8'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "user_settings",
        sa.Column(
            "subject_order",
            sa.dialects.postgresql.JSONB(),
            nullable=False,
            server_default=sa.text("'[]'::jsonb"),
        ),
    )


def downgrade() -> None:
    op.drop_column("user_settings", "subject_order")
