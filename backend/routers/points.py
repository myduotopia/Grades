"""Manual points: per-student + per-classroom batch (issue #84).

Auto-award still lives in `routers/grades.py::apply_auto_award` and writes
PointRecord with source_grade_id set. The endpoints here always set
source_grade_id=NULL — these are teacher-initiated point adjustments.

Writes that target a past semester are blocked (sharing the #55 archived
check) so reading a non-current semester never lets a teacher accidentally
mutate it.
"""
from __future__ import annotations

from datetime import date, datetime
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func
from sqlalchemy.orm import Session

from auth import require_user_id
from database import get_db
from models.classroom import Classroom, Student
from models.curriculum import Semester
from models.grading import PointRecord, PointReset
from schemas import (
    ClassPointsBatch,
    ClassPointsBatchResult,
    ClassPointsResetResult,
    ClassPointsSummary,
    ClassPointsSummaryList,
    ManualPointCreate,
    ManualPointOut,
    PointResetRequest,
    PointResetResult,
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


def _latest_reset(
    db: Session, user_id: UUID, student_id: UUID
) -> datetime | None:
    """Most-recent PointReset.reset_at for this student across ALL time
    (cumulative — #207), or None if there isn't one. Acts as the floor for
    the running total: anything created on or before this moment has been
    zeroed out (#165)."""
    return (
        db.query(func.max(PointReset.reset_at))
        .filter(
            PointReset.user_id == user_id,
            PointReset.student_id == student_id,
        )
        .scalar()
    )


def _latest_reset_map_for_classroom(
    db: Session, user_id: UUID, classroom_id: UUID
) -> dict[UUID, datetime]:
    """student_id → latest reset_at ever (only students that have one)."""
    rows = (
        db.query(
            PointReset.student_id, func.max(PointReset.reset_at)
        )
        .join(Student, Student.id == PointReset.student_id)
        .filter(
            PointReset.user_id == user_id,
            Student.classroom_id == classroom_id,
        )
        .group_by(PointReset.student_id)
        .all()
    )
    return {sid: ts for sid, ts in rows}


def _points_for_student(
    db: Session, user_id: UUID, student_id: UUID
) -> int:
    """Cumulative running total (#207): sum of ALL the student's points after
    their latest 歸零 reset (or all, if never reset). No semester window —
    archived-period and prior-semester points all count. Resets are strictly
    exclusive (a record at exactly the reset moment is 'before', #165)."""
    last_reset = _latest_reset(db, user_id, student_id)
    q = db.query(func.coalesce(func.sum(PointRecord.points), 0)).filter(
        PointRecord.user_id == user_id,
        PointRecord.student_id == student_id,
    )
    if last_reset is not None:
        q = q.filter(PointRecord.created_at > last_reset)
    return int(q.scalar() or 0)


def _points_for_classroom(
    db: Session, user_id: UUID, classroom_id: UUID
) -> int:
    """Classroom total = sum of every student's cumulative total (each may
    have their own last-reset floor)."""
    last_reset_by_student = _latest_reset_map_for_classroom(
        db, user_id, classroom_id
    )
    student_ids = [
        sid
        for (sid,) in db.query(Student.id).filter(
            Student.classroom_id == classroom_id,
            Student.user_id == user_id,
        ).all()
    ]
    if not student_ids:
        return 0
    # Pull every relevant PointRecord once, then bucket per student so we
    # only apply the right floor per student. Avoids N round-trips.
    rows = (
        db.query(
            PointRecord.student_id,
            PointRecord.points,
            PointRecord.created_at,
        )
        .filter(
            PointRecord.user_id == user_id,
            PointRecord.student_id.in_(student_ids),
        )
        .all()
    )
    total = 0
    for sid, pts, ts in rows:
        floor = last_reset_by_student.get(sid)
        if floor is not None and ts <= floor:
            continue
        total += int(pts)
    return total


# ---------- Summary views (drive /points pages) ----------

@router.get(
    "/api/points/classrooms",
    response_model=ClassPointsSummaryList,
)
def list_classroom_summaries(
    user_id: Annotated[UUID, Depends(require_user_id)],
    db: Annotated[Session, Depends(get_db)],
) -> ClassPointsSummaryList:
    """Top page on /points: every classroom + roster size + cumulative points.

    Points are cumulative across all time (#207), so they no longer depend on
    a current semester being set.
    """
    classrooms = (
        db.query(Classroom)
        .filter(Classroom.user_id == user_id)
        .order_by(Classroom.grade.asc(), Classroom.name.asc())
        .all()
    )
    if not classrooms:
        return ClassPointsSummaryList(data=[])

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
        pts = _points_for_classroom(db, user_id, c.id)
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

    out: list[StudentPointsSummary] = []
    for s in students:
        pts = _points_for_student(db, user_id, s.id)
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

    student_q = db.query(Student).filter(
        Student.classroom_id == classroom_id,
        Student.user_id == user_id,
    )
    # #173: optional student subset. Backend always intersects with the
    # classroom's roster so a client can't write to a student outside the
    # named class via this endpoint.
    if body.student_ids:
        student_q = student_q.filter(Student.id.in_(body.student_ids))
    students = student_q.all()
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


# ---------- Manual delete (#158) ----------

@router.delete(
    "/api/students/{student_id}/points/{point_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
def delete_student_point(
    student_id: UUID,
    point_id: UUID,
    user_id: Annotated[UUID, Depends(require_user_id)],
    db: Annotated[Session, Depends(get_db)],
) -> None:
    """Delete a single manual point record. Auto-award records (those tied to
    a Grade via source_grade_id) cannot be deleted here — the teacher should
    fix the grade instead, otherwise the next sync would just re-create them.
    """
    student = (
        db.query(Student)
        .filter(Student.id == student_id, Student.user_id == user_id)
        .one_or_none()
    )
    if student is None:
        raise _not_found("student")
    _get_current_semester(db, user_id)  # 403 if no active semester
    record = (
        db.query(PointRecord)
        .filter(
            PointRecord.id == point_id,
            PointRecord.student_id == student_id,
            PointRecord.user_id == user_id,
        )
        .one_or_none()
    )
    if record is None:
        raise _not_found("point_record")
    if record.source_grade_id is not None:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={
                "error": {
                    "code": "FORBIDDEN",
                    "message_key": "errors.points.cannot_delete_auto",
                    "message": (
                        "Auto-awarded point records cannot be deleted; "
                        "edit the underlying grade instead."
                    ),
                }
            },
        )
    db.delete(record)
    db.commit()


# ---------- Reset to zero (#146) ----------

_DEFAULT_RESET_REASON = "歸零"


@router.post(
    "/api/students/{student_id}/points/reset",
    response_model=PointResetResult,
)
def reset_student_points(
    student_id: UUID,
    body: PointResetRequest,
    user_id: Annotated[UUID, Depends(require_user_id)],
    db: Annotated[Session, Depends(get_db)],
) -> PointResetResult:
    student = (
        db.query(Student)
        .filter(Student.id == student_id, Student.user_id == user_id)
        .one_or_none()
    )
    if student is None:
        raise _not_found("student")
    _get_current_semester(db, user_id)  # 403 if no active semester
    current = _points_for_student(db, user_id, student.id)
    if current == 0:
        return PointResetResult(skipped=True, current=0, record=None)
    reason = body.reason.strip() or _DEFAULT_RESET_REASON
    # Issue #165: write a PointReset marker instead of an offsetting
    # negative PointRecord. Reads filter sums by the latest reset_at, so
    # past records that later change won't unbalance the reset.
    marker = PointReset(
        user_id=user_id,
        student_id=student.id,
        reason=reason,
    )
    db.add(marker)
    db.commit()
    db.refresh(marker)
    return PointResetResult(
        skipped=False,
        current=current,
        record=ManualPointOut(
            id=marker.id,
            student_id=marker.student_id,
            # Surface as a negative delta for the existing client API
            # shape, even though no PointRecord row exists. Frontend just
            # uses this to show "歸零 X 點" feedback.
            points=-current,
            reason=marker.reason,
            created_at=marker.reset_at,
        ),
    )


@router.post(
    "/api/classrooms/{classroom_id}/points/reset",
    response_model=ClassPointsResetResult,
)
def reset_classroom_points(
    classroom_id: UUID,
    body: PointResetRequest,
    user_id: Annotated[UUID, Depends(require_user_id)],
    db: Annotated[Session, Depends(get_db)],
) -> ClassPointsResetResult:
    classroom = (
        db.query(Classroom)
        .filter(Classroom.id == classroom_id, Classroom.user_id == user_id)
        .one_or_none()
    )
    if classroom is None:
        raise _not_found("classroom")
    _get_current_semester(db, user_id)  # 403 if no active semester

    students = (
        db.query(Student)
        .filter(
            Student.classroom_id == classroom_id,
            Student.user_id == user_id,
        )
        .all()
    )

    reason = body.reason.strip() or _DEFAULT_RESET_REASON
    written = 0
    skipped = 0
    # Issue #165: write one PointReset marker per student that currently
    # has a non-zero running total. Students already at 0 (per the new
    # last-reset-aware sum) are skipped so the history stays clean.
    for s in students:
        current = _points_for_student(db, user_id, s.id)
        if current == 0:
            skipped += 1
            continue
        db.add(
            PointReset(
                user_id=user_id,
                student_id=s.id,
                reason=reason,
            )
        )
        written += 1
    db.commit()
    return ClassPointsResetResult(written=written, skipped=skipped)
