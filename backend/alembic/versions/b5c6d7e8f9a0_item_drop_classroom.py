"""item: drop classroom_id (items are cross-classroom again)

Revision ID: b5c6d7e8f9a0
Revises: a4b5c6d7e8f9
Create Date: 2026-05-18 10:00:00.000000

Reverses #8's per-classroom item design. After teacher feedback: the same
"Quiz 3" given to multiple classes should be ONE item, so that grade
analysis can compare results across classes for the same assessment.

- dedupe rows: for each (user_id, subject_id, category_id, semester_id, name)
  group, keep the lowest-id row, re-point grades from the others, then
  delete the duplicates
- drop the constraint that includes classroom_id, restore the constraint
  WITHOUT it
- drop the column + index + FK
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = 'b5c6d7e8f9a0'
down_revision: Union[str, Sequence[str], None] = 'a4b5c6d7e8f9'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()

    # Find duplicate groups and pick a survivor per group.
    groups = bind.execute(
        sa.text(
            """
            SELECT user_id, subject_id, category_id, semester_id, name,
                   array_agg(id ORDER BY id) AS ids
            FROM item
            GROUP BY user_id, subject_id, category_id, semester_id, name
            HAVING COUNT(*) > 1
            """
        )
    ).fetchall()

    for row in groups:
        ids = list(row.ids)
        survivor = ids[0]
        losers = ids[1:]
        # Re-point grades from the duplicate items onto the survivor. If a
        # student already has a grade on the survivor item, drop the
        # duplicate grade (we'd violate uq_grade_item_student otherwise);
        # the survivor's value wins.
        bind.execute(
            sa.text(
                """
                DELETE FROM grade g
                WHERE g.item_id = ANY(:losers)
                  AND EXISTS (
                    SELECT 1 FROM grade g2
                    WHERE g2.item_id = :survivor
                      AND g2.student_id = g.student_id
                  )
                """
            ),
            {"losers": losers, "survivor": survivor},
        )
        bind.execute(
            sa.text(
                "UPDATE grade SET item_id = :survivor "
                "WHERE item_id = ANY(:losers)"
            ),
            {"survivor": survivor, "losers": losers},
        )
        bind.execute(
            sa.text("DELETE FROM item WHERE id = ANY(:losers)"),
            {"losers": losers},
        )

    op.drop_constraint(
        "uq_item_subject_category_semester_name_classroom",
        "item",
        type_="unique",
    )
    op.create_unique_constraint(
        "uq_item_subject_category_semester_name",
        "item",
        ["user_id", "subject_id", "category_id", "semester_id", "name"],
    )

    op.drop_index("ix_item_classroom_id", table_name="item")
    op.drop_column("item", "classroom_id")


def downgrade() -> None:
    op.add_column(
        "item",
        sa.Column(
            "classroom_id",
            sa.dialects.postgresql.UUID(as_uuid=True),
            sa.ForeignKey("classroom.id", ondelete="CASCADE"),
            nullable=True,
        ),
    )
    op.create_index("ix_item_classroom_id", "item", ["classroom_id"])
    # Cannot recover the original per-classroom split — downgrade leaves
    # classroom_id NULL on every row. Manual cleanup required if you really
    # need to roll back.
    op.drop_constraint(
        "uq_item_subject_category_semester_name", "item", type_="unique"
    )
    op.create_unique_constraint(
        "uq_item_subject_category_semester_name_classroom",
        "item",
        [
            "user_id", "subject_id", "category_id", "semester_id",
            "name", "classroom_id",
        ],
    )
