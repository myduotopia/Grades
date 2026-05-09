# Grades

學生成績與點數記錄系統 — 老師管理班級、學生、成績、點數的 web app。

A web app for teachers to track students' grades and award points across classes, semesters, and assessment types. Each teacher's data is private; students and parents can optionally log in to view their own grades.

## Status

🚧 **Pre-alpha** — Phases 1–4 complete (scaffold + Auth + 12-table schema). Phase 5 (CRUD) in progress. See [roadmap](docs/roadmap.md).

## Documentation

- [Architecture](docs/architecture.md) — stack, deployment, mobile app plan, i18n
- [Data model](docs/data-model.md) — 12-table schema, constraints, behaviours
- [Pages](docs/pages.md) — frontend route table, layout, per-page detail
- [Page checklist](docs/page-checklist.md) — per-page standards (responsive, SEO, i18n, a11y, states)
- [API spec](docs/api-spec.md) — REST endpoints, request/response shapes
- [Roadmap](docs/roadmap.md) — milestones + GitHub issue list
- [Duotopia integration](docs/duotopia-api.md) — reference for the optional import feature

## Tech stack

- **Frontend**: React 19 + Vite 7 + TypeScript + Tailwind CSS 4 + react-i18next + react-router-dom
- **Backend**: Python 3.11+ + FastAPI + SQLAlchemy 2 + Alembic + python-jose
- **Database**: Supabase Postgres (Session pooler, port 5432)
- **Auth**: Supabase Auth + Google OAuth provider (ES256 JWTs)
- **Deploy**: Vercel (frontend) + Cloud Run (backend) — both planned, not yet live
- **Future mobile**: Capacitor (Phase 9)

## Local development

### Prerequisites

- Python 3.11+ (Windows users: install via python.org or `winget install python` so the `py` launcher is available)
- Node.js 18+
- A Supabase project with Google OAuth provider configured (see [architecture.md](docs/architecture.md))

### First-time setup

```powershell
# Backend
cd backend
py -m venv venv
.\venv\Scripts\Activate.ps1
pip install -r requirements.txt
copy .env.example .env       # then fill in Supabase secrets

# Frontend
cd ..\frontend
npm install
copy .env.example .env       # then fill in VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY
```

### Run

```powershell
# Terminal 1 — backend
cd backend
.\venv\Scripts\Activate.ps1
uvicorn main:app --reload --port 8000

# Terminal 2 — frontend
cd frontend
npm run dev                  # http://localhost:5000
```

Open <http://localhost:5000> → sign in with Google → land on dashboard.

### Database migrations

```powershell
cd backend
.\venv\Scripts\Activate.ps1

# Apply all pending migrations
alembic upgrade head

# Generate a new migration after model changes
alembic revision --autogenerate -m "your description"
```

## Repo structure

```
Grades/
├── backend/                # FastAPI + SQLAlchemy + Alembic
│   ├── alembic/            # DB migrations
│   ├── models/             # SQLAlchemy models (12 tables)
│   ├── auth.py             # JWT validation (Supabase ES256 + HS256)
│   ├── config.py           # env-driven settings (pydantic-settings)
│   ├── database.py         # SQLAlchemy engine + Session factory
│   ├── main.py             # FastAPI app entry
│   └── requirements.txt
├── frontend/               # Vite + React + TS + Tailwind
│   ├── src/
│   │   ├── auth/           # AuthProvider, ProtectedRoute
│   │   ├── i18n/           # i18next setup + zh-TW + en JSONs
│   │   ├── lib/            # supabase client + api wrapper
│   │   ├── pages/          # route components
│   │   ├── App.tsx         # router (React Router v7)
│   │   └── main.tsx
│   ├── package.json
│   └── vite.config.ts
└── docs/                   # see Documentation section above
```

## Branching

- **`main`** — production (currently just initial commit)
- **`staging`** — pre-merge integration; all feature work flows through here
- **`.worktrees/issue-N-slug/`** — feature branches per GitHub issue (one worktree per issue)

PRs target `staging`. After staging is stable, separate PR merges staging → main.

## Contributing / development workflow

1. Pick an open issue from the [roadmap](docs/roadmap.md)
2. Create a worktree off `staging`: `git worktree add .worktrees/issue-N-slug -b issue-N-slug staging`
3. Implement (backend first via `/docs` Swagger, then frontend)
4. Push branch, open PR into `staging`
5. After merge, remove the worktree: `git worktree remove .worktrees/issue-N-slug`
