"""Freeze classroom_grade + classroom_name onto grade_snapshot (issue #123).

Revision ID: i2d3e4f5g6h7
Revises: h1c2d3e4f5g6
Create Date: 2026-05-21 15:00:00.000000

Without this, an archive made when a class was grade 7 starts showing
"grade 8" after the teacher uses the bulk promote button. Snapshot
display labels need to be pinned at archive time.
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = 'i2d3e4f5g6h7'
down_revision: Union[str, Sequence[str], None] = 'h1c2d3e4f5g6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        'grade_snapshot',
        sa.Column('classroom_grade', sa.Integer(), nullable=True),
    )
    op.add_column(
        'grade_snapshot',
        sa.Column('classroom_name', sa.String(50), nullable=True),
    )
    # Backfill existing rows from the current classroom values (best we
    # can do — there's no history of past grade/name changes).
    op.execute("""
        UPDATE grade_snapshot gs
        SET classroom_grade = c.grade,
            classroom_name = c.name
        FROM classroom c
        WHERE gs.classroom_id = c.id;
    """)
    op.alter_column('grade_snapshot', 'classroom_grade', nullable=False)
    op.alter_column('grade_snapshot', 'classroom_name', nullable=False)


def downgrade() -> None:
    op.drop_column('grade_snapshot', 'classroom_name')
    op.drop_column('grade_snapshot', 'classroom_grade')
