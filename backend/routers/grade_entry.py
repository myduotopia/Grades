"""Live grade entry endpoints (issue #9).

Separate from `grades.py` (which owns the Excel import flow). Single + bulk
upsert paths, each calling `apply_auto_award` so points stay in sync with
scores.
"""
from __future__ import annotations

from decimal import Decimal
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from auth import require_user_id
from database import get_db
from models.classroom import Classroom, Student
from models.curriculum import Category, Item, Semester, Subject
from models.grading import Grade, PointRecord
from routers.grades import apply_auto_award
from schemas import (
    GradeBulkResult,
    GradeBulkUpsert,
    GradeCreate,
    GradeUpdate,
    GradeWriteOut,
    ItemGradesStudentRow,
    ItemGradesView,
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


def _get_owned_item(db: Session, user_id: UUID, item_id: UUID) -> Item:
    item = (
        db.query(Item)
        .filter(Item.id == item_id, Item.user_id == user_id)
        .one_or_none()
    )
    if item is None:
        raise _not_found("item")
    return item


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


def _check_semester_writable(
    db: Session, user_id: UUID, semester_id: UUID
) -> None:
    """Block writes targeting a non-current semester (issue #55)."""
    sem = (
        db.query(Semester)
        .filter(Semester.id == semester_id, Semester.user_id == user_id)
        .one_or_none()
    )
    if sem is None or not sem.is_current:
        raise _archived_forbidden()


def _award_points_for(db: Session, grade: Grade) -> int:
    """Return the points just attached to this grade by auto-award, or 0."""
    rec = (
        db.query(PointRecord)
        .filter(PointRecord.source_grade_id == grade.id)
        .one_or_none()
    )
    return rec.points if rec else 0


@router.get("/api/items/{item_id}/grades", response_model=ItemGradesView)
def get_item_grades(
    item_id: UUID,
    classroom_id: Annotated[UUID, Query()],
    user_id: Annotated[UUID, Depends(require_user_id)],
    db: Annotated[Session, Depends(get_db)],
) -> ItemGradesView:
    """Return the item's grades for ONE classroom's roster. Items are global
    per teacher; the caller picks which class they're entering scores for."""
    item = _get_owned_item(db, user_id, item_id)
    classroom = (
        db.query(Classroom)
        .filter(Classroom.id == classroom_id, Classroom.user_id == user_id)
        .one_or_none()
    )
    if classroom is None:
        raise _not_found("classroom")
    subj = db.get(Subject, item.subject_id)
    cat = db.get(Category, item.category_id)

    roster = (
        db.query(Student)
        .filter(
            Student.classroom_id == classroom_id,
            Student.user_id == user_id,
        )
        .order_by(Student.seat_number.asc())
        .all()
    )
    roster_ids = {s.id for s in roster}
    grades_by_student: dict[UUID, Grade] = (
        {
            g.student_id: g
            for g in db.query(Grade)
            .filter(
                Grade.item_id == item.id,
                Grade.student_id.in_(roster_ids),
            )
            .all()
        }
        if roster_ids
        else {}
    )

    return ItemGradesView(
        item_id=item.id,
        item_name=item.name,
        subject_id=item.subject_id,
        subject_system_key=subj.system_key if subj else None,
        subject_display_name=subj.display_name if subj else None,
        category_system_key=cat.system_key if cat else "",
        semester_id=item.semester_id,
        classroom_id=classroom_id,
        students=[
            ItemGradesStudentRow(
                student_id=s.id,
                seat_number=s.seat_number,
                name=s.name,
                grade_id=grades_by_student[s.id].id if s.id in grades_by_student else None,
                score=(
                    float(grades_by_student[s.id].score)
                    if s.id in grades_by_student
                    else None
                ),
            )
            for s in roster
        ],
    )


@router.post(
    "/api/grades",
    response_model=GradeWriteOut,
    status_code=status.HTTP_201_CREATED,
)
def create_grade(
    body: GradeCreate,
    user_id: Annotated[UUID, Depends(require_user_id)],
    db: Annotated[Session, Depends(get_db)],
) -> GradeWriteOut:
    item = _get_owned_item(db, user_id, body.item_id)
    _check_semester_writable(db, user_id, item.semester_id)
    student = (
        db.query(Student)
        .filter(
            Student.id == body.student_id,
            Student.user_id == user_id,
        )
        .one_or_none()
    )
    if student is None:
        raise _bad_request(
            "errors.grade.student_not_found",
            "Student not found.",
        )
    existing = (
        db.query(Grade)
        .filter(Grade.item_id == item.id, Grade.student_id == student.id)
        .one_or_none()
    )
    if existing is not None:
        existing.score = Decimal(str(body.score))
        grade = existing
    else:
        grade = Grade(
            user_id=user_id,
            item_id=item.id,
            student_id=student.id,
            score=Decimal(str(body.score)),
            source="manual",
        )
        db.add(grade)
    db.flush()
    apply_auto_award(db, user_id, [grade])
    db.commit()
    db.refresh(grade)
    return GradeWriteOut(
        id=grade.id,
        item_id=grade.item_id,
        student_id=grade.student_id,
        score=float(grade.score),
        awarded_points=_award_points_for(db, grade),
    )


@router.put("/api/grades/{grade_id}", response_model=GradeWriteOut)
def update_grade(
    grade_id: UUID,
    body: GradeUpdate,
    user_id: Annotated[UUID, Depends(require_user_id)],
    db: Annotated[Session, Depends(get_db)],
) -> GradeWriteOut:
    grade = (
        db.query(Grade)
        .filter(Grade.id == grade_id, Grade.user_id == user_id)
        .one_or_none()
    )
    if grade is None:
        raise _not_found("grade")
    item = db.get(Item, grade.item_id)
    if item is not None:
        _check_semester_writable(db, user_id, item.semester_id)
    grade.score = Decimal(str(body.score))
    db.flush()
    apply_auto_award(db, user_id, [grade])
    db.commit()
    db.refresh(grade)
    return GradeWriteOut(
        id=grade.id,
        item_id=grade.item_id,
        student_id=grade.student_id,
        score=float(grade.score),
        awarded_points=_award_points_for(db, grade),
    )


@router.delete("/api/grades/{grade_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_grade(
    grade_id: UUID,
    user_id: Annotated[UUID, Depends(require_user_id)],
    db: Annotated[Session, Depends(get_db)],
) -> None:
    grade = (
        db.query(Grade)
        .filter(Grade.id == grade_id, Grade.user_id == user_id)
        .one_or_none()
    )
    if grade is None:
        raise _not_found("grade")
    item = db.get(Item, grade.item_id)
    if item is not None:
        _check_semester_writable(db, user_id, item.semester_id)
    db.delete(grade)  # cascade removes the linked point_record
    db.commit()


@router.post("/api/grades/bulk", response_model=GradeBulkResult)
def bulk_upsert_grades(
    body: GradeBulkUpsert,
    user_id: Annotated[UUID, Depends(require_user_id)],
    db: Annotated[Session, Depends(get_db)],
) -> GradeBulkResult:
    """Upsert / delete many grades at once for one item.

    Each entry:
      - `score = null` → if a grade exists for this student on this item,
        delete it (cascade revokes the linked point_record).
      - otherwise → upsert the grade and run auto-award.
    """
    item = _get_owned_item(db, user_id, body.item_id)
    _check_semester_writable(db, user_id, item.semester_id)
    if not body.entries:
        return GradeBulkResult(written=0, deleted=0, awarded=0, revoked=0)

    # Verify every student belongs to this teacher; cross-classroom is fine
    # because items are global per teacher.
    student_ids = {e.student_id for e in body.entries}
    valid_students = {
        s.id
        for s in db.query(Student)
        .filter(
            Student.id.in_(student_ids),
            Student.user_id == user_id,
        )
        .all()
    }

    existing_by_student: dict[UUID, Grade] = {
        g.student_id: g
        for g in db.query(Grade)
        .filter(Grade.item_id == item.id, Grade.student_id.in_(student_ids))
        .all()
    }

    pre_award_grade_ids = {
        g.id for g in existing_by_student.values()
    }
    pre_award_records = {
        r.source_grade_id
        for r in db.query(PointRecord)
        .filter(PointRecord.source_grade_id.in_(pre_award_grade_ids))
        .all()
        if r.source_grade_id is not None
    } if pre_award_grade_ids else set()

    written_grades: list[Grade] = []
    written = 0
    deleted = 0
    for e in body.entries:
        if e.student_id not in valid_students:
            continue
        existing = existing_by_student.get(e.student_id)
        if e.score is None:
            if existing is not None:
                db.delete(existing)
                deleted += 1
            continue
        if existing is None:
            g = Grade(
                user_id=user_id,
                item_id=item.id,
                student_id=e.student_id,
                score=Decimal(str(e.score)),
                source="manual",
            )
            db.add(g)
            written_grades.append(g)
        else:
            existing.score = Decimal(str(e.score))
            written_grades.append(existing)
        written += 1

    db.flush()
    apply_auto_award(db, user_id, written_grades)
    db.flush()

    # Compute award / revoke deltas vs the pre-write snapshot.
    post_record_grade_ids = {
        r.source_grade_id
        for r in db.query(PointRecord)
        .filter(PointRecord.source_grade_id.in_({g.id for g in written_grades}))
        .all()
        if r.source_grade_id is not None
    } if written_grades else set()
    awarded = len(post_record_grade_ids - pre_award_records)
    revoked = len(pre_award_records - post_record_grade_ids)

    db.commit()
    return GradeBulkResult(
        written=written, deleted=deleted, awarded=awarded, revoked=revoked,
    )
