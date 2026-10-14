"""Teacher side: which 小老師 may enter which item (#262).

GET/PUT /api/items/{item_id}/assistants. Items are per teacher and
cross-classroom, so the candidates are the 小老師 of ALL the teacher's
classes; an assistant can later only write students of their own class.
"""
from __future__ import annotations

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from assistant_access import not_found
from auth import require_user_id
from database import get_db
from models.access import ClassAssistant, ItemAssistant
from models.classroom import Classroom, Student
from models.curriculum import ClassroomItem, Item, Semester
from schemas import ItemAssistantCandidate, ItemAssistantsUpdate, ItemAssistantsView

router = APIRouter()


def _owned_item(db: Session, user_id: UUID, item_id: UUID) -> Item:
    item = (
        db.query(Item)
        .filter(Item.id == item_id, Item.user_id == user_id)
        .one_or_none()
    )
    if item is None:
        raise not_found("item")
    return item


def _writable(db: Session, user_id: UUID, item: Item) -> bool:
    sem = (
        db.query(Semester)
        .filter(Semester.id == item.semester_id, Semester.user_id == user_id)
        .one_or_none()
    )
    return bool(sem and sem.is_current)


def _view(db: Session, user_id: UUID, item: Item) -> ItemAssistantsView:
    rows = (
        db.query(Student, Classroom)
        .join(ClassAssistant, ClassAssistant.student_id == Student.id)
        .join(Classroom, Classroom.id == ClassAssistant.classroom_id)
        .filter(
            ClassAssistant.user_id == user_id,
            Student.user_id == user_id,
            Classroom.user_id == user_id,
            Student.classroom_id == ClassAssistant.classroom_id,
        )
        .order_by(Classroom.grade, Classroom.name, Student.seat_number)
        .all()
    )
    active_classrooms = {
        cid
        for (cid,) in db.query(ClassroomItem.classroom_id).filter(
            ClassroomItem.item_id == item.id,
            ClassroomItem.user_id == user_id,
            ClassroomItem.snapshot_id.is_(None),
        )
    }
    assigned = [
        sid
        for (sid,) in db.query(ItemAssistant.student_id).filter(
            ItemAssistant.item_id == item.id, ItemAssistant.user_id == user_id
        )
    ]
    return ItemAssistantsView(
        item_id=item.id,
        writable=_writable(db, user_id, item),
        assigned_student_ids=assigned,
        candidates=[
            ItemAssistantCandidate(
                student_id=s.id,
                seat_number=s.seat_number,
                name=s.name,
                classroom_id=c.id,
                classroom_grade=c.grade,
                classroom_name=c.name,
                item_active=c.id in active_classrooms,
            )
            for s, c in rows
        ],
    )


@router.get("/api/items/{item_id}/assistants", response_model=ItemAssistantsView)
def get_item_assistants(
    item_id: UUID,
    user_id: Annotated[UUID, Depends(require_user_id)],
    db: Annotated[Session, Depends(get_db)],
) -> ItemAssistantsView:
    return _view(db, user_id, _owned_item(db, user_id, item_id))


@router.put("/api/items/{item_id}/assistants", response_model=ItemAssistantsView)
def put_item_assistants(
    item_id: UUID,
    body: ItemAssistantsUpdate,
    user_id: Annotated[UUID, Depends(require_user_id)],
    db: Annotated[Session, Depends(get_db)],
) -> ItemAssistantsView:
    """Replace the set of 小老師 allowed to enter this item.

    Each id must be a current 小老師 of one of the teacher's classes in
    which the item is live (activated, not archived). Archived semester →
    403 `errors.semester.archived`; invalid ids → 400
    `errors.assistant.invalid_assignment` with `details.student_ids`.
    """
    item = _owned_item(db, user_id, item_id)
    view = _view(db, user_id, item)
    if not view.writable:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={
                "error": {
                    "code": "FORBIDDEN",
                    "message_key": "errors.semester.archived",
                    "message": "This semester is archived and read-only.",
                }
            },
        )
    eligible = {c.student_id for c in view.candidates if c.item_active}
    # Keep already-assigned ids that are merely not eligible right now
    # (e.g. the item was archived in that class) from blocking the save;
    # they are dropped only if the teacher leaves them out.
    already = set(view.assigned_student_ids)
    wanted = set(body.student_ids)
    invalid = sorted(str(s) for s in wanted - eligible - already)
    if invalid:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={
                "error": {
                    "code": "BAD_REQUEST",
                    "message_key": "errors.assistant.invalid_assignment",
                    "message": "Some students cannot be assigned to this item.",
                    "details": {"student_ids": invalid},
                }
            },
        )
    to_remove = already - wanted
    if to_remove:
        db.query(ItemAssistant).filter(
            ItemAssistant.item_id == item.id,
            ItemAssistant.user_id == user_id,
            ItemAssistant.student_id.in_(to_remove),
        ).delete(synchronize_session=False)
    for sid in wanted - already:
        db.add(ItemAssistant(user_id=user_id, item_id=item.id, student_id=sid))
    db.commit()
    return _view(db, user_id, item)
