"""Create classroom_item activation table + backfill from existing grades.

Revision ID: g0b1c2d3e4f5
Revises: f9a0b1c2d3e4
Create Date: 2026-05-20 16:00:00.000000

Issue #120. Item rows are user-scoped and cross-classroom by design
(b5c6d7e8f9a0 reverted per-classroom Items). The classroom grades view
previously had no per-classroom filter, so every newly-created item
appeared in every classroom of the matching subject. This migration adds
an activation table so the view query can filter items by "activated
for this class".

Backfill rule: any (classroom, item) pair that has ≥1 Grade row gets a
classroom_item row, so existing teachers see no change after deploy.
Only future newly-created items require explicit activation (via online
grade-entry save or import).
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = 'g0b1c2d3e4f5'
down_revision: Union[str, Sequence[str], None] = 'f9a0b1c2d3e4'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'classroom_item',
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
            'classroom_id',
            sa.dialects.postgresql.UUID(as_uuid=True),
            sa.ForeignKey('classroom.id', ondelete='CASCADE'),
            nullable=False,
        ),
        sa.Column(
            'item_id',
            sa.dialects.postgresql.UUID(as_uuid=True),
            sa.ForeignKey('item.id', ondelete='CASCADE'),
            nullable=False,
        ),
        sa.Column(
            'created_at',
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text('now()'),
        ),
        sa.Column(
            'updated_at',
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text('now()'),
        ),
        sa.UniqueConstraint(
            'classroom_id', 'item_id', name='uq_classroom_item'
        ),
    )
    op.create_index(
        'ix_classroom_item_classroom',
        'classroom_item',
        ['classroom_id'],
    )

    # Backfill: every (classroom, item) pair that already has at least
    # one grade row gets an activation row.
    op.execute("""
        INSERT INTO classroom_item
            (id, user_id, classroom_id, item_id, created_at, updated_at)
        SELECT
            gen_random_uuid(),
            c.user_id,
            s.classroom_id,
            g.item_id,
            now(),
            now()
        FROM grade g
        JOIN student s ON s.id = g.student_id
        JOIN classroom c ON c.id = s.classroom_id
        GROUP BY c.user_id, s.classroom_id, g.item_id
        ON CONFLICT (classroom_id, item_id) DO NOTHING;
    """)


def downgrade() -> None:
    op.drop_index('ix_classroom_item_classroom', table_name='classroom_item')
    op.drop_table('classroom_item')
