"""student_standard: per-category → per-subject

Revision ID: d7e8f9a0b1c2
Revises: c6d7e8f9a0b1
Create Date: 2026-05-18 14:00:00.000000

Per #10 spec pivot (per-category → per-subject) to align with #7's
subject_point_rule. Existing data is discarded — practice project, OK to
lose. New shape: (user, student, subject) → threshold.
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = 'd7e8f9a0b1c2'
down_revision: Union[str, Sequence[str], None] = 'c6d7e8f9a0b1'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Old per-category data is incompatible with the new per-subject model.
    op.execute("DELETE FROM student_standard")

    op.drop_constraint(
        "uq_standard_student_category", "student_standard", type_="unique"
    )
    op.drop_index("ix_student_standard_category_id", table_name="student_standard")
    op.drop_column("student_standard", "category_id")

    op.add_column(
        "student_standard",
        sa.Column(
            "subject_id",
            sa.dialects.postgresql.UUID(as_uuid=True),
            sa.ForeignKey("subject.id", ondelete="CASCADE"),
            nullable=False,
        ),
    )
    op.create_index(
        "ix_student_standard_subject_id", "student_standard", ["subject_id"]
    )
    op.create_unique_constraint(
        "uq_standard_student_subject",
        "student_standard",
        ["student_id", "subject_id"],
    )


def downgrade() -> None:
    op.execute("DELETE FROM student_standard")
    op.drop_constraint(
        "uq_standard_student_subject", "student_standard", type_="unique"
    )
    op.drop_index("ix_student_standard_subject_id", table_name="student_standard")
    op.drop_column("student_standard", "subject_id")

    op.add_column(
        "student_standard",
        sa.Column(
            "category_id",
            sa.dialects.postgresql.UUID(as_uuid=True),
            sa.ForeignKey("category.id", ondelete="CASCADE"),
            nullable=False,
        ),
    )
    op.create_index(
        "ix_student_standard_category_id", "student_standard", ["category_id"]
    )
    op.create_unique_constraint(
        "uq_standard_student_category",
        "student_standard",
        ["student_id", "category_id"],
    )
