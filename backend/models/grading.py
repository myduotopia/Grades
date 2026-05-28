"""Grade, StudentStandard, PointRule, PointRecord."""
from datetime import datetime
from decimal import Decimal
from typing import TYPE_CHECKING
from uuid import UUID

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    ForeignKey,
    Numeric,
    String,
    Text,
    UniqueConstraint,
    text,
)
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from models.base import Base, TimestampMixin, UserScopedMixin
from models.classroom import SOURCE_VALUES

if TYPE_CHECKING:
    from models.classroom import Student
    from models.curriculum import Category, Item, Subject


class Grade(Base, UserScopedMixin, TimestampMixin):
    __tablename__ = "grade"

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
    score: Mapped[Decimal] = mapped_column(Numeric(4, 1), nullable=False)
    source: Mapped[str] = mapped_column(String(32), nullable=False, default="manual")
    source_external_id: Mapped[str | None] = mapped_column(String(255), nullable=True)

    item: Mapped["Item"] = relationship(back_populates="grades")
    student: Mapped["Student"] = relationship(back_populates="grades")
    point_record: Mapped["PointRecord | None"] = relationship(
        back_populates="source_grade",
        uselist=False,
        cascade="all, delete-orphan",
    )

    __table_args__ = (
        UniqueConstraint("item_id", "student_id", name="uq_grade_item_student"),
        CheckConstraint("score >= 0 AND score <= 100", name="ck_grade_score_range"),
        CheckConstraint(
            f"source IN {SOURCE_VALUES!r}",
            name="ck_grade_source",
        ),
    )


class StudentStandard(Base, UserScopedMixin, TimestampMixin):
    """Per-student × per-subject threshold for awarding points (issue #10).

    Auto-award uses this to decide whether a particular student "met
    standard" for an item: if score >= threshold for (student_id,
    item.subject_id), and the item's category is in
    AUTO_AWARD_CATEGORY_KEYS, points fire.
    """
    __tablename__ = "student_standard"

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
    subject_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("subject.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    threshold: Mapped[Decimal] = mapped_column(Numeric(4, 1), nullable=False)

    student: Mapped["Student"] = relationship(back_populates="standards")

    __table_args__ = (
        UniqueConstraint(
            "student_id", "subject_id",
            name="uq_standard_student_subject",
        ),
        CheckConstraint(
            "threshold >= 0 AND threshold <= 100",
            name="ck_standard_threshold_range",
        ),
    )


class SnapshotStandard(Base, UserScopedMixin, TimestampMixin):
    """Frozen per-student × per-subject threshold for an archived snapshot
    (issue #160).

    `StudentStandard` is the live, mutable threshold the teacher edits day-
    to-day. When a snapshot is taken, the current thresholds for every
    student in the classroom × every subject are copied into this table so
    later edits to the live thresholds don't change what an archived
    snapshot says was the standard at archive time.

    The snapshot's recompute-points action reads thresholds from here, not
    from `StudentStandard`, and the snapshot's standards-tab UI edits these
    rows independently of the live ones.
    """
    __tablename__ = "snapshot_standard"

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
        ForeignKey("student.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    subject_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("subject.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    threshold: Mapped[Decimal] = mapped_column(Numeric(4, 1), nullable=False)

    __table_args__ = (
        UniqueConstraint(
            "snapshot_id", "student_id", "subject_id",
            name="uq_snapshot_standard",
        ),
        CheckConstraint(
            "threshold >= 0 AND threshold <= 100",
            name="ck_snapshot_standard_threshold_range",
        ),
    )


class PointRule(Base, UserScopedMixin, TimestampMixin):
    """How many points to award per category when a student meets standard."""
    __tablename__ = "point_rule"

    id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        primary_key=True,
        server_default=text("gen_random_uuid()"),
    )
    category_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("category.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    points_awarded: Mapped[int] = mapped_column(nullable=False, default=0)

    category: Mapped["Category"] = relationship(back_populates="point_rule")

    __table_args__ = (
        UniqueConstraint(
            "user_id", "category_id",
            name="uq_point_rule_user_category",
        ),
        CheckConstraint("points_awarded >= 0", name="ck_point_rule_non_negative"),
    )


class SubjectPointRule(Base, UserScopedMixin, TimestampMixin):
    """Per-subject points awarded when a student meets their standard.

    Replaces the per-category PointRule as the source of truth for auto-award
    amount. Category still gates which grades trigger an award (only
    major_exam + quiz); subject decides how many points.
    """
    __tablename__ = "subject_point_rule"

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
    points_awarded: Mapped[int] = mapped_column(nullable=False, default=100)

    subject: Mapped["Subject"] = relationship()

    __table_args__ = (
        UniqueConstraint(
            "user_id", "subject_id", name="uq_subject_point_rule_user_subject"
        ),
        CheckConstraint(
            "points_awarded BETWEEN 0 AND 500",
            name="ck_subject_point_rule_range",
        ),
    )


class PointRecord(Base, UserScopedMixin):
    """Awarded points history. Total = SUM(points) per student.

    UNIQUE on source_grade_id ensures one grade can only award points once.
    """
    __tablename__ = "point_record"

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
    points: Mapped[int] = mapped_column(nullable=False)
    reason: Mapped[str] = mapped_column(Text, nullable=False, server_default="")
    source_grade_id: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("grade.id", ondelete="CASCADE"),
        nullable=True,
        unique=True,
    )
    # Inline created_at (no updated_at — point_records are append-only / recreated)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=text("now()"),
    )

    student: Mapped["Student"] = relationship(back_populates="point_records")
    source_grade: Mapped["Grade | None"] = relationship(back_populates="point_record")
