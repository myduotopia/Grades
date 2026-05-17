"""Item CRUD — items are cross-classroom (one row per
(user, subject, category, semester, name); see migration b5c6d7e8f9a0)."""
from __future__ import annotations

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from auth import require_user_id
from database import get_db
from models.curriculum import Category, Item, Semester, Subject
from models.grading import Grade, PointRecord
from schemas import (
    ItemCreate,
    ItemDetailList,
    ItemDetailOut,
    ItemUpdate,
)

router = APIRouter()


def _not_found() -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_404_NOT_FOUND,
        detail={
            "error": {
                "code": "NOT_FOUND",
                "message_key": "errors.item.not_found",
                "message": "Item not found.",
            }
        },
    )


def _conflict(message_key: str, message: str) -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_409_CONFLICT,
        detail={
            "error": {
                "code": "CONFLICT",
                "message_key": message_key,
                "message": message,
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


def _validate_refs(
    db: Session,
    user_id: UUID,
    subject_id: UUID,
    category_id: UUID,
    semester_id: UUID,
) -> None:
    """Verify every FK the caller passed resolves to a row this user owns."""
    if (
        db.query(Subject.id)
        .filter(
            Subject.id == subject_id,
            (Subject.user_id.is_(None)) | (Subject.user_id == user_id),
        )
        .first()
        is None
    ):
        raise _bad_request("errors.item.subject_invalid", "Unknown subject.")
    if (
        db.query(Category.id)
        .filter(Category.id == category_id, Category.user_id == user_id)
        .first()
        is None
    ):
        raise _bad_request("errors.item.category_invalid", "Unknown category.")
    if (
        db.query(Semester.id)
        .filter(Semester.id == semester_id, Semester.user_id == user_id)
        .first()
        is None
    ):
        raise _bad_request("errors.item.semester_invalid", "Unknown semester.")


@router.get("/api/items", response_model=ItemDetailList)
def list_items(
    user_id: Annotated[UUID, Depends(require_user_id)],
    db: Annotated[Session, Depends(get_db)],
    semester_id: Annotated[UUID | None, Query()] = None,
    subject_id: Annotated[UUID | None, Query()] = None,
    category_id: Annotated[UUID | None, Query()] = None,
) -> ItemDetailList:
    q = db.query(Item).filter(Item.user_id == user_id)
    if semester_id is not None:
        q = q.filter(Item.semester_id == semester_id)
    if subject_id is not None:
        q = q.filter(Item.subject_id == subject_id)
    if category_id is not None:
        q = q.filter(Item.category_id == category_id)
    items = q.all()

    if not items:
        return ItemDetailList(data=[])

    subj_ids = {i.subject_id for i in items}
    cat_ids = {i.category_id for i in items}
    subj_by_id = {
        s.id: s for s in db.query(Subject).filter(Subject.id.in_(subj_ids)).all()
    }
    cat_by_id = {
        c.id: c for c in db.query(Category).filter(Category.id.in_(cat_ids)).all()
    }

    item_ids = [i.id for i in items]
    grade_counts = dict(
        db.query(Grade.item_id, func.count(Grade.id))
        .filter(Grade.item_id.in_(item_ids))
        .group_by(Grade.item_id)
        .all()
    )
    point_counts_rows = (
        db.query(Grade.item_id, func.count(PointRecord.id))
        .join(PointRecord, PointRecord.source_grade_id == Grade.id)
        .filter(Grade.item_id.in_(item_ids))
        .group_by(Grade.item_id)
        .all()
    )
    point_counts = {iid: cnt for iid, cnt in point_counts_rows}

    return ItemDetailList(
        data=[
            ItemDetailOut(
                id=i.id,
                name=i.name,
                subject_id=i.subject_id,
                subject_system_key=(
                    subj_by_id[i.subject_id].system_key
                    if i.subject_id in subj_by_id
                    else None
                ),
                subject_display_name=(
                    subj_by_id[i.subject_id].display_name
                    if i.subject_id in subj_by_id
                    else None
                ),
                category_id=i.category_id,
                category_system_key=(
                    cat_by_id[i.category_id].system_key
                    if i.category_id in cat_by_id
                    else ""
                ),
                semester_id=i.semester_id,
                grade_count=int(grade_counts.get(i.id, 0)),
                point_record_count=int(point_counts.get(i.id, 0)),
            )
            for i in items
        ]
    )


@router.post(
    "/api/items",
    response_model=ItemDetailOut,
    status_code=status.HTTP_201_CREATED,
)
def create_item(
    body: ItemCreate,
    user_id: Annotated[UUID, Depends(require_user_id)],
    db: Annotated[Session, Depends(get_db)],
) -> ItemDetailOut:
    _validate_refs(
        db, user_id, body.subject_id, body.category_id, body.semester_id,
    )
    item = Item(
        user_id=user_id,
        subject_id=body.subject_id,
        category_id=body.category_id,
        semester_id=body.semester_id,
        name=body.name.strip(),
    )
    db.add(item)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise _conflict(
            "errors.item.duplicate_name",
            "An item with this name already exists for this subject + category + semester.",
        )
    db.refresh(item)
    return _detail_for(db, item)


@router.put("/api/items/{item_id}", response_model=ItemDetailOut)
def update_item(
    item_id: UUID,
    body: ItemUpdate,
    user_id: Annotated[UUID, Depends(require_user_id)],
    db: Annotated[Session, Depends(get_db)],
) -> ItemDetailOut:
    item = (
        db.query(Item)
        .filter(Item.id == item_id, Item.user_id == user_id)
        .one_or_none()
    )
    if item is None:
        raise _not_found()
    item.name = body.name.strip()
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise _conflict(
            "errors.item.duplicate_name",
            "An item with this name already exists for this subject + category + semester.",
        )
    db.refresh(item)
    return _detail_for(db, item)


@router.delete("/api/items/{item_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_item(
    item_id: UUID,
    user_id: Annotated[UUID, Depends(require_user_id)],
    db: Annotated[Session, Depends(get_db)],
) -> None:
    item = (
        db.query(Item)
        .filter(Item.id == item_id, Item.user_id == user_id)
        .one_or_none()
    )
    if item is None:
        raise _not_found()
    db.delete(item)
    db.commit()


def _detail_for(db: Session, item: Item) -> ItemDetailOut:
    """Build one ItemDetailOut, used by POST/PUT to echo back."""
    subj = db.get(Subject, item.subject_id)
    cat = db.get(Category, item.category_id)
    grade_count = (
        db.query(func.count(Grade.id)).filter(Grade.item_id == item.id).scalar()
    ) or 0
    point_count = (
        db.query(func.count(PointRecord.id))
        .join(Grade, PointRecord.source_grade_id == Grade.id)
        .filter(Grade.item_id == item.id)
        .scalar()
    ) or 0
    return ItemDetailOut(
        id=item.id,
        name=item.name,
        subject_id=item.subject_id,
        subject_system_key=subj.system_key if subj else None,
        subject_display_name=subj.display_name if subj else None,
        category_id=item.category_id,
        category_system_key=cat.system_key if cat else "",
        semester_id=item.semester_id,
        grade_count=int(grade_count),
        point_record_count=int(point_count),
    )
