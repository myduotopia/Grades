"""Grade-item edit locks (#264).

One lock per (classroom, item) — "someone is entering 期中考 for 七年一班".
Rules (user-confirmed, see the #264 plan):

- **Teacher first.** A teacher can always edit: if a 小老師 holds the lock
  the teacher may take it over (`takeover=True`, the UI asks first). A
  小老師 can never take a lock someone else holds, and never a teacher's.
- **Expiry by the DB clock.** A lock is live while `expires_at > now()`.
  Heartbeats (the acquire call repeated every ~25 s) push it `TTL` ahead,
  so a closed laptop / lost connection frees it within 90 s. The 5-minute
  idle release is done by the frontend (it stops heart-beating and releases).
- **Same person = same holder.** Holder identity is the auth account, so
  two tabs of the same teacher (or 小老師) share one lock; acquiring when
  the lock is free OR already yours renews it.
- **Writes check it in their own transaction** (`assert_writable`, with
  SELECT ... FOR UPDATE): a teacher is refused only when someone ELSE holds
  a live lock (Excel import / older pages never need to take one); a
  小老師 must hold the lock themself.
- Only live grades (snapshot_id IS NULL) are locked; snapshots are not.

Errors: **409** `errors.grade.item_locked` with
`details = {holder_role, holder_name, locks: [{item_id, holder_role,
holder_name}]}` (holder_* null when the caller simply doesn't hold the lock).
The holder's auth account id is never part of any response.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import timedelta
from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy import func, or_, true
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session

from models.grading import GradeItemLock

# Server-side expiry: a lock not renewed for this long is free again.
LOCK_TTL = timedelta(seconds=90)


@dataclass(frozen=True)
class LockView:
    """A live lock as shown to clients (no holder account id)."""
    item_id: UUID
    holder_role: str
    holder_name: str | None
    mine: bool


def item_locked_error(
    blockers: list[LockView | UUID],
    item_names: dict[UUID, str] | None = None,
) -> HTTPException:
    """409 for one or more items. A bare UUID entry = "you don't hold this
    lock and nobody else does either" (holder unknown → null)."""
    locks = []
    for b in blockers:
        if isinstance(b, LockView):
            entry = {
                "item_id": str(b.item_id),
                "holder_role": b.holder_role,
                "holder_name": b.holder_name,
            }
        else:
            entry = {"item_id": str(b), "holder_role": None, "holder_name": None}
        if item_names is not None:
            entry["item_name"] = item_names.get(
                b.item_id if isinstance(b, LockView) else b
            )
        locks.append(entry)
    first = locks[0] if locks else {"holder_role": None, "holder_name": None}
    return HTTPException(
        status_code=status.HTTP_409_CONFLICT,
        detail={
            "error": {
                "code": "CONFLICT",
                "message_key": "errors.grade.item_locked",
                "message": "Someone else is editing this grade item.",
                "details": {
                    "holder_role": first["holder_role"],
                    "holder_name": first["holder_name"],
                    "locks": locks,
                },
            }
        },
    )


def _view(lock: GradeItemLock, user_id: UUID) -> LockView:
    return LockView(
        item_id=lock.item_id,
        holder_role=lock.holder_role,
        holder_name=lock.holder_name,
        mine=lock.holder_user_id == user_id,
    )


def live_locks(
    db: Session,
    classroom_id: UUID,
    user_id: UUID,
    item_ids: list[UUID] | None = None,
) -> list[LockView]:
    """Live (unexpired) locks in a class, optionally limited to some items."""
    # populate_existing: the conditional upserts above bypass the ORM, so
    # never trust a cached GradeItemLock object from earlier in the request.
    q = db.query(GradeItemLock).populate_existing().filter(
        GradeItemLock.classroom_id == classroom_id,
        GradeItemLock.expires_at > func.now(),
    )
    if item_ids is not None:
        if not item_ids:
            return []
        q = q.filter(GradeItemLock.item_id.in_(item_ids))
    return [_view(lk, user_id) for lk in q.all()]


def acquire(
    db: Session,
    classroom_id: UUID,
    item_ids: list[UUID],
    *,
    user_id: UUID,
    role: str,
    name: str | None,
    takeover: bool = False,
) -> list[LockView]:
    """Take (or renew) the locks on `item_ids`, all or nothing.

    Per item: a conditional upsert that only lands when the lock is free,
    expired, or already ours — or unconditionally with `takeover` (teacher
    only; callers must never pass it for an assistant). Concurrent
    acquirers serialise on the unique (classroom_id, item_id) row. On any
    failure the 409 is raised and the request's transaction (which never
    commits) discards the locks already taken in this call.
    """
    if role != "teacher" and takeover:
        raise ValueError("only a teacher can take over a lock")
    blocked: list[UUID] = []
    # Fixed order → two multi-item acquirers can't deadlock each other.
    for item_id in sorted(set(item_ids), key=str):
        ins = pg_insert(GradeItemLock).values(
            classroom_id=classroom_id,
            item_id=item_id,
            holder_user_id=user_id,
            holder_role=role,
            holder_name=name,
            expires_at=func.now() + LOCK_TTL,
        )
        stmt = ins.on_conflict_do_update(
            constraint="uq_grade_item_lock_classroom_item",
            set_={
                "holder_user_id": ins.excluded.holder_user_id,
                "holder_role": ins.excluded.holder_role,
                "holder_name": ins.excluded.holder_name,
                "expires_at": ins.excluded.expires_at,
                "updated_at": func.now(),
            },
            where=(
                true()
                if takeover
                else or_(
                    GradeItemLock.expires_at <= func.now(),
                    GradeItemLock.holder_user_id == user_id,
                )
            ),
        ).returning(GradeItemLock.id)
        if db.execute(stmt).scalar_one_or_none() is None:
            blocked.append(item_id)
    if blocked:
        holders = {
            v.item_id: v for v in live_locks(db, classroom_id, user_id, blocked)
        }
        raise item_locked_error([holders.get(i, i) for i in blocked])
    return live_locks(db, classroom_id, user_id, list(item_ids))


def release(
    db: Session, classroom_id: UUID, item_ids: list[UUID], user_id: UUID
) -> None:
    """Drop the caller's own locks on these items. Someone else's lock is
    never touched (and the caller isn't told whether one existed)."""
    if not item_ids:
        return
    db.query(GradeItemLock).filter(
        GradeItemLock.classroom_id == classroom_id,
        GradeItemLock.item_id.in_(item_ids),
        GradeItemLock.holder_user_id == user_id,
    ).delete(synchronize_session=False)


def assert_writable(
    db: Session,
    classroom_id: UUID,
    item_ids: list[UUID],
    *,
    user_id: UUID,
    require_held: bool,
    item_names: dict[UUID, str] | None = None,
) -> None:
    """Gate for every live-grade write; call inside the write's transaction
    BEFORE writing. Row-locks the lock rows (FOR UPDATE) so a takeover
    can't interleave with the write.

    - teacher (`require_held=False`): refused only when someone else holds
      a live lock on any of the items;
    - 小老師 (`require_held=True`): must hold a live lock on every item.
    """
    ids = list(dict.fromkeys(item_ids))
    if not ids:
        return
    rows = (
        db.query(GradeItemLock, (GradeItemLock.expires_at > func.now()).label("live"))
        .filter(
            GradeItemLock.classroom_id == classroom_id,
            GradeItemLock.item_id.in_(ids),
        )
        # Same row order as acquire (by item_id) so two writers locking
        # overlapping item sets can't deadlock.
        .order_by(GradeItemLock.item_id)
        .with_for_update(of=GradeItemLock)
        .populate_existing()
        .all()
    )
    by_item = {lk.item_id: (lk, live) for lk, live in rows}
    blockers: list[LockView | UUID] = []
    for item_id in ids:
        lk, live = by_item.get(item_id, (None, False))
        if lk is not None and live and lk.holder_user_id != user_id:
            blockers.append(_view(lk, user_id))
        elif require_held and not (lk is not None and live):
            blockers.append(item_id)
    if blockers:
        raise item_locked_error(blockers, item_names)
