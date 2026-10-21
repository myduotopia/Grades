"""Normalise existing student emails (#261).

Student login binding matches the Google account email against
`student.email`. New input is normalised by `email_validation.clean_email`
(trim + lowercase, blank → NULL); this brings rows written before that helper
existed into the same shape so the match is exact.

Idempotent: re-running changes nothing (lower(trim(x)) is a fixed point).

Downgrade is intentionally a no-op: the original casing / surrounding
whitespace is not recoverable and carries no meaning — emails are
case-insensitive in practice — so there is no schema to revert.
"""
from typing import Sequence, Union

from alembic import op


revision: str = 'r1m2n3o4p5q6'
down_revision: Union[str, Sequence[str], None] = 'q0l1m2n3o4p5'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(
        "UPDATE student SET email = NULLIF(lower(btrim(email)), '') "
        "WHERE email IS NOT NULL "
        "AND email IS DISTINCT FROM NULLIF(lower(btrim(email)), '')"
    )


def downgrade() -> None:
    # Data-only normalisation; nothing structural to undo (see docstring).
    pass
