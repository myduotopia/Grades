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
    default_semester_dates,
)
from models.grading import SubjectPointRule
from models.settings import UserSettings
from schemas import MeSettingsUpdate, SeedResult, SubjectOrderUpdate

DEFAULT_POINTS_AWARDED = 100

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
        start_date, end_date = default_semester_dates(academic_year, term, 2)
        db.add(
            Semester(
                user_id=user_id,
                academic_year=academic_year,
                term=term,
                is_current=True,
                start_date=start_date,
                end_date=end_date,
            )
        )
        semesters_created = 1

    # User settings: ensure a row exists with the default terms_per_year=2.
    if db.get(UserSettings, user_id) is None:
        db.add(UserSettings(user_id=user_id))

    # Subject × category weights: fill any missing combinations using the
    # per-subject profile. Must run after Category rows above are flushed so
    # we can resolve their ids.
    db.flush()
    _seed_subject_weights(db, user_id)
    _seed_subject_point_rules(db, user_id)

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


def _seed_subject_point_rules(db: Session, user_id: UUID) -> None:
    """Fill missing subject_point_rule rows for the user.

    Idempotent: walks all subjects visible to the user (built-ins +
    user-owned) and inserts a default row (points_awarded=100) for any subject
    that doesn't already have one.
    """
    subjects = (
        db.query(Subject)
        .filter((Subject.user_id.is_(None)) | (Subject.user_id == user_id))
        .all()
    )
    existing = {
        row.subject_id
        for row in db.query(SubjectPointRule)
        .filter(SubjectPointRule.user_id == user_id)
        .all()
    }
    for s in subjects:
        if s.id in existing:
            continue
        db.add(
            SubjectPointRule(
                user_id=user_id,
                subject_id=s.id,
                points_awarded=DEFAULT_POINTS_AWARDED,
            )
        )


@router.patch("/settings")
def update_settings(
    body: MeSettingsUpdate,
    user_id: Annotated[UUID, Depends(require_user_id)],
    db: Annotated[Session, Depends(get_db)],
) -> dict[str, int]:
    """Upsert the user's preferences. Currently only `terms_per_year`."""
    settings = db.get(UserSettings, user_id)
    if settings is None:
        settings = UserSettings(user_id=user_id, terms_per_year=body.terms_per_year)
        db.add(settings)
    else:
        settings.terms_per_year = body.terms_per_year
    db.commit()
    return {"terms_per_year": settings.terms_per_year}


@router.put("/subject-order")
def update_subject_order(
    body: SubjectOrderUpdate,
    user_id: Annotated[UUID, Depends(require_user_id)],
    db: Annotated[Session, Depends(get_db)],
) -> dict[str, list[str]]:
    """Persist the teacher's chosen ordering for non-academic subjects.

    `subject_ids` is filtered to subjects the user can see (built-ins or
    their own custom rows); anything else is dropped silently. Stored as
    strings since JSONB can't natively hold UUID objects.
    """
    visible = {
        s.id
        for s in db.query(Subject)
        .filter((Subject.user_id.is_(None)) | (Subject.user_id == user_id))
        .all()
    }
    cleaned: list[str] = []
    seen: set[UUID] = set()
    for sid in body.subject_ids:
        if sid in visible and sid not in seen:
            cleaned.append(str(sid))
            seen.add(sid)
    settings = db.get(UserSettings, user_id)
    if settings is None:
        settings = UserSettings(user_id=user_id, subject_order=cleaned)
        db.add(settings)
    else:
        settings.subject_order = cleaned
    db.commit()
    return {"subject_order": cleaned}
