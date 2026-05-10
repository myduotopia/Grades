"""User-scoped utility endpoints (seeding, identity)."""
from datetime import date
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from auth import require_user_id
from database import get_db
from models.curriculum import SYSTEM_CATEGORY_KEYS, Category, Semester
from schemas import SeedResult

router = APIRouter()


# Display fallback names for system-default categories. Frontend prefers
# system_key for i18n; this `name` only matters when localizing fails and as
# the value enforced by the (user_id, name) UNIQUE constraint.
_SYSTEM_CATEGORY_NAMES: dict[str, str] = {
    "first_midterm": "第一次段考",
    "second_midterm": "第二次段考",
    "third_midterm": "第三次段考",
    "midterm": "期中考",
    "final": "期末考",
    "major_exam": "大考",
    "quiz": "小考",
    "homework": "作業",
}


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
    """Idempotent: create the 7 system categories + a current semester if missing."""
    existing_keys: set[str] = {
        key
        for (key,) in db.query(Category.system_key)
        .filter(Category.user_id == user_id, Category.is_system_default.is_(True))
        .all()
        if key is not None
    }

    categories_created = 0
    for key in SYSTEM_CATEGORY_KEYS:
        if key in existing_keys:
            continue
        db.add(
            Category(
                user_id=user_id,
                name=_SYSTEM_CATEGORY_NAMES[key],
                system_key=key,
                is_system_default=True,
            )
        )
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

    db.commit()
    return SeedResult(
        categories_created=categories_created,
        semesters_created=semesters_created,
    )
