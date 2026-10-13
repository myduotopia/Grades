"""Repeatable verification for student login binding (#261) and 小老師
access control (#262).

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
    # Lookup failure (e.g. no privilege on auth schema) degrades to untrusted.
    orig_sql = identity._GOOGLE_IDENTITY_EMAIL_SQL
    identity._GOOGLE_IDENTITY_EMAIL_SQL = text("SELECT email FROM auth.no_such_table")
    try:
        r = h.req("GET", "/api/me")
        check(r.status_code == 200 and r.json()["identity"]["is_student"] is False,
              "auth.identities lookup failure -> 200, untrusted (not a student)", r.text[:200])
        r = h.req("POST", "/api/me/seed")
        check(r.status_code == 200, "lookup failure doesn't poison the request transaction",
              r.text[:200])
    finally:
        identity._GOOGLE_IDENTITY_EMAIL_SQL = orig_sql
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

def _code(r: Any) -> str | None:
    try:
        return r.json()["detail"]["error"]["message_key"]
    except Exception:
        return None


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
    dup = mk_student(cls_a, 9, "同信箱", e1)
    r = h.req("PUT", f"/api/students/{dup}/assistant", json={"is_assistant": True})
    check(r.status_code == 409 and _code(r) == "errors.assistant.duplicate_email",
          "duplicate email in class -> 409", r.text)
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
    r = h.req("POST", "/api/assistant/grades",
              json={"item_id": item_x, "classroom_id": cls_a, "student_id": a1, "score": 88})
    check(r.status_code == 201 and r.json()["entered_by_role"] == "assistant",
          "POST own score on X -> 201, stamped assistant", r.text)
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
    h.as_user(student_payload(u4, e4))
    h.req("GET", "/api/me")  # binds A4's account (as the app does on load)
    r = h.req("PUT", f"/api/assistant/grades/{g_a1}", json={"score": 91})
    check(r.status_code == 200 and r.json()["entered_by_user_id"] == str(u4),
          "assistant A4 overwrites A1's assistant-entered score", r.text)
    h.as_user(teacher(t1))
    rows = {x["student_id"]: x for x in h.req(
        "GET", f"/api/items/{item_x}/grades", params={"classroom_id": cls_a}).json()["students"]}
    check(rows[a1]["entered_by_role"] == "assistant" and rows[a1]["entered_by_name"] == "小美"
          and rows[a1]["entered_at"],
          "teacher view: entered_by_name resolved to 小美 + entered_at", rows[a1])
    check(rows[a2]["entered_by_role"] == "teacher", "teacher-entered row unchanged")

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
    r = h.req("POST", "/api/assistant/grades", json={**base, "student_id": a1, "score": 70})
    check(r.status_code == 201, "google account with the new email can write", r.text)

    # Class transfer ends the role.
    h.as_user(teacher(t1))
    r = h.req("PUT", f"/api/students/{a1}",
              json={"classroom_id": cls_b, "seat_number": 5, "name": "小明", "email": e1b})
    check(r.status_code == 200 and r.json()["is_assistant"] is False,
          "transfer to another class revokes assistant", r.text)
    with h.session() as s:
        n = s.query(ClassAssistant).filter(ClassAssistant.student_id == uuid.UUID(a1)).count()
    check(n == 0, "no class_assistant row left after transfer")

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


SECTIONS: list[Callable[[Harness], None]] = [verify_261, verify_262]


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
