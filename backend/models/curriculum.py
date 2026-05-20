"""Subject, Category, Semester, Item."""
from typing import TYPE_CHECKING
from uuid import UUID

from datetime import date

from sqlalchemy import (
    CheckConstraint,
    Date,
    ForeignKey,
    Index,
    String,
    UniqueConstraint,
    text,
)
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from models.base import Base, TimestampMixin, UserScopedMixin

if TYPE_CHECKING:
    from models.classroom import Classroom
    from models.grading import Grade, PointRule


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
# Non-core subjects (everything outside 國英數自社) and teacher-added custom
# subjects: 作業 90% + 出席率 10%, everything else 0%.
_NON_CORE_PROFILE: dict[str, int] = {
    "major_exam": 0,
    "quiz": 0,
    "homework": 90,
    "attendance": 10,
    "extra": 0,
}

SUBJECT_WEIGHT_PROFILES: dict[str, dict[str, int]] = {
    "chinese": _ACADEMIC_PROFILE,
    "math": _ACADEMIC_PROFILE,
    "english": _ACADEMIC_PROFILE,
    "science": _ACADEMIC_PROFILE,
    "social_studies": _ACADEMIC_PROFILE,
    "integrated": _NON_CORE_PROFILE,
    "music": _NON_CORE_PROFILE,
    "art": _NON_CORE_PROFILE,
    "pe": _NON_CORE_PROFILE,
}

# Custom (teacher-added) subjects fall outside 國英數自社 too.
CUSTOM_SUBJECT_DEFAULT_PROFILE: dict[str, int] = _NON_CORE_PROFILE


def default_semester_dates(
    academic_year_minguo: int, term: int, terms_per_year: int
) -> tuple[date, date]:
    """Return (start_date, end_date) for a Taiwan academic year split evenly.

    The academic year for Minguo year N starts on Aug 1 of (N + 1911) and
    ends on Jul 31 of (N + 1912). Terms divide that 12-month window evenly
    (2 → 6 months each, 3 → 4 months, 4 → 3 months).

    Term boundaries always fall on the first/last day of a month.
    """
    from datetime import timedelta as _td

    if terms_per_year not in (2, 3, 4):
        raise ValueError(f"terms_per_year must be 2/3/4, got {terms_per_year}")
    if not 1 <= term <= terms_per_year:
        raise ValueError(f"term {term} out of range for {terms_per_year}-term year")

    gregorian_start = academic_year_minguo + 1911
    months_per_term = 12 // terms_per_year
    start_idx = (term - 1) * months_per_term         # 0..11 offset from Aug
    end_idx = start_idx + months_per_term - 1

    def _resolve(idx: int) -> tuple[int, int]:
        # idx 0 → Aug, idx 11 → Jul of next gregorian year.
        month = ((idx + 7) % 12) + 1
        year = gregorian_start + (1 if idx >= 5 else 0)
        return year, month

    start_y, start_m = _resolve(start_idx)
    end_y, end_m = _resolve(end_idx)
    start = date(start_y, start_m, 1)
    # Last day of end month = (first day of next month) - 1 day.
    if end_m == 12:
        next_month_first = date(end_y + 1, 1, 1)
    else:
        next_month_first = date(end_y, end_m + 1, 1)
    end = next_month_first - _td(days=1)
    return start, end


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
    # term: 1..N where N = user's terms_per_year (2/3/4).
    term: Mapped[int] = mapped_column(nullable=False)
    is_current: Mapped[bool] = mapped_column(
        nullable=False, server_default=text("false")
    )
    # Inclusive date range. POST seeds defaults from a Taiwan-academic-year
    # calendar (Aug 1 → Jul 31, divided evenly by the user's terms_per_year).
    # Users can override via PUT. Required because every downstream page that
    # filters grades by date assumes a non-null range.
    start_date: Mapped[date] = mapped_column(Date, nullable=False)
    end_date: Mapped[date] = mapped_column(Date, nullable=False)

    __table_args__ = (
        UniqueConstraint(
            "user_id", "academic_year", "term",
            name="uq_semester_year_term",
        ),
        CheckConstraint("term BETWEEN 1 AND 4", name="ck_semester_term"),
        CheckConstraint(
            "start_date <= end_date", name="ck_semester_date_order"
        ),
        # at most one is_current=true per user
        Index(
            "ix_semester_one_current_per_user",
            "user_id",
            unique=True,
            postgresql_where=text("is_current = true"),
        ),
    )


class Item(Base, UserScopedMixin, TimestampMixin):
    """An exam / quiz / assignment "column". Items are cross-classroom: the
    same "Quiz 3" given to multiple classes is ONE item, so grades for the
    same assessment can be analysed across classes. Which class's roster a
    teacher edits is determined at score-entry time, not at item creation."""
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

    grades: Mapped[list["Grade"]] = relationship(
        back_populates="item", cascade="all, delete-orphan"
    )

    __table_args__ = (
        UniqueConstraint(
            "user_id", "subject_id", "category_id", "semester_id", "name",
            name="uq_item_subject_category_semester_name",
        ),
    )


class GradeSnapshot(Base, UserScopedMixin, TimestampMixin):
    """A point-in-time bundle of a classroom's activated items, taken by
    the teacher via the "封存目前成績" (archive) button on the classroom
    grades page. After archiving, the bundled items move out of the main
    classroom view (their classroom_item rows get snapshot_id = this row's
    id), so the teacher can start a fresh round on the main page. Items
    added inside the snapshot afterwards stay scoped to the snapshot.

    Not reversible: there's no "unarchive" endpoint. Snapshots accumulate.
    Items / grades are shared across main + all snapshots through the
    Item + Grade tables; only the (classroom, item) activation belongs to
    one bucket at a time."""
    __tablename__ = "grade_snapshot"

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
    # Auto-generated at archive time ("2026-05-21 14:30 結算"); not editable
    # in v1 — open future issue if teachers ask for custom labels.
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    # Frozen at archive time so a 115-archive that was 7-甲 still reads
    # "7-甲" after the class gets promoted to 8 in 116. Don't follow
    # classroom.grade / classroom.name through the FK at display time.
    classroom_grade: Mapped[int] = mapped_column(nullable=False)
    classroom_name: Mapped[str] = mapped_column(String(50), nullable=False)


class SnapshotStudent(Base, UserScopedMixin, TimestampMixin):
    """Frozen roster row for a snapshot.

    Copied from the classroom's current student list at archive time, so
    seat numbers / names displayed in the snapshot view stay pegged to
    "who was in this class when we archived" — even after a student
    transfers out, gets renamed, or the seat number gets reused for
    someone new.

    `student_id` still FKs to the live `student` table (RESTRICT) so the
    snapshot can link back to that student's Grade rows. The displayed
    seat_number + name come from this row, not from `student`."""
    __tablename__ = "snapshot_student"

    id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        primary_key=True,
        server_default=text("gen_random_uuid()"),
    )
    snapshot_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("grade_snapshot.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    student_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("student.id", ondelete="RESTRICT"),
        nullable=False,
    )
    seat_number: Mapped[int] = mapped_column(nullable=False)
    name: Mapped[str | None] = mapped_column(String(100), nullable=True)

    __table_args__ = (
        UniqueConstraint(
            "snapshot_id", "student_id", name="uq_snapshot_student"
        ),
    )


class ClassroomItem(Base, UserScopedMixin, TimestampMixin):
    """Records that a (classroom, item) pair has been "activated" for a class
    by the teacher — either via the online grade-entry flow (bulk save) or
    by importing an Excel column. The classroom grades view filters its
    item columns through this table so newly-created Items don't auto-
    appear in every classroom of the matching subject.

    `snapshot_id` is NULL for the classroom's live working view, and points
    at a `grade_snapshot` row for items that have been archived into a
    snapshot bundle. A single Item can have multiple ClassroomItem rows
    (one per bucket it appears in across snapshots) but at most one with
    snapshot_id=NULL.

    Items themselves remain cross-classroom (see `Item` docstring); this
    table is purely about *which classes have started using which item*.
    Deactivation removes the row but never touches the Grade rows — they
    survive in case the teacher re-activates later."""
    __tablename__ = "classroom_item"

    id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        primary_key=True,
        server_default=text("gen_random_uuid()"),
    )
    classroom_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("classroom.id", ondelete="CASCADE"),
        nullable=False,
    )
    item_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("item.id", ondelete="CASCADE"),
        nullable=False,
    )
    snapshot_id: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("grade_snapshot.id", ondelete="CASCADE"),
        nullable=True,
        index=True,
    )

    # Partial unique indexes (rather than a single UniqueConstraint) so a
    # classroom can have the same item in both main + multiple snapshots.
    __table_args__ = (
        Index(
            "uq_classroom_item_main",
            "classroom_id", "item_id",
            unique=True,
            postgresql_where=text("snapshot_id IS NULL"),
        ),
        Index(
            "uq_classroom_item_snapshot",
            "classroom_id", "snapshot_id", "item_id",
            unique=True,
            postgresql_where=text("snapshot_id IS NOT NULL"),
        ),
        Index("ix_classroom_item_classroom", "classroom_id"),
    )
