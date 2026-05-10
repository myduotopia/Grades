"""add classroom.grade

Revision ID: f1a2b3c4d5e6
Revises: e005b3d6ddb6
Create Date: 2026-05-10 14:30:00.000000

Adds a `grade` column to classroom (1-12, Taiwan 12-year compulsory education).
Existing rows are backfilled to 7 (the user's current cohort) so the column
can become NOT NULL. The previous (user_id, name) UNIQUE constraint is
replaced with (user_id, grade, name) so the same name can repeat across
grades (e.g. "甲" can exist in both grade 5 and grade 6).
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = 'f1a2b3c4d5e6'
down_revision: Union[str, Sequence[str], None] = 'e005b3d6ddb6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # 1. Add nullable so existing rows survive
    op.add_column('classroom', sa.Column('grade', sa.SmallInteger(), nullable=True))

    # 2. Backfill: every existing classroom belongs to the user's current
    # 7th-grade cohort (per Issue #1 owner). New rows must specify grade.
    op.execute("UPDATE classroom SET grade = 7 WHERE grade IS NULL")

    # 3. Lock down: NOT NULL + CHECK 1..12
    op.alter_column('classroom', 'grade', nullable=False)
    op.create_check_constraint(
        'ck_classroom_grade_range',
        'classroom',
        'grade BETWEEN 1 AND 12',
    )

    # 4. Replace the (user_id, name) UNIQUE with (user_id, grade, name)
    op.drop_constraint('uq_classroom_user_name', 'classroom', type_='unique')
    op.create_unique_constraint(
        'uq_classroom_user_grade_name',
        'classroom',
        ['user_id', 'grade', 'name'],
    )


def downgrade() -> None:
    op.drop_constraint('uq_classroom_user_grade_name', 'classroom', type_='unique')
    op.create_unique_constraint(
        'uq_classroom_user_name',
        'classroom',
        ['user_id', 'name'],
    )
    op.drop_constraint('ck_classroom_grade_range', 'classroom', type_='check')
    op.drop_column('classroom', 'grade')
