"""小老師 (student assistant) authorisation core (#262).

Two ids, never mixed up:
- `owner_user_id` — the TEACHER who owns the class / item / grades. Every
  ownership-scoped value (`Grade.user_id`, `ClassroomItem.user_id`,
  `apply_auto_award`, semester checks) uses this.
- `actor_user_id` — the student's own JWT `sub`. Used ONLY for the grade
  stamp (`entered_by_user_id`, with `entered_by_role='assistant'`).

What an assistant can see/write ("visible"), all of which must hold:
1. their Google identity email (auth.identities) matches the roster student's email right
   now (identity.sync_self_links — also keeps account_link in step);
2. `class_assistant` row for that student in the student's CURRENT class;
3. `item_assistant` row for (item, that student);
4. the item belongs to the same teacher, is in the teacher's CURRENT
   semester (archived semesters are 封存), and is live in that class
   (`classroom_item` with snapshot_id NULL — 結算/封存 into a snapshot
   moves the activation away, so archived items disappear).
Anything failing → the same 404 as a non-existent id, so error codes never
reveal whether an id exists.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy import and_
from sqlalchemy.orm import Session

from identity import sync_self_links
from models.access import ClassAssistant, ItemAssistant
from models.classroom import Student
from models.curriculum import ClassroomItem, Item, Semester


def not_found(resource: str = "item") -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_404_NOT_FOUND,
        detail={
            "error": {
                "code": "NOT_FOUND",
                "message_key": f"errors.{resource}.not_found",
                "message": f"{resource.capitalize()} not found.",
            }
        },
    )


@dataclass(frozen=True)
class AssistantContext:
    """One class in which the signed-in student is a 小老師."""
    owner_user_id: UUID
    classroom_id: UUID
    student_id: UUID  # the assistant's own roster row in that class
    student: Student = field(compare=False, hash=False)


@dataclass(frozen=True)
class Actor:
    """Resolved permission to work on ONE item in ONE class."""
    kind: str  # always "assistant" for now
    owner_user_id: UUID
    actor_user_id: UUID
    classroom_id: UUID
    item: Item = field(compare=False, hash=False)
    allowed_student_ids: frozenset[UUID] = frozenset()


def assistant_contexts(db: Session, actor_user_id: UUID) -> list[AssistantContext]:
    """Re-sync the caller's self links (live email match) and return the
    classes where they are a 小老師."""
    return contexts_for_students(db, sync_self_links(db, actor_user_id))


def contexts_for_students(
    db: Session, students: list[Student]
) -> list[AssistantContext]:
    """Same, from an already-synced `sync_self_links` result."""
    if not students:
        return []
    by_id = {s.id: s for s in students}
    rows = (
        db.query(ClassAssistant)
        .filter(ClassAssistant.student_id.in_(list(by_id)))
        .all()
    )
    out: list[AssistantContext] = []
    for ca in rows:
        s = by_id[ca.student_id]
        # Stale row guards: transferred student, mismatched owner, no email.
        if (
            s.classroom_id != ca.classroom_id
            or s.user_id != ca.user_id
            or not s.email
        ):
            continue
        out.append(
            AssistantContext(
                owner_user_id=ca.user_id,
                classroom_id=ca.classroom_id,
                student_id=s.id,
                student=s,
            )
        )
    return out


def visible_items_query(db: Session, ctx: AssistantContext):
    """Items this assistant may see in this class (rules 3 + 4 above)."""
    return (
        db.query(Item)
        .join(
            ItemAssistant,
            and_(
                ItemAssistant.item_id == Item.id,
                ItemAssistant.student_id == ctx.student_id,
            ),
        )
        .join(Semester, Semester.id == Item.semester_id)
        .join(
            ClassroomItem,
            and_(
                ClassroomItem.item_id == Item.id,
                ClassroomItem.classroom_id == ctx.classroom_id,
                ClassroomItem.snapshot_id.is_(None),
            ),
        )
        .filter(
            Item.user_id == ctx.owner_user_id,
            Semester.user_id == ctx.owner_user_id,
            Semester.is_current.is_(True),
        )
    )


def resolve_actor(
    db: Session,
    actor_user_id: UUID,
    item_id: UUID,
    classroom_id: UUID,
) -> Actor:
    """Permission for (item, class), or the uniform 404."""
    for ctx in assistant_contexts(db, actor_user_id):
        if ctx.classroom_id != classroom_id:
            continue
        item = visible_items_query(db, ctx).filter(Item.id == item_id).first()
        if item is None:
            continue
        roster = {
            sid
            for (sid,) in db.query(Student.id).filter(
                Student.classroom_id == ctx.classroom_id,
                Student.user_id == ctx.owner_user_id,
            )
        }
        return Actor(
            kind="assistant",
            owner_user_id=ctx.owner_user_id,
            actor_user_id=actor_user_id,
            classroom_id=ctx.classroom_id,
            item=item,
            allowed_student_ids=frozenset(roster),
        )
    raise not_found("item")


# ---------- teacher-side helpers ----------

def revoke_assistant(db: Session, student_id: UUID) -> None:
    """Remove the 小老師 role and all its item assignments. Grades the
    student already entered keep their stamp (nothing touches `grade`)."""
    db.query(ItemAssistant).filter(
        ItemAssistant.student_id == student_id
    ).delete(synchronize_session=False)
    db.query(ClassAssistant).filter(
        ClassAssistant.student_id == student_id
    ).delete(synchronize_session=False)


def is_assistant(db: Session, student: Student) -> bool:
    return (
        db.query(ClassAssistant.id)
        .filter(
            ClassAssistant.student_id == student.id,
            ClassAssistant.classroom_id == student.classroom_id,
        )
        .first()
        is not None
    )


def assistant_ids_in_classroom(db: Session, classroom_id: UUID) -> set[UUID]:
    return {
        sid
        for (sid,) in db.query(ClassAssistant.student_id).filter(
            ClassAssistant.classroom_id == classroom_id
        )
    }


def _err(code: int, key: str, message: str) -> HTTPException:
    return HTTPException(
        status_code=code,
        detail={
            "error": {
                "code": "BAD_REQUEST" if code == 400 else "CONFLICT",
                "message_key": key,
                "message": message,
            }
        },
    )


def set_assistant(db: Session, student: Student, flag: bool) -> None:
    """Make / unmake `student` a 小老師 of their current class. Caller has
    already verified the teacher owns the student. Does not commit."""
    if not flag:
        revoke_assistant(db, student.id)
        return
    if not student.email:
        raise _err(
            400,
            "errors.assistant.email_required",
            "A student needs an email before becoming an assistant.",
        )
    # Already an assistant → nothing to do. Checked BEFORE the duplicate-
    # email check so re-saving an existing assistant (StudentModal always
    # sends is_assistant) isn't rejected for an unrelated classmate's email.
    if is_assistant(db, student):
        return
    dup = (
        db.query(Student.id)
        .filter(
            Student.classroom_id == student.classroom_id,
            Student.user_id == student.user_id,
            Student.id != student.id,
            Student.email == student.email,
        )
        .first()
    )
    if dup is not None:
        raise _err(
            409,
            "errors.assistant.duplicate_email",
            "Another student in this class has the same email.",
        )
    # A row left over from a previous class (transfer) is replaced.
    revoke_assistant(db, student.id)
    db.add(
        ClassAssistant(
            user_id=student.user_id,
            classroom_id=student.classroom_id,
            student_id=student.id,
        )
    )
