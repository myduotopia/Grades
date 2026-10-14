"""Grade-item edit locks (#264).

`grade_item_lock` — one row per (classroom, item) that someone is editing.
Live while `expires_at > now()` (heartbeats push it forward; see
backend/item_lock.py). FKs to classroom and item are ON DELETE CASCADE so
deleting either (or `/api/me/reset`) never trips over a lock row. No data
backfill: the table starts empty, and downgrade simply drops it (locks are
transient — losing them only means nobody is "editing" any more).
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql


revision: str = 't3o4p5q6r7s8'
down_revision: Union[str, Sequence[str], None] = 's2n3o4p5q6r7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'grade_item_lock',
        sa.Column('id', postgresql.UUID(as_uuid=True),
                  server_default=sa.text('gen_random_uuid()'), nullable=False),
        sa.Column('classroom_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('item_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('holder_user_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('holder_role', sa.String(length=16), nullable=False),
        sa.Column('holder_name', sa.String(length=255), nullable=True),
        sa.Column('expires_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True),
                  server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True),
                  server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['classroom_id'], ['classroom.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['item_id'], ['item.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('classroom_id', 'item_id',
                            name='uq_grade_item_lock_classroom_item'),
        sa.CheckConstraint("holder_role IN ('teacher', 'assistant')",
                           name='ck_grade_item_lock_holder_role'),
    )
    op.create_index('ix_grade_item_lock_classroom_id', 'grade_item_lock', ['classroom_id'])
    op.create_index('ix_grade_item_lock_item_id', 'grade_item_lock', ['item_id'])


def downgrade() -> None:
    op.drop_index('ix_grade_item_lock_item_id', table_name='grade_item_lock')
    op.drop_index('ix_grade_item_lock_classroom_id', table_name='grade_item_lock')
    op.drop_table('grade_item_lock')
