"""Per-user application settings (one row per user_id).

Lives in `public` schema. The user identity itself is owned by Supabase
(`auth.users`); this table stores app-level preferences keyed by that UUID.
"""
from datetime import datetime
from uuid import UUID

from sqlalchemy import CheckConstraint, DateTime, text
from sqlalchemy.dialects.postgresql import JSONB, UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column

from models.base import Base, TimestampMixin


class UserSettings(Base, TimestampMixin):
    __tablename__ = "user_settings"

    user_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        primary_key=True,
    )
    # How many terms make up one academic year (2 = 上/下, 3, or 4).
    terms_per_year: Mapped[int] = mapped_column(
        nullable=False, server_default=text("2")
    )
    # Teacher-chosen display order for subjects on /admin/subjects. List of
    # subject UUIDs (as strings). The 5 academic built-ins are always pinned
    # to the top in fixed order by the frontend; this list only governs the
    # order of every OTHER subject (non-academic built-ins + custom).
    subject_order: Mapped[list] = mapped_column(
        JSONB, nullable=False, server_default=text("'[]'::jsonb")
    )
    # Teacher-chosen display order for items on /admin/items. List of item
    # UUIDs (as strings). Items not in the list fall back to created_at desc
    # on the frontend.
    item_order: Mapped[list] = mapped_column(
        JSONB, nullable=False, server_default=text("'[]'::jsonb")
    )
    # Manual-point reasons (#84). Each entry is
    # `{id: str, name: str, default_points: int}` — the id is teacher-local
    # so that the UI can reorder / delete / edit rows; PointRecord.reason
    # still stores the human name at write time.
    point_reasons: Mapped[list] = mapped_column(
        JSONB, nullable=False, server_default=text("'[]'::jsonb")
    )
    # Last time the teacher opened the home Alerts page (issue #161). The
    # alert badge counts only 0-score grades updated after this moment so
    # already-acknowledged 0s don't keep flashing — newly-entered or
    # newly-flipped-to-0 grades do. NULL = never visited.
    alerts_last_viewed_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    __table_args__ = (
        CheckConstraint(
            "terms_per_year IN (2, 3, 4)",
            name="ck_user_settings_terms_per_year",
        ),
    )
