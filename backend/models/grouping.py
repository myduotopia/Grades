"""Student groups within a classroom (#237).

A teacher splits a class into small groups (第一組, 第二組, ...) for
competitions, bonus points, or cleaning duty. A class can hold several
independent groupings at once (e.g. an English grouping and a cleaning
grouping), so a student may belong to more than one group — there is
deliberately no uniqueness constraint on (classroom, student).
"""
from typing import TYPE_CHECKING
from uuid import UUID

from sqlalchemy import ForeignKey, Integer, String, UniqueConstraint, text
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from models.base import Base, TimestampMixin, UserScopedMixin

if TYPE_CHECKING:
    from models.classroom import Student


# Palette keys, not hex — the frontend maps these to fixed Tailwind classes.
GROUP_COLOR_VALUES = ("amber", "rose", "sky", "emerald", "violet", "slate")


class StudentGroup(Base, UserScopedMixin, TimestampMixin):
    __tablename__ = "student_group"

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
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    color: Mapped[str | None] = mapped_column(String(20), nullable=True)
    # SET NULL rather than CASCADE: losing the leader must not delete the group.
    leader_student_id: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("student.id", ondelete="SET NULL"),
        nullable=True,
    )
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    members: Mapped[list["StudentGroupMember"]] = relationship(
        back_populates="group",
        cascade="all, delete-orphan",
        order_by="StudentGroupMember.sort_order",
    )

    __table_args__ = (
        UniqueConstraint(
            "user_id", "classroom_id", "name", name="uq_group_user_classroom_name"
        ),
    )


class StudentGroupMember(Base, UserScopedMixin, TimestampMixin):
    __tablename__ = "student_group_member"

    id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        primary_key=True,
        server_default=text("gen_random_uuid()"),
    )
    group_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("student_group.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    student_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("student.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    group: Mapped["StudentGroup"] = relationship(back_populates="members")
    student: Mapped["Student"] = relationship()

    __table_args__ = (
        UniqueConstraint("group_id", "student_id", name="uq_group_member"),
    )
