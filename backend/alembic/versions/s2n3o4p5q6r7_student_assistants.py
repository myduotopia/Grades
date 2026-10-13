"""Student assistants (小老師) + grade.entered_at (#262).

- `class_assistant` — which students are 小老師 of which class (owning
  teacher in `user_id`). UNIQUE (classroom_id, student_id).
- `item_assistant` — which 小老師 may enter which item. UNIQUE
  (item_id, student_id).
  Every FK is ON DELETE CASCADE (classroom / student / item) so deleting a
  student, an item, or running `/api/me/reset` (bulk deletes that bypass the
  ORM) never trips over these rows.
- `grade.entered_at` — when the stamped writer last changed the score;
  `write_score` sets it. Server default now() for new rows.

Backfill: `entered_at = updated_at` for rows still NULL — the best available
approximation for scores entered before this column existed. Idempotent
(only NULL rows), so upgrade → downgrade → upgrade re-derives the same data.
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql


revision: str = 's2n3o4p5q6r7'
down_revision: Union[str, Sequence[str], None] = 'r1m2n3o4p5q6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'class_assistant',
        sa.Column('id', postgresql.UUID(as_uuid=True),
                  server_default=sa.text('gen_random_uuid()'), nullable=False),
        sa.Column('user_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('classroom_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('student_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True),
                  server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['classroom_id'], ['classroom.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['student_id'], ['student.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('classroom_id', 'student_id',
                            name='uq_class_assistant_classroom_student'),
    )
    op.create_index('ix_class_assistant_user_id', 'class_assistant', ['user_id'])
    op.create_index('ix_class_assistant_classroom_id', 'class_assistant', ['classroom_id'])
    op.create_index('ix_class_assistant_student_id', 'class_assistant', ['student_id'])

    op.create_table(
        'item_assistant',
        sa.Column('id', postgresql.UUID(as_uuid=True),
                  server_default=sa.text('gen_random_uuid()'), nullable=False),
        sa.Column('user_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('item_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('student_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True),
                  server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['item_id'], ['item.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['student_id'], ['student.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('item_id', 'student_id',
                            name='uq_item_assistant_item_student'),
    )
    op.create_index('ix_item_assistant_user_id', 'item_assistant', ['user_id'])
    op.create_index('ix_item_assistant_item_id', 'item_assistant', ['item_id'])
    op.create_index('ix_item_assistant_student_id', 'item_assistant', ['student_id'])

    # Add without a default first so existing rows stay NULL, backfill them
    # from updated_at (idempotent: NULL rows only), then set the default
    # for rows inserted from now on.
    op.add_column(
        'grade',
        sa.Column('entered_at', sa.DateTime(timezone=True), nullable=True),
    )
    op.execute(
        "UPDATE grade SET entered_at = updated_at WHERE entered_at IS NULL"
    )
    op.alter_column('grade', 'entered_at', server_default=sa.text('now()'))


def downgrade() -> None:
    op.drop_column('grade', 'entered_at')
    op.drop_index('ix_item_assistant_student_id', table_name='item_assistant')
    op.drop_index('ix_item_assistant_item_id', table_name='item_assistant')
    op.drop_index('ix_item_assistant_user_id', table_name='item_assistant')
    op.drop_table('item_assistant')
    op.drop_index('ix_class_assistant_student_id', table_name='class_assistant')
    op.drop_index('ix_class_assistant_classroom_id', table_name='class_assistant')
    op.drop_index('ix_class_assistant_user_id', table_name='class_assistant')
    op.drop_table('class_assistant')
