"""Who is this signed-in user? Teacher vs student (#261).

There is no users/roles table. Identity is derived on every request:

- **Teacher** = owns at least one classroom (`classroom.user_id == sub`).
  Being a "teacher" is NOT a security boundary — every teacher endpoint
  already filters by `user_id == sub`, so a student calling one simply sees
  nothing of anyone else's. A brand-new account that matches no roster entry
  keeps the existing "new teacher" onboarding.
- **Student** = the JWT email matches one or more `student.email` rows
  (any teacher's roster) AND the email is trustworthy (see
  `trusted_email`). Each match gets an `account_link(link_role='self')`
  row; `sync_self_links` keeps those rows in step with the roster on every
  `GET /api/me`.

Authorisation for student-facing endpoints (小老師, #262) must re-check the
live `lower(student.email) = JWT email` match — an account_link alone is not
enough, because the teacher may have changed / cleared the email since.
"""
from __future__ import annotations

from typing import Any
from uuid import UUID

from sqlalchemy import func
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session

from email_validation import normalize_email
from models.access import AccountLink
from models.classroom import Classroom, Student

# Only identities whose email ownership was proven by the provider count.
# Supabase puts the sign-in provider in `app_metadata` (server-controlled —
# users cannot edit it). `user_metadata.email_verified` is deliberately NOT
# trusted: users can overwrite user_metadata via supabase.auth.updateUser().
TRUSTED_PROVIDERS = frozenset({"google"})


def trusted_email(payload: dict[str, Any]) -> str | None:
    """The JWT email, normalised, if it may be used to match a roster entry.

    Prevents someone from self-registering (e.g. email/password with an
    unconfirmed address) using a student's email and inheriting that
    student's access. Returns None when the email isn't trustworthy.
    """
    app_meta = payload.get("app_metadata") or {}
    if not isinstance(app_meta, dict):
        return None
    provider = app_meta.get("provider")
    providers = app_meta.get("providers") or []
    if not isinstance(providers, list):
        providers = []
    if provider not in TRUSTED_PROVIDERS and not (
        TRUSTED_PROVIDERS & {p for p in providers if isinstance(p, str)}
    ):
        return None
    return normalize_email(payload.get("email"))


def matched_students(db: Session, email: str | None) -> list[Student]:
    """Roster rows (across all teachers) whose email equals `email`."""
    if not email:
        return []
    return (
        db.query(Student)
        .filter(func.lower(Student.email) == email)
        .all()
    )


def sync_self_links(
    db: Session, user_id: UUID, payload: dict[str, Any]
) -> list[Student]:
    """Bring this user's `account_link(self)` rows in line with the roster.

    - creates a link for every roster row whose email matches (a student may
      sit on several teachers' rosters → several links);
    - deletes this user's links whose student no longer matches (email
      changed / cleared, or the email isn't trusted any more);
    - if a matched student is still self-linked to a DIFFERENT account (the
      teacher swapped the email to this user's), that stale link is removed
      first — `ix_account_link_one_self_per_student` allows one per student.

    Commits only when something changed. Returns the matched students.
    """
    students = matched_students(db, trusted_email(payload))
    matched_ids = {s.id for s in students}
    changed = False

    mine = (
        db.query(AccountLink)
        .filter(
            AccountLink.auth_user_id == user_id,
            AccountLink.link_role == "self",
        )
        .all()
    )
    linked_ids: set[UUID] = set()
    for link in mine:
        if link.student_id in matched_ids:
            linked_ids.add(link.student_id)
        else:
            db.delete(link)
            changed = True

    for sid in matched_ids - linked_ids:
        db.query(AccountLink).filter(
            AccountLink.student_id == sid,
            AccountLink.link_role == "self",
            AccountLink.auth_user_id != user_id,
        ).delete(synchronize_session=False)
        # ON CONFLICT DO NOTHING: two concurrent /api/me calls (React
        # StrictMode, AuthCallback + route guard) may race on the insert.
        db.execute(
            pg_insert(AccountLink)
            .values(
                student_id=sid,
                auth_user_id=user_id,
                link_role="self",
                linked_via="email_invite",
            )
            .on_conflict_do_nothing()
        )
        changed = True

    if changed:
        db.commit()
    return students


def owns_any_classroom(db: Session, user_id: UUID) -> bool:
    return (
        db.query(Classroom.id).filter(Classroom.user_id == user_id).first()
        is not None
    )


def build_identity(
    db: Session, user_id: UUID, payload: dict[str, Any]
) -> dict[str, Any]:
    """The `identity` block of `GET /api/me`. Also syncs account links."""
    students = sync_self_links(db, user_id, payload)
    return {
        "is_teacher": owns_any_classroom(db, user_id),
        "is_student": bool(students),
        # Filled in by GET /api/me from routers.assistant (#262).
        "assistant_contexts": [],
    }


def is_student_only(
    db: Session, user_id: UUID, payload: dict[str, Any]
) -> bool:
    """True for an account that matches a roster entry and owns no class —
    such an account must not be onboarded as a new teacher (no seeding)."""
    if owns_any_classroom(db, user_id):
        return False
    return bool(matched_students(db, trusted_email(payload)))
