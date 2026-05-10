# Roadmap

A phased plan for building Grades to feature-completeness. Each item below maps to a [GitHub issue](https://github.com/myduotopia/Grades/issues).

## Status snapshot

✅ **Phases 1–4 done** — backend + frontend scaffolds, Supabase Auth happy path, 12-table schema deployed to Supabase.

🚧 **Phase 5 in progress** — CRUD work (this roadmap).

⏳ **Phase 6+** — deployment, mobile app, observability — separate plans.

## Workflow

Each issue = one worktree branch off `staging`:

1. Pick an issue from below
2. `git worktree add .worktrees/issue-N-slug -b issue-N-slug staging`
3. Implement (backend first via `/docs` Swagger, then frontend)
4. Push branch, open PR into `staging`
5. Merge → remove worktree

## Milestones

### M1 — Bootstrapping CRUD
After M1, a teacher can build a classroom roster end-to-end.

| Issue | Title | Size |
|---|---|---|
| [#1](../../issues/1) | Backend infrastructure + Classroom CRUD + landing page | L |
| [#2](../../issues/2) | Student CRUD (single entry) | M |
| [#3](../../issues/3) | Student Excel batch import | M |

### M2 — Admin metadata
Required before grade entry can happen. After M2, all the "containers" for grades exist.

| Issue | Title | Size |
|---|---|---|
| [#4](../../issues/4) | Subject CRUD | S |
| [#5](../../issues/5) | Semester CRUD + current-toggle | M |
| [#6](../../issues/6) | Category management | S |
| [#7](../../issues/7) | Point rule CRUD | S |
| [#8](../../issues/8) | Item CRUD with class M2M | M |

### M3 — The actual product
After M3, the app does its core job — teachers enter grades, system auto-awards points, dashboards summarize.

| Issue | Title | Size |
|---|---|---|
| [#9](../../issues/9) | Grade entry + bulk submit + auto-award | L |
| [#10](../../issues/10) | Per-student standard CRUD | S |
| [#11](../../issues/11) | Student detail page | M |
| [#12](../../issues/12) | Class point summary | S |

### M4 — Integrations + student access
Opens the app up beyond the single teacher: students/parents can see their own data; Duotopia teachers can pull existing data.

| Issue | Title | Size |
|---|---|---|
| [#13](../../issues/13) | Settings page polish | S |
| [#14](../../issues/14) | Student/parent invite + email auto-link | L |
| [#15](../../issues/15) | Student/parent dashboard | M |
| [#16](../../issues/16) | Duotopia import — see [duotopia-api.md](duotopia-api.md) | L |
| [#17](../../issues/17) | (Phase 2) Google Classroom import | L |

### Deployment
Independent of CRUD work. Can be done early to validate the Supabase Auth flow against a public URL.

| Issue | Title | Size |
|---|---|---|
| [#18](../../issues/18) | Frontend deployment to Vercel | S |

### Phase 8 — Marketing site + blog
After M3 + #18 stable. Built in a **separate repo** with Astro (markdown-based blog, SSG for SEO). Issues will be opened then. See [architecture.md](architecture.md) "Marketing site" section for the design.

Anticipated slices (not yet GitHub issues):

- Astro scaffold + design system (reuse Tailwind palette from app)
- Pillar pages: homepage, /features, /for-teachers
- Blog setup + first 3-5 cluster posts
- /privacy, /terms, /about (trust signals)
- Schema.org JSON-LD (Organization, SoftwareApplication, BlogPosting, FAQPage) per [page-checklist.md](page-checklist.md)
- sitemap.xml + robots.txt + Search Console verification
- Domain setup: `grades.com` (marketing) + `app.grades.com` (this repo)

## Size key

- **S** = ~1.5–2 hrs
- **M** = ~3–4 hrs
- **L** = ~5–7 hrs

## Patterns established in early issues

These conventions should be reused throughout the codebase. First introduced in Issue #1:

- **Backend per-resource router**: `backend/routers/<entity>.py` mounted in `main.py` (matches Duotopia's flat layout).
- **Pydantic schemas**: `backend/schemas.py` (single file fine for v1; split per entity if it grows past ~300 lines).
- **Permission dependency**: `require_user_id` returns the JWT user UUID; use as `Depends` on every user-scoped endpoint.
- **Frontend hook per resource**: `frontend/src/hooks/use<Entity>.ts` wrapping TanStack Query around the `api` module.
- **i18n discipline**: every new UI string goes through `t()`; add keys to both `zh-TW/common.json` and `en/common.json` in the same commit.
- **Idempotent seeding**: `/api/me/seed` called every login (Issue #1 implements; safe to call repeatedly because it checks before insert).

## Verification per issue

Each PR should include in its description:

1. Backend happy-path test via Swagger UI (`http://localhost:8000/docs`) — endpoints exercised
2. Frontend screenshot or recording of the new UI
3. Type-check passes: `cd frontend && npm run typecheck`
4. End-to-end sequence documented (e.g., "create class → see in list → edit → delete → recreate")
5. No regressions in existing flows (login + `/api/me`)

CI tests + automated deploy to staging — deferred until [#18](../../issues/18) ships.

## Out of scope for this roadmap

- Backend deployment to Cloud Run — separate plan, after CRUD has more meat to test
- Mobile app wrapping (Capacitor) — Phase 9
- Invite-code flow for student/parent linking — schema supports it via `account_link.linked_via='invite_code'`; deferred until Issue #14 reveals it's needed
- Production CI/CD workflows — separate plan when both staging and production environments exist
