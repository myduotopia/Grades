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

# Excel score columns: only categories that map cleanly to a "one exam = one
# score" model. 出席率 (attendance) and 額外加分 (extra) are excluded — they have
# dedicated UIs because they don't fit the per-item-per-score shape.
CATEGORY_NAME_TO_KEY: dict[str, str] = {
    "段考": "major_exam",
    "小考": "quiz",
    "作業": "homework",
    # English fallbacks for teachers who switch the template to English.
    "Major Exam": "major_exam",
    "Quiz": "quiz",
    "Homework": "homework",
}

# Chinese / English subject display name → built-in subject system_key.
SUBJECT_NAME_TO_KEY: dict[str, str] = {
    "國語": "chinese",
    "數學": "math",
    "英文": "english",
    "英語": "english",
    "自然": "science",
    "社會": "social_studies",
    "音樂": "music",
    "美術": "art",
    "體育": "pe",
    "綜合": "integrated",
    "Chinese": "chinese",
    "Math": "math",
    "English": "english",
    "Science": "science",
    "Social Studies": "social_studies",
    "Music": "music",
    "Art": "art",
    "Physical Education": "pe",
    "PE": "pe",
    "Integrated Activities": "integrated",
}


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


# Excel import preview — describes one score column (one future Item).
class ImportColumnPreview(BaseModel):
    column_index: int  # 0-based; D-column = 3
    subject_input: str | None  # raw cell value
    subject_system_key: str | None
    category_input: str | None
    category_system_key: str | None
    exam_date: date | None
    exam_name: str  # resolved (auto-generated if blank in file)
    existing_item_id: UUID | None = None
    reuses_existing: bool = False
    errors: list[str] = []


# Per-student row (seat / name / email + scores per column).
class ImportStudentRow(BaseModel):
    row_number: int  # 1-based Excel row
    action: Literal["create", "update", "error"]
    seat_number: int | None
    name: str | None
    email: str | None
    # column_index → score; only filled cells appear here.
    scores: dict[int, float] = {}
    existing_id: UUID | None = None
    errors: list[str] = []


class ImportPreviewSummary(BaseModel):
    student_total: int
    student_create: int
    student_update: int
    item_total: int
    item_create: int
    item_reuse: int
    grade_total: int
    grade_create: int
    grade_overwrite: int
    errors: int


class ImportResult(BaseModel):
    dry_run: bool
    summary: ImportPreviewSummary
    columns: list[ImportColumnPreview]
    students: list[ImportStudentRow]
