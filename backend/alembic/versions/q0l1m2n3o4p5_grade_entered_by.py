"""Grade "entered by" stamp (#260).

`grade.user_id` is the OWNING teacher, not whoever typed the score. Once
student assistants (小老師, #262) can enter scores, the UI must tell the two
apart, so every grade now records who last wrote it:

- `entered_by_user_id` — the auth user (JWT sub) of the last writer. Nullable:
  rows written by system paths without a user context stay NULL.
- `entered_by_role` — 'teacher' | 'assistant'. NOT NULL, server default
  'teacher', CHECK-constrained.

Backfill: every existing row was written by its owning teacher, so
`entered_by_user_id = user_id`. The UPDATE only touches NULL rows, so it is
safe to re-run (upgrade → downgrade → upgrade loses nothing: the columns are
dropped on downgrade and re-derived from `user_id` on the next upgrade).
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql


revision: str = 'q0l1m2n3o4p5'
down_revision: Union[str, Sequence[str], None] = 'p9k0l1m2n3o4'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        'grade',
        sa.Column('entered_by_user_id', postgresql.UUID(as_uuid=True), nullable=True),
    )
    op.add_column(
        'grade',
        sa.Column(
            'entered_by_role', sa.String(length=16),
            nullable=False, server_default='teacher',
        ),
    )
    op.create_check_constraint(
        'ck_grade_entered_by_role',
        'grade',
        "entered_by_role IN ('teacher', 'assistant')",
    )
    # Idempotent backfill: only rows not yet stamped.
    op.execute(
        "UPDATE grade SET entered_by_user_id = user_id "
        "WHERE entered_by_user_id IS NULL"
    )


def downgrade() -> None:
    op.drop_constraint('ck_grade_entered_by_role', 'grade', type_='check')
    op.drop_column('grade', 'entered_by_role')
    op.drop_column('grade', 'entered_by_user_id')
