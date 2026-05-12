"""subject/category i18n refactor

Revision ID: a7b8c9d0e1f2
Revises: f1a2b3c4d5e6
Create Date: 2026-05-12 10:00:00.000000

Issue #41.

Category:
  - drop `name` and `is_system_default`
  - keep only 3 system_keys (major_exam / quiz / homework); delete the 5 deprecated rows
  - swap UNIQUE(user_id, name) -> UNIQUE(user_id, system_key); make system_key NOT NULL

Subject:
  - user_id becomes nullable (NULL = global built-in shared by all users)
  - drop `name` column
  - add `system_key` (built-in label) and `display_name` (custom label)
  - CHECK: built-in row (user_id NULL, system_key set, display_name NULL)
           vs custom row (user_id set, system_key NULL, display_name set)
  - UNIQUE(system_key); UNIQUE(user_id, display_name)
  - seed 9 global rows

Existing data: pre-launch project, no production users — drop the deprecated rows
and any orphan custom subjects rather than building backfill logic.
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = 'a7b8c9d0e1f2'
down_revision: Union[str, Sequence[str], None] = 'f1a2b3c4d5e6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


SYSTEM_SUBJECT_KEYS = (
    "chinese", "math", "english", "science", "social_studies",
    "music", "art", "pe", "integrated",
)


def upgrade() -> None:
    # ---------- Category ----------
    # Delete deprecated system categories. Per data-model.md these had no
    # production users yet; any rows referencing them via item/point_rule/
    # student_standard would have been seeded by /seed for the owner only.
    op.execute(
        "DELETE FROM category WHERE system_key IN ("
        "'first_midterm','second_midterm','third_midterm','midterm','final'"
        ")"
    )

    op.drop_constraint('uq_category_user_name', 'category', type_='unique')
    op.drop_column('category', 'name')
    op.drop_column('category', 'is_system_default')
    op.alter_column('category', 'system_key', nullable=False)
    op.create_unique_constraint(
        'uq_category_user_system_key', 'category', ['user_id', 'system_key']
    )

    # ---------- Subject ----------
    # Pre-launch: no real subjects to preserve. Wipe item/grade tables that
    # depend on subject before restructuring (they are empty in practice).
    op.execute("DELETE FROM grade")
    op.execute("DELETE FROM item")
    op.execute("DELETE FROM subject")

    op.drop_constraint('uq_subject_user_name', 'subject', type_='unique')
    op.drop_column('subject', 'name')
    op.add_column(
        'subject', sa.Column('system_key', sa.String(length=50), nullable=True)
    )
    op.add_column(
        'subject', sa.Column('display_name', sa.String(length=100), nullable=True)
    )
    op.alter_column('subject', 'user_id', nullable=True)

    op.create_check_constraint(
        'ck_subject_builtin_xor_custom',
        'subject',
        "(user_id IS NULL AND system_key IS NOT NULL AND display_name IS NULL)"
        " OR (user_id IS NOT NULL AND system_key IS NULL AND display_name IS NOT NULL)",
    )
    op.create_unique_constraint(
        'uq_subject_system_key', 'subject', ['system_key']
    )
    op.create_unique_constraint(
        'uq_subject_user_display_name', 'subject', ['user_id', 'display_name']
    )

    # Seed 9 global built-ins
    subject_t = sa.table(
        'subject',
        sa.column('user_id', sa.dialects.postgresql.UUID(as_uuid=True)),
        sa.column('system_key', sa.String),
        sa.column('display_name', sa.String),
    )
    op.bulk_insert(
        subject_t,
        [
            {"user_id": None, "system_key": key, "display_name": None}
            for key in SYSTEM_SUBJECT_KEYS
        ],
    )


def downgrade() -> None:
    # ---------- Subject ----------
    op.execute("DELETE FROM grade")
    op.execute("DELETE FROM item")
    op.execute("DELETE FROM subject")

    op.drop_constraint('uq_subject_user_display_name', 'subject', type_='unique')
    op.drop_constraint('uq_subject_system_key', 'subject', type_='unique')
    op.drop_constraint('ck_subject_builtin_xor_custom', 'subject', type_='check')
    op.alter_column('subject', 'user_id', nullable=False)
    op.drop_column('subject', 'display_name')
    op.drop_column('subject', 'system_key')
    op.add_column(
        'subject', sa.Column('name', sa.String(length=100), nullable=False)
    )
    op.create_unique_constraint(
        'uq_subject_user_name', 'subject', ['user_id', 'name']
    )

    # ---------- Category ----------
    op.drop_constraint('uq_category_user_system_key', 'category', type_='unique')
    op.alter_column('category', 'system_key', nullable=True)
    op.add_column(
        'category',
        sa.Column(
            'is_system_default',
            sa.Boolean(),
            nullable=False,
            server_default=sa.text('false'),
        ),
    )
    op.add_column(
        'category', sa.Column('name', sa.String(length=100), nullable=False)
    )
    op.create_unique_constraint(
        'uq_category_user_name', 'category', ['user_id', 'name']
    )
