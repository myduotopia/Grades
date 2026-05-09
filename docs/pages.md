# Pages & navigation

The frontend is a SPA built with React Router. All routes require login except `/login` and `/auth/callback`.

## Route table

| Route | Name | Auth | Notes |
|---|---|---|---|
| `/login` | Login | public | Google sign-in (Supabase OAuth) |
| `/auth/callback` | OAuth callback | public | Handles Supabase redirect, then routes to `/classes` |
| `/` | Redirect | required | → `/classes` |
| `/classes` | My classes (landing) | required | List of classes; entry to import flows |
| `/classes/:id` | Class detail | required | Students list, batch import, grade overview |
| `/grades/new` | New grades | required | Pick item + class → enter scores |
| `/grades/:itemId/:classId` | Edit grades | required | Same UI, prefilled |
| `/students/:id` | Student detail | required | All grades, accumulated points, personal standards |
| `/admin` | Admin landing | required | Sub-nav to admin pages |
| `/admin/subjects` | Subjects | required | CRUD |
| `/admin/categories` | Categories | required | CRUD; system defaults shown but not deletable |
| `/admin/semesters` | Semesters | required | CRUD; toggle "is_current" |
| `/admin/items` | Items | required | CRUD; pick subject/category/semester/classes |
| `/admin/point-rules` | Point rules | required | Set N points per category |
| `/import/duotopia` | Duotopia import | required | Login to Duotopia → pick class/assignment/date range |
| `/import/classroom` | Classroom import | required | Phase 2 |
| `/settings` | Settings | required | Language switcher, integrations, sign out |

## Layout

```
┌──────────────────────────────────────────────┐
│ [Logo] [我的班級] [管理 ▾]   [學期 ▾] [👤 ▾] │  ← desktop top nav
├──────────────────────────────────────────────┤
│                                              │
│  page content                                │
│                                              │
└──────────────────────────────────────────────┘
```

On mobile (< 640 px), top nav collapses into a hamburger menu. Phase 3 (mobile app): consider a bottom tab bar for primary destinations (Classes / Admin / Settings).

The active semester selector lives in the top nav so users can switch context globally — most pages filter by it.

## Pages in detail

### `/login`

- Single button: "Sign in with Google" / 「用 Google 登入」
- Triggers Supabase `signInWithOAuth({ provider: 'google' })`
- After redirect, lands on `/auth/callback`, then routes to `/classes`
- No email/password fallback in v1

### `/auth/callback`

- Pure passthrough that completes the Supabase OAuth round-trip and redirects.
- On first-ever sign-in, calls a backend endpoint that seeds the user (7 default categories + 1 default semester) idempotently.

### `/classes` — landing

**Header:** "我的班級" / "My Classes"

**Empty state** (no classes yet) — three CTAs in priority order:
1. 「從 Google Classroom 匯入」 / "Import from Google Classroom" (visible only if Classroom is configured) — Phase 2
2. 「從 Duotopia 匯入」 / "Import from Duotopia"
3. 「手動新增班級」 / "Add class manually"

**Populated state:** grid of class cards. Each card: class name + student count. Top-right action: 「新增班級」.

**Quick stats on cards** (TBD — mentioned by user as a possible nice-to-have, defer until v0.1).

### `/classes/:id`

**Header:** class name + student count + edit/delete buttons.

**Tabs:**
- **學生** — table or card list of (seat number, name). Actions: 「批次匯入 Excel」, 「新增學生」 (single-row form).
- **成績總覽** — items applied to this class, grouped by semester. Each row: item name + scores summary (graded count / total).
- **點數** — per-student running totals for the current semester.

**Batch import flow:**
1. Click 「批次匯入 Excel」 → file picker
2. Backend parses → returns preview (parsed rows + any unknown class names)
3. If unknown classes → confirm dialog: 「這些班級不存在，要一併建嗎？」
4. Confirm → backend upserts on `(class_id, seat_number)`
5. Toast: "新增 N 筆，更新 M 筆"

### `/grades/new`

Three-step flow on one page:

1. **Pick item** — dropdown filtered to the current semester by default. Search by name. Show subject + category badge per option.
2. **Pick class** — only the classes this item applies to (from `item_class`). If item applies to one class, auto-select.
3. **Enter scores** — table with one row per student in the class:
   - Columns: 座號 / 姓名 / 分數 / (existing standard for context)
   - Score input: `<input type="number" inputmode="decimal" step="0.1" min="0" max="100">`
   - Auto-tab to next row on Enter

**Save:** bulk submit. On success, toast: "存了 N 筆。M 位達標，總共加 P 點。"

### `/grades/:itemId/:classId`

Same layout as `/grades/new`, but score fields are prefilled from existing grades. Editing a score may add/remove a `point_record` (backend recomputes per row).

### `/students/:id`

- **Header:** name, seat number, class
- **個人標準** section: table of (category, threshold). Editable inline.
- **成績歷史** section: table of (item, score, semester). Filterable by semester.
- **點數** section: total + recent `point_record` list (most recent N).

### Admin pages

All follow the same CRUD shape: list with add/edit/delete buttons + a side panel or modal for the form.

**`/admin/subjects`** — name only.

**`/admin/categories`** — name + (read-only) "system default" badge for the 7 seeded ones. Delete button hidden for system defaults.

**`/admin/semesters`** — list of (academic_year, term, is_current). Toggle `is_current` via radio. Adding a new semester picks year + term from selectors.

**`/admin/items`** — form: subject + category + semester + (conditional) name + class multi-select. The name field is hidden for 段考-type categories (auto-set to empty).

**`/admin/point-rules`** — list of categories with editable `points_awarded` int per row. No add/delete (rows mirror categories).

### `/import/duotopia`

1. **Connect** — if no Duotopia session in memory: form for Duotopia email + password → calls Duotopia's `POST /api/auth/teacher/login` → store bearer token in `sessionStorage` (not `localStorage` — expires anyway in 24h)
2. **Pick scope** — Duotopia classroom dropdown, assignment dropdown, date range picker (`graded_at` filter)
3. **Map to Grades** — pick which Grades subject/category/semester/class the import goes into
4. **Preview** — shows the rows that will be imported (and any students that don't match between Duotopia and Grades — let user map)
5. **Import** — frontend POSTs the data to Grades' `/api/import/duotopia`. Toast on completion: "匯入 N 筆，X 筆達標。"

See `docs/duotopia-api.md` for the Duotopia-side endpoints and gotchas (especially: no server-side date filter, so frontend filters by `graded_at` after fetching).

### `/import/classroom`

Phase 2. Stub the page with "敬請期待 / Coming soon" for now.

### `/settings`

- **Language** — `zh-TW` / `English` selector (saves to `localStorage`, applies via i18next)
- **Duotopia integration** — connection status (whether a session token is stored); 「重新登入 Duotopia」 / "Re-link" button
- **Google Classroom** — Phase 2
- **Sign out** — clears Supabase session

## Mobile considerations

Test every page at 375 px (iPhone SE) and 414 px (most modern phones).

- Tap targets ≥ 44×44 px (Apple HIG)
- No `:hover`-only interactions
- Forms: stack fields vertically on narrow screens; no multi-column layouts
- Tables (e.g., student list, grade entry) collapse to a card-style layout on narrow screens
- Score input: `<input type="number" inputmode="decimal">` brings up the right keyboard
- Long lists virtualize (TanStack Virtual) if > 50 rows

## i18n notes

- All static strings come from `frontend/src/locales/{zh-TW,en}/common.json`
- Hardcoded text in JSX is a bug — wrap in `t()`
- Date display: `Intl.DateTimeFormat` with current locale
- Number display: `Intl.NumberFormat`
- Semester label: `t('semester.format', { year: 113, term: 1 })` → `"113 上學期"` or `"113 Term 1"`
- System category label: `t(\`category.${system_key}\`)` → e.g., `"第三次段考"` or `"Third Midterm"`
- For user-generated names (class, student, subject, item, custom category), display `name` directly — never translate

## Empty / loading / error states

Every list page must handle:
- **Loading** — skeleton or spinner
- **Empty** — guidance + primary CTA to create first item
- **Error** — message + retry button (don't trap user)

Every form must handle:
- Field-level validation (required, range, format) before submit
- Submit error from server with actionable message
- Disabled submit while in flight to prevent double-submit
