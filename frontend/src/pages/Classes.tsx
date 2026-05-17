import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate } from 'react-router-dom'

import { ActionCard } from '../components/ActionCard'
import { GradeImportModal } from '../components/GradeImportModal'
import { StudentImportModal } from '../components/StudentImportModal'
import {
  useClassrooms,
  useCreateClassroom,
  useDeleteClassroom,
  useUpdateClassroom,
} from '../hooks/useClassrooms'
import { PageContainer } from '../layout/PageContainer'
import { PageHeader } from '../layout/PageHeader'
import { ApiError, type Classroom } from '../lib/api'
import { classroomDisplayName, gradeLabel } from '../lib/classroomFormat'

type ModalState =
  | { kind: 'closed' }
  | { kind: 'add' }
  | { kind: 'edit'; classroom: Classroom }
  | { kind: 'import-students'; classroomId: string }
  | { kind: 'import-grades'; classroomId: string }

type View = 'list' | 'card'
const VIEW_KEY = 'classes.view'

const PRIMARY_BTN =
  'inline-flex items-center px-4 py-2 rounded-lg bg-amber-500 hover:bg-amber-600 active:bg-amber-700 text-white text-sm font-medium shadow-sm transition-colors disabled:bg-slate-300 disabled:shadow-none'

const SECONDARY_BTN =
  'inline-flex items-center px-4 py-2 rounded-lg bg-white border border-slate-200 hover:border-slate-300 hover:bg-slate-50 text-slate-700 text-sm font-medium shadow-sm transition-colors disabled:opacity-60 disabled:cursor-not-allowed disabled:hover:bg-white disabled:hover:border-slate-200'

export function Classes() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { data, isLoading, isError, error, refetch } = useClassrooms()
  const [modal, setModal] = useState<ModalState>({ kind: 'closed' })
  const [view, setView] = useState<View>(
    (localStorage.getItem(VIEW_KEY) as View) || 'card',
  )

  useEffect(() => {
    localStorage.setItem(VIEW_KEY, view)
  }, [view])

  const classrooms = data?.data ?? []
  const isEmpty = !isLoading && !isError && classrooms.length === 0

  return (
    <PageContainer>
      <PageHeader
        title={t('classes.title')}
        subtitle={isEmpty ? t('classes.empty.subheading') : t('classes.subtitle')}
        actions={
          !isLoading && !isError && classrooms.length > 0 ? (
            <div className="flex flex-wrap items-center gap-2 sm:justify-end">
              <button
                disabled
                title={t('classes.cta.classroom_disabled')}
                className={SECONDARY_BTN}
              >
                <span className="sm:hidden">{t('classes.cta.import_classroom_short')}</span>
                <span className="hidden sm:inline">{t('classes.cta.import_classroom')}</span>
              </button>
              <button
                disabled
                title={t('classes.cta.duotopia_disabled')}
                className={SECONDARY_BTN}
              >
                <span className="sm:hidden">{t('classes.cta.import_duotopia_short')}</span>
                <span className="hidden sm:inline">{t('classes.cta.import_duotopia')}</span>
              </button>
              <button onClick={() => setModal({ kind: 'add' })} className={PRIMARY_BTN}>
                <span className="sm:hidden">{t('classes.cta.add_manual_short')}</span>
                <span className="hidden sm:inline">{t('classes.cta.add_manual')}</span>
              </button>
            </div>
          ) : undefined
        }
      />

      {!isLoading && !isError && classrooms.length > 0 && (
        <div className="flex items-center justify-end gap-1 mb-4">
          <button
            onClick={() => setView('list')}
            className={`px-3 py-1.5 text-sm rounded-md transition-colors ${
              view === 'list'
                ? 'bg-slate-900 text-white'
                : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'
            }`}
            aria-pressed={view === 'list'}
          >
            {t('classes.view.list')}
          </button>
          <button
            onClick={() => setView('card')}
            className={`px-3 py-1.5 text-sm rounded-md transition-colors ${
              view === 'card'
                ? 'bg-slate-900 text-white'
                : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'
            }`}
            aria-pressed={view === 'card'}
          >
            {t('classes.view.card')}
          </button>
        </div>
      )}

      {isLoading && (
        <div className="text-center text-slate-400 py-16">{t('common.loading')}</div>
      )}

      {isError && (
        <div className="bg-rose-50 border border-rose-200 text-rose-700 rounded-xl p-4 flex items-center justify-between">
          <span className="text-sm">
            {t('common.error_generic')}: {error instanceof Error ? error.message : ''}
          </span>
          <button
            onClick={() => refetch()}
            className="text-sm font-medium text-rose-700 hover:text-rose-900 underline"
          >
            {t('common.retry')}
          </button>
        </div>
      )}

      {isEmpty && (
        <section className="mb-10">
          <h2 className="text-sm font-semibold text-slate-500 uppercase tracking-wide mb-4">
            {t('classes.empty.options_heading')}
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <ActionCard
              disabled
              label={t('classes.cta.import_classroom')}
              hint={t('classes.cta.classroom_disabled')}
            />
            <ActionCard
              disabled
              label={t('classes.cta.import_duotopia')}
              hint={t('classes.cta.duotopia_disabled')}
            />
            <ActionCard
              primary
              label={t('classes.cta.add_manual')}
              hint={t('classes.cta.add_manual_hint')}
              onClick={() => setModal({ kind: 'add' })}
            />
          </div>
        </section>
      )}

      {!isLoading && !isError && classrooms.length > 0 && view === 'card' && (
        <ClassroomCards
          classrooms={classrooms}
          onEdit={(c) => setModal({ kind: 'edit', classroom: c })}
          onImportStudents={(c) =>
            setModal({ kind: 'import-students', classroomId: c.id })
          }
          onImportGrades={(c) =>
            setModal({ kind: 'import-grades', classroomId: c.id })
          }
          onOpen={(c) => navigate(`/classes/${c.id}/grades`)}
        />
      )}

      {!isLoading && !isError && classrooms.length > 0 && view === 'list' && (
        <ClassroomTable
          classrooms={classrooms}
          onEdit={(c) => setModal({ kind: 'edit', classroom: c })}
          onImportStudents={(c) =>
            setModal({ kind: 'import-students', classroomId: c.id })
          }
          onImportGrades={(c) =>
            setModal({ kind: 'import-grades', classroomId: c.id })
          }
          onOpen={(c) => navigate(`/classes/${c.id}/grades`)}
        />
      )}

      {(modal.kind === 'add' || modal.kind === 'edit') && (
        <ClassroomModal
          mode={modal.kind}
          classroom={modal.kind === 'edit' ? modal.classroom : undefined}
          onClose={() => setModal({ kind: 'closed' })}
        />
      )}
      {modal.kind === 'import-students' && (
        <StudentImportModal
          classroomId={modal.classroomId}
          onClose={() => setModal({ kind: 'closed' })}
        />
      )}
      {modal.kind === 'import-grades' && (
        <GradeImportModal
          classroomId={modal.classroomId}
          onClose={() => setModal({ kind: 'closed' })}
        />
      )}
    </PageContainer>
  )
}

// ---------- shared action helpers ----------

interface RowActionProps {
  classroom: Classroom
  onEdit: (c: Classroom) => void
  onImportStudents: (c: Classroom) => void
  onImportGrades: (c: Classroom) => void
  onDelete: (c: Classroom) => void
}

function RowActions({
  classroom,
  onEdit,
  onImportStudents,
  onImportGrades,
  onDelete,
}: RowActionProps) {
  const { t } = useTranslation()
  // Stop click bubbling so a row/card click doesn't navigate-to-grades.
  const stop = (e: React.MouseEvent) => e.stopPropagation()
  return (
    <>
      <Link
        to={`/classes/${classroom.id}/students`}
        onClick={stop}
        className="text-slate-700 hover:text-slate-900 font-medium"
      >
        {t('classes.actions.view_students')}
      </Link>
      <button
        onClick={(e) => {
          stop(e)
          onImportStudents(classroom)
        }}
        className="text-slate-700 hover:text-slate-900 font-medium"
      >
        {t('classes.actions.bulk_add_students')}
      </button>
      <button
        onClick={(e) => {
          stop(e)
          onImportGrades(classroom)
        }}
        className="text-slate-700 hover:text-slate-900 font-medium"
      >
        {t('classes.actions.import_grades')}
      </button>
      <Link
        to={`/classes/${classroom.id}/grades/entry`}
        onClick={stop}
        className="text-slate-700 hover:text-slate-900 font-medium"
      >
        {t('classes.actions.grade_entry')}
      </Link>
      <button
        onClick={(e) => {
          stop(e)
          onEdit(classroom)
        }}
        className="text-amber-700 hover:text-amber-900 font-medium"
      >
        {t('classes.actions.edit')}
      </button>
      <button
        onClick={(e) => {
          stop(e)
          onDelete(classroom)
        }}
        className="text-rose-600 hover:text-rose-800 font-medium"
      >
        {t('classes.actions.delete')}
      </button>
    </>
  )
}

// ---------- card view ----------

function ClassroomCards({
  classrooms,
  onEdit,
  onImportStudents,
  onImportGrades,
  onOpen,
}: {
  classrooms: Classroom[]
  onEdit: (c: Classroom) => void
  onImportStudents: (c: Classroom) => void
  onImportGrades: (c: Classroom) => void
  onOpen: (c: Classroom) => void
}) {
  const { t, i18n } = useTranslation()
  const del = useDeleteClassroom()

  const sorted = [...classrooms].sort(
    (a, b) => a.grade - b.grade || a.name.localeCompare(b.name),
  )

  function onDelete(c: Classroom) {
    const display = classroomDisplayName(c.grade, c.name, i18n.language)
    if (window.confirm(t('classes.actions.confirm_delete', { name: display }))) {
      del.mutate(c.id)
    }
  }

  return (
    <ul className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
      {sorted.map((c) => (
        <li
          key={c.id}
          onClick={() => onOpen(c)}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault()
              onOpen(c)
            }
          }}
          className="group cursor-pointer bg-white border border-slate-200 rounded-xl p-5 shadow-sm hover:shadow-md hover:border-amber-300 transition-all flex flex-col gap-4 focus:outline-none focus:ring-2 focus:ring-amber-500"
          aria-label={t('classes.open_grades_aria', {
            name: classroomDisplayName(c.grade, c.name, i18n.language),
          })}
        >
          <div className="flex items-start justify-between gap-2">
            <h3 className="font-semibold text-slate-900 break-all tracking-tight">
              {classroomDisplayName(c.grade, c.name, i18n.language)}
            </h3>
            <span className="shrink-0 text-[10px] uppercase tracking-wider text-slate-500 bg-slate-100 rounded-full px-2 py-1">
              {t(`classes.source.${c.source}`)}
            </span>
          </div>
          <div className="mt-auto flex flex-wrap gap-x-3 gap-y-1.5 text-sm border-t border-slate-100 pt-3">
            <RowActions
              classroom={c}
              onEdit={onEdit}
              onImportStudents={onImportStudents}
              onImportGrades={onImportGrades}
              onDelete={onDelete}
            />
          </div>
        </li>
      ))}
    </ul>
  )
}

// ---------- list view ----------

function ClassroomTable({
  classrooms,
  onEdit,
  onImportStudents,
  onImportGrades,
  onOpen,
}: {
  classrooms: Classroom[]
  onEdit: (c: Classroom) => void
  onImportStudents: (c: Classroom) => void
  onImportGrades: (c: Classroom) => void
  onOpen: (c: Classroom) => void
}) {
  const { t, i18n } = useTranslation()
  const del = useDeleteClassroom()

  const sorted = [...classrooms].sort(
    (a, b) => a.grade - b.grade || a.name.localeCompare(b.name),
  )

  function onDelete(c: Classroom) {
    const display = classroomDisplayName(c.grade, c.name, i18n.language)
    if (window.confirm(t('classes.actions.confirm_delete', { name: display }))) {
      del.mutate(c.id)
    }
  }

  return (
    <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
            <tr>
              <th className="px-4 py-3 text-left font-medium">
                {t('classes.col.name')}
              </th>
              <th className="px-4 py-3 text-left font-medium">
                {t('classes.col.source')}
              </th>
              <th className="px-4 py-3 text-left font-medium">
                {t('classes.col.actions')}
              </th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((c) => (
              <tr
                key={c.id}
                onClick={() => onOpen(c)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    onOpen(c)
                  }
                }}
                className="border-b border-slate-100 last:border-b-0 cursor-pointer hover:bg-slate-50 focus:outline-none focus:bg-amber-50"
              >
                <td className="px-4 py-3 text-slate-900 font-medium">
                  {classroomDisplayName(c.grade, c.name, i18n.language)}
                </td>
                <td className="px-4 py-3">
                  <span className="text-[10px] uppercase tracking-wider text-slate-500 bg-slate-100 rounded-full px-2 py-1">
                    {t(`classes.source.${c.source}`)}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <div className="flex flex-wrap gap-x-3 gap-y-1">
                    <RowActions
                      classroom={c}
                      onEdit={onEdit}
                      onImportStudents={onImportStudents}
                      onImportGrades={onImportGrades}
                      onDelete={onDelete}
                    />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ---------- add / edit modal (unchanged) ----------

function ClassroomModal({
  mode,
  classroom,
  onClose,
}: {
  mode: 'add' | 'edit'
  classroom?: Classroom
  onClose: () => void
}) {
  const { t, i18n } = useTranslation()
  const create = useCreateClassroom()
  const update = useUpdateClassroom()
  const [grade, setGrade] = useState<number | ''>(classroom?.grade ?? '')
  const [name, setName] = useState(classroom?.name ?? '')
  const [errKey, setErrKey] = useState<string | null>(null)

  const submitting = create.isPending || update.isPending
  const canSubmit = grade !== '' && name.trim().length > 0 && !submitting

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (grade === '') return
    setErrKey(null)
    try {
      if (mode === 'add') {
        await create.mutateAsync({ grade, name })
      } else if (classroom) {
        await update.mutateAsync({ id: classroom.id, grade, name })
      }
      onClose()
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        setErrKey('classes.errors.duplicate_name')
      } else {
        setErrKey('common.error_generic')
      }
    }
  }

  return (
    <div
      className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center p-4 z-50"
      onClick={onClose}
    >
      <form
        onSubmit={onSubmit}
        onClick={(e) => e.stopPropagation()}
        className="bg-white rounded-2xl shadow-xl border border-slate-200 p-6 w-full max-w-md"
      >
        <h2 className="text-lg font-semibold tracking-tight mb-4 text-slate-900">
          {t(mode === 'add' ? 'classes.modal.add_title' : 'classes.modal.edit_title')}
        </h2>

        <label className="block text-sm font-medium text-slate-700 mb-1.5">
          {t('classes.modal.grade_label')}
        </label>
        <select
          autoFocus
          value={grade}
          onChange={(e) =>
            setGrade(e.target.value === '' ? '' : Number(e.target.value))
          }
          required
          className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-amber-500 transition-colors bg-white"
        >
          <option value="" disabled>
            {t('classes.modal.grade_placeholder')}
          </option>
          {Array.from({ length: 12 }, (_, i) => i + 1).map((g) => (
            <option key={g} value={g}>
              {gradeLabel(g, i18n.language)}
            </option>
          ))}
        </select>

        <label className="block text-sm font-medium text-slate-700 mb-1.5 mt-4">
          {t('classes.modal.name_label')}
        </label>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          maxLength={200}
          placeholder={t('classes.modal.name_placeholder')}
          className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-amber-500 transition-colors"
        />

        {errKey && <p className="mt-2 text-sm text-rose-600">{t(errKey)}</p>}

        <div className="mt-6 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-slate-700 hover:bg-slate-100 rounded-lg text-sm font-medium transition-colors"
          >
            {t('common.cancel')}
          </button>
          <button type="submit" disabled={!canSubmit} className={PRIMARY_BTN}>
            {t('common.save')}
          </button>
        </div>
      </form>
    </div>
  )
}
