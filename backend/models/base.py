"""SQLAlchemy declarative base + reusable mixins."""
from datetime import datetime
from uuid import UUID

from sqlalchemy import DateTime, text
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class Base(DeclarativeBase):
    """Shared base for all ORM models."""
    pass


class TimestampMixin:
    """Adds created_at / updated_at columns set by Postgres."""

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=text("now()"),
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=text("now()"),
        onupdate=text("now()"),
    )


class UserScopedMixin:
    """Adds user_id (Supabase auth.users.id; no FK due to cross-schema)."""

    user_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        nullable=False,
        index=True,
    )
