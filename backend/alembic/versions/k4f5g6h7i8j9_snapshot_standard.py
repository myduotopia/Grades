"""Create snapshot_standard table to freeze thresholds per snapshot (#160).

Revision ID: k4f5g6h7i8j9
Revises: j3e4f5g6h7i8
Create Date: 2026-05-28 10:00:00.000000

Standards (per-student × per-subject thresholds) used to be live-only. An
archived snapshot would always read the *current* threshold, so adjusting
a threshold in the live view silently changed what the snapshot looked
like. Issue #160 freezes thresholds at archive time and lets teachers
edit the snapshot's frozen copy + recompute points against it.

Backfill: existing snapshots have no frozen thresholds, so populate them
from the *current* `student_standard` rows for each snapshot's frozen
roster (snapshot_student). Best approximation — there's no history.
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = 'k4f5g6h7i8j9'
down_revision: Union[str, Sequence[str], None] = 'j3e4f5g6h7i8'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'snapshot_standard',
        sa.Column(
            'id',
            sa.dialects.postgresql.UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text('gen_random_uuid()'),
        ),
        sa.Column(
            'user_id',
            sa.dialects.postgresql.UUID(as_uuid=True),
            nullable=False,
        ),
        sa.Column(
            'snapshot_id',
            sa.dialects.postgresql.UUID(as_uuid=True),
            sa.ForeignKey('grade_snapshot.id', ondelete='CASCADE'),
            nullable=False,
        ),
        sa.Column(
            'student_id',
            sa.dialects.postgresql.UUID(as_uuid=True),
            sa.ForeignKey('student.id', ondelete='CASCADE'),
            nullable=False,
        ),
        sa.Column(
            'subject_id',
            sa.dialects.postgresql.UUID(as_uuid=True),
            sa.ForeignKey('subject.id', ondelete='CASCADE'),
            nullable=False,
        ),
        sa.Column('threshold', sa.Numeric(4, 1), nullable=False),
        sa.Column(
            'created_at',
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text('now()'),
        ),
        sa.Column(
            'updated_at',
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text('now()'),
        ),
        sa.UniqueConstraint(
            'snapshot_id', 'student_id', 'subject_id',
            name='uq_snapshot_standard',
        ),
        sa.CheckConstraint(
            'threshold >= 0 AND threshold <= 100',
            name='ck_snapshot_standard_threshold_range',
        ),
    )
    op.create_index(
        'ix_snapshot_standard_snapshot',
        'snapshot_standard',
        ['snapshot_id'],
    )
    op.create_index(
        'ix_snapshot_standard_student',
        'snapshot_standard',
        ['student_id'],
    )
    op.create_index(
        'ix_snapshot_standard_subject',
        'snapshot_standard',
        ['subject_id'],
    )

    # Backfill: every existing snapshot gets its frozen roster's current
    # live thresholds copied in.
    op.execute("""
        INSERT INTO snapshot_standard
            (id, user_id, snapshot_id, student_id, subject_id, threshold,
             created_at, updated_at)
        SELECT
            gen_random_uuid(),
            ss.user_id,
            ss.snapshot_id,
            ss.student_id,
            st.subject_id,
            st.threshold,
            now(),
            now()
        FROM snapshot_student ss
        JOIN student_standard st ON st.student_id = ss.student_id
        ON CONFLICT (snapshot_id, student_id, subject_id) DO NOTHING;
    """)


def downgrade() -> None:
    op.drop_index(
        'ix_snapshot_standard_subject', table_name='snapshot_standard'
    )
    op.drop_index(
        'ix_snapshot_standard_student', table_name='snapshot_standard'
    )
    op.drop_index(
        'ix_snapshot_standard_snapshot', table_name='snapshot_standard'
    )
    op.drop_table('snapshot_standard')
