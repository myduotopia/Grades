"""Subjects + per-subject category weights.

This page replaces the old "category weights" admin page. Each teacher has
9 built-in subjects (seeded by migration, user_id IS NULL) plus zero or more
custom subjects they create. Every (teacher × subject × category) has a weight
row used for weighted-total computation on the grades view.
"""
from __future__ import annotations

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from auth import require_user_id
from database import get_db
from models.curriculum import (
    CUSTOM_SUBJECT_DEFAULT_PROFILE,
    Category,
    Subject,
    SubjectCategoryWeight,
)
from models.grading import SubjectPointRule
from schemas import (
    SubjectCreate,
    SubjectList,
    SubjectOut,
    SubjectPointRuleOut,
    SubjectPointRulesList,
    SubjectPointRuleUpdate,
    SubjectWeightOut,
    SubjectWeightsList,
    SubjectWeightsUpdate,
)

# Default points-awarded for a newly-seeded (user × subject) row. Matches the
# legacy per-category point_rule default of 100.
DEFAULT_POINTS_AWARDED = 100

router = APIRouter()


def _not_found() -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_404_NOT_FOUND,
        detail={
            "error": {
                "code": "NOT_FOUND",
                "message_key": "errors.subject.not_found",
                "message": "Subject not found.",
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


def _forbidden(message_key: str, message: str) -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail={
            "error": {
                "code": "FORBIDDEN",
                "message_key": message_key,
                "message": message,
            }
        },
    )


# ---------- Subjects CRUD ----------

@router.get("/api/subjects", response_model=SubjectList)
def list_subjects(
    user_id: Annotated[UUID, Depends(require_user_id)],
    db: Annotated[Session, Depends(get_db)],
) -> SubjectList:
    """Return all subjects visible to the user — global built-ins + the user's
    own custom subjects.
    """
    rows = (
        db.query(Subject)
        .filter((Subject.user_id.is_(None)) | (Subject.user_id == user_id))
        .order_by(Subject.system_key.asc().nulls_last(), Subject.display_name.asc())
        .all()
    )
    return SubjectList(
        data=[
            SubjectOut(
                id=s.id,
                system_key=s.system_key,
                display_name=s.display_name,
                is_custom=s.user_id is not None,
            )
            for s in rows
        ]
    )


@router.post(
    "/api/subjects",
    response_model=SubjectOut,
    status_code=status.HTTP_201_CREATED,
)
def create_subject(
    body: SubjectCreate,
    user_id: Annotated[UUID, Depends(require_user_id)],
    db: Annotated[Session, Depends(get_db)],
) -> SubjectOut:
    subject = Subject(
        user_id=user_id,
        system_key=None,
        display_name=body.display_name.strip(),
    )
    db.add(subject)
    try:
        db.flush()
    except IntegrityError:
        db.rollback()
        raise _conflict(
            "errors.subject.duplicate_name",
            "A subject with this name already exists.",
        )

    # Seed weight rows using the custom-subject default profile.
    cats = db.query(Category).filter(Category.user_id == user_id).all()
    for c in cats:
        weight = CUSTOM_SUBJECT_DEFAULT_PROFILE.get(c.system_key, 0)
        db.add(
            SubjectCategoryWeight(
                user_id=user_id,
                subject_id=subject.id,
                category_id=c.id,
                weight=weight,
            )
        )
    # Seed the per-subject point rule with the default amount.
    db.add(
        SubjectPointRule(
            user_id=user_id,
            subject_id=subject.id,
            points_awarded=DEFAULT_POINTS_AWARDED,
        )
    )
    db.commit()
    db.refresh(subject)
    return SubjectOut(
        id=subject.id,
        system_key=None,
        display_name=subject.display_name,
        is_custom=True,
    )


@router.delete("/api/subjects/{subject_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_subject(
    subject_id: UUID,
    user_id: Annotated[UUID, Depends(require_user_id)],
    db: Annotated[Session, Depends(get_db)],
) -> None:
    s = db.query(Subject).filter(Subject.id == subject_id).one_or_none()
    if s is None:
        raise _not_found()
    if s.user_id is None:
        raise _forbidden(
            "errors.subject.builtin_not_deletable",
            "Built-in subjects cannot be deleted.",
        )
    if s.user_id != user_id:
        raise _not_found()  # don't leak existence
    db.delete(s)
    db.commit()


# ---------- Weights matrix ----------

@router.get("/api/subject-weights", response_model=SubjectWeightsList)
def list_weights(
    user_id: Annotated[UUID, Depends(require_user_id)],
    db: Annotated[Session, Depends(get_db)],
) -> SubjectWeightsList:
    rows = (
        db.query(SubjectCategoryWeight)
        .filter(SubjectCategoryWeight.user_id == user_id)
        .all()
    )
    # Resolve subject + category lookups so the response is self-describing.
    sub_ids = {r.subject_id for r in rows}
    cat_ids = {r.category_id for r in rows}
    subj_by_id = {
        s.id: s
        for s in db.query(Subject).filter(Subject.id.in_(sub_ids)).all()
    }
    cat_by_id = {
        c.id: c
        for c in db.query(Category).filter(Category.id.in_(cat_ids)).all()
    }
    return SubjectWeightsList(
        data=[
            SubjectWeightOut(
                subject_id=r.subject_id,
                subject_system_key=(
                    subj_by_id[r.subject_id].system_key
                    if r.subject_id in subj_by_id
                    else None
                ),
                subject_display_name=(
                    subj_by_id[r.subject_id].display_name
                    if r.subject_id in subj_by_id
                    else None
                ),
                category_id=r.category_id,
                category_system_key=(
                    cat_by_id[r.category_id].system_key
                    if r.category_id in cat_by_id
                    else ""
                ),
                weight=r.weight,
            )
            for r in rows
        ]
    )


# ---------- Per-subject points-awarded ----------

@router.get("/api/subject-point-rules", response_model=SubjectPointRulesList)
def list_point_rules(
    user_id: Annotated[UUID, Depends(require_user_id)],
    db: Annotated[Session, Depends(get_db)],
) -> SubjectPointRulesList:
    rows = (
        db.query(SubjectPointRule)
        .filter(SubjectPointRule.user_id == user_id)
        .all()
    )
    return SubjectPointRulesList(
        data=[
            SubjectPointRuleOut(
                subject_id=r.subject_id,
                points_awarded=r.points_awarded,
            )
            for r in rows
        ]
    )


@router.put("/api/subject-point-rules", response_model=SubjectPointRulesList)
def update_point_rules(
    payload: list[SubjectPointRuleUpdate],
    user_id: Annotated[UUID, Depends(require_user_id)],
    db: Annotated[Session, Depends(get_db)],
) -> SubjectPointRulesList:
    """Bulk upsert per-subject points-awarded. Unknown subject_ids (no existing
    row) are inserted; existing rows are updated. Subjects not in the payload
    are left untouched."""
    wanted = {e.subject_id: e.points_awarded for e in payload}
    if not wanted:
        return list_point_rules(user_id, db)

    existing_rows = (
        db.query(SubjectPointRule)
        .filter(
            SubjectPointRule.user_id == user_id,
            SubjectPointRule.subject_id.in_(wanted.keys()),
        )
        .all()
    )
    existing_by_subject = {r.subject_id: r for r in existing_rows}

    # Only insert for subjects owned by / visible to this user. Built-ins
    # (user_id NULL) are visible to everyone; custom subjects belong to one user.
    valid_subjects = {
        s.id
        for s in db.query(Subject)
        .filter(
            Subject.id.in_(wanted.keys()),
            (Subject.user_id.is_(None)) | (Subject.user_id == user_id),
        )
        .all()
    }

    for sid, pts in wanted.items():
        if sid not in valid_subjects:
            continue
        row = existing_by_subject.get(sid)
        if row is None:
            db.add(
                SubjectPointRule(
                    user_id=user_id,
                    subject_id=sid,
                    points_awarded=pts,
                )
            )
        elif row.points_awarded != pts:
            row.points_awarded = pts
    db.commit()
    return list_point_rules(user_id, db)


# ---------- Weights matrix (PUT) ----------

@router.put("/api/subject-weights", response_model=SubjectWeightsList)
def update_weights(
    payload: list[SubjectWeightsUpdate],
    user_id: Annotated[UUID, Depends(require_user_id)],
    db: Annotated[Session, Depends(get_db)],
) -> SubjectWeightsList:
    """Bulk update weights. Each entry = (subject_id, category_id, weight).

    Unknown (subject_id, category_id) pairs (rows that don't exist yet) are
    silently ignored — the seed flow should have created them already.
    Sum-to-100 across non-extra is the frontend's responsibility.
    """
    # Build a dict for quick lookup of incoming entries
    wanted = {(e.subject_id, e.category_id): e.weight for e in payload}
    rows = (
        db.query(SubjectCategoryWeight)
        .filter(SubjectCategoryWeight.user_id == user_id)
        .all()
    )
    for r in rows:
        new_w = wanted.get((r.subject_id, r.category_id))
        if new_w is not None and 0 <= new_w <= 100 and new_w != r.weight:
            r.weight = new_w
    db.commit()
    return list_weights(user_id, db)
