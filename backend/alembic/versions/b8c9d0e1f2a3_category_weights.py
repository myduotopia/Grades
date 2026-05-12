"""category weights + attendance/extra keys

Revision ID: b8c9d0e1f2a3
Revises: a7b8c9d0e1f2
Create Date: 2026-05-12 12:00:00.000000

Issue #6.

- Add `weight` SmallInt to category (0..100), CHECK enforced.
- Backfill existing rows: major_exam=50 / quiz=20 / homework=20.
- For every existing user_id, insert two new categories: attendance (10), extra (0).
  Sum of non-extra weights = 100 by construction.
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = 'b8c9d0e1f2a3'
down_revision: Union[str, Sequence[str], None] = 'a7b8c9d0e1f2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


_DEFAULTS = (
    ('major_exam', 50),
    ('quiz', 20),
    ('homework', 20),
    ('attendance', 10),
    ('extra', 0),
)
_NEW_KEYS = ('attendance', 'extra')


def upgrade() -> None:
    # 1. Add nullable so existing rows survive
    op.add_column('category', sa.Column('weight', sa.SmallInteger(), nullable=True))

    # 2. Backfill existing 3 system_keys to their defaults
    for key, weight in _DEFAULTS:
        if key in _NEW_KEYS:
            continue
        op.execute(
            sa.text("UPDATE category SET weight = :w WHERE system_key = :k").bindparams(
                w=weight, k=key
            )
        )

    # 3. For every existing user that has at least one category, insert the
    #    two new keys with their defaults. ON CONFLICT keeps the migration
    #    idempotent if it's ever re-run partially.
    for key in _NEW_KEYS:
        weight = dict(_DEFAULTS)[key]
        op.execute(
            sa.text(
                """
                INSERT INTO category (id, user_id, system_key, weight, created_at, updated_at)
                SELECT gen_random_uuid(), user_id, :k, :w, now(), now()
                FROM (SELECT DISTINCT user_id FROM category) AS u
                ON CONFLICT ON CONSTRAINT uq_category_user_system_key DO NOTHING
                """
            ).bindparams(k=key, w=weight)
        )

    # 4. Lock: NOT NULL + range CHECK
    op.alter_column('category', 'weight', nullable=False)
    op.create_check_constraint(
        'ck_category_weight_range', 'category', 'weight BETWEEN 0 AND 100'
    )


def downgrade() -> None:
    op.drop_constraint('ck_category_weight_range', 'category', type_='check')
    op.execute(
        "DELETE FROM category WHERE system_key IN ('attendance', 'extra')"
    )
    op.drop_column('category', 'weight')
