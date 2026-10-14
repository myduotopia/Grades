"""Repeatable verification for student login binding (#261), 小老師
access control (#262) and grade-item edit locks + the live-grade unique
index (#264).

Run from the backend directory (uses backend/.env → the configured DB):

    python scripts/verify_student_access.py

How it stays side-effect free: the whole run happens inside ONE database
transaction that is rolled back at the end. Each API request gets a Session
joined to that transaction via savepoints (`join_transaction_mode=
"create_savepoint"`), so the routers' own `commit()` / `rollback()` calls only
touch savepoints. Nothing is ever committed; the shared test DB is left
exactly as it was, even if a check fails or the script crashes.

Auth is faked by overriding `get_current_user` with a hand-built JWT payload,
so we can impersonate teachers and (Google / non-Google) students. Students
also get a matching Supabase `auth.users` + `auth.identities` row (inside the
same rolled-back transaction), because the trusted email is read from
`auth.identities`, not from the JWT.

Exit code 0 = every check passed; 1 = at least one failed.
"""
from __future__ import annotations

import os
import sys
import traceback
import json
import uuid
from collections.abc import Callable, Iterator
from contextlib import contextmanager
from io import BytesIO
from typing import Any

BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, BACKEND_DIR)
os.chdir(BACKEND_DIR)  # pydantic-settings reads .env from the CWD

from fastapi.testclient import TestClient  # noqa: E402
from openpyxl import Workbook  # noqa: E402
from sqlalchemy import text  # noqa: E402
from sqlalchemy.orm import Session  # noqa: E402

import identity  # noqa: E402
import main  # noqa: E402
from auth import get_current_user  # noqa: E402
from database import engine, get_db  # noqa: E402
from email_validation import InvalidEmail, clean_email  # noqa: E402
from models.access import AccountLink  # noqa: E402
from models.curriculum import Category  # noqa: E402

TAG = f"zz-verify-{uuid.uuid4().hex[:8]}"
RESULTS: list[tuple[bool, str]] = []


def check(cond: bool, label: str, detail: Any = None) -> None:
    RESULTS.append((bool(cond), label))
    mark = "PASS" if cond else "FAIL"
    extra = "" if cond or detail is None else f"  -> {detail}"
    print(f"[{mark}] {label}{extra}")


def section(title: str) -> None:
    print(f"\n=== {title} ===")


class Harness:
    """TestClient whose requests run inside one rolled-back transaction."""

    def __init__(self) -> None:
        self.conn = engine.connect()
        self.trans = self.conn.begin()
        self.payload: dict[str, Any] | None = None
        main.app.dependency_overrides[get_db] = self._db
        main.app.dependency_overrides[get_current_user] = lambda: self.payload
        self.client = TestClient(main.app, raise_server_exceptions=False)

    def _db(self) -> Iterator[Session]:
        # autoflush=False mirrors database.SessionLocal.
        s = Session(bind=self.conn, join_transaction_mode="create_savepoint",
                    autoflush=False)
        try:
            yield s
        finally:
            s.close()

    def session(self) -> Session:
        return Session(bind=self.conn, join_transaction_mode="create_savepoint")

    def as_user(self, payload: dict[str, Any]) -> "Harness":
        ident = payload.pop("_identity", None)
        if ident is not None:
            self.set_identity(uuid.UUID(payload["sub"]), *ident)
        self.payload = payload
        return self

    def set_identity(self, uid: uuid.UUID, provider: str, email: str) -> None:
        """Make `uid` a Supabase user whose ONLY identity is (provider, email)."""
        self.conn.execute(
            # auth.users.email is unique; leave it NULL — only the identity
            # row's email matters to the backend.
            text("INSERT INTO auth.users (id) VALUES (:id) "
                 "ON CONFLICT (id) DO NOTHING"), {"id": uid})
        self.conn.execute(text("DELETE FROM auth.identities WHERE user_id = :id"),
                          {"id": uid})
        self.conn.execute(
            text("INSERT INTO auth.identities (provider_id, user_id, identity_data, provider) "
                 "VALUES (:pid, :uid, CAST(:d AS jsonb), :p)"),
            {"pid": f"{uid.hex}-{provider}", "uid": uid, "p": provider,
             "d": json.dumps({"email": email, "sub": uid.hex})})

    def add_identity(self, uid: uuid.UUID, provider: str, email: str, suffix: str) -> None:
        """Attach ANOTHER identity row to `uid` (keeps the existing ones)."""
        self.conn.execute(
            text("INSERT INTO auth.identities (provider_id, user_id, identity_data, provider) "
                 "VALUES (:pid, :uid, CAST(:d AS jsonb), :p)"),
            {"pid": f"{uid.hex}-{provider}-{suffix}", "uid": uid, "p": provider,
             "d": json.dumps({"email": email, "sub": f"{uid.hex}-{suffix}"})})

    def req(self, method: str, url: str, **kw: Any) -> Any:
        return self.client.request(method, url, **kw)

    def close(self) -> None:
        main.app.dependency_overrides.clear()
        self.trans.rollback()
        self.conn.close()


def teacher(uid: uuid.UUID) -> dict[str, Any]:
    return {
        "sub": str(uid),
        "email": f"{TAG}-teacher-{uid.hex[:6]}@example.com",
        "app_metadata": {"provider": "google", "providers": ["google"]},
    }


def student_payload(
    uid: uuid.UUID,
    email: str,
    provider: str = "google",
    identity_email: str | None = None,
) -> dict[str, Any]:
    """JWT payload + (via Harness.as_user) the account's auth.identities row.
    `identity_email` defaults to the JWT email; pass a different one to
    prove the backend reads the identity, not the JWT claim."""
    return {
        "sub": str(uid),
        "email": email,
        "app_metadata": {"provider": provider, "providers": [provider]},
        # Must be ignored — users can write user_metadata themselves.
        "user_metadata": {"email_verified": True},
        "_identity": (provider, identity_email if identity_email is not None else email),
    }


@contextmanager
def identity_lookup_broken() -> Iterator[None]:
    """Make the auth.identities lookup fail (like a missing privilege)."""
    orig_sql = identity._GOOGLE_IDENTITY_EMAIL_SQL
    identity._GOOGLE_IDENTITY_EMAIL_SQL = text("SELECT email FROM auth.no_such_table")
    try:
        yield
    finally:
        identity._GOOGLE_IDENTITY_EMAIL_SQL = orig_sql


def _code(r: Any) -> str | None:
    try:
        return r.json()["detail"]["error"]["message_key"]
    except Exception:
        return None


def xlsx(rows: list[list[Any]]) -> bytes:
    wb = Workbook()
    ws = wb.active
    ws.append(["座號", "姓名（選填）", "email（選填）"])
    for r in rows:
        ws.append(r)
    buf = BytesIO()
    wb.save(buf)
    return buf.getvalue()


# ---------------------------------------------------------------------------
# #261 — email validation + login binding
# ---------------------------------------------------------------------------

def verify_261(h: Harness) -> None:
    section("#261 email helper")
    check(clean_email("  Foo.Bar@Example.COM ") == "foo.bar@example.com",
          "clean_email trims + lowercases")
    check(clean_email("   ") is None, "clean_email blank -> None")
    for bad in ("no-at-sign", "a@b", "a b@c.com", "a@@b.com", "@b.com"):
        try:
            clean_email(bad)
            check(False, f"clean_email rejects {bad!r}")
        except InvalidEmail:
            check(True, f"clean_email rejects {bad!r}")

    t1 = uuid.uuid4()
    h.as_user(teacher(t1))
    r = h.req("POST", "/api/classrooms", json={"grade": 7, "name": f"{TAG}-A"})
    check(r.status_code == 201, "teacher creates classroom", r.text)
    cid = r.json()["id"]

    section("#261 single create/update")
    r = h.req("POST", f"/api/classrooms/{cid}/students",
              json={"seat_number": 1, "name": "甲", "email": "not-an-email"})
    check(r.status_code == 400
          and r.json()["detail"]["error"]["message_key"] == "errors.student.invalid_email",
          "invalid email on create -> 400 errors.student.invalid_email", r.text)
    s_email = f"{TAG}-stu@example.com"
    r = h.req("POST", f"/api/classrooms/{cid}/students",
              json={"seat_number": 1, "name": "甲", "email": f"  {s_email.upper()} "})
    check(r.status_code == 201 and r.json()["email"] == s_email,
          "create normalises email (trim + lower)", r.text)
    sid = r.json()["id"]
    r = h.req("PUT", f"/api/students/{sid}",
              json={"seat_number": 1, "name": "甲", "email": "bad@"})
    check(r.status_code == 400, "invalid email on update -> 400", r.text)

    section("#261 login binding")
    stu_uid = uuid.uuid4()
    h.as_user(student_payload(stu_uid, s_email.upper()))
    me = h.req("GET", "/api/me").json()
    check(me["identity"]["is_student"] is True and me["identity"]["is_teacher"] is False,
          "google student: identity is_student, not teacher", me.get("identity"))
    with h.session() as s:
        links = s.query(AccountLink).filter(AccountLink.auth_user_id == stu_uid).all()
        check(len(links) == 1 and str(links[0].student_id) == sid
              and links[0].link_role == "self" and links[0].linked_via == "email_invite",
              "account_link(self, email_invite) created on /api/me")
    h.req("GET", "/api/me")
    with h.session() as s:
        n = s.query(AccountLink).filter(AccountLink.auth_user_id == stu_uid).count()
        check(n == 1, "repeat /api/me is idempotent (still one link)")

    r = h.req("POST", "/api/me/seed")
    with h.session() as s:
        cats = s.query(Category).filter(Category.user_id == stu_uid).count()
    check(r.status_code == 200 and r.json() == {"categories_created": 0, "semesters_created": 0}
          and cats == 0, "seed is a no-op for a roster student", r.text)

    # Student cannot see teacher data through teacher endpoints.
    r = h.req("GET", f"/api/classrooms/{cid}/students")
    check(r.status_code == 404, "student GET teacher's class roster -> 404", r.status_code)
    r = h.req("GET", "/api/classrooms")
    check(r.status_code == 200 and all(c["id"] != cid for c in r.json()["data"]),
          "student's classroom list doesn't include teacher's class")

    # Non-Google provider with the same email must NOT bind.
    impostor = uuid.uuid4()
    h.as_user(student_payload(impostor, s_email, provider="email"))
    me = h.req("GET", "/api/me").json()
    check(me["identity"]["is_student"] is False,
          "non-google (email/password) account with student's email is NOT a student")
    with h.session() as s:
        n = s.query(AccountLink).filter(AccountLink.auth_user_id == impostor).count()
    check(n == 0, "no account_link for the impostor")

    section("#261 trusted email comes from auth.identities, not the JWT")
    # JWT claims google + the student's email, but the account's google
    # identity is a different address (e.g. primary email changed / another
    # provider's email in the JWT) → not trusted.
    spoof = uuid.uuid4()
    h.as_user(student_payload(spoof, s_email, identity_email=f"{TAG}-other@example.com"))
    me = h.req("GET", "/api/me").json()
    check(me["identity"]["is_student"] is False,
          "JWT email = student's, google identity email differs -> NOT a student")
    # JWT app_metadata lists google among providers, but the only identity
    # with the student's email is an email/password one → not trusted
    # (the old `providers` fallback is gone).
    mixed = uuid.uuid4()
    p = student_payload(mixed, s_email, provider="email")
    p["app_metadata"] = {"provider": "email", "providers": ["email", "google"]}
    h.as_user(p)
    me = h.req("GET", "/api/me").json()
    check(me["identity"]["is_student"] is False,
          "app_metadata.providers contains google but no google identity -> NOT a student")
    # Google identity email matches even though the JWT email doesn't
    # (and differs in case) → bound: the identity is the source of truth.
    via_ident = uuid.uuid4()
    h.as_user(student_payload(via_ident, f"{TAG}-jwt-only@example.com",
                              identity_email=s_email.upper()))
    me = h.req("GET", "/api/me").json()
    check(me["identity"]["is_student"] is True,
          "google identity email (any case) = student's, JWT email differs -> student")
    with h.session() as s:
        n = s.query(AccountLink).filter(AccountLink.auth_user_id == via_ident).count()
    check(n == 1, "identity-matched account gets the self link")
    # Lookup failure (e.g. no privilege on auth schema) = identity UNKNOWN,
    # which is not "not a student": nothing is unbound, /api/me -> 503,
    # seed refuses for a classless account.
    with identity_lookup_broken():
        r = h.req("GET", "/api/me")
        check(r.status_code == 503 and _code(r) == "errors.identity.unavailable",
              "auth.identities lookup failure -> /api/me 503", r.text[:200])
        with h.session() as s:
            n = s.query(AccountLink).filter(AccountLink.auth_user_id == via_ident).count()
        check(n == 1, "lookup failure: existing self link NOT deleted")
        r = h.req("POST", "/api/me/seed")
        with h.session() as s:
            cats = s.query(Category).filter(Category.user_id == via_ident).count()
        check(r.status_code == 503 and cats == 0,
              "lookup failure: seed refuses (503) and creates nothing", r.text[:200])
        # A teacher's routing doesn't depend on student status: still served.
        h.as_user(teacher(t1))
        r = h.req("GET", "/api/me")
        check(r.status_code == 200 and r.json()["identity"]["is_teacher"] is True,
              "lookup failure: class owner still gets /api/me 200 (is_teacher)", r.text[:200])
        r = h.req("POST", "/api/me/seed")
        check(r.status_code == 200,
              "lookup failure: class owner's seed still runs (transaction not poisoned)",
              r.text[:200])
    # Several Google identities with DIFFERENT emails -> ambiguous -> untrusted.
    multi = uuid.uuid4()
    h.as_user(student_payload(multi, s_email))
    h.add_identity(multi, "google", f"{TAG}-second@example.com", suffix="2")
    me = h.req("GET", "/api/me").json()
    check(me["identity"]["is_student"] is False,
          "two google identities with different emails -> NOT a student", me.get("identity"))
    with h.session() as s:
        n = s.query(AccountLink).filter(AccountLink.auth_user_id == multi).count()
    check(n == 0, "no account_link for the ambiguous account")
    # Several Google identities, same email (case differs) -> still trusted.
    same = uuid.uuid4()
    h.as_user(student_payload(same, s_email))
    h.add_identity(same, "google", s_email.upper(), suffix="2")
    me = h.req("GET", "/api/me").json()
    check(me["identity"]["is_student"] is True,
          "two google identities with the same email -> student", me.get("identity"))
    # Restore stu_uid as the bound account for the following checks.
    h.as_user(student_payload(stu_uid, s_email))
    h.req("GET", "/api/me")

    # Unknown google account → new teacher (unchanged onboarding).
    stranger = uuid.uuid4()
    h.as_user(student_payload(stranger, f"{TAG}-nobody@example.com"))
    me = h.req("GET", "/api/me").json()
    check(me["identity"] == {"is_teacher": False, "is_student": False, "assistant_contexts": []},
          "account on no roster -> neither (frontend treats as new teacher)", me.get("identity"))

    h.as_user(teacher(t1))
    me = h.req("GET", "/api/me").json()
    check(me["identity"]["is_teacher"] is True, "teacher identity is_teacher")

    section("#261 email change unbinds")
    new_email = f"{TAG}-stu-new@example.com"
    r = h.req("PUT", f"/api/students/{sid}",
              json={"seat_number": 1, "name": "甲", "email": new_email})
    check(r.status_code == 200, "teacher changes student email", r.text)
    with h.session() as s:
        n = s.query(AccountLink).filter(AccountLink.student_id == uuid.UUID(sid)).count()
    check(n == 0, "old self link deleted on email change")
    h.as_user(student_payload(stu_uid, s_email))
    me = h.req("GET", "/api/me").json()
    check(me["identity"]["is_student"] is False, "old account is no longer a student")
    new_uid = uuid.uuid4()
    h.as_user(student_payload(new_uid, new_email))
    me = h.req("GET", "/api/me").json()
    check(me["identity"]["is_student"] is True, "new email's account binds")

    section("#261 Excel import email rules")
    h.as_user(teacher(t1))
    h.req("POST", f"/api/classrooms/{cid}/students",
          json={"seat_number": 2, "name": "乙", "email": f"{TAG}-two@example.com"})
    data = xlsx([
        [1, "甲改", None],                         # update, blank email -> keep
        [2, "乙", f"{TAG}-dup@example.com"],      # update, new email
        [3, "丙", f"  {TAG}-DUP@example.com"],    # create, duplicate of row 2
        [4, "丁", "broken-email"],                # error
    ])
    files = {"file": ("s.xlsx", data,
                      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")}
    r = h.req("POST", f"/api/classrooms/{cid}/students/import?dry_run=true", files=files)
    body = r.json()
    rows = {row["seat_number"]: row for row in body.get("rows", [])}
    check(r.status_code == 200, "import preview 200", r.text)
    check(rows[1]["email"] == new_email and "email_unchanged" in rows[1]["warnings"],
          "blank email on update row keeps stored email (+ email_unchanged warning)", rows.get(1))
    check("duplicate_email" in rows[2]["warnings"] and "duplicate_email" in rows[3]["warnings"],
          "duplicate email within class flagged as warning on both rows")
    check(rows[3]["email"] == f"{TAG}-dup@example.com", "import normalises email")
    check(rows[4]["action"] == "error" and "email is invalid" in rows[4]["errors"],
          "invalid email in import -> row error")
    data = xlsx([[1, "甲改", None], [2, "乙", f"{TAG}-dup@example.com"]])
    files = {"file": ("s.xlsx", data,
                      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")}
    r = h.req("POST", f"/api/classrooms/{cid}/students/import?dry_run=false", files=files)
    check(r.status_code == 200, "import commit 200", r.text)
    roster = {s["seat_number"]: s for s in
              h.req("GET", f"/api/classrooms/{cid}/students").json()["data"]}
    check(roster[1]["email"] == new_email and roster[1]["name"] == "甲改",
          "after commit: blank email cell did not clear email, name updated")
    check(roster[2]["email"] == f"{TAG}-dup@example.com", "after commit: filled email updated")


# ---------------------------------------------------------------------------
# #262 — 小老師 roles + access control
# ---------------------------------------------------------------------------

def verify_262(h: Harness) -> None:
    from models.access import ClassAssistant, ItemAssistant
    from models.curriculum import Semester
    from models.grading import Grade

    section("#262 setup (teacher T1: classes A, B; teacher T2: class C)")
    t1, t2 = uuid.uuid4(), uuid.uuid4()
    h.as_user(teacher(t1))
    h.req("POST", "/api/me/seed")
    cls_a = h.req("POST", "/api/classrooms", json={"grade": 8, "name": f"{TAG}-A"}).json()["id"]
    cls_b = h.req("POST", "/api/classrooms", json={"grade": 8, "name": f"{TAG}-B"}).json()["id"]
    subject_id = h.req("GET", "/api/subjects").json()["data"][0]["id"]
    quiz_id = next(c["id"] for c in h.req("GET", "/api/categories").json()["data"]
                   if c["system_key"] == "quiz")
    sem_id = next(x["id"] for x in h.req("GET", "/api/semesters").json()["data"]
                  if x["is_current"])

    def mk_item(name: str) -> str:
        r = h.req("POST", "/api/items", json={
            "subject_id": subject_id, "category_id": quiz_id,
            "semester_id": sem_id, "name": f"{TAG}-{name}"})
        assert r.status_code == 201, r.text
        return r.json()["id"]

    def mk_student(cid: str, seat: int, name: str, email: str | None) -> str:
        r = h.req("POST", f"/api/classrooms/{cid}/students",
                  json={"seat_number": seat, "name": name, "email": email})
        assert r.status_code == 201, r.text
        return r.json()["id"]

    item_x, item_y, item_w = mk_item("X"), mk_item("Y"), mk_item("W")
    e1, e4 = f"{TAG}-a1@example.com", f"{TAG}-a4@example.com"
    a1 = mk_student(cls_a, 1, "小明", e1)
    a2 = mk_student(cls_a, 2, "小華", None)
    a4 = mk_student(cls_a, 4, "小美", e4)
    b1 = mk_student(cls_b, 1, "乙班", f"{TAG}-b1@example.com")
    # Activate X and Y in class A, X in class B (teacher bulk save).
    for it, cid in ((item_x, cls_a), (item_y, cls_a), (item_x, cls_b)):
        r = h.req("POST", "/api/grades/bulk",
                  json={"item_id": it, "classroom_id": cid, "entries": []})
        assert r.status_code == 200, r.text

    h.as_user(teacher(t2))
    h.req("POST", "/api/me/seed")
    cls_c = h.req("POST", "/api/classrooms", json={"grade": 8, "name": f"{TAG}-C"}).json()["id"]
    sem2 = next(x["id"] for x in h.req("GET", "/api/semesters").json()["data"] if x["is_current"])
    quiz2 = next(c["id"] for c in h.req("GET", "/api/categories").json()["data"]
                 if c["system_key"] == "quiz")
    item_z = h.req("POST", "/api/items", json={
        "subject_id": subject_id, "category_id": quiz2,
        "semester_id": sem2, "name": f"{TAG}-Z"}).json()["id"]
    h.req("POST", "/api/grades/bulk", json={"item_id": item_z, "classroom_id": cls_c, "entries": []})
    r = h.req("GET", f"/api/items/{item_x}/assistants")
    check(r.status_code == 404, "T2 cannot read T1's item assistants -> 404", r.status_code)
    r = h.req("PUT", f"/api/students/{a1}/assistant", json={"is_assistant": True})
    check(r.status_code == 404, "T2 cannot make T1's student an assistant -> 404", r.status_code)

    section("#262 teacher: set assistant")
    h.as_user(teacher(t1))
    r = h.req("PUT", f"/api/students/{a2}/assistant", json={"is_assistant": True})
    check(r.status_code == 400 and _code(r) == "errors.assistant.email_required",
          "no-email student cannot become assistant -> 400", r.text)
    r = h.req("PUT", f"/api/students/{a1}/assistant", json={"is_assistant": True})
    check(r.status_code == 200 and r.json()["is_assistant"] is True, "set A1 as assistant", r.text)
    # Email edits that would make an assistant share an email -> 409.
    r = h.req("POST", f"/api/classrooms/{cls_a}/students",
              json={"seat_number": 9, "name": "同信箱", "email": e1})
    check(r.status_code == 409 and _code(r) == "errors.assistant.email_clash",
          "create a student with an assistant classmate's email -> 409", r.text)
    dup = mk_student(cls_a, 9, "同信箱", f"{TAG}-dup9@example.com")
    r = h.req("PUT", f"/api/students/{dup}",
              json={"seat_number": 9, "name": "同信箱", "email": e1})
    check(r.status_code == 409 and _code(r) == "errors.assistant.email_clash",
          "change a student's email to an assistant classmate's -> 409", r.text)
    for label, extra in (("", {}), (" (is_assistant sent)", {"is_assistant": True})):
        r = h.req("PUT", f"/api/students/{a1}",
                  json={"seat_number": 1, "name": "小明", "email": e4, **extra})
        check(r.status_code == 409 and _code(r) == "errors.assistant.email_clash",
              f"change an assistant's email to a classmate's{label} -> 409", r.text)
    with h.session() as s:
        from models.classroom import Student as _Student
        st = s.get(_Student, uuid.UUID(a1))
        check(st.email == e1, "rejected email change saved nothing")
    check(next(x for x in h.req("GET", f"/api/classrooms/{cls_a}/students").json()["data"]
               if x["id"] == a1)["is_assistant"] is True,
          "rejected email change kept the assistant role")
    r = h.req("PUT", f"/api/students/{a1}",
              json={"seat_number": 1, "name": "小明", "email": f"{TAG}-a1-tmp@example.com",
                    "is_assistant": True})
    check(r.status_code == 200 and r.json()["is_assistant"] is True,
          "assistant's email changed to a unique one (is_assistant sent) -> 200, role kept",
          r.text)
    h.req("PUT", f"/api/students/{a1}", json={"seat_number": 1, "name": "小明", "email": e1})
    # Legacy duplicate (data written before the 小老師 email checks existed).
    with h.session() as s:
        s.get(_Student, uuid.UUID(dup)).email = e1
        s.commit()
    r = h.req("PUT", f"/api/students/{dup}/assistant", json={"is_assistant": True})
    check(r.status_code == 409 and _code(r) == "errors.assistant.duplicate_email",
          "duplicate email in class -> 409", r.text)
    # #262-2: an EXISTING assistant whose email didn't change is never 409'd
    # by a classmate's email.
    r = h.req("PUT", f"/api/students/{a1}",
              json={"seat_number": 1, "name": "小明改", "email": e1, "is_assistant": True})
    check(r.status_code == 200 and r.json()["is_assistant"] is True
          and r.json()["name"] == "小明改",
          "existing assistant renamed via StudentModal (is_assistant sent) despite dup email -> 200",
          r.text)
    r = h.req("PUT", f"/api/students/{a1}/assistant", json={"is_assistant": True})
    check(r.status_code == 200, "re-setting an existing assistant despite dup email -> 200", r.text)
    h.req("PUT", f"/api/students/{a1}", json={"seat_number": 1, "name": "小明", "email": e1})
    h.req("DELETE", f"/api/students/{dup}")
    r = h.req("PUT", f"/api/students/{a4}",
              json={"seat_number": 4, "name": "小美", "email": e4, "is_assistant": True})
    check(r.status_code == 200 and r.json()["is_assistant"] is True,
          "StudentModal path (PUT student with is_assistant) sets A4", r.text)
    roster = h.req("GET", f"/api/classrooms/{cls_a}/students").json()["data"]
    check({s["id"] for s in roster if s["is_assistant"]} == {a1, a4},
          "student list reports is_assistant for A1, A4")

    section("#262 teacher: item assignment")
    view = h.req("GET", f"/api/items/{item_x}/assistants").json()
    check({c["student_id"] for c in view["candidates"]} == {a1, a4} and view["writable"],
          "item editor lists the class's assistants", view)
    r = h.req("PUT", f"/api/items/{item_w}/assistants", json={"student_ids": [a1]})
    check(r.status_code == 400 and _code(r) == "errors.assistant.invalid_assignment",
          "assign item not active in class -> 400", r.text)
    r = h.req("PUT", f"/api/items/{item_x}/assistants", json={"student_ids": [a1, a2]})
    check(r.status_code == 400, "assign a non-assistant -> 400", r.text)
    r = h.req("PUT", f"/api/items/{item_x}/assistants", json={"student_ids": [a1, a4]})
    check(r.status_code == 200 and set(r.json()["assigned_student_ids"]) == {a1, a4},
          "assign X to A1 + A4", r.text)

    # Teacher-entered grades: A2 on X; A1 on Y; B1 on X.
    g_a2 = h.req("POST", "/api/grades", json={"item_id": item_x, "student_id": a2, "score": 70}).json()["id"]
    g_a1y = h.req("POST", "/api/grades", json={"item_id": item_y, "student_id": a1, "score": 60}).json()["id"]
    g_b1 = h.req("POST", "/api/grades", json={"item_id": item_x, "student_id": b1, "score": 50}).json()["id"]

    section("#262 assistant: visibility")
    u1, u4 = uuid.uuid4(), uuid.uuid4()
    h.as_user(student_payload(u1, e1))
    me = h.req("GET", "/api/me").json()["identity"]
    ctx = me["assistant_contexts"]
    check(len(ctx) == 1 and ctx[0]["classroom_id"] == cls_a
          and [i["item_id"] for i in ctx[0]["items"]] == [item_x]
          and ctx[0]["student_name"] == "小明",
          "/api/me assistant_contexts = class A with only item X", ctx)
    r = h.req("GET", f"/api/assistant/items/{item_x}/grades", params={"classroom_id": cls_a})
    rows = r.json().get("students", []) if r.status_code == 200 else []
    check(r.status_code == 200 and len(rows) == 3 and all("email" not in x for x in rows),
          "GET assigned item X: whole class, no email field", r.text[:200])
    check(r.status_code == 200 and "semester_id" not in r.json()
          and all(x.get("entered_by_user_id") is None for x in rows),
          "GET assistant view: no semester_id, entered_by_user_id null on every row",
          r.text[:300])
    for label, it, cid in (
        ("unassigned item Y (same teacher)", item_y, cls_a),
        ("other teacher's item Z", item_z, cls_c),
        ("assigned item X but other class B", item_x, cls_b),
        ("non-existent item", str(uuid.uuid4()), cls_a),
    ):
        r = h.req("GET", f"/api/assistant/items/{it}/grades", params={"classroom_id": cid})
        check(r.status_code == 404 and _code(r) == "errors.item.not_found",
              f"GET {label} -> uniform 404", r.status_code)

    section("#262 assistant: writes")
    # #264: every assistant write needs the item's edit lock (the pencil).
    r = h.req("POST", f"/api/assistant/items/{item_x}/lock", params={"classroom_id": cls_a})
    check(r.status_code == 200 and r.json()["mine"] is True,
          "A1 takes the edit lock on X (pencil)", r.text)
    r = h.req("POST", "/api/assistant/grades",
              json={"item_id": item_x, "classroom_id": cls_a, "student_id": a1, "score": 88})
    check(r.status_code == 201 and r.json()["entered_by_role"] == "assistant",
          "POST own score on X -> 201, stamped assistant", r.text)
    check(r.status_code == 201 and r.json().get("entered_by_user_id") is None,
          "POST response: entered_by_user_id is null (not the auth id)", r.text)
    g_a1 = r.json().get("id")
    with h.session() as s:
        g = s.get(Grade, uuid.UUID(g_a1))
        check(g is not None and g.user_id == t1 and g.entered_by_user_id == u1
              and g.entered_at is not None,
              "grade.user_id = TEACHER, entered_by_user_id = assistant sub, entered_at set")
    r = h.req("POST", "/api/assistant/grades",
              json={"item_id": item_x, "classroom_id": cls_a, "student_id": b1, "score": 90})
    check(r.status_code == 404, "POST for a student of another class -> 404", r.status_code)
    r = h.req("POST", "/api/assistant/grades",
              json={"item_id": item_x, "classroom_id": cls_a, "student_id": a2, "score": 99})
    check(r.status_code == 403 and _code(r) == "errors.assistant.teacher_grade_locked",
          "POST upsert over teacher-entered score -> 403", r.text)
    r = h.req("POST", "/api/assistant/grades",
              json={"item_id": item_y, "classroom_id": cls_a, "student_id": a1, "score": 99})
    check(r.status_code == 404, "POST on unassigned item -> 404", r.status_code)
    r = h.req("POST", "/api/assistant/grades",
              json={"item_id": item_x, "classroom_id": cls_a, "student_id": a1, "score": None})
    check(r.status_code == 422, "POST null score -> 422", r.status_code)

    r = h.req("PUT", f"/api/assistant/grades/{g_a2}", json={"score": 99})
    check(r.status_code == 403, "PUT teacher-entered grade -> 403", r.status_code)
    r = h.req("PUT", f"/api/assistant/grades/{g_a1y}", json={"score": 99})
    check(r.status_code == 404, "PUT grade of another item -> 404", r.status_code)
    r = h.req("PUT", f"/api/assistant/grades/{g_b1}", json={"score": 99})
    check(r.status_code == 404, "PUT grade of another class -> 404", r.status_code)
    r = h.req("PUT", f"/api/assistant/grades/{g_a1}", json={"score": 89})
    check(r.status_code == 200 and r.json()["score"] == 89, "PUT own assistant-entered grade -> 200")
    check(r.status_code == 200 and r.json().get("entered_by_user_id") is None,
          "PUT response: entered_by_user_id is null", r.text)
    with identity_lookup_broken():
        r = h.req("PUT", f"/api/assistant/grades/{g_a1}", json={"score": 10})
        check(r.status_code == 404, "identity lookup failure -> assistant PUT 404 (fail closed)",
              r.status_code)
        r = h.req("GET", f"/api/assistant/items/{item_x}/grades",
                  params={"classroom_id": cls_a})
        check(r.status_code == 404, "identity lookup failure -> assistant GET 404", r.status_code)
    with h.session() as s:
        n = s.query(AccountLink).filter(AccountLink.auth_user_id == u1).count()
        score = float(s.get(Grade, uuid.UUID(g_a1)).score)
    check(n == 1 and score == 89, "after lookup failure: link kept, score untouched")

    section("#262 POST create races a concurrent insert (unique conflict)")
    # The live unique index (uq_grade_live_item_student, #264) makes the
    # race observable; make the router's first read miss the existing row.
    import routers.assistant as assistant_mod
    real_live = assistant_mod._live_grade

    def miss_first() -> Callable[..., Any]:
        """First read returns None (the racing insert isn't visible yet),
        later reads see the real row."""
        calls: list[int] = []

        def live(db: Any, actor: Any, sid: Any) -> Any:
            calls.append(1)
            return None if len(calls) == 1 else real_live(db, actor, sid)
        return live

    def always_miss(db: Any, actor: Any, sid: Any) -> Any:
        return None

    try:
        assistant_mod._live_grade = miss_first()
        r = h.req("POST", "/api/assistant/grades",
                  json={"item_id": item_x, "classroom_id": cls_a, "student_id": a1, "score": 89})
        check(r.status_code == 201 and r.json().get("id") == g_a1,
              "conflict on assistant-entered cell -> re-read, overwrite the existing row", r.text)
        assistant_mod._live_grade = miss_first()
        r = h.req("POST", "/api/assistant/grades",
                  json={"item_id": item_x, "classroom_id": cls_a, "student_id": a2, "score": 99})
        check(r.status_code == 403 and _code(r) == "errors.assistant.teacher_grade_locked",
              "conflict on teacher-entered cell -> re-read -> 403 (not overwritten)", r.text)
        assistant_mod._live_grade = always_miss
        r = h.req("POST", "/api/assistant/grades",
                  json={"item_id": item_x, "classroom_id": cls_a, "student_id": a1, "score": 89})
        check(r.status_code == 409 and _code(r) == "errors.assistant.write_conflict",
              "conflict and re-read still finds nothing -> 409", r.text)
    finally:
        assistant_mod._live_grade = real_live
    with h.session() as s:
        t_score = float(s.get(Grade, uuid.UUID(g_a2)).score)
        n_live = s.query(Grade).filter(Grade.item_id == uuid.UUID(item_x),
                                       Grade.student_id == uuid.UUID(a1),
                                       Grade.snapshot_id.is_(None)).count()
    check(t_score == 70 and n_live == 1,
          "after conflicts: teacher score intact, still one live row for A1")

    r = h.req("DELETE", f"/api/assistant/grades/{g_a1}")
    check(r.status_code == 405, "DELETE /api/assistant/grades/{id} -> 405 (no route)", r.status_code)
    r = h.req("DELETE", f"/api/grades/{g_a1}")
    check(r.status_code == 404, "DELETE /api/grades/{id} (teacher route) as assistant -> 404", r.status_code)
    r = h.req("POST", "/api/grades", json={"item_id": item_x, "student_id": a1, "score": 1})
    check(r.status_code == 404, "teacher POST /api/grades as assistant -> 404", r.status_code)
    r = h.req("POST", "/api/grades/bulk", json={"item_id": item_x, "classroom_id": cls_a,
                                                "entries": [{"student_id": a1, "score": None}]})
    check(r.status_code == 404, "teacher bulk (could clear) as assistant -> 404", r.status_code)

    section("#262 assistant: bulk")
    base = {"item_id": item_x, "classroom_id": cls_a}
    r = h.req("POST", "/api/assistant/grades/bulk",
              json={**base, "entries": [{"student_id": a1, "score": 77},
                                        {"student_id": b1, "score": 77}]})
    viol = (r.json().get("detail", {}).get("error", {}).get("details", {}) or {}).get("violations", [])
    check(r.status_code == 403 and viol == [{"student_id": b1, "reason": "not_in_class"}],
          "bulk with another class's student -> 403 listing it", r.text)
    with h.session() as s:
        check(float(s.get(Grade, uuid.UUID(g_a1)).score) == 89,
              "rejected bulk saved nothing (all-or-nothing)")
    r = h.req("POST", "/api/assistant/grades/bulk",
              json={**base, "snapshot_id": str(uuid.uuid4()), "entries": []})
    check(r.status_code == 422, "bulk with snapshot_id -> 422", r.status_code)
    r = h.req("POST", "/api/assistant/grades/bulk",
              json={**base, "entries": [{"student_id": a1, "score": None}]})
    check(r.status_code == 422, "bulk with null score -> 422", r.status_code)
    r = h.req("POST", "/api/assistant/grades/bulk",
              json={**base, "entries": [{"student_id": a2, "score": 71}]})
    check(r.status_code == 403 and "teacher_entered" in r.text, "bulk changing teacher score -> 403")
    r = h.req("POST", "/api/assistant/grades/bulk",
              json={**base, "entries": [{"student_id": a2, "score": 70},
                                        {"student_id": a4, "score": 66}]})
    check(r.status_code == 200 and r.json()["written"] == 1,
          "bulk re-sending teacher's unchanged score is a no-op; other row written", r.text)
    r = h.req("POST", "/api/assistant/grades/bulk",
              json={"item_id": item_w, "classroom_id": cls_a,
                    "entries": [{"student_id": a1, "score": 50}]})
    check(r.status_code == 404, "bulk on unassigned/inactive item -> 404 (never activates)")

    section("#262 another assistant may overwrite; stamp name")
    h.req("DELETE", f"/api/assistant/items/{item_x}/lock", params={"classroom_id": cls_a})
    h.as_user(student_payload(u4, e4))
    h.req("GET", "/api/me")  # binds A4's account (as the app does on load)
    r = h.req("POST", f"/api/assistant/items/{item_x}/lock", params={"classroom_id": cls_a})
    check(r.status_code == 200, "A4 takes the lock after A1 released it", r.text)
    r = h.req("PUT", f"/api/assistant/grades/{g_a1}", json={"score": 91})
    check(r.status_code == 200 and r.json()["score"] == 91,
          "assistant A4 overwrites A1's assistant-entered score", r.text)
    with h.session() as s:
        check(s.get(Grade, uuid.UUID(g_a1)).entered_by_user_id == u4,
              "stamp (DB) now points at A4's account")
    h.as_user(teacher(t1))
    rows = {x["student_id"]: x for x in h.req(
        "GET", f"/api/items/{item_x}/grades", params={"classroom_id": cls_a}).json()["students"]}
    check(rows[a1]["entered_by_role"] == "assistant" and rows[a1]["entered_by_name"] == "小美"
          and rows[a1]["entered_at"],
          "teacher view: entered_by_name resolved to 小美 + entered_at", rows[a1])
    check(rows[a2]["entered_by_role"] == "teacher", "teacher-entered row unchanged")
    h.as_user(student_payload(u4, e4))
    h.req("DELETE", f"/api/assistant/items/{item_x}/lock", params={"classroom_id": cls_a})

    section("#262 archived (封存) is invisible")
    with h.session() as s:
        sem = s.get(Semester, uuid.UUID(sem_id))
        sem.is_current = False
        s.commit()
    h.as_user(student_payload(u1, e1))
    r = h.req("GET", f"/api/assistant/items/{item_x}/grades", params={"classroom_id": cls_a})
    check(r.status_code == 404, "semester archived -> GET 404", r.status_code)
    r = h.req("PUT", f"/api/assistant/grades/{g_a1}", json={"score": 50})
    check(r.status_code == 404, "semester archived -> PUT 404", r.status_code)
    me = h.req("GET", "/api/me").json()["identity"]
    check(me["assistant_contexts"][0]["items"] == [], "semester archived -> no items listed")
    with h.session() as s:
        sem = s.get(Semester, uuid.UUID(sem_id))
        sem.is_current = True
        s.commit()
    h.as_user(teacher(t1))
    r = h.req("POST", f"/api/classrooms/{cls_a}/snapshots")
    check(r.status_code == 201, "teacher archives class A into a snapshot (結算)", r.text)
    h.as_user(student_payload(u1, e1))
    r = h.req("GET", f"/api/assistant/items/{item_x}/grades", params={"classroom_id": cls_a})
    check(r.status_code == 404, "snapshot-archived item -> GET 404", r.status_code)
    r = h.req("PUT", f"/api/assistant/grades/{g_a1}", json={"score": 50})
    check(r.status_code == 404, "snapshot-archived grade -> PUT 404", r.status_code)
    r = h.req("POST", "/api/assistant/grades/bulk",
              json={**base, "entries": [{"student_id": a1, "score": 50}]})
    check(r.status_code == 404, "snapshot-archived item -> bulk 404", r.status_code)
    me = h.req("GET", "/api/me").json()["identity"]
    check(me["assistant_contexts"][0]["items"] == [], "snapshot-archived item not listed")
    # Re-activate X in class A for the remaining checks.
    h.as_user(teacher(t1))
    h.req("POST", "/api/grades/bulk", json={**base, "entries": []})

    section("#262 revocation")
    h.as_user(student_payload(u1, e1))
    h.req("POST", f"/api/assistant/items/{item_x}/lock", params={"classroom_id": cls_a})
    r = h.req("POST", "/api/assistant/grades", json={**base, "student_id": a1, "score": 80})
    check(r.status_code == 201, "precondition: A1 can write again after re-activation", r.text)
    g_new = r.json().get("id")
    h.as_user(teacher(t1))
    r = h.req("PUT", f"/api/students/{a1}/assistant", json={"is_assistant": False})
    check(r.status_code == 200 and r.json()["is_assistant"] is False, "teacher revokes A1")
    with h.session() as s:
        n_items = s.query(ItemAssistant).filter(ItemAssistant.student_id == uuid.UUID(a1)).count()
        stamp = s.get(Grade, uuid.UUID(g_new)).entered_by_role
    check(n_items == 0 and stamp == "assistant",
          "revoke deletes item assignments; existing stamp kept")
    h.as_user(student_payload(u1, e1))
    r = h.req("POST", "/api/assistant/grades", json={**base, "student_id": a1, "score": 81})
    check(r.status_code == 404, "revoked assistant write -> 404", r.status_code)
    r = h.req("POST", f"/api/assistant/items/{item_x}/lock", params={"classroom_id": cls_a})
    check(r.status_code == 404, "#264 B7: revoked assistant's heartbeat -> 404", r.status_code)
    # Release needs no permission (it only ever deletes the caller's own
    # row), so a revoked assistant still frees the item at once.
    r = h.req("DELETE", f"/api/assistant/items/{item_x}/lock", params={"classroom_id": cls_a})
    with h.session() as s:
        from models.grading import GradeItemLock
        n_lock = s.query(GradeItemLock).filter(GradeItemLock.holder_user_id == u1).count()
    check(r.status_code == 204 and n_lock == 0,
          "#264: revoked assistant can still release its own lock", r.status_code)
    me = h.req("GET", "/api/me").json()["identity"]
    check(me["assistant_contexts"] == [] and me["is_student"] is True,
          "revoked assistant: no contexts (frontend -> /no-access)")

    # Email cleared -> role removed automatically.
    h.as_user(teacher(t1))
    h.req("PUT", f"/api/items/{item_x}/assistants", json={"student_ids": [a4]})
    r = h.req("PUT", f"/api/students/{a4}", json={"seat_number": 4, "name": "小美", "email": None})
    check(r.status_code == 200 and r.json()["is_assistant"] is False,
          "clearing email auto-revokes assistant", r.text)
    h.as_user(student_payload(u4, e4))
    r = h.req("POST", "/api/assistant/grades", json={**base, "student_id": a4, "score": 70})
    check(r.status_code == 404, "old account after email cleared -> 404", r.status_code)

    # Email changed -> old account loses access; role kept for the new one.
    h.as_user(teacher(t1))
    h.req("PUT", f"/api/students/{a1}/assistant", json={"is_assistant": True})
    h.req("PUT", f"/api/items/{item_x}/assistants", json={"student_ids": [a1]})
    e1b = f"{TAG}-a1-new@example.com"
    h.req("PUT", f"/api/students/{a1}", json={"seat_number": 1, "name": "小明", "email": e1b})
    h.as_user(student_payload(u1, e1))
    r = h.req("POST", "/api/assistant/grades", json={**base, "student_id": a1, "score": 70})
    check(r.status_code == 404, "old account after email changed -> 404", r.status_code)
    h.as_user(student_payload(uuid.uuid4(), e1b, provider="email"))
    r = h.req("POST", "/api/assistant/grades", json={**base, "student_id": a1, "score": 70})
    check(r.status_code == 404, "non-google account with the new email -> 404", r.status_code)
    h.as_user(student_payload(uuid.uuid4(), e1b))
    h.req("POST", f"/api/assistant/items/{item_x}/lock", params={"classroom_id": cls_a})
    r = h.req("POST", "/api/assistant/grades", json={**base, "student_id": a1, "score": 70})
    check(r.status_code == 201, "google account with the new email can write", r.text)
    h.req("DELETE", f"/api/assistant/items/{item_x}/lock", params={"classroom_id": cls_a})

    # Transfer into a class where an assistant already has the same email -> 409.
    h.as_user(teacher(t1))
    eb1 = f"{TAG}-b1@example.com"
    r = h.req("PUT", f"/api/students/{b1}/assistant", json={"is_assistant": True})
    check(r.status_code == 200, "precondition: B1 is assistant of class B", r.text)
    r = h.req("PUT", f"/api/students/{a1}",
              json={"classroom_id": cls_b, "seat_number": 5, "name": "小明", "email": eb1})
    check(r.status_code == 409 and _code(r) == "errors.assistant.email_clash",
          "transfer into a class whose assistant has the same email -> 409", r.text)
    with h.session() as s:
        st = s.get(_Student, uuid.UUID(a1))
        n = s.query(ClassAssistant).filter(ClassAssistant.student_id == uuid.UUID(a1)).count()
    check(str(st.classroom_id) == cls_a and st.email == e1b and n == 1,
          "rejected transfer saved nothing (class, email, role kept)")
    h.req("PUT", f"/api/students/{b1}/assistant", json={"is_assistant": False})

    # Class transfer ends the role.
    r = h.req("PUT", f"/api/students/{a1}",
              json={"classroom_id": cls_b, "seat_number": 5, "name": "小明", "email": e1b})
    check(r.status_code == 200 and r.json()["is_assistant"] is False,
          "transfer to another class revokes assistant", r.text)
    with h.session() as s:
        n = s.query(ClassAssistant).filter(ClassAssistant.student_id == uuid.UUID(a1)).count()
    check(n == 0, "no class_assistant row left after transfer")

    section("#262 Excel import vs 小老師 email")
    import routers.student as student_mod
    h.as_user(teacher(t1))
    cls_d = h.req("POST", "/api/classrooms", json={"grade": 8, "name": f"{TAG}-D"}).json()["id"]
    ed1, ed2 = f"{TAG}-d1@example.com", f"{TAG}-d2@example.com"
    d1 = mk_student(cls_d, 1, "丁一", ed1)
    d2 = mk_student(cls_d, 2, "丁二", ed2)
    r = h.req("PUT", f"/api/students/{d1}/assistant", json={"is_assistant": True})
    check(r.status_code == 200, "precondition: D1 is assistant of class D", r.text)

    def imp(rows_: list[list[Any]], dry: bool) -> Any:
        files_ = {"file": ("s.xlsx", xlsx(rows_),
                           "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")}
        return h.req("POST", f"/api/classrooms/{cls_d}/students/import"
                     f"?dry_run={'true' if dry else 'false'}", files=files_)

    for label, rows_, seat in (
        ("update a student to the assistant's email", [[2, "丁二", ed1]], 2),
        ("create a student with the assistant's email", [[3, "丁三", ed1]], 3),
        ("change the assistant's email to a classmate's", [[1, "丁一", ed2]], 1),
    ):
        r = imp(rows_, dry=True)
        body = r.json()
        row = next((x for x in body.get("rows", []) if x["seat_number"] == seat), {})
        check(r.status_code == 200 and row.get("action") == "error"
              and "duplicate_email_assistant" in row.get("errors", [])
              and body["summary"]["errors"] == 1,
              f"import preview: {label} -> error row", body)
        r = imp(rows_, dry=False)
        check(r.status_code == 400 and _code(r) == "errors.import.has_errors",
              f"import commit refused: {label}", r.text)
    # Unchanged assistant row + a classmate taking its email: only the
    # classmate's (changed) row is an error.
    r = imp([[1, "丁一", ed1], [2, "丁二", ed1]], dry=True)
    rows_by = {x["seat_number"]: x for x in r.json().get("rows", [])}
    check(rows_by.get(1, {}).get("action") == "update"
          and rows_by.get(2, {}).get("action") == "error",
          "import preview: unchanged assistant row stays update, changed classmate row errors",
          rows_by)
    # Ordinary students only -> warning, commit allowed.
    r = imp([[3, "丁三", ed2]], dry=True)
    row = next((x for x in r.json().get("rows", []) if x["seat_number"] == 3), {})
    check(row.get("action") == "create" and "duplicate_email" in row.get("warnings", [])
          and not row.get("errors"),
          "import preview: duplicate between ordinary students -> warning only", row)
    r = imp([[3, "丁三", ed2]], dry=False)
    check(r.status_code == 200, "import commit: ordinary duplicate allowed", r.text)
    # A clash that slips past the preview (e.g. role granted concurrently):
    # the commit re-checks and the whole batch is rolled back.
    real_ids = student_mod.assistant_ids_in_classroom
    student_mod.assistant_ids_in_classroom = lambda db, cid: set()
    try:
        r = imp([[2, "丁二改", f"{TAG}-d2-new@example.com"],
                 [4, "丁四", f"{TAG}-d4@example.com"],
                 [5, "丁五", ed1]], dry=False)
    finally:
        student_mod.assistant_ids_in_classroom = real_ids
    check(r.status_code == 409 and _code(r) == "errors.assistant.email_clash",
          "import commit: assistant email clash past preview -> 409", r.text)
    roster = {s["seat_number"]: s for s in
              h.req("GET", f"/api/classrooms/{cls_d}/students").json()["data"]}
    check(set(roster) == {1, 2, 3} and roster[2]["name"] == "丁二"
          and roster[2]["email"] == ed2 and roster[1]["is_assistant"] is True,
          "import 409 rolled back the whole batch (no row saved)", roster)

    # /api/me/reset must not trip over the new tables (FK CASCADE). Uses a
    # fresh teacher without snapshots: reset after a snapshot already fails
    # on snapshot_student's RESTRICT FK — a pre-existing, unrelated issue.
    t3 = uuid.uuid4()
    h.as_user(teacher(t3))
    h.req("POST", "/api/me/seed")
    c3 = h.req("POST", "/api/classrooms", json={"grade": 9, "name": f"{TAG}-R"}).json()["id"]
    s3 = h.req("POST", f"/api/classrooms/{c3}/students",
               json={"seat_number": 1, "email": f"{TAG}-r@example.com",
                     "is_assistant": True}).json()
    check(s3.get("is_assistant") is True, "create student with is_assistant=true")
    sem3 = next(x["id"] for x in h.req("GET", "/api/semesters").json()["data"] if x["is_current"])
    quiz3 = next(c["id"] for c in h.req("GET", "/api/categories").json()["data"]
                 if c["system_key"] == "quiz")
    it3 = h.req("POST", "/api/items", json={"subject_id": subject_id, "category_id": quiz3,
                                            "semester_id": sem3, "name": f"{TAG}-R"}).json()["id"]
    h.req("POST", "/api/grades/bulk", json={"item_id": it3, "classroom_id": c3, "entries": []})
    h.req("PUT", f"/api/items/{it3}/assistants", json={"student_ids": [s3["id"]]})
    r = h.req("POST", "/api/me/reset")
    with h.session() as s:
        left = (s.query(ClassAssistant).filter(ClassAssistant.user_id == t3).count()
                + s.query(ItemAssistant).filter(ItemAssistant.user_id == t3).count())
    check(r.status_code == 200 and left == 0,
          "/api/me/reset cascades through class_assistant / item_assistant", r.text[:200])


# ---------------------------------------------------------------------------
# #264 — grade-item edit locks + one live grade per cell
# ---------------------------------------------------------------------------

def _details(r: Any) -> dict[str, Any]:
    try:
        return r.json()["detail"]["error"].get("details") or {}
    except Exception:
        return {}


def verify_264(h: Harness) -> None:
    from models.curriculum import Semester
    from models.grading import Grade, GradeItemLock

    section("#264 setup (T1: classes A, B; assistants 小明 + 小美 on X in A; T2: class C)")
    t1, t2 = uuid.uuid4(), uuid.uuid4()
    h.as_user(teacher(t1))
    h.req("POST", "/api/me/seed")
    cls_a = h.req("POST", "/api/classrooms", json={"grade": 7, "name": f"{TAG}-LA"}).json()["id"]
    cls_b = h.req("POST", "/api/classrooms", json={"grade": 7, "name": f"{TAG}-LB"}).json()["id"]
    subj = h.req("GET", "/api/subjects").json()["data"][0]
    quiz_id = next(c["id"] for c in h.req("GET", "/api/categories").json()["data"]
                   if c["system_key"] == "quiz")
    sem_id = next(x["id"] for x in h.req("GET", "/api/semesters").json()["data"]
                  if x["is_current"])

    def mk_item(name: str) -> str:
        r = h.req("POST", "/api/items", json={
            "subject_id": subj["id"], "category_id": quiz_id,
            "semester_id": sem_id, "name": f"{TAG}-{name}"})
        assert r.status_code == 201, r.text
        return r.json()["id"]

    def mk_student(cid: str, seat: int, name: str, email: str | None) -> str:
        r = h.req("POST", f"/api/classrooms/{cid}/students",
                  json={"seat_number": seat, "name": name, "email": email})
        assert r.status_code == 201, r.text
        return r.json()["id"]

    item_x, item_y = mk_item("LX"), mk_item("LY")
    e1, e4 = f"{TAG}-l1@example.com", f"{TAG}-l4@example.com"
    a1 = mk_student(cls_a, 1, "小明", e1)
    a2 = mk_student(cls_a, 2, "小華", None)
    a4 = mk_student(cls_a, 4, "小美", e4)
    b1 = mk_student(cls_b, 1, "乙一", None)
    for it, cid in ((item_x, cls_a), (item_y, cls_a), (item_x, cls_b)):
        h.req("POST", "/api/grades/bulk", json={"item_id": it, "classroom_id": cid, "entries": []})
    for sid in (a1, a4):
        h.req("PUT", f"/api/students/{sid}/assistant", json={"is_assistant": True})
    r = h.req("PUT", f"/api/items/{item_x}/assistants", json={"student_ids": [a1, a4]})
    assert r.status_code == 200, r.text
    g_a2 = h.req("POST", "/api/grades", json={"item_id": item_x, "student_id": a2,
                                              "score": 70}).json()["id"]
    h.as_user(teacher(t2))
    h.req("POST", "/api/me/seed")
    cls_c = h.req("POST", "/api/classrooms", json={"grade": 7, "name": f"{TAG}-LC"}).json()["id"]
    sem2 = next(x["id"] for x in h.req("GET", "/api/semesters").json()["data"] if x["is_current"])
    quiz2 = next(c["id"] for c in h.req("GET", "/api/categories").json()["data"]
                 if c["system_key"] == "quiz")
    item_z = h.req("POST", "/api/items", json={
        "subject_id": subj["id"], "category_id": quiz2,
        "semester_id": sem2, "name": f"{TAG}-LZ"}).json()["id"]

    u1, u4 = uuid.uuid4(), uuid.uuid4()
    lock_x = f"/api/assistant/items/{item_x}/lock"
    pa = {"classroom_id": cls_a}
    base = {"item_id": item_x, "classroom_id": cls_a}

    section("#264 assistant: lock required, first come first served")
    h.as_user(student_payload(u4, e4))
    h.req("GET", "/api/me")
    h.as_user(student_payload(u1, e1))
    r = h.req("GET", lock_x, params=pa)
    check(r.status_code == 200 and r.json() == {"locked": False, "mine": False,
                                                "holder_role": None, "holder_name": None},
          "GET lock state: free", r.text)
    r = h.req("POST", "/api/assistant/grades/bulk",
              json={**base, "entries": [{"student_id": a1, "score": 80}]})
    check(r.status_code == 409 and _code(r) == "errors.grade.item_locked"
          and _details(r).get("holder_role") is None,
          "assistant bulk WITHOUT the lock -> 409 item_locked (holder null)", r.text)
    r = h.req("POST", "/api/assistant/grades",
              json={**base, "student_id": a1, "score": 80})
    check(r.status_code == 409 and _code(r) == "errors.grade.item_locked",
          "assistant POST without the lock -> 409", r.text)
    r = h.req("POST", lock_x, params=pa)
    check(r.status_code == 200 and r.json()["mine"] is True and r.json()["locked"] is True,
          "小明 takes the lock (pencil)", r.text)
    r = h.req("POST", lock_x, params=pa)
    check(r.status_code == 200 and r.json()["mine"] is True,
          "heartbeat (repeat acquire) by the holder renews", r.text)
    r = h.req("POST", "/api/assistant/grades/bulk",
              json={**base, "entries": [{"student_id": a1, "score": 80}]})
    check(r.status_code == 200 and r.json()["written"] == 1, "holder can write", r.text)
    g_a1 = h.req("GET", f"/api/assistant/items/{item_x}/grades", params=pa).json()
    g_a1 = next(x["grade_id"] for x in g_a1["students"] if x["student_id"] == a1)

    h.as_user(student_payload(u4, e4))
    r = h.req("GET", lock_x, params=pa)
    body = r.json() if r.status_code == 200 else {}
    check(r.status_code == 200 and body.get("locked") is True and body.get("mine") is False
          and body.get("holder_role") == "assistant" and body.get("holder_name") == "小明",
          "other assistant sees '小明（小老師）' holding it", r.text)
    check("holder_user_id" not in r.text and str(u1) not in r.text,
          "assistant lock state never carries the holder's account id")
    r = h.req("POST", lock_x, params=pa)
    check(r.status_code == 409 and _code(r) == "errors.grade.item_locked"
          and _details(r).get("holder_name") == "小明"
          and _details(r).get("holder_role") == "assistant"
          and str(u1) not in r.text,
          "second assistant cannot take it -> 409 naming 小明 (no account id)", r.text)
    for label, method, url, kw in (
        ("bulk", "POST", "/api/assistant/grades/bulk",
         {"json": {**base, "entries": [{"student_id": a4, "score": 60}]}}),
        ("POST", "POST", "/api/assistant/grades",
         {"json": {**base, "student_id": a4, "score": 60}}),
        ("PUT", "PUT", f"/api/assistant/grades/{g_a1}", {"json": {"score": 61}}),
    ):
        r = h.req(method, url, **kw)
        check(r.status_code == 409 and _code(r) == "errors.grade.item_locked",
              f"non-holder assistant {label} -> 409", r.text)
    r = h.req("DELETE", lock_x, params=pa)
    with h.session() as s:
        holder = s.query(GradeItemLock.holder_user_id).filter(
            GradeItemLock.item_id == uuid.UUID(item_x),
            GradeItemLock.classroom_id == uuid.UUID(cls_a)).scalar()
    check(r.status_code == 204 and holder == u1,
          "assistant releasing someone else's lock: 204 but lock untouched")
    r = h.req("POST", f"/api/classrooms/{cls_a}/item-locks",
              json={"item_ids": [item_x], "takeover": True})
    check(r.status_code == 404, "assistant calling the teacher takeover route -> 404", r.status_code)

    section("#264 lock routes: uniform 404 / 403")
    for label, it, cid in (
        ("unassigned item Y", item_y, cls_a),
        ("assigned X, other class B", item_x, cls_b),
        ("other teacher's item Z", item_z, cls_c),
        ("non-existent item", str(uuid.uuid4()), cls_a),
    ):
        for method in ("GET", "POST"):
            r = h.req(method, f"/api/assistant/items/{it}/lock", params={"classroom_id": cid})
            check(r.status_code == 404 and _code(r) == "errors.item.not_found",
                  f"assistant {method} lock on {label} -> uniform 404", r.status_code)
    h.as_user(teacher(t2))
    r = h.req("GET", f"/api/classrooms/{cls_a}/item-locks")
    check(r.status_code == 404, "T2 lists T1's class locks -> 404", r.status_code)
    r = h.req("POST", f"/api/classrooms/{cls_a}/item-locks",
              json={"item_ids": [item_x], "takeover": True})
    check(r.status_code == 404, "T2 takes over in T1's class -> 404", r.status_code)
    r = h.req("POST", f"/api/classrooms/{cls_a}/item-locks/release", json={"item_ids": [item_x]})
    check(r.status_code == 404, "T2 releases in T1's class -> 404", r.status_code)
    r = h.req("POST", f"/api/classrooms/{cls_c}/item-locks", json={"item_ids": [item_x]})
    check(r.status_code == 404 and _code(r) == "errors.item.not_found",
          "T2 locks T1's item in T2's own class -> 404 item", r.text)

    section("#264 teacher first: blocked writes, takeover")
    h.as_user(teacher(t1))
    r = h.req("GET", f"/api/classrooms/{cls_a}/item-locks")
    locks = r.json().get("locks", []) if r.status_code == 200 else []
    check(r.status_code == 200 and len(locks) == 1 and locks[0]["item_id"] == item_x
          and locks[0]["holder_role"] == "assistant" and locks[0]["holder_name"] == "小明"
          and locks[0]["mine"] is False and "holder_user_id" not in r.text,
          "teacher sees X locked by 小明 (no account id)", r.text)
    for label, method, url, kw in (
        ("bulk", "POST", "/api/grades/bulk",
         {"json": {**base, "entries": [{"student_id": a2, "score": 71}]}}),
        ("POST", "POST", "/api/grades", {"json": {"item_id": item_x, "student_id": a2, "score": 71}}),
        ("PUT", "PUT", f"/api/grades/{g_a2}", {"json": {"score": 71}}),
        ("DELETE", "DELETE", f"/api/grades/{g_a2}", {}),
    ):
        r = h.req(method, url, **kw)
        check(r.status_code == 409 and _code(r) == "errors.grade.item_locked"
              and _details(r).get("holder_name") == "小明",
              f"teacher {label} while 小明 holds X -> 409 naming him", r.text)
    with h.session() as s:
        check(float(s.get(Grade, uuid.UUID(g_a2)).score) == 70, "blocked teacher writes saved nothing")
    r = h.req("POST", "/api/grades/bulk", json={"item_id": item_x, "classroom_id": cls_b,
                                                "entries": [{"student_id": b1, "score": 55}]})
    check(r.status_code == 200 and r.json()["written"] == 1,
          "lock is per class: teacher writes X in class B freely", r.text)
    r = h.req("POST", "/api/grades/bulk",
              json={**base, "entries": [{"student_id": b1, "score": 99}]})
    check(r.status_code == 400 and _code(r) == "errors.grade.student_not_in_class"
          and _details(r).get("student_ids") == [b1],
          "B2: teacher bulk for class A smuggling a class-B student -> 400", r.text)
    r = h.req("POST", "/api/grades/bulk",
              json={"item_id": item_x, "classroom_id": cls_b,
                    "entries": [{"student_id": a2, "score": 99}]})
    check(r.status_code == 400 and _code(r) == "errors.grade.student_not_in_class",
          "B2: class-A student sent under class B (would bypass A's lock) -> 400", r.text)
    with h.session() as s:
        check(float(s.get(Grade, uuid.UUID(g_a2)).score) == 70, "B2 rejection saved nothing")
    r = h.req("POST", f"/api/classrooms/{cls_a}/item-locks", json={"item_ids": [item_x]})
    check(r.status_code == 409 and _details(r).get("holder_name") == "小明",
          "teacher pencil without takeover -> 409 (UI asks 要接手嗎)", r.text)
    # Row edit: all items of the subject at once, all or nothing.
    r = h.req("POST", f"/api/classrooms/{cls_a}/item-locks", json={"item_ids": [item_y, item_x]})
    locks = h.req("GET", f"/api/classrooms/{cls_a}/item-locks").json()["locks"]
    check(r.status_code == 409 and not any(lk["item_id"] == item_y for lk in locks),
          "multi-item acquire blocked by one -> 409 and Y NOT left locked (all or nothing)",
          locks)
    r = h.req("POST", f"/api/classrooms/{cls_a}/item-locks",
              json={"item_ids": [item_y, item_x], "takeover": True})
    mine = {lk["item_id"] for lk in r.json().get("locks", []) if lk["mine"]} if r.status_code == 200 else set()
    check(r.status_code == 200 and mine == {item_x, item_y},
          "teacher takeover (row edit) -> holds X and Y", r.text)
    r = h.req("POST", "/api/grades/bulk",
              json={**base, "entries": [{"student_id": a2, "score": 72}]})
    check(r.status_code == 200, "teacher (holder) writes X", r.text)

    h.as_user(student_payload(u1, e1))
    r = h.req("POST", lock_x, params=pa)
    check(r.status_code == 409 and _details(r).get("holder_role") == "teacher",
          "taken-over assistant's heartbeat -> 409 holder_role teacher", r.text)
    r = h.req("POST", "/api/assistant/grades/bulk",
              json={**base, "entries": [{"student_id": a1, "score": 81}]})
    check(r.status_code == 409 and _code(r) == "errors.grade.item_locked",
          "taken-over assistant's pending save -> 409 (input discarded)", r.text)
    r = h.req("GET", lock_x, params=pa)
    check(r.status_code == 200 and r.json()["holder_role"] == "teacher"
          and r.json()["mine"] is False, "assistant view: 老師正在編輯", r.text)
    h.as_user(student_payload(u4, e4))
    r = h.req("POST", lock_x, params=pa)
    check(r.status_code == 409 and _details(r).get("holder_role") == "teacher",
          "no assistant can take a teacher's lock", r.text)

    h.as_user(teacher(t1))
    r = h.req("POST", f"/api/classrooms/{cls_a}/item-locks", json={"item_ids": [item_x, item_y]})
    check(r.status_code == 200, "teacher heartbeat (own locks) renews", r.text)
    r = h.req("POST", f"/api/classrooms/{cls_a}/item-locks/release",
              json={"item_ids": [item_x, item_y]})
    locks = h.req("GET", f"/api/classrooms/{cls_a}/item-locks").json()["locks"]
    check(r.status_code == 204 and locks == [], "teacher release frees X and Y", locks)
    r = h.req("POST", "/api/grades", json={"item_id": item_x, "student_id": a2, "score": 73})
    check(r.status_code == 201, "teacher write with no lock held by anyone -> allowed", r.text)

    section("#264 expiry (90 s, judged by the DB clock)")
    h.as_user(student_payload(u1, e1))
    r = h.req("POST", lock_x, params=pa)
    check(r.status_code == 200, "小明 takes X again", r.text)
    h.conn.execute(text(
        "UPDATE grade_item_lock SET expires_at = now() - interval '1 second' "
        "WHERE item_id = :i AND classroom_id = :c"), {"i": item_x, "c": cls_a})
    r = h.req("GET", lock_x, params=pa)
    check(r.status_code == 200 and r.json()["locked"] is False, "expired lock reads as free", r.text)
    r = h.req("POST", "/api/assistant/grades/bulk",
              json={**base, "entries": [{"student_id": a1, "score": 82}]})
    check(r.status_code == 409, "expired holder can no longer write", r.status_code)
    h.as_user(teacher(t1))
    r = h.req("PUT", f"/api/grades/{g_a2}", json={"score": 74})
    check(r.status_code == 200, "teacher not blocked by an expired assistant lock", r.text)
    h.as_user(student_payload(u4, e4))
    r = h.req("POST", lock_x, params=pa)
    check(r.status_code == 200 and r.json()["mine"] is True,
          "another assistant takes over an expired lock", r.text)
    h.as_user(student_payload(u1, e1))
    r = h.req("POST", lock_x, params=pa)
    check(r.status_code == 409 and _details(r).get("holder_name") == "小美",
          "idle/expired assistant coming back: lock taken -> 409 naming 小美", r.text)

    section("#264 Excel import vs locks (A7)")
    h.as_user(teacher(t1))
    wb = Workbook()
    ws = wb.active
    ws.append(["座號", "小考"])
    ws.append([None, "2026-10-01"])
    ws.append([None, f"{TAG}-LX"])
    ws.append([1, 66])
    ws.append([2, 67])
    buf = BytesIO()
    wb.save(buf)
    files = {"file": ("g.xlsx", buf.getvalue(),
                      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")}
    subjects = json.dumps({"1": subj["system_key"]})
    r = h.req("POST", f"/api/classrooms/{cls_a}/grades/import?dry_run=false",
              files=files, data={"subjects": subjects})
    locks = _details(r).get("locks", [])
    check(r.status_code == 409 and _code(r) == "errors.grade.item_locked"
          and locks and locks[0].get("item_name") == f"{TAG}-LX"
          and locks[0].get("holder_name") == "小美",
          "import touching an assistant-locked item -> 409 listing item + holder", r.text)
    with h.session() as s:
        check(float(s.get(Grade, uuid.UUID(g_a2)).score) == 74, "blocked import saved nothing")
    h.as_user(student_payload(u4, e4))
    h.req("DELETE", lock_x, params=pa)
    h.as_user(teacher(t1))
    r = h.req("POST", f"/api/classrooms/{cls_a}/grades/import?dry_run=false",
              files=files, data={"subjects": subjects})
    check(r.status_code == 200, "import once the lock is released -> 200", r.text[:300])
    with h.session() as s:
        g = s.get(Grade, uuid.UUID(g_a2))
        n_live = s.query(Grade).filter(Grade.item_id == uuid.UUID(item_x),
                                       Grade.student_id == uuid.UUID(a1),
                                       Grade.snapshot_id.is_(None)).count()
    check(float(g.score) == 67 and n_live == 1,
          "import updated existing cells, no duplicate live rows", (float(g.score), n_live))

    section("#264 archived semester (B9)")
    with h.session() as s:
        s.get(Semester, uuid.UUID(sem_id)).is_current = False
        s.commit()
    r = h.req("POST", f"/api/classrooms/{cls_a}/item-locks", json={"item_ids": [item_x]})
    check(r.status_code == 403 and _code(r) == "errors.semester.archived",
          "teacher lock on an archived-semester item -> 403", r.text)
    h.as_user(student_payload(u1, e1))
    r = h.req("POST", lock_x, params=pa)
    check(r.status_code == 404, "assistant lock on archived item -> 404", r.status_code)
    with h.session() as s:
        s.get(Semester, uuid.UUID(sem_id)).is_current = True
        s.commit()

    section("#264 live unique index + concurrent duplicate writes")
    from sqlalchemy.exc import IntegrityError
    from models.grading import insert_live_grades
    h.as_user(teacher(t1))
    with h.session() as s:
        try:
            with s.begin_nested():
                s.add(Grade(user_id=t1, item_id=uuid.UUID(item_x), student_id=uuid.UUID(a2),
                            score=1, source="manual"))
                s.flush()
            dup_ok = True
        except IntegrityError:
            dup_ok = False
        check(not dup_ok, "DB refuses a second live grade for the same cell")
        # The insert every writer uses: a cell that already exists (as if a
        # concurrent writer created it after our read) is skipped, not
        # duplicated and not an error; a new cell in the same batch lands.
        got = insert_live_grades(s, [
            {"user_id": t1, "item_id": uuid.UUID(item_x), "student_id": uuid.UUID(a2),
             "score": 1, "source": "manual", "entered_by_user_id": t1,
             "entered_by_role": "teacher"},
            {"user_id": t1, "item_id": uuid.UUID(item_y), "student_id": uuid.UUID(a2),
             "score": 2, "source": "manual", "entered_by_user_id": t1,
             "entered_by_role": "teacher"},
        ])
        check(got == {(uuid.UUID(item_y), uuid.UUID(a2))},
              "insert_live_grades: existing cell skipped (ON CONFLICT), new cell inserted", got)
        s.rollback()
    import routers.grade_entry as ge
    real_live = ge._live_grade
    calls: list[int] = []

    def miss_first(db: Any, item_id: Any, student_id: Any) -> Any:
        calls.append(1)
        return None if len(calls) == 1 else real_live(db, item_id, student_id)

    try:
        ge._live_grade = miss_first
        r = h.req("POST", "/api/grades", json={"item_id": item_x, "student_id": a2, "score": 75})
    finally:
        ge._live_grade = real_live
    check(r.status_code == 201 and r.json()["id"] == g_a2 and r.json()["score"] == 75,
          "teacher POST racing a concurrent create -> overwrites the existing row", r.text)
    r = h.req("POST", "/api/grades/bulk",
              json={**base, "entries": [{"student_id": a2, "score": 76},
                                        {"student_id": a4, "score": 50},
                                        {"student_id": a4, "score": 51}]})
    check(r.status_code == 200 and r.json()["written"] == 2,
          "teacher bulk: update + new cell (duplicate entry for one student collapses)", r.text)
    rows = h.conn.execute(text(
        "SELECT student_id, count(*) FROM grade WHERE item_id = :i AND snapshot_id IS NULL "
        "GROUP BY student_id"), {"i": item_x}).all()
    check(len(rows) == 4 and all(n == 1 for _, n in rows),  # A: 1,2,4 + B: 1
          "still exactly one live row per student", rows)

    section("#264 assistant single POST racing a real concurrent create")
    # The concurrent writer really commits a new row between the router's
    # read (which found nothing) and its INSERT ... ON CONFLICT DO NOTHING.
    import routers.assistant as am
    real_alive = am._live_grade
    a5 = mk_student(cls_a, 5, "小強", None)
    a6 = mk_student(cls_a, 6, "小志", None)
    h.as_user(student_payload(u1, e1))
    r = h.req("POST", lock_x, params=pa)
    check(r.status_code == 200, "小明 takes X for the race checks", r.text)

    def racing(sid: str, role: str, who: uuid.UUID) -> Callable[..., Any]:
        planted: list[str] = []

        def live(db: Any, actor: Any, student_id: Any) -> Any:
            if not planted:
                with h.session() as s2:
                    g = Grade(user_id=t1, item_id=uuid.UUID(item_x), student_id=uuid.UUID(sid),
                              score=40, source="manual", entered_by_user_id=who,
                              entered_by_role=role)
                    s2.add(g)
                    s2.commit()
                    planted.append(str(g.id))
                return None
            return real_alive(db, actor, student_id)
        live.planted = planted  # type: ignore[attr-defined]
        return live

    try:
        am._live_grade = race = racing(a5, "assistant", u4)
        r = h.req("POST", "/api/assistant/grades",
                  json={**base, "student_id": a5, "score": 88})
        planted_id = race.planted[0] if race.planted else None  # type: ignore[attr-defined]
        check(r.status_code == 201 and r.json().get("id") == planted_id
              and r.json().get("score") == 88,
              "assistant POST racing another assistant's create -> overwrites that row", r.text)
        am._live_grade = race = racing(a6, "teacher", t1)
        r = h.req("POST", "/api/assistant/grades",
                  json={**base, "student_id": a6, "score": 89})
        check(r.status_code == 403 and _code(r) == "errors.assistant.teacher_grade_locked",
              "assistant POST racing the teacher's create -> 403, teacher row kept", r.text)
    finally:
        am._live_grade = real_alive
    with h.session() as s:
        n5 = s.query(Grade).filter(Grade.item_id == uuid.UUID(item_x),
                                   Grade.student_id == uuid.UUID(a5),
                                   Grade.snapshot_id.is_(None)).all()
        n6 = s.query(Grade).filter(Grade.item_id == uuid.UUID(item_x),
                                   Grade.student_id == uuid.UUID(a6),
                                   Grade.snapshot_id.is_(None)).all()
    check(len(n5) == 1 and float(n5[0].score) == 88 and n5[0].entered_by_user_id == u1,
          "race: one live row for 小強, score + stamp from 小明")
    # The planted row shares the harness transaction, so the 403's rollback
    # takes it along here (a real concurrent writer commits on its own);
    # what matters is that nothing of 小明's landed.
    check(len(n6) <= 1 and all(float(g.score) == 40 and g.entered_by_role == "teacher"
                               for g in n6),
          "race: 小志's cell not written by the assistant (no 89, no duplicate)",
          [(float(g.score), g.entered_by_role) for g in n6])

    section("#264 B7: permission gone -> heartbeat 404, own lock still releasable")

    def lock_rows(uid: uuid.UUID) -> int:
        with h.session() as s:
            return s.query(GradeItemLock).filter(GradeItemLock.holder_user_id == uid).count()

    # (1) 取消資格 — 小明 still holds X from the race checks.
    h.as_user(teacher(t1))
    r = h.req("PUT", f"/api/students/{a1}/assistant", json={"is_assistant": False})
    check(r.status_code == 200, "teacher revokes 小明 while he holds X", r.text)
    h.as_user(student_payload(u1, e1))
    r = h.req("POST", lock_x, params=pa)
    check(r.status_code == 404, "B7 revoked: heartbeat -> 404", r.status_code)
    r = h.req("DELETE", lock_x, params=pa)
    check(r.status_code == 204 and lock_rows(u1) == 0, "B7 revoked: release frees X", r.status_code)
    # (2) 清 email
    h.as_user(student_payload(u4, e4))
    r = h.req("POST", lock_x, params=pa)
    check(r.status_code == 200, "小美 takes X", r.text)
    h.as_user(teacher(t1))
    r = h.req("PUT", f"/api/students/{a4}", json={"seat_number": 4, "name": "小美", "email": None})
    check(r.status_code == 200 and r.json()["is_assistant"] is False,
          "teacher clears 小美's email while she holds X", r.text)
    h.as_user(student_payload(u4, e4))
    r = h.req("POST", lock_x, params=pa)
    check(r.status_code == 404, "B7 email cleared: heartbeat -> 404", r.status_code)
    r = h.req("DELETE", lock_x, params=pa)
    check(r.status_code == 204 and lock_rows(u4) == 0, "B7 email cleared: release frees X",
          r.status_code)
    # (3) 轉班 — re-grant 小明 first.
    h.as_user(teacher(t1))
    h.req("PUT", f"/api/students/{a1}/assistant", json={"is_assistant": True})
    r = h.req("PUT", f"/api/items/{item_x}/assistants", json={"student_ids": [a1]})
    check(r.status_code == 200, "precondition: 小明 re-assigned to X", r.text)
    h.as_user(student_payload(u1, e1))
    r = h.req("POST", lock_x, params=pa)
    check(r.status_code == 200, "小明 takes X again", r.text)
    h.as_user(teacher(t1))
    r = h.req("PUT", f"/api/students/{a1}",
              json={"classroom_id": cls_b, "seat_number": 7, "name": "小明", "email": e1})
    check(r.status_code == 200 and r.json()["is_assistant"] is False,
          "teacher moves 小明 to class B while he holds X", r.text)
    h.as_user(student_payload(u1, e1))
    r = h.req("POST", lock_x, params=pa)
    check(r.status_code == 404, "B7 transferred: heartbeat -> 404", r.status_code)
    r = h.req("DELETE", lock_x, params=pa)
    check(r.status_code == 204 and lock_rows(u1) == 0, "B7 transferred: release frees X",
          r.status_code)

    section("#264 cascade")
    h.as_user(teacher(t1))
    h.req("POST", f"/api/classrooms/{cls_b}/item-locks", json={"item_ids": [item_x]})
    r = h.req("DELETE", f"/api/classrooms/{cls_b}")
    with h.session() as s:
        n = s.query(GradeItemLock).filter(GradeItemLock.classroom_id == uuid.UUID(cls_b)).count()
    check(r.status_code in (200, 204) and n == 0, "deleting a class cascades its locks", r.status_code)


def verify_264_migration(h: Harness) -> None:
    """Runs the duplicate-merge SQL of migration u4p5q6r7s8t9 on planted
    duplicates. LAST section on purpose: DROP INDEX takes an exclusive lock
    on `grade` until the final ROLLBACK, so keep that window short."""
    import importlib.util

    section("#264 migration: merge duplicate live grades")
    path = os.path.join(BACKEND_DIR, "alembic", "versions", "u4p5q6r7s8t9_grade_live_unique.py")
    spec = importlib.util.spec_from_file_location("mig_u4", path)
    mig = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(mig)

    t = uuid.uuid4()
    h.as_user(teacher(t))
    h.req("POST", "/api/me/seed")
    cid = h.req("POST", "/api/classrooms", json={"grade": 9, "name": f"{TAG}-M"}).json()["id"]
    sid = h.req("POST", f"/api/classrooms/{cid}/students",
                json={"seat_number": 1, "name": "重"}).json()["id"]
    subj = h.req("GET", "/api/subjects").json()["data"][0]["id"]
    quiz = next(c["id"] for c in h.req("GET", "/api/categories").json()["data"]
                if c["system_key"] == "quiz")
    sem = next(x["id"] for x in h.req("GET", "/api/semesters").json()["data"] if x["is_current"])
    it = h.req("POST", "/api/items", json={"subject_id": subj, "category_id": quiz,
                                           "semester_id": sem, "name": f"{TAG}-M"}).json()["id"]
    c = h.conn
    c.execute(text("DROP INDEX uq_grade_live_item_student"))
    ids = []
    for score, age in ((10, 3), (20, 2), (30, 1)):  # 30 is the newest
        ids.append(c.execute(text(
            "INSERT INTO grade (user_id, item_id, student_id, score, source, updated_at) "
            "VALUES (:u, :i, :s, :sc, 'manual', now() - make_interval(mins => :a)) RETURNING id"),
            {"u": t, "i": it, "s": sid, "sc": score, "a": age}).scalar())
    # The oldest duplicate carries a point_record; the newest has none.
    c.execute(text("INSERT INTO point_record (user_id, student_id, points, source_grade_id) "
                   "VALUES (:u, :s, 5, :g)"), {"u": t, "s": sid, "g": ids[0]})
    mig.op = _AlembicOpShim(c)
    mig.upgrade()
    rows = c.execute(text("SELECT id, score FROM grade WHERE item_id = :i AND snapshot_id IS NULL"),
                     {"i": it}).all()
    check(len(rows) == 1 and rows[0][0] == ids[2] and float(rows[0][1]) == 30,
          "merge keeps only the most recently updated live row", rows)
    pr = c.execute(text("SELECT source_grade_id FROM point_record WHERE student_id = :s"),
                   {"s": sid}).all()
    check(pr == [(ids[2],)], "the duplicate's point_record moved onto the kept row", pr)
    idx = c.execute(text("SELECT indexdef FROM pg_indexes WHERE indexname = "
                         "'uq_grade_live_item_student'")).scalar()
    check(idx is not None and "snapshot_id IS NULL" in idx, "partial unique index re-created", idx)
    mig.upgrade()  # idempotent
    n = c.execute(text("SELECT count(*) FROM grade WHERE item_id = :i"), {"i": it}).scalar()
    check(n == 1, "re-running the upgrade is a no-op")


class _AlembicOpShim:
    """Just enough of `alembic.op` (execute) to run a migration's SQL on
    the harness connection inside the rolled-back transaction."""

    def __init__(self, conn: Any) -> None:
        self.conn = conn

    def execute(self, sql: str) -> None:
        self.conn.execute(text(sql))


SECTIONS: list[Callable[[Harness], None]] = [
    verify_261, verify_262, verify_264,
    verify_264_migration,  # keep last: holds an exclusive lock on grade
]


def main_() -> int:
    h = Harness()
    try:
        for fn in SECTIONS:
            fn(h)
    except Exception:
        traceback.print_exc()
        RESULTS.append((False, "unexpected exception"))
    finally:
        h.close()  # ROLLBACK — nothing persists
    failed = [label for ok, label in RESULTS if not ok]
    print(f"\n{len(RESULTS) - len(failed)}/{len(RESULTS)} checks passed; "
          "transaction rolled back (no data left behind).")
    for label in failed:
        print(f"  FAILED: {label}")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main_())
