"""subject_category_weight table

Revision ID: c9d0e1f2a3b4
Revises: b8c9d0e1f2a3
Create Date: 2026-05-14 12:00:00.000000

Per-subject category weights. Each row = one (user, subject, category) → weight.
Replaces the single Category.weight as the source of truth for grade weighting;
Category.weight stays as the default template for new subjects.

For every existing (user × built-in subject × user-category) combination we
backfill weights using the profile defined in models/curriculum.py:
  - academic profile (chinese/math/english/science/social_studies/integrated):
    major_exam=50, quiz=20, homework=20, attendance=10, extra=0
  - arts/PE profile (music/art/pe):
    major_exam=0, quiz=0, homework=60, attendance=40, extra=0
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = 'c9d0e1f2a3b4'
down_revision: Union[str, Sequence[str], None] = 'b8c9d0e1f2a3'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


_ACADEMIC = {
    "major_exam": 50,
    "quiz": 20,
    "homework": 20,
    "attendance": 10,
    "extra": 0,
}
_ARTS_PE = {
    "major_exam": 0,
    "quiz": 0,
    "homework": 60,
    "attendance": 40,
    "extra": 0,
}
_PROFILES = {
    "chinese": _ACADEMIC,
    "math": _ACADEMIC,
    "english": _ACADEMIC,
    "science": _ACADEMIC,
    "social_studies": _ACADEMIC,
    "integrated": _ACADEMIC,
    "music": _ARTS_PE,
    "art": _ARTS_PE,
    "pe": _ARTS_PE,
}


def upgrade() -> None:
    op.create_table(
        "subject_category_weight",
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
            "category_id",
            sa.dialects.postgresql.UUID(as_uuid=True),
            sa.ForeignKey("category.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column("weight", sa.Integer(), nullable=False),
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
            "user_id", "subject_id", "category_id",
            name="uq_scw_user_subject_category",
        ),
        sa.CheckConstraint(
            "weight BETWEEN 0 AND 100", name="ck_scw_weight_range",
        ),
    )

    # Backfill for every existing user using the per-subject profile.
    bind = op.get_bind()
    for system_key, profile in _PROFILES.items():
        for cat_key, weight in profile.items():
            bind.execute(
                sa.text(
                    """
                    INSERT INTO subject_category_weight
                        (user_id, subject_id, category_id, weight)
                    SELECT c.user_id, s.id, c.id, :weight
                    FROM category c
                    JOIN subject s
                      ON s.system_key = :sub_key AND s.user_id IS NULL
                    WHERE c.system_key = :cat_key
                    ON CONFLICT (user_id, subject_id, category_id) DO NOTHING
                    """
                ),
                {"sub_key": system_key, "cat_key": cat_key, "weight": weight},
            )


def downgrade() -> None:
    op.drop_table("subject_category_weight")
