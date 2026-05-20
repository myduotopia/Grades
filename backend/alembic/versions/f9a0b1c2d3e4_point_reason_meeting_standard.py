"""Backfill system point reason 達成標準 (meeting_standard) for all users.

Revision ID: f9a0b1c2d3e4
Revises: e8f9a0b1c2d3
Create Date: 2026-05-20 14:00:00.000000

Issue #113. Auto-award (apply_auto_award) writes PointRecord rows whose
`reason` text starts with the system reason name. We prepend a single
system row identified by `system_key="meeting_standard"` so every existing
user has the row before its first auto-award fires post-deploy.

Idempotent: skips users who already have the system_key.
"""
import json
import uuid
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = 'f9a0b1c2d3e4'
down_revision: Union[str, Sequence[str], None] = 'e8f9a0b1c2d3'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


SYSTEM_KEY = "meeting_standard"
SYSTEM_NAME = "達成標準"


def upgrade() -> None:
    bind = op.get_bind()
    rows = bind.execute(
        sa.text("SELECT user_id, point_reasons FROM user_settings")
    ).fetchall()
    for row in rows:
        reasons = row.point_reasons or []
        # JSONB comes back as already-parsed list[dict] under psycopg; if it's
        # a string (rare driver), parse it.
        if isinstance(reasons, str):
            reasons = json.loads(reasons)
        if any(
            isinstance(r, dict) and r.get("system_key") == SYSTEM_KEY
            for r in reasons
        ):
            continue
        new_entry = {
            "id": str(uuid.uuid4()),
            "name": SYSTEM_NAME,
            "default_points": 0,
            "system_key": SYSTEM_KEY,
        }
        updated = [new_entry] + list(reasons)
        bind.execute(
            sa.text(
                "UPDATE user_settings SET point_reasons = :v WHERE user_id = :uid"
            ),
            {"v": json.dumps(updated), "uid": row.user_id},
        )


def downgrade() -> None:
    bind = op.get_bind()
    rows = bind.execute(
        sa.text("SELECT user_id, point_reasons FROM user_settings")
    ).fetchall()
    for row in rows:
        reasons = row.point_reasons or []
        if isinstance(reasons, str):
            reasons = json.loads(reasons)
        filtered = [
            r for r in reasons
            if not (isinstance(r, dict) and r.get("system_key") == SYSTEM_KEY)
        ]
        if len(filtered) == len(reasons):
            continue
        bind.execute(
            sa.text(
                "UPDATE user_settings SET point_reasons = :v WHERE user_id = :uid"
            ),
            {"v": json.dumps(filtered), "uid": row.user_id},
        )
