import { useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { PageContainer } from '../layout/PageContainer'
import { PageHeader } from '../layout/PageHeader'
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

type View = 'by-student' | 'by-subject'
const VIEW_KEY = 'grades.view'

const SECONDARY_BTN =
  'inline-flex items-center px-4 py-2 rounded-lg bg-white border border-slate-200 hover:border-slate-300 hover:bg-slate-50 text-slate-700 text-sm font-medium shadow-sm transition-colors disabled:opacity-60'

export function Grades() {
  const { t, i18n } = useTranslation()
  const navigate = useNavigate()
  const { classroomId } = useParams<{ classroomId: string }>()

  const [view, setView] = useState<View>(
    (localStorage.getItem(VIEW_KEY) as View) || 'by-student',
  )
  const classroomQ = useQuery({
    queryKey: ['classroom', classroomId],
    queryFn: () => api.classrooms.get(classroomId as string),
    enabled: !!classroomId,
  })
  // The semester to display is governed by the global SemesterSwitcher in the
  // top bar (writes is_current). Omitting semester_id makes the backend resolve
  // to whichever Semester has is_current=true, so the page just follows that.
  const gradesQ = useQuery({
    queryKey: ['grades', classroomId],
    queryFn: () => api.grades.view(classroomId as string),
    enabled: !!classroomId,
  })

  if (!classroomId) return null

  const classroom = classroomQ.data
  const view_data = gradesQ.data
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
          classroom
            ? t('grades.title_with_class', {
                name: classroomDisplayName(
                  classroom.grade,
                  classroom.name,
                  i18n.language,
                ),
              })
            : t('grades.title')
        }
        subtitle={t('grades.subtitle')}
        actions={
          <div className="flex flex-wrap items-center gap-2 sm:justify-end">
            <button
              onClick={() => navigate('/classes')}
              className={SECONDARY_BTN}
            >
              {t('students.back_to_classes')}
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
        </div>
      </div>

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
        <BySubjectView view={view_data} subjects={subjectsPresent} />
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

  if (view.items.length === 0) {
    return <EmptyHint />
  }

  return (
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
              {subjects.map((sub) => (
                <th
                  key={sub.id}
                  className="px-4 py-3 text-left font-medium"
                >
                  {subjectLabel(sub, t)}
                </th>
              ))}
              <th className="px-4 py-3 text-left font-medium">
                {t('grades.overall_avg')}
              </th>
            </tr>
          </thead>
          <tbody>
            {view.students.map((s) => {
              const row = matrix[s.id] ?? {}
              const totals = subjects
                .map((sub) => row[sub.id]?.weightedTotal)
                .filter((n): n is number => typeof n === 'number')
              const overall =
                totals.length > 0
                  ? totals.reduce((a, b) => a + b, 0) / totals.length
                  : null
              return (
                <tr
                  key={s.id}
                  className="border-b border-slate-100 last:border-b-0"
                >
                  <td className="px-4 py-2.5 text-slate-900 font-medium">
                    {s.seat_number}
                  </td>
                  <td className="px-4 py-2.5 text-slate-700">
                    {s.name || <span className="text-slate-400">—</span>}
                  </td>
                  {subjects.map((sub) => (
                    <td
                      key={sub.id}
                      className="px-4 py-2.5 text-slate-700"
                    >
                      {formatScore(row[sub.id]?.weightedTotal)}
                    </td>
                  ))}
                  <td className="px-4 py-2.5 text-slate-900 font-semibold">
                    {formatScore(overall)}
                  </td>
                </tr>
              )
            })}
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
  subjects,
}: {
  view: import('../lib/api').ClassroomGradesView
  subjects: SubjectRef[]
}) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const [pickedId, setPickedId] = useState<string>(subjects[0]?.id ?? '')
  // One item at a time can be in edit mode.
  const [editingItemId, setEditingItemId] = useState<string | null>(null)
  // drafts[student_id] = score | null (null = blank → delete)
  const [drafts, setDrafts] = useState<Record<string, number | null>>({})
  const [saveErr, setSaveErr] = useState<string | null>(null)
  // student_id → input ref, populated while a column is in edit mode.
  const inputRefs = useRef<Map<string, HTMLInputElement>>(new Map())

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

  const items = view.items.filter((i) => i.subject_id === pickedId)
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

  const saveMut = useMutation({
    mutationFn: async (itemId: string) => {
      const entries: GradeBulkEntry[] = view.students.map((s) => ({
        student_id: s.id,
        score: drafts[s.id] ?? null,
      }))
      return api.gradeEntry.bulk({ item_id: itemId, entries })
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['grades'] })
      qc.invalidateQueries({ queryKey: ['item-grades', editingItemId] })
      setDrafts({})
      setEditingItemId(null)
    },
    onError: (err) => {
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

  return (
    <div className="space-y-4">
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
                  return (
                    <th
                      key={i.id}
                      className={`px-3 py-3 text-left font-medium ${
                        isEditing ? 'bg-amber-50' : ''
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
                        {!isEditing && (
                          <button
                            onClick={() => startEdit(i.id)}
                            disabled={otherEditing}
                            title={t('grades.edit_scores')}
                            aria-label={t('grades.edit_scores')}
                            className="ml-1 text-slate-400 hover:text-amber-700 disabled:opacity-30 disabled:cursor-not-allowed"
                          >
                            ✎
                          </button>
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
                    if (!isEditing) {
                      return (
                        <td key={i.id} className="px-3 py-2.5 text-slate-700">
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
    </div>
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
