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
so we can impersonate teachers and (Google / non-Google) students.

Exit code 0 = every check passed; 1 = at least one failed.
"""
from __future__ import annotations

import os
import sys
import traceback
import uuid
from collections.abc import Callable, Iterator
from io import BytesIO
from typing import Any

BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, BACKEND_DIR)
os.chdir(BACKEND_DIR)  # pydantic-settings reads .env from the CWD

from fastapi.testclient import TestClient  # noqa: E402
from openpyxl import Workbook  # noqa: E402
from sqlalchemy.orm import Session  # noqa: E402

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
        s = Session(bind=self.conn, join_transaction_mode="create_savepoint")
        try:
            yield s
        finally:
            s.close()

    def session(self) -> Session:
        return Session(bind=self.conn, join_transaction_mode="create_savepoint")

    def as_user(self, payload: dict[str, Any]) -> "Harness":
        self.payload = payload
        return self

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
    uid: uuid.UUID, email: str, provider: str = "google"
) -> dict[str, Any]:
    return {
        "sub": str(uid),
        "email": email,
        "app_metadata": {"provider": provider, "providers": [provider]},
        # Must be ignored — users can write user_metadata themselves.
        "user_metadata": {"email_verified": True},
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


SECTIONS: list[Callable[[Harness], None]] = [verify_261]


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
