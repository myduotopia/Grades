import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { ItemNameCombobox } from '../components/ItemNameCombobox'
import { useMe } from '../hooks/useMe'
import { useSemesters } from '../hooks/useSemesters'
import { PageContainer } from '../layout/PageContainer'
import { PageHeader } from '../layout/PageHeader'
import {
  api,
  ApiError,
  type ItemCreatePayload,
  type ItemDetail,
  type ItemFilters,
} from '../lib/api'

const PRIMARY_BTN =
  'inline-flex items-center px-4 py-2 rounded-lg bg-amber-500 hover:bg-amber-600 active:bg-amber-700 text-white text-sm font-medium shadow-sm transition-colors disabled:bg-slate-300 disabled:shadow-none disabled:cursor-not-allowed'

const SECONDARY_BTN =
  'inline-flex items-center px-4 py-2 rounded-lg bg-white border border-slate-200 hover:border-slate-300 hover:bg-slate-50 text-slate-700 text-sm font-medium shadow-sm transition-colors disabled:opacity-60 disabled:cursor-not-allowed'

const SELECT_CLS =
  'border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-amber-500'

const CATEGORY_KEYS = [
  'major_exam',
  'quiz',
  'homework',
  'attendance',
  'extra',
] as const

// Names used when category = major_exam. Stored as-is in the item.name field.
const MAJOR_EXAM_NAMES = ['期中考', '期末考', '第一次', '第二次', '第三次']

// localStorage keys for "remember last selection" in the new-item modal.
const LS_LAST_SUBJECT = 'admin_items.modal.last_subject_id'
const LS_LAST_CATEGORY = 'admin_items.modal.last_category_id'

function semesterLabel(s: { academic_year: number; term: number }): string {
  return `${s.academic_year}-${s.term}`
}

export function AdminItems() {
  const { t } = useTranslation()
  const qc = useQueryClient()

  const semestersQ = useSemesters()
  const subjectsQ = useQuery({
    queryKey: ['subjects'],
    queryFn: () => api.subjects.list(),
  })
  const categoriesQ = useQuery({
    queryKey: ['categories'],
    queryFn: () => api.categories.list(),
  })

  const semesters = semestersQ.data?.data ?? []
  const subjects = subjectsQ.data?.data ?? []
  const categories = categoriesQ.data?.data ?? []

  const currentSemester = useMemo(
    () => semesters.find((s) => s.is_current),
    [semesters],
  )

  // Semester is governed by the global SemesterSwitcher (top bar). The page
  // always shows items belonging to the current semester; classroom / subject
  // / category remain as in-page filters.
  const [filters, setFilters] = useState<ItemFilters>({})
  const effectiveFilters = useMemo<ItemFilters>(
    () => ({ ...filters, semester_id: currentSemester?.id }),
    [filters, currentSemester],
  )
  const itemsQ = useQuery({
    queryKey: ['items', effectiveFilters],
    queryFn: () => api.items.list(effectiveFilters),
    enabled: !!currentSemester,
  })
  const rawItems = itemsQ.data?.data ?? []

  // Sort: teacher's stored order first, then anything new by created_at desc
  // so the most recent item lands at the top. Drag-reorder writes a fresh
  // full list back to user_settings.item_order.
  const meQ = useMe()
  const storedOrder: string[] = meQ.data?.item_order ?? []
  const items = useMemo(() => {
    const byId = new Map(rawItems.map((it) => [it.id, it] as const))
    const ordered: ItemDetail[] = []
    const seen = new Set<string>()
    for (const id of storedOrder) {
      const it = byId.get(id)
      if (it) {
        ordered.push(it)
        seen.add(id)
      }
    }
    const remaining = rawItems
      .filter((it) => !seen.has(it.id))
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
    return [...ordered, ...remaining]
  }, [rawItems, storedOrder])

  const [dragFrom, setDragFrom] = useState<number | null>(null)
  const orderMut = useMutation({
    mutationFn: (ids: string[]) => api.me.updateItemOrder(ids),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['me'] }),
  })
  function reorder(fromIdx: number, toIdx: number) {
    if (fromIdx === toIdx) return
    const next = [...items]
    const [moved] = next.splice(fromIdx, 1)
    next.splice(toIdx, 0, moved)
    orderMut.mutate(next.map((it) => it.id))
  }

  const [editing, setEditing] = useState<ItemDetail | null>(null)
  const [creating, setCreating] = useState(false)
  const [deleting, setDeleting] = useState<ItemDetail | null>(null)
  const [actionErr, setActionErr] = useState<string | null>(null)

  const subjectLabel = (s: { system_key: string | null; display_name: string | null }) =>
    s.system_key ? t(`subject.${s.system_key}`) : (s.display_name ?? '—')

  return (
    <PageContainer>
      <PageHeader
        title={t('admin_items.title')}
        subtitle={t('admin_items.subtitle')}
        actions={
          <button
            onClick={() => setCreating(true)}
            className={PRIMARY_BTN}
            disabled={
              semesters.length === 0 ||
              subjects.length === 0
            }
          >
            {t('admin_items.add')}
          </button>
        }
      />

      <section className="bg-white border border-slate-200 rounded-xl shadow-sm p-4 mb-4">
        <div className="flex flex-wrap gap-3 items-center">
          {currentSemester && (
            <span className="text-xs text-slate-500">
              {t('admin_items.filter.current_semester_hint', {
                label: semesterLabel(currentSemester),
              })}
            </span>
          )}
          <select
            value={filters.subject_id ?? ''}
            onChange={(e) =>
              setFilters((f) => ({ ...f, subject_id: e.target.value || undefined }))
            }
            className={SELECT_CLS}
          >
            <option value="">{t('admin_items.filter.all_subjects')}</option>
            {subjects.map((s) => (
              <option key={s.id} value={s.id}>
                {subjectLabel(s)}
              </option>
            ))}
          </select>
          <select
            value={filters.category_id ?? ''}
            onChange={(e) =>
              setFilters((f) => ({ ...f, category_id: e.target.value || undefined }))
            }
            className={SELECT_CLS}
          >
            <option value="">{t('admin_items.filter.all_categories')}</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {t(`category.${c.system_key}`)}
              </option>
            ))}
          </select>
          {(filters.subject_id || filters.category_id) && (
            <button
              onClick={() => setFilters({})}
              className={SECONDARY_BTN}
              type="button"
            >
              {t('admin_items.filter.clear')}
            </button>
          )}
        </div>
      </section>

      {itemsQ.isLoading && (
        <div className="text-center text-slate-400 py-16">
          {t('common.loading')}
        </div>
      )}

      {!itemsQ.isLoading && items.length === 0 && (
        <div className="text-center text-slate-400 py-16 bg-white border border-slate-200 rounded-xl">
          {t('admin_items.empty')}
        </div>
      )}

      {!itemsQ.isLoading && items.length > 0 && (
        <section className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
                <tr>
                  <th className="w-8 px-2 py-3" aria-hidden></th>
                  <th className="px-4 py-3 text-left font-medium">
                    {t('admin_items.col.subject')}
                  </th>
                  <th className="px-4 py-3 text-left font-medium">
                    {t('admin_items.col.category')}
                  </th>
                  <th className="px-4 py-3 text-left font-medium">
                    {t('admin_items.col.name')}
                  </th>
                  <th className="px-4 py-3 text-left font-medium">
                    {t('admin_items.col.grades')}
                  </th>
                  <th className="px-4 py-3 text-right font-medium">
                    {t('admin_items.col.actions')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {items.map((it, idx) => {
                  const dragging = dragFrom === idx
                  return (
                    <tr
                      key={it.id}
                      draggable
                      onDragStart={() => setDragFrom(idx)}
                      onDragOver={(e) => {
                        if (dragFrom !== null) e.preventDefault()
                      }}
                      onDrop={() => {
                        if (dragFrom !== null) reorder(dragFrom, idx)
                        setDragFrom(null)
                      }}
                      onDragEnd={() => setDragFrom(null)}
                      className={`border-b border-slate-100 last:border-b-0 cursor-grab ${
                        dragging ? 'opacity-50' : ''
                      }`}
                    >
                      <td
                        className="px-2 py-2.5 text-slate-300 text-center select-none"
                        aria-hidden
                        title={t('admin_items.drag_to_reorder')}
                      >
                        ⋮⋮
                      </td>
                      <td className="px-4 py-2.5 text-slate-900">
                        {it.subject_system_key
                          ? t(`subject.${it.subject_system_key}`)
                          : (it.subject_display_name ?? '—')}
                      </td>
                      <td className="px-4 py-2.5 text-slate-700">
                        {t(`category.${it.category_system_key}`)}
                      </td>
                      <td className="px-4 py-2.5 text-slate-900 font-medium">
                        {it.name || <span className="text-slate-400">—</span>}
                      </td>
                      <td className="px-4 py-2.5 text-slate-500 font-mono tabular-nums text-xs">
                        {it.grade_count}
                      </td>
                      <td className="px-4 py-2.5 text-right space-x-3">
                        <button
                          onClick={() => setEditing(it)}
                          className="text-amber-700 hover:text-amber-800 font-medium text-sm"
                        >
                          {t('admin_items.edit')}
                        </button>
                        <button
                          onClick={() => setDeleting(it)}
                          className="text-rose-600 hover:text-rose-800 font-medium text-sm"
                        >
                          {t('classes.actions.delete')}
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {actionErr && (
        <div className="mt-3 text-sm text-rose-600">{actionErr}</div>
      )}

      {(creating || editing) && (
        <ItemModal
          mode={editing ? 'edit' : 'create'}
          existing={editing}
          defaultSemesterId={
            filters.semester_id ?? currentSemester?.id ?? semesters[0]?.id ?? ''
          }
          subjects={subjects}
          categories={categories}
          onClose={() => {
            setCreating(false)
            setEditing(null)
          }}
          onSaved={() => qc.invalidateQueries({ queryKey: ['items'] })}
        />
      )}

      {deleting && (
        <DeleteModal
          item={deleting}
          onClose={() => setDeleting(null)}
          onConfirm={async () => {
            try {
              await api.items.remove(deleting.id)
              setDeleting(null)
              qc.invalidateQueries({ queryKey: ['items'] })
            } catch (err) {
              setActionErr(err instanceof Error ? err.message : 'unknown')
            }
          }}
        />
      )}
    </PageContainer>
  )
}

function ItemModal({
  mode,
  existing,
  defaultSemesterId,
  subjects,
  categories,
  onClose,
  onSaved,
}: {
  mode: 'create' | 'edit'
  existing: ItemDetail | null
  defaultSemesterId: string
  subjects: { id: string; system_key: string | null; display_name: string | null }[]
  categories: { id: string; system_key: string }[]
  onClose: () => void
  onSaved: () => void
}) {
  const { t } = useTranslation()
  // Restore the last-used subject / category from localStorage so the teacher
  // doesn't have to re-pick after every new item. Only used in create mode;
  // edit mode is always the existing values.
  const lastSubject =
    typeof window !== 'undefined'
      ? localStorage.getItem(LS_LAST_SUBJECT)
      : null
  const lastCategory =
    typeof window !== 'undefined'
      ? localStorage.getItem(LS_LAST_CATEGORY)
      : null
  const [subjectId, setSubjectId] = useState(
    existing?.subject_id ??
      (lastSubject && subjects.some((s) => s.id === lastSubject)
        ? lastSubject
        : (subjects[0]?.id ?? '')),
  )
  const [categoryId, setCategoryId] = useState(
    existing?.category_id ??
      (lastCategory && categories.some((c) => c.id === lastCategory)
        ? lastCategory
        : (categories.find((c) => c.system_key === 'quiz')?.id ??
          categories[0]?.id ??
          '')),
  )
  // Semester is governed by the global top-bar switcher — no per-modal UI.
  // Parent passes the current semester id via defaultSemesterId.
  const semesterId = existing?.semester_id ?? defaultSemesterId
  const [name, setName] = useState(existing?.name ?? '')
  const [errKey, setErrKey] = useState<string | null>(null)

  // Fetch every item the teacher owns so we can suggest existing names for
  // the same subject + category combination (e.g. "Quiz 3" already created
  // for 6A — when adding to 6B, the teacher should be able to pick it from
  // the suggestions instead of retyping).
  const allItemsQ = useQuery({
    queryKey: ['items', { _all: true }],
    queryFn: () => api.items.list({}),
    enabled: mode === 'create',
  })
  const nameSuggestions = useMemo(() => {
    if (mode !== 'create') return []
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
  }, [allItemsQ.data, subjectId, categoryId, mode])

  const selectedCategoryKey =
    categories.find((c) => c.id === categoryId)?.system_key ?? ''
  const isMajorExam = selectedCategoryKey === 'major_exam'

  const createMut = useMutation({
    mutationFn: (body: ItemCreatePayload) => api.items.create(body),
    onSuccess: () => {
      // Remember the just-used subject + category for next time.
      try {
        localStorage.setItem(LS_LAST_SUBJECT, subjectId)
        localStorage.setItem(LS_LAST_CATEGORY, categoryId)
      } catch {
        // Ignore quota / privacy-mode errors — the rest of the flow still works.
      }
      onSaved()
      onClose()
    },
    onError: (err) => {
      if (err instanceof ApiError && err.body?.message_key) {
        setErrKey(err.body.message_key)
      } else {
        setErrKey('common.error_generic')
      }
    },
  })
  const updateMut = useMutation({
    mutationFn: ({ id, name: n }: { id: string; name: string }) =>
      api.items.update(id, { name: n }),
    onSuccess: () => {
      onSaved()
      onClose()
    },
    onError: (err) => {
      if (err instanceof ApiError && err.body?.message_key) {
        setErrKey(err.body.message_key)
      } else {
        setErrKey('common.error_generic')
      }
    },
  })

  const saving = createMut.isPending || updateMut.isPending

  function submit(e: React.FormEvent) {
    e.preventDefault()
    setErrKey(null)
    if (mode === 'edit' && existing) {
      updateMut.mutate({ id: existing.id, name: name.trim() })
      return
    }
    if (!subjectId || !categoryId || !semesterId) {
      setErrKey('admin_items.error.missing_fields')
      return
    }
    createMut.mutate({
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
        className="bg-white rounded-2xl shadow-xl border border-slate-200 p-6 w-full max-w-lg"
      >
        <h2 className="text-lg font-semibold tracking-tight mb-4 text-slate-900">
          {mode === 'edit'
            ? t('admin_items.modal.edit_title')
            : t('admin_items.modal.add_title')}
        </h2>

        <div className="space-y-3">
          <Row label={t('admin_items.modal.subject')}>
            <select
              value={subjectId}
              onChange={(e) => setSubjectId(e.target.value)}
              disabled={mode === 'edit'}
              className={SELECT_CLS + ' w-full disabled:bg-slate-100'}
            >
              {subjects.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.system_key ? t(`subject.${s.system_key}`) : s.display_name}
                </option>
              ))}
            </select>
          </Row>
          <Row label={t('admin_items.modal.category')}>
            <select
              value={categoryId}
              onChange={(e) => {
                setCategoryId(e.target.value)
                // Reset name if switching to/from major_exam.
                if (
                  categories.find((c) => c.id === e.target.value)?.system_key ===
                  'major_exam'
                ) {
                  if (!MAJOR_EXAM_NAMES.includes(name))
                    setName(MAJOR_EXAM_NAMES[0])
                } else if (
                  MAJOR_EXAM_NAMES.includes(name) &&
                  mode === 'create'
                ) {
                  setName('')
                }
              }}
              disabled={mode === 'edit'}
              className={SELECT_CLS + ' w-full disabled:bg-slate-100'}
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
          </Row>
          <Row label={t('admin_items.modal.name')}>
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
          </Row>
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
            disabled={saving}
            className={PRIMARY_BTN}
          >
            {saving ? t('common.saving') : t('common.save')}
          </button>
        </div>
      </form>
    </div>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-sm font-medium text-slate-700 mb-1">
        {label}
      </label>
      {children}
    </div>
  )
}

function DeleteModal({
  item,
  onClose,
  onConfirm,
}: {
  item: ItemDetail
  onClose: () => void
  onConfirm: () => void
}) {
  const { t } = useTranslation()
  return (
    <div
      className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center p-4 z-50"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-white rounded-2xl shadow-xl border border-slate-200 p-6 w-full max-w-md"
      >
        <h2 className="text-lg font-semibold tracking-tight mb-3 text-slate-900">
          {t('admin_items.delete.title')}
        </h2>
        <p className="text-sm text-slate-700 mb-2">
          {t('admin_items.delete.confirm', {
            name: item.name || t(`category.${item.category_system_key}`),
          })}
        </p>
        <p className="text-sm text-rose-700 bg-rose-50 border border-rose-100 rounded-lg px-3 py-2">
          {t('admin_items.delete.warning', {
            grades: item.grade_count,
            points: item.point_record_count,
          })}
        </p>
        <div className="mt-6 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-slate-700 hover:bg-slate-100 rounded-lg text-sm font-medium"
          >
            {t('common.cancel')}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="inline-flex items-center px-4 py-2 rounded-lg bg-rose-600 hover:bg-rose-700 text-white text-sm font-medium shadow-sm"
          >
            {t('common.delete')}
          </button>
        </div>
      </div>
    </div>
  )
}
