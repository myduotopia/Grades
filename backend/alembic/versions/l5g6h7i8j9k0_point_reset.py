"""Create point_reset marker table (issue #165).

Revision ID: l5g6h7i8j9k0
Revises: k4f5g6h7i8j9
Create Date: 2026-05-28 16:00:00.000000

Reset stops being an append-a-negative-PointRecord trick (which silently
broke whenever past PointRecords later changed) and becomes a per-student
marker. Sum-of-points logic now uses `reset_at` as a moving floor inside
the semester window.

No data migration: existing reset records in `point_record` (rows with
points<0 reason='歸零') are intentionally left alone — the design choice
was to fix new resets only, not retroactively rewrite history.
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = 'l5g6h7i8j9k0'
down_revision: Union[str, Sequence[str], None] = 'k4f5g6h7i8j9'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'point_reset',
        sa.Column(
            'id',
            sa.dialects.postgresql.UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text('gen_random_uuid()'),
        ),
        sa.Column(
            'user_id',
            sa.dialects.postgresql.UUID(as_uuid=True),
            nullable=False,
        ),
        sa.Column(
            'student_id',
            sa.dialects.postgresql.UUID(as_uuid=True),
            sa.ForeignKey('student.id', ondelete='CASCADE'),
            nullable=False,
        ),
        sa.Column(
            'reset_at',
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text('now()'),
        ),
        sa.Column(
            'reason',
            sa.Text(),
            nullable=False,
            server_default='',
        ),
        sa.Column(
            'created_at',
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text('now()'),
        ),
    )
    op.create_index(
        'ix_point_reset_student', 'point_reset', ['student_id']
    )
    op.create_index(
        'ix_point_reset_reset_at', 'point_reset', ['reset_at']
    )


def downgrade() -> None:
    op.drop_index('ix_point_reset_reset_at', table_name='point_reset')
    op.drop_index('ix_point_reset_student', table_name='point_reset')
    op.drop_table('point_reset')
