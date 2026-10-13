"""One live grade per item x student (#264).

`uq_grade_item_student_snapshot (item_id, student_id, snapshot_id)` never
protected the live bucket: snapshot_id is NULL there and Postgres treats
NULLs as distinct, so two concurrent saves of the same cell could leave two
live rows — after which every `.one_or_none()` read of that cell raised
MultipleResultsFound (500) and the cell could never be saved again.

Upgrade:
1. Merge existing duplicate live rows, keeping the most recently updated
   one per (item_id, student_id) (ties: newest created_at, then highest id).
   If the kept row has no point_record but a removed duplicate does, that
   point_record is moved onto the kept row first so awarded points aren't
   silently lost (the next save of the cell re-evaluates it as usual).
   Other point_records of removed rows go with them (FK ON DELETE CASCADE).
2. CREATE UNIQUE INDEX uq_grade_live_item_student
   ON grade (item_id, student_id) WHERE snapshot_id IS NULL.
   Writers now INSERT ... ON CONFLICT DO NOTHING against it and re-read.

Both steps are idempotent (re-running finds no duplicates).

Downgrade drops the index only. **The merge in step 1 cannot be undone**:
the removed duplicate rows (and any point_records that cascaded with them)
are gone; downgrade does not try to recreate them — they were exactly the
corrupt state this migration exists to fix.
"""
from typing import Sequence, Union

from alembic import op


revision: str = 'u4p5q6r7s8t9'
down_revision: Union[str, Sequence[str], None] = 't3o4p5q6r7s8'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


_RANKED = """
    SELECT id, item_id, student_id,
           row_number() OVER (
               PARTITION BY item_id, student_id
               ORDER BY updated_at DESC, created_at DESC, id DESC
           ) AS rn
    FROM grade
    WHERE snapshot_id IS NULL
"""


def upgrade() -> None:
    # 1a. Keep awarded points: move one duplicate's point_record onto the
    #     kept row when the kept row has none.
    op.execute(f"""
        WITH ranked AS ({_RANKED}),
        keep AS (
            SELECT item_id, student_id, id AS keep_id FROM ranked WHERE rn = 1
        ),
        moves AS (
            SELECT DISTINCT ON (k.keep_id) pr.id AS pr_id, k.keep_id
            FROM ranked r
            JOIN keep k ON k.item_id = r.item_id AND k.student_id = r.student_id
            JOIN point_record pr ON pr.source_grade_id = r.id
            WHERE r.rn > 1
              AND NOT EXISTS (
                  SELECT 1 FROM point_record p2 WHERE p2.source_grade_id = k.keep_id
              )
            ORDER BY k.keep_id, r.rn
        )
        UPDATE point_record
        SET source_grade_id = moves.keep_id
        FROM moves
        WHERE point_record.id = moves.pr_id
    """)
    # 1b. Remove the older duplicates (their remaining point_records cascade).
    op.execute(f"""
        DELETE FROM grade g
        USING ({_RANKED}) d
        WHERE g.id = d.id AND d.rn > 1
    """)
    # 2. The constraint itself.
    op.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS uq_grade_live_item_student "
        "ON grade (item_id, student_id) WHERE snapshot_id IS NULL"
    )


def downgrade() -> None:
    # Only the index is removed; merged duplicates are NOT restored (see
    # the module docstring).
    op.execute("DROP INDEX IF EXISTS uq_grade_live_item_student")
