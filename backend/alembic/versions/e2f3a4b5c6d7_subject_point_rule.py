"""subject_point_rule table

Revision ID: e2f3a4b5c6d7
Revises: d2f3a4b5c6d7
Create Date: 2026-05-17 10:00:00.000000

Per-subject points-awarded amount. Each row = one (user, subject) → integer
points (0..500). Replaces the per-category point_rule as the source of truth
for auto-award amount. Category gates which grades trigger an award (only
major_exam + quiz); subject decides how many points to award.

For every existing (user × built-in subject) combination we backfill a row
with points_awarded = 100 — same default as the legacy point_rule.
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = 'e2f3a4b5c6d7'
down_revision: Union[str, Sequence[str], None] = 'd2f3a4b5c6d7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "subject_point_rule",
        sa.Column(
            "id",
            sa.dialects.postgresql.UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column(
            "user_id",
            sa.dialects.postgresql.UUID(as_uuid=True),
            nullable=False,
            index=True,
        ),
        sa.Column(
            "subject_id",
            sa.dialects.postgresql.UUID(as_uuid=True),
            sa.ForeignKey("subject.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column(
            "points_awarded", sa.Integer(), nullable=False, server_default="100"
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.UniqueConstraint(
            "user_id", "subject_id", name="uq_subject_point_rule_user_subject"
        ),
        sa.CheckConstraint(
            "points_awarded BETWEEN 0 AND 500",
            name="ck_subject_point_rule_range",
        ),
    )

    # Backfill: one row per (user × built-in subject) with default 100.
    # We infer "users known to the system" from existing category rows
    # (every onboarded user has categories seeded).
    bind = op.get_bind()
    bind.execute(
        sa.text(
            """
            INSERT INTO subject_point_rule (user_id, subject_id, points_awarded)
            SELECT DISTINCT c.user_id, s.id, 100
            FROM category c
            CROSS JOIN subject s
            WHERE s.user_id IS NULL
              AND s.system_key IS NOT NULL
            ON CONFLICT (user_id, subject_id) DO NOTHING
            """
        )
    )

    # Also backfill any user-owned custom subjects.
    bind.execute(
        sa.text(
            """
            INSERT INTO subject_point_rule (user_id, subject_id, points_awarded)
            SELECT s.user_id, s.id, 100
            FROM subject s
            WHERE s.user_id IS NOT NULL
            ON CONFLICT (user_id, subject_id) DO NOTHING
            """
        )
    )


def downgrade() -> None:
    op.drop_table("subject_point_rule")
