"""Student CRUD, Excel batch import, and template download.

All routes are scoped to the authenticated user. Classroom-nested routes
(list/create/import/template) live under /api/classrooms/{id}/students; the
entity-level routes (update/delete) live under /api/students/{id}.
"""
from __future__ import annotations

from decimal import Decimal, InvalidOperation
from io import BytesIO
from typing import Annotated, Any
from uuid import UUID

from fastapi import (
    APIRouter,
    Depends,
    File,
    HTTPException,
    Query,
    UploadFile,
    status,
)
from fastapi.responses import StreamingResponse
from openpyxl import Workbook, load_workbook
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, selectinload

from auth import require_user_id
from database import get_db
from models.classroom import Classroom, Student
from models.curriculum import SYSTEM_CATEGORY_KEYS, Category
from models.grading import StudentStandard
from schemas import (
    STANDARD_COLUMNS,
    ImportPreviewSummary,
    ImportResult,
    ImportRowPreview,
    ListMeta,
    StudentCreate,
    StudentList,
    StudentOut,
    StudentStandardOut,
    StudentUpdate,
)

router = APIRouter()


# ---------- error helpers ----------

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


def _conflict(message_key: str, message: str) -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_409_CONFLICT,
        detail={
            "error": {
                "code": "CONFLICT",
                "message_key": message_key,
                "message": message,
            }
        },
    )


def _bad_request(message_key: str, message: str) -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_400_BAD_REQUEST,
        detail={
            "error": {
                "code": "BAD_REQUEST",
                "message_key": message_key,
                "message": message,
            }
        },
    )


# ---------- lookups ----------

def _get_owned_classroom(db: Session, user_id: UUID, classroom_id: UUID) -> Classroom:
    c = (
        db.query(Classroom)
        .filter(Classroom.id == classroom_id, Classroom.user_id == user_id)
        .one_or_none()
    )
    if c is None:
        raise _not_found("classroom")
    return c


def _get_owned_student(db: Session, user_id: UUID, student_id: UUID) -> Student:
    s = (
        db.query(Student)
        .filter(Student.id == student_id, Student.user_id == user_id)
        .one_or_none()
    )
    if s is None:
        raise _not_found("student")
    return s


def _categories_by_key(db: Session, user_id: UUID) -> dict[str, Category]:
    rows = db.query(Category).filter(Category.user_id == user_id).all()
    return {c.system_key: c for c in rows}


def _serialize_student(s: Student, cats_by_id: dict[UUID, str]) -> StudentOut:
    return StudentOut(
        id=s.id,
        classroom_id=s.classroom_id,
        seat_number=s.seat_number,
        name=s.name,
        email=s.email,
        source=s.source,
        created_at=s.created_at,
        updated_at=s.updated_at,
        standards=[
            StudentStandardOut(
                system_key=cats_by_id.get(std.category_id, ""),
                threshold=float(std.threshold),
            )
            for std in s.standards
            if std.category_id in cats_by_id
        ],
    )


# ---------- CRUD ----------

@router.get("/api/classrooms/{classroom_id}/students", response_model=StudentList)
def list_students(
    classroom_id: UUID,
    user_id: Annotated[UUID, Depends(require_user_id)],
    db: Annotated[Session, Depends(get_db)],
) -> StudentList:
    _get_owned_classroom(db, user_id, classroom_id)
    rows = (
        db.query(Student)
        .options(selectinload(Student.standards))
        .filter(Student.classroom_id == classroom_id, Student.user_id == user_id)
        .order_by(Student.seat_number.asc())
        .all()
    )
    cats = _categories_by_key(db, user_id)
    cats_by_id = {c.id: k for k, c in cats.items()}
    return StudentList(
        data=[_serialize_student(s, cats_by_id) for s in rows],
        meta=ListMeta(total=len(rows)),
    )


@router.post(
    "/api/classrooms/{classroom_id}/students",
    response_model=StudentOut,
    status_code=status.HTTP_201_CREATED,
)
def create_student(
    classroom_id: UUID,
    body: StudentCreate,
    user_id: Annotated[UUID, Depends(require_user_id)],
    db: Annotated[Session, Depends(get_db)],
) -> StudentOut:
    _get_owned_classroom(db, user_id, classroom_id)
    student = Student(
        user_id=user_id,
        classroom_id=classroom_id,
        seat_number=body.seat_number,
        name=body.name,
        email=body.email,
        source="manual",
    )
    db.add(student)
    try:
        db.flush()
    except IntegrityError:
        db.rollback()
        raise _conflict(
            "errors.student.duplicate_seat",
            "Seat number already exists in this classroom.",
        )
    _apply_standards(db, user_id, student, body.standards or {})
    db.commit()
    db.refresh(student)
    cats = _categories_by_key(db, user_id)
    return _serialize_student(student, {c.id: k for k, c in cats.items()})


@router.put("/api/students/{student_id}", response_model=StudentOut)
def update_student(
    student_id: UUID,
    body: StudentUpdate,
    user_id: Annotated[UUID, Depends(require_user_id)],
    db: Annotated[Session, Depends(get_db)],
) -> StudentOut:
    student = _get_owned_student(db, user_id, student_id)
    if body.classroom_id is not None and body.classroom_id != student.classroom_id:
        _get_owned_classroom(db, user_id, body.classroom_id)  # ensures ownership
        student.classroom_id = body.classroom_id
    student.seat_number = body.seat_number
    student.name = body.name
    student.email = body.email
    try:
        db.flush()
    except IntegrityError:
        db.rollback()
        raise _conflict(
            "errors.student.duplicate_seat",
            "Seat number already exists in this classroom.",
        )
    if body.standards is not None:
        _apply_standards(db, user_id, student, body.standards)
    db.commit()
    db.refresh(student)
    cats = _categories_by_key(db, user_id)
    return _serialize_student(student, {c.id: k for k, c in cats.items()})


@router.delete("/api/students/{student_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_student(
    student_id: UUID,
    user_id: Annotated[UUID, Depends(require_user_id)],
    db: Annotated[Session, Depends(get_db)],
) -> None:
    student = _get_owned_student(db, user_id, student_id)
    db.delete(student)
    db.commit()


# ---------- standards helper ----------

def _apply_standards(
    db: Session,
    user_id: UUID,
    student: Student,
    standards: dict[str, float],
) -> None:
    """Upsert standards passed as {system_key: threshold}.

    Unknown system_keys are silently ignored (caller validates earlier).
    Existing rows for keys not present in the payload are left alone.
    """
    if not standards:
        return
    cats = _categories_by_key(db, user_id)
    existing = {
        std.category_id: std
        for std in db.query(StudentStandard)
        .filter(StudentStandard.student_id == student.id)
        .all()
    }
    for key, value in standards.items():
        cat = cats.get(key)
        if cat is None:
            continue
        std = existing.get(cat.id)
        if std is None:
            db.add(
                StudentStandard(
                    user_id=user_id,
                    student_id=student.id,
                    category_id=cat.id,
                    threshold=Decimal(str(value)),
                )
            )
        else:
            std.threshold = Decimal(str(value))


# ---------- Excel template ----------

_HEADER_ROW = [
    "座號",
    "姓名",
    "email",
    "段考_標準",
    "小考_標準",
    "作業_標準",
    "出席率_標準",
    "額外加分_標準",
]


@router.get(
    "/api/classrooms/{classroom_id}/students/template.xlsx",
    response_class=StreamingResponse,
)
def download_template(
    classroom_id: UUID,
    user_id: Annotated[UUID, Depends(require_user_id)],
    db: Annotated[Session, Depends(get_db)],
) -> StreamingResponse:
    _get_owned_classroom(db, user_id, classroom_id)
    wb = Workbook()
    ws = wb.active
    ws.title = "students"
    ws.append(_HEADER_ROW)
    # Example row to show format expectations; teacher deletes before uploading
    ws.append([1, "範例學生", "example@school.edu", 80, 70, 60, 95, 0])
    buf = BytesIO()
    wb.save(buf)
    buf.seek(0)
    return StreamingResponse(
        buf,
        media_type=(
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        ),
        headers={
            "Content-Disposition": (
                'attachment; filename="students_template.xlsx"'
            ),
        },
    )


# ---------- Excel import ----------

@router.post(
    "/api/classrooms/{classroom_id}/students/import",
    response_model=ImportResult,
)
async def import_students(
    classroom_id: UUID,
    user_id: Annotated[UUID, Depends(require_user_id)],
    db: Annotated[Session, Depends(get_db)],
    file: Annotated[UploadFile, File(...)],
    dry_run: Annotated[bool, Query()] = True,
) -> ImportResult:
    _get_owned_classroom(db, user_id, classroom_id)

    if not file.filename or not file.filename.lower().endswith(".xlsx"):
        raise _bad_request(
            "errors.import.bad_file_type",
            "File must be .xlsx",
        )

    content = await file.read()
    try:
        wb = load_workbook(BytesIO(content), read_only=True, data_only=True)
    except Exception:
        raise _bad_request(
            "errors.import.unreadable",
            "Excel file could not be parsed.",
        )
    ws = wb.active
    if ws is None:
        raise _bad_request(
            "errors.import.empty",
            "Workbook is empty.",
        )

    header_map, header_errors = _parse_header(ws)
    if header_errors:
        raise _bad_request(
            "errors.import.bad_header",
            "; ".join(header_errors),
        )

    existing_students = (
        db.query(Student)
        .filter(
            Student.classroom_id == classroom_id,
            Student.user_id == user_id,
        )
        .all()
    )
    by_seat: dict[int, Student] = {s.seat_number: s for s in existing_students}

    preview_rows: list[ImportRowPreview] = []
    seen_seats: set[int] = set()
    # Excel rows are 1-indexed; row 1 = header, data starts at 2
    for row_idx, row in enumerate(ws.iter_rows(min_row=2, values_only=True), start=2):
        if row is None or all(c is None or c == "" for c in row):
            continue
        preview = _parse_row(row_idx, row, header_map, by_seat, seen_seats)
        preview_rows.append(preview)

    summary = ImportPreviewSummary(
        total_rows=len(preview_rows),
        to_create=sum(1 for r in preview_rows if r.action == "create"),
        to_update=sum(1 for r in preview_rows if r.action == "update"),
        errors=sum(1 for r in preview_rows if r.action == "error"),
    )

    if dry_run:
        return ImportResult(dry_run=True, summary=summary, rows=preview_rows)

    if summary.errors > 0:
        raise _bad_request(
            "errors.import.has_errors",
            "Cannot import while preview contains errors.",
        )

    _commit_import(db, user_id, classroom_id, preview_rows, by_seat)
    db.commit()
    return ImportResult(dry_run=False, summary=summary, rows=preview_rows)


def _parse_header(ws: Any) -> tuple[dict[str, int], list[str]]:
    """Return {column_name: column_index} and a list of header errors."""
    header_row = next(ws.iter_rows(min_row=1, max_row=1, values_only=True), None)
    if not header_row:
        return {}, ["Header row is missing."]
    raw = [str(c).strip() if c is not None else "" for c in header_row]
    header_map: dict[str, int] = {}
    for idx, name in enumerate(raw):
        if name:
            header_map[name] = idx
    errors: list[str] = []
    if "座號" not in header_map:
        errors.append("Required column missing: 座號")
    return header_map, errors


def _parse_row(
    row_idx: int,
    row: tuple[Any, ...],
    header_map: dict[str, int],
    by_seat: dict[int, Student],
    seen_seats: set[int],
) -> ImportRowPreview:
    errors: list[str] = []

    def cell(name: str) -> Any:
        idx = header_map.get(name)
        if idx is None or idx >= len(row):
            return None
        return row[idx]

    # seat number
    seat_raw = cell("座號")
    seat: int | None = None
    try:
        if seat_raw is None or seat_raw == "":
            errors.append("座號 is required")
        else:
            seat = int(seat_raw)
            if seat < 1 or seat > 99:
                errors.append("座號 must be 1–99")
                seat = None
    except (TypeError, ValueError):
        errors.append("座號 must be an integer")

    if seat is not None:
        if seat in seen_seats:
            errors.append("座號 duplicated in file")
        seen_seats.add(seat)

    # name (optional)
    name_raw = cell("姓名")
    name = str(name_raw).strip() if name_raw not in (None, "") else None

    # email (optional)
    email_raw = cell("email")
    email = str(email_raw).strip() if email_raw not in (None, "") else None
    if email and "@" not in email:
        errors.append("email is invalid")

    # standards
    standards: dict[str, float] = {}
    for col_name, system_key in STANDARD_COLUMNS.items():
        v = cell(col_name)
        if v is None or v == "":
            continue
        try:
            num = float(Decimal(str(v)))
        except (InvalidOperation, ValueError):
            errors.append(f"{col_name} must be a number")
            continue
        if num < 0 or num > 100:
            errors.append(f"{col_name} must be 0–100")
            continue
        standards[system_key] = num

    if errors:
        return ImportRowPreview(
            row_number=row_idx,
            action="error",
            seat_number=seat,
            name=name,
            email=email,
            standards=standards,
            errors=errors,
        )

    existing = by_seat.get(seat) if seat is not None else None
    return ImportRowPreview(
        row_number=row_idx,
        action="update" if existing else "create",
        seat_number=seat,
        name=name,
        email=email,
        standards=standards,
        existing_id=existing.id if existing else None,
    )


def _commit_import(
    db: Session,
    user_id: UUID,
    classroom_id: UUID,
    rows: list[ImportRowPreview],
    by_seat: dict[int, Student],
) -> None:
    for r in rows:
        if r.action == "error" or r.seat_number is None:
            continue
        if r.action == "update" and r.existing_id is not None:
            student = by_seat[r.seat_number]
            student.name = r.name
            student.email = r.email
        else:
            student = Student(
                user_id=user_id,
                classroom_id=classroom_id,
                seat_number=r.seat_number,
                name=r.name,
                email=r.email,
                source="manual",
            )
            db.add(student)
            db.flush()
        _apply_standards(db, user_id, student, r.standards)
