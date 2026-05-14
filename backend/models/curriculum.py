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


# System-default category keys (seeded per user on signup) and their
# default weights (percent). Users cannot add custom categories in v1.
# i18n: front-end resolves system_key via the `category.*` dictionary.
# `extra` is excluded from the 100% sum (additional bonus bucket).
SYSTEM_CATEGORY_DEFAULTS: tuple[tuple[str, int], ...] = (
    ("major_exam", 50),  # 段考
    ("quiz", 20),        # 小考
    ("homework", 20),    # 作業
    ("attendance", 10),  # 出席率
    ("extra", 0),        # 額外加分（不計入 100%）
)
SYSTEM_CATEGORY_KEYS: tuple[str, ...] = tuple(k for k, _ in SYSTEM_CATEGORY_DEFAULTS)


# Global built-in subjects (one row per key, user_id IS NULL).
# i18n: front-end resolves system_key via the `subject.*` dictionary.
SYSTEM_SUBJECT_KEYS = (
    "chinese",
    "math",
    "english",
    "science",
    "social_studies",
    "music",
    "art",
    "pe",
    "integrated",
)

# Per-subject category-weight defaults. Used when seeding subject_category_weight
# rows for a new user and when creating a custom subject. Each profile sums to
# 100 across non-extra categories.
_ACADEMIC_PROFILE: dict[str, int] = {
    "major_exam": 50,
    "quiz": 20,
    "homework": 20,
    "attendance": 10,
    "extra": 0,
}
_ARTS_PE_PROFILE: dict[str, int] = {
    "major_exam": 0,
    "quiz": 0,
    "homework": 60,
    "attendance": 40,
    "extra": 0,
}

SUBJECT_WEIGHT_PROFILES: dict[str, dict[str, int]] = {
    "chinese": _ACADEMIC_PROFILE,
    "math": _ACADEMIC_PROFILE,
    "english": _ACADEMIC_PROFILE,
    "science": _ACADEMIC_PROFILE,
    "social_studies": _ACADEMIC_PROFILE,
    "integrated": _ACADEMIC_PROFILE,
    "music": _ARTS_PE_PROFILE,
    "art": _ARTS_PE_PROFILE,
    "pe": _ARTS_PE_PROFILE,
}

# Custom subjects (teacher-added) inherit the academic profile by default.
CUSTOM_SUBJECT_DEFAULT_PROFILE: dict[str, int] = _ACADEMIC_PROFILE


class Subject(Base, TimestampMixin):
    """Subject = either a global built-in (user_id NULL, system_key set)
    or a teacher-owned custom (user_id set, display_name set).
    """
    __tablename__ = "subject"

    id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        primary_key=True,
        server_default=text("gen_random_uuid()"),
    )
    # Nullable on purpose: NULL means a global built-in shared by every user.
    user_id: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True),
        nullable=True,
        index=True,
    )
    system_key: Mapped[str | None] = mapped_column(String(50), nullable=True)
    display_name: Mapped[str | None] = mapped_column(String(100), nullable=True)

    __table_args__ = (
        # Built-in row (user_id NULL, system_key set, display_name NULL)
        # vs custom row (user_id set, system_key NULL, display_name set).
        CheckConstraint(
            "(user_id IS NULL AND system_key IS NOT NULL AND display_name IS NULL)"
            " OR (user_id IS NOT NULL AND system_key IS NULL AND display_name IS NOT NULL)",
            name="ck_subject_builtin_xor_custom",
        ),
        UniqueConstraint("system_key", name="uq_subject_system_key"),
        UniqueConstraint(
            "user_id", "display_name", name="uq_subject_user_display_name"
        ),
    )


class Category(Base, UserScopedMixin, TimestampMixin):
    __tablename__ = "category"

    id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        primary_key=True,
        server_default=text("gen_random_uuid()"),
    )
    system_key: Mapped[str] = mapped_column(String(50), nullable=False)
    weight: Mapped[int] = mapped_column(nullable=False)

    standards: Mapped[list["StudentStandard"]] = relationship(
        back_populates="category"
    )
    point_rule: Mapped["PointRule | None"] = relationship(
        back_populates="category", uselist=False
    )

    __table_args__ = (
        UniqueConstraint(
            "user_id", "system_key", name="uq_category_user_system_key"
        ),
        CheckConstraint("weight BETWEEN 0 AND 100", name="ck_category_weight_range"),
    )


class SubjectCategoryWeight(Base, UserScopedMixin, TimestampMixin):
    """Per-subject weight for each category, per teacher.

    Replaces the single per-category Category.weight as the source of truth for
    weighted-total computation. Category.weight is now only used as a default
    template when seeding new subject_category_weight rows.
    """
    __tablename__ = "subject_category_weight"

    id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        primary_key=True,
        server_default=text("gen_random_uuid()"),
    )
    subject_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("subject.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    category_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("category.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    weight: Mapped[int] = mapped_column(nullable=False)

    __table_args__ = (
        UniqueConstraint(
            "user_id", "subject_id", "category_id",
            name="uq_scw_user_subject_category",
        ),
        CheckConstraint("weight BETWEEN 0 AND 100", name="ck_scw_weight_range"),
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
