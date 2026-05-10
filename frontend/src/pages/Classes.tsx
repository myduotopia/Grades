import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { useAuth } from '../auth/AuthProvider'
import {
  useClassrooms,
  useCreateClassroom,
  useDeleteClassroom,
  useUpdateClassroom,
} from '../hooks/useClassrooms'
import { ApiError, type Classroom } from '../lib/api'
import { supabase } from '../lib/supabase'

type ModalState =
  | { kind: 'closed' }
  | { kind: 'add' }
  | { kind: 'edit'; classroom: Classroom }

export function Classes() {
  const { t, i18n } = useTranslation()
  const { session } = useAuth()
  const { data, isLoading, isError, error, refetch } = useClassrooms()
  const [modal, setModal] = useState<ModalState>({ kind: 'closed' })

  const handleSignOut = () => supabase.auth.signOut()
  const toggleLang = () =>
    i18n.changeLanguage(i18n.language === 'zh-TW' ? 'en' : 'zh-TW')

  const classrooms = data?.data ?? []

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b">
        <div className="max-w-6xl mx-auto px-4 py-4 flex items-center justify-between">
          <h1 className="text-2xl font-bold text-gray-900">{t('classes.title')}</h1>
          <div className="flex items-center gap-3 text-sm">
            <span className="hidden sm:inline text-gray-600">{session?.user.email}</span>
            <button
              onClick={toggleLang}
              className="text-gray-600 hover:text-blue-600 font-medium"
            >
              {t('app.switch_lang')}
            </button>
            <button
              onClick={handleSignOut}
              className="text-gray-500 hover:text-red-600 font-medium"
            >
              {t('auth.sign_out')}
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 py-8">
        {isLoading && (
          <div className="text-center text-gray-500 py-12">{t('common.loading')}</div>
        )}

        {isError && (
          <div className="bg-red-50 border border-red-200 text-red-700 rounded p-4 flex items-center justify-between">
            <span>
              {t('common.error_generic')}: {error instanceof Error ? error.message : ''}
            </span>
            <button
              onClick={() => refetch()}
              className="text-sm font-medium text-red-700 hover:text-red-900 underline"
            >
              {t('common.retry')}
            </button>
          </div>
        )}

        {!isLoading && !isError && classrooms.length === 0 && (
          <EmptyState onManualAdd={() => setModal({ kind: 'add' })} />
        )}

        {!isLoading && !isError && classrooms.length > 0 && (
          <>
            <div className="flex justify-end mb-4">
              <button
                onClick={() => setModal({ kind: 'add' })}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white rounded font-medium transition-colors"
              >
                {t('classes.cta.add_manual')}
              </button>
            </div>
            <ClassroomGrid
              classrooms={classrooms}
              onEdit={(c) => setModal({ kind: 'edit', classroom: c })}
            />
          </>
        )}
      </main>

      {modal.kind !== 'closed' && (
        <ClassroomModal
          mode={modal.kind}
          classroom={modal.kind === 'edit' ? modal.classroom : undefined}
          onClose={() => setModal({ kind: 'closed' })}
        />
      )}
    </div>
  )
}

function EmptyState({ onManualAdd }: { onManualAdd: () => void }) {
  const { t } = useTranslation()
  return (
    <section className="bg-white rounded-lg shadow-sm border p-8 text-center max-w-3xl mx-auto">
      <h2 className="text-xl font-semibold text-gray-900 mb-2">
        {t('classes.empty.heading')}
      </h2>
      <p className="text-gray-600 mb-8">{t('classes.empty.subheading')}</p>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <CtaCard
          title={t('classes.cta.import_classroom')}
          subtitle={t('classes.cta.classroom_disabled')}
          disabled
        />
        <CtaCard
          title={t('classes.cta.import_duotopia')}
          subtitle={t('classes.cta.duotopia_disabled')}
          disabled
        />
        <CtaCard
          title={t('classes.cta.add_manual')}
          subtitle={t('classes.cta.add_manual_hint')}
          onClick={onManualAdd}
        />
      </div>
    </section>
  )
}

function CtaCard({
  title,
  subtitle,
  onClick,
  disabled,
}: {
  title: string
  subtitle: string
  onClick?: () => void
  disabled?: boolean
}) {
  const base =
    'border rounded-lg p-5 text-left transition-colors flex flex-col gap-1 h-full'
  const enabled =
    'bg-white border-gray-200 hover:border-blue-400 hover:bg-blue-50 cursor-pointer'
  const off = 'bg-gray-50 border-gray-200 text-gray-400 cursor-not-allowed'
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={disabled ? subtitle : undefined}
      className={`${base} ${disabled ? off : enabled}`}
    >
      <span className="font-semibold">{title}</span>
      <span className="text-sm">{subtitle}</span>
    </button>
  )
}

function ClassroomGrid({
  classrooms,
  onEdit,
}: {
  classrooms: Classroom[]
  onEdit: (c: Classroom) => void
}) {
  const { t } = useTranslation()
  const del = useDeleteClassroom()

  return (
    <ul className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
      {classrooms.map((c) => (
        <li
          key={c.id}
          className="bg-white border border-gray-200 rounded-lg p-5 shadow-sm flex flex-col gap-3"
        >
          <div className="flex items-start justify-between gap-2">
            <h3 className="font-semibold text-gray-900 break-all">{c.name}</h3>
            <span className="shrink-0 text-xs uppercase tracking-wide text-gray-500 border border-gray-200 rounded px-2 py-0.5">
              {t(`classes.source.${c.source}`)}
            </span>
          </div>
          <div className="mt-auto flex gap-2 text-sm">
            <button
              onClick={() => onEdit(c)}
              className="text-blue-600 hover:text-blue-800 font-medium"
            >
              {t('classes.actions.edit')}
            </button>
            <button
              onClick={() => {
                if (window.confirm(t('classes.actions.confirm_delete', { name: c.name }))) {
                  del.mutate(c.id)
                }
              }}
              className="text-red-600 hover:text-red-800 font-medium"
            >
              {t('classes.actions.delete')}
            </button>
          </div>
        </li>
      ))}
    </ul>
  )
}

function ClassroomModal({
  mode,
  classroom,
  onClose,
}: {
  mode: 'add' | 'edit'
  classroom?: Classroom
  onClose: () => void
}) {
  const { t } = useTranslation()
  const create = useCreateClassroom()
  const update = useUpdateClassroom()
  const [name, setName] = useState(classroom?.name ?? '')
  const [errKey, setErrKey] = useState<string | null>(null)

  const submitting = create.isPending || update.isPending

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setErrKey(null)
    try {
      if (mode === 'add') {
        await create.mutateAsync({ name })
      } else if (classroom) {
        await update.mutateAsync({ id: classroom.id, name })
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
      className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50"
      onClick={onClose}
    >
      <form
        onSubmit={onSubmit}
        onClick={(e) => e.stopPropagation()}
        className="bg-white rounded-lg shadow-lg p-6 w-full max-w-md"
      >
        <h2 className="text-lg font-semibold mb-4">
          {t(mode === 'add' ? 'classes.modal.add_title' : 'classes.modal.edit_title')}
        </h2>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          {t('classes.modal.name_label')}
        </label>
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          maxLength={200}
          className="w-full border border-gray-300 rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        {errKey && <p className="mt-2 text-sm text-red-600">{t(errKey)}</p>}
        <div className="mt-6 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-gray-700 hover:bg-gray-100 rounded font-medium"
          >
            {t('common.cancel')}
          </button>
          <button
            type="submit"
            disabled={submitting || name.trim().length === 0}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 active:bg-blue-800 disabled:bg-gray-300 text-white rounded font-medium transition-colors"
          >
            {t('common.save')}
          </button>
        </div>
      </form>
    </div>
  )
}
