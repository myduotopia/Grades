"""item per-classroom (drop M2M item_classroom)

Revision ID: f3a4b5c6d7e8
Revises: e2f3a4b5c6d7
Create Date: 2026-05-17 14:00:00.000000

Schema change: an Item now belongs to exactly one Classroom.

- add `item.classroom_id` (UUID FK → classroom.id ON DELETE CASCADE)
- backfill: for each (item, classroom) link, ensure exactly one Item row
  references that classroom; for items previously linked to N > 1 classrooms,
  clone (N-1) extra rows and re-point the grades that belong to each
  classroom's students. Orphan items (no link) get deleted.
- drop `item_classroom`
- replace unique constraint:
    uq_item_subject_category_semester_name
      → uq_item_subject_category_semester_name_classroom
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = 'f3a4b5c6d7e8'
down_revision: Union[str, Sequence[str], None] = 'e2f3a4b5c6d7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
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

    bind = op.get_bind()

    # Group existing item_classroom links by item_id.
    groups = bind.execute(
        sa.text(
            "SELECT item_id, array_agg(classroom_id ORDER BY classroom_id) AS cids "
            "FROM item_classroom GROUP BY item_id"
        )
    ).fetchall()

    for row in groups:
        item_id = row.item_id
        cids = list(row.cids)
        if not cids:
            continue
        # First classroom: update the existing item in place.
        bind.execute(
            sa.text("UPDATE item SET classroom_id = :cid WHERE id = :iid"),
            {"cid": cids[0], "iid": item_id},
        )
        if len(cids) == 1:
            continue
        # Additional classrooms: clone item, re-point that classroom's grades.
        src = bind.execute(
            sa.text(
                "SELECT user_id, subject_id, category_id, semester_id, name "
                "FROM item WHERE id = :iid"
            ),
            {"iid": item_id},
        ).first()
        for cid in cids[1:]:
            new_id = bind.execute(
                sa.text(
                    "INSERT INTO item "
                    "(user_id, subject_id, category_id, semester_id, name, classroom_id) "
                    "VALUES (:uid, :sid, :catid, :semid, :nm, :cid) RETURNING id"
                ),
                {
                    "uid": src.user_id,
                    "sid": src.subject_id,
                    "catid": src.category_id,
                    "semid": src.semester_id,
                    "nm": src.name,
                    "cid": cid,
                },
            ).scalar()
            bind.execute(
                sa.text(
                    "UPDATE grade SET item_id = :new_iid "
                    "WHERE item_id = :old_iid "
                    "AND student_id IN ("
                    "  SELECT id FROM student WHERE classroom_id = :cid"
                    ")"
                ),
                {"new_iid": new_id, "old_iid": item_id, "cid": cid},
            )

    # Orphans: items that never had any classroom link.
    bind.execute(sa.text("DELETE FROM item WHERE classroom_id IS NULL"))

    # Drop M2M table.
    op.drop_table("item_classroom")

    # Swap unique constraint.
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

    op.alter_column("item", "classroom_id", nullable=False)


def downgrade() -> None:
    # Recreate the M2M table; reverse-backfill from item.classroom_id.
    op.create_table(
        "item_classroom",
        sa.Column(
            "item_id",
            sa.dialects.postgresql.UUID(as_uuid=True),
            sa.ForeignKey("item.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column(
            "classroom_id",
            sa.dialects.postgresql.UUID(as_uuid=True),
            sa.ForeignKey("classroom.id", ondelete="CASCADE"),
            primary_key=True,
        ),
    )
    bind = op.get_bind()
    bind.execute(
        sa.text(
            "INSERT INTO item_classroom (item_id, classroom_id) "
            "SELECT id, classroom_id FROM item"
        )
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
