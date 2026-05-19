"""Manual points: per-student + per-classroom batch (issue #84).

Auto-award still lives in `routers/grades.py::apply_auto_award` and writes
PointRecord with source_grade_id set. The endpoints here always set
source_grade_id=NULL — these are teacher-initiated point adjustments.

Writes that target a past semester are blocked (sharing the #55 archived
check) so reading a non-current semester never lets a teacher accidentally
mutate it.
"""
from __future__ import annotations

from datetime import date
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func
from sqlalchemy.orm import Session

from auth import require_user_id
from database import get_db
from models.classroom import Classroom, Student
from models.curriculum import Semester
from models.grading import PointRecord
from schemas import (
    ClassPointsBatch,
    ClassPointsBatchResult,
    ClassPointsSummary,
    ClassPointsSummaryList,
    ManualPointCreate,
    ManualPointOut,
    StudentPointsSummary,
    StudentPointsSummaryList,
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


def _archived_forbidden() -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail={
            "error": {
                "code": "FORBIDDEN",
                "message_key": "errors.semester.archived",
                "message": "This semester is archived and read-only.",
            }
        },
    )


def _bad_request(message_key: str, message: str) -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_400_BAD_REQUEST,
        detail={
            "error": {
                "code": "BAD_REQUEST",
                "message_key": message_key,
                "message": message,
            }
        },
    )


def _get_current_semester(db: Session, user_id: UUID) -> Semester:
    """Manual points are only writable while there's an active semester to
    attach them to. Without one, the date window for `semester_points`
    rollups is undefined too, so refuse the write."""
    sem = (
        db.query(Semester)
        .filter(Semester.user_id == user_id, Semester.is_current.is_(True))
        .one_or_none()
    )
    if sem is None:
        raise _archived_forbidden()
    return sem


def _semester_points_for_student(
    db: Session, user_id: UUID, student_id: UUID, sem: Semester
) -> int:
    total = (
        db.query(func.coalesce(func.sum(PointRecord.points), 0))
        .filter(
            PointRecord.user_id == user_id,
            PointRecord.student_id == student_id,
            func.date(PointRecord.created_at) >= sem.start_date,
        )
        .scalar()
    )
    return int(total or 0)


def _semester_points_for_classroom(
    db: Session,
    user_id: UUID,
    classroom_id: UUID,
    sem: Semester,
) -> int:
    """Sum of all point_records whose student belongs to this classroom and
    whose created_at lies inside the semester window."""
    total = (
        db.query(func.coalesce(func.sum(PointRecord.points), 0))
        .join(Student, PointRecord.student_id == Student.id)
        .filter(
            PointRecord.user_id == user_id,
            Student.classroom_id == classroom_id,
            func.date(PointRecord.created_at) >= sem.start_date,
        )
        .scalar()
    )
    return int(total or 0)


# ---------- Summary views (drive /points pages) ----------

@router.get(
    "/api/points/classrooms",
    response_model=ClassPointsSummaryList,
)
def list_classroom_summaries(
    user_id: Annotated[UUID, Depends(require_user_id)],
    db: Annotated[Session, Depends(get_db)],
) -> ClassPointsSummaryList:
    """Top page on /points: every classroom + roster size + semester points.

    Returns empty list when no semester is current — frontend shows an
    empty-state pointing the user at /admin/semesters.
    """
    classrooms = (
        db.query(Classroom)
        .filter(Classroom.user_id == user_id)
        .order_by(Classroom.grade.asc(), Classroom.name.asc())
        .all()
    )
    if not classrooms:
        return ClassPointsSummaryList(data=[])

    sem = (
        db.query(Semester)
        .filter(Semester.user_id == user_id, Semester.is_current.is_(True))
        .one_or_none()
    )
    # student counts per classroom in one query
    counts_rows = (
        db.query(Student.classroom_id, func.count(Student.id))
        .filter(Student.user_id == user_id)
        .group_by(Student.classroom_id)
        .all()
    )
    counts = {cid: int(n) for cid, n in counts_rows}

    out: list[ClassPointsSummary] = []
    for c in classrooms:
        pts = (
            _semester_points_for_classroom(db, user_id, c.id, sem)
            if sem is not None
            else 0
        )
        out.append(
            ClassPointsSummary(
                classroom_id=c.id,
                grade=c.grade,
                name=c.name,
                student_count=counts.get(c.id, 0),
                semester_points=pts,
            )
        )
    return ClassPointsSummaryList(data=out)


@router.get(
    "/api/points/classrooms/{classroom_id}/students",
    response_model=StudentPointsSummaryList,
)
def list_classroom_student_summaries(
    classroom_id: UUID,
    user_id: Annotated[UUID, Depends(require_user_id)],
    db: Annotated[Session, Depends(get_db)],
) -> StudentPointsSummaryList:
    classroom = (
        db.query(Classroom)
        .filter(Classroom.id == classroom_id, Classroom.user_id == user_id)
        .one_or_none()
    )
    if classroom is None:
        raise _not_found("classroom")

    students = (
        db.query(Student)
        .filter(
            Student.classroom_id == classroom_id,
            Student.user_id == user_id,
        )
        .order_by(Student.seat_number.asc())
        .all()
    )

    sem = (
        db.query(Semester)
        .filter(Semester.user_id == user_id, Semester.is_current.is_(True))
        .one_or_none()
    )

    out: list[StudentPointsSummary] = []
    for s in students:
        pts = (
            _semester_points_for_student(db, user_id, s.id, sem)
            if sem is not None
            else 0
        )
        out.append(
            StudentPointsSummary(
                student_id=s.id,
                seat_number=s.seat_number,
                name=s.name,
                semester_points=pts,
            )
        )

    return StudentPointsSummaryList(
        classroom_id=classroom.id,
        classroom_grade=classroom.grade,
        classroom_name=classroom.name,
        data=out,
    )


# ---------- Manual writes ----------

@router.post(
    "/api/students/{student_id}/points",
    response_model=ManualPointOut,
    status_code=status.HTTP_201_CREATED,
)
def add_student_point(
    student_id: UUID,
    body: ManualPointCreate,
    user_id: Annotated[UUID, Depends(require_user_id)],
    db: Annotated[Session, Depends(get_db)],
) -> ManualPointOut:
    if body.points == 0:
        raise _bad_request(
            "errors.points.zero",
            "Cannot write a zero-point record.",
        )
    student = (
        db.query(Student)
        .filter(Student.id == student_id, Student.user_id == user_id)
        .one_or_none()
    )
    if student is None:
        raise _not_found("student")
    _get_current_semester(db, user_id)  # 403 if no is_current
    record = PointRecord(
        user_id=user_id,
        student_id=student.id,
        points=body.points,
        reason=body.reason.strip(),
        source_grade_id=None,
    )
    db.add(record)
    db.commit()
    db.refresh(record)
    return ManualPointOut(
        id=record.id,
        student_id=record.student_id,
        points=record.points,
        reason=record.reason,
        created_at=record.created_at,
    )


@router.post(
    "/api/classrooms/{classroom_id}/points/batch",
    response_model=ClassPointsBatchResult,
)
def add_classroom_points_batch(
    classroom_id: UUID,
    body: ClassPointsBatch,
    user_id: Annotated[UUID, Depends(require_user_id)],
    db: Annotated[Session, Depends(get_db)],
) -> ClassPointsBatchResult:
    if body.points == 0:
        raise _bad_request(
            "errors.points.zero",
            "Cannot write a zero-point record.",
        )
    classroom = (
        db.query(Classroom)
        .filter(Classroom.id == classroom_id, Classroom.user_id == user_id)
        .one_or_none()
    )
    if classroom is None:
        raise _not_found("classroom")
    _get_current_semester(db, user_id)

    students = (
        db.query(Student)
        .filter(
            Student.classroom_id == classroom_id,
            Student.user_id == user_id,
        )
        .all()
    )
    reason = body.reason.strip()
    for s in students:
        db.add(
            PointRecord(
                user_id=user_id,
                student_id=s.id,
                points=body.points,
                reason=reason,
                source_grade_id=None,
            )
        )
    db.commit()
    return ClassPointsBatchResult(written=len(students))
