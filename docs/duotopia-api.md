# Duotopia API — Reference for the "Import from Duotopia" feature

> **Scope:** Grades is a frontend-only app backed by each user's Google Sheet. This doc is **only** relevant to the optional "Import from Duotopia" button — it lets a teacher who happens to use Duotopia pull existing assignment scores into their Grades Sheet. Teachers who don't use Duotopia ignore this entire flow.

Source of truth: the Duotopia backend itself (`C:\Users\mixca\duotopia\backend\`). Live Swagger UI: `http://localhost:8080/docs` (dev) or the deployed URL.

This doc captures what we need; re-check the source when something looks off.

## Auth

JWT bearer tokens. No refresh tokens — re-login on 401.

### Login

```
POST /api/auth/teacher/login
Content-Type: application/json

{ "email": "...", "password": "..." }
```

Response:
```json
{
  "access_token": "<jwt>",
  "token_type": "bearer",
  "user": {
    "id": 1, "email": "...", "name": "...",
    "role": "...", "organization_id": "...", "school_id": "..."
  }
}
```

- Algorithm: HS256, signed with `JWT_SECRET` env var on Duotopia side.
- Token lifetime: 24h (configurable; default in dev is 30 min).
- Rate limit: **3 login requests / minute / IP**.
- Source: `backend/auth.py:86-212`.

### Authenticated requests

Send the token on every request:

```
Authorization: Bearer <access_token>
```

Validation happens in `get_current_user` (FastAPI dependency) at `backend/auth.py:212-235`. Casbin RBAC enforces per-resource access — Grades doesn't need to re-implement permissions, just trust the 403/empty-list responses.

## Endpoints we use

| Purpose | Method + Path | Notes | Source |
|---|---|---|---|
| List classrooms current user can see | `GET /api/classrooms` | Optional query: `mode=personal\|school\|organization`, `school_id`, `organization_id`. Students eager-loaded. | `backend/routers/teachers/classroom_ops.py:29-100` |
| List students in a classroom | `GET /api/assignments/classrooms/{classroom_id}/students` | Returns `[{id, name, email, student_number, classroom_id}]`. Requires teacher ownership or org/school admin. | `backend/routers/.../crud.py:1051-1090` |
| List assignments in a classroom | `GET /api/assignments/?classroom_id={id}&is_archived=false` | Includes `created_at`, `due_date`, completion stats. **No server-side date filter** — see Gotchas. | `backend/routers/.../crud.py:489-655` |
| Get one assignment with all student scores | `GET /api/assignments/{assignment_id}` | Returns the assignment plus every student's `StudentAssignment` record. | `backend/routers/.../detail.py:107-280` |

## The score record (`StudentAssignment`)

This is what we import.

| Field | Type | Notes |
|---|---|---|
| `id` | int (PK) | **Stable upsert key — store as `duotopia_student_assignment_id` in Grades DB with UNIQUE.** |
| `assignment_id` | int (FK) | |
| `student_id` | int (FK) | |
| `score` | float, nullable | Final score; null if not graded. |
| `status` | enum | `NOT_STARTED → IN_PROGRESS → SUBMITTED → GRADED → RETURNED → RESUBMITTED` |
| `created_at` | datetime | When the StudentAssignment row was created. |
| `assigned_at` | datetime | When first assigned. |
| `submitted_at` | datetime | Nullable. |
| `graded_at` | datetime | Nullable. **Use this for "imported grades from date X to Y" filtering.** |
| `feedback` | text | Teacher's overall feedback. |

Schema: `backend/models/assignment.py:135-196`.

For granular per-item scores (accuracy / fluency / pronunciation / completeness, plus AI feedback and teacher review), see `StudentItemProgress` at `backend/models/progress.py:92-200`. Unique constraint `(student_assignment_id, content_item_id)` makes it upsert-safe.

## Gotchas

- **No server-side date-range filter on `/api/assignments/`.** Fetch all assignments for the classroom, then filter client-side by `graded_at` (or `created_at`) for the user's chosen date range. Fine for normal classroom sizes; revisit if any classroom has thousands of assignments.
- **Interim scores for IN_PROGRESS, auto-graded assignments are computed on-the-fly** in `detail.py:_compute_interim_score` and not persisted. If we import an IN_PROGRESS assignment we get the live interim score, not a saved one. Re-importing later may yield a different number.
- **`StudentContentProgress` is deprecated** — use `StudentItemProgress` for any granular score work. (`backend/models/progress.py:28-48`)
- **Email verification required for teacher login** — unverified accounts can't log in.
- **No CSRF, no refresh tokens.** Stateless JWT. Plan UI for re-login on 401.
- **Login rate limit is aggressive (3/min).** Don't retry login automatically on failure.
- **Casbin role sync at Duotopia startup can fail-loop** — if Duotopia is down or its DB is missing the right `TeacherOrganization` / `TeacherSchool` rows, classroom queries return empty / 403. This is a Duotopia-side data problem, not a Grades bug.

## CORS

Configured in `backend/main.py:71-109` from env vars (the `cors.json` file is unused at runtime).

- Dev / staging / preview: allow all origins.
- Production: hardcoded list of `duotopia.co`, `duotopia.net`, Cloud Run, Firebase domains.
- To add the Grades production origin: extend `CORS_ALLOWED_ORIGINS` env var on Duotopia, or add it to the production list in `main.py`.

In dev, no CORS work needed — Grades will be on `http://localhost:<some-port>` and Duotopia allows all.

## Quick recipe: the "import grades" flow

1. User clicks "Import from Duotopia" in the Grades UI. If they haven't yet authed against Duotopia in this session, prompt for Duotopia email + password, call `POST /api/auth/teacher/login`, keep the bearer token in memory (or sessionStorage — never localStorage; expires anyway in 24h).
2. User picks classroom + assignment + date range.
3. Grades frontend → `GET /api/assignments/{assignment_id}` with the Duotopia bearer token.
4. Filter the returned `StudentAssignment[]` by `graded_at` within the chosen range.
5. Write each filtered row into the `grades` tab of the user's Google Sheet, keyed on `duotopia_student_assignment_id`. Existing rows with the same key — including any local edits — get overwritten. By design.

The user is the owner of Duotopia (`myduotopia/duotopia`), so adding the Grades production origin to Duotopia's CORS allow-list is on us — see CORS section above.
