# Data model

All tables live in the Grades Postgres (Supabase). Every domain table is scoped per-user via `user_id`; the FastAPI backend enforces isolation. **No row-level security (RLS) at the DB layer** — auth happens in FastAPI, not Postgres.

`user.id` refers to Supabase Auth's `auth.users.id` (UUID). We don't shadow that table — just FK to its UUID.

All timestamps are `timestamptz`, default `now()`. `updated_at` is set via SQLAlchemy `onupdate`.

## Tables

### `classroom`

```
classroom
├─ id                   uuid PK
├─ user_id              uuid           ← Supabase Auth user
├─ grade                smallint + CHECK BETWEEN 1 AND 12   ← 12-year compulsory education in Taiwan
├─ name                 text           ← class label only, e.g., "甲" / "忠" / "A" / "1"; UI composes display
├─ source               text + CHECK in ('manual','duotopia','google_classroom')
├─ source_external_id   text NULL      ← original ID from import source
├─ created_at, updated_at  timestamptz
└─ UNIQUE (user_id, grade, name)
```

**Grade is mandatory.** Stored as 1–12 (Taiwan elementary 1–6, junior high 7–9, senior high 10–12). UI shows `{grade}年{name}班` for zh-TW (e.g. `六年甲班`) and `Grade {grade} · {name}` for en. The `name` column is just a class label — do **not** encode grade in it. Annual promotion (planned, not in v1) bumps `grade += 1` for the user's classrooms; rows where grade reaches 13 are archived.

> Renamed from spec's `class` because `class` is a Python keyword and a SQL reserved word — using `classroom` everywhere (`classroom_id` FK, `item_classroom` M2M).

### `student`

```
student
├─ id                   uuid PK
├─ user_id              uuid           ← teacher who owns this roster entry
├─ classroom_id         uuid FK → classroom
├─ seat_number          int
├─ name                 text
├─ email                text NULL      ← Google account email; used as Supabase invite target + matching key
├─ source               text + CHECK in ('manual','duotopia','google_classroom')
├─ source_external_id   text NULL
├─ created_at, updated_at  timestamptz
└─ UNIQUE (user_id, classroom_id, seat_number)
```

**Roster entry, NOT a login account.** A `student` row exists regardless of whether the student themselves ever logs in. Teachers create rosters, enter grades, run reports — all without any student authentication.

**Excel re-import upsert key:** `(user_id, classroom_id, seat_number)`. Same Excel uploaded twice updates rows, doesn't duplicate.

**Class transfer:** allowed by updating `student.classroom_id`. Edge case, not optimized.

**`email`** is optional. When present, it's the matching key for linking the student to the Google account they sign in with (see `account_link`).

**Email normalisation (#261):** every write path (single create/update, Excel import) goes through `backend/email_validation.py` — `trim()` + `lower()`, blank → NULL, format-checked (400 `errors.student.invalid_email`). Migration `r1m2n3o4p5q6` normalised pre-existing rows. Two students in the same class sharing an email is only a **warning** (form hint / import-preview warning); it blocks making either of them a 小老師 (#262). On an Excel **update** row a blank email cell keeps the stored email (it does not clear it). Changing or clearing a student's email deletes that student's `account_link(self)` so the new address can bind.

### `account_link`

Connects student roster entries to Supabase auth users. A row means: "this auth user is allowed to view this student's data, in this role." Teachers do **not** appear here — their access comes from owning the student row directly.

```
account_link
├─ id                   uuid PK
├─ student_id           uuid FK → student (ON DELETE CASCADE)
├─ auth_user_id         uuid           ← Supabase auth.users.id
├─ link_role            text + CHECK in ('self', 'parent')
├─ linked_via           text + CHECK in ('email_invite', 'manual', 'invite_code')
├─ created_at           timestamptz
├─ UNIQUE (student_id, auth_user_id, link_role)
└─ Partial UNIQUE on (student_id) WHERE link_role = 'self'   ← at most one self-link per student
```

**Why `link_role` not `relationship`?** Avoids shadowing SQLAlchemy's `relationship()` function inside the model class.

**Linking flow — student self (#261, implemented in `backend/identity.py`):**
1. Teacher sets `student.email` (manually or via Excel).
2. The student signs in with Google. Every `GET /api/me` calls `sync_self_links`: it matches `student.email = trusted email` (both stored/compared normalised: trim + lower) across **all** teachers' rosters, inserts a missing `account_link(link_role='self', linked_via='email_invite')` for each match, and deletes this user's self links whose student no longer matches. If a matched student is still self-linked to a different account (email was reassigned), that stale link is removed first (partial unique index).
3. **Trusted email = the account's Google identity email, read server-side** (`identity.trusted_email`): `SELECT identity_data->>'email' FROM auth.identities WHERE user_id = sub AND provider = 'google'`. The JWT `email` claim and `app_metadata.provider(s)` are **not** used — the JWT email is the account's primary email, which is not necessarily the address Google verified (e.g. an email/password identity linked to the same account, or a changed primary email), and `user_metadata` is user-editable. No Google identity, or several Google identities with different emails → **untrusted**: nothing is bound and existing self links are removed on the next sync. A **lookup failure** (e.g. the DB role lacks privilege on the `auth` schema, DB hiccup; the query runs in a savepoint) is different — "can't tell" ≠ "not a student" — and raises `IdentityUnknown`: links are neither created nor deleted, `GET /api/me` answers **503** for an account that owns no class (frontend shows retry; a class owner is still served as teacher, without 小老師 contexts), `POST /api/me/seed` refuses (503) for an account that owns no class, and 小老師 endpoints answer the usual 404 (fail closed). This stops someone from registering with a student's address to inherit that student's access.
   - **Supabase project preconditions** (the check relies on them; not enforced by code): (a) the **Email** provider is disabled (this app only uses Google sign-in) — or, if it must stay on, **Confirm email** is enabled; (b) **Secure email change** is enabled; (c) **manual identity linking** is disabled (`Allow manual linking` off), so a user can't attach someone else's Google identity to their account. The backend DB role must be able to `SELECT` from `auth.identities` (the `postgres` role used today can).
4. Authorisation on student-facing endpoints re-checks the live email match; the link alone is not sufficient.

Parent links (QR flow) are a separate issue; the `invite_user_by_email` path is not used.

**Identity (`GET /api/me` → `identity`):** teacher = owns ≥1 classroom; student = has ≥1 matched roster row. "Teacher" is not a security boundary — every teacher endpoint already filters by `user_id = sub`, so a student calling one sees only their own (empty) data. A roster student who owns no class is never seeded (`POST /api/me/seed` returns zeros; 503 when the identity lookup fails) and is routed to `/assistant` or `/no-access`; an account that matches no roster keeps the new-teacher onboarding.

**Multiple parents per student:** `link_role='parent'` rows are unconstrained — mom + dad can both link to the same student. UI displays them as "Parent 1 / Parent 2" by `created_at` order.

**One auth user, multiple students:** A single auth user can link to many student rows (e.g., a parent with kids in different classes; a student with rows under multiple teachers). Look up via `WHERE auth_user_id = me`.

**`linked_via='invite_code'`** is reserved in the enum but not used in v1 — invite-code flow / table will be added later.

### `class_assistant` / `item_assistant` (小老師, #262)

```
class_assistant                       item_assistant
├─ id            uuid PK              ├─ id            uuid PK
├─ user_id       uuid  ← teacher      ├─ user_id       uuid  ← teacher
├─ classroom_id  uuid FK CASCADE      ├─ item_id       uuid FK → item CASCADE
├─ student_id    uuid FK CASCADE      ├─ student_id    uuid FK → student CASCADE
├─ created_at    timestamptz          ├─ created_at    timestamptz
└─ UNIQUE (classroom_id, student_id)  └─ UNIQUE (item_id, student_id)
```

**Why new tables, not an `account_link` extension:** `account_link` links an *auth account* to a roster row; being a 小老師 is a teacher's per-class appointment of a *roster row*, independent of whether the student has signed in yet (and it must survive the account changing when the email changes). Separate tables keep both concerns simple and let every FK cascade.

**Rules:**
- Appointing requires `student.email`, and no classmate with the same email (409). Clearing the email, transferring the student to another class, or unticking 小老師 deletes the `class_assistant` row **and** all the student's `item_assistant` rows. Grades they already entered keep their stamp. Changing (not clearing) the email keeps the role; the new address binds on next sign-in.
- `item_assistant` can only be set while the item is live (`classroom_item`, main bucket) in that student's class and the item's semester is current.
- **What an assistant can see/write** (`backend/assistant_access.py`): the account's Google identity email (`auth.identities`, see linking flow step 3) matches the student now → `class_assistant` for the student's *current* class → `item_assistant` for the item → item is the same teacher's, in the teacher's **current** semester, and live in that class. Anything else is the same 404 as a non-existent id.
- **封存 (archived) mapping:** both archive mechanisms hide items from assistants — (a) a non-current semester (`semester.is_current = false`, the read-only "已封存" semester that `_check_semester_writable` guards) and (b) "封存目前成績" snapshots (`grade_snapshot`): archiving moves the class's `classroom_item` rows into the snapshot, so the item is no longer live in the class. Assistants only ever read/write the live bucket (`grade.snapshot_id IS NULL`). If the teacher re-activates the same item later, the existing `item_assistant` row makes it visible again.
- Ownership never mixes ids: assistant writes use the **teacher's** id for `grade.user_id`, auto-award and semester checks; the student's JWT `sub` goes only into `entered_by_user_id` with `entered_by_role='assistant'`.

### `subject`

```
subject
├─ id                   uuid PK
├─ user_id              uuid
├─ name                 text           ← user-typed, e.g., "英文" / "Math"
├─ created_at           timestamptz
└─ UNIQUE (user_id, name)
```

User-defined; no presets. Each teacher's subjects are private.

### `category`

```
category
├─ id                   uuid PK
├─ user_id              uuid
├─ name                 text           ← display fallback for user-custom
├─ system_key           text NULL      ← set for the 7 system defaults; null for user-custom
├─ is_system_default    boolean
├─ created_at           timestamptz
└─ UNIQUE (user_id, name)
```

System defaults are seeded per user on signup. Frontend uses `system_key` to look up the localized label; for user-custom, displays `name` as-is.

| `system_key` | zh-TW | en |
|---|---|---|
| `first_midterm` | 第一次段考 | First Midterm |
| `second_midterm` | 第二次段考 | Second Midterm |
| `third_midterm` | 第三次段考 | Third Midterm |
| `midterm` | 期中考 | Midterm Exam |
| `final` | 期末考 | Final Exam |
| `major_exam` | 大考 | Major Exam |
| `quiz` | 小考 | Quiz |
| `homework` | 作業 | Homework |

In v1 the 8 keys above are the **only** categories — users cannot add custom ones (no `POST /api/categories`). Keep `SYSTEM_CATEGORY_KEYS` stable; adding a key requires updating both `models/curriculum.py` and the seed map in `routers/me.py`, and re-running `POST /api/me/seed` for existing users (idempotent — only inserts missing keys).

System defaults **cannot be deleted** — backend rejects `DELETE` on rows with `is_system_default = true`.

### `semester`

```
semester
├─ id                   uuid PK
├─ user_id              uuid
├─ academic_year        int            ← 民國年, e.g., 113
├─ term                 int + CHECK in (1, 2)   ← 1 = 上學期 / Term 1, 2 = 下學期 / Term 2
├─ is_current           boolean        ← exactly one row per user is true
├─ created_at           timestamptz
└─ UNIQUE (user_id, academic_year, term)
```

Display:
- zh-TW: `113 上學期` (term=1) / `113 下學期` (term=2)
- en: `113 Term 1` / `113 Term 2`

When PUT sets `is_current=true` on one row, backend automatically sets all other rows for that user to `false`.

### `item`

An item is one specific assessment (e.g., "the third midterm of English in 113 Term 1").

```
item
├─ id                   uuid PK
├─ user_id              uuid
├─ subject_id           uuid FK → subject
├─ category_id          uuid FK → category
├─ semester_id          uuid FK → semester
├─ name                 text           ← see notes below
├─ created_at, updated_at  timestamptz
└─ UNIQUE (user_id, subject_id, category_id, semester_id, name)
```

**`name` rules:**
- For 段考-type categories (the 5 system defaults that aren't `quiz` or `homework`), `name = ""`. The display label is the category name. UNIQUE then guarantees one such item per (subject, category, semester).
- For `quiz`, `homework`, and any user-custom category, `name` is required and must be non-empty. UNIQUE allows many items per (subject, category, semester) as long as names differ.

### `item_classroom` (many-to-many)

```
item_classroom
├─ item_id              uuid FK → item
├─ classroom_id             uuid FK → class
└─ PK (item_id, classroom_id)
```

One item can apply to multiple classes (e.g., "英文第三次段考 113上" given to 六甲 + 六乙).

### `grade`

```
grade
├─ id                   uuid PK
├─ user_id              uuid
├─ item_id              uuid FK → item
├─ student_id           uuid FK → student
├─ score                numeric(4,1)   ← 0.0 to 100.0, one decimal
├─ source               enum('manual','duotopia','google_classroom')
├─ source_external_id   text NULL      ← e.g., duotopia_student_assignment_id
├─ entered_by_user_id   uuid NULL      ← auth user who last wrote the score (#260)
├─ entered_by_role      varchar(16) DEFAULT 'teacher' + CHECK IN ('teacher','assistant')
├─ entered_at           timestamptz NULL DEFAULT now()  ← when the stamped writer last changed the score (#262)
├─ snapshot_id          uuid NULL FK → grade_snapshot CASCADE  ← NULL = live row (#169)
├─ created_at, updated_at  timestamptz
├─ UNIQUE (item_id, student_id, snapshot_id)            ← snapshot buckets
└─ UNIQUE (item_id, student_id) WHERE snapshot_id IS NULL ← uq_grade_live_item_student (#264)
```

**One live grade per cell (#264).** The three-column constraint can't protect
the live bucket (NULL snapshot ids are distinct), so concurrent saves used to
leave duplicate live rows that then broke every read of that cell (500). The
partial unique index fixes that; its migration first merged existing
duplicates (kept the most recently updated row; a removed duplicate's
point_record moves onto the kept row if it had none — not reversible on
downgrade). The migration holds `LOCK TABLE grade IN SHARE ROW EXCLUSIVE MODE`
for its whole transaction (reads still work, grade writes wait) so no new
duplicate can appear between the merge and the index build. All writers
(teacher single/bulk, Excel import, 小老師) insert new
live rows with `INSERT ... ON CONFLICT DO NOTHING` and then update whatever row
exists, applying their normal rules (`models.grading.insert_live_grades`).

**Deploy order (#264):** run `alembic upgrade head` on the target DB *before*
the new code goes live. The code's `ON CONFLICT` needs the partial unique index
and every grade write checks `grade_item_lock`; without the migration all
grade writes 500.

**"Entered by" stamp (#260).** `user_id` is the *owning* teacher; `entered_by_*` records who last *wrote* the score — the teacher, or a student assistant (小老師, #262). The stamp is refreshed only when the score actually changes (or the row is created), because bulk save and Excel import resend every row and re-saving an untouched assistant score must not relabel it as the teacher's. A teacher overwriting an assistant's score flips the stamp back to `teacher`. Rows that predate the column were backfilled with `entered_by_user_id = user_id`, `entered_by_role = 'teacher'`. The UI shows a small corner badge + tooltip (assistant name · `MM/DD HH:mm` from `entered_at`, falling back to `updated_at`) only for `assistant` rows. `entered_at` (#262) is set by `Grade.write_score` whenever the score changes; unlike `updated_at` it does not move on bookkeeping updates such as archiving into a snapshot. Pre-existing rows were backfilled from `updated_at`. The assistant's display name (`entered_by_name` in API responses) is resolved per response: the roster name of the owning teacher's student self-linked (`account_link`) to `entered_by_user_id`; it becomes unknown (badge says just 小老師) if the teacher later changes that student's email.

**Duotopia import upsert key:** `(user_id, item_id, student_id)` — same as the natural unique constraint. Re-importing the same item × student overwrites the prior row, including any local edits. By design.

### `grade_item_lock` (#264)

```
grade_item_lock
├─ id              uuid PK
├─ classroom_id    uuid FK → classroom CASCADE
├─ item_id         uuid FK → item CASCADE
├─ holder_user_id  uuid      ← holder's auth account (teacher or 小老師 sub); never returned to clients
├─ holder_role     varchar(16) CHECK IN ('teacher','assistant')
├─ holder_name     varchar(255) NULL  ← assistant roster name / teacher Google name
├─ expires_at      timestamptz        ← live while > now() (DB clock); heartbeat = now() + 90 s
├─ created_at, updated_at  timestamptz
└─ UNIQUE (classroom_id, item_id)
```

"Someone is editing this item for this class." Rules (`backend/item_lock.py`):
teacher first — a teacher can take over a 小老師's lock (after confirming in the
UI), a 小老師 can never take anyone's; between 小老師 first come first served.
Acquire is a conditional upsert that only lands when the row is free, expired
or already the caller's, so concurrent acquirers serialise on the unique row.
Every live-grade write checks the row with `SELECT ... FOR UPDATE` in its own
transaction: teachers are refused only when someone else holds a live lock,
小老師 must hold it. Rows are transient: a released lock is deleted, an expired
one is simply overwritten by the next acquirer. Snapshots are not locked.

### `student_standard`

```
student_standard
├─ id                   uuid PK
├─ user_id              uuid
├─ student_id           uuid FK → student
├─ category_id          uuid FK → category
├─ threshold            numeric(4,1)   ← score >= threshold counts as met
├─ created_at, updated_at  timestamptz
└─ UNIQUE (student_id, category_id)
```

**Carries across semesters.** No `semester_id`. Teacher manually adjusts threshold when needed (e.g., harder semester → higher bar).

### `point_rule`

```
point_rule
├─ id                   uuid PK
├─ user_id              uuid
├─ category_id          uuid FK → category
├─ points_awarded       int            ← given when student meets standard for this category
├─ created_at, updated_at  timestamptz
└─ UNIQUE (user_id, category_id)
```

If no rule exists for a category, default = 0 (no points awarded for that type).

### `point_record`

```
point_record
├─ id                   uuid PK
├─ user_id              uuid
├─ student_id           uuid FK → student
├─ points               int
├─ reason               text           ← e.g., "Met standard for 第三次段考"; ideally an i18n key + params
├─ source_grade_id      uuid FK → grade NULL
├─ created_at           timestamptz
└─ UNIQUE (source_grade_id)
```

Total points for a student = `SUM(points)` for that student. The UNIQUE on `source_grade_id` prevents double-counting from a single grade.

## Relationships at a glance

```
auth.users (Supabase)
  │
  ├── (as TEACHER, via user_id ownership) ── classroom, subject, category, semester, item, point_rule (1:N each)
  │
  └── (as STUDENT or PARENT, via account_link) ── student rows they can view

teacher's user_id  ──owns──►  classroom (1:N)
                                  └── student (1:N)
                                        ├── account_link (1:N)  ← student-self + parent links here
                                        ├── grade (1:N)
                                        ├── student_standard (1:N)
                                        └── point_record (1:N)

teacher's user_id  ──owns──►  subject, category, semester, point_rule

item (N:1) subject + (N:1) category + (N:1) semester + (M:N) classroom via item_classroom
grade (N:1) item + (N:1) student
student_standard (N:1) student + (N:1) category
point_rule (N:1) category
point_record (N:1) student + (N:1) grade (optional)
  └── point_record (1:N) ── student (N:1)
                       └── grade (N:1, optional)
```

## Behaviours

### Grade write triggers point award

Whenever a `grade` row is created or updated:

1. Find `student_standard.threshold` for `(student_id, category_id_of_item)`. If none, skip.
2. Find `point_rule.points_awarded` for `(user_id, category_id_of_item)`. If none or `0`, skip.
3. If `score >= threshold`:
   - Upsert a `point_record` keyed on `source_grade_id = grade.id`
   - `points = points_awarded`
   - `reason` = i18n key like `"point_record.met_standard"` with category and item params
4. If `score < threshold` and a `point_record` for this `source_grade_id` exists: delete it.

This logic runs synchronously inside the grade endpoint. Keeps point totals consistent without batch jobs.

### Grade delete

Cascades the related `point_record` (FK constraint).

### Cascade rules

| Delete | Cascades to | Blocked by |
|---|---|---|
| `class` | `student`s, their grades & point_records, `grade_item_lock` | — |
| `student` | grades, point_records, standards, account_link, class_assistant, item_assistant | — |
| `subject` | — | `item`s referencing it (return 409) |
| `category` (user-custom) | `student_standard`, `point_rule` | `item`s referencing it (return 409) |
| `category` (system default) | — | always blocked (return 403) |
| `semester` | — | `item`s referencing it (return 409) |
| `item` | grades, point_records via grades, item_classroom, item_assistant, grade_item_lock | — |

### Seeding on signup

When a new Supabase Auth user appears, the backend creates:

1. The 7 `category` rows with `is_system_default = true` and `system_key` set
2. One default `semester` based on current date:
   - Aug–Jan (inclusive): `(academic_year = current 民國 year, term = 上, is_current = true)`
   - Feb–Jul: `(academic_year = current 民國 year, term = 下, is_current = true)`
3. Nothing else — user populates everything else from the UI.

The seeding endpoint is idempotent (safe to call again; checks before inserting).

## Upsert keys summary

| Table | Upsert key | Trigger |
|---|---|---|
| `student` | `(user_id, classroom_id, seat_number)` | Excel re-import |
| `grade` | `(item_id, student_id)` | Duotopia re-import / direct entry |
| `point_record` | `(source_grade_id)` | Recomputed from grade |
| `student_standard` | `(student_id, category_id)` | Excel column / admin UI |
| `point_rule` | `(user_id, category_id)` | Admin UI |
| `semester.is_current` | only one true per `user_id` | Toggle in admin UI |

## Conventions

- All FK relationships use `ON DELETE` rules per the cascade table above.
- All `enum` types are Postgres `CHECK` constraints, not `CREATE TYPE` — keeps Alembic migrations simpler.
- Indexes: every FK gets an index (Postgres doesn't auto-index FKs).
- Charset: UTF-8 (default).
- Booleans use `NOT NULL DEFAULT false`.
