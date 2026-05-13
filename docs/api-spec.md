# API specification

The Grades FastAPI backend exposes a private REST API for the Grades frontend. All endpoints live under `/api`. HTTPS in all environments except local dev.

## Auth

### Flow

1. Frontend signs in via Supabase Auth: `supabase.auth.signInWithOAuth({ provider: 'google' })`.
2. Supabase returns a session containing an `access_token` (JWT) and a `refresh_token`.
3. Frontend includes `Authorization: Bearer <access_token>` on every request to `/api/...`.
4. Backend validates the JWT against Supabase's JWKs (public keys exposed at `<supabase-url>/auth/v1/keys`). See `backend/auth.py`.
5. After validation, backend extracts the Supabase user UUID from the `sub` claim and uses it as `user_id` for all subsequent queries.

The Grades backend never sees the user's password. Token validation is stateless — no session storage, no DB lookup per request.

### Token expiration

Supabase access tokens default to 1-hour TTL. The Supabase JS SDK automatically refreshes using the refresh token. Frontend doesn't need to handle refresh manually — just react to `onAuthStateChange` events.

If the backend receives an expired token, return `401 UNAUTHORIZED`. Frontend's Supabase client will trigger a refresh and retry transparently.

### Public endpoints

Only these don't require auth:
- `GET /health`
- `GET /api/version`

Everything else requires a valid bearer token.

## Conventions

### Base URL

All endpoints under `/api`. Example: `https://grades-backend.example.com/api/classrooms`.

### Response shape

**Single resource:** the object directly.
```json
{ "id": "uuid", "name": "六年甲班", ... }
```

**List:**
```json
{
  "data": [ { ... }, { ... } ],
  "meta": { "total": 42 }
}
```

Pagination params (`limit`, `offset`) added if and when needed — not in v1 since per-user data is small.

### Error format

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message_key": "errors.score_out_of_range",
    "message": "Score must be between 0 and 100",
    "details": { "field": "score", "value": "150" }
  }
}
```

`message_key` is the i18n key — frontend prefers it. `message` is the English fallback.

| Status | Code | Meaning |
|---|---|---|
| 400 | `VALIDATION_ERROR` | Bad request body / missing required field |
| 401 | `UNAUTHORIZED` | Missing or expired token |
| 403 | `FORBIDDEN` | Authenticated but not allowed (e.g., trying to delete a system-default category) |
| 404 | `NOT_FOUND` | Resource doesn't exist |
| 409 | `CONFLICT` | Duplicate / FK in use / unmet precondition |
| 429 | `RATE_LIMITED` | Too many requests |
| 500 | `SERVER_ERROR` | Unhandled exception |

### Date format

ISO 8601, UTC: `"2026-05-09T08:23:14Z"`. Frontend formats per locale.

### IDs

UUIDs, strings in JSON.

## Endpoints

### User

#### `GET /api/me`
Returns the user's identity and a setup status flag the frontend uses to decide what to render on landing.
```json
{
  "user": { "id": "uuid", "email": "..." },
  "setup": {
    "has_classes": true,
    "has_subjects": true,
    "has_current_semester": true
  }
}
```

#### `POST /api/me/seed`
Idempotent. Called by `/auth/callback` on first sign-in to create the 7 default categories and one default semester. Safe to call repeatedly — checks before inserting.

### Classrooms

> Renamed from `class` to `classroom` everywhere — `class` is a Python keyword and a SQL reserved word. See `docs/data-model.md`.

| Method | Path | Description |
|---|---|---|
| GET | `/api/classrooms` | List user's classrooms (`{data, meta:{total}}`) |
| POST | `/api/classrooms` | Create classroom (always `source='manual'` from this endpoint) |
| GET | `/api/classrooms/:id` | Classroom detail (includes `student_count`) |
| PUT | `/api/classrooms/:id` | Rename |
| DELETE | `/api/classrooms/:id` | Cascade-delete students, grades, point_records |

`POST /api/classrooms` body: `{ "name": "六年甲班" }`. Duplicate name for the same user → `409 CONFLICT` with `code: "CONFLICT"`, `message_key: "errors.classroom.duplicate_name"`.

`GET /api/classrooms/:id` response:
```json
{
  "id": "uuid",
  "name": "六年甲班",
  "source": "manual",
  "source_external_id": null,
  "student_count": 0,
  "created_at": "...",
  "updated_at": "..."
}
```

### Students

One Excel file maps to one classroom — the classroom is in the URL, never in
the file. The file carries both the roster (columns A–C) **and** zero or more
exam columns (columns D onward); a single import upserts students and writes
their grades in one pass. Re-importing is a pure upsert: matching seat numbers
overwrite, new seats append, missing seats are left untouched (no auto-delete).
Per-student standard thresholds are **not** in Excel — those are edited on the
website (single-student modal).

| Method | Path | Description |
|---|---|---|
| GET | `/api/classrooms/:id/students` | List students in a classroom |
| POST | `/api/classrooms/:id/students` | Create one student in the classroom |
| PUT | `/api/students/:id` | Update (incl. transfer via `classroom_id`) |
| DELETE | `/api/students/:id` | Cascade-delete grades, standards, point_records |
| POST | `/api/classrooms/:id/students/import` | Excel batch import (preview + commit) |
| GET | `/api/classrooms/:id/students/template.xlsx` | Download blank template |

#### Student payload (POST / PUT body)

```json
{
  "seat_number": 1,
  "name": "小明",
  "email": "ming@example.com",
  "standards": { "major_exam": 80, "quiz": 70 }
}
```

- `seat_number` required, 1–99
- `name`, `email` optional (null allowed)
- `standards` is an optional map of `{ category.system_key: threshold }`.
  Unknown keys are ignored; keys not in the payload are left untouched.
- PUT-only: include `classroom_id` to transfer the student to a different
  classroom (also owned by the current user).

#### `POST /api/classrooms/:id/students/import`

Two-phase: preview first, then confirm.

Multipart form:
- `file`: `.xlsx`

Query param:
- `dry_run`: `true` (default) returns preview only — nothing is written;
  `false` parses + commits in one transaction.

**Excel layout** — fixed structure, no headers in the score columns:

| Cell | Content | Notes |
|---|---|---|
| A1 | `座號` | literal header text (required) |
| B1 | `姓名（選填）` | informational |
| C1 | `email（選填）` | informational |
| D1, E1, ... | subject name | e.g. `國語`, `數學`. Built-in subject display names; `EN` aliases accepted. |
| D2, E2, ... | category | `段考` / `小考` / `作業` only (dropdown in template). 出席率 and 額外加分 are excluded — they have dedicated UIs. |
| D3, E3, ... | date | optional; YYYY-MM-DD, YYYYMMDD, or Excel date. Blank → today. |
| D4, E4, ... | exam name | optional; blank → `<類別>-<日期>` (e.g. `段考-2026-05-13`) |
| A5+ | seat number | integer 1–99, required per row |
| B5+ | name | optional |
| C5+ | email | optional |
| D5+, ... | score | 0–100; blank cells skipped |

Each score column resolves to an `Item` keyed on
`(user_id, subject_id, category_id, current_semester_id, exam_name)`.
Re-importing the same column metadata reuses the existing item and overwrites
that student's score. `Item` is linked to the URL's classroom via
`item_classroom`. Current semester comes from the user's `is_current=true`
`semester` row — if none is set, import returns `400` with
`errors.import.no_current_semester`.

Response:

```json
{
  "dry_run": true,
  "summary": {
    "student_total": 28, "student_create": 22, "student_update": 5,
    "item_total": 3, "item_create": 2, "item_reuse": 1,
    "grade_total": 84, "grade_create": 70, "grade_overwrite": 14,
    "errors": 1
  },
  "columns": [
    {
      "column_index": 3,
      "subject_input": "國語", "subject_system_key": "chinese",
      "category_input": "段考", "category_system_key": "major_exam",
      "exam_date": "2026-05-13",
      "exam_name": "期中考",
      "existing_item_id": null,
      "reuses_existing": false,
      "errors": []
    }
  ],
  "students": [
    {
      "row_number": 5,
      "action": "create",
      "seat_number": 1,
      "name": "小明",
      "email": null,
      "scores": { "3": 85 },
      "existing_id": null,
      "errors": []
    }
  ]
}
```

A `dry_run=false` request returns `400 BAD_REQUEST` (`errors.import.has_errors`)
if any column or student row has errors — fix the file and re-upload.

### Subjects

| Method | Path | Description |
|---|---|---|
| GET | `/api/subjects` | List |
| POST | `/api/subjects` | Create `{ name }` |
| PUT | `/api/subjects/:id` | Rename |
| DELETE | `/api/subjects/:id` | 409 if any item references it |

### Categories

| Method | Path | Description |
|---|---|---|
| GET | `/api/categories` | List (system + user-custom) |
| POST | `/api/categories` | Create custom `{ name }` |
| PUT | `/api/categories/:id` | Rename custom (system → 403) |
| DELETE | `/api/categories/:id` | Delete custom (system → 403; in-use → 409) |

### Semesters

| Method | Path | Description |
|---|---|---|
| GET | `/api/semesters` | List user's semesters |
| POST | `/api/semesters` | Create `{ academic_year, term }` |
| PUT | `/api/semesters/:id` | Update (typically toggle `is_current`) |
| DELETE | `/api/semesters/:id` | 409 if items reference it |

When PUT sets `is_current=true`, the backend automatically sets all other rows for this user to `false` in the same transaction.

### Items

| Method | Path | Description |
|---|---|---|
| GET | `/api/items?semester_id=&subject_id=&category_id=` | List, optionally filtered |
| POST | `/api/items` | Create |
| GET | `/api/items/:id` | Item detail (includes classroom list) |
| PUT | `/api/items/:id` | Update (incl. `classroom_ids`) |
| DELETE | `/api/items/:id` | Cascade-delete grades, point_records |

`POST /api/items` body:
```json
{
  "subject_id": "uuid",
  "category_id": "uuid",
  "semester_id": "uuid",
  "name": "L3 Quiz",   // empty string for 段考 categories
  "classroom_ids": ["uuid", "uuid"]
}
```

### Grades

| Method | Path | Description |
|---|---|---|
| GET | `/api/items/:id/grades?classroom_id=` | Grades for an item × classroom. Includes empty rows for ungraded students. |
| POST | `/api/grades/bulk` | Submit many grade entries at once |
| PUT | `/api/grades/:id` | Update single grade |
| DELETE | `/api/grades/:id` | Delete grade (and any point_record) |

`GET /api/items/:id/grades` response:
```json
{
  "data": [
    {
      "student": { "id": "uuid", "seat_number": 1, "name": "..." },
      "grade": { "id": "uuid", "score": 87.5, "updated_at": "..." } 
    },
    {
      "student": { "id": "uuid", "seat_number": 2, "name": "..." },
      "grade": null
    }
  ]
}
```

`POST /api/grades/bulk` body:
```json
{
  "item_id": "uuid",
  "entries": [
    { "student_id": "uuid", "score": 87.5 },
    { "student_id": "uuid", "score": 92 }
  ]
}
```

Response:
```json
{
  "saved": [{ "id": "uuid", "student_id": "uuid", "score": 87.5 }],
  "point_awards": [
    { "student_id": "uuid", "points": 5, "reason_key": "point_record.met_standard" }
  ]
}
```

Scores must be in `[0.0, 100.0]` with at most 1 decimal. Out-of-range or > 1 decimal → `VALIDATION_ERROR`.

### Standards (per student × category)

| Method | Path | Description |
|---|---|---|
| GET | `/api/students/:id/standards` | All standards for one student |
| PUT | `/api/students/:id/standards/:category_id` | Set / update threshold |
| DELETE | `/api/students/:id/standards/:category_id` | Remove standard |

PUT body: `{ "threshold": 80.0 }`

### Point rules

| Method | Path | Description |
|---|---|---|
| GET | `/api/point-rules` | List user's rules |
| PUT | `/api/point-rules/:category_id` | Set `points_awarded` for that category |

PUT body: `{ "points_awarded": 5 }`

### Points

| Method | Path | Description |
|---|---|---|
| GET | `/api/students/:id/points?semester_id=` | Total + history. `semester_id` filters by item's semester. |
| GET | `/api/classrooms/:id/points?semester_id=` | Per-student totals for the classroom |

### Imports

#### `POST /api/import/duotopia`

The frontend has already authenticated to Duotopia and fetched the relevant grade data. This endpoint just stores it.

Body:
```json
{
  "subject_id": "uuid",
  "category_id": "uuid",
  "semester_id": "uuid",
  "classroom_id": "uuid",
  "item_name": "Optional, for non-段考 categories",
  "entries": [
    {
      "duotopia_assignment_id": "...",
      "duotopia_student_id": "...",
      "duotopia_student_name": "...",
      "score": 87.5,
      "graded_at": "2026-04-15T10:00:00Z"
    }
  ]
}
```

Backend behaviour:
1. Find or create the matching `item` (by subject + category + semester + name). Set `item.source` if newly created.
2. For each entry, find the Grades student by `(classroom_id, source='duotopia', source_external_id=duotopia_student_id)`. If no match, return `409 CONFLICT` with the unmatched list — frontend asks user to map.
3. Upsert grades on `(item_id, student_id)`. Set `source='duotopia'`, `source_external_id=duotopia_assignment_id`.
4. Recompute point awards for each affected grade.

Response:
```json
{
  "imported": 28,
  "updated": 4,
  "point_awards_total": 12,
  "unmapped_students": []
}
```

(See `docs/duotopia-api.md` for the Duotopia-side reference.)

#### `POST /api/import/classroom`

Phase 2. Returns 501 in v1.

## Health & meta

| Method | Path | Description | Auth |
|---|---|---|---|
| GET | `/health` | 200 if backend + DB OK; for Cloud Run health checks | public |
| GET | `/api/version` | Returns `{ "version": "...", "commit": "..." }` | public |

## Rate limiting

The Grades backend has no rate limits in v1 (single-tenant per user). If usage grows, add per-user limits at the FastAPI middleware layer.

The Duotopia login endpoint has 3 requests/min/IP — the frontend's Duotopia integration must not retry login on failure.

## CORS

The Grades backend allows requests from the Grades frontend origin only (configured per-environment via env var). Tighter than Duotopia's permissive dev settings — we don't need to be reachable from anywhere else.
