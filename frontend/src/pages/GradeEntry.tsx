import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate, useParams } from 'react-router-dom'
import {
  useMutation,
  useQueries,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'

import { ItemNameCombobox } from '../components/ItemNameCombobox'
import { useSemesters } from '../hooks/useSemesters'
import {
  api,
  ApiError,
  type ItemCreatePayload,
} from '../lib/api'

const MAJOR_EXAM_NAMES = ['期中考', '期末考', '第一次', '第二次', '第三次']

// Shared with /admin/items modal so the teacher's last subject + category
// choice persists across both entry points.
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

const SELECT_CLS =
  'border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-amber-500'

/**
 * /classes/:classroomId/grades/entry
 *
 * Thin "pick an item, then go" router. Used by the Classes-card row action.
 * Auto-opens the modal; on pick, navigates to /classes/:id/grades?edit=<id>
 * so the by-subject view opens that item's column in inline-edit. Cancel
 * goes back. The multi-item entry matrix that lived here in v0 was removed
 * once /grades grew inline editing — there's no need for a second surface.
 */
export function GradeEntry() {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { classroomId } = useParams<{ classroomId: string }>()

  if (!classroomId) return null

  async function gotoEdit(itemId: string) {
    // Activate the (classroom, item) so the destination grades page actually
    // shows the column (server filters items by classroom_item — without
    // this, picking an item via the modal would land on a page that hides
    // the column and the ?edit=<id> deep-link would no-op).
    try {
      await api.classrooms.activateItem(classroomId as string, itemId)
      qc.invalidateQueries({ queryKey: ['grades'] })
    } catch {
      // Surface failure indirectly — the destination page will simply not
      // show the column. Better to navigate anyway than to dead-end.
    }
    navigate(`/classes/${classroomId}/grades?edit=${itemId}`, {
      replace: true,
    })
  }

  return (
    <AddItemModal
      onClose={() => navigate(-1)}
      onPicked={(itemId) => gotoEdit(itemId)}
    />
  )
}

function AddItemModal({
  onClose,
  onPicked,
}: {
  onClose: () => void
  onPicked: (itemId: string) => void
}) {
  const { t } = useTranslation()
  const qc = useQueryClient()
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
  const semesterId = currentSemester?.id ?? ''
  const [name, setName] = useState('')
  const [errKey, setErrKey] = useState<string | null>(null)

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

  function rememberPicks() {
    try {
      localStorage.setItem(LS_LAST_SUBJECT, subjectId)
      localStorage.setItem(LS_LAST_CATEGORY, categoryId)
    } catch {
      // Ignore quota / privacy-mode errors.
    }
  }

  const create = useMutation({
    mutationFn: (body: ItemCreatePayload) => api.items.create(body),
    onSuccess: (item) => {
      rememberPicks()
      // Drop cached grades/items so the destination page (/classes/:id/grades)
      // refetches and includes the newly-created item column without forcing
      // the teacher to refresh manually.
      qc.invalidateQueries({ queryKey: ['grades'] })
      qc.invalidateQueries({ queryKey: ['items'] })
      onPicked(item.id)
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
    const finalName = name.trim()
    // Items are cross-classroom — reuse if one already exists rather than
    // POSTing a duplicate (which would 409).
    const existing = allItemsQ.data?.data.find(
      (it) =>
        it.subject_id === subjectId &&
        it.category_id === categoryId &&
        it.semester_id === semesterId &&
        it.name === finalName,
    )
    if (existing) {
      rememberPicks()
      onPicked(existing.id)
      return
    }
    create.mutate({
      subject_id: subjectId,
      category_id: categoryId,
      semester_id: semesterId,
      name: finalName,
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
          {t('grade_entry.modal.pick_subtitle')}
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

function useQueriesSubjects() {
  return useQueries({
    queries: [{ queryKey: ['subjects'], queryFn: () => api.subjects.list() }],
  })[0]
}
function useQueriesCategories() {
  return useQueries({
    queries: [
      { queryKey: ['categories'], queryFn: () => api.categories.list() },
    ],
  })[0]
}
