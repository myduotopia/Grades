"""Who is this signed-in user? Teacher vs student (#261).

There is no users/roles table. Identity is derived on every request:

- **Teacher** = owns at least one classroom (`classroom.user_id == sub`).
  Being a "teacher" is NOT a security boundary — every teacher endpoint
  already filters by `user_id == sub`, so a student calling one simply sees
  nothing of anyone else's. A brand-new account that matches no roster entry
  keeps the existing "new teacher" onboarding.
- **Student** = the account's GOOGLE identity email (read server-side from
  `auth.identities`, see `trusted_email`) matches one or more
  `student.email` rows (any teacher's roster). Each match gets an
  `account_link(link_role='self')` row; `sync_self_links` keeps those rows
  in step with the roster on every `GET /api/me`.

Authorisation for student-facing endpoints (小老師, #262) must re-check the
live `student.email = trusted email` match — an account_link alone is not
enough, because the teacher may have changed / cleared the email since.
"""
from __future__ import annotations

import logging
from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy import text
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session

from email_validation import normalize_email
from models.access import AccountLink
from models.classroom import Classroom, Student

logger = logging.getLogger(__name__)

# The email Google proved this account owns. Read from Supabase's own
# `auth.identities` table instead of the JWT `email` claim: the JWT email is
# the account's *primary* email, which (depending on Supabase settings) can
# be changed by the user or come from another provider; `app_metadata`
# provider lists don't say WHICH identity the email came from. The Google
# identity row's `identity_data.email` is written by Supabase from Google's
# userinfo only. Preconditions on the Supabase project: see
# docs/data-model.md (§ student binding).
_GOOGLE_IDENTITY_EMAIL_SQL = text(
    "SELECT identity_data->>'email' FROM auth.identities "
    "WHERE user_id = :uid AND provider = 'google'"
)


class IdentityUnknown(Exception):
    """The `auth.identities` lookup itself failed, so we CAN'T TELL whether
    this account is a student — which is not the same as "not a student".

    Callers must not act on it as if the answer were "no match":
    - `sync_self_links` neither creates nor deletes links (it raises before
      touching anything);
    - `GET /api/me` answers 503 for an account that owns no class (the
      frontend shows retry); a class owner is still served as a teacher
      (routing doesn't depend on student status), with no 小老師 contexts;
    - `POST /api/me/seed` doesn't seed a non-teacher account (503);
    - 小老師 endpoints (`resolve_actor`) fail closed with the usual 404.
    """


def identity_unavailable() -> HTTPException:
    """The 503 for `IdentityUnknown` on `/api/me` and `/api/me/seed`."""
    return HTTPException(
        status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
        detail={
            "error": {
                "code": "SERVICE_UNAVAILABLE",
                "message_key": "errors.identity.unavailable",
                "message": "Could not determine your identity. Please retry.",
            }
        },
    )


def trusted_email(db: Session, user_id: UUID) -> str | None:
    """The account's Google identity email, normalised, or None.

    None (= "not trustworthy", nothing gets bound) when the account has no
    Google identity or has several Google identities with different emails.
    Raises `IdentityUnknown` when the lookup fails (e.g. missing privilege
    on the auth schema, DB hiccup). The query runs in a savepoint so a
    failure can't poison the request's transaction.
    """
    try:
        with db.begin_nested():
            rows = db.execute(
                _GOOGLE_IDENTITY_EMAIL_SQL, {"uid": user_id}
            ).all()
    except Exception as exc:
        logger.warning("auth.identities lookup failed; identity unknown",
                       exc_info=True)
        raise IdentityUnknown() from exc
    emails = {normalize_email(e) for (e,) in rows} - {None}
    if len(emails) != 1:
        return None
    return emails.pop()


def matched_students(db: Session, email: str | None) -> list[Student]:
    """Roster rows (across all teachers) whose email equals `email`.

    `student.email` is stored normalised (trim + lower, migration
    r1m2n3o4p5q6 + every write path), and `email` comes from
    `trusted_email` (also normalised), so a plain equality is enough and
    can use an index.
    """
    if not email:
        return []
    return db.query(Student).filter(Student.email == email).all()


def sync_self_links(db: Session, user_id: UUID) -> list[Student]:
    """Bring this user's `account_link(self)` rows in line with the roster.

    - creates a link for every roster row whose email matches (a student may
      sit on several teachers' rosters → several links);
    - deletes this user's links whose student no longer matches (email
      changed / cleared, or the email isn't trusted any more);
    - if a matched student is still self-linked to a DIFFERENT account (the
      teacher swapped the email to this user's), that stale link is removed
      first — `ix_account_link_one_self_per_student` allows one per student.

    Commits only when something changed. Returns the matched students.
    Raises `IdentityUnknown` (from `trusted_email`, before any change) when
    the identity lookup fails — existing links are left exactly as they are.
    """
    students = matched_students(db, trusted_email(db, user_id))
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
    db: Session, user_id: UUID, students: list[Student]
) -> dict[str, object]:
    """The `identity` block of `GET /api/me`. `students` is the result of
    `sync_self_links` (the caller syncs once and shares it with
    `build_assistant_contexts`)."""
    return {
        "is_teacher": owns_any_classroom(db, user_id),
        "is_student": bool(students),
        # Filled in by GET /api/me from routers.assistant (#262).
        "assistant_contexts": [],
    }


def is_student_only(db: Session, user_id: UUID) -> bool:
    """True for an account that matches a roster entry and owns no class —
    such an account must not be onboarded as a new teacher (no seeding).
    Raises `IdentityUnknown` for a classless account whose lookup failed."""
    if owns_any_classroom(db, user_id):
        return False
    return bool(matched_students(db, trusted_email(db, user_id)))
