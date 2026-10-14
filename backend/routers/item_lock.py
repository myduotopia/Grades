"""Teacher-side grade-item edit locks (#264). Rules live in `item_lock.py`.

The 小老師 side is in `routers/assistant.py` (`/api/assistant/items/:id/lock`)
and goes through `resolve_actor` like every other assistant route.
"""
from __future__ import annotations

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, status
from sqlalchemy.orm import Session

import item_lock
from auth import require_user_id
from database import get_db
from models.classroom import Classroom
from models.curriculum import Item, Semester
from routers.assistant import _teacher_labels
from routers.grade_entry import _archived_forbidden, _not_found
from schemas import ItemLockList, ItemLockOut, TeacherLockAcquire, TeacherLockRelease

router = APIRouter()

UserId = Annotated[UUID, Depends(require_user_id)]
Db = Annotated[Session, Depends(get_db)]


def _owned_classroom(db: Session, user_id: UUID, classroom_id: UUID) -> None:
    owned = (
        db.query(Classroom.id)
        .filter(Classroom.id == classroom_id, Classroom.user_id == user_id)
        .first()
    )
    if owned is None:
        raise _not_found("classroom")


def _check_items(db: Session, user_id: UUID, item_ids: list[UUID]) -> None:
    """Every item must be the teacher's (404 otherwise, like a missing id)
    and in the current semester (403 archived — same as the write paths)."""
    ids = set(item_ids)
    rows = (
        db.query(Item.id, Semester.is_current)
        .join(Semester, Semester.id == Item.semester_id)
        .filter(Item.id.in_(ids), Item.user_id == user_id)
        .all()
    )
    if len(rows) != len(ids):
        raise _not_found("item")
    if not all(is_current for _, is_current in rows):
        raise _archived_forbidden()


def _out(views: list[item_lock.LockView]) -> ItemLockList:
    return ItemLockList(
        locks=[
            ItemLockOut(
                item_id=v.item_id,
                holder_role=v.holder_role,
                holder_name=v.holder_name,
                mine=v.mine,
            )
            for v in views
        ]
    )


@router.get("/api/classrooms/{classroom_id}/item-locks", response_model=ItemLockList)
def list_item_locks(classroom_id: UUID, user_id: UserId, db: Db) -> ItemLockList:
    """Live locks in this class — the grades page polls this to show
    "○○（小老師）編輯中" on column headers."""
    _owned_classroom(db, user_id, classroom_id)
    return _out(item_lock.live_locks(db, classroom_id, user_id))


@router.post("/api/classrooms/{classroom_id}/item-locks", response_model=ItemLockList)
def acquire_item_locks(
    classroom_id: UUID, body: TeacherLockAcquire, user_id: UserId, db: Db
) -> ItemLockList:
    """Acquire or renew (heartbeat) the locks on `item_ids`, all or nothing.
    409 `errors.grade.item_locked` when a 小老師 holds one and `takeover`
    is false; with `takeover` the teacher's lock replaces theirs."""
    _owned_classroom(db, user_id, classroom_id)
    _check_items(db, user_id, body.item_ids)
    name = _teacher_labels(db, {user_id}).get(user_id)
    views = item_lock.acquire(
        db,
        classroom_id,
        body.item_ids,
        user_id=user_id,
        role="teacher",
        name=name,
        takeover=body.takeover,
    )
    db.commit()
    return _out(views)


@router.post(
    "/api/classrooms/{classroom_id}/item-locks/release",
    status_code=status.HTTP_204_NO_CONTENT,
)
def release_item_locks(
    classroom_id: UUID, body: TeacherLockRelease, user_id: UserId, db: Db
) -> None:
    """Drop the caller's own locks (others' are untouched). Sent with
    `fetch(..., {keepalive: true})` when the page is left."""
    _owned_classroom(db, user_id, classroom_id)
    item_lock.release(db, classroom_id, body.item_ids, user_id)
    db.commit()

