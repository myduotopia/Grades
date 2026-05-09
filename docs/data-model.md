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
├─ name                 text           ← e.g., "六年甲班"
├─ source               text + CHECK in ('manual','duotopia','google_classroom')
├─ source_external_id   text NULL      ← original ID from import source
├─ created_at, updated_at  timestamptz
└─ UNIQUE (user_id, name)
```

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

**`email`** is optional. When present, it's the target of a Supabase Auth invitation (`auth.admin.inviteUserByEmail`) and the matching key for linking the student/parent to a Supabase auth user (see `account_link`).

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

**Linking flow:**
1. Teacher sets `student.email` (manually, via Excel, or auto-populated by Duotopia/Classroom import)
2. Backend calls `supabase.auth.admin.invite_user_by_email(email)` → Supabase sends magic link
3. Recipient clicks link → completes Supabase Auth flow → frontend gets a session
4. Frontend calls `POST /api/me/link` (TBD endpoint)
5. Backend matches `student WHERE email = current_user.email` → INSERT `account_link` rows

**Multiple parents per student:** `link_role='parent'` rows are unconstrained — mom + dad can both link to the same student. UI displays them as "Parent 1 / Parent 2" by `created_at` order.

**One auth user, multiple students:** A single auth user can link to many student rows (e.g., a parent with kids in different classes; a student with rows under multiple teachers). Look up via `WHERE auth_user_id = me`.

**`linked_via='invite_code'`** is reserved in the enum but not used in v1 — invite-code flow / table will be added later.

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
| `quiz` | 小考 | Quiz |
| `homework` | 作業 | Homework |

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
├─ created_at, updated_at  timestamptz
└─ UNIQUE (item_id, student_id)
```

**Duotopia import upsert key:** `(user_id, item_id, student_id)` — same as the natural unique constraint. Re-importing the same item × student overwrites the prior row, including any local edits. By design.

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
| `class` | `student`s, their grades & point_records | — |
| `student` | grades, point_records, standards | — |
| `subject` | — | `item`s referencing it (return 409) |
| `category` (user-custom) | `student_standard`, `point_rule` | `item`s referencing it (return 409) |
| `category` (system default) | — | always blocked (return 403) |
| `semester` | — | `item`s referencing it (return 409) |
| `item` | grades, point_records via grades, item_classroom | — |

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
