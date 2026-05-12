"""Category read + weight update.

Categories themselves are seeded per-user (5 system_keys, fixed). Only their
`weight` can be edited. Sum-to-100 validation is the front-end's job.
"""
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from auth import require_user_id
from database import get_db
from models.curriculum import SYSTEM_CATEGORY_KEYS, Category
from schemas import CategoryList, CategoryOut, CategoryWeightUpdate

router = APIRouter()

# Canonical display order: 段考 → 小考 → 作業 → 出席率 → 額外加分.
# Alphabetical sort by system_key is wrong (puts attendance/extra first),
# and front-ends should not have to re-sort.
_CANONICAL_INDEX: dict[str, int] = {
    key: idx for idx, key in enumerate(SYSTEM_CATEGORY_KEYS)
}


def _by_canonical_order(c: Category) -> int:
    return _CANONICAL_INDEX[c.system_key]


@router.get("", response_model=CategoryList)
def list_categories(
    user_id: Annotated[UUID, Depends(require_user_id)],
    db: Annotated[Session, Depends(get_db)],
) -> CategoryList:
    rows = db.query(Category).filter(Category.user_id == user_id).all()
    rows.sort(key=_by_canonical_order)
    return CategoryList(data=[CategoryOut.model_validate(r) for r in rows])


@router.put("/weights", response_model=CategoryList)
def update_weights(
    payload: list[CategoryWeightUpdate],
    user_id: Annotated[UUID, Depends(require_user_id)],
    db: Annotated[Session, Depends(get_db)],
) -> CategoryList:
    """Batch update weights by system_key. Unknown keys → 404.

    Sum-to-100 is enforced by the front-end. Per-row 0..100 is enforced by
    the DB CHECK; pydantic also clamps via Field(ge=0, le=100).
    """
    rows = {
        c.system_key: c
        for c in db.query(Category).filter(Category.user_id == user_id).all()
    }

    for item in payload:
        cat = rows.get(item.system_key)
        if cat is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail={
                    "error": {
                        "code": "NOT_FOUND",
                        "message_key": "errors.category.not_found",
                        "message": f"Unknown category system_key: {item.system_key}",
                    }
                },
            )
        cat.weight = item.weight

    db.commit()
    for c in rows.values():
        db.refresh(c)
    ordered = sorted(rows.values(), key=_by_canonical_order)
    return CategoryList(data=[CategoryOut.model_validate(r) for r in ordered])
