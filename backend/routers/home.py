"""Home page widgets (issue #161).

Three read endpoints + one write:
- GET  /api/home/class-rankings — points per classroom, optionally scoped
       to a specific subject (auto-award only).
- GET  /api/home/top-students  — top N students by semester point total,
       with met-standard count.
- GET  /api/home/alerts/summary — new-since-last-view count for the badge.
- GET  /api/home/alerts/list    — students missing a Grade row for any
       active (classroom_item, snapshot_id IS NULL) item (#179). 0 = valid
       grade, not missing; only "no Grade row at all" counts as missing.
- POST /api/home/alerts/viewed  — stamp alerts_last_viewed_at = now().

Semester scope: current semester only (matches the rest of the app).
Point sums respect the latest PointReset marker (issue #165).
"""
from __future__ import annotations

from datetime import date, datetime, timezone
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func
from sqlalchemy.orm import Session

from auth import require_user_id
from database import get_db
from models.classroom import Classroom, Student
from models.curriculum import Category, ClassroomItem, Item, Semester, Subject
from models.grading import Grade, PointRecord, PointReset
from models.settings import UserSettings
from schemas import (
    HomeAlertListItem,
    HomeAlertList,
    HomeAlertSummary,
    HomeAlertViewedOut,
    HomeAlertMissingItem,
    HomeClassRankingItem,
    HomeClassRankingList,
    HomePoorPerformanceItem,
    HomePoorPerformanceList,
    HomeTopStudentItem,
    HomeTopStudentList,
    ReasonCount,
)

router = APIRouter()

# Default reason written by the points-reset flow (points.py). Excluded from
# the poor-performance alert — a reset is housekeeping, not bad behaviour.
_RESET_REASON = "歸零"


def _current_semester(db: Session, user_id: UUID) -> Semester | None:
    return (
        db.query(Semester)
        .filter(Semester.user_id == user_id, Semester.is_current.is_(True))
        .one_or_none()
    )


def _last_reset_map(
    db: Session, user_id: UUID, student_ids: list[UUID]
) -> dict[UUID, datetime]:
    """student_id → latest reset_at ever (cumulative, #207)."""
    if not student_ids:
        return {}
    rows = (
        db.query(PointReset.student_id, func.max(PointReset.reset_at))
        .filter(
            PointReset.user_id == user_id,
            PointReset.student_id.in_(student_ids),
        )
        .group_by(PointReset.student_id)
        .all()
    )
    return {sid: ts for sid, ts in rows}


def _breakdown(counts: dict[str, list[int]]) -> list[ReasonCount]:
    """counts: reason → [count, points_sum] → sorted ReasonCount list
    (most-frequent first, then larger magnitude, then label)."""
    items = [
        ReasonCount(reason=reason, count=c, points=p)
        for reason, (c, p) in counts.items()
    ]
    items.sort(key=lambda r: (-r.count, -abs(r.points), r.reason))
    return items


def _add_reason(bucket: dict[str, list[int]], reason: str | None, pts: int) -> None:
    label = (reason or "").strip() or "—"
    cur = bucket.setdefault(label, [0, 0])
    cur[0] += 1
    cur[1] += pts


# ---------- Class rankings ----------

@router.get("/api/home/class-rankings", response_model=HomeClassRankingList)
def class_rankings(
    user_id: Annotated[UUID, Depends(require_user_id)],
    db: Annotated[Session, Depends(get_db)],
    subject_id: Annotated[UUID | None, Query()] = None,
) -> HomeClassRankingList:
    """Total auto-award PointRecord per classroom for the current semester.

    `subject_id` filters to records whose source_grade.item.subject_id
    matches. Manual records (no source_grade) are excluded regardless —
    they aren't tied to a subject (#161 design call).
    """
    classrooms = (
        db.query(Classroom)
        .filter(Classroom.user_id == user_id)
        .order_by(Classroom.grade.asc(), Classroom.name.asc())
        .all()
    )
    if not classrooms:
        return HomeClassRankingList(data=[])
    sem = _current_semester(db, user_id)
    if sem is None:
        return HomeClassRankingList(
            data=[
                HomeClassRankingItem(
                    classroom_id=c.id,
                    classroom_grade=c.grade,
                    classroom_name=c.name,
                    points=0,
                )
                for c in classrooms
            ]
        )

    # Pull every student to know per-student reset floor.
    students = (
        db.query(Student.id, Student.classroom_id)
        .filter(Student.user_id == user_id)
        .all()
    )
    student_ids = [s.id for s in students]
    student_to_class = {s.id: s.classroom_id for s in students}
    last_reset = _last_reset_map(db, user_id, student_ids)

    # Auto-award records joined with Grade + Item (so we can subject-filter).
    q = (
        db.query(
            PointRecord.student_id,
            PointRecord.points,
            PointRecord.created_at,
        )
        .join(Grade, Grade.id == PointRecord.source_grade_id)
        .join(Item, Item.id == Grade.item_id)
        .filter(
            PointRecord.user_id == user_id,
            PointRecord.source_grade_id.is_not(None),
            PointRecord.student_id.in_(student_ids) if student_ids else False,
        )
    )
    if subject_id is not None:
        q = q.filter(Item.subject_id == subject_id)
    rows = q.all() if student_ids else []

    sums: dict[UUID, int] = {c.id: 0 for c in classrooms}
    for sid, pts, ts in rows:
        floor = last_reset.get(sid)
        if floor is not None and ts <= floor:
            continue
        cid = student_to_class.get(sid)
        if cid is None:
            continue
        sums[cid] = sums.get(cid, 0) + int(pts)

    return HomeClassRankingList(
        data=[
            HomeClassRankingItem(
                classroom_id=c.id,
                classroom_grade=c.grade,
                classroom_name=c.name,
                points=sums.get(c.id, 0),
            )
            for c in classrooms
        ]
    )


# ---------- Top students ----------

@router.get("/api/home/top-students", response_model=HomeTopStudentList)
def top_students(
    user_id: Annotated[UUID, Depends(require_user_id)],
    db: Annotated[Session, Depends(get_db)],
    classroom_id: Annotated[UUID | None, Query()] = None,
    limit: Annotated[int, Query(ge=1, le=100)] = 10,
) -> HomeTopStudentList:
    """Top students by current-semester point total. Also returns count of
    auto-award PointRecord (= times the student met standard) so the UI
    can column-sort by it.
    """
    sem = _current_semester(db, user_id)
    if sem is None:
        return HomeTopStudentList(data=[])

    q = (
        db.query(Student, Classroom)
        .join(Classroom, Classroom.id == Student.classroom_id)
        .filter(Student.user_id == user_id)
    )
    if classroom_id is not None:
        q = q.filter(Student.classroom_id == classroom_id)
    students = q.all()
    if not students:
        return HomeTopStudentList(data=[])

    student_ids = [s.id for s, _ in students]
    last_reset = _last_reset_map(db, user_id, student_ids)

    # Pull all point records once, partition per student.
    rows = (
        db.query(
            PointRecord.student_id,
            PointRecord.points,
            PointRecord.created_at,
            PointRecord.source_grade_id,
            PointRecord.reason,
        )
        .filter(
            PointRecord.user_id == user_id,
            PointRecord.student_id.in_(student_ids),
        )
        .all()
    )
    total_by: dict[UUID, int] = {}
    met_by: dict[UUID, int] = {}
    # student_id → {reason → [count, points_sum]} over the awarded (>0) records.
    award_reasons: dict[UUID, dict[str, list[int]]] = {}
    for sid, pts, ts, sgid, reason in rows:
        floor = last_reset.get(sid)
        if floor is not None and ts <= floor:
            continue
        total_by[sid] = total_by.get(sid, 0) + int(pts)
        if sgid is not None:
            met_by[sid] = met_by.get(sid, 0) + 1
        if int(pts) > 0:
            _add_reason(award_reasons.setdefault(sid, {}), reason, int(pts))

    out = [
        HomeTopStudentItem(
            student_id=s.id,
            classroom_id=c.id,
            classroom_grade=c.grade,
            classroom_name=c.name,
            seat_number=s.seat_number,
            name=s.name,
            total_points=total_by.get(s.id, 0),
            met_count=met_by.get(s.id, 0),
            reason_breakdown=_breakdown(award_reasons.get(s.id, {})),
        )
        for s, c in students
    ]
    # Server-side default ordering: highest total first, then most-met,
    # then seat. Frontend re-sorts by user click.
    out.sort(
        key=lambda r: (-r.total_points, -r.met_count, r.classroom_grade, r.seat_number)
    )
    return HomeTopStudentList(data=out[:limit])


# ---------- Poor-performance alert (#193) ----------

@router.get("/api/home/poor-performance", response_model=HomePoorPerformanceList)
def poor_performance(
    user_id: Annotated[UUID, Depends(require_user_id)],
    db: Annotated[Session, Depends(get_db)],
    classroom_id: Annotated[UUID | None, Query()] = None,
) -> HomePoorPerformanceList:
    """Students with deductions this semester, ranked by total deducted
    (most-negative first). Unlike top-students this is NOT limited — every
    student who lost points shows up. Mirrors the top-students aggregation
    but keeps only negative (<0) records.
    """
    sem = _current_semester(db, user_id)
    if sem is None:
        return HomePoorPerformanceList(data=[])

    q = (
        db.query(Student, Classroom)
        .join(Classroom, Classroom.id == Student.classroom_id)
        .filter(Student.user_id == user_id)
    )
    if classroom_id is not None:
        q = q.filter(Student.classroom_id == classroom_id)
    students = q.all()
    if not students:
        return HomePoorPerformanceList(data=[])

    student_ids = [s.id for s, _ in students]
    last_reset = _last_reset_map(db, user_id, student_ids)

    rows = (
        db.query(
            PointRecord.student_id,
            PointRecord.points,
            PointRecord.created_at,
            PointRecord.reason,
        )
        .filter(
            PointRecord.user_id == user_id,
            PointRecord.student_id.in_(student_ids),
            PointRecord.points < 0,
            # Exclude legacy reset markers (reason='歸零'): a points reset is a
            # deliberate housekeeping action, not poor performance (#193). New
            # resets write a PointReset row, but old negative 歸零 PointRecords
            # were intentionally left in the data.
            PointRecord.reason != _RESET_REASON,
        )
        .all()
    )
    deducted_by: dict[UUID, int] = {}
    count_by: dict[UUID, int] = {}
    deduct_reasons: dict[UUID, dict[str, list[int]]] = {}
    for sid, pts, ts, reason in rows:
        floor = last_reset.get(sid)
        if floor is not None and ts <= floor:
            continue
        deducted_by[sid] = deducted_by.get(sid, 0) + int(pts)
        count_by[sid] = count_by.get(sid, 0) + 1
        _add_reason(deduct_reasons.setdefault(sid, {}), reason, int(pts))

    out = [
        HomePoorPerformanceItem(
            student_id=s.id,
            classroom_id=c.id,
            classroom_grade=c.grade,
            classroom_name=c.name,
            seat_number=s.seat_number,
            name=s.name,
            deducted_total=deducted_by.get(s.id, 0),
            deduction_count=count_by.get(s.id, 0),
            reason_breakdown=_breakdown(deduct_reasons.get(s.id, {})),
        )
        for s, c in students
        if deducted_by.get(s.id, 0) < 0
    ]
    # Most-deducted (most negative) first.
    out.sort(key=lambda r: (r.deducted_total, r.classroom_grade, r.seat_number))
    return HomePoorPerformanceList(data=out)


# ---------- Alerts ----------

def _get_or_create_settings(db: Session, user_id: UUID) -> UserSettings:
    row = (
        db.query(UserSettings)
        .filter(UserSettings.user_id == user_id)
        .one_or_none()
    )
    if row is None:
        row = UserSettings(user_id=user_id)
        db.add(row)
        db.flush()
    return row


def _compute_missing(
    db: Session, user_id: UUID
) -> list[tuple[UUID, UUID, UUID, str, str, datetime]]:
    """Cross-join active (classroom_item.snapshot_id IS NULL) × student-in-
    classroom, then subtract rows that already have a live Grade. The
    leftover (sid, cid, iid, iname, cat_key, item_created_at) tuples are
    what the teacher has not yet entered a score for (#179)."""
    pairs = (
        db.query(
            ClassroomItem.classroom_id,
            ClassroomItem.item_id,
            Item.name,
            Item.created_at,
            Category.system_key,
        )
        .join(Item, Item.id == ClassroomItem.item_id)
        .join(Category, Category.id == Item.category_id)
        .filter(
            ClassroomItem.user_id == user_id,
            ClassroomItem.snapshot_id.is_(None),
            # 額外加分 is a bonus, not a required submission — a student with no
            # extra score is normal, so never flag it as 缺交 (#232).
            Category.system_key != "extra",
        )
        .all()
    )
    if not pairs:
        return []

    classroom_ids = {p[0] for p in pairs}
    students_by_classroom: dict[UUID, list[UUID]] = {}
    for sid, cid in (
        db.query(Student.id, Student.classroom_id)
        .filter(
            Student.user_id == user_id,
            Student.classroom_id.in_(classroom_ids),
        )
        .all()
    ):
        students_by_classroom.setdefault(cid, []).append(sid)

    item_ids = {p[1] for p in pairs}
    graded: set[tuple[UUID, UUID]] = set(
        db.query(Grade.student_id, Grade.item_id)
        .filter(
            Grade.user_id == user_id,
            Grade.snapshot_id.is_(None),
            Grade.item_id.in_(item_ids),
        )
        .all()
    )

    out: list[tuple[UUID, UUID, UUID, str, str, datetime]] = []
    for cid, iid, iname, icreated, ckey in pairs:
        for sid in students_by_classroom.get(cid, []):
            if (sid, iid) not in graded:
                out.append((sid, cid, iid, iname, ckey, icreated))
    return out


@router.get("/api/home/alerts/summary", response_model=HomeAlertSummary)
def alerts_summary(
    user_id: Annotated[UUID, Depends(require_user_id)],
    db: Annotated[Session, Depends(get_db)],
) -> HomeAlertSummary:
    """Badge counter: total current missing (student × item) pairs.

    Since #179 missing rows are computed from the live ClassroomItem ×
    Student set difference (no Grade row = missing), they're persistent —
    they don't "go away once seen", so a "new since last viewed" semantic
    no longer maps cleanly. The badge now shows the same number the alerts
    list shows; `alerts_last_viewed_at` is still stamped on visit for
    potential future use but no longer gates the count."""
    missing = _compute_missing(db, user_id)
    return HomeAlertSummary(new_count=len(missing))


@router.get("/api/home/alerts/list", response_model=HomeAlertList)
def alerts_list(
    user_id: Annotated[UUID, Depends(require_user_id)],
    db: Annotated[Session, Depends(get_db)],
    classroom_id: Annotated[UUID | None, Query()] = None,
) -> HomeAlertList:
    """Every student who currently has at least one missing (no Grade row)
    live item, with their semester totals + met-count (same shape as
    top-students for column-sort parity)."""
    sem = _current_semester(db, user_id)

    missing = _compute_missing(db, user_id)
    missing_items_by: dict[UUID, list[HomeAlertMissingItem]] = {}
    for sid, _cid, _iid, iname, cat_key, _ts in missing:
        missing_items_by.setdefault(sid, []).append(
            HomeAlertMissingItem(item_name=iname, category_system_key=cat_key)
        )
    for items in missing_items_by.values():
        items.sort(key=lambda i: i.item_name)
    missing_count_by = {sid: len(items) for sid, items in missing_items_by.items()}
    if not missing_count_by:
        return HomeAlertList(data=[])

    q = (
        db.query(Student, Classroom)
        .join(Classroom, Classroom.id == Student.classroom_id)
        .filter(
            Student.user_id == user_id,
            Student.id.in_(missing_count_by.keys()),
        )
    )
    if classroom_id is not None:
        q = q.filter(Student.classroom_id == classroom_id)
    students = q.all()

    # Per-student point totals (reset-aware, current semester).
    total_by: dict[UUID, int] = {}
    met_by: dict[UUID, int] = {}
    if sem is not None and students:
        student_ids = [s.id for s, _ in students]
        last_reset = _last_reset_map(db, user_id, student_ids)
        prows = (
            db.query(
                PointRecord.student_id,
                PointRecord.points,
                PointRecord.created_at,
                PointRecord.source_grade_id,
            )
            .filter(
                PointRecord.user_id == user_id,
                PointRecord.student_id.in_(student_ids),
                )
            .all()
        )
        for sid, pts, ts, sgid in prows:
            floor = last_reset.get(sid)
            if floor is not None and ts <= floor:
                continue
            total_by[sid] = total_by.get(sid, 0) + int(pts)
            if sgid is not None:
                met_by[sid] = met_by.get(sid, 0) + 1

    out = [
        HomeAlertListItem(
            student_id=s.id,
            classroom_id=c.id,
            classroom_grade=c.grade,
            classroom_name=c.name,
            seat_number=s.seat_number,
            name=s.name,
            total_points=total_by.get(s.id, 0),
            met_count=met_by.get(s.id, 0),
            missing_count=missing_count_by.get(s.id, 0),
            missing_items=missing_items_by.get(s.id, []),
        )
        for s, c in students
    ]
    out.sort(
        key=lambda r: (r.classroom_grade, r.classroom_name, r.seat_number)
    )
    return HomeAlertList(data=out)


@router.post("/api/home/alerts/viewed", response_model=HomeAlertViewedOut)
def mark_alerts_viewed(
    user_id: Annotated[UUID, Depends(require_user_id)],
    db: Annotated[Session, Depends(get_db)],
) -> HomeAlertViewedOut:
    """Stamp alerts_last_viewed_at = now() so the badge counter resets."""
    settings = _get_or_create_settings(db, user_id)
    now = datetime.now(timezone.utc)
    settings.alerts_last_viewed_at = now
    db.commit()
    return HomeAlertViewedOut(viewed_at=now)
