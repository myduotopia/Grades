"""user_settings.point_reasons

Revision ID: e8f9a0b1c2d3
Revises: d7e8f9a0b1c2
Create Date: 2026-05-19 10:00:00.000000

Per-user list of manual-point reasons (issue #84). Each entry is
`{id, name, default_points}`; stored as JSONB. The list governs the quick-
add UX on /points and /points/:classroomId; point_record.reason itself is
still free text and snapshots the name at write time (renaming a reason
later does not rewrite past records).
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = 'e8f9a0b1c2d3'
down_revision: Union[str, Sequence[str], None] = 'd7e8f9a0b1c2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "user_settings",
        sa.Column(
            "point_reasons",
            sa.dialects.postgresql.JSONB(),
            nullable=False,
            server_default=sa.text("'[]'::jsonb"),
        ),
    )


def downgrade() -> None:
    op.drop_column("user_settings", "point_reasons")
