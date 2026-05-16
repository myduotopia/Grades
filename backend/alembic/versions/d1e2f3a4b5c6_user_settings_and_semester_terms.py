"""user_settings table + relax semester.term check to 1..4

Revision ID: d1e2f3a4b5c6
Revises: c9d0e1f2a3b4
Create Date: 2026-05-14 12:00:00.000000

Issue #5.

- Add `user_settings` table (one row per user) with `terms_per_year` (2/3/4).
- Relax semester.term CHECK from `IN (1, 2)` to `BETWEEN 1 AND 4` so users on
  3- or 4-term-per-year settings can store terms 3 and 4.
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import UUID as PG_UUID

revision: str = 'd1e2f3a4b5c6'
down_revision: Union[str, Sequence[str], None] = 'c9d0e1f2a3b4'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'user_settings',
        sa.Column('user_id', PG_UUID(as_uuid=True), primary_key=True),
        sa.Column(
            'terms_per_year',
            sa.Integer(),
            nullable=False,
            server_default=sa.text('2'),
        ),
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
        sa.CheckConstraint(
            'terms_per_year IN (2, 3, 4)',
            name='ck_user_settings_terms_per_year',
        ),
    )

    op.drop_constraint('ck_semester_term', 'semester', type_='check')
    op.create_check_constraint(
        'ck_semester_term', 'semester', 'term BETWEEN 1 AND 4'
    )


def downgrade() -> None:
    op.drop_constraint('ck_semester_term', 'semester', type_='check')
    op.create_check_constraint(
        'ck_semester_term', 'semester', 'term IN (1, 2)'
    )
    op.drop_table('user_settings')
