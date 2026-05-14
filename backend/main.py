"""Grades backend — FastAPI entry point."""
# truststore must be injected BEFORE any module that creates an SSL context
# (httpx, urllib3, etc.). It makes Python's default ssl.SSLContext delegate to
# the OS trust store — required on Windows where AV/VPN software often injects
# a TLS-intercepting CA that certifi doesn't include. No-op on Linux/Mac.
import truststore  # noqa: E402
truststore.inject_into_ssl()  # noqa: E402

from typing import Annotated, Any
from uuid import UUID

from fastapi import Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session

from auth import get_current_user, require_user_id
from config import settings
from database import get_db
from models.classroom import Classroom
from models.curriculum import Semester, Subject
from models.settings import UserSettings
from routers import categories as categories_router
from routers import classroom as classroom_router
from routers import grades as grades_router
from routers import me as me_router
from routers import semester as semester_router
from routers import student as student_router
from routers import subjects as subjects_router

app = FastAPI(
    title="Grades API",
    version="0.1.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_origin_regex=settings.cors_allowed_origin_regex or None,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/api/version")
def version() -> dict[str, str]:
    return {"version": "0.1.0", "env": settings.app_env}


app.include_router(me_router.router, prefix="/api/me", tags=["me"])
app.include_router(
    classroom_router.router, prefix="/api/classrooms", tags=["classrooms"]
)
app.include_router(
    categories_router.router, prefix="/api/categories", tags=["categories"]
)
# Student router uses absolute paths (mixes /api/classrooms/{id}/students/* and
# /api/students/{id}) — mounted with no prefix.
app.include_router(student_router.router, tags=["students"])
app.include_router(grades_router.router, tags=["grades"])
app.include_router(subjects_router.router, tags=["subjects"])
app.include_router(
    semester_router.router, prefix="/api/semesters", tags=["semesters"]
)


@app.get("/api/me")
def me(
    user: Annotated[dict[str, Any], Depends(get_current_user)],
    user_id: Annotated[UUID, Depends(require_user_id)],
    db: Annotated[Session, Depends(get_db)],
) -> dict[str, Any]:
    """Returns the current user's identity, setup status, and preferences."""
    has_classes = (
        db.query(Classroom.id).filter(Classroom.user_id == user_id).first()
        is not None
    )
    has_subjects = (
        db.query(Subject.id).filter(Subject.user_id == user_id).first()
        is not None
    )
    has_current_semester = (
        db.query(Semester.id)
        .filter(Semester.user_id == user_id, Semester.is_current.is_(True))
        .first()
        is not None
    )
    settings_row = db.get(UserSettings, user_id)
    terms_per_year = settings_row.terms_per_year if settings_row else 2
    return {
        "user": {
            "id": user["sub"],
            "email": user.get("email"),
        },
        "setup": {
            "has_classes": has_classes,
            "has_subjects": has_subjects,
            "has_current_semester": has_current_semester,
        },
        "terms_per_year": terms_per_year,
    }
