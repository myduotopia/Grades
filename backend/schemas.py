"""Pydantic schemas for API request/response bodies.

Kept in one file for now; split per-entity once this grows past ~300 lines.
"""
from datetime import datetime
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
