"""Semester management. All operations scoped to the authenticated user.

Design notes (issue #5):
- No DELETE: Taiwan semesters are fixed by the calendar; deletion is not a
  user-facing operation.
- No generic PUT: there are no editable fields (academic_year + term are
  structural, not free text).
- POST takes no body: the next slot is computed from the user's
  `terms_per_year` setting plus the highest existing (year, term).
- A dedicated `PUT /{id}/set-current` flips is_current; the same transaction
  clears any other current row for the user. The partial unique index
  `ix_semester_one_current_per_user` enforces at most one current per user.
"""
from datetime import date
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from auth import require_user_id
from database import get_db
from models.curriculum import Item, Semester
from models.settings import UserSettings
from schemas import ListMeta, SemesterList, SemesterOut, SemesterUpdate

router = APIRouter()


def _not_found_error() -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_404_NOT_FOUND,
        detail={
            "error": {
                "code": "NOT_FOUND",
                "message_key": "errors.semester.not_found",
                "message": "Semester not found.",
            }
        },
    )


def _duplicate_error() -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_409_CONFLICT,
        detail={
            "error": {
                "code": "CONFLICT",
                "message_key": "errors.semester.duplicate",
                "message": "This semester slot already exists.",
            }
        },
    )


def _delete_blocked_current() -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_409_CONFLICT,
        detail={
            "error": {
                "code": "CONFLICT",
                "message_key": "errors.semester.delete_current",
                "message": "Cannot delete the current semester. Set another as current first.",
            }
        },
    )


def _delete_blocked_has_items() -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_409_CONFLICT,
        detail={
            "error": {
                "code": "CONFLICT",
                "message_key": "errors.semester.delete_has_items",
                "message": "Cannot delete a semester that has tests/grades. Move them to another semester first.",
            }
        },
    )


def _get_terms_per_year(db: Session, user_id: UUID) -> int:
    settings = db.get(UserSettings, user_id)
    return settings.terms_per_year if settings else 2


def _next_slot(
    db: Session, user_id: UUID, terms_per_year: int
) -> tuple[int, int]:
    """Compute the next (academic_year, term) to create for this user.

    If the user has no semesters yet: start at (current minguo year, 1) based
    on today's calendar — see `_default_semester_for` in routers/me.py for the
    seed-time equivalent. Here we keep it simple: just pick the current
    minguo year.

    Otherwise: take the max (year, term) and increment term, rolling to next
    year when term > terms_per_year.
    """
    latest = (
        db.query(Semester)
        .filter(Semester.user_id == user_id)
        .order_by(Semester.academic_year.desc(), Semester.term.desc())
        .first()
    )
    if latest is None:
        return date.today().year - 1911, 1
    if latest.term < terms_per_year:
        return latest.academic_year, latest.term + 1
    return latest.academic_year + 1, 1


@router.get("", response_model=SemesterList)
def list_semesters(
    user_id: Annotated[UUID, Depends(require_user_id)],
    db: Annotated[Session, Depends(get_db)],
) -> SemesterList:
    rows = (
        db.query(Semester)
        .filter(Semester.user_id == user_id)
        .order_by(Semester.academic_year.asc(), Semester.term.asc())
        .all()
    )
    return SemesterList(
        data=[SemesterOut.model_validate(r) for r in rows],
        meta=ListMeta(total=len(rows)),
    )


@router.post(
    "",
    response_model=SemesterOut,
    status_code=status.HTTP_201_CREATED,
)
def create_semester(
    user_id: Annotated[UUID, Depends(require_user_id)],
    db: Annotated[Session, Depends(get_db)],
) -> SemesterOut:
    terms_per_year = _get_terms_per_year(db, user_id)
    academic_year, term = _next_slot(db, user_id, terms_per_year)
    semester = Semester(
        user_id=user_id,
        academic_year=academic_year,
        term=term,
        is_current=False,
    )
    db.add(semester)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise _duplicate_error()
    db.refresh(semester)
    return SemesterOut.model_validate(semester)


@router.put("/{semester_id}/set-current", response_model=SemesterOut)
def set_current(
    semester_id: UUID,
    user_id: Annotated[UUID, Depends(require_user_id)],
    db: Annotated[Session, Depends(get_db)],
) -> SemesterOut:
    target = (
        db.query(Semester)
        .filter(Semester.id == semester_id, Semester.user_id == user_id)
        .one_or_none()
    )
    if target is None:
        raise _not_found_error()

    # Clear any other current row first; the partial unique index
    # would otherwise prevent the flip from succeeding in one go.
    db.execute(
        update(Semester)
        .where(
            Semester.user_id == user_id,
            Semester.id != semester_id,
            Semester.is_current.is_(True),
        )
        .values(is_current=False)
    )
    target.is_current = True
    db.commit()
    db.refresh(target)
    return SemesterOut.model_validate(target)


@router.put("/{semester_id}", response_model=SemesterOut)
def update_semester(
    semester_id: UUID,
    body: SemesterUpdate,
    user_id: Annotated[UUID, Depends(require_user_id)],
    db: Annotated[Session, Depends(get_db)],
) -> SemesterOut:
    """Change a semester's (academic_year, term). Duplicate slot → 409."""
    target = (
        db.query(Semester)
        .filter(Semester.id == semester_id, Semester.user_id == user_id)
        .one_or_none()
    )
    if target is None:
        raise _not_found_error()
    target.academic_year = body.academic_year
    target.term = body.term
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise _duplicate_error()
    db.refresh(target)
    return SemesterOut.model_validate(target)


@router.delete("/{semester_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_semester(
    semester_id: UUID,
    user_id: Annotated[UUID, Depends(require_user_id)],
    db: Annotated[Session, Depends(get_db)],
) -> None:
    """Refuse if is_current or if any Item references this semester.

    Item.semester_id is NOT NULL FK; cascading delete would silently destroy
    the user's grade history, so we require an empty semester instead.
    """
    target = (
        db.query(Semester)
        .filter(Semester.id == semester_id, Semester.user_id == user_id)
        .one_or_none()
    )
    if target is None:
        raise _not_found_error()
    if target.is_current:
        raise _delete_blocked_current()
    has_items = (
        db.query(Item.id).filter(Item.semester_id == semester_id).first()
        is not None
    )
    if has_items:
        raise _delete_blocked_has_items()
    db.delete(target)
    db.commit()
