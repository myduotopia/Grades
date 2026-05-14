"""User-scoped utility endpoints (seeding, identity)."""
from datetime import date
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from auth import require_user_id
from database import get_db
from models.curriculum import (
    SUBJECT_WEIGHT_PROFILES,
    SYSTEM_CATEGORY_DEFAULTS,
    Category,
    Semester,
    Subject,
    SubjectCategoryWeight,
)
from schemas import SeedResult

router = APIRouter()


def _default_semester_for(today: date) -> tuple[int, int]:
    """Return (academic_year_minguo, term) for the seed default.

    - Aug–Jan: 上學期 (term=1). Jan still belongs to the previous Aug's school year.
    - Feb–Jul: 下學期 (term=2).
    """
    minguo_year = today.year - 1911
    if today.month >= 8:
        return minguo_year, 1
    if today.month == 1:
        return minguo_year - 1, 1
    return minguo_year, 2


@router.post("/seed", response_model=SeedResult)
def seed(
    user_id: Annotated[UUID, Depends(require_user_id)],
    db: Annotated[Session, Depends(get_db)],
) -> SeedResult:
    """Idempotent: create the system categories + a current semester if missing.

    Subjects are global (seeded by migration, user_id IS NULL) — nothing per-user.
    """
    existing_keys: set[str] = {
        key
        for (key,) in db.query(Category.system_key)
        .filter(Category.user_id == user_id)
        .all()
    }

    categories_created = 0
    for key, weight in SYSTEM_CATEGORY_DEFAULTS:
        if key in existing_keys:
            continue
        db.add(Category(user_id=user_id, system_key=key, weight=weight))
        categories_created += 1

    semesters_created = 0
    has_semester = (
        db.query(Semester.id).filter(Semester.user_id == user_id).first() is not None
    )
    if not has_semester:
        academic_year, term = _default_semester_for(date.today())
        db.add(
            Semester(
                user_id=user_id,
                academic_year=academic_year,
                term=term,
                is_current=True,
            )
        )
        semesters_created = 1

    # Subject × category weights: fill any missing combinations using the
    # per-subject profile. Must run after Category rows above are flushed so
    # we can resolve their ids.
    db.flush()
    _seed_subject_weights(db, user_id)

    db.commit()
    return SeedResult(
        categories_created=categories_created,
        semesters_created=semesters_created,
    )


def _seed_subject_weights(db: Session, user_id: UUID) -> None:
    """Fill missing subject_category_weight rows for the user.

    Idempotent: walks all built-in subjects × all user categories and inserts
    only rows that don't yet exist. Custom subjects already have rows seeded
    at creation time (see /api/subjects POST).
    """
    cats = db.query(Category).filter(Category.user_id == user_id).all()
    cat_by_key = {c.system_key: c for c in cats}
    builtin_subjects = (
        db.query(Subject)
        .filter(Subject.user_id.is_(None), Subject.system_key.isnot(None))
        .all()
    )
    existing = {
        (row.subject_id, row.category_id)
        for row in db.query(SubjectCategoryWeight)
        .filter(SubjectCategoryWeight.user_id == user_id)
        .all()
    }
    for s in builtin_subjects:
        profile = SUBJECT_WEIGHT_PROFILES.get(s.system_key or "")
        if profile is None:
            continue
        for cat_key, weight in profile.items():
            cat = cat_by_key.get(cat_key)
            if cat is None:
                continue
            if (s.id, cat.id) in existing:
                continue
            db.add(
                SubjectCategoryWeight(
                    user_id=user_id,
                    subject_id=s.id,
                    category_id=cat.id,
                    weight=weight,
                )
            )
