# Deployment topology

Where each environment lives, which Supabase project it talks to, and where its secrets are configured. This file is the source of truth — if you change hosting or Supabase projects, update here.

## Environments

| Environment | Frontend URL | Backend URL | Supabase project | Supabase ref |
|---|---|---|---|---|
| Local dev | `http://localhost:5000` (Vite) | `http://localhost:8000` (uvicorn) | **Staging** (shared with Vercel Preview) | `nvufhrviaxblxlmiqive` |
| Vercel Preview (= staging) | `https://grades-frontend-git-staging-kaddyeunice.vercel.app` | `https://grades-backend-git-staging-kaddyeunice.vercel.app` | **Staging** | `nvufhrviaxblxlmiqive` |
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
| `VITE_API_BASE_URL` | ✅ (points to matching backend URL — **no trailing slash**) | — | — |
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
- Site URL: `https://grades-frontend-git-staging-kaddyeunice.vercel.app`
- Redirect URLs:
  - `https://grades-frontend-git-staging-kaddyeunice.vercel.app/**`
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

## Renaming or re-hosting — checklist

Vercel preview URLs embed the team owner and branch name (`grades-frontend-git-<branch>-<owner>.vercel.app`). Any time the **owner**, **project name**, or a long-lived **branch name** changes, the new hostname must be propagated to every place that hard-codes it. Missing one breaks deploy silently — usually as CORS errors or OAuth redirect-mismatch errors that only show up in the deployed environment.

When changing any of those, walk through this list:

1. **Frontend env var** — `grades-frontend` project, `VITE_API_BASE_URL` (Preview + Production scopes) → must point at the matching new backend hostname.
2. **Backend CORS** — `grades-backend` project, `CORS_ALLOWED_ORIGINS` (Preview + Production scopes) → must include the new frontend hostname. Comma-separated, `https://`, no trailing slash.
3. **Supabase Auth** — Site URL + Redirect URLs allow-list, **for each Supabase project** (Staging + Production are independent). Update both single-host entries and any `*` wildcard patterns.
4. **Google Cloud OAuth client** — Authorized redirect URIs must still cover `https://<supabase-ref>.supabase.co/auth/v1/callback`. This rarely changes (it's keyed by Supabase ref, not Vercel host) but worth confirming if the Supabase project itself moves.
5. **`docs/deployment.md`** — update the Environments table, the Supabase Auth URL block, and any other place hostnames appear. This file is the source of truth; if reality drifts from it, future debugging gets harder.
6. **Redeploy** — Vercel env var changes don't auto-trigger a redeploy. After updating env vars, redeploy the affected project (Deployments → latest → Redeploy) or push an empty commit.

Symptom-to-cause cheatsheet for failures during/after a rename:

| Symptom | First place to check |
|---|---|
| `404: NOT_FOUND` on a client-side route after login | Frontend SPA rewrite ([frontend/vercel.json](../frontend/vercel.json)) — unrelated to renames, but commonly noticed at the same time |
| `blocked by CORS policy` on `/api/*` | Backend `CORS_ALLOWED_ORIGINS` missing the new frontend hostname |
| OAuth returns to `localhost` or to a stale host | Supabase **Site URL** still points at the old hostname |
| OAuth returns `redirect_uri_mismatch` | Supabase **Redirect URLs** allow-list missing the new pattern |
| Frontend loads but every API call 404s | `VITE_API_BASE_URL` still points at the old backend hostname |
| `Redirect is not allowed for a preflight request` in browser console | `VITE_API_BASE_URL` has a trailing slash → produces `//api/...` → Vercel 308-redirects → preflight blocked. Strip the trailing slash and redeploy. |
