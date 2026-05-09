"""Grades backend — FastAPI entry point."""
from typing import Annotated, Any

from fastapi import Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware

from auth import get_current_user
from config import settings

app = FastAPI(
    title="Grades API",
    version="0.1.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
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


@app.get("/api/me")
def me(
    user: Annotated[dict[str, Any], Depends(get_current_user)],
) -> dict[str, Any]:
    """Returns the current user's identity (from JWT) and a setup status flag.

    Setup fields are placeholders for now — once classroom/subject/semester
    CRUD exists they'll run real queries to drive frontend onboarding state.
    """
    return {
        "user": {
            "id": user["sub"],
            "email": user.get("email"),
        },
        "setup": {
            "has_classes": False,
            "has_subjects": False,
            "has_current_semester": False,
        },
    }
