"""AccountLink — connects student roster entries to Supabase auth users.

A row in this table means: "this Supabase auth user is allowed to view this
student's data, in this relationship type." It backs the student-self and
parent-of-student access patterns. Teachers don't appear here — their access
comes from owning the student row directly (student.user_id).
"""
from datetime import datetime
from typing import TYPE_CHECKING
from uuid import UUID

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    String,
    UniqueConstraint,
    text,
)
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from models.base import Base

if TYPE_CHECKING:
    from models.classroom import Student


LINK_ROLE_VALUES = ("self", "parent")
LINKED_VIA_VALUES = ("email_invite", "manual", "invite_code")


class AccountLink(Base):
    __tablename__ = "account_link"

    id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        primary_key=True,
        server_default=text("gen_random_uuid()"),
    )
    student_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("student.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    auth_user_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        nullable=False,
        index=True,
    )
    # 'self' = the student themselves; 'parent' = parent of the student.
    # Named link_role (not "relationship") because that name shadows
    # SQLAlchemy's relationship() function inside the class scope.
    link_role: Mapped[str] = mapped_column(String(32), nullable=False)
    linked_via: Mapped[str] = mapped_column(String(32), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=text("now()"),
    )

    student: Mapped["Student"] = relationship(back_populates="account_links")

    __table_args__ = (
        UniqueConstraint(
            "student_id", "auth_user_id", "link_role",
            name="uq_account_link_student_user_role",
        ),
        # At most one self-link per student (a student row maps to at most one
        # human's auth account); parent links can be many.
        Index(
            "ix_account_link_one_self_per_student",
            "student_id",
            unique=True,
            postgresql_where=text("link_role = 'self'"),
        ),
        CheckConstraint(
            f"link_role IN {LINK_ROLE_VALUES!r}",
            name="ck_account_link_role",
        ),
        CheckConstraint(
            f"linked_via IN {LINKED_VIA_VALUES!r}",
            name="ck_account_link_linked_via",
        ),
    )
