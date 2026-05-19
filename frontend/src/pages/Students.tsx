import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate, useParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'

import { StudentImportModal } from '../components/StudentImportModal'
import { PageContainer } from '../layout/PageContainer'
import { PageHeader } from '../layout/PageHeader'
import {
  studentsKey,
  useStudents,
  useCreateStudent,
  useUpdateStudent,
  useDeleteStudent,
} from '../hooks/useStudents'
import { api, ApiError, type Student } from '../lib/api'
import { classroomDisplayName } from '../lib/classroomFormat'

const PRIMARY_BTN =
  'inline-flex items-center px-4 py-2 rounded-lg bg-amber-500 hover:bg-amber-600 active:bg-amber-700 text-white text-sm font-medium shadow-sm transition-colors disabled:bg-slate-300'

const SECONDARY_BTN =
  'inline-flex items-center px-4 py-2 rounded-lg bg-white border border-slate-200 hover:border-slate-300 hover:bg-slate-50 text-slate-700 text-sm font-medium shadow-sm transition-colors disabled:opacity-60'

type View = 'list' | 'card'
type Modal =
  | { kind: 'closed' }
  | { kind: 'add' }
  | { kind: 'edit'; student: Student }
  | { kind: 'import' }

const VIEW_KEY = 'students.view'

export function Students() {
  const { t, i18n } = useTranslation()
  const { classroomId } = useParams<{ classroomId: string }>()
  const navigate = useNavigate()

  const qc = useQueryClient()
  const classroomQ = useQuery({
    queryKey: ['classroom', classroomId],
    queryFn: () => api.classrooms.get(classroomId as string),
    enabled: !!classroomId,
  })
  const { data, isLoading, isError, error, refetch } = useStudents(classroomId)

  const [view, setView] = useState<View>(
    (localStorage.getItem(VIEW_KEY) as View) || 'list',
  )
  const [modal, setModal] = useState<Modal>({ kind: 'closed' })

  useEffect(() => {
    localStorage.setItem(VIEW_KEY, view)
  }, [view])

  if (!classroomId) return null

  const students = data?.data ?? []
  const isEmpty = !isLoading && !isError && students.length === 0
  const classroom = classroomQ.data

  return (
    <PageContainer>
      <PageHeader
        title={
          classroom
            ? classroomDisplayName(classroom.grade, classroom.name, i18n.language)
            : t('students.title')
        }
        subtitle={t('students.subtitle')}
        actions={
          <div className="flex flex-wrap items-center gap-2 sm:justify-end">
            <button
              onClick={() => navigate('/classes')}
              className={SECONDARY_BTN}
              aria-label={t('students.back_to_classes')}
            >
              {t('students.back_to_classes')}
            </button>
            <button
              onClick={() => setModal({ kind: 'import' })}
              className={SECONDARY_BTN}
            >
              {t('students.actions.import')}
            </button>
            <button
              onClick={() => setModal({ kind: 'add' })}
              className={PRIMARY_BTN}
            >
              {t('students.actions.add')}
            </button>
          </div>
        }
      />

      {!isLoading && !isError && students.length > 0 && (
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
            {t('students.view.list')}
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
            {t('students.view.card')}
          </button>
        </div>
      )}

      {isLoading && (
        <div className="text-center text-slate-400 py-16">
          {t('common.loading')}
        </div>
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
        <div className="bg-white border border-slate-200 rounded-xl p-8 lg:p-12 text-center">
          <h2 className="text-lg font-semibold text-slate-900 tracking-tight mb-2">
            {t('students.empty.heading')}
          </h2>
          <p className="text-sm text-slate-500 mb-6">
            {t('students.empty.subheading')}
          </p>
          <div className="flex flex-wrap justify-center gap-2">
            <button
              onClick={() => setModal({ kind: 'import' })}
              className={SECONDARY_BTN}
            >
              {t('students.actions.import')}
            </button>
            <button
              onClick={() => setModal({ kind: 'add' })}
              className={PRIMARY_BTN}
            >
              {t('students.actions.add')}
            </button>
          </div>
        </div>
      )}

      {!isLoading && !isError && students.length > 0 && view === 'list' && (
        <StudentTable
          students={students}
          onEdit={(s) => setModal({ kind: 'edit', student: s })}
        />
      )}

      {!isLoading && !isError && students.length > 0 && view === 'card' && (
        <StudentCards
          students={students}
          onEdit={(s) => setModal({ kind: 'edit', student: s })}
        />
      )}

      {modal.kind === 'add' && (
        <StudentModal
          mode="add"
          classroomId={classroomId}
          onClose={() => setModal({ kind: 'closed' })}
        />
      )}
      {modal.kind === 'edit' && (
        <StudentModal
          mode="edit"
          classroomId={classroomId}
          student={modal.student}
          onClose={() => setModal({ kind: 'closed' })}
        />
      )}
      {modal.kind === 'import' && (
        <StudentImportModal
          classroomId={classroomId}
          onClose={() => setModal({ kind: 'closed' })}
          onComplete={() =>
            qc.invalidateQueries({ queryKey: studentsKey(classroomId) })
          }
        />
      )}
    </PageContainer>
  )
}

// ---------- list view ----------

function StudentTable({
  students,
  onEdit,
}: {
  students: Student[]
  onEdit: (s: Student) => void
}) {
  const { t } = useTranslation()
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
              <th className="px-4 py-3 text-left font-medium">
                {t('students.col.email')}
              </th>
              <th className="px-4 py-3 text-right font-medium">
                {t('students.col.actions')}
              </th>
            </tr>
          </thead>
          <tbody>
            {students.map((s) => (
              <tr key={s.id} className="border-b border-slate-100 last:border-b-0">
                <td className="px-4 py-3 text-slate-900 font-medium">
                  {s.seat_number}
                </td>
                <td className="px-4 py-3 text-slate-700">
                  {s.name || <span className="text-slate-400">—</span>}
                </td>
                <td className="px-4 py-3 text-slate-500 break-all">
                  {s.email || <span className="text-slate-400">—</span>}
                </td>
                <td className="px-4 py-3 text-right">
                  <button
                    onClick={() => onEdit(s)}
                    className="text-amber-700 hover:text-amber-900 font-medium text-sm"
                  >
                    {t('students.actions.edit')}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ---------- card view ----------

function StudentCards({
  students,
  onEdit,
}: {
  students: Student[]
  onEdit: (s: Student) => void
}) {
  const { t } = useTranslation()
  return (
    <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
      {students.map((s) => (
        <li
          key={s.id}
          className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm hover:shadow-md hover:border-slate-300 transition-all flex flex-col gap-3"
        >
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-full bg-amber-100 text-amber-700 flex items-center justify-center font-semibold text-sm">
              {s.seat_number}
            </div>
            <div className="min-w-0 flex-1">
              <h3 className="font-semibold text-slate-900 tracking-tight truncate">
                {s.name || t('students.no_name')}
              </h3>
              <p className="text-xs text-slate-500 truncate">
                {s.email || '—'}
              </p>
            </div>
          </div>
          <div className="mt-auto pt-2 border-t border-slate-100 flex justify-end">
            <button
              onClick={() => onEdit(s)}
              className="text-amber-700 hover:text-amber-900 font-medium text-sm"
            >
              {t('students.actions.edit')}
            </button>
          </div>
        </li>
      ))}
    </ul>
  )
}

// ---------- add / edit modal ----------

type ModalProps = {
  mode: 'add' | 'edit'
  classroomId: string
  student?: Student
  onClose: () => void
}

function StudentModal({ mode, classroomId, student, onClose }: ModalProps) {
  const { t } = useTranslation()
  const create = useCreateStudent(classroomId)
  const update = useUpdateStudent(classroomId)
  const del = useDeleteStudent(classroomId)

  const [seat, setSeat] = useState<number | ''>(student?.seat_number ?? '')
  const [name, setName] = useState(student?.name ?? '')
  const [email, setEmail] = useState(student?.email ?? '')
  const [errKey, setErrKey] = useState<string | null>(null)

  const submitting = create.isPending || update.isPending || del.isPending
  const canSubmit = seat !== '' && !submitting

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (seat === '') return
    setErrKey(null)
    try {
      const body = {
        seat_number: Number(seat),
        name: name.trim() || null,
        email: email.trim() || null,
      }
      if (mode === 'add') {
        await create.mutateAsync(body)
      } else if (student) {
        await update.mutateAsync({ id: student.id, body })
      }
      onClose()
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        setErrKey('students.errors.duplicate_seat')
      } else {
        setErrKey('common.error_generic')
      }
    }
  }

  async function onDelete() {
    if (!student) return
    if (!window.confirm(t('students.confirm_delete', { seat: student.seat_number }))) {
      return
    }
    try {
      await del.mutateAsync(student.id)
      onClose()
    } catch {
      setErrKey('common.error_generic')
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
        className="bg-white rounded-2xl shadow-xl border border-slate-200 p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto"
      >
        <h2 className="text-lg font-semibold tracking-tight mb-4 text-slate-900">
          {t(mode === 'add' ? 'students.modal.add_title' : 'students.modal.edit_title')}
        </h2>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <label className="block">
            <span className="text-sm font-medium text-slate-700 mb-1.5 block">
              {t('students.col.seat')} *
            </span>
            <input
              type="number"
              inputMode="numeric"
              min={1}
              max={99}
              autoFocus
              value={seat}
              onChange={(e) =>
                setSeat(e.target.value === '' ? '' : Number(e.target.value))
              }
              required
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500"
            />
          </label>
          <label className="block sm:col-span-2">
            <span className="text-sm font-medium text-slate-700 mb-1.5 block">
              {t('students.col.name')}
            </span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={200}
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500"
            />
          </label>
        </div>

        <label className="block mt-3">
          <span className="text-sm font-medium text-slate-700 mb-1.5 block">
            {t('students.col.email')}
          </span>
          <input
            type="email"
            inputMode="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            maxLength={255}
            className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500"
          />
        </label>

        {errKey && <p className="mt-3 text-sm text-rose-600">{t(errKey)}</p>}

        <div className="mt-6 flex justify-between gap-2">
          {mode === 'edit' ? (
            <button
              type="button"
              onClick={onDelete}
              className="px-4 py-2 text-rose-600 hover:bg-rose-50 rounded-lg text-sm font-medium"
            >
              {t('students.actions.delete')}
            </button>
          ) : (
            <div />
          )}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-slate-700 hover:bg-slate-100 rounded-lg text-sm font-medium"
            >
              {t('common.cancel')}
            </button>
            <button type="submit" disabled={!canSubmit} className={PRIMARY_BTN}>
              {t('common.save')}
            </button>
          </div>
        </div>
      </form>
    </div>
  )
}
