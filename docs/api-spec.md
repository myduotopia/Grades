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

All endpoints under `/api`. Example: `https://grades-backend.example.com/api/classes`.

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

### Classes

| Method | Path | Description |
|---|---|---|
| GET | `/api/classes` | List user's classes |
| POST | `/api/classes` | Create class |
| GET | `/api/classes/:id` | Class detail (includes student count) |
| PUT | `/api/classes/:id` | Rename |
| DELETE | `/api/classes/:id` | Cascade-delete students, grades, point_records |

`POST /api/classes` body: `{ "name": "六年甲班" }`

### Students

| Method | Path | Description |
|---|---|---|
| GET | `/api/classes/:id/students` | Students in a class |
| POST | `/api/students` | Create one student |
| PUT | `/api/students/:id` | Update (incl. transfer via `class_id`) |
| DELETE | `/api/students/:id` | Cascade-delete grades, standards, point_records |
| POST | `/api/students/import` | Excel batch import |

#### `POST /api/students/import`

Multipart form:
- `file`: `.xlsx` file
- `auto_create_classes`: `"true"` / `"false"` (default `false`)

Excel columns expected (header row required):
- 班級 / `class`
- 座號 / `seat_number`
- 姓名 / `name`
- (optional) `<category_name>_標準` columns, e.g., `段考_標準`, `小考_標準`

Response:
```json
{
  "created": 12,
  "updated": 8,
  "missing_classes": ["六年丙班", "六年丁班"],
  "errors": [{ "row": 5, "message_key": "import.bad_score", "details": {...} }]
}
```

If `missing_classes` is non-empty and `auto_create_classes=false`, returns `409 CONFLICT`. Frontend shows confirm dialog, re-submits with `auto_create_classes=true`.

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
| GET | `/api/items/:id` | Item detail (includes class list) |
| PUT | `/api/items/:id` | Update (incl. `class_ids`) |
| DELETE | `/api/items/:id` | Cascade-delete grades, point_records |

`POST /api/items` body:
```json
{
  "subject_id": "uuid",
  "category_id": "uuid",
  "semester_id": "uuid",
  "name": "L3 Quiz",   // empty string for 段考 categories
  "class_ids": ["uuid", "uuid"]
}
```

### Grades

| Method | Path | Description |
|---|---|---|
| GET | `/api/items/:id/grades?class_id=` | Grades for an item × class. Includes empty rows for ungraded students. |
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
| GET | `/api/classes/:id/points?semester_id=` | Per-student totals for the class |

### Imports

#### `POST /api/import/duotopia`

The frontend has already authenticated to Duotopia and fetched the relevant grade data. This endpoint just stores it.

Body:
```json
{
  "subject_id": "uuid",
  "category_id": "uuid",
  "semester_id": "uuid",
  "class_id": "uuid",
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
2. For each entry, find the Grades student by `(class_id, source='duotopia', source_external_id=duotopia_student_id)`. If no match, return `409 CONFLICT` with the unmatched list — frontend asks user to map.
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
