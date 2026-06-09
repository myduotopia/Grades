"""Make student.name nullable to match the rest of the stack (#187).

Revision ID: o8j9k0l1m2n3
Revises: n7i8j9k0l1m2
Create Date: 2026-06-09 12:00:00.000000

The DB column was NOT NULL, but the import template (姓名（選填）), the API
schemas (StudentCreate/Update/Out all `str | None`), the import parser, and the
frontend (`name: string | null`, rendered `|| '—'`) all treat the name as
optional. Importing a roster with any blank name produced Student(name=None) →
IntegrityError, which escaped CORSMiddleware and surfaced as a misleading CORS
error on the write step. Dropping NOT NULL aligns the DB with everything else.

downgrade() restores NOT NULL; it will fail if any student row has a null name
by then — that is expected (the data must be backfilled first).
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = 'o8j9k0l1m2n3'
down_revision: Union[str, Sequence[str], None] = 'n7i8j9k0l1m2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.alter_column(
        'student',
        'name',
        existing_type=sa.String(length=200),
        nullable=True,
    )


def downgrade() -> None:
    op.alter_column(
        'student',
        'name',
        existing_type=sa.String(length=200),
        nullable=False,
    )
