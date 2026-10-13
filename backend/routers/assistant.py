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
- bulk: no snapshot_id, never activates the item, all-or-nothing.
"""
from __future__ import annotations

from decimal import ROUND_HALF_UP, Decimal
from typing import Annotated, Any
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import text
from sqlalchemy.orm import Session

from assistant_access import (
    Actor,
    assistant_contexts,
    not_found,
    resolve_actor,
    visible_items_query,
)
from auth import get_current_user, require_user_id
from database import get_db
from models.classroom import Classroom, Student
from models.curriculum import Category, Item, Subject
from models.grading import SCORE_QUANTUM, Grade
from routers.grades import apply_auto_award, assistant_names, grade_stamp_fields
from schemas import (
    AssistantContextItemOut,
    AssistantContextOut,
    AssistantGradeBulk,
    AssistantGradeCreate,
    AssistantGradeUpdate,
    GradeBulkResult,
    GradeWriteOut,
    ItemGradesStudentRow,
    ItemGradesView,
)

router = APIRouter()

Payload = Annotated[dict[str, Any], Depends(get_current_user)]
UserId = Annotated[UUID, Depends(require_user_id)]
Db = Annotated[Session, Depends(get_db)]


def _locked() -> HTTPException:
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


def _write(
    db: Session, actor: Actor, student_id: UUID, existing: Grade | None, score: float
) -> Grade:
    if existing is not None:
        existing.write_score(Decimal(str(score)), actor.actor_user_id, "assistant")
        return existing
    g = Grade(
        user_id=actor.owner_user_id,  # NEVER the assistant's sub
        item_id=actor.item.id,
        student_id=student_id,
        score=_q(score),
        source="manual",
        entered_by_user_id=actor.actor_user_id,
        entered_by_role="assistant",
    )
    db.add(g)
    return g


def _write_out(grade: Grade) -> GradeWriteOut:
    return GradeWriteOut(
        id=grade.id,
        item_id=grade.item_id,
        student_id=grade.student_id,
        score=float(grade.score),
        awarded_points=0,  # points are the teacher's business; not exposed
        entered_by_user_id=grade.entered_by_user_id,
        entered_by_role=grade.entered_by_role,
        entered_at=grade.entered_at,
        updated_at=grade.updated_at,
    )


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
    db: Session, user_id: UUID, payload: dict[str, Any]
) -> list[AssistantContextOut]:
    """`identity.assistant_contexts` for GET /api/me — one per class where
    the student is a 小老師, with only the items they can currently see
    (assigned, live in the class, current semester). A context with no
    items is still listed so the page can say "nothing assigned yet"."""
    ctxs = assistant_contexts(db, user_id, payload)
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


@router.get("/api/assistant/items/{item_id}/grades", response_model=ItemGradesView)
def assistant_item_grades(
    item_id: UUID,
    classroom_id: Annotated[UUID, Query()],
    payload: Payload,
    user_id: UserId,
    db: Db,
) -> ItemGradesView:
    """The item's live scores for the assistant's whole class (names, seat
    numbers, scores, stamps — no email, no other items, no totals)."""
    actor = resolve_actor(db, user_id, payload, item_id, classroom_id)
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
    return ItemGradesView(
        item_id=item.id,
        item_name=item.name,
        subject_id=item.subject_id,
        subject_system_key=subj.system_key if subj else None,
        subject_display_name=subj.display_name if subj else None,
        category_system_key=cat.system_key if cat else "",
        semester_id=item.semester_id,
        classroom_id=actor.classroom_id,
        students=[
            ItemGradesStudentRow(
                student_id=s.id,
                seat_number=s.seat_number,
                name=s.name,
                grade_id=grades[s.id].id if s.id in grades else None,
                score=float(grades[s.id].score) if s.id in grades else None,
                **(grade_stamp_fields(grades[s.id], names) if s.id in grades else {}),
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
    body: AssistantGradeCreate, payload: Payload, user_id: UserId, db: Db
) -> GradeWriteOut:
    actor = resolve_actor(db, user_id, payload, body.item_id, body.classroom_id)
    if body.student_id not in actor.allowed_student_ids:
        raise not_found("student")
    existing = _live_grade(db, actor, body.student_id)
    if _changes_teacher_score(existing, body.score):
        raise _locked()
    grade = _write(db, actor, body.student_id, existing, body.score)
    db.flush()
    apply_auto_award(db, actor.owner_user_id, [grade])
    db.commit()
    db.refresh(grade)
    return _write_out(grade)


@router.put("/api/assistant/grades/{grade_id}", response_model=GradeWriteOut)
def assistant_update_grade(
    grade_id: UUID,
    body: AssistantGradeUpdate,
    payload: Payload,
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
            db, user_id, payload, grade.item_id, student.classroom_id
        )
    except HTTPException:
        raise not_found("grade")
    if (
        grade.user_id != actor.owner_user_id
        or grade.student_id not in actor.allowed_student_ids
    ):
        raise not_found("grade")
    if _changes_teacher_score(grade, body.score):
        raise _locked()
    _write(db, actor, grade.student_id, grade, body.score)
    db.flush()
    apply_auto_award(db, actor.owner_user_id, [grade])
    db.commit()
    db.refresh(grade)
    return _write_out(grade)


@router.post("/api/assistant/grades/bulk", response_model=GradeBulkResult)
def assistant_bulk_grades(
    body: AssistantGradeBulk, payload: Payload, user_id: UserId, db: Db
) -> GradeBulkResult:
    actor = resolve_actor(db, user_id, payload, body.item_id, body.classroom_id)
    if not body.entries:
        return GradeBulkResult(written=0, deleted=0, awarded=0, revoked=0)

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
    for e in body.entries:
        g = existing.get(e.student_id)
        if g is not None and Decimal(g.score) == _q(e.score):
            continue  # unchanged — don't touch stamps
        written.append(_write(db, actor, e.student_id, g, e.score))
    db.flush()
    apply_auto_award(db, actor.owner_user_id, written)
    db.commit()
    return GradeBulkResult(written=len(written), deleted=0, awarded=0, revoked=0)
