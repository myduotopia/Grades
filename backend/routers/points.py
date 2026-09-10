"""Manual points: per-student + per-classroom batch (issue #84).

Auto-award still lives in `routers/grades.py::apply_auto_award` and writes
PointRecord with source_grade_id set. The endpoints here always set
source_grade_id=NULL — these are teacher-initiated point adjustments.

Writes that target a past semester are blocked (sharing the #55 archived
check) so reading a non-current semester never lets a teacher accidentally
mutate it.
"""
from __future__ import annotations

from collections.abc import Sequence
from datetime import date, datetime
from typing import Annotated
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func
from sqlalchemy.orm import Session

from auth import require_user_id
from database import get_db
from models.classroom import Classroom, Student
from models.curriculum import Semester
from models.grading import PointRecord, PointReset
from models.settings import UserSettings
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


def _ensure_saved_reason(db: Session, user_id: UUID, name: str) -> None:
    """Upsert a manual-point reason NAME into UserSettings.point_reasons (#215).

    The 加點/扣點 modals let a teacher type a brand-new reason; we auto-file it
    so it shows up in the dropdown next time. No-op for blank/too-long names or
    names already present (case-insensitive match against existing rows,
    including system ones). New rows store default_points=0 — point amounts are
    chosen per-entry now, not pre-stored on the reason.

    Caller is expected to commit (we only stage the change so it lands in the
    same transaction as the PointRecord write).
    """
    name = name.strip()
    if not name or len(name) > 50:
        return
    settings = db.get(UserSettings, user_id)
    existing = (
        list(settings.point_reasons)
        if settings and settings.point_reasons
        else []
    )
    if any(e.get("name", "").strip().lower() == name.lower() for e in existing):
        return
    existing.append({"id": str(uuid4()), "name": name, "default_points": 0})
    if settings is None:
        db.add(UserSettings(user_id=user_id, point_reasons=existing))
    else:
        settings.point_reasons = existing


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


def _latest_reset_map_for_students(
    db: Session, user_id: UUID, student_ids: Sequence[UUID]
) -> dict[UUID, datetime]:
    """student_id → latest reset_at ever (only students that have one).

    One query for the whole list. The floor semantics live in
    _points_map_for_students, which is this helper's only caller.
    """
    if not student_ids:
        return {}
    rows = (
        db.query(PointReset.student_id, func.max(PointReset.reset_at))
        .filter(
            PointReset.user_id == user_id,
            PointReset.student_id.in_(student_ids),
        )
        .group_by(PointReset.student_id)
        .all()
    )
    return {sid: ts for sid, ts in rows}


def _points_map_for_students(
    db: Session, user_id: UUID, student_ids: Sequence[UUID]
) -> dict[UUID, int]:
    """student_id → cumulative running total, for a whole roster at once.

    Two queries regardless of roster size (no N+1) — the batching pattern
    used throughout student_detail.py. This is the single definition of the
    reset-floor semantics; every other points total goes through it.

    Cumulative across all time (#207): no semester window, so archived-period
    and prior-semester points all count. Resets are strictly exclusive — a
    record created at exactly the reset moment counts as 'before' it (#165).

    Every requested student appears in the result, defaulting to 0.
    """
    if not student_ids:
        return {}
    floor_by_student = _latest_reset_map_for_students(db, user_id, student_ids)
    totals: dict[UUID, int] = {sid: 0 for sid in student_ids}
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
    for sid, pts, ts in rows:
        floor = floor_by_student.get(sid)
        if floor is not None and ts <= floor:
            continue
        totals[sid] += int(pts)
    return totals


def _points_for_student(
    db: Session, user_id: UUID, student_id: UUID
) -> int:
    """Cumulative running total for one student — thin wrapper so the
    reset-floor semantics live in exactly one place."""
    return _points_map_for_students(db, user_id, [student_id]).get(
        student_id, 0
    )


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

    # Every student the teacher owns, in one query. This gives us both the
    # per-classroom roster size and the id list for the points map, so the
    # whole page is 3 queries flat instead of 3 per classroom (#247).
    student_rows = (
        db.query(Student.id, Student.classroom_id)
        .filter(Student.user_id == user_id)
        .all()
    )
    counts: dict[UUID, int] = {}
    classroom_of: dict[UUID, UUID] = {}
    for sid, cid in student_rows:
        counts[cid] = counts.get(cid, 0) + 1
        classroom_of[sid] = cid

    points_by_student = _points_map_for_students(
        db, user_id, [sid for sid, _ in student_rows]
    )
    points_by_classroom: dict[UUID, int] = {}
    for sid, pts in points_by_student.items():
        cid = classroom_of[sid]
        points_by_classroom[cid] = points_by_classroom.get(cid, 0) + pts

    out: list[ClassPointsSummary] = []
    for c in classrooms:
        pts = points_by_classroom.get(c.id, 0)
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

    points_by_student = _points_map_for_students(
        db, user_id, [s.id for s in students]
    )

    out: list[StudentPointsSummary] = []
    for s in students:
        pts = points_by_student.get(s.id, 0)
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
    _ensure_saved_reason(db, user_id, body.reason)
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
    _ensure_saved_reason(db, user_id, reason)
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
    points_by_student = _points_map_for_students(
        db, user_id, [s.id for s in students]
    )
    for s in students:
        current = points_by_student.get(s.id, 0)
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
