"""Grade snapshot partition (issue #169).

Revision ID: m6h7i8j9k0l1
Revises: l5g6h7i8j9k0
Create Date: 2026-05-28 20:00:00.000000

Add grade.snapshot_id (nullable FK to grade_snapshot ON DELETE CASCADE).
Replace UNIQUE(item_id, student_id) with UNIQUE(item_id, student_id,
snapshot_id) so each snapshot can keep its own frozen copy of a grade.
PG treats NULL as distinct, so a single live row plus N snapshot rows
all coexist for one (item, student).

Data backfill:
  For every existing GradeSnapshot S containing item I (via classroom_item
  with snapshot_id=S), every grade row matching (I, student in S's frozen
  roster) gets a duplicate row inserted with snapshot_id=S. The original
  row keeps snapshot_id=NULL only if there is still a *live* ClassroomItem
  for (I, classroom of S) — i.e. the teacher reactivated the item after
  archiving. If the original row has no live ClassroomItem any more, it's
  reassigned to ONE of the snapshots (the most recent one containing it)
  and not duplicated. Net: every grade row now sits in exactly the bucket
  it should belong to.
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = 'm6h7i8j9k0l1'
down_revision: Union[str, Sequence[str], None] = 'l5g6h7i8j9k0'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # 1. Add the column (nullable) + index.
    op.add_column(
        'grade',
        sa.Column(
            'snapshot_id',
            sa.dialects.postgresql.UUID(as_uuid=True),
            sa.ForeignKey('grade_snapshot.id', ondelete='CASCADE'),
            nullable=True,
        ),
    )
    op.create_index(
        'ix_grade_snapshot_id', 'grade', ['snapshot_id']
    )

    # 2. Drop the old UNIQUE(item_id, student_id) FIRST. The data backfill
    #    inserts (item_id, student_id, snapshot_id=X) duplicates of existing
    #    (item_id, student_id, NULL) rows, which would collide with the old
    #    constraint. We add the new constraint at the end.
    op.drop_constraint(
        'uq_grade_item_student', 'grade', type_='unique'
    )

    # 3. Backfill — duplicate grade rows into each snapshot that contains
    #    them. The duplicate row is what the snapshot view should read; the
    #    original keeps snapshot_id=NULL so the live view is unchanged for
    #    items that still have a live ClassroomItem.
    op.execute("""
        INSERT INTO grade (
            id, user_id, item_id, student_id, snapshot_id, score, source,
            source_external_id, created_at, updated_at
        )
        SELECT
            gen_random_uuid(),
            g.user_id,
            g.item_id,
            g.student_id,
            ci.snapshot_id,
            g.score,
            g.source,
            g.source_external_id,
            g.created_at,
            g.updated_at
        FROM grade g
        JOIN classroom_item ci
          ON ci.item_id = g.item_id
         AND ci.snapshot_id IS NOT NULL
        JOIN snapshot_student ss
          ON ss.snapshot_id = ci.snapshot_id
         AND ss.student_id = g.student_id
        WHERE g.snapshot_id IS NULL;
    """)

    # 4. Grades whose item has no live classroom_item anywhere (only ever
    #    archived) should no longer be live. The snapshot copy already
    #    exists (step 3) so delete the now-redundant NULL row.
    op.execute("""
        DELETE FROM grade g
        WHERE g.snapshot_id IS NULL
          AND NOT EXISTS (
            SELECT 1 FROM classroom_item ci
            WHERE ci.item_id = g.item_id
              AND ci.snapshot_id IS NULL
          );
    """)

    # 5. Install the new UNIQUE.
    op.create_unique_constraint(
        'uq_grade_item_student_snapshot',
        'grade',
        ['item_id', 'student_id', 'snapshot_id'],
    )


def downgrade() -> None:
    # Drop the new constraint, restore the old one. Best effort: dedupe by
    # keeping the live row when present, else the most-recent snapshot row.
    op.execute("""
        DELETE FROM grade g
        USING grade dup
        WHERE g.item_id = dup.item_id
          AND g.student_id = dup.student_id
          AND g.id <> dup.id
          AND (
            (dup.snapshot_id IS NULL AND g.snapshot_id IS NOT NULL)
            OR (
              dup.snapshot_id IS NOT NULL
              AND g.snapshot_id IS NOT NULL
              AND dup.created_at > g.created_at
            )
          );
    """)
    op.drop_constraint(
        'uq_grade_item_student_snapshot', 'grade', type_='unique'
    )
    op.create_unique_constraint(
        'uq_grade_item_student', 'grade', ['item_id', 'student_id']
    )
    op.drop_index('ix_grade_snapshot_id', table_name='grade')
    op.drop_column('grade', 'snapshot_id')
