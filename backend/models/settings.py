"""Per-user application settings (one row per user_id).

Lives in `public` schema. The user identity itself is owned by Supabase
(`auth.users`); this table stores app-level preferences keyed by that UUID.
"""
from uuid import UUID

from sqlalchemy import CheckConstraint, text
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

    __table_args__ = (
        CheckConstraint(
            "terms_per_year IN (2, 3, 4)",
            name="ck_user_settings_terms_per_year",
        ),
    )
