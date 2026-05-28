import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Link,
  useNavigate,
  useParams,
  useSearchParams,
} from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { ArchivedSemesterBanner } from '../components/ArchivedSemesterBanner'
import { StandardsMatrix } from '../components/StandardsMatrix'
import { PageContainer } from '../layout/PageContainer'
import { PageHeader } from '../layout/PageHeader'
import { useSemesterView } from '../state/SemesterView'
import {
  api,
  ApiError,
  type GradeBulkEntry,
  SYSTEM_SUBJECT_KEYS,
} from '../lib/api'
import { classroomDisplayName } from '../lib/classroomFormat'
import {
  buildMatrix,
  formatScore,
  subjectsInView,
} from '../lib/gradeMath'

type View = 'by-student' | 'by-subject' | 'standards'
const VIEW_KEY = 'grades.view'

// Issue #159: category sort priority + background tint for the by-subject
// column header / cells. Categories not listed fall to the end with no tint.
const CATEGORY_ORDER: readonly string[] = [
  'major_exam',
  'quiz',
  'homework',
  'attendance',
  'extra',
]
const CATEGORY_HEADER_BG: Record<string, string> = {
  major_exam: 'bg-amber-50',
  quiz: 'bg-sky-50',
}
const CATEGORY_CELL_BG: Record<string, string> = {
  major_exam: 'bg-amber-50/40',
  quiz: 'bg-sky-50/40',
}

function orderItemsForBySubject<
  T extends { category_system_key: string; activated_at?: string | null; name: string },
>(items: T[]): T[] {
  return [...items].sort((a, b) => {
    const ai = CATEGORY_ORDER.indexOf(a.category_system_key)
    const bi = CATEGORY_ORDER.indexOf(b.category_system_key)
    const aRank = ai === -1 ? CATEGORY_ORDER.length : ai
    const bRank = bi === -1 ? CATEGORY_ORDER.length : bi
    if (aRank !== bRank) return aRank - bRank
    // Within a category: newest activation first; nulls go last.
    const at = a.activated_at ?? ''
    const bt = b.activated_at ?? ''
    if (at !== bt) return bt.localeCompare(at)
    return a.name.localeCompare(b.name)
  })
}

/** Parse a raw input/clipboard value into a DB-storable score.
 *  Rounds to 1 decimal (DB column is Numeric(4, 1)) and clamps to [0, 100].
 *  Returns null for blank / non-numeric — equivalent to "clear this cell". */
function normaliseScore(raw: string): number | null {
  const trimmed = raw.trim()
  if (trimmed === '') return null
  const n = Number(trimmed)
  if (!Number.isFinite(n)) return null
  const rounded = Math.round(n * 10) / 10
  return Math.max(0, Math.min(100, rounded))
}

const SECONDARY_BTN =
  'inline-flex items-center px-4 py-2 rounded-lg bg-white border border-slate-200 hover:border-slate-300 hover:bg-slate-50 text-slate-700 text-sm font-medium shadow-sm transition-colors disabled:opacity-60'

export function Grades() {
  const { t, i18n } = useTranslation()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { classroomId: cidFromUrl, snapshotId: sidFromUrl } = useParams<{
    classroomId?: string
    snapshotId?: string
  }>()
  const isSnapshotMode = !!sidFromUrl

  // `?edit=<item_id>` lets another page deep-link straight into inline-edit
  // for one column (e.g. /grades/entry redirects here when the picked item
  // already has grades for this class). Force the by-subject view in that
  // case; BySubjectView consumes the param and clears it after applying.
  const [params] = useSearchParams()
  const editParam = params.get('edit')

  const [view, setView] = useState<View>(
    editParam
      ? 'by-subject'
      : ((localStorage.getItem(VIEW_KEY) as View) || 'by-student'),
  )
  // Follow the top-bar's "viewed" semester (a pure view filter — see
  // state/SemesterView). Only relevant in main classroom mode; snapshots
  // own their own semester from the items they contain.
  const { viewed, isArchived: semesterArchived } = useSemesterView()
  const gradesQ = useQuery({
    queryKey: isSnapshotMode
      ? ['snapshot-grades', sidFromUrl]
      : ['grades', cidFromUrl, viewed?.id],
    queryFn: () =>
      isSnapshotMode
        ? api.snapshots.viewGrades(sidFromUrl as string)
        : api.grades.view(cidFromUrl as string, viewed?.id),
    enabled: isSnapshotMode ? !!sidFromUrl : !!cidFromUrl,
  })

  if (!isSnapshotMode && !cidFromUrl) return null

  const view_data = gradesQ.data
  // In snapshot mode, classroomId comes from the response. In main mode,
  // it's the URL param (and matches the response too).
  const classroomId = view_data?.classroom_id ?? cidFromUrl ?? ''
  // Snapshots have no concept of "archived semester" — their semester is
  // pinned at archive time. Inside a snapshot, the page is always writeable.
  const isArchived = isSnapshotMode ? false : semesterArchived
  const snapshotId = sidFromUrl ?? null

  const archiveMut = useMutation({
    mutationFn: () => api.snapshots.create(classroomId),
    onSuccess: (snap) => {
      qc.invalidateQueries({ queryKey: ['grades'] })
      qc.invalidateQueries({ queryKey: ['snapshots'] })
      navigate(`/snapshots/${snap.id}/grades`, { replace: true })
    },
  })
  const matrix = useMemo(
    () => (view_data ? buildMatrix(view_data) : {}),
    [view_data],
  )
  const subjectsPresent = useMemo(
    () =>
      view_data
        ? subjectsInView(view_data, SYSTEM_SUBJECT_KEYS as readonly string[])
        : [],
    [view_data],
  )

  function changeView(v: View) {
    setView(v)
    localStorage.setItem(VIEW_KEY, v)
  }

  return (
    <PageContainer>
      <PageHeader
        title={
          view_data
            ? isSnapshotMode
              ? t('grades.snapshot_title_with_class', {
                  name: classroomDisplayName(
                    view_data.classroom_grade,
                    view_data.classroom_name,
                    i18n.language,
                  ),
                })
              : t('grades.title_with_class', {
                  name: classroomDisplayName(
                    view_data.classroom_grade,
                    view_data.classroom_name,
                    i18n.language,
                  ),
                })
            : t('grades.title')
        }
        subtitle={t('grades.subtitle')}
        actions={
          <div className="flex flex-wrap items-center gap-2 sm:justify-end">
            {!isArchived && classroomId && (
              <Link
                to={
                  isSnapshotMode
                    ? `/classes/${classroomId}/grades/entry?snapshot_id=${snapshotId}`
                    : `/classes/${classroomId}/grades/entry`
                }
                className={SECONDARY_BTN}
              >
                {t('classes.actions.grade_entry')}
              </Link>
            )}
            {!isArchived && !isSnapshotMode && (
              <button
                onClick={() => {
                  // Issue #159: if the class has any subject whose 段考
                  // (major_exam) weight > 0 but no actual 段考 items, the
                  // weighted total math will treat missing entries as 0.
                  // Warn first so the teacher can cancel and add the exam
                  // before locking the snapshot.
                  if (view_data) {
                    const hasMajorExam = view_data.items.some(
                      (i) => i.category_system_key === 'major_exam',
                    )
                    if (!hasMajorExam) {
                      const maxWeight = Math.max(
                        0,
                        ...view_data.subject_category_weights
                          .filter(
                            (w) => w.category_system_key === 'major_exam',
                          )
                          .map((w) => w.weight),
                      )
                      if (maxWeight > 0) {
                        if (
                          !window.confirm(
                            t('errors.major_exam.no_grades_with_weight', {
                              percent: maxWeight,
                            }),
                          )
                        ) {
                          return
                        }
                      }
                    }
                  }
                  if (window.confirm(t('grades.archive_confirm'))) {
                    archiveMut.mutate()
                  }
                }}
                disabled={archiveMut.isPending || !view_data || view_data.items.length === 0}
                className={SECONDARY_BTN}
                title={
                  view_data && view_data.items.length === 0
                    ? t('grades.archive_empty_tooltip')
                    : undefined
                }
              >
                {archiveMut.isPending
                  ? t('common.saving')
                  : t('grades.archive_now')}
              </button>
            )}
            <button
              onClick={() =>
                navigate(isSnapshotMode ? '/snapshots' : '/classes')
              }
              className={SECONDARY_BTN}
            >
              {isSnapshotMode
                ? t('snapshots.back_to_list')
                : t('students.back_to_classes')}
            </button>
          </div>
        }
      />

      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div className="ml-auto flex items-center gap-1">
          <button
            onClick={() => changeView('by-student')}
            className={`px-3 py-1.5 text-sm rounded-md transition-colors ${
              view === 'by-student'
                ? 'bg-slate-900 text-white'
                : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'
            }`}
            aria-pressed={view === 'by-student'}
          >
            {t('grades.view.by_student')}
          </button>
          <button
            onClick={() => changeView('by-subject')}
            className={`px-3 py-1.5 text-sm rounded-md transition-colors ${
              view === 'by-subject'
                ? 'bg-slate-900 text-white'
                : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'
            }`}
            aria-pressed={view === 'by-subject'}
          >
            {t('grades.view.by_subject')}
          </button>
          <button
            onClick={() => changeView('standards')}
            className={`px-3 py-1.5 text-sm rounded-md transition-colors ${
              view === 'standards'
                ? 'bg-slate-900 text-white'
                : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'
            }`}
            aria-pressed={view === 'standards'}
          >
            {t('grades.view.standards')}
          </button>
        </div>
      </div>

      {isArchived && (
        <ArchivedSemesterBanner
          label={viewed ? `${viewed.academic_year}-${viewed.term}` : null}
        />
      )}

      {gradesQ.isLoading && (
        <div className="text-center text-slate-400 py-16">
          {t('common.loading')}
        </div>
      )}
      {gradesQ.isError && (
        <div className="bg-rose-50 border border-rose-200 text-rose-700 rounded-xl p-4 text-sm">
          {gradesQ.error instanceof Error ? gradesQ.error.message : t('common.error_generic')}
        </div>
      )}

      {view_data && view === 'by-student' && (
        <ByStudentTable
          view={view_data}
          matrix={matrix}
          subjects={subjectsPresent}
        />
      )}
      {view_data && view === 'by-subject' && (
        <BySubjectView
          view={view_data}
          classroomId={classroomId}
          snapshotId={snapshotId}
          subjects={subjectsPresent}
          editTarget={editParam}
          readOnly={isArchived}
        />
      )}
      {view === 'standards' && isSnapshotMode && view_data && (
        <StandardsMatrix
          snapshotId={snapshotId as string}
          snapshotStudents={view_data.students}
          readOnly={false}
        />
      )}
      {view === 'standards' && classroomId && !isSnapshotMode && (
        <StandardsMatrix
          classroomId={classroomId}
          readOnly={isArchived}
        />
      )}
    </PageContainer>
  )
}

type SubjectRef = ReturnType<typeof subjectsInView>[number]

function subjectLabel(s: SubjectRef, t: (k: string) => string): string {
  if (s.system_key) return t(`subject.${s.system_key}`)
  return s.display_name ?? '—'
}

// ---------- 依學生 view (overview matrix) ----------

type SortKey = 'seat' | 'overall' | string // string = subject_id for subject columns
type SortDir = 'asc' | 'desc'

function ByStudentTable({
  view,
  matrix,
  subjects,
}: {
  view: import('../lib/api').ClassroomGradesView
  matrix: ReturnType<typeof buildMatrix>
  subjects: SubjectRef[]
}) {
  const { t } = useTranslation()
  const [query, setQuery] = useState('')
  const [sortKey, setSortKey] = useState<SortKey>('seat')
  const [sortDir, setSortDir] = useState<SortDir>('asc')

  if (view.items.length === 0) {
    return <EmptyHint />
  }

  function toggleSort(key: SortKey) {
    if (key === sortKey) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortKey(key)
      setSortDir('asc')
    }
  }

  // Precompute (overall, per-subject-total) for each student so sort doesn't
  // re-walk the matrix on every comparison.
  const enriched = view.students.map((s) => {
    const row = matrix[s.id] ?? {}
    const totals = subjects
      .map((sub) => row[sub.id]?.weightedTotal)
      .filter((n): n is number => typeof n === 'number')
    const overall =
      totals.length > 0
        ? totals.reduce((a, b) => a + b, 0) / totals.length
        : null
    return { student: s, row, overall }
  })

  const q = query.trim().toLowerCase()
  const filtered = q
    ? enriched.filter(({ student }) => {
        const seatStr = String(student.seat_number)
        const name = (student.name ?? '').toLowerCase()
        return seatStr.includes(q) || name.includes(q)
      })
    : enriched

  const dirMul = sortDir === 'asc' ? 1 : -1
  const sorted = [...filtered].sort((a, b) => {
    const valueOf = (
      row: typeof enriched[number],
    ): number | null => {
      if (sortKey === 'seat') return row.student.seat_number
      if (sortKey === 'overall') return row.overall
      // subject column
      const v = row.row[sortKey]?.weightedTotal
      return typeof v === 'number' ? v : null
    }
    const av = valueOf(a)
    const bv = valueOf(b)
    // null/missing always at bottom regardless of direction.
    if (av === null && bv === null) {
      return a.student.seat_number - b.student.seat_number
    }
    if (av === null) return 1
    if (bv === null) return -1
    if (av === bv) return a.student.seat_number - b.student.seat_number
    return (av - bv) * dirMul
  })

  function arrow(key: SortKey) {
    if (key !== sortKey) {
      return <span className="text-slate-300 ml-1">↕</span>
    }
    return (
      <span className="text-slate-700 ml-1">
        {sortDir === 'asc' ? '▲' : '▼'}
      </span>
    )
  }

  const headerBtn =
    'inline-flex items-center text-left font-medium hover:text-slate-900 cursor-pointer select-none'

  return (
    <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
      <div className="px-4 py-3 border-b border-slate-100 bg-slate-50/60">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('grades.search_placeholder')}
          className="w-full sm:w-72 border border-slate-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500"
        />
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
            <tr>
              <th className="px-4 py-3 text-left">
                <button onClick={() => toggleSort('seat')} className={headerBtn}>
                  {t('students.col.seat')}
                  {arrow('seat')}
                </button>
              </th>
              <th className="px-4 py-3 text-left font-medium">
                {t('students.col.name')}
              </th>
              {subjects.map((sub) => (
                <th key={sub.id} className="px-4 py-3 text-left">
                  <button
                    onClick={() => toggleSort(sub.id)}
                    className={headerBtn}
                  >
                    {subjectLabel(sub, t)}
                    {arrow(sub.id)}
                  </button>
                </th>
              ))}
              <th className="px-4 py-3 text-left">
                <button
                  onClick={() => toggleSort('overall')}
                  className={headerBtn}
                >
                  {t('grades.overall_avg')}
                  {arrow('overall')}
                </button>
              </th>
            </tr>
          </thead>
          <tbody>
            {sorted.map(({ student: s, row, overall }) => (
              <tr
                key={s.id}
                className="border-b border-slate-100 last:border-b-0"
              >
                <td className="px-4 py-2.5 text-slate-900 font-medium">
                  {s.seat_number}
                </td>
                <td className="px-4 py-2.5 text-slate-700">
                  <a
                    href={`/students/${s.id}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="hover:text-amber-700 hover:underline"
                  >
                    {s.name || <span className="text-slate-400">—</span>}
                  </a>
                </td>
                {subjects.map((sub) => (
                  <td
                    key={sub.id}
                    className="px-4 py-2.5 text-slate-700 tabular-nums"
                  >
                    {formatScore(row[sub.id]?.weightedTotal)}
                  </td>
                ))}
                <td className="px-4 py-2.5 text-slate-900 font-semibold tabular-nums">
                  {formatScore(overall)}
                </td>
              </tr>
            ))}
            {sorted.length === 0 && (
              <tr>
                <td
                  colSpan={subjects.length + 3}
                  className="px-4 py-8 text-center text-sm text-slate-400"
                >
                  {t('grades.no_match')}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="px-4 py-3 text-xs text-slate-500 border-t border-slate-200 bg-slate-50">
        {t('grades.formula_hint')}
      </p>
    </div>
  )
}

// ---------- 依科目 view (pick one subject, show item breakdown) ----------

function BySubjectView({
  view,
  classroomId,
  snapshotId,
  subjects,
  editTarget,
  readOnly,
}: {
  view: import('../lib/api').ClassroomGradesView
  classroomId: string
  // When set, all activate/deactivate/bulk-save calls target this snapshot
  // bucket instead of the classroom's main bucket.
  snapshotId: string | null
  subjects: SubjectRef[]
  editTarget: string | null
  readOnly: boolean
}) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const [, setParams] = useSearchParams()
  const [pickedId, setPickedId] = useState<string>(subjects[0]?.id ?? '')
  // One item at a time can be in edit mode.
  const [editingItemId, setEditingItemId] = useState<string | null>(null)
  // drafts[student_id] = score | null (null = blank → delete)
  const [drafts, setDrafts] = useState<Record<string, number | null>>({})
  const [saveErr, setSaveErr] = useState<string | null>(null)
  // Toast for the 段考 conflict (issue #159) — fixed-position, auto-
  // dismissing. Distinct from saveErr (inline) because the conflict triggers
  // a navigation + we want a visible confirmation that the redirect happened.
  const [majorExamToast, setMajorExamToast] = useState<string | null>(null)
  useEffect(() => {
    if (!majorExamToast) return
    const id = setTimeout(() => setMajorExamToast(null), 5000)
    return () => clearTimeout(id)
  }, [majorExamToast])
  // student_id → input ref, populated while a column is in edit mode.
  const inputRefs = useRef<Map<string, HTMLInputElement>>(new Map())

  // If the page was deep-linked with ?edit=<item_id>, switch the subject
  // picker to that item's subject and open inline-edit for it. Done in an
  // effect so we wait for view.items to be populated. The query param is
  // cleared after applying so a refresh doesn't re-open the same edit.
  const editAppliedRef = useRef(false)
  useEffect(() => {
    if (!editTarget || editAppliedRef.current) return
    const target = view.items.find((i) => i.id === editTarget)
    if (!target) return
    setPickedId(target.subject_id)
    const next: Record<string, number | null> = {}
    for (const s of view.students) {
      const cur = view.grades.find(
        (g) => g.student_id === s.id && g.item_id === editTarget,
      )?.score
      next[s.id] = cur === undefined ? null : cur
    }
    setDrafts(next)
    setEditingItemId(editTarget)
    setSaveErr(null)
    editAppliedRef.current = true
    setParams(
      (p) => {
        const c = new URLSearchParams(p)
        c.delete('edit')
        return c
      },
      { replace: true },
    )
  }, [editTarget, view, setParams])

  function focusStudent(studentId: string) {
    const el = inputRefs.current.get(studentId)
    if (el) {
      el.focus()
      el.select()
    }
  }

  function onCellKeyDown(
    e: React.KeyboardEvent<HTMLInputElement>,
    studentIdx: number,
  ) {
    const students = view.students
    const max = students.length - 1
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      if (studentIdx < max) focusStudent(students[studentIdx + 1].id)
      return
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      if (studentIdx < max) focusStudent(students[studentIdx + 1].id)
      return
    }
    if (e.key === 'ArrowUp' || (e.key === 'Enter' && e.shiftKey)) {
      e.preventDefault()
      if (studentIdx > 0) focusStudent(students[studentIdx - 1].id)
      return
    }
    // Tab / Shift+Tab / ← / → keep native browser behaviour: only one
    // editable column exists at a time, so there's no neighbouring cell.
  }

  if (view.items.length === 0) return <EmptyHint />

  // Issue #159: column order = category group (段考 → 小考 → 作業 →
  // 出席率 → 加分), and within each group newest activation first.
  // Categories with no items just don't appear.
  const items = orderItemsForBySubject(
    view.items.filter((i) => i.subject_id === pickedId),
  )
  const grades = view.grades
  const lookup: Record<string, Record<string, number>> = {}
  for (const g of grades) {
    lookup[g.student_id] ??= {}
    lookup[g.student_id][g.item_id] = g.score
  }

  function startEdit(itemId: string) {
    // Initialize drafts from current server scores for this item.
    const next: Record<string, number | null> = {}
    for (const s of view.students) {
      const cur = lookup[s.id]?.[itemId]
      next[s.id] = cur === undefined ? null : cur
    }
    setDrafts(next)
    setEditingItemId(itemId)
    setSaveErr(null)
  }

  function cancelEdit() {
    setDrafts({})
    setEditingItemId(null)
    setSaveErr(null)
  }

  // Items where ≥1 student still has a real score (>0) for this class.
  // Server enforces the same rule; this is the UX preview so the ✕ button
  // is disabled before the click rather than failing with a 409.
  const itemsWithRealScores = useMemo(() => {
    const s = new Set<string>()
    for (const g of view.grades) {
      if (g.score > 0) s.add(g.item_id)
    }
    return s
  }, [view.grades])

  const deactivateMut = useMutation({
    mutationFn: (itemId: string) =>
      api.classrooms.deactivateItem(classroomId, itemId, snapshotId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['grades'] })
      qc.invalidateQueries({ queryKey: ['snapshot-grades'] })
    },
    onError: (err) => {
      if (err instanceof ApiError && err.body?.message_key) {
        setSaveErr(err.body.message_key)
      } else {
        setSaveErr('common.error_generic')
      }
    },
  })

  const saveMut = useMutation({
    mutationFn: async (itemId: string) => {
      const entries: GradeBulkEntry[] = view.students.map((s) => {
        const v = drafts[s.id]
        // Normalise unrounded typed values (e.g. 78.46) before send.
        const score =
          v == null ? null : normaliseScore(String(v))
        return { student_id: s.id, score }
      })
      return api.gradeEntry.bulk({
        item_id: itemId,
        classroom_id: classroomId,
        snapshot_id: snapshotId ?? undefined,
        entries,
      })
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['grades'] })
      qc.invalidateQueries({ queryKey: ['snapshot-grades'] })
      qc.invalidateQueries({ queryKey: ['item-grades', editingItemId] })
      setDrafts({})
      setEditingItemId(null)
    },
    onError: (err) => {
      // Issue #159: a second 段考 (major_exam) item triggers a 409 with
      // existing_item_id. Cancel the in-progress edit, deep-link to the
      // existing item via ?edit=<id> so the existing column opens, and
      // surface a toast-style message telling the teacher what happened.
      if (
        err instanceof ApiError &&
        err.body?.message_key === 'errors.major_exam.already_exists' &&
        typeof err.body?.details?.existing_item_id === 'string'
      ) {
        const existingId = err.body.details.existing_item_id as string
        const existingName =
          (err.body.details.existing_item_name as string) || ''
        setDrafts({})
        setEditingItemId(null)
        setParams(
          (p) => {
            const c = new URLSearchParams(p)
            c.set('edit', existingId)
            return c
          },
          { replace: true },
        )
        setMajorExamToast(
          t('errors.major_exam.already_exists_redirect', {
            name: existingName,
          }),
        )
        editAppliedRef.current = false
        return
      }
      setSaveErr(
        err instanceof ApiError && err.body?.message
          ? err.body.message
          : err instanceof Error
            ? err.message
            : 'unknown',
      )
    },
  })

  function setDraft(studentId: string, raw: string) {
    // Allow blank → null; reject mid-typing non-numeric (don't clobber what
    // the user has so far). Final rounding happens on save via
    // normaliseScore; here we just store the parsed number so the user can
    // keep typing "78.4" without it snapping mid-keystroke.
    if (raw === '') {
      setDrafts((d) => ({ ...d, [studentId]: null }))
      return
    }
    const n = Number(raw)
    if (Number.isNaN(n)) return
    setDrafts((d) => ({
      ...d,
      [studentId]: Math.max(0, Math.min(100, n)),
    }))
  }

  function handlePaste(
    e: React.ClipboardEvent<HTMLInputElement>,
    startIndex: number,
  ) {
    const text = e.clipboardData.getData('text')
    // Excel column copy is newline-separated; normalise CRLF / CR.
    const lines = text.replace(/\r\n?/g, '\n').split('\n')
    // Excel appends a trailing newline → strip empty tail.
    while (lines.length && lines[lines.length - 1] === '') lines.pop()
    // Single-cell paste → let the native browser handler run.
    if (lines.length <= 1) return

    e.preventDefault()
    setDrafts((d) => {
      const next = { ...d }
      for (let k = 0; k < lines.length; k++) {
        const target = view.students[startIndex + k]
        if (!target) break // pasted more rows than students
        next[target.id] = normaliseScore(lines[k])
      }
      return next
    })
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <label className="text-sm text-slate-600 inline-flex items-center gap-2">
          {t('grades.pick_subject')}
          <select
            value={pickedId}
            onChange={(e) => {
              setPickedId(e.target.value)
              cancelEdit()
            }}
            className="border border-slate-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500 bg-white"
          >
            {subjects.map((sub) => (
              <option key={sub.id} value={sub.id}>
                {subjectLabel(sub, t)}
              </option>
            ))}
          </select>
        </label>
        {snapshotId && (
          <div className="ml-auto">
            <RecomputeButton snapshotId={snapshotId} />
          </div>
        )}
      </div>

      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
              <tr>
                <th className="px-4 py-3 text-left font-medium">
                  {t('students.col.seat')}
                </th>
                <th className="px-4 py-3 text-left font-medium">
                  {t('students.col.name')}
                </th>
                {items.map((i) => {
                  const isEditing = editingItemId === i.id
                  const otherEditing =
                    editingItemId !== null && editingItemId !== i.id
                  const catBg =
                    CATEGORY_HEADER_BG[i.category_system_key] ?? ''
                  return (
                    <th
                      key={i.id}
                      className={`px-3 py-3 text-left font-medium ${
                        isEditing ? 'bg-amber-50' : catBg
                      }`}
                      title={`${t(`category.${i.category_system_key}`)} · ${i.name}`}
                    >
                      <div className="flex items-start gap-1">
                        <div>
                          <div className="text-[10px] text-slate-500 uppercase tracking-wide">
                            {t(`category.${i.category_system_key}`)}
                          </div>
                          <div className="text-slate-700">{i.name}</div>
                        </div>
                        {!isEditing && !readOnly && (
                          <>
                            <button
                              onClick={() => startEdit(i.id)}
                              disabled={otherEditing}
                              title={t('grades.edit_scores')}
                              aria-label={t('grades.edit_scores')}
                              className="ml-1 text-slate-400 hover:text-amber-700 disabled:opacity-30 disabled:cursor-not-allowed"
                            >
                              ✎
                            </button>
                            <button
                              onClick={() => {
                                if (
                                  window.confirm(
                                    t('grades.deactivate_confirm', {
                                      name: i.name,
                                    }),
                                  )
                                ) {
                                  deactivateMut.mutate(i.id)
                                }
                              }}
                              disabled={
                                otherEditing ||
                                deactivateMut.isPending ||
                                itemsWithRealScores.has(i.id)
                              }
                              title={
                                itemsWithRealScores.has(i.id)
                                  ? t('grades.deactivate_blocked_tooltip')
                                  : t('grades.deactivate_tooltip')
                              }
                              aria-label={
                                itemsWithRealScores.has(i.id)
                                  ? t('grades.deactivate_blocked_tooltip')
                                  : t('grades.deactivate_tooltip')
                              }
                              className="ml-0.5 text-slate-300 hover:text-rose-600 disabled:opacity-30 disabled:cursor-not-allowed"
                            >
                              ✕
                            </button>
                          </>
                        )}
                        {isEditing && (
                          <div className="ml-2 flex items-center gap-1">
                            <button
                              onClick={() => saveMut.mutate(i.id)}
                              disabled={saveMut.isPending}
                              className="px-2 py-0.5 rounded bg-amber-500 hover:bg-amber-600 text-white text-xs font-medium disabled:bg-slate-300"
                            >
                              {saveMut.isPending
                                ? t('common.saving')
                                : t('common.save')}
                            </button>
                            <button
                              onClick={cancelEdit}
                              disabled={saveMut.isPending}
                              className="px-2 py-0.5 rounded border border-slate-300 hover:bg-slate-50 text-slate-700 text-xs font-medium disabled:opacity-60"
                            >
                              {t('common.cancel')}
                            </button>
                          </div>
                        )}
                      </div>
                    </th>
                  )
                })}
              </tr>
            </thead>
            <tbody>
              {view.students.map((s, si) => (
                <tr
                  key={s.id}
                  className="border-b border-slate-100 last:border-b-0"
                >
                  <td className="px-4 py-2.5 text-slate-900 font-medium">
                    {s.seat_number}
                  </td>
                  <td className="px-4 py-2.5 text-slate-700">
                    {s.name || (
                      <span className="text-slate-400">—</span>
                    )}
                  </td>
                  {items.map((i) => {
                    const isEditing = editingItemId === i.id
                    const catBg =
                      CATEGORY_CELL_BG[i.category_system_key] ?? ''
                    if (!isEditing) {
                      return (
                        <td
                          key={i.id}
                          className={`px-3 py-2.5 text-slate-700 ${catBg}`}
                        >
                          {formatScore(lookup[s.id]?.[i.id])}
                        </td>
                      )
                    }
                    const v = drafts[s.id]
                    return (
                      <td key={i.id} className="px-2 py-1 bg-amber-50/40">
                        <input
                          ref={(el) => {
                            if (el) inputRefs.current.set(s.id, el)
                            else inputRefs.current.delete(s.id)
                          }}
                          type="number"
                          inputMode="decimal"
                          step={0.1}
                          min={0}
                          max={100}
                          value={v === null || v === undefined ? '' : String(v)}
                          onChange={(e) => setDraft(s.id, e.target.value)}
                          onPaste={(e) => handlePaste(e, si)}
                          onKeyDown={(e) => onCellKeyDown(e, si)}
                          placeholder="—"
                          className="w-16 border border-slate-300 rounded-md px-2 py-1 text-sm text-right focus:outline-none focus:ring-2 focus:ring-amber-500"
                        />
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {saveErr && (
        <p className="text-sm text-rose-600">{saveErr}</p>
      )}
      {majorExamToast && (
        <div
          role="status"
          className="fixed bottom-6 right-6 max-w-sm px-4 py-3 rounded-lg bg-rose-600 text-white text-sm shadow-lg z-50 cursor-pointer"
          onClick={() => setMajorExamToast(null)}
        >
          {majorExamToast}
        </div>
      )}
    </div>
  )
}

function RecomputeButton({ snapshotId }: { snapshotId: string }) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const [confirming, setConfirming] = useState(false)
  const [result, setResult] = useState<
    import('../lib/api').SnapshotRecomputeResult | null
  >(null)

  const standardsQ = useQuery({
    queryKey: ['snapshot-standards', snapshotId],
    queryFn: () => api.snapshots.listStandards(snapshotId),
  })
  const hasAny = (standardsQ.data?.data.length ?? 0) > 0

  const mut = useMutation({
    mutationFn: () => api.snapshots.recomputePoints(snapshotId),
    onSuccess: (res) => {
      setResult(res)
      setConfirming(false)
      qc.invalidateQueries({ queryKey: ['snapshot-grades', snapshotId] })
      qc.invalidateQueries({ queryKey: ['student-points'] })
      qc.invalidateQueries({ queryKey: ['student-detail'] })
    },
  })

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setResult(null)
          setConfirming(true)
        }}
        disabled={!hasAny || mut.isPending}
        title={
          !hasAny
            ? t('snapshots.standards.recompute_btn_disabled_tooltip')
            : undefined
        }
        className="inline-flex items-center px-3 py-1.5 rounded-md bg-amber-500 hover:bg-amber-600 text-white text-sm font-medium shadow-sm disabled:bg-slate-300 disabled:cursor-not-allowed"
      >
        {mut.isPending
          ? t('snapshots.standards.recompute_running')
          : t('snapshots.standards.recompute_btn')}
      </button>
      {result && (
        <p className="mt-2 text-xs text-emerald-700">
          {t('snapshots.standards.recompute_result', {
            awarded: result.awarded,
            revoked: result.revoked,
            unchanged: result.unchanged,
            total: result.grades_evaluated,
          })}
        </p>
      )}
      {confirming && (
        <div
          className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center p-4 z-50"
          onClick={() => !mut.isPending && setConfirming(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="bg-white rounded-2xl shadow-xl border border-slate-200 p-6 w-full max-w-sm"
          >
            <h2 className="text-lg font-semibold tracking-tight mb-3 text-slate-900">
              {t('snapshots.standards.recompute_confirm_title')}
            </h2>
            <p className="text-sm text-slate-700 mb-5">
              {t('snapshots.standards.recompute_confirm_body')}
            </p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirming(false)}
                disabled={mut.isPending}
                className="inline-flex items-center px-4 py-2 rounded-lg bg-white border border-slate-200 hover:border-slate-300 hover:bg-slate-50 text-slate-700 text-sm font-medium shadow-sm disabled:opacity-60"
              >
                {t('common.cancel')}
              </button>
              <button
                type="button"
                onClick={() => mut.mutate()}
                disabled={mut.isPending}
                className="inline-flex items-center px-4 py-2 rounded-lg bg-amber-500 hover:bg-amber-600 text-white text-sm font-medium shadow-sm disabled:bg-slate-300"
              >
                {mut.isPending
                  ? t('snapshots.standards.recompute_running')
                  : t('snapshots.standards.recompute_btn')}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

function EmptyHint() {
  const { t } = useTranslation()
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-8 lg:p-12 text-center">
      <p className="text-sm text-slate-500">{t('grades.empty')}</p>
    </div>
  )
}
