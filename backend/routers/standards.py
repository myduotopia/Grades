"""Per-student × per-subject thresholds (issue #10)."""
from __future__ import annotations

from decimal import Decimal
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from auth import require_user_id
from database import get_db
from models.classroom import Classroom, Student
from models.curriculum import Subject
from models.grading import StudentStandard
from schemas import (
    StandardUpsert,
    StandardsBatchResult,
    StandardsBatchUpsert,
    StandardsView,
    StudentStandardOut,
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


def _get_owned_classroom(
    db: Session, user_id: UUID, classroom_id: UUID
) -> Classroom:
    c = (
        db.query(Classroom)
        .filter(Classroom.id == classroom_id, Classroom.user_id == user_id)
        .one_or_none()
    )
    if c is None:
        raise _not_found("classroom")
    return c


def _get_owned_student(db: Session, user_id: UUID, student_id: UUID) -> Student:
    s = (
        db.query(Student)
        .filter(Student.id == student_id, Student.user_id == user_id)
        .one_or_none()
    )
    if s is None:
        raise _not_found("student")
    return s


def _valid_subject_id(db: Session, user_id: UUID, subject_id: UUID) -> bool:
    return (
        db.query(Subject.id)
        .filter(
            Subject.id == subject_id,
            (Subject.user_id.is_(None)) | (Subject.user_id == user_id),
        )
        .first()
        is not None
    )


@router.get(
    "/api/classrooms/{classroom_id}/standards",
    response_model=StandardsView,
)
def list_standards(
    classroom_id: UUID,
    user_id: Annotated[UUID, Depends(require_user_id)],
    db: Annotated[Session, Depends(get_db)],
) -> StandardsView:
    """Return every (student, subject) threshold for one classroom's roster."""
    _get_owned_classroom(db, user_id, classroom_id)
    student_ids = [
        s.id
        for s in db.query(Student)
        .filter(
            Student.classroom_id == classroom_id,
            Student.user_id == user_id,
        )
        .all()
    ]
    if not student_ids:
        return StandardsView(data=[])
    rows = (
        db.query(StudentStandard)
        .filter(
            StudentStandard.user_id == user_id,
            StudentStandard.student_id.in_(student_ids),
        )
        .all()
    )
    return StandardsView(
        data=[
            StudentStandardOut(
                student_id=r.student_id,
                subject_id=r.subject_id,
                threshold=float(r.threshold),
            )
            for r in rows
        ]
    )


@router.put(
    "/api/students/{student_id}/standards/{subject_id}",
    response_model=StudentStandardOut,
)
def upsert_standard(
    student_id: UUID,
    subject_id: UUID,
    body: StandardUpsert,
    user_id: Annotated[UUID, Depends(require_user_id)],
    db: Annotated[Session, Depends(get_db)],
) -> StudentStandardOut:
    student = _get_owned_student(db, user_id, student_id)
    if not _valid_subject_id(db, user_id, subject_id):
        raise _bad_request(
            "errors.item.subject_invalid", "Unknown subject."
        )
    existing = (
        db.query(StudentStandard)
        .filter(
            StudentStandard.student_id == student.id,
            StudentStandard.subject_id == subject_id,
        )
        .one_or_none()
    )
    if existing is None:
        std = StudentStandard(
            user_id=user_id,
            student_id=student.id,
            subject_id=subject_id,
            threshold=Decimal(str(body.threshold)),
        )
        db.add(std)
    else:
        existing.threshold = Decimal(str(body.threshold))
        std = existing
    db.commit()
    db.refresh(std)
    return StudentStandardOut(
        student_id=std.student_id,
        subject_id=std.subject_id,
        threshold=float(std.threshold),
    )


@router.delete(
    "/api/students/{student_id}/standards/{subject_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
def delete_standard(
    student_id: UUID,
    subject_id: UUID,
    user_id: Annotated[UUID, Depends(require_user_id)],
    db: Annotated[Session, Depends(get_db)],
) -> None:
    student = _get_owned_student(db, user_id, student_id)
    row = (
        db.query(StudentStandard)
        .filter(
            StudentStandard.student_id == student.id,
            StudentStandard.subject_id == subject_id,
            StudentStandard.user_id == user_id,
        )
        .one_or_none()
    )
    if row is None:
        return
    db.delete(row)
    db.commit()


@router.post(
    "/api/classrooms/{classroom_id}/standards/batch",
    response_model=StandardsBatchResult,
)
def batch_upsert_standards(
    classroom_id: UUID,
    body: StandardsBatchUpsert,
    user_id: Annotated[UUID, Depends(require_user_id)],
    db: Annotated[Session, Depends(get_db)],
) -> StandardsBatchResult:
    """Apply one threshold to many students at once."""
    _get_owned_classroom(db, user_id, classroom_id)
    if not _valid_subject_id(db, user_id, body.subject_id):
        raise _bad_request(
            "errors.item.subject_invalid", "Unknown subject."
        )
    valid_students = {
        s.id
        for s in db.query(Student)
        .filter(
            Student.id.in_(body.student_ids),
            Student.user_id == user_id,
            Student.classroom_id == classroom_id,
        )
        .all()
    }
    if not valid_students:
        return StandardsBatchResult(written=0)
    existing = {
        r.student_id: r
        for r in db.query(StudentStandard)
        .filter(
            StudentStandard.student_id.in_(valid_students),
            StudentStandard.subject_id == body.subject_id,
        )
        .all()
    }
    threshold = Decimal(str(body.threshold))
    written = 0
    for sid in valid_students:
        row = existing.get(sid)
        if row is None:
            db.add(
                StudentStandard(
                    user_id=user_id,
                    student_id=sid,
                    subject_id=body.subject_id,
                    threshold=threshold,
                )
            )
        else:
            row.threshold = threshold
        written += 1
    db.commit()
    return StandardsBatchResult(written=written)
