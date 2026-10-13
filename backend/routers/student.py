"""Student CRUD, Excel batch import, and template download.

All routes are scoped to the authenticated user. Classroom-nested routes
(list/create/import/template) live under /api/classrooms/{id}/students; the
entity-level routes (update/delete) live under /api/students/{id}.
"""
from __future__ import annotations

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
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from assistant_access import (
    assistant_ids_in_classroom,
    check_email_change_vs_assistants,
    is_assistant,
    revoke_assistant,
    set_assistant,
)
from auth import require_user_id
from database import get_db
from email_validation import InvalidEmail, clean_email, duplicate_emails
from models.access import AccountLink
from models.classroom import Classroom, Student
from schemas import (
    ImportPreviewSummary,
    ImportResult,
    ImportRowPreview,
    ListMeta,
    StudentAssistantUpdate,
    StudentCreate,
    StudentList,
    StudentOut,
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


def _invalid_email() -> HTTPException:
    return _bad_request("errors.student.invalid_email", "Email is invalid.")


def _clean_email_or_400(raw: str | None) -> str | None:
    try:
        return clean_email(raw)
    except InvalidEmail:
        raise _invalid_email()


def _on_email_changed(db: Session, student: Student, old_email: str | None) -> None:
    """Side effects of a roster email change (#261).

    The student's `account_link(self)` belonged to whoever signed in with the
    OLD email; drop it so the account that owns the new email can bind on
    its next sign-in (`ix_account_link_one_self_per_student` allows only
    one self link per student).
    """
    if (old_email or None) == (student.email or None):
        return
    db.query(AccountLink).filter(
        AccountLink.student_id == student.id,
        AccountLink.link_role == "self",
    ).delete(synchronize_session=False)
    # No email → can't sign in → no longer a 小老師 (#262). A changed (not
    # cleared) email keeps the role; the new address binds on next sign-in.
    if not student.email:
        revoke_assistant(db, student.id)


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


def _serialize_student(s: Student, assistant: bool = False) -> StudentOut:
    return StudentOut(
        is_assistant=assistant,
        id=s.id,
        classroom_id=s.classroom_id,
        seat_number=s.seat_number,
        name=s.name,
        email=s.email,
        source=s.source,
        created_at=s.created_at,
        updated_at=s.updated_at,
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
        .filter(Student.classroom_id == classroom_id, Student.user_id == user_id)
        .order_by(Student.seat_number.asc())
        .all()
    )
    assistants = assistant_ids_in_classroom(db, classroom_id)
    return StudentList(
        data=[_serialize_student(s, s.id in assistants) for s in rows],
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
    email = _clean_email_or_400(body.email)
    student = Student(
        user_id=user_id,
        classroom_id=classroom_id,
        seat_number=body.seat_number,
        name=body.name,
        email=email,
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
    if body.is_assistant:
        set_assistant(db, student, True)
    # A new row taking an assistant classmate's email is refused (409).
    check_email_change_vs_assistants(db, student)
    db.commit()
    db.refresh(student)
    return _serialize_student(student, is_assistant(db, student))


@router.put("/api/students/{student_id}", response_model=StudentOut)
def update_student(
    student_id: UUID,
    body: StudentUpdate,
    user_id: Annotated[UUID, Depends(require_user_id)],
    db: Annotated[Session, Depends(get_db)],
) -> StudentOut:
    student = _get_owned_student(db, user_id, student_id)
    email = _clean_email_or_400(body.email)
    transferred = False
    if body.classroom_id is not None and body.classroom_id != student.classroom_id:
        _get_owned_classroom(db, user_id, body.classroom_id)  # ensures ownership
        student.classroom_id = body.classroom_id
        transferred = True
    student.seat_number = body.seat_number
    student.name = body.name
    old_email = student.email
    student.email = email
    try:
        db.flush()
    except IntegrityError:
        db.rollback()
        raise _conflict(
            "errors.student.duplicate_seat",
            "Seat number already exists in this classroom.",
        )
    email_changed = (old_email or None) != (student.email or None)
    _on_email_changed(db, student, old_email)
    if transferred:
        # 小老師 is per class: a transfer ends the role (#262).
        revoke_assistant(db, student.id)
    if body.is_assistant is not None:
        set_assistant(
            db, student, body.is_assistant, email_changed=email_changed
        )
    if email_changed or transferred:
        # Final state: an assistant must not share an email with a
        # classmate, whichever side changed (409, nothing is saved).
        check_email_change_vs_assistants(db, student)
    db.commit()
    db.refresh(student)
    return _serialize_student(student, is_assistant(db, student))


@router.put("/api/students/{student_id}/assistant", response_model=StudentOut)
def update_student_assistant(
    student_id: UUID,
    body: StudentAssistantUpdate,
    user_id: Annotated[UUID, Depends(require_user_id)],
    db: Annotated[Session, Depends(get_db)],
) -> StudentOut:
    """Make / unmake a student 小老師 of their class (#262).

    400 `errors.assistant.email_required` without an email; 409
    `errors.assistant.duplicate_email` when a classmate shares the email.
    Unsetting also removes every item assignment; grades already entered
    keep their stamp.
    """
    student = _get_owned_student(db, user_id, student_id)
    set_assistant(db, student, body.is_assistant)
    db.commit()
    db.refresh(student)
    return _serialize_student(student, is_assistant(db, student))


@router.delete("/api/students/{student_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_student(
    student_id: UUID,
    user_id: Annotated[UUID, Depends(require_user_id)],
    db: Annotated[Session, Depends(get_db)],
) -> None:
    student = _get_owned_student(db, user_id, student_id)
    db.delete(student)
    db.commit()


# ---------- Excel template ----------

# Excel layout (student roster only):
#   Row 1: header (座號 / 姓名（選填）/ email（選填）)
#   Row 2+: data rows
# Grade import is a separate (future) endpoint with its own file format.

_HEADER_ROW = ["座號", "姓名（選填）", "email（選填）"]


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
    # One example row; teacher deletes before uploading their own data.
    ws.append([1, "範例學生", "example@school.edu"])

    ws.column_dimensions["A"].width = 10
    ws.column_dimensions["B"].width = 20
    ws.column_dimensions["C"].width = 28

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


# ---------- Excel import (student roster only) ----------

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
        raise _bad_request("errors.import.bad_file_type", "File must be .xlsx")

    content = await file.read()
    try:
        wb = load_workbook(BytesIO(content), read_only=True, data_only=True)
    except Exception:
        raise _bad_request(
            "errors.import.unreadable", "Excel file could not be parsed."
        )
    ws = wb.active
    if ws is None:
        raise _bad_request("errors.import.empty", "Workbook is empty.")

    header_map, header_errors = _parse_header(ws)
    if header_errors:
        raise _bad_request("errors.import.bad_header", "; ".join(header_errors))

    existing_students = (
        db.query(Student)
        .filter(Student.classroom_id == classroom_id, Student.user_id == user_id)
        .all()
    )
    by_seat: dict[int, Student] = {s.seat_number: s for s in existing_students}

    preview_rows: list[ImportRowPreview] = []
    seen_seats: set[int] = set()
    # Row 1 = header, data starts at row 2.
    for row_idx, row in enumerate(
        ws.iter_rows(min_row=2, values_only=True), start=2
    ):
        if row is None or all(c is None or c == "" for c in row):
            continue
        preview_rows.append(_parse_row(row_idx, row, header_map, by_seat, seen_seats))
    _flag_duplicate_emails(preview_rows, existing_students)

    summary = ImportPreviewSummary(
        total_rows=len(preview_rows),
        to_create=sum(1 for r in preview_rows if r.action == "create"),
        to_update=sum(1 for r in preview_rows if r.action == "update"),
        errors=sum(1 for r in preview_rows if r.action == "error"),
        warnings=sum(1 for r in preview_rows if r.warnings),
    )

    if dry_run:
        return ImportResult(dry_run=True, summary=summary, rows=preview_rows)

    if summary.errors > 0:
        raise _bad_request(
            "errors.import.has_errors",
            "Cannot import while preview contains errors.",
        )

    try:
        _commit_import(db, user_id, classroom_id, preview_rows, by_seat)
        db.commit()
    except IntegrityError:
        # Any residual DB conflict (e.g. a seat that slipped past preview):
        # return a clean, translatable error instead of an unhandled 500 that
        # would escape CORSMiddleware and look like a CORS failure to the client.
        db.rollback()
        raise _conflict(
            "errors.student.duplicate_seat",
            "Seat number already exists in this classroom.",
        )
    return ImportResult(dry_run=False, summary=summary, rows=preview_rows)


# ---------- parse helpers ----------

def _parse_header(ws: Any) -> tuple[dict[str, int], list[str]]:
    """Return {column_name: column_index} and a list of header errors.

    座號 is the only required column; 姓名 / email are optional. We accept both
    the bare names and the "(選填)" decorated forms emitted by the template.
    """
    header_row = next(ws.iter_rows(min_row=1, max_row=1, values_only=True), None)
    if not header_row:
        return {}, ["Header row is missing."]
    header_map: dict[str, int] = {}
    for idx, raw in enumerate(header_row):
        if raw is None:
            continue
        name = str(raw).strip()
        if not name:
            continue
        # Strip optional "（選填）" / "(選填)" suffix so the parser can find
        # the column regardless of how the template was decorated.
        for suffix in ("（選填）", "(選填)"):
            if name.endswith(suffix):
                name = name[: -len(suffix)].strip()
                break
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

    # email (optional) — same normalise/validate helper as the single form.
    email_raw = cell("email")
    if email_raw in (None, ""):
        email_raw = cell("Email")
    email: str | None
    try:
        email = clean_email(email_raw)
    except InvalidEmail:
        email = str(email_raw).strip()
        errors.append("email is invalid")

    if errors:
        return ImportRowPreview(
            row_number=row_idx,
            action="error",
            seat_number=seat,
            name=name,
            email=email,
            errors=errors,
        )

    existing = by_seat.get(seat) if seat is not None else None
    warnings: list[str] = []
    if existing is not None and email is None:
        # Blank email cell on an UPDATE row means "leave it alone", not
        # "clear it" (#261) — teachers often re-import a roster that only
        # carries seat + name. Preview shows the email that will remain.
        email = existing.email
        if email:
            warnings.append("email_unchanged")
    return ImportRowPreview(
        row_number=row_idx,
        action="update" if existing else "create",
        seat_number=seat,
        name=name,
        email=email,
        existing_id=existing.id if existing else None,
        warnings=warnings,
    )


def _flag_duplicate_emails(
    rows: list[ImportRowPreview], existing_students: list[Student]
) -> None:
    """Warn (not block) when, after this import, two students in the class
    would share an email. Computed on the post-import state: existing
    students keyed by seat, overridden by the file's rows."""
    final_by_seat: dict[int, str | None] = {
        s.seat_number: s.email for s in existing_students
    }
    for r in rows:
        if r.action != "error" and r.seat_number is not None:
            final_by_seat[r.seat_number] = r.email
    dupes = duplicate_emails(final_by_seat.values())
    if not dupes:
        return
    for r in rows:
        if r.action != "error" and r.email and r.email.lower() in dupes:
            r.warnings.append("duplicate_email")


# ---------- commit ----------

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
            # Blank cell → r.email was filled with the stored value in
            # _parse_row, so this is a no-op; a filled cell updates it.
            old_email = student.email
            student.email = r.email
            _on_email_changed(db, student, old_email)
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

