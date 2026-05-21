"""Student detail / transcript endpoints (issue #11).

Read-only views: basic profile + current-semester points total, weighted
grade summary per subject, raw grade history, point-record history.

The "weighted total" math mirrors what the by-student view on
/classes/:id/grades does, except scoped to a single student.
"""
from __future__ import annotations

from datetime import date
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func
from sqlalchemy.orm import Session

from auth import require_user_id
from database import get_db
from models.classroom import Classroom, Student
from models.curriculum import Category, Item, Semester, Subject, SubjectCategoryWeight
from models.grading import Grade, PointRecord, StudentStandard
from routers.grades import AUTO_AWARD_CATEGORY_KEYS
from schemas import (
    StudentDetailOut,
    StudentGradeRow,
    StudentGradesView,
    StudentPointRow,
    StudentPointsView,
    StudentSubjectSummary,
)

router = APIRouter()


def _not_found(resource: str) -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_404_NOT_FOUND,
        detail={
            "error": {
                "code": "NOT_FOUND",
                "message_key": f"errors.{resource}.not_found",
                "message": f"{resource.capitalize()} not found.",
            }
        },
    )


def _get_student(db: Session, user_id: UUID, student_id: UUID) -> Student:
    s = (
        db.query(Student)
        .filter(Student.id == student_id, Student.user_id == user_id)
        .one_or_none()
    )
    if s is None:
        raise _not_found("student")
    return s


def _resolve_semester(
    db: Session, user_id: UUID, semester_id: UUID | None
) -> Semester | None:
    """Return the semester to view: the requested one if owned, else the
    user's is_current=true semester, else None."""
    if semester_id is not None:
        sem = (
            db.query(Semester)
            .filter(Semester.id == semester_id, Semester.user_id == user_id)
            .one_or_none()
        )
        if sem is not None:
            return sem
    return (
        db.query(Semester)
        .filter(Semester.user_id == user_id, Semester.is_current.is_(True))
        .one_or_none()
    )


def _semester_label(sem: Semester) -> str:
    return f"{sem.academic_year}-{sem.term}"


def _points_in_window(
    db: Session,
    user_id: UUID,
    student_id: UUID,
    start: date,
) -> int:
    """Sum a student's points from `start` onward.

    No upper bound: if the current semester's end_date has passed but no new
    semester exists yet, points entered today still count for the current
    semester. Mirrors the same choice in points.py (see #97 / #93 / #95).
    """
    total = (
        db.query(func.coalesce(func.sum(PointRecord.points), 0))
        .filter(
            PointRecord.user_id == user_id,
            PointRecord.student_id == student_id,
            func.date(PointRecord.created_at) >= start,
        )
        .scalar()
    )
    return int(total or 0)


@router.get("/api/students/{student_id}", response_model=StudentDetailOut)
def get_student_detail(
    student_id: UUID,
    user_id: Annotated[UUID, Depends(require_user_id)],
    db: Annotated[Session, Depends(get_db)],
    semester_id: Annotated[UUID | None, Query()] = None,
) -> StudentDetailOut:
    student = _get_student(db, user_id, student_id)
    classroom = db.get(Classroom, student.classroom_id)
    sem = _resolve_semester(db, user_id, semester_id)

    semester_points = 0
    if sem is not None:
        semester_points = _points_in_window(
            db, user_id, student.id, sem.start_date
        )

    return StudentDetailOut(
        id=student.id,
        classroom_id=student.classroom_id,
        classroom_grade=classroom.grade if classroom else 0,
        classroom_name=classroom.name if classroom else "",
        seat_number=student.seat_number,
        name=student.name,
        email=student.email,
        semester_id=sem.id if sem else None,
        semester_label=_semester_label(sem) if sem else None,
        semester_points=semester_points,
    )


@router.get("/api/students/{student_id}/grades", response_model=StudentGradesView)
def get_student_grades(
    student_id: UUID,
    user_id: Annotated[UUID, Depends(require_user_id)],
    db: Annotated[Session, Depends(get_db)],
    semester_id: Annotated[UUID | None, Query()] = None,
) -> StudentGradesView:
    student = _get_student(db, user_id, student_id)
    sem = _resolve_semester(db, user_id, semester_id)
    if sem is None:
        return StudentGradesView(semester_id=None, subjects=[], grades=[])

    # Pull grades + the joined item / subject / category info for this
    # student within the chosen semester.
    rows = (
        db.query(Grade, Item, Subject, Category)
        .join(Item, Grade.item_id == Item.id)
        .join(Subject, Item.subject_id == Subject.id)
        .join(Category, Item.category_id == Category.id)
        .filter(
            Grade.student_id == student.id,
            Grade.user_id == user_id,
            Item.semester_id == sem.id,
        )
        .order_by(Grade.created_at.desc())
        .all()
    )

    # Per-student × per-subject thresholds (issue #10) — used to flag rows.
    standards_by_subject = {
        s.subject_id: float(s.threshold)
        for s in db.query(StudentStandard)
        .filter(
            StudentStandard.user_id == user_id,
            StudentStandard.student_id == student.id,
        )
        .all()
    }

    # Per-subject category weights (issue #6 / #7) — used for the weighted
    # total computation.
    weights = (
        db.query(SubjectCategoryWeight, Subject, Category)
        .join(Subject, SubjectCategoryWeight.subject_id == Subject.id)
        .join(Category, SubjectCategoryWeight.category_id == Category.id)
        .filter(SubjectCategoryWeight.user_id == user_id)
        .all()
    )
    # weight_by[subject_id][category_system_key] = weight
    weight_by: dict[UUID, dict[str, int]] = {}
    for w, subj, cat in weights:
        weight_by.setdefault(w.subject_id, {})[cat.system_key] = w.weight

    # Group grades for weighted-total math.
    by_subject: dict[UUID, dict[str, list[float]]] = {}
    subject_meta: dict[UUID, tuple[str | None, str | None]] = {}
    for grade, item, subj, cat in rows:
        key = subj.id
        subject_meta[key] = (subj.system_key, subj.display_name)
        by_subject.setdefault(key, {}).setdefault(cat.system_key, []).append(
            float(grade.score)
        )

    summaries: list[StudentSubjectSummary] = []
    for subj_id, by_cat in by_subject.items():
        sys_key, disp = subject_meta[subj_id]
        cat_avg: dict[str, float] = {
            ck: round(sum(scores) / len(scores), 2)
            for ck, scores in by_cat.items()
        }
        # Weighted total: re-normalise so categories with no grades don't
        # eat into the 100%. Extra adds on top, capped at 100.
        weights_map = weight_by.get(subj_id, {})
        applicable = [
            (ck, w)
            for ck, w in weights_map.items()
            if ck != "extra" and ck in cat_avg and w > 0
        ]
        total_w = sum(w for _, w in applicable)
        weighted = None
        if total_w > 0:
            base = sum((cat_avg[ck] * w) / total_w for ck, w in applicable)
            extra_avg = cat_avg.get("extra")
            extra_w = weights_map.get("extra", 0)
            bonus = (extra_avg * extra_w / 100.0) if extra_avg is not None and extra_w > 0 else 0.0
            weighted = min(100.0, round(base + bonus, 2))
        summaries.append(
            StudentSubjectSummary(
                subject_id=subj_id,
                subject_system_key=sys_key,
                subject_display_name=disp,
                weighted_total=weighted,
                category_averages=cat_avg,
            )
        )

    grade_rows: list[StudentGradeRow] = []
    for grade, item, subj, cat in rows:
        threshold = standards_by_subject.get(subj.id)
        met = (
            threshold is not None
            and cat.system_key in AUTO_AWARD_CATEGORY_KEYS
            and float(grade.score) >= threshold
        )
        grade_rows.append(
            StudentGradeRow(
                grade_id=grade.id,
                item_id=item.id,
                item_name=item.name,
                subject_id=subj.id,
                subject_system_key=subj.system_key,
                subject_display_name=subj.display_name,
                category_system_key=cat.system_key,
                score=float(grade.score),
                threshold=threshold,
                met_standard=met,
                created_at=grade.created_at,
            )
        )

    return StudentGradesView(
        semester_id=sem.id,
        subjects=summaries,
        grades=grade_rows,
    )


@router.get("/api/students/{student_id}/points", response_model=StudentPointsView)
def get_student_points(
    student_id: UUID,
    user_id: Annotated[UUID, Depends(require_user_id)],
    db: Annotated[Session, Depends(get_db)],
    semester_id: Annotated[UUID | None, Query()] = None,
    limit: Annotated[int, Query(ge=1, le=500)] = 100,
) -> StudentPointsView:
    student = _get_student(db, user_id, student_id)
    sem = _resolve_semester(db, user_id, semester_id)
    if sem is None:
        return StudentPointsView(semester_id=None, total=0, data=[])

    rows = (
        db.query(PointRecord)
        .filter(
            PointRecord.user_id == user_id,
            PointRecord.student_id == student.id,
            func.date(PointRecord.created_at) >= sem.start_date,
        )
        .order_by(PointRecord.created_at.desc())
        .limit(limit)
        .all()
    )
    total = _points_in_window(db, user_id, student.id, sem.start_date)
    return StudentPointsView(
        semester_id=sem.id,
        total=total,
        data=[
            StudentPointRow(
                id=r.id,
                points=r.points,
                reason=r.reason,
                source_grade_id=r.source_grade_id,
                created_at=r.created_at,
            )
            for r in rows
        ],
    )
