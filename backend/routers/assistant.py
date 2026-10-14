"""Student 小老師 endpoints — /api/assistant/* (#262).

Deliberately separate from the teacher grade-entry routes: the teacher flow
is untouched, and every request here goes through `resolve_actor`, which
derives the OWNING teacher from class_assistant / item_assistant. The
student's own JWT sub is only ever written to `entered_by_user_id`.

Rules (all enforced here, not just hidden in the UI):
- only items assigned to this assistant, live in their own class, in the
  teacher's current semester (archived = invisible → 404 like "not found");
- only students of the assistant's own class;
- may enter their own score and overwrite other assistants' scores;
- may NOT change a score last written by the teacher (403);
- may NOT delete / clear scores (no DELETE route; null scores rejected);
- bulk: no snapshot_id, never activates the item, all-or-nothing;
- every write needs the item's edit lock in that class (#264): taken with
  POST /api/assistant/items/:id/lock (the pencil), renewed by repeating it;
  a teacher's lock (or another assistant's) -> 409 errors.grade.item_locked.
"""
from __future__ import annotations

from decimal import ROUND_HALF_UP, Decimal
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import text
from sqlalchemy.orm import Session

import item_lock

from assistant_access import (
    Actor,
    contexts_for_students,
    not_found,
    resolve_actor,
    visible_items_query,
)
from auth import require_user_id
from database import get_db
from models.classroom import Classroom, Student
from models.curriculum import Category, Item, Subject
from models.grading import SCORE_QUANTUM, Grade, insert_live_grades
from routers.grades import apply_auto_award, assistant_names, grade_stamp_fields
from schemas import (
    AssistantContextItemOut,
    AssistantContextOut,
    AssistantGradeBulk,
    AssistantGradeCreate,
    AssistantGradeUpdate,
    AssistantItemGradesView,
    AssistantLockState,
    GradeBulkResult,
    GradeWriteOut,
    ItemGradesStudentRow,
)

router = APIRouter()

UserId = Annotated[UUID, Depends(require_user_id)]
Db = Annotated[Session, Depends(get_db)]


def _teacher_entered() -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail={
            "error": {
                "code": "FORBIDDEN",
                "message_key": "errors.assistant.teacher_grade_locked",
                "message": "This score was entered by the teacher.",
            }
        },
    )


def _write_conflict() -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_409_CONFLICT,
        detail={
            "error": {
                "code": "CONFLICT",
                "message_key": "errors.assistant.write_conflict",
                "message": "This score was just changed by someone else. Refresh and try again.",
            }
        },
    )


def _q(score: float) -> Decimal:
    return Decimal(str(score)).quantize(SCORE_QUANTUM, rounding=ROUND_HALF_UP)


def _changes_teacher_score(existing: Grade | None, score: float) -> bool:
    """True when writing `score` would overwrite a teacher-entered value.
    Re-sending the same score is a harmless no-op, not a violation."""
    return (
        existing is not None
        and existing.entered_by_role == "teacher"
        and Decimal(existing.score) != _q(score)
    )


def _live_grade(db: Session, actor: Actor, student_id: UUID) -> Grade | None:
    return (
        db.query(Grade)
        .filter(
            Grade.item_id == actor.item.id,
            Grade.student_id == student_id,
            Grade.user_id == actor.owner_user_id,
            Grade.snapshot_id.is_(None),
        )
        .one_or_none()
    )


def _write(db: Session, actor: Actor, existing: Grade, score: float) -> Grade:
    """Overwrite an existing live grade as this assistant (the stamp moves
    only when the score changes -- see Grade.write_score)."""
    existing.write_score(Decimal(str(score)), actor.actor_user_id, "assistant")
    return existing


def _new_row(actor: Actor, student_id: UUID, score: float) -> dict:
    return {
        "user_id": actor.owner_user_id,  # NEVER the assistant's sub
        "item_id": actor.item.id,
        "student_id": student_id,
        "score": _q(score),
        "source": "manual",
        "entered_by_user_id": actor.actor_user_id,
        "entered_by_role": "assistant",
    }


def _fetch_live(db: Session, actor: Actor, student_ids: list[UUID]) -> dict[UUID, Grade]:
    return {
        g.student_id: g
        for g in db.query(Grade).filter(
            Grade.item_id == actor.item.id,
            Grade.user_id == actor.owner_user_id,
            Grade.student_id.in_(student_ids or [None]),
            Grade.snapshot_id.is_(None),
        )
    }


def _require_lock(db: Session, actor: Actor) -> None:
    """The caller must hold this item's edit lock in their class (#264)."""
    item_lock.assert_writable(
        db,
        actor.classroom_id,
        [actor.item.id],
        user_id=actor.actor_user_id,
        require_held=True,
    )


def _write_out(grade: Grade) -> GradeWriteOut:
    return GradeWriteOut(
        id=grade.id,
        item_id=grade.item_id,
        student_id=grade.student_id,
        score=float(grade.score),
        awarded_points=0,  # points are the teacher's business; not exposed
        # Auth account ids are never sent to assistants (the role is enough).
        entered_by_user_id=None,
        entered_by_role=grade.entered_by_role,
        entered_at=grade.entered_at,
        updated_at=grade.updated_at,
    )


def _stamp(grade: Grade, names: dict) -> dict:
    """grade_stamp_fields without the writer's auth account id."""
    return {**grade_stamp_fields(grade, names), "entered_by_user_id": None}


def _teacher_labels(db: Session, owner_ids: set[UUID]) -> dict[UUID, str]:
    """Teacher display names from Supabase auth (Google full name). Read in
    a savepoint so a permission problem can't poison the request's
    transaction; any failure just means no label."""
    if not owner_ids:
        return {}
    try:
        with db.begin_nested():
            rows = db.execute(
                text(
                    "SELECT id, COALESCE(raw_user_meta_data->>'full_name', "
                    "raw_user_meta_data->>'name') FROM auth.users "
                    "WHERE id = ANY(:ids)"
                ),
                {"ids": list(owner_ids)},
            ).all()
    except Exception:
        return {}
    return {uid: name for uid, name in rows if name}


def build_assistant_contexts(
    db: Session, students: list[Student]
) -> list[AssistantContextOut]:
    """`identity.assistant_contexts` for GET /api/me — one per class where
    the student is a 小老師, with only the items they can currently see
    (assigned, live in the class, current semester). A context with no
    items is still listed so the page can say "nothing assigned yet".

    `students` = the caller's `identity.sync_self_links` result; GET /api/me
    syncs once and passes it here (and to build_identity)."""
    ctxs = contexts_for_students(db, students)
    labels = _teacher_labels(db, {c.owner_user_id for c in ctxs})
    out: list[AssistantContextOut] = []
    for ctx in ctxs:
        items = visible_items_query(db, ctx).order_by(Item.created_at.asc()).all()
        classroom = db.get(Classroom, ctx.classroom_id)
        if classroom is None:
            continue
        subj = (
            {
                s.id: s
                for s in db.query(Subject).filter(
                    Subject.id.in_({i.subject_id for i in items})
                )
            }
            if items
            else {}
        )
        cats = (
            {
                c.id: c.system_key
                for c in db.query(Category).filter(
                    Category.id.in_({i.category_id for i in items})
                )
            }
            if items
            else {}
        )
        out.append(
            AssistantContextOut(
                classroom_id=classroom.id,
                classroom_grade=classroom.grade,
                classroom_name=classroom.name,
                teacher_label=labels.get(ctx.owner_user_id),
                student_id=ctx.student_id,
                student_name=ctx.student.name,
                items=[
                    AssistantContextItemOut(
                        item_id=i.id,
                        item_name=i.name,
                        subject_id=i.subject_id,
                        subject_system_key=(
                            subj[i.subject_id].system_key if i.subject_id in subj else None
                        ),
                        subject_display_name=(
                            subj[i.subject_id].display_name if i.subject_id in subj else None
                        ),
                        category_system_key=cats.get(i.category_id, ""),
                    )
                    for i in items
                ],
            )
        )
    return out


@router.get(
    "/api/assistant/items/{item_id}/grades", response_model=AssistantItemGradesView
)
def assistant_item_grades(
    item_id: UUID,
    classroom_id: Annotated[UUID, Query()],
    user_id: UserId,
    db: Db,
) -> AssistantItemGradesView:
    """The item's live scores for the assistant's whole class (names, seat
    numbers, scores, stamps — no email, no other items, no totals, no
    semester id, no auth account ids)."""
    actor = resolve_actor(db, user_id, item_id, classroom_id)
    item = actor.item
    roster = (
        db.query(Student)
        .filter(
            Student.classroom_id == actor.classroom_id,
            Student.user_id == actor.owner_user_id,
        )
        .order_by(Student.seat_number.asc())
        .all()
    )
    grades = {
        g.student_id: g
        for g in db.query(Grade).filter(
            Grade.item_id == item.id,
            Grade.user_id == actor.owner_user_id,
            Grade.student_id.in_([s.id for s in roster] or [None]),
            Grade.snapshot_id.is_(None),
        )
    }
    names = assistant_names(db, list(grades.values()))
    subj = db.get(Subject, item.subject_id)
    cat = db.get(Category, item.category_id)
    return AssistantItemGradesView(
        item_id=item.id,
        item_name=item.name,
        subject_id=item.subject_id,
        subject_system_key=subj.system_key if subj else None,
        subject_display_name=subj.display_name if subj else None,
        category_system_key=cat.system_key if cat else "",
        classroom_id=actor.classroom_id,
        students=[
            ItemGradesStudentRow(
                student_id=s.id,
                seat_number=s.seat_number,
                name=s.name,
                grade_id=grades[s.id].id if s.id in grades else None,
                score=float(grades[s.id].score) if s.id in grades else None,
                **(_stamp(grades[s.id], names) if s.id in grades else {}),
            )
            for s in roster
        ],
    )


@router.post(
    "/api/assistant/grades",
    response_model=GradeWriteOut,
    status_code=status.HTTP_201_CREATED,
)
def assistant_create_grade(
    body: AssistantGradeCreate, user_id: UserId, db: Db
) -> GradeWriteOut:
    actor = resolve_actor(db, user_id, body.item_id, body.classroom_id)
    if body.student_id not in actor.allowed_student_ids:
        raise not_found("student")
    _require_lock(db, actor)
    existing = _live_grade(db, actor, body.student_id)
    if _changes_teacher_score(existing, body.score):
        raise _teacher_entered()
    if existing is not None:
        grade = _write(db, actor, existing, body.score)
    else:
        inserted = insert_live_grades(db, [_new_row(actor, body.student_id, body.score)])
        if (actor.item.id, body.student_id) in inserted:
            grade = _fetch_live(db, actor, [body.student_id])[body.student_id]
        else:
            # Someone (teacher or another assistant) created this cell
            # between our read and our insert -- the live unique index made
            # the INSERT a no-op (#264). Re-read it and apply the normal
            # rules to the row that now exists; never blindly overwrite.
            existing = _live_grade(db, actor, body.student_id)
            if existing is None:
                raise _write_conflict()
            if _changes_teacher_score(existing, body.score):
                raise _teacher_entered()
            grade = _write(db, actor, existing, body.score)
    db.flush()
    apply_auto_award(db, actor.owner_user_id, [grade])
    db.commit()
    db.refresh(grade)
    return _write_out(grade)


@router.put("/api/assistant/grades/{grade_id}", response_model=GradeWriteOut)
def assistant_update_grade(
    grade_id: UUID,
    body: AssistantGradeUpdate,
    user_id: UserId,
    db: Db,
) -> GradeWriteOut:
    grade = db.get(Grade, grade_id)
    if grade is None or grade.snapshot_id is not None:
        raise not_found("grade")
    student = db.get(Student, grade.student_id)
    if student is None:
        raise not_found("grade")
    try:
        actor = resolve_actor(
            db, user_id, grade.item_id, student.classroom_id
        )
    except HTTPException:
        raise not_found("grade")
    if (
        grade.user_id != actor.owner_user_id
        or grade.student_id not in actor.allowed_student_ids
    ):
        raise not_found("grade")
    _require_lock(db, actor)
    if _changes_teacher_score(grade, body.score):
        raise _teacher_entered()
    _write(db, actor, grade, body.score)
    db.flush()
    apply_auto_award(db, actor.owner_user_id, [grade])
    db.commit()
    db.refresh(grade)
    return _write_out(grade)


@router.post("/api/assistant/grades/bulk", response_model=GradeBulkResult)
def assistant_bulk_grades(
    body: AssistantGradeBulk, user_id: UserId, db: Db
) -> GradeBulkResult:
    actor = resolve_actor(db, user_id, body.item_id, body.classroom_id)
    if not body.entries:
        return GradeBulkResult(written=0, deleted=0, awarded=0, revoked=0)
    _require_lock(db, actor)

    existing = {
        g.student_id: g
        for g in db.query(Grade).filter(
            Grade.item_id == actor.item.id,
            Grade.user_id == actor.owner_user_id,
            Grade.student_id.in_(
                [e.student_id for e in body.entries if e.student_id in actor.allowed_student_ids]
                or [None]
            ),
            Grade.snapshot_id.is_(None),
        )
    }
    violations: list[dict[str, str]] = []
    seen: set[UUID] = set()
    for e in body.entries:
        if e.student_id in seen:
            violations.append({"student_id": str(e.student_id), "reason": "duplicate"})
        seen.add(e.student_id)
        if e.student_id not in actor.allowed_student_ids:
            violations.append({"student_id": str(e.student_id), "reason": "not_in_class"})
        elif _changes_teacher_score(existing.get(e.student_id), e.score):
            violations.append({"student_id": str(e.student_id), "reason": "teacher_entered"})
    if violations:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={
                "error": {
                    "code": "FORBIDDEN",
                    "message_key": "errors.assistant.forbidden_entries",
                    "message": "Some entries are not allowed; nothing was saved.",
                    "details": {"violations": violations},
                }
            },
        )

    written: list[Grade] = []
    new_cells: dict[UUID, float] = {}
    for e in body.entries:
        g = existing.get(e.student_id)
        if g is None:
            new_cells[e.student_id] = e.score
            continue
        if Decimal(g.score) == _q(e.score):
            continue  # unchanged -- don't touch stamps
        written.append(_write(db, actor, g, e.score))
    db.flush()
    if new_cells:
        inserted = insert_live_grades(
            db, [_new_row(actor, sid, score) for sid, score in new_cells.items()]
        )
        fresh = _fetch_live(db, actor, list(new_cells))
        for sid, score in new_cells.items():
            g = fresh.get(sid)
            if (actor.item.id, sid) in inserted and g is not None:
                written.append(g)
                continue
            # Created concurrently by someone else (#264): same rules as an
            # existing row; a teacher-entered value aborts the whole batch.
            if g is None or _changes_teacher_score(g, score):
                raise _write_conflict()
            if Decimal(g.score) != _q(score):
                written.append(_write(db, actor, g, score))
        db.flush()
    apply_auto_award(db, actor.owner_user_id, written)
    db.commit()
    return GradeBulkResult(written=len(written), deleted=0, awarded=0, revoked=0)


# ---------- edit lock (#264) ----------

def _lock_state(db: Session, actor: Actor, user_id: UUID) -> AssistantLockState:
    views = item_lock.live_locks(db, actor.classroom_id, user_id, [actor.item.id])
    if not views:
        return AssistantLockState(locked=False, mine=False, holder_role=None, holder_name=None)
    v = views[0]
    return AssistantLockState(
        locked=True, mine=v.mine, holder_role=v.holder_role, holder_name=v.holder_name
    )


@router.get(
    "/api/assistant/items/{item_id}/lock", response_model=AssistantLockState
)
def assistant_lock_state(
    item_id: UUID, classroom_id: Annotated[UUID, Query()], user_id: UserId, db: Db
) -> AssistantLockState:
    """Who is editing this item in the assistant's class (polled while the
    page is visible). Same uniform 404 as every other assistant route."""
    actor = resolve_actor(db, user_id, item_id, classroom_id)
    return _lock_state(db, actor, user_id)


@router.post(
    "/api/assistant/items/{item_id}/lock", response_model=AssistantLockState
)
def assistant_acquire_lock(
    item_id: UUID, classroom_id: Annotated[UUID, Query()], user_id: UserId, db: Db
) -> AssistantLockState:
    """Start editing (pencil) or renew (heartbeat). Succeeds when nobody
    holds a live lock or the caller already does; otherwise 409
    errors.grade.item_locked naming the holder. Never takes over."""
    actor = resolve_actor(db, user_id, item_id, classroom_id)
    item_lock.acquire(
        db,
        actor.classroom_id,
        [actor.item.id],
        user_id=user_id,
        role="assistant",
        name=actor.actor_name,
    )
    db.commit()
    return _lock_state(db, actor, user_id)


@router.delete(
    "/api/assistant/items/{item_id}/lock", status_code=status.HTTP_204_NO_CONTENT
)
def assistant_release_lock(
    item_id: UUID, classroom_id: Annotated[UUID, Query()], user_id: UserId, db: Db
) -> None:
    """Stop editing. Only ever deletes the CALLER's own lock row, so it is
    answered 204 without `resolve_actor`: it reveals nothing (same answer
    whether or not anything existed) and still works right after the role
    was revoked, freeing the item for others at once instead of after the
    90-second expiry."""
    item_lock.release(db, classroom_id, [item_id], user_id)
    db.commit()
