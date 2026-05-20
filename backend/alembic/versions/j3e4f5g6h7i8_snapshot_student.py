"""Create snapshot_student frozen-roster table (issue #123).

Revision ID: j3e4f5g6h7i8
Revises: i2d3e4f5g6h7
Create Date: 2026-05-21 15:30:00.000000

Snapshots need to remember "who was student #1 the day we archived". The
live `student` table moves on (transfers in/out, seat reassignments,
renames), so the snapshot's roster has to be frozen out into its own
table. Grade rows still FK to `student.id` so we can link historic
scores back to the same person; only the seat label + name shown in the
snapshot view come from this frozen table.

Backfill assumption: any pre-existing snapshot's frozen roster is taken
from the *current* student list of its classroom (best approximation;
there was no history before).
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = 'j3e4f5g6h7i8'
down_revision: Union[str, Sequence[str], None] = 'i2d3e4f5g6h7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'snapshot_student',
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
            sa.ForeignKey('student.id', ondelete='RESTRICT'),
            nullable=False,
        ),
        sa.Column('seat_number', sa.Integer(), nullable=False),
        sa.Column('name', sa.String(100), nullable=True),
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
            'snapshot_id', 'student_id', name='uq_snapshot_student'
        ),
    )
    op.create_index(
        'ix_snapshot_student_snapshot',
        'snapshot_student',
        ['snapshot_id'],
    )

    # Backfill: any snapshot that already exists gets its frozen roster
    # populated from the classroom's current students.
    op.execute("""
        INSERT INTO snapshot_student
            (id, user_id, snapshot_id, student_id, seat_number, name,
             created_at, updated_at)
        SELECT
            gen_random_uuid(),
            gs.user_id,
            gs.id,
            s.id,
            s.seat_number,
            s.name,
            now(),
            now()
        FROM grade_snapshot gs
        JOIN student s ON s.classroom_id = gs.classroom_id
        ON CONFLICT (snapshot_id, student_id) DO NOTHING;
    """)


def downgrade() -> None:
    op.drop_index('ix_snapshot_student_snapshot', table_name='snapshot_student')
    op.drop_table('snapshot_student')
