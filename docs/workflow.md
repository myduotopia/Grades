# Development workflow

End-to-end process for working on a GitHub issue. Same flow every time, no exceptions. **Read this at the start of any session that involves implementing an issue.**

## TL;DR

```
issue → worktree → backend → frontend → verify → commit → push → PR → merge → cleanup
```

---

## 1. Pick an issue

Open <https://github.com/myduotopia/Grades/issues>, pick one. Roadmap order is in [roadmap.md](roadmap.md) — usually the lowest-numbered open issue in the current milestone.

Confirm with the user before starting; don't grab an issue and run.

## 2. Sync staging + create worktree

```powershell
cd C:\Users\mixca\Grades
git checkout staging
git pull origin staging
git worktree add .worktree/N -b claude/issue-N staging
cd .worktree/N
```

- `N` = issue number — used both as the worktree directory name (`.worktree/1`, `.worktree/2`, ...) and inside the branch name
- Branch name is **always** `claude/issue-<N>` — no slug. The `claude/` prefix marks branches authored by Claude Code; PR titles carry the human-readable description.
- Full example: worktree at `.worktree/1`, branch `claude/issue-1`

A worktree is a separate working directory sharing one `.git`. You can have many worktrees concurrently for different issues. Branch lives **inside** the worktree.

## 3. Set up the worktree's deps (if needed)

Worktree files are independent of the main checkout. If `requirements.txt` or `package.json` differs between the worktree and main, install separately:

```powershell
# Backend
cd backend
py -m venv venv
.\venv\Scripts\Activate.ps1
pip install -r requirements.txt

# Frontend
cd ..\frontend
npm install
```

For most issues you can skip this — just run dev servers from the main `Grades/` checkout against the same Supabase, and edit code in the worktree. The worktree is for git isolation, not necessarily runtime isolation.

### Running dev servers from inside the worktree

If you want to *see* your branch's changes locally (without merging into staging first), you must start the dev servers from the worktree directory itself. Two pieces don't carry across automatically because they're git-ignored:

```powershell
# .env files — copy from main checkout (one-time per worktree; re-copy if values change)
cp ..\..\backend\.env .\backend\.env
cp ..\..\frontend\.env .\frontend\.env

# frontend/node_modules — link to main checkout's install instead of re-installing
cmd /c "mklink /J .\frontend\node_modules ..\..\frontend\node_modules"
```

Then start the servers from inside the worktree as usual (`uvicorn main:app --reload --port 8000` and `npm run dev`).

## 4. Implement

**Order within an issue**: backend first, then frontend.

Backend first because:
- Testable via Swagger UI at <http://localhost:8000/docs> without any frontend
- Frontend wires to real responses (avoids "wired to mocks then doesn't fit" rework)
- Establishes API contract early

**Patterns to follow** (established in Issue #1, see [roadmap.md](roadmap.md) "Patterns" section):
- Backend per-resource router: `backend/routers/<entity>.py`, mounted in `main.py`
- Pydantic schemas: `backend/schemas.py` (split per entity if it grows past ~300 lines)
- Permission dep: `require_user_id` from `backend/auth.py`
- Frontend hook per resource: `frontend/src/hooks/use<Entity>.ts` wrapping TanStack Query
- API access: extend `frontend/src/lib/api.ts`'s `api` object
- i18n discipline: every UI string via `t()`; new keys added to **both** `frontend/src/i18n/locales/zh-TW/common.json` AND `en/common.json`

**Before any frontend page work**, read [page-checklist.md](page-checklist.md) §Visual design rules and use the layout primitives in `frontend/src/layout/` (`PageContainer`, `PageHeader`, `AppShell`) and `frontend/src/components/ActionCard`. Do not hand-roll page chrome, h1 sizes, container widths, or accent colors — the rules already exist; follow them.

**Every new page must satisfy** [page-checklist.md](page-checklist.md).

## 5. Verify

```powershell
# Terminal 1 — backend
cd backend
.\venv\Scripts\Activate.ps1
uvicorn main:app --reload --port 8000
```

Open <http://localhost:8000/docs> → exercise the new endpoints. Confirm 200 / 401 / 404 / etc. return correctly.

```powershell
# Terminal 2 — frontend
cd frontend
npm run typecheck      # must pass — no TS errors
npm run dev            # → http://localhost:5000
```

Open <http://localhost:5000> → click through the new UI. Run the user-flow described in the issue's **Acceptance** section.

Verify against [page-checklist.md](page-checklist.md):
- Responsive at 375 / 768 / 1280 px (Chrome DevTools device toolbar)
- All strings via `t()`
- Empty / loading / error states present

## 6. Commit

Use [Conventional Commits](https://www.conventionalcommits.org/):

```powershell
git add <files>     # not `git add .` — explicit list to avoid leaks
git commit -m "feat(scope): short imperative subject

Longer description explaining WHY (not just what).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

Common types: `feat`, `fix`, `chore`, `docs`, `refactor`, `test`, `style`.
Common scopes: `backend`, `frontend`, `db`, `auth`, `i18n`.

Multiple commits per PR is fine — split logically (e.g., one commit for backend, one for frontend, one for migration).

## 7. Push the branch

```powershell
git push -u origin claude/issue-N
```

The `-u` sets upstream tracking so subsequent `git push` works without args.

## 8. Open PR into staging

```powershell
gh pr create --repo myduotopia/Grades \
  --base staging \
  --head claude/issue-N \
  --title "[#N] short title" \
  --body "..."
```

PR body must include:

```markdown
Closes #N

## Verification
- [ ] Backend endpoints exercised via Swagger:
      - `POST /api/foo` → 200 with expected body
      - `GET /api/foo/:id` → 200 / 404
- [ ] Frontend screenshot: <attach or paste image link>
- [ ] `npm run typecheck` passes
- [ ] Page-checklist items satisfied (responsive, i18n, a11y, states)

## End-to-end flow tested
1. ...
2. ...
```

## 8a. Per-issue preview environment

Every push to a PR branch triggers Vercel to deploy **two** preview deployments — one frontend, one backend — with predictable URLs:

- Frontend: `https://grades-frontend-git-claude-issue-N-kaddyeunice.vercel.app`
- Backend:  `https://grades-backend-git-claude-issue-N-kaddyeunice.vercel.app`

The frontend preview is wired (via [vite.config.ts](../frontend/vite.config.ts)) to call **its own branch's backend**, not staging's. Use these URLs to verify the PR end-to-end in a real deployed environment before merge.

**DB caveat:** previews share the **staging** Supabase project. Multiple open PRs see each other's data — use scratch accounts / clearly-prefixed data to avoid stepping on parallel previews.

**Migration caveat:** previews do **not** run `alembic upgrade`. A PR whose code depends on a new schema cannot be fully tested on its own preview — the shared staging DB hasn't been migrated yet. For such PRs:

1. Merge the PR to `staging` first.
2. Manually run the migration against staging Supabase.
3. Re-deploy any other open preview branches that depend on the new schema.

In other words: **schema-changing PRs are tested on staging, not on their own preview.** Plain code-change PRs are tested on their preview.

## 9. Wait for review

User reviews + merges. Don't auto-merge — even if the user gave general approval, get explicit go-ahead per PR.

## 10. After merge: cleanup

```powershell
cd C:\Users\mixca\Grades
git checkout staging
git pull origin staging
git worktree remove .worktree/N
git branch -D claude/issue-N
```

The branch on `origin` is auto-deleted by GitHub if "automatically delete head branches" is on. If not, also: `git push origin --delete claude/issue-N`.

---

## Don'ts (unless user explicitly says otherwise)

- **Don't commit directly to `staging` or `main`** (exception below)
- **Don't push without user confirmation** for the first push of any branch
- **Don't `git push --force`** to `staging` or `main` ever
- **Don't skip pre-commit hooks** (`--no-verify`)
- **Don't `git add .`** — list specific files / dirs to avoid accidentally staging secrets or junk
- **Don't open PRs that don't `Closes #N`** — every change must trace to an issue
- **Don't merge your own PRs** — user reviews

## Exception: trivial docs-only changes

For typo fixes, broken-link patches, or README touch-ups that don't touch any code, you may commit directly to `staging` (no worktree, no PR). Anything more substantial (new doc file, restructure, schema doc updates) goes through the regular worktree → PR flow.

---

## Quick reference

| Action | Command |
|---|---|
| Sync staging | `git checkout staging && git pull` |
| New worktree | `git worktree add .worktree/N -b claude/issue-N staging` |
| List worktrees | `git worktree list` |
| Remove worktree | `git worktree remove .worktree/N` |
| Open PR | `gh pr create --base staging --head <branch>` |
| Check PR status | `gh pr view --web` |
