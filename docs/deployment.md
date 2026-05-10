# Deployment topology

Where each environment lives, which Supabase project it talks to, and where its secrets are configured. This file is the source of truth — if you change hosting or Supabase projects, update here.

## Environments

| Environment | Frontend URL | Backend URL | Supabase project | Supabase ref |
|---|---|---|---|---|
| Local dev | `http://localhost:5000` (Vite) | `http://localhost:8000` (uvicorn) | **Staging** (shared with Vercel Preview) | `nvufhrviaxblxlmiqive` |
| Vercel Preview (= staging) | `https://grades-git-staging-kaddyeunice.vercel.app` | `https://grades-backend-git-staging-kaddyeunice.vercel.app` | **Staging** | `nvufhrviaxblxlmiqive` |
| Vercel Production | `https://grades-rho.vercel.app` | `https://grades-backend.vercel.app` (also aliased as `grades-backend-kaddyeunice.vercel.app`) | **Production** | `wtwpwmizwzlkbqfctbir` |

> Vercel team owner is `kaddyeunice` (renamed from `kaddt`). Branch/preview URLs include the owner suffix; custom production aliases (`grades-rho`, `grades-backend`) do not.

**Rule:** local dev points at Staging, never Production. Production Supabase is only touched by Vercel Production deployments and the `migrate` GitHub Action.

## Vercel projects

Two separate Vercel projects, both deploying from the same GitHub repo:

- **`grades-frontend`** — root: `frontend/`, builds with Vite, output served as static.
- **`grades-backend`** — root: `backend/`, FastAPI on Vercel's Python runtime.

Each project has its own Environment Variables panel (Settings → Environment Variables). Set values **per environment** (Production / Preview / Development) so a single project serves both staging and production correctly.

## Where each secret lives

| Variable | grades-frontend | grades-backend | GitHub Actions |
|---|---|---|---|
| `VITE_SUPABASE_URL` | ✅ (Production = W, Preview = N) | — | — |
| `VITE_SUPABASE_ANON_KEY` | ✅ | — | — |
| `VITE_API_BASE_URL` | ✅ (points to matching backend URL) | — | — |
| `DATABASE_URL` (Session pooler) | — | ✅ | — |
| `SUPABASE_URL` | — | ✅ | ✅ |
| `SUPABASE_SERVICE_ROLE_KEY` | — | ✅ | ✅ |
| `SUPABASE_JWT_SECRET` | — | ✅ | ✅ |
| `DATABASE_URL_DIRECT` (Session pooler — see [migrate.yml](../.github/workflows/migrate.yml)) | — | — | ✅ |
| `CORS_ALLOWED_ORIGINS` | — | ✅ (Production = `https://grades-rho.vercel.app`) | — |

GitHub Actions secrets are **production-only** — the `migrate` workflow runs on push to `main` and applies migrations to Production Supabase. Staging migrations are run manually for now (see [workflow.md](workflow.md)).

## Supabase Auth URL configuration

Each Supabase project has its own allow-list. Both must be set; they don't share state.

**Production project (`wtwpwmizwzlkbqfctbir`):**
- Site URL: `https://grades-rho.vercel.app`
- Redirect URLs: `https://grades-rho.vercel.app/**`

**Staging project (`nvufhrviaxblxlmiqive`):**
- Site URL: `https://grades-git-staging-kaddyeunice.vercel.app`
- Redirect URLs:
  - `https://grades-git-staging-kaddyeunice.vercel.app/**`
  - `https://grades-*-kaddyeunice.vercel.app/**` (other preview branches)
  - `http://localhost:5000/**`

If a deployed login redirects to the wrong host (classic symptom: production redirects to `localhost:3000`), the cause is almost always Vercel env vars pointing to the wrong Supabase project, not a Google OAuth misconfiguration. Decode the JWT in the redirect URL — `iss` reveals which Supabase actually issued it.

## Connection types — which to use where

Supabase exposes three connection modes; alembic + FastAPI need different ones:

| Mode | Host pattern | IPv4? | Use for |
|---|---|---|---|
| Direct | `db.<ref>.supabase.co:5432` | ❌ IPv6-only | Nothing in this project — GH Actions and Vercel are IPv4-only |
| Session pooler | `aws-1-*.pooler.supabase.com:5432` | ✅ | **alembic in CI** + **local dev**. Long-lived script-style connections; supports the session-scoped state alembic needs for DDL. |
| Transaction pooler | `aws-1-*.pooler.supabase.com:6543` | ✅ | **FastAPI on Vercel**. Vercel opens a new connection per request — Transaction pooler keeps Postgres from running out of slots. Don't use for alembic — breaks DDL. |
