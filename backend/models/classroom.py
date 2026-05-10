"""Classroom + Student.

`classroom` table is what `class` would be in the original spec — renamed
to avoid the SQL keyword and Python `class` collision.
"""
from typing import TYPE_CHECKING
from uuid import UUID

from sqlalchemy import (
    CheckConstraint,
    ForeignKey,
    SmallInteger,
    String,
    UniqueConstraint,
    text,
)
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from models.base import Base, TimestampMixin, UserScopedMixin

if TYPE_CHECKING:
    from models.access import AccountLink
    from models.curriculum import Item
    from models.grading import Grade, PointRecord, StudentStandard


SOURCE_VALUES = ("manual", "duotopia", "google_classroom")


class Classroom(Base, UserScopedMixin, TimestampMixin):
    __tablename__ = "classroom"

    id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        primary_key=True,
        server_default=text("gen_random_uuid()"),
    )
    grade: Mapped[int] = mapped_column(SmallInteger, nullable=False)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    source: Mapped[str] = mapped_column(String(32), nullable=False, default="manual")
    source_external_id: Mapped[str | None] = mapped_column(String(255), nullable=True)

    students: Mapped[list["Student"]] = relationship(
        back_populates="classroom",
        cascade="all, delete-orphan",
    )
    items: Mapped[list["Item"]] = relationship(
        secondary="item_classroom",
        back_populates="classrooms",
    )

    __table_args__ = (
        UniqueConstraint(
            "user_id", "grade", "name", name="uq_classroom_user_grade_name"
        ),
        CheckConstraint(
            f"source IN {SOURCE_VALUES!r}".replace("'", "'"),
            name="ck_classroom_source",
        ),
        CheckConstraint("grade BETWEEN 1 AND 12", name="ck_classroom_grade_range"),
    )


class Student(Base, UserScopedMixin, TimestampMixin):
    __tablename__ = "student"

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
    seat_number: Mapped[int] = mapped_column(nullable=False)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    # Optional Google account email — used as the Supabase invite target and
    # the matching key when a student/parent first authenticates.
    email: Mapped[str | None] = mapped_column(String(255), nullable=True, index=True)
    source: Mapped[str] = mapped_column(String(32), nullable=False, default="manual")
    source_external_id: Mapped[str | None] = mapped_column(String(255), nullable=True)

    classroom: Mapped["Classroom"] = relationship(back_populates="students")
    grades: Mapped[list["Grade"]] = relationship(
        back_populates="student",
        cascade="all, delete-orphan",
    )
    standards: Mapped[list["StudentStandard"]] = relationship(
        back_populates="student",
        cascade="all, delete-orphan",
    )
    point_records: Mapped[list["PointRecord"]] = relationship(
        back_populates="student",
        cascade="all, delete-orphan",
    )
    account_links: Mapped[list["AccountLink"]] = relationship(
        back_populates="student",
        cascade="all, delete-orphan",
    )

    __table_args__ = (
        UniqueConstraint(
            "user_id", "classroom_id", "seat_number",
            name="uq_student_user_classroom_seat",
        ),
        CheckConstraint(
            f"source IN {SOURCE_VALUES!r}".replace("'", "'"),
            name="ck_student_source",
        ),
    )
