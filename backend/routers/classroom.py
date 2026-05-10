"""Classroom CRUD. All operations scoped to the authenticated user."""
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from auth import require_user_id
from database import get_db
from models.classroom import Classroom, Student
from schemas import (
    ClassroomCreate,
    ClassroomDetailOut,
    ClassroomList,
    ClassroomOut,
    ClassroomUpdate,
    ListMeta,
)

router = APIRouter()


def _duplicate_name_error() -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_409_CONFLICT,
        detail={
            "error": {
                "code": "CONFLICT",
                "message_key": "errors.classroom.duplicate_name",
                "message": "A classroom with this name already exists.",
            }
        },
    )


def _not_found_error() -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_404_NOT_FOUND,
        detail={
            "error": {
                "code": "NOT_FOUND",
                "message_key": "errors.classroom.not_found",
                "message": "Classroom not found.",
            }
        },
    )


def _get_owned(db: Session, user_id: UUID, classroom_id: UUID) -> Classroom:
    classroom = (
        db.query(Classroom)
        .filter(Classroom.id == classroom_id, Classroom.user_id == user_id)
        .one_or_none()
    )
    if classroom is None:
        raise _not_found_error()
    return classroom


@router.get("", response_model=ClassroomList)
def list_classrooms(
    user_id: Annotated[UUID, Depends(require_user_id)],
    db: Annotated[Session, Depends(get_db)],
) -> ClassroomList:
    rows = (
        db.query(Classroom)
        .filter(Classroom.user_id == user_id)
        .order_by(Classroom.created_at.asc())
        .all()
    )
    return ClassroomList(
        data=[ClassroomOut.model_validate(r) for r in rows],
        meta=ListMeta(total=len(rows)),
    )


@router.post(
    "",
    response_model=ClassroomOut,
    status_code=status.HTTP_201_CREATED,
)
def create_classroom(
    body: ClassroomCreate,
    user_id: Annotated[UUID, Depends(require_user_id)],
    db: Annotated[Session, Depends(get_db)],
) -> ClassroomOut:
    classroom = Classroom(user_id=user_id, name=body.name, source="manual")
    db.add(classroom)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise _duplicate_name_error()
    db.refresh(classroom)
    return ClassroomOut.model_validate(classroom)


@router.get("/{classroom_id}", response_model=ClassroomDetailOut)
def get_classroom(
    classroom_id: UUID,
    user_id: Annotated[UUID, Depends(require_user_id)],
    db: Annotated[Session, Depends(get_db)],
) -> ClassroomDetailOut:
    classroom = _get_owned(db, user_id, classroom_id)
    student_count = db.scalar(
        select(func.count(Student.id)).where(Student.classroom_id == classroom_id)
    ) or 0
    return ClassroomDetailOut(
        **ClassroomOut.model_validate(classroom).model_dump(),
        student_count=student_count,
    )


@router.put("/{classroom_id}", response_model=ClassroomOut)
def update_classroom(
    classroom_id: UUID,
    body: ClassroomUpdate,
    user_id: Annotated[UUID, Depends(require_user_id)],
    db: Annotated[Session, Depends(get_db)],
) -> ClassroomOut:
    classroom = _get_owned(db, user_id, classroom_id)
    classroom.name = body.name
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise _duplicate_name_error()
    db.refresh(classroom)
    return ClassroomOut.model_validate(classroom)


@router.delete("/{classroom_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_classroom(
    classroom_id: UUID,
    user_id: Annotated[UUID, Depends(require_user_id)],
    db: Annotated[Session, Depends(get_db)],
) -> None:
    classroom = _get_owned(db, user_id, classroom_id)
    db.delete(classroom)
    db.commit()
