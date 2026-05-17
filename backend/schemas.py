"""Pydantic schemas for API request/response bodies.

Kept in one file for now; split per-entity once this grows past ~300 lines.
"""
from datetime import date, datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


# ---------- shared ----------

class ListMeta(BaseModel):
    total: int


class ErrorBody(BaseModel):
    code: str
    message_key: str
    message: str
    details: dict | None = None


class ErrorResponse(BaseModel):
    error: ErrorBody


# ---------- /api/me ----------

class SeedResult(BaseModel):
    """Idempotent seed report. 0 fields mean nothing new was needed."""
    categories_created: int
    semesters_created: int


class MeUser(BaseModel):
    id: str
    email: str | None = None


class MeSetup(BaseModel):
    has_classes: bool
    has_subjects: bool
    has_current_semester: bool


class MeOut(BaseModel):
    user: MeUser
    setup: MeSetup
    terms_per_year: int


class MeSettingsUpdate(BaseModel):
    terms_per_year: Literal[2, 3, 4]


class SubjectOrderUpdate(BaseModel):
    subject_ids: list[UUID]


class ItemOrderUpdate(BaseModel):
    item_ids: list[UUID]


# ---------- /api/semesters ----------


class SemesterOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    academic_year: int
    term: int
    is_current: bool
    start_date: date
    end_date: date


class SemesterList(BaseModel):
    data: list[SemesterOut]
    meta: ListMeta


class SemesterUpdate(BaseModel):
    academic_year: int = Field(ge=1, le=999)
    term: Literal[1, 2, 3, 4]
    start_date: date
    end_date: date


# ---------- /api/categories ----------


class CategoryOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    system_key: str
    weight: int


class CategoryList(BaseModel):
    data: list[CategoryOut]


class CategoryWeightUpdate(BaseModel):
    system_key: str
    weight: int = Field(ge=0, le=100)


# ---------- /api/subjects + /api/subject-weights ----------


class SubjectOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    system_key: str | None
    display_name: str | None
    is_custom: bool


class SubjectList(BaseModel):
    data: list[SubjectOut]


class SubjectCreate(BaseModel):
    display_name: str = Field(min_length=1, max_length=100)


class SubjectWeightOut(BaseModel):
    subject_id: UUID
    subject_system_key: str | None
    subject_display_name: str | None
    category_id: UUID
    category_system_key: str
    weight: int


class SubjectWeightsList(BaseModel):
    data: list[SubjectWeightOut]


class SubjectWeightsUpdate(BaseModel):
    subject_id: UUID
    category_id: UUID
    weight: int = Field(ge=0, le=100)


class SubjectPointRuleOut(BaseModel):
    subject_id: UUID
    points_awarded: int


class SubjectPointRulesList(BaseModel):
    data: list[SubjectPointRuleOut]


class SubjectPointRuleUpdate(BaseModel):
    subject_id: UUID
    points_awarded: int = Field(ge=0, le=500)


# ---------- /api/classrooms ----------

ClassroomSource = Literal["manual", "duotopia", "google_classroom"]


class ClassroomCreate(BaseModel):
    grade: int = Field(ge=1, le=12)
    name: str = Field(min_length=1, max_length=200)


class ClassroomUpdate(BaseModel):
    grade: int = Field(ge=1, le=12)
    name: str = Field(min_length=1, max_length=200)


class ClassroomOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    grade: int
    name: str
    source: ClassroomSource
    source_external_id: str | None
    created_at: datetime
    updated_at: datetime


class ClassroomDetailOut(ClassroomOut):
    student_count: int


class ClassroomList(BaseModel):
    data: list[ClassroomOut]
    meta: ListMeta


# ---------- /api/students ----------

# Grade import is a separate (future) endpoint — its category / subject name
# lookup tables will live with that code, not here.


class StudentStandardOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    system_key: str
    threshold: float


class StudentCreate(BaseModel):
    seat_number: int = Field(ge=1, le=99)
    name: str | None = Field(default=None, max_length=200)
    email: str | None = Field(default=None, max_length=255)
    standards: dict[str, float] | None = None  # {system_key: threshold}


class StudentUpdate(BaseModel):
    classroom_id: UUID | None = None  # set to transfer
    seat_number: int = Field(ge=1, le=99)
    name: str | None = Field(default=None, max_length=200)
    email: str | None = Field(default=None, max_length=255)
    standards: dict[str, float] | None = None


class StudentOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    classroom_id: UUID
    seat_number: int
    name: str | None
    email: str | None
    source: str
    created_at: datetime
    updated_at: datetime
    standards: list[StudentStandardOut] = []


class StudentList(BaseModel):
    data: list[StudentOut]
    meta: ListMeta


# Excel import preview — one row per student.
class ImportRowPreview(BaseModel):
    row_number: int  # 1-based Excel row; header is row 1, first data row = 2
    action: Literal["create", "update", "error"]
    seat_number: int | None
    name: str | None
    email: str | None
    existing_id: UUID | None = None
    errors: list[str] = []


class ImportPreviewSummary(BaseModel):
    total_rows: int
    to_create: int
    to_update: int
    errors: int


class ImportResult(BaseModel):
    dry_run: bool
    summary: ImportPreviewSummary
    rows: list[ImportRowPreview]


# ---------- /api/classrooms/:id/grades/import ----------

# One score column = one future Item. Subject is NOT in the file — teacher
# picks it per column in the preview UI (sent back via the `subjects` form
# field on commit).
class GradeImportColumnPreview(BaseModel):
    column_index: int  # 0-based; column B = 1
    category_input: str | None
    category_system_key: str | None
    exam_date: date | None
    exam_name: str  # resolved (auto-generated if blank)
    errors: list[str] = []


class GradeImportStudentRow(BaseModel):
    row_number: int
    seat_number: int | None
    student_id: UUID | None  # null when seat doesn't match any existing student
    # column_index → score; only filled cells appear here.
    scores: dict[int, float] = {}
    errors: list[str] = []


class GradeImportPreviewSummary(BaseModel):
    column_total: int
    row_total: int
    score_total: int
    errors: int


class GradeImportResult(BaseModel):
    dry_run: bool
    summary: GradeImportPreviewSummary
    columns: list[GradeImportColumnPreview]
    students: list[GradeImportStudentRow]


# ---------- /api/semesters ----------

class SemesterOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    academic_year: int
    term: int  # 1 = 上學期, 2 = 下學期
    is_current: bool


class SemesterList(BaseModel):
    data: list[SemesterOut]


# ---------- /api/classrooms/:id/grades (view) ----------

class SubjectCategoryWeightOut(BaseModel):
    """Per-subject category weight; subject identified by id (+ system_key for
    built-ins, display_name for custom)."""
    subject_id: UUID
    subject_system_key: str | None
    subject_display_name: str | None
    category_system_key: str
    weight: int


class StudentBriefOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    seat_number: int
    name: str | None
    email: str | None


class ItemOut(BaseModel):
    id: UUID
    name: str
    subject_id: UUID
    subject_system_key: str | None
    subject_display_name: str | None  # set when subject is a custom one
    category_system_key: str
    exam_date: date | None = None  # placeholder; not yet stored


class ItemDetailOut(BaseModel):
    """Full item details for the /admin/items list."""
    id: UUID
    name: str
    subject_id: UUID
    subject_system_key: str | None
    subject_display_name: str | None
    category_id: UUID
    category_system_key: str
    semester_id: UUID
    # An item is cross-classroom; these counts aggregate across every student
    # who has a grade on it.
    grade_count: int
    point_record_count: int
    created_at: datetime


class ItemDetailList(BaseModel):
    data: list[ItemDetailOut]


class ItemCreate(BaseModel):
    subject_id: UUID
    category_id: UUID
    semester_id: UUID
    name: str = Field(default="", max_length=200)


class ItemUpdate(BaseModel):
    name: str = Field(default="", max_length=200)


# ---------- Grade write endpoints (issue #9) ----------

class GradeCreate(BaseModel):
    item_id: UUID
    student_id: UUID
    score: float = Field(ge=0, le=100)


class GradeUpdate(BaseModel):
    score: float = Field(ge=0, le=100)


class GradeWriteOut(BaseModel):
    id: UUID
    item_id: UUID
    student_id: UUID
    score: float
    awarded_points: int  # points just awarded by this write (0 if no auto-award)


class GradeBulkEntry(BaseModel):
    student_id: UUID
    score: float | None = Field(default=None, ge=0, le=100)


class GradeBulkUpsert(BaseModel):
    item_id: UUID
    entries: list[GradeBulkEntry]


class GradeBulkResult(BaseModel):
    written: int      # POST/PUT count
    deleted: int      # score=null entries that removed an existing grade
    awarded: int      # students who newly received points
    revoked: int      # students whose existing auto-award was revoked


class ItemGradesStudentRow(BaseModel):
    student_id: UUID
    seat_number: int
    name: str | None
    grade_id: UUID | None
    score: float | None


class ItemGradesView(BaseModel):
    item_id: UUID
    item_name: str
    subject_id: UUID
    subject_system_key: str | None
    subject_display_name: str | None
    category_system_key: str
    semester_id: UUID
    classroom_id: UUID
    students: list[ItemGradesStudentRow]


class GradeEntryOut(BaseModel):
    item_id: UUID
    student_id: UUID
    score: float


class ClassroomGradesView(BaseModel):
    semester: SemesterOut
    subject_category_weights: list[SubjectCategoryWeightOut]
    students: list[StudentBriefOut]
    items: list[ItemOut]
    grades: list[GradeEntryOut]
