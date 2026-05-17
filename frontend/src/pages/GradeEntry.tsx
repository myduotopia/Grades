import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  useNavigate,
  useParams,
  useSearchParams,
} from 'react-router-dom'
import {
  useMutation,
  useQueries,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'

import { ItemNameCombobox } from '../components/ItemNameCombobox'
import { useClassrooms } from '../hooks/useClassrooms'
import { useSemesters } from '../hooks/useSemesters'
import { PageContainer } from '../layout/PageContainer'
import { PageHeader } from '../layout/PageHeader'
import { classroomDisplayName } from '../lib/classroomFormat'
import {
  api,
  ApiError,
  type ItemCreatePayload,
  type ItemGradesView,
} from '../lib/api'

const MAX_ITEMS = 5
const MAJOR_EXAM_NAMES = ['期中考', '期末考', '第一次', '第二次', '第三次']

// localStorage keys shared with /admin/items modal so the teacher's last
// subject + category choice persists across both entry points.
const LS_LAST_SUBJECT = 'admin_items.modal.last_subject_id'
const LS_LAST_CATEGORY = 'admin_items.modal.last_category_id'
const CATEGORY_KEYS = [
  'major_exam',
  'quiz',
  'homework',
  'attendance',
  'extra',
] as const

const PRIMARY_BTN =
  'inline-flex items-center px-4 py-2 rounded-lg bg-amber-500 hover:bg-amber-600 active:bg-amber-700 text-white text-sm font-medium shadow-sm transition-colors disabled:bg-slate-300 disabled:shadow-none disabled:cursor-not-allowed'

const SECONDARY_BTN =
  'inline-flex items-center px-4 py-2 rounded-lg bg-white border border-slate-200 hover:border-slate-300 hover:bg-slate-50 text-slate-700 text-sm font-medium shadow-sm transition-colors disabled:opacity-60 disabled:cursor-not-allowed'

const SELECT_CLS =
  'border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-amber-500'

type CellKey = `${number}_${number}` // `${studentIdx}_${itemIdx}`

interface Pending {
  score: number | null
}

export function GradeEntry() {
  const { t, i18n } = useTranslation()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { classroomId } = useParams<{ classroomId: string }>()
  const [params, setParams] = useSearchParams()

  const itemIds = useMemo(
    () =>
      (params.get('items') ?? '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
        .slice(0, MAX_ITEMS),
    [params],
  )

  const classroomsQ = useClassrooms()
  const classroom = classroomsQ.data?.data.find((c) => c.id === classroomId)

  const itemQueries = useQueries({
    queries: itemIds.map((id) => ({
      queryKey: ['item-grades', id, classroomId],
      queryFn: () => api.gradeEntry.forItem(id, classroomId as string),
      enabled: !!classroomId,
    })),
  })

  const itemsData: (ItemGradesView | undefined)[] = itemQueries.map(
    (q) => q.data,
  )
  const anyLoading = itemQueries.some((q) => q.isLoading)
  const firstItem = itemsData.find((d) => d) ?? null

  // Union roster: keyed by student_id; assume every item shares the same
  // classroom so rosters match. Take the first non-empty roster.
  const roster = firstItem?.students ?? []

  // pending[key] = local draft value waiting to flush on blur. Cleared after
  // server returns.
  const [pending, setPending] = useState<Record<CellKey, Pending>>({})
  // savedFlash[key] = timestamp; render check icon for ~1.5s.
  const [savedFlash, setSavedFlash] = useState<Record<CellKey, number>>({})

  const inputRefs = useRef<Map<CellKey, HTMLInputElement>>(new Map())

  const [addItemOpen, setAddItemOpen] = useState(itemIds.length === 0)
  // If we land with no items, open the add modal.
  useEffect(() => {
    if (itemIds.length === 0) setAddItemOpen(true)
  }, [itemIds.length])

  const [actionErr, setActionErr] = useState<string | null>(null)

  const writeMut = useMutation({
    mutationFn: async (args: {
      itemId: string
      studentId: string
      gradeId: string | null
      score: number | null
    }) => {
      const { itemId, studentId, gradeId, score } = args
      if (score === null) {
        if (gradeId) await api.gradeEntry.remove(gradeId)
        return { kind: 'delete' as const }
      }
      if (gradeId) {
        const out = await api.gradeEntry.update(gradeId, score)
        return { kind: 'update' as const, out }
      }
      const out = await api.gradeEntry.create({
        item_id: itemId,
        student_id: studentId,
        score,
      })
      return { kind: 'create' as const, out }
    },
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['item-grades', vars.itemId] })
    },
  })

  const flushCell = useCallback(
    (studentIdx: number, itemIdx: number) => {
      const key: CellKey = `${studentIdx}_${itemIdx}`
      const draft = pending[key]
      if (!draft) return
      const item = itemsData[itemIdx]
      if (!item) return
      const student = roster[studentIdx]
      if (!student) return
      // Resolve existing grade id from the item's roster (the server's source
      // of truth — student may differ from the union roster's student object).
      const cur = item.students.find((s) => s.student_id === student.student_id)
      const gradeId = cur?.grade_id ?? null
      const prevScore = cur?.score ?? null
      if (draft.score === prevScore) {
        // No change; just clear the draft.
        setPending((p) => {
          const next = { ...p }
          delete next[key]
          return next
        })
        return
      }
      writeMut.mutate(
        {
          itemId: item.item_id,
          studentId: student.student_id,
          gradeId,
          score: draft.score,
        },
        {
          onSuccess: () => {
            setPending((p) => {
              const next = { ...p }
              delete next[key]
              return next
            })
            setSavedFlash((f) => ({ ...f, [key]: Date.now() }))
            setTimeout(() => {
              setSavedFlash((f) => {
                const next = { ...f }
                delete next[key]
                return next
              })
            }, 1500)
          },
          onError: (err) => {
            setActionErr(
              err instanceof ApiError && err.body?.message
                ? err.body.message
                : err instanceof Error
                  ? err.message
                  : 'unknown',
            )
          },
        },
      )
    },
    [pending, itemsData, roster, writeMut],
  )

  function focusCell(s: number, i: number) {
    const ref = inputRefs.current.get(`${s}_${i}`)
    if (ref) ref.focus()
  }

  function onKeyDown(
    e: React.KeyboardEvent<HTMLInputElement>,
    s: number,
    i: number,
  ) {
    const max_s = roster.length - 1
    const max_i = itemIds.length - 1
    if (e.key === 'Enter' || e.key === 'ArrowDown') {
      e.preventDefault()
      flushCell(s, i)
      if (s < max_s) focusCell(s + 1, i)
      return
    }
    if (e.key === 'ArrowUp' || (e.shiftKey && e.key === 'Enter')) {
      e.preventDefault()
      flushCell(s, i)
      if (s > 0) focusCell(s - 1, i)
      return
    }
    if (e.key === 'Tab') {
      // Let default tab behavior also flush.
      flushCell(s, i)
      if (e.shiftKey) {
        if (i > 0) {
          e.preventDefault()
          focusCell(s, i - 1)
        }
      } else {
        if (i < max_i) {
          e.preventDefault()
          focusCell(s, i + 1)
        }
      }
      return
    }
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      const target = e.currentTarget
      if (target.selectionStart === target.selectionEnd) {
        const atStart = target.selectionStart === 0
        const atEnd = target.selectionStart === target.value.length
        if (e.key === 'ArrowLeft' && atStart && i > 0) {
          e.preventDefault()
          flushCell(s, i)
          focusCell(s, i - 1)
        } else if (e.key === 'ArrowRight' && atEnd && i < max_i) {
          e.preventDefault()
          flushCell(s, i)
          focusCell(s, i + 1)
        }
      }
    }
  }

  async function flushAll() {
    const tasks = Object.keys(pending).map((key) => {
      const [s, i] = key.split('_').map(Number)
      return new Promise<void>((resolve) => {
        // queueMicrotask so React batches each flush.
        flushCell(s, i)
        resolve()
      })
    })
    await Promise.all(tasks)
  }

  function removeItem(itemIdx: number) {
    const next = [...itemIds]
    next.splice(itemIdx, 1)
    setParams(next.length > 0 ? { items: next.join(',') } : {})
  }

  function addItemId(id: string) {
    const next = [...itemIds.filter((x) => x !== id), id].slice(0, MAX_ITEMS)
    setParams({ items: next.join(',') })
  }

  // Resolve the current pending or server score for a cell.
  function cellValue(s: number, i: number): number | null {
    const key: CellKey = `${s}_${i}`
    if (key in pending) return pending[key].score
    const item = itemsData[i]
    if (!item) return null
    const student = roster[s]
    if (!student) return null
    const cur = item.students.find((x) => x.student_id === student.student_id)
    return cur?.score ?? null
  }

  if (!classroomId) return null

  return (
    <PageContainer>
      <PageHeader
        title={
          classroom
            ? t('grade_entry.title_with_class', {
                name: classroomDisplayName(
                  classroom.grade,
                  classroom.name,
                  i18n.language,
                ),
              })
            : t('grade_entry.title')
        }
        subtitle={t('grade_entry.subtitle')}
        actions={
          <div className="flex flex-wrap items-center gap-2 sm:justify-end">
            <button
              onClick={() => navigate(`/classes/${classroomId}/grades`)}
              className={SECONDARY_BTN}
            >
              {t('grade_entry.back_to_grades')}
            </button>
            <button
              onClick={() => setAddItemOpen(true)}
              className={SECONDARY_BTN}
              disabled={itemIds.length >= MAX_ITEMS}
              title={
                itemIds.length >= MAX_ITEMS
                  ? t('grade_entry.max_items_hint', { max: MAX_ITEMS })
                  : undefined
              }
            >
              {t('grade_entry.add_item')}
            </button>
            <button
              onClick={flushAll}
              disabled={Object.keys(pending).length === 0}
              className={PRIMARY_BTN}
            >
              {t('grade_entry.flush_all')}
            </button>
          </div>
        }
      />

      {anyLoading && (
        <div className="text-center text-slate-400 py-16">
          {t('common.loading')}
        </div>
      )}

      {!anyLoading && itemIds.length === 0 && (
        <div className="text-center text-slate-400 py-16 bg-white border border-slate-200 rounded-xl">
          {t('grade_entry.empty_no_item')}
        </div>
      )}

      {!anyLoading && itemIds.length > 0 && roster.length === 0 && (
        <div className="text-center text-slate-400 py-16 bg-white border border-slate-200 rounded-xl">
          {t('grade_entry.empty_no_students')}
        </div>
      )}

      {!anyLoading && itemIds.length > 0 && roster.length > 0 && (
        <section className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
                <tr>
                  <th className="sticky left-0 bg-slate-50 px-3 py-2 text-left font-medium z-10">
                    {t('grade_entry.col.seat')}
                  </th>
                  <th className="px-3 py-2 text-left font-medium">
                    {t('grade_entry.col.name')}
                  </th>
                  {itemsData.map((item, i) =>
                    item ? (
                      <th key={item.item_id} className="px-2 py-2 text-left font-medium">
                        <div className="flex items-center gap-1">
                          <span className="text-xs text-slate-500">
                            {t(`category.${item.category_system_key}`)}
                          </span>
                          <span className="text-slate-900">
                            {item.item_name || '—'}
                          </span>
                          <button
                            onClick={() => removeItem(i)}
                            className="ml-1 text-slate-400 hover:text-rose-600"
                            aria-label={t('grade_entry.remove_column')}
                            title={t('grade_entry.remove_column')}
                          >
                            ×
                          </button>
                        </div>
                        <div className="text-xs text-slate-400 mt-0.5">
                          {item.subject_system_key
                            ? t(`subject.${item.subject_system_key}`)
                            : (item.subject_display_name ?? '—')}
                        </div>
                      </th>
                    ) : (
                      <th key={i} className="px-2 py-2 text-slate-300">
                        ⋯
                      </th>
                    ),
                  )}
                </tr>
              </thead>
              <tbody>
                {roster.map((s, si) => (
                  <tr key={s.student_id} className="border-b border-slate-100 last:border-b-0">
                    <td className="sticky left-0 bg-white px-3 py-1.5 text-slate-500 font-mono tabular-nums z-10">
                      {s.seat_number}
                    </td>
                    <td className="px-3 py-1.5 text-slate-900">
                      {s.name || '—'}
                    </td>
                    {itemsData.map((_, i) => {
                      const key: CellKey = `${si}_${i}`
                      const cur = cellValue(si, i)
                      const saved = key in savedFlash
                      return (
                        <td key={i} className="px-2 py-1">
                          <div className="flex items-center gap-1">
                            <input
                              ref={(el) => {
                                if (el) inputRefs.current.set(key, el)
                                else inputRefs.current.delete(key)
                              }}
                              type="number"
                              inputMode="decimal"
                              step={0.1}
                              min={0}
                              max={100}
                              value={cur === null ? '' : String(cur)}
                              onChange={(e) => {
                                const v = e.target.value
                                let next: number | null
                                if (v === '') next = null
                                else {
                                  const n = Number(v)
                                  if (Number.isNaN(n)) return
                                  next = Math.max(0, Math.min(100, n))
                                }
                                setPending((p) => ({
                                  ...p,
                                  [key]: { score: next },
                                }))
                              }}
                              onBlur={() => flushCell(si, i)}
                              onKeyDown={(e) => onKeyDown(e, si, i)}
                              placeholder="—"
                              className="w-16 border border-slate-300 rounded-md px-2 py-1 text-sm text-right focus:outline-none focus:ring-2 focus:ring-amber-500"
                            />
                            {saved && (
                              <span className="text-emerald-500 text-xs">✓</span>
                            )}
                          </div>
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {actionErr && (
        <div className="mt-3 text-sm text-rose-600">{actionErr}</div>
      )}

      {addItemOpen && classroomId && (
        <AddItemModal
          currentItemCount={itemIds.length}
          onClose={() => {
            setAddItemOpen(false)
            // Auto-opened on a no-items entry page means "I didn't actually
            // want to start entering scores". Go back to wherever the user
            // came from (Classes list, grades view, etc.) instead of
            // stranding them on a blank entry page.
            if (itemIds.length === 0) {
              navigate(-1)
            }
          }}
          onCreated={(id) => {
            addItemId(id)
            setAddItemOpen(false)
          }}
        />
      )}
    </PageContainer>
  )
}

function AddItemModal({
  currentItemCount,
  onClose,
  onCreated,
}: {
  currentItemCount: number
  onClose: () => void
  onCreated: (itemId: string) => void
}) {
  const { t } = useTranslation()
  const semestersQ = useSemesters()
  const subjectsQ = useQueriesSubjects()
  const categoriesQ = useQueriesCategories()
  const allItemsQ = useQuery({
    queryKey: ['items', { _all: true }],
    queryFn: () => api.items.list({}),
  })

  const semesters = semestersQ.data?.data ?? []
  const subjects = subjectsQ.data?.data ?? []
  const categories = categoriesQ.data?.data ?? []

  const currentSemester = useMemo(
    () => semesters.find((s) => s.is_current),
    [semesters],
  )

  const [subjectId, setSubjectId] = useState('')
  const [categoryId, setCategoryId] = useState('')
  // Semester is governed by the global top-bar SemesterSwitcher; the modal
  // always creates the item under the current semester.
  const semesterId = currentSemester?.id ?? ''
  const [name, setName] = useState('')
  const [errKey, setErrKey] = useState<string | null>(null)

  // Existing item names for the selected subject + category (any classroom)
  // so the teacher can reuse the SAME exam name across classes — keeps
  // future analysis able to compare results for the same assessment.
  const nameSuggestions = useMemo(() => {
    const all = allItemsQ.data?.data ?? []
    const seen = new Set<string>()
    const out: string[] = []
    for (const it of all) {
      if (it.subject_id !== subjectId) continue
      if (it.category_id !== categoryId) continue
      if (!it.name || it.name.trim() === '') continue
      if (seen.has(it.name)) continue
      seen.add(it.name)
      out.push(it.name)
    }
    return out.sort((a, b) => a.localeCompare(b))
  }, [allItemsQ.data, subjectId, categoryId])

  // On first data arrival, prefer the teacher's last pick from localStorage
  // (shared with /admin/items modal) and fall back to a sensible default.
  useEffect(() => {
    if (subjectId || subjects.length === 0) return
    const last =
      typeof window !== 'undefined'
        ? localStorage.getItem(LS_LAST_SUBJECT)
        : null
    if (last && subjects.some((s) => s.id === last)) {
      setSubjectId(last)
    } else {
      setSubjectId(subjects[0].id)
    }
  }, [subjects, subjectId])
  useEffect(() => {
    if (categoryId || categories.length === 0) return
    const last =
      typeof window !== 'undefined'
        ? localStorage.getItem(LS_LAST_CATEGORY)
        : null
    if (last && categories.some((c) => c.id === last)) {
      setCategoryId(last)
    } else {
      const quiz = categories.find((c) => c.system_key === 'quiz')
      setCategoryId(quiz?.id ?? categories[0]?.id ?? '')
    }
  }, [categories, categoryId])
  const selectedCategoryKey =
    categories.find((c) => c.id === categoryId)?.system_key ?? ''
  const isMajorExam = selectedCategoryKey === 'major_exam'

  useEffect(() => {
    if (isMajorExam && !MAJOR_EXAM_NAMES.includes(name)) {
      setName(MAJOR_EXAM_NAMES[0])
    } else if (!isMajorExam && MAJOR_EXAM_NAMES.includes(name)) {
      setName('')
    }
  }, [isMajorExam, name])

  const create = useMutation({
    mutationFn: (body: ItemCreatePayload) => api.items.create(body),
    onSuccess: (item) => {
      try {
        localStorage.setItem(LS_LAST_SUBJECT, subjectId)
        localStorage.setItem(LS_LAST_CATEGORY, categoryId)
      } catch {
        // Ignore quota / privacy-mode errors.
      }
      onCreated(item.id)
    },
    onError: (err) => {
      if (err instanceof ApiError && err.body?.message_key) {
        setErrKey(err.body.message_key)
      } else {
        setErrKey('common.error_generic')
      }
    },
  })

  function submit(e: React.FormEvent) {
    e.preventDefault()
    setErrKey(null)
    if (!subjectId || !categoryId || !semesterId) {
      setErrKey('admin_items.error.missing_fields')
      return
    }
    create.mutate({
      subject_id: subjectId,
      category_id: categoryId,
      semester_id: semesterId,
      name: name.trim(),
    })
  }

  return (
    <div
      className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center p-4 z-50"
      onClick={onClose}
    >
      <form
        onSubmit={submit}
        onClick={(e) => e.stopPropagation()}
        className="bg-white rounded-2xl shadow-xl border border-slate-200 p-6 w-full max-w-md"
      >
        <h2 className="text-lg font-semibold tracking-tight mb-1 text-slate-900">
          {t('admin_items.modal.add_title')}
        </h2>
        <p className="text-xs text-slate-500 mb-4">
          {t('grade_entry.modal.add_subtitle', {
            count: currentItemCount,
            max: MAX_ITEMS,
          })}
        </p>

        <div className="space-y-3">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              {t('admin_items.modal.subject')}
            </label>
            <select
              value={subjectId}
              onChange={(e) => setSubjectId(e.target.value)}
              className={SELECT_CLS + ' w-full'}
            >
              {subjects.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.system_key ? t(`subject.${s.system_key}`) : s.display_name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              {t('admin_items.modal.category')}
            </label>
            <select
              value={categoryId}
              onChange={(e) => setCategoryId(e.target.value)}
              className={SELECT_CLS + ' w-full'}
            >
              {CATEGORY_KEYS.map((k) => {
                const c = categories.find((cat) => cat.system_key === k)
                return c ? (
                  <option key={c.id} value={c.id}>
                    {t(`category.${k}`)}
                  </option>
                ) : null
              })}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              {t('admin_items.modal.name')}
            </label>
            {isMajorExam ? (
              <select
                value={MAJOR_EXAM_NAMES.includes(name) ? name : MAJOR_EXAM_NAMES[0]}
                onChange={(e) => setName(e.target.value)}
                className={SELECT_CLS + ' w-full'}
              >
                {MAJOR_EXAM_NAMES.map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            ) : (
              <>
                <ItemNameCombobox
                  value={name}
                  onChange={setName}
                  suggestions={nameSuggestions}
                  placeholder={t('admin_items.modal.name_placeholder')}
                />
                <p className="text-xs text-slate-500 mt-1">
                  {t('admin_items.modal.name_hint')}
                </p>
              </>
            )}
          </div>
        </div>

        {errKey && <p className="mt-3 text-sm text-rose-600">{t(errKey)}</p>}

        <div className="mt-6 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-slate-700 hover:bg-slate-100 rounded-lg text-sm font-medium"
          >
            {t('common.cancel')}
          </button>
          <button
            type="submit"
            disabled={create.isPending}
            className={PRIMARY_BTN}
          >
            {create.isPending ? t('common.saving') : t('common.save')}
          </button>
        </div>
      </form>
    </div>
  )
}

// Tiny wrappers so the modal stays self-contained without dragging in
// shared hooks. Identical pattern to AdminItems queries.
function useQueriesSubjects() {
  return useQueries({
    queries: [
      {
        queryKey: ['subjects'],
        queryFn: () => api.subjects.list(),
      },
    ],
  })[0]
}
function useQueriesCategories() {
  return useQueries({
    queries: [
      {
        queryKey: ['categories'],
        queryFn: () => api.categories.list(),
      },
    ],
  })[0]
}
