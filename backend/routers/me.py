"""User-scoped utility endpoints (seeding, identity)."""
from datetime import date
from typing import Annotated
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from auth import require_user_id
from database import get_db
from models.classroom import Classroom
from models.curriculum import (
    SUBJECT_WEIGHT_PROFILES,
    SYSTEM_CATEGORY_DEFAULTS,
    Category,
    Item,
    Semester,
    Subject,
    SubjectCategoryWeight,
    default_semester_dates,
)
from models.grading import (
    PointRecord,
    PointRule,
    StudentStandard,
    SubjectPointRule,
)
from models.settings import UserSettings
from schemas import (
    ItemOrderUpdate,
    MeSettingsUpdate,
    PointReasonOut,
    PointReasonsUpdate,
    SeedResult,
    SubjectOrderUpdate,
)

DEFAULT_POINTS_AWARDED = 100

# System-managed reasons. Pinned to the top of every user's point_reasons
# list; cannot be renamed or deleted. Identified by `system_key`. Auto-award
# (apply_auto_award in routers/grades.py) writes PointRecord rows whose
# `reason` text starts with the system reason name.
SYSTEM_POINT_REASONS: list[dict] = [
    {"system_key": "meeting_standard", "name": "達成標準", "default_points": 0},
]

# Seed list when a user first onboards (or runs /api/me/reset). Teachers can
# rename / delete / add via /admin/reasons.
DEFAULT_POINT_REASONS: list[dict] = [
    {"name": "主動發問", "default_points": 3},
    {"name": "幫助同學", "default_points": 2},
    {"name": "課堂表現好", "default_points": 2},
    {"name": "值日生", "default_points": 1},
    {"name": "作業優秀", "default_points": 3},
    {"name": "上課講話", "default_points": -1},
]


def _new_default_reasons() -> list[dict]:
    """SYSTEM + DEFAULT reasons with fresh uuid ids. System rows go first."""
    system = [
        {
            "id": str(uuid4()),
            "name": r["name"],
            "default_points": r["default_points"],
            "system_key": r["system_key"],
        }
        for r in SYSTEM_POINT_REASONS
    ]
    user_seed = [
        {"id": str(uuid4()), "name": r["name"], "default_points": r["default_points"]}
        for r in DEFAULT_POINT_REASONS
    ]
    return system + user_seed

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

    # User settings: ensure a row exists with the default terms_per_year=2
    # and a starter point_reasons list (idempotent — only fills if empty).
    settings_row = db.get(UserSettings, user_id)
    if settings_row is None:
        db.add(UserSettings(
            user_id=user_id,
            point_reasons=_new_default_reasons(),
        ))
    elif not settings_row.point_reasons:
        settings_row.point_reasons = _new_default_reasons()

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


@router.put("/item-order")
def update_item_order(
    body: ItemOrderUpdate,
    user_id: Annotated[UUID, Depends(require_user_id)],
    db: Annotated[Session, Depends(get_db)],
) -> dict[str, list[str]]:
    """Persist the teacher's chosen ordering for /admin/items rows.

    `item_ids` is filtered to items owned by this user; anything else is
    dropped silently. Stored as strings since JSONB can't natively hold UUID.
    """
    visible = {
        i.id
        for i in db.query(Item).filter(Item.user_id == user_id).all()
    }
    cleaned: list[str] = []
    seen: set[UUID] = set()
    for iid in body.item_ids:
        if iid in visible and iid not in seen:
            cleaned.append(str(iid))
            seen.add(iid)
    settings = db.get(UserSettings, user_id)
    if settings is None:
        settings = UserSettings(user_id=user_id, item_order=cleaned)
        db.add(settings)
    else:
        settings.item_order = cleaned
    db.commit()
    return {"item_order": cleaned}


@router.post("/reset", response_model=SeedResult)
def reset(
    user_id: Annotated[UUID, Depends(require_user_id)],
    db: Annotated[Session, Depends(get_db)],
) -> SeedResult:
    """Wipe every row this user owns and re-seed defaults (issue #13).

    Order matters because some tables hold their own user_id (so cascade
    isn't enough): we clean those explicitly, then let FK CASCADE handle the
    rest via Classroom → Student → Grade / PointRecord / StudentStandard
    and Item → Grade.
    """
    # Wide rows owned directly by the user — clear them up front. Cascade
    # then takes care of children.
    db.query(PointRecord).filter(PointRecord.user_id == user_id).delete()
    db.query(StudentStandard).filter(StudentStandard.user_id == user_id).delete()
    db.query(SubjectPointRule).filter(SubjectPointRule.user_id == user_id).delete()
    db.query(SubjectCategoryWeight).filter(
        SubjectCategoryWeight.user_id == user_id
    ).delete()
    db.query(PointRule).filter(PointRule.user_id == user_id).delete()
    # Classrooms own students which own grades — one delete reaches all of
    # them via CASCADE.
    db.query(Classroom).filter(Classroom.user_id == user_id).delete()
    # Items live independently of classroom now; clear them explicitly.
    db.query(Item).filter(Item.user_id == user_id).delete()
    db.query(Semester).filter(Semester.user_id == user_id).delete()
    db.query(Category).filter(Category.user_id == user_id).delete()
    # Custom subjects (built-ins have user_id IS NULL — leave alone).
    db.query(Subject).filter(Subject.user_id == user_id).delete()
    # User-level prefs.
    db.query(UserSettings).filter(UserSettings.user_id == user_id).delete()
    db.flush()

    # Re-seed defaults using the same logic as POST /api/me/seed.
    categories_created = 0
    for key, weight in SYSTEM_CATEGORY_DEFAULTS:
        db.add(Category(user_id=user_id, system_key=key, weight=weight))
        categories_created += 1
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
    db.add(UserSettings(
        user_id=user_id,
        point_reasons=_new_default_reasons(),
    ))
    db.flush()
    _seed_subject_weights(db, user_id)
    _seed_subject_point_rules(db, user_id)
    db.commit()
    return SeedResult(categories_created=categories_created, semesters_created=1)


@router.put("/point-reasons")
def update_point_reasons(
    body: PointReasonsUpdate,
    user_id: Annotated[UUID, Depends(require_user_id)],
    db: Annotated[Session, Depends(get_db)],
) -> dict[str, list[dict]]:
    """Replace the user's manual-point reasons list (#84).

    Each entry is `{id, name, default_points, system_key?}`. Server normalises
    name (strip + length 1..50) and clamps default_points to -100..100;
    entries that fail validation are dropped silently rather than failing the
    whole payload so a single bad row never blocks a save.

    System-managed entries (`system_key` not None — e.g. "達成標準") are
    immutable: client-sent rows targeting them by id are dropped, and the
    DB's existing system rows are re-prepended at the top. If a user has
    never seen the latest seed, missing system rows are added too.
    """
    settings = db.get(UserSettings, user_id)
    existing = settings.point_reasons if settings else []
    existing_system_by_id = {
        e["id"]: e for e in existing if e.get("system_key")
    }
    system_keys_present = {
        e["system_key"] for e in existing_system_by_id.values()
    }

    # Always keep the user's existing system rows verbatim.
    system_rows: list[dict] = list(existing_system_by_id.values())
    # Fill in any system reason the user is missing (idempotent self-heal).
    for sr in SYSTEM_POINT_REASONS:
        if sr["system_key"] not in system_keys_present:
            system_rows.append({
                "id": str(uuid4()),
                "name": sr["name"],
                "default_points": sr["default_points"],
                "system_key": sr["system_key"],
            })

    cleaned: list[dict] = []
    seen_ids: set[str] = {e["id"] for e in system_rows}
    for r in body.reasons:
        # Client cannot modify system rows by id.
        if r.id in existing_system_by_id:
            continue
        name = r.name.strip()
        if not name or len(name) > 50:
            continue
        if r.id in seen_ids:
            continue
        pts = max(-100, min(100, int(r.default_points)))
        cleaned.append({
            "id": r.id,
            "name": name,
            "default_points": pts,
        })
        seen_ids.add(r.id)

    final = system_rows + cleaned

    if settings is None:
        settings = UserSettings(user_id=user_id, point_reasons=final)
        db.add(settings)
    else:
        settings.point_reasons = final
    db.commit()
    return {"point_reasons": final}
