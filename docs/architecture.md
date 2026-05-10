# Architecture

## Purpose

Grades is a web app for teachers to track students' grades and award points across classes, semesters, and assessment types. Each teacher's data is private to them; there is no cross-teacher aggregation by design. Optionally, students/classes/grades can be imported from Duotopia (and Google Classroom in Phase 2).

## Tech stack

| Layer | Technology | Why |
|---|---|---|
| Frontend | React 18 + Vite + TypeScript + Tailwind CSS | Matches Duotopia; fast dev loop; mobile-friendly out of the box |
| Server-state | TanStack Query | Standard for FastAPI consumers; handles caching/refetching |
| i18n | react-i18next | Required from day one (foreign teachers) |
| Backend | Python 3.11+ + FastAPI + Pydantic | Matches Duotopia; auto-generated OpenAPI; type-driven validation |
| ORM / migrations | SQLAlchemy 2.x + Alembic | Matches Duotopia |
| Database | Supabase Postgres (free tier) | Hosted; sufficient for solo / small-scale teacher use |
| Auth | Supabase Auth + Google OAuth provider | Avoids running our own identity system; supports Workspace 教育局 accounts |
| Backend deploy | Google Cloud Run | Matches Duotopia; serverless billing fits low traffic |
| CI/CD | GitHub Actions | Matches Duotopia |
| Mobile (Phase 3) | Capacitor (iOS + Android) | Wraps existing web app — no separate codebase |

The Grades Supabase project lives in a **new Supabase account, separate from Duotopia's**. Two free projects per account; we use one for Grades.

## Diagram

```
Browser (React + Vite + Tailwind, react-i18next)
   │
   ├──► [Supabase Auth] ─── Google OAuth ──► returns JWT
   │
   ├──► [Grades backend (FastAPI on Cloud Run)]
   │         │
   │         │  validates JWT against Supabase JWKs
   │         │
   │         └──► [Supabase Postgres]  (port 6543 pooler)
   │
   ├──► [Duotopia API]   (optional, "Import from Duotopia" button only)
   │
   └──► [Google Classroom API]  (Phase 2)
```

The frontend is the only client; the backend serves only the frontend (no public API). All cross-service access is over HTTP — no direct DB connections to other services.

## External integrations

### Duotopia
See `docs/duotopia-api.md` for the full reference. Used **only** by the manual "Import from Duotopia" button. User authenticates to Duotopia separately (in-app credential prompt); bearer token is held in memory for the session. Duotopia's DB is on a different Supabase account but is **never** read directly — only via HTTP API.

### Google Classroom (Phase 2)
Endpoints under `classroom.googleapis.com`. Uses Supabase Auth's Google OAuth with extra scopes: `classroom.courses.readonly`, `classroom.rosters.readonly`, `classroom.coursework.students.readonly`.

⚠️ **`classroom.rosters.readonly` is a Restricted scope.** Production-scale verification requires a paid annual CASA security assessment (thousands of USD/year). Plan: stay in OAuth test mode (≤100 testers) for the foreseeable future. Acceptable for personal + small-trial use.

## i18n

Required from day one — schools have foreign teachers (外師).

- Library: `react-i18next`
- Languages v1: `zh-TW`, `en`
- Translation files: `frontend/src/locales/zh-TW/common.json`, `frontend/src/locales/en/common.json`
- Default detection: `navigator.language`, fallback to `zh-TW`
- User language preference: stored in `localStorage` (no DB column in v1)
- **All UI strings must go through `t()` from day one.** Hardcoded text is a bug — retrofitting i18n later is painful.
- User-generated content (class/student/subject/item names, custom categories) is **not** translated — display as-is.
- System-seeded defaults (the 7 grade categories) are translated via `category.system_key` lookup.
- Semester display: zh-TW uses 上/下學期; en uses **Term 1 / Term 2** (not Fall/Spring — Taiwan academic calendar doesn't map cleanly). Year stays in 民國 format.

## Data ownership & privacy

- Each teacher's data is private to them.
- No cross-teacher aggregation, no principal dashboard.
- If a teacher wants to share, they share through normal means (export, screenshots) — outside the app.
- Backend enforces per-user scope on every query (no row-level security at the DB layer; backend is the only client).

## Deployment

### Environments

| Env | Frontend | Backend | DB |
|---|---|---|---|
| Local | `npm run dev` (port 5000 — Vite default 5173 is taken by Duotopia) | `uvicorn` (port 8000 — 8080 is taken by Duotopia) | Local Supabase project (free tier) |
| Staging | TBD (Firebase Hosting / Vercel / Cloud Storage) | Cloud Run staging service | Same Supabase, separate project or schema |
| Production | TBD | Cloud Run prod service | Supabase production project |

### CI/CD (GitHub Actions)

- On PR: lint + typecheck + test for both frontend and backend
- On merge to `staging` branch: deploy to staging Cloud Run
- On merge to `main`: deploy to production

### Database connection

Use Supabase's **Session pooler (port 5432, IPv4)** for the FastAPI backend. Avoid:
- **Direct connection** — no pooling; Cloud Run's many short-lived instances exhaust Postgres connections fast.
- **Transaction pooler** — IPv6-only by default; Cloud Run egress is effectively IPv4, so this fails to connect without paying for the IPv4 add-on (~$4/month).

Session pooler gives us pooled IPv4 access for free, with no functional difference for our small-scale CRUD workload.

## Mobile app (Phase 3)

After the web app is stable, package via **Capacitor** for iOS + Android.

### Order
1. Web app reaches mobile-browser parity with desktop (responsive, touch-friendly)
2. Add Capacitor — wraps the built web app in a native shell
3. Add 1–2 native plugins to clear Apple's "minimum functionality" rule (e.g., haptics, share sheet, push notifications)
4. Submit to Google Play (Android) and App Store (iOS)

### Implications during web dev (now)
- SPA routing only (React Router) — no full-page reloads
- Mobile-first responsive design
- Tap targets ≥ 44×44 px; no `:hover`-only interactions
- Avoid desktop-only browser APIs (or have fallbacks)
- Auth (Google OAuth) redirect flow needs special handling when wrapping — Capacitor's Browser plugin + deep linking. Note this when implementing auth.

### Costs (when shipping, not now)
- Apple Developer: $99 USD/year (mandatory)
- Google Play Developer: $25 USD one-time
- iOS builds need a Mac (or cloud build: EAS Build / Codemagic / GitHub Actions macOS runners)

## Marketing site (Phase 8 — separate codebase)

The app itself is auth-gated and `noindex`'d, so it can't compete in search. To acquire users via Google, a **separate marketing site** will be built later, served from a different surface than the app.

### Surface separation

```
grades.com           — Marketing site (separate repo, Astro, fully public)
                       Homepage, features, blog, docs, pricing, privacy, terms
app.grades.com       — App (this repo, Vite SPA, fully auth-gated)
                       Classes, students, grades, etc.
```

Both deploy independently. Marketing changes don't risk breaking the app and vice versa. SEO authority concentrates on `grades.com`; the app subdomain stays unindexed.

### Stack: Astro + markdown

[Astro](https://astro.build) chosen over Next.js / WordPress / Ghost for the marketing site:

| Why Astro | |
|---|---|
| Lighthouse 100/100/100/100 by default | Critical for SEO — Core Web Vitals are a ranking factor |
| Markdown-first content (no CMS) | Each blog post = one `.md` file in repo. Author writes in VS Code, pushes, deploys |
| Zero-runtime JavaScript by default | Pages are pure HTML, scripts only where interactivity needed |
| React components work inside Astro | Can reuse Tailwind components from the app's component library |
| Static deploy → near-zero hosting cost | Vercel / Netlify / Cloudflare Pages free tier |

### Content strategy: Cluster content for SEO

Standard pattern for ranking on broad topics:

- **Pillar pages** (1 per major topic) — long-form (1500–3000 words) that comprehensively covers a topic
- **Cluster pages** (5–15 per pillar) — narrower posts, all linking back to the pillar and to each other
- Topic example: pillar = "老師如何高效記錄學生成績"; clusters = "5 種 Excel 成績表範本", "段考小考評分權重設計", "點數獎勵制度怎麼運作", etc.

This gives Google strong topical-authority signals.

### URL structure

```
grades.com/                    Homepage
grades.com/features            Features overview
grades.com/for-teachers        Use-case landing
grades.com/pricing             Pricing (when applicable)
grades.com/about               About / vision
grades.com/blog                Blog index
grades.com/blog/{slug}         Individual posts
grades.com/docs                Public docs
grades.com/privacy             Privacy policy (trust signal + SEO)
grades.com/terms               Terms of service

app.grades.com/                The app (everything in this repo)
```

### When (Phase 8)

After Phase 5 (CRUD) and Phase 6 (grade entry + product polish) are stable, with at least one Phase 7 (deploy) cycle proving the architecture works. Marketing without a real product to point at is wasted effort. See [roadmap.md](roadmap.md) for the planned issue list.

## Build phases

1. **Scaffold** — frontend + backend repos, Supabase project, first Alembic migration, basic dev loop
2. **Auth** — Supabase Auth login flow, JWT validation in FastAPI, signup-time seeding (7 default categories + 1 default semester)
3. **Manual CRUD** — class, student (incl. Excel batch import), subject, category, semester, item, point rule
4. **Grade entry + point award** — `/grades/new` flow, automatic point computation
5. **Duotopia import** — see `docs/duotopia-api.md`
6. **(Phase 2) Google Classroom import**
7. **Frontend deploy to Vercel** — public URL for testing
8. **Marketing site + blog (Astro)** — separate repo, content for SEO; see "Marketing site" section above
9. **(Phase 3) Capacitor wrap** + store submissions

## Related docs

- `docs/data-model.md` — full DB schema, constraints, seeding, behaviours
- `docs/pages.md` — frontend pages, routing, layout, mobile considerations
- `docs/api-spec.md` — REST endpoints, request/response shapes, error format
- `docs/duotopia-api.md` — Duotopia API reference (for the import feature)
