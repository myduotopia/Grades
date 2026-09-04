"""Student groups within a classroom (#237).

Teachers split a class into small groups for competitions, bonus points and
cleaning duty. Two tables rather than a JSONB array of ids (the pattern used
for `user_settings.item_order`): group membership is a real relation, so when
a student is deleted the FK CASCADE must clean them out of every group — a
JSONB array cannot do that and would silently rot.

A class may hold several independent groupings at once, so there is
deliberately NO uniqueness on (classroom, student): a student can be in more
than one group. Only (group_id, student_id) is unique.

`student_group.leader_student_id` is ON DELETE SET NULL, not CASCADE —
deleting the leader must not delete the whole group.
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql


revision: str = 'p9k0l1m2n3o4'
down_revision: Union[str, Sequence[str], None] = 'o8j9k0l1m2n3'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'student_group',
        sa.Column(
            'id', postgresql.UUID(as_uuid=True),
            server_default=sa.text('gen_random_uuid()'), nullable=False,
        ),
        sa.Column('user_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('classroom_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('name', sa.String(length=100), nullable=False),
        sa.Column('color', sa.String(length=20), nullable=True),
        sa.Column('leader_student_id', postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column('sort_order', sa.Integer(), nullable=False, server_default='0'),
        sa.Column(
            'created_at', sa.DateTime(timezone=True),
            server_default=sa.text('now()'), nullable=False,
        ),
        sa.Column(
            'updated_at', sa.DateTime(timezone=True),
            server_default=sa.text('now()'), nullable=False,
        ),
        sa.ForeignKeyConstraint(['classroom_id'], ['classroom.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['leader_student_id'], ['student.id'], ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint(
            'user_id', 'classroom_id', 'name', name='uq_group_user_classroom_name'
        ),
    )
    op.create_index(
        op.f('ix_student_group_classroom_id'), 'student_group', ['classroom_id']
    )
    op.create_index(op.f('ix_student_group_user_id'), 'student_group', ['user_id'])

    op.create_table(
        'student_group_member',
        sa.Column(
            'id', postgresql.UUID(as_uuid=True),
            server_default=sa.text('gen_random_uuid()'), nullable=False,
        ),
        sa.Column('user_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('group_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('student_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('sort_order', sa.Integer(), nullable=False, server_default='0'),
        sa.Column(
            'created_at', sa.DateTime(timezone=True),
            server_default=sa.text('now()'), nullable=False,
        ),
        sa.Column(
            'updated_at', sa.DateTime(timezone=True),
            server_default=sa.text('now()'), nullable=False,
        ),
        sa.ForeignKeyConstraint(['group_id'], ['student_group.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['student_id'], ['student.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('group_id', 'student_id', name='uq_group_member'),
    )
    op.create_index(
        op.f('ix_student_group_member_group_id'), 'student_group_member', ['group_id']
    )
    op.create_index(
        op.f('ix_student_group_member_student_id'),
        'student_group_member', ['student_id'],
    )
    op.create_index(
        op.f('ix_student_group_member_user_id'), 'student_group_member', ['user_id']
    )


def downgrade() -> None:
    op.drop_index(
        op.f('ix_student_group_member_user_id'), table_name='student_group_member'
    )
    op.drop_index(
        op.f('ix_student_group_member_student_id'), table_name='student_group_member'
    )
    op.drop_index(
        op.f('ix_student_group_member_group_id'), table_name='student_group_member'
    )
    op.drop_table('student_group_member')
    op.drop_index(op.f('ix_student_group_user_id'), table_name='student_group')
    op.drop_index(op.f('ix_student_group_classroom_id'), table_name='student_group')
    op.drop_table('student_group')
