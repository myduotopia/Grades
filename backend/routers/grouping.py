"""Student groups within a classroom (#237).

Paths mix /api/classrooms/{id}/groups and /api/groups/{id}, so this router is
mounted with no prefix (same as routers/student.py).
"""
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, selectinload

from auth import require_user_id
from database import get_db
from models.classroom import Classroom, Student
from models.grouping import GROUP_COLOR_VALUES, StudentGroup, StudentGroupMember
from schemas import (
    GroupList,
    GroupMemberOut,
    GroupOrderUpdate,
    GroupOut,
    GroupWrite,
    ListMeta,
)

router = APIRouter()


def _error(code: int, error_code: str, key: str, message: str) -> HTTPException:
    return HTTPException(
        status_code=code,
        detail={"error": {"code": error_code, "message_key": key, "message": message}},
    )


def _classroom_not_found() -> HTTPException:
    return _error(
        status.HTTP_404_NOT_FOUND, "NOT_FOUND",
        "errors.classroom.not_found", "Classroom not found.",
    )


def _group_not_found() -> HTTPException:
    return _error(
        status.HTTP_404_NOT_FOUND, "NOT_FOUND",
        "errors.group.not_found", "Group not found.",
    )


def _duplicate_name() -> HTTPException:
    return _error(
        status.HTTP_409_CONFLICT, "CONFLICT",
        "errors.group.duplicate_name",
        "A group with this name already exists in this class.",
    )


def _get_owned_classroom(db: Session, user_id: UUID, classroom_id: UUID) -> Classroom:
    row = (
        db.query(Classroom)
        .filter(Classroom.id == classroom_id, Classroom.user_id == user_id)
        .one_or_none()
    )
    if row is None:
        raise _classroom_not_found()
    return row


def _get_owned_group(db: Session, user_id: UUID, group_id: UUID) -> StudentGroup:
    row = (
        db.query(StudentGroup)
        .filter(StudentGroup.id == group_id, StudentGroup.user_id == user_id)
        .one_or_none()
    )
    if row is None:
        raise _group_not_found()
    return row


def _validate_body(
    db: Session, user_id: UUID, classroom_id: UUID, body: GroupWrite
) -> None:
    """Reject anything the DB constraints cannot catch on their own."""
    if not body.name.strip():
        raise _error(
            status.HTTP_422_UNPROCESSABLE_ENTITY, "VALIDATION_ERROR",
            "errors.group.name_required", "Group name is required.",
        )
    if body.color is not None and body.color not in GROUP_COLOR_VALUES:
        raise _error(
            status.HTTP_422_UNPROCESSABLE_ENTITY, "VALIDATION_ERROR",
            "errors.group.invalid_color", "Unknown group color.",
        )

    ids = body.member_student_ids
    if len(set(ids)) != len(ids):
        raise _error(
            status.HTTP_422_UNPROCESSABLE_ENTITY, "VALIDATION_ERROR",
            "errors.group.duplicate_member", "A student was listed twice.",
        )
    if ids:
        # Every member must be a student of THIS class, owned by THIS user.
        found = {
            sid for (sid,) in db.query(Student.id).filter(
                Student.id.in_(ids),
                Student.classroom_id == classroom_id,
                Student.user_id == user_id,
            )
        }
        if len(found) != len(ids):
            raise _error(
                status.HTTP_422_UNPROCESSABLE_ENTITY, "VALIDATION_ERROR",
                "errors.group.student_not_in_classroom",
                "One or more students do not belong to this class.",
            )
    if body.leader_student_id is not None and body.leader_student_id not in ids:
        raise _error(
            status.HTTP_422_UNPROCESSABLE_ENTITY, "VALIDATION_ERROR",
            "errors.group.leader_not_member",
            "The leader must be one of the members of the group.",
        )


def _replace_members(
    db: Session, user_id: UUID, group: StudentGroup, student_ids: list[UUID]
) -> None:
    """Wholesale replace: a group holds at most a few dozen members, so a
    delete-all + re-insert is cheaper to reason about than a diff."""
    db.query(StudentGroupMember).filter(
        StudentGroupMember.group_id == group.id
    ).delete(synchronize_session=False)
    for index, student_id in enumerate(student_ids):
        db.add(
            StudentGroupMember(
                user_id=user_id,
                group_id=group.id,
                student_id=student_id,
                sort_order=index,
            )
        )


def _seat_map(db: Session, classroom_id: UUID) -> dict[UUID, Student]:
    return {
        s.id: s
        for s in db.query(Student).filter(Student.classroom_id == classroom_id).all()
    }


def _to_out(group: StudentGroup, seats: dict[UUID, Student]) -> GroupOut:
    members = [
        GroupMemberOut(
            student_id=m.student_id,
            seat_number=seats[m.student_id].seat_number,
            name=seats[m.student_id].name,
            sort_order=m.sort_order,
        )
        for m in sorted(group.members, key=lambda m: m.sort_order)
        if m.student_id in seats
    ]
    return GroupOut(
        id=group.id,
        classroom_id=group.classroom_id,
        name=group.name,
        color=group.color,
        leader_student_id=group.leader_student_id,
        sort_order=group.sort_order,
        members=members,
        created_at=group.created_at,
        updated_at=group.updated_at,
    )


@router.get("/api/classrooms/{classroom_id}/groups", response_model=GroupList)
def list_groups(
    classroom_id: UUID,
    user_id: Annotated[UUID, Depends(require_user_id)],
    db: Annotated[Session, Depends(get_db)],
) -> GroupList:
    _get_owned_classroom(db, user_id, classroom_id)
    rows = (
        db.query(StudentGroup)
        .options(selectinload(StudentGroup.members))
        .filter(
            StudentGroup.classroom_id == classroom_id,
            StudentGroup.user_id == user_id,
        )
        .order_by(StudentGroup.sort_order.asc(), StudentGroup.created_at.asc())
        .all()
    )
    seats = _seat_map(db, classroom_id)
    return GroupList(
        data=[_to_out(g, seats) for g in rows],
        meta=ListMeta(total=len(rows)),
    )


@router.post(
    "/api/classrooms/{classroom_id}/groups",
    response_model=GroupOut,
    status_code=status.HTTP_201_CREATED,
)
def create_group(
    classroom_id: UUID,
    body: GroupWrite,
    user_id: Annotated[UUID, Depends(require_user_id)],
    db: Annotated[Session, Depends(get_db)],
) -> GroupOut:
    _get_owned_classroom(db, user_id, classroom_id)
    _validate_body(db, user_id, classroom_id, body)

    # Append to the end of the existing order.
    last = (
        db.query(StudentGroup.sort_order)
        .filter(
            StudentGroup.classroom_id == classroom_id,
            StudentGroup.user_id == user_id,
        )
        .order_by(StudentGroup.sort_order.desc())
        .first()
    )
    group = StudentGroup(
        user_id=user_id,
        classroom_id=classroom_id,
        name=body.name.strip(),
        color=body.color,
        leader_student_id=body.leader_student_id,
        sort_order=(last[0] + 1) if last else 0,
    )
    db.add(group)
    try:
        db.flush()
        _replace_members(db, user_id, group, body.member_student_ids)
        db.commit()
    except IntegrityError:
        db.rollback()
        raise _duplicate_name()
    db.refresh(group)
    return _to_out(group, _seat_map(db, classroom_id))


@router.put("/api/groups/{group_id}", response_model=GroupOut)
def update_group(
    group_id: UUID,
    body: GroupWrite,
    user_id: Annotated[UUID, Depends(require_user_id)],
    db: Annotated[Session, Depends(get_db)],
) -> GroupOut:
    group = _get_owned_group(db, user_id, group_id)
    _validate_body(db, user_id, group.classroom_id, body)

    group.name = body.name.strip()
    group.color = body.color
    group.leader_student_id = body.leader_student_id
    _replace_members(db, user_id, group, body.member_student_ids)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise _duplicate_name()
    db.refresh(group)
    return _to_out(group, _seat_map(db, group.classroom_id))


@router.delete("/api/groups/{group_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_group(
    group_id: UUID,
    user_id: Annotated[UUID, Depends(require_user_id)],
    db: Annotated[Session, Depends(get_db)],
) -> None:
    group = _get_owned_group(db, user_id, group_id)
    db.delete(group)
    db.commit()


@router.put("/api/classrooms/{classroom_id}/groups/order", response_model=GroupList)
def reorder_groups(
    classroom_id: UUID,
    body: GroupOrderUpdate,
    user_id: Annotated[UUID, Depends(require_user_id)],
    db: Annotated[Session, Depends(get_db)],
) -> GroupList:
    _get_owned_classroom(db, user_id, classroom_id)
    rows = (
        db.query(StudentGroup)
        .options(selectinload(StudentGroup.members))
        .filter(
            StudentGroup.classroom_id == classroom_id,
            StudentGroup.user_id == user_id,
        )
        .all()
    )
    by_id = {g.id: g for g in rows}
    # Ids in the request win, in order; anything omitted keeps its relative
    # position after them. Unknown ids are ignored rather than 422 — a stale
    # tab reordering a list that just lost a group should not hard-fail.
    ordered = [by_id[gid] for gid in body.group_ids if gid in by_id]
    seen = {g.id for g in ordered}
    ordered += [
        g for g in sorted(rows, key=lambda g: (g.sort_order, g.created_at))
        if g.id not in seen
    ]
    for index, group in enumerate(ordered):
        group.sort_order = index
    db.commit()

    seats = _seat_map(db, classroom_id)
    return GroupList(
        data=[_to_out(g, seats) for g in ordered],
        meta=ListMeta(total=len(ordered)),
    )
