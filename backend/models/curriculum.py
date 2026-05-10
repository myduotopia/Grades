"""Subject, Category, Semester, Item, item_classroom (M2M)."""
from typing import TYPE_CHECKING
from uuid import UUID

from sqlalchemy import (
    CheckConstraint,
    Column,
    ForeignKey,
    Index,
    String,
    Table,
    UniqueConstraint,
    text,
)
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from models.base import Base, TimestampMixin, UserScopedMixin

if TYPE_CHECKING:
    from models.classroom import Classroom
    from models.grading import Grade, PointRule, StudentStandard


# 8 system-default category keys (seeded per user on signup).
# Users cannot add custom categories in v1 — keep this list stable.
SYSTEM_CATEGORY_KEYS = (
    "first_midterm",
    "second_midterm",
    "third_midterm",
    "midterm",
    "final",
    "major_exam",
    "quiz",
    "homework",
)


class Subject(Base, UserScopedMixin, TimestampMixin):
    __tablename__ = "subject"

    id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        primary_key=True,
        server_default=text("gen_random_uuid()"),
    )
    name: Mapped[str] = mapped_column(String(100), nullable=False)

    __table_args__ = (
        UniqueConstraint("user_id", "name", name="uq_subject_user_name"),
    )


class Category(Base, UserScopedMixin, TimestampMixin):
    __tablename__ = "category"

    id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        primary_key=True,
        server_default=text("gen_random_uuid()"),
    )
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    system_key: Mapped[str | None] = mapped_column(String(50), nullable=True)
    is_system_default: Mapped[bool] = mapped_column(
        nullable=False, server_default=text("false")
    )

    standards: Mapped[list["StudentStandard"]] = relationship(
        back_populates="category"
    )
    point_rule: Mapped["PointRule | None"] = relationship(
        back_populates="category", uselist=False
    )

    __table_args__ = (
        UniqueConstraint("user_id", "name", name="uq_category_user_name"),
    )


class Semester(Base, UserScopedMixin, TimestampMixin):
    __tablename__ = "semester"

    id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        primary_key=True,
        server_default=text("gen_random_uuid()"),
    )
    academic_year: Mapped[int] = mapped_column(nullable=False)
    # term: 1 = 上學期 / Term 1, 2 = 下學期 / Term 2
    term: Mapped[int] = mapped_column(nullable=False)
    is_current: Mapped[bool] = mapped_column(
        nullable=False, server_default=text("false")
    )

    __table_args__ = (
        UniqueConstraint(
            "user_id", "academic_year", "term",
            name="uq_semester_year_term",
        ),
        CheckConstraint("term IN (1, 2)", name="ck_semester_term"),
        # at most one is_current=true per user
        Index(
            "ix_semester_one_current_per_user",
            "user_id",
            unique=True,
            postgresql_where=text("is_current = true"),
        ),
    )


# Many-to-many: one item can apply to multiple classrooms
item_classroom = Table(
    "item_classroom",
    Base.metadata,
    Column(
        "item_id",
        PG_UUID(as_uuid=True),
        ForeignKey("item.id", ondelete="CASCADE"),
        primary_key=True,
    ),
    Column(
        "classroom_id",
        PG_UUID(as_uuid=True),
        ForeignKey("classroom.id", ondelete="CASCADE"),
        primary_key=True,
    ),
)


class Item(Base, UserScopedMixin, TimestampMixin):
    __tablename__ = "item"

    id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        primary_key=True,
        server_default=text("gen_random_uuid()"),
    )
    subject_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("subject.id"),
        nullable=False,
        index=True,
    )
    category_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("category.id"),
        nullable=False,
        index=True,
    )
    semester_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("semester.id"),
        nullable=False,
        index=True,
    )
    # name = "" for 段考-type categories; required for 小考/作業/custom
    name: Mapped[str] = mapped_column(String(200), nullable=False, server_default="")

    classrooms: Mapped[list["Classroom"]] = relationship(
        secondary=item_classroom, back_populates="items"
    )
    grades: Mapped[list["Grade"]] = relationship(
        back_populates="item", cascade="all, delete-orphan"
    )

    __table_args__ = (
        UniqueConstraint(
            "user_id", "subject_id", "category_id", "semester_id", "name",
            name="uq_item_subject_category_semester_name",
        ),
    )
