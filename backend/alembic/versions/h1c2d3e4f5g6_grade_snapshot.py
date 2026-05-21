"""Add grade_snapshot table + classroom_item.snapshot_id (issue #123).

Revision ID: h1c2d3e4f5g6
Revises: g0b1c2d3e4f5
Create Date: 2026-05-21 11:00:00.000000

Snapshots ("成績封存") let a teacher bundle the currently-activated items
for a classroom into a historical container. Activation rows move from
the main classroom bucket (snapshot_id IS NULL) into the snapshot
bucket (snapshot_id = <id>). Both buckets can hold the same item once
each — partial unique indexes enforce the rule per-bucket.
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = 'h1c2d3e4f5g6'
down_revision: Union[str, Sequence[str], None] = 'g0b1c2d3e4f5'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'grade_snapshot',
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
        sa.Column('name', sa.String(100), nullable=False),
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
    )
    op.create_index(
        'ix_grade_snapshot_classroom',
        'grade_snapshot',
        ['classroom_id'],
    )

    # Add the snapshot pointer to classroom_item. NULL = belongs to the
    # classroom's live (main) view; non-NULL = belongs to a snapshot.
    op.add_column(
        'classroom_item',
        sa.Column(
            'snapshot_id',
            sa.dialects.postgresql.UUID(as_uuid=True),
            sa.ForeignKey('grade_snapshot.id', ondelete='CASCADE'),
            nullable=True,
        ),
    )
    op.create_index(
        'ix_classroom_item_snapshot_id',
        'classroom_item',
        ['snapshot_id'],
    )

    # Replace the old single unique constraint on (classroom_id, item_id)
    # with two partial unique indexes: one per bucket.
    op.drop_constraint(
        'uq_classroom_item', 'classroom_item', type_='unique'
    )
    op.create_index(
        'uq_classroom_item_main',
        'classroom_item',
        ['classroom_id', 'item_id'],
        unique=True,
        postgresql_where=sa.text('snapshot_id IS NULL'),
    )
    op.create_index(
        'uq_classroom_item_snapshot',
        'classroom_item',
        ['classroom_id', 'snapshot_id', 'item_id'],
        unique=True,
        postgresql_where=sa.text('snapshot_id IS NOT NULL'),
    )


def downgrade() -> None:
    op.drop_index('uq_classroom_item_snapshot', table_name='classroom_item')
    op.drop_index('uq_classroom_item_main', table_name='classroom_item')
    op.create_unique_constraint(
        'uq_classroom_item', 'classroom_item', ['classroom_id', 'item_id']
    )
    op.drop_index('ix_classroom_item_snapshot_id', table_name='classroom_item')
    op.drop_column('classroom_item', 'snapshot_id')
    op.drop_index('ix_grade_snapshot_classroom', table_name='grade_snapshot')
    op.drop_table('grade_snapshot')
