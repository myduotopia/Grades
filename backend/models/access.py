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

from models.base import Base, UserScopedMixin

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


class ClassAssistant(Base, UserScopedMixin):
    """A student appointed 小老師 (student assistant) for their class (#262).

    `user_id` is the OWNING teacher (same as classroom.user_id /
    student.user_id). The student must have an email — that is how their
    Google sign-in is matched (see identity.py). Removing the row revokes
    the role; grades the assistant already entered keep their stamp.

    Authorisation also requires `student.classroom_id == classroom_id`, so a
    student transferred to another class stops being an assistant here (the
    router deletes the row on transfer as well).
    """
    __tablename__ = "class_assistant"

    id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        primary_key=True,
        server_default=text("gen_random_uuid()"),
    )
    classroom_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("classroom.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    student_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("student.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=text("now()"),
    )

    __table_args__ = (
        UniqueConstraint(
            "classroom_id", "student_id", name="uq_class_assistant_classroom_student"
        ),
    )


class ItemAssistant(Base, UserScopedMixin):
    """Which 小老師 may enter scores for which item (#262).

    Items are per-teacher and cross-classroom; an assistant may only write
    the item for students of THEIR OWN class, and only while the item is
    live in that class (classroom_item with snapshot_id NULL) in the
    teacher's current semester — archived (封存) items disappear from the
    assistant's view even though this row remains.
    """
    __tablename__ = "item_assistant"

    id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        primary_key=True,
        server_default=text("gen_random_uuid()"),
    )
    item_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("item.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    student_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("student.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=text("now()"),
    )

    __table_args__ = (
        UniqueConstraint("item_id", "student_id", name="uq_item_assistant_item_student"),
    )
