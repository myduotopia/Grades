"""Student detail / transcript endpoints (issue #11).

Read-only views: basic profile + current-semester points total, weighted
grade summary per subject, raw grade history, point-record history.

The "weighted total" math mirrors what the by-student view on
/classes/:id/grades does, except scoped to a single student.
"""
from __future__ import annotations

from datetime import datetime
from typing import Annotated, Literal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func
from sqlalchemy.orm import Session

from auth import require_user_id
from database import get_db
from models.classroom import Classroom, Student
from models.curriculum import Category, Item, Semester, Subject, SubjectCategoryWeight
from models.grading import (
    Grade,
    PointRecord,
    PointReset,
    SnapshotStandard,
    StudentStandard,
)
from routers.grades import AUTO_AWARD_CATEGORY_KEYS
from routers.points import _latest_reset_map_for_classroom
from schemas import (
    ClassGradeCardsView,
    GradeCardSubject,
    StudentDetailOut,
    StudentGradeCard,
    StudentGradeRow,
    StudentGradesView,
    StudentPointResetRow,
    StudentPointRow,
    StudentPointsView,
    StudentSubjectSummary,
)

router = APIRouter()


def _not_found(resource: str) -> HTTPException:
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


def _get_student(db: Session, user_id: UUID, student_id: UUID) -> Student:
    s = (
        db.query(Student)
        .filter(Student.id == student_id, Student.user_id == user_id)
        .one_or_none()
    )
    if s is None:
        raise _not_found("student")
    return s


def _resolve_semester(
    db: Session, user_id: UUID, semester_id: UUID | None
) -> Semester | None:
    """Return the semester to view: the requested one if owned, else the
    user's is_current=true semester, else None."""
    if semester_id is not None:
        sem = (
            db.query(Semester)
            .filter(Semester.id == semester_id, Semester.user_id == user_id)
            .one_or_none()
        )
        if sem is not None:
            return sem
    return (
        db.query(Semester)
        .filter(Semester.user_id == user_id, Semester.is_current.is_(True))
        .one_or_none()
    )


def _semester_label(sem: Semester) -> str:
    return f"{sem.academic_year}-{sem.term}"


def _latest_reset(
    db: Session, user_id: UUID, student_id: UUID
) -> datetime | None:
    """Most-recent PointReset.reset_at for this student across all time
    (cumulative, #207), or None. Mirrors routers/points.py._latest_reset."""
    return (
        db.query(func.max(PointReset.reset_at))
        .filter(
            PointReset.user_id == user_id,
            PointReset.student_id == student_id,
        )
        .scalar()
    )


def _points_cumulative(
    db: Session, user_id: UUID, student_id: UUID
) -> int:
    """Cumulative running total (#207): all of a student's points after their
    latest 歸零 reset (or all, if never reset). No semester window — archived
    and prior-semester points all count. Records at/before the reset moment
    don't count (#165)."""
    last_reset = _latest_reset(db, user_id, student_id)
    q = db.query(func.coalesce(func.sum(PointRecord.points), 0)).filter(
        PointRecord.user_id == user_id,
        PointRecord.student_id == student_id,
    )
    if last_reset is not None:
        q = q.filter(PointRecord.created_at > last_reset)
    return int(q.scalar() or 0)


@router.get("/api/students/{student_id}", response_model=StudentDetailOut)
def get_student_detail(
    student_id: UUID,
    user_id: Annotated[UUID, Depends(require_user_id)],
    db: Annotated[Session, Depends(get_db)],
    semester_id: Annotated[UUID | None, Query()] = None,
) -> StudentDetailOut:
    student = _get_student(db, user_id, student_id)
    classroom = db.get(Classroom, student.classroom_id)
    sem = _resolve_semester(db, user_id, semester_id)

    semester_points = _points_cumulative(db, user_id, student.id)

    return StudentDetailOut(
        id=student.id,
        classroom_id=student.classroom_id,
        classroom_grade=classroom.grade if classroom else 0,
        classroom_name=classroom.name if classroom else "",
        seat_number=student.seat_number,
        name=student.name,
        email=student.email,
        semester_id=sem.id if sem else None,
        semester_label=_semester_label(sem) if sem else None,
        semester_points=semester_points,
    )


def _build_subject_summaries(
    by_subject: dict[UUID, dict[str, list[float]]],
    subject_meta: dict[UUID, tuple[str | None, str | None]],
    weight_by: dict[UUID, dict[str, int]],
) -> list[StudentSubjectSummary]:
    """Per-subject weighted summaries for one student (#210). NO renormalise:
    categories with no grades simply lose their weight; 額外加分 adds on top,
    capped at 100. Mirrors gradeMath.ts and the class by-student view."""
    summaries: list[StudentSubjectSummary] = []
    for subj_id, by_cat in by_subject.items():
        sys_key, disp = subject_meta[subj_id]
        cat_avg: dict[str, float] = {
            ck: round(sum(scores) / len(scores), 2)
            for ck, scores in by_cat.items()
        }
        weights_map = weight_by.get(subj_id, {})
        applicable = [
            (ck, w)
            for ck, w in weights_map.items()
            if ck != "extra" and ck in cat_avg and w > 0
        ]
        weighted = None
        if applicable:
            base = sum((cat_avg[ck] * w) / 100.0 for ck, w in applicable)
            extra_avg = cat_avg.get("extra")
            extra_w = weights_map.get("extra", 0)
            bonus = (
                (extra_avg * extra_w / 100.0)
                if extra_avg is not None and extra_w > 0
                else 0.0
            )
            weighted = min(100.0, round(base + bonus, 2))
        summaries.append(
            StudentSubjectSummary(
                subject_id=subj_id,
                subject_system_key=sys_key,
                subject_display_name=disp,
                weighted_total=weighted,
                category_averages=cat_avg,
                category_weights=weights_map,
            )
        )
    return summaries


def _count_met(
    all_grades: list[tuple],
    std_by_subject: dict[UUID, float],
    snap_thresholds: dict[tuple[UUID, UUID], float],
) -> int:
    """達標 count for one student over (Grade, category_system_key, subject_id)
    rows spanning live + snapshot buckets (#210). Live grades use the live
    StudentStandard threshold; archived grades use the frozen SnapshotStandard
    threshold keyed by (snapshot_id, subject_id)."""
    n = 0
    for grade, cat_key, subject_id in all_grades:
        if cat_key not in AUTO_AWARD_CATEGORY_KEYS:
            continue
        if grade.snapshot_id is None:
            threshold = std_by_subject.get(subject_id)
        else:
            threshold = snap_thresholds.get((grade.snapshot_id, subject_id))
        if threshold is not None and float(grade.score) >= threshold:
            n += 1
    return n


@router.get("/api/students/{student_id}/grades", response_model=StudentGradesView)
def get_student_grades(
    student_id: UUID,
    user_id: Annotated[UUID, Depends(require_user_id)],
    db: Annotated[Session, Depends(get_db)],
    semester_id: Annotated[UUID | None, Query()] = None,
) -> StudentGradesView:
    student = _get_student(db, user_id, student_id)
    sem = _resolve_semester(db, user_id, semester_id)
    if sem is None:
        return StudentGradesView(semester_id=None, subjects=[], grades=[])

    # Pull grades + the joined item / subject / category info for this
    # student within the chosen semester.
    rows = (
        db.query(Grade, Item, Subject, Category)
        .join(Item, Grade.item_id == Item.id)
        .join(Subject, Item.subject_id == Subject.id)
        .join(Category, Item.category_id == Category.id)
        .filter(
            Grade.student_id == student.id,
            Grade.user_id == user_id,
            Grade.snapshot_id.is_(None),  # live transcript view (#169)
            Item.semester_id == sem.id,
        )
        .order_by(Grade.created_at.desc())
        .all()
    )

    # Per-student × per-subject thresholds (issue #10) — used to flag rows.
    standards_by_subject = {
        s.subject_id: float(s.threshold)
        for s in db.query(StudentStandard)
        .filter(
            StudentStandard.user_id == user_id,
            StudentStandard.student_id == student.id,
        )
        .all()
    }

    # Per-subject category weights (issue #6 / #7) — used for the weighted
    # total computation.
    weights = (
        db.query(SubjectCategoryWeight, Subject, Category)
        .join(Subject, SubjectCategoryWeight.subject_id == Subject.id)
        .join(Category, SubjectCategoryWeight.category_id == Category.id)
        .filter(SubjectCategoryWeight.user_id == user_id)
        .all()
    )
    # weight_by[subject_id][category_system_key] = weight
    weight_by: dict[UUID, dict[str, int]] = {}
    for w, subj, cat in weights:
        weight_by.setdefault(w.subject_id, {})[cat.system_key] = w.weight

    # Group grades for weighted-total math.
    by_subject: dict[UUID, dict[str, list[float]]] = {}
    subject_meta: dict[UUID, tuple[str | None, str | None]] = {}
    for grade, item, subj, cat in rows:
        key = subj.id
        subject_meta[key] = (subj.system_key, subj.display_name)
        by_subject.setdefault(key, {}).setdefault(cat.system_key, []).append(
            float(grade.score)
        )

    summaries = _build_subject_summaries(by_subject, subject_meta, weight_by)

    grade_rows: list[StudentGradeRow] = []
    for grade, item, subj, cat in rows:
        threshold = standards_by_subject.get(subj.id)
        met = (
            threshold is not None
            and cat.system_key in AUTO_AWARD_CATEGORY_KEYS
            and float(grade.score) >= threshold
        )
        grade_rows.append(
            StudentGradeRow(
                grade_id=grade.id,
                item_id=item.id,
                item_name=item.name,
                subject_id=subj.id,
                subject_system_key=subj.system_key,
                subject_display_name=subj.display_name,
                category_system_key=cat.system_key,
                score=float(grade.score),
                threshold=threshold,
                met_standard=met,
                created_at=grade.created_at,
            )
        )

    # Total 達標 count for the whole semester (#210). Counts EVERY qualifying
    # grade record — one per 段考/小考 grade whose score >= the student's
    # threshold for that subject — regardless of whether it has since been
    # archived into a snapshot. Each grade lives in exactly one bucket
    # (create_snapshot moves live grades into the snapshot bucket), so live +
    # snapshot grades never double-count.
    all_grades = (
        db.query(Grade, Category.system_key, Item.subject_id)
        .join(Item, Grade.item_id == Item.id)
        .join(Category, Item.category_id == Category.id)
        .filter(
            Grade.student_id == student.id,
            Grade.user_id == user_id,
            Item.semester_id == sem.id,
        )
        .all()
    )
    # Frozen per-(snapshot, subject) thresholds for archived grades (#160).
    snap_thresholds = {
        (s.snapshot_id, s.subject_id): float(s.threshold)
        for s in db.query(SnapshotStandard).filter(
            SnapshotStandard.user_id == user_id,
            SnapshotStandard.student_id == student.id,
        )
    }
    met_count_total = _count_met(
        all_grades, standards_by_subject, snap_thresholds
    )

    return StudentGradesView(
        semester_id=sem.id,
        subjects=summaries,
        grades=grade_rows,
        met_count_total=met_count_total,
    )


@router.get(
    "/api/classrooms/{classroom_id}/grade-cards",
    response_model=ClassGradeCardsView,
)
def get_classroom_grade_cards(
    classroom_id: UUID,
    user_id: Annotated[UUID, Depends(require_user_id)],
    db: Annotated[Session, Depends(get_db)],
    semester_id: Annotated[UUID | None, Query()] = None,
) -> ClassGradeCardsView:
    """One grade card per student for a whole class — used by the print page
    (#210 follow-up). Bundles, per student: weighted per-subject summaries,
    本學期達標次數 (live + snapshots), and cumulative 總點數. All roster-wide
    queries are batched (no N+1)."""
    classroom = (
        db.query(Classroom)
        .filter(Classroom.id == classroom_id, Classroom.user_id == user_id)
        .one_or_none()
    )
    if classroom is None:
        raise _not_found("classroom")

    students = (
        db.query(Student)
        .filter(
            Student.classroom_id == classroom_id,
            Student.user_id == user_id,
        )
        .order_by(Student.seat_number.asc())
        .all()
    )
    roster_ids = [s.id for s in students]

    # 總點數 per student (cumulative, reset-aware) — bulk, one query.
    points_by_student: dict[UUID, int] = {sid: 0 for sid in roster_ids}
    if roster_ids:
        last_reset = _latest_reset_map_for_classroom(db, user_id, classroom_id)
        for sid, pts, ts in (
            db.query(
                PointRecord.student_id,
                PointRecord.points,
                PointRecord.created_at,
            )
            .filter(
                PointRecord.user_id == user_id,
                PointRecord.student_id.in_(roster_ids),
            )
            .all()
        ):
            floor = last_reset.get(sid)
            if floor is not None and ts <= floor:
                continue
            points_by_student[sid] = points_by_student.get(sid, 0) + int(pts)

    sem = _resolve_semester(db, user_id, semester_id)
    if sem is None or not roster_ids:
        return ClassGradeCardsView(
            semester_id=sem.id if sem else None,
            classroom_grade=classroom.grade,
            classroom_name=classroom.name,
            subjects=[],
            cards=[
                StudentGradeCard(
                    student_id=s.id,
                    seat_number=s.seat_number,
                    name=s.name,
                    subjects=[],
                    met_count_total=0,
                    semester_points=points_by_student.get(s.id, 0),
                )
                for s in students
            ],
        )

    # Per-subject category weights (user-scoped, all subjects).
    weight_by: dict[UUID, dict[str, int]] = {}
    for w, cat in (
        db.query(SubjectCategoryWeight, Category)
        .join(Category, SubjectCategoryWeight.category_id == Category.id)
        .filter(SubjectCategoryWeight.user_id == user_id)
        .all()
    ):
        weight_by.setdefault(w.subject_id, {})[cat.system_key] = w.weight

    # Live grades for the whole roster in this semester → per student×subject.
    by_student: dict[UUID, dict[UUID, dict[str, list[float]]]] = {}
    subject_meta: dict[UUID, tuple[str | None, str | None]] = {}
    for sid, subj_id, subj_sys, subj_disp, cat_key, score in (
        db.query(
            Grade.student_id,
            Subject.id,
            Subject.system_key,
            Subject.display_name,
            Category.system_key,
            Grade.score,
        )
        .join(Item, Grade.item_id == Item.id)
        .join(Subject, Item.subject_id == Subject.id)
        .join(Category, Item.category_id == Category.id)
        .filter(
            Grade.user_id == user_id,
            Grade.snapshot_id.is_(None),
            Item.semester_id == sem.id,
            Grade.student_id.in_(roster_ids),
        )
        .all()
    ):
        subject_meta[subj_id] = (subj_sys, subj_disp)
        by_student.setdefault(sid, {}).setdefault(subj_id, {}).setdefault(
            cat_key, []
        ).append(float(score))

    # Live thresholds per (student, subject) for the 達標 count.
    std_by_student: dict[UUID, dict[UUID, float]] = {}
    for st in (
        db.query(StudentStandard)
        .filter(
            StudentStandard.user_id == user_id,
            StudentStandard.student_id.in_(roster_ids),
        )
        .all()
    ):
        std_by_student.setdefault(st.student_id, {})[st.subject_id] = float(
            st.threshold
        )

    # Frozen snapshot thresholds per student, keyed by (snapshot_id, subject).
    snap_by_student: dict[UUID, dict[tuple[UUID, UUID], float]] = {}
    for sn in (
        db.query(SnapshotStandard)
        .filter(
            SnapshotStandard.user_id == user_id,
            SnapshotStandard.student_id.in_(roster_ids),
        )
        .all()
    ):
        snap_by_student.setdefault(sn.student_id, {})[
            (sn.snapshot_id, sn.subject_id)
        ] = float(sn.threshold)

    # All grades (live + snapshot) in this semester for the 達標 count.
    met_grades: dict[UUID, list[tuple]] = {}
    for grade, cat_key, subj_id in (
        db.query(Grade, Category.system_key, Item.subject_id)
        .join(Item, Grade.item_id == Item.id)
        .join(Category, Item.category_id == Category.id)
        .filter(
            Grade.user_id == user_id,
            Item.semester_id == sem.id,
            Grade.student_id.in_(roster_ids),
        )
        .all()
    ):
        met_grades.setdefault(grade.student_id, []).append(
            (grade, cat_key, subj_id)
        )

    cards = [
        StudentGradeCard(
            student_id=s.id,
            seat_number=s.seat_number,
            name=s.name,
            subjects=_build_subject_summaries(
                by_student.get(s.id, {}), subject_meta, weight_by
            ),
            met_count_total=_count_met(
                met_grades.get(s.id, []),
                std_by_student.get(s.id, {}),
                snap_by_student.get(s.id, {}),
            ),
            semester_points=points_by_student.get(s.id, 0),
        )
        for s in students
    ]

    subjects = [
        GradeCardSubject(
            subject_id=sid,
            subject_system_key=meta[0],
            subject_display_name=meta[1],
        )
        for sid, meta in subject_meta.items()
    ]

    return ClassGradeCardsView(
        semester_id=sem.id,
        classroom_grade=classroom.grade,
        classroom_name=classroom.name,
        subjects=subjects,
        cards=cards,
    )


@router.get("/api/students/{student_id}/points", response_model=StudentPointsView)
def get_student_points(
    student_id: UUID,
    user_id: Annotated[UUID, Depends(require_user_id)],
    db: Annotated[Session, Depends(get_db)],
    semester_id: Annotated[UUID | None, Query()] = None,
    page: Annotated[int, Query(ge=1)] = 1,
    page_size: Annotated[int, Query(ge=1, le=100)] = 20,
    reason: Annotated[str | None, Query()] = None,
    sort: Annotated[Literal["newest", "oldest"], Query()] = "newest",
) -> StudentPointsView:
    student = _get_student(db, user_id, student_id)
    sem = _resolve_semester(db, user_id, semester_id)
    if sem is None:
        return StudentPointsView(
            semester_id=None,
            total=0,
            record_count=0,
            page=page,
            page_size=page_size,
            total_pages=0,
            reasons=[],
            data=[],
        )

    # Pull every record in the semester window once (unfiltered) so we can
    # compute reset-aware running balances in Python — the SQL window-fn
    # version can't easily restart partitions at PointReset boundaries.
    all_records = (
        db.query(PointRecord)
        .filter(
            PointRecord.user_id == user_id,
            PointRecord.student_id == student.id,
        )
        .order_by(PointRecord.created_at.asc(), PointRecord.id.asc())
        .all()
    )
    reset_rows = (
        db.query(PointReset)
        .filter(
            PointReset.user_id == user_id,
            PointReset.student_id == student.id,
        )
        .order_by(PointReset.reset_at.asc(), PointReset.id.asc())
        .all()
    )

    # Walk records + resets together in chronological order. Maintain a
    # running balance that snaps back to 0 each time a reset boundary is
    # crossed. Records share the timestamp ≤ reset_at → still pre-reset.
    balance_by_record: dict[UUID, int] = {}
    balance_before_by_reset: dict[UUID, int] = {}
    running = 0
    reset_idx = 0
    for rec in all_records:
        # Apply any resets whose moment is ≤ this record's timestamp.
        while (
            reset_idx < len(reset_rows)
            and reset_rows[reset_idx].reset_at <= rec.created_at
        ):
            balance_before_by_reset[reset_rows[reset_idx].id] = running
            running = 0
            reset_idx += 1
        running += int(rec.points)
        balance_by_record[rec.id] = running
    # Resets that come after all records (unusual but possible — e.g.
    # teacher reset with no awards since) still need a balance_before.
    while reset_idx < len(reset_rows):
        balance_before_by_reset[reset_rows[reset_idx].id] = running
        running = 0
        reset_idx += 1

    # Filter + sort + paginate the records (resets are returned unfiltered).
    filtered = all_records if reason is None else [
        r for r in all_records if r.reason == reason
    ]
    record_count = len(filtered)
    total_pages = (record_count + page_size - 1) // page_size if record_count else 0
    ordered = (
        sorted(filtered, key=lambda r: (r.created_at, r.id))
        if sort == "oldest"
        else sorted(filtered, key=lambda r: (r.created_at, r.id), reverse=True)
    )
    start_idx = (page - 1) * page_size
    page_rows = ordered[start_idx:start_idx + page_size]

    # Distinct reasons across the unfiltered window.
    reasons = sorted({r.reason for r in all_records})

    total = _points_cumulative(db, user_id, student.id)
    return StudentPointsView(
        semester_id=sem.id,
        total=total,
        record_count=record_count,
        page=page,
        page_size=page_size,
        total_pages=total_pages,
        reasons=reasons,
        data=[
            StudentPointRow(
                id=r.id,
                points=r.points,
                reason=r.reason,
                source_grade_id=r.source_grade_id,
                created_at=r.created_at,
                balance_after=balance_by_record.get(r.id, 0),
            )
            for r in page_rows
        ],
        resets=[
            StudentPointResetRow(
                id=r.id,
                reset_at=r.reset_at,
                reason=r.reason,
                balance_before=balance_before_by_reset.get(r.id, 0),
            )
            for r in reset_rows
        ],
    )
