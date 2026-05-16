"""Add semester.start_date / end_date (NOT NULL, backfilled from terms_per_year)

Revision ID: d2f3a4b5c6d7
Revises: d1e2f3a4b5c6
Create Date: 2026-05-14 13:00:00.000000

Issue #5 follow-up.

Adds an inclusive date range to every Semester row. Backfills existing rows
by computing the Taiwan-academic-year window per user's terms_per_year
(default 2 if no user_settings row exists yet).
"""
from datetime import date, timedelta
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = 'd2f3a4b5c6d7'
down_revision: Union[str, Sequence[str], None] = 'd1e2f3a4b5c6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _default_dates(
    academic_year_minguo: int, term: int, terms_per_year: int
) -> tuple[date, date]:
    """Mirror of models.curriculum.default_semester_dates (kept inline so the
    migration is self-contained and survives future model refactors)."""
    gregorian_start = academic_year_minguo + 1911
    months_per_term = 12 // terms_per_year
    start_idx = (term - 1) * months_per_term
    end_idx = start_idx + months_per_term - 1

    def resolve(idx: int) -> tuple[int, int]:
        month = ((idx + 7) % 12) + 1
        year = gregorian_start + (1 if idx >= 5 else 0)
        return year, month

    sy, sm = resolve(start_idx)
    ey, em = resolve(end_idx)
    start = date(sy, sm, 1)
    nxt = date(ey + 1, 1, 1) if em == 12 else date(ey, em + 1, 1)
    return start, nxt - timedelta(days=1)


def upgrade() -> None:
    # 1. Add nullable columns so existing rows survive.
    op.add_column('semester', sa.Column('start_date', sa.Date(), nullable=True))
    op.add_column('semester', sa.Column('end_date', sa.Date(), nullable=True))

    # 2. Backfill: load every (id, user_id, academic_year, term) row, look up
    #    the user's terms_per_year (default 2), and compute defaults.
    bind = op.get_bind()
    rows = bind.execute(
        sa.text(
            "SELECT id, user_id, academic_year, term FROM semester"
        )
    ).fetchall()
    for row in rows:
        terms_per_year = bind.execute(
            sa.text(
                "SELECT terms_per_year FROM user_settings WHERE user_id = :uid"
            ),
            {"uid": row.user_id},
        ).scalar()
        if terms_per_year is None:
            terms_per_year = 2
        # Clamp term in case data already has a value > terms_per_year
        # (theoretically possible if a user lowered terms_per_year after
        # creating semesters — backfill should still produce a sane window).
        effective_term = min(row.term, terms_per_year)
        start, end = _default_dates(row.academic_year, effective_term, terms_per_year)
        bind.execute(
            sa.text(
                "UPDATE semester SET start_date = :s, end_date = :e WHERE id = :id"
            ),
            {"s": start, "e": end, "id": row.id},
        )

    # 3. Lock: NOT NULL + chronological CHECK.
    op.alter_column('semester', 'start_date', nullable=False)
    op.alter_column('semester', 'end_date', nullable=False)
    op.create_check_constraint(
        'ck_semester_date_order', 'semester', 'start_date <= end_date'
    )


def downgrade() -> None:
    op.drop_constraint('ck_semester_date_order', 'semester', type_='check')
    op.drop_column('semester', 'end_date')
    op.drop_column('semester', 'start_date')
