import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { SignedNumberInput } from './SignedNumberInput'

const PRESETS = [-10, -5, -3, -1, 1, 3, 5, 10] as const

const PRIMARY_BTN =
  'inline-flex items-center px-4 py-2 rounded-lg bg-amber-500 hover:bg-amber-600 active:bg-amber-700 text-white text-sm font-medium shadow-sm transition-colors disabled:bg-slate-300 disabled:cursor-not-allowed'

const SECONDARY_BTN =
  'inline-flex items-center px-4 py-2 rounded-lg bg-white border border-slate-200 hover:border-slate-300 hover:bg-slate-50 text-slate-700 text-sm font-medium shadow-sm transition-colors disabled:opacity-60'

/**
 * Confirm-and-pick-points modal used by both /points (whole-class batch)
 * and /points/:classroomId (single-student). When `editableReason` is true,
 * the reason text is a free input (used by the "+ 自訂" button); otherwise
 * it's a read-only label and we just show preset + manual point chips.
 */
export function QuickPointModal({
  initialReason,
  initialPoints,
  editableReason,
  applyMode,
  pending,
  onClose,
  onConfirm,
}: {
  initialReason: string
  initialPoints: number
  editableReason: boolean
  /** 'class' = adds to every student in the class; 'student' = single. */
  applyMode: 'class' | 'student'
  pending: boolean
  onClose: () => void
  onConfirm: (reason: string, points: number) => void
}) {
  const { t } = useTranslation()
  const [reason, setReason] = useState(initialReason)
  const [pts, setPts] = useState<number>(initialPoints)

  useEffect(() => {
    setReason(initialReason)
    setPts(initialPoints)
  }, [initialReason, initialPoints])

  const canSubmit = pts !== 0 && reason.trim().length > 0 && !pending

  function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!canSubmit) return
    onConfirm(reason.trim(), pts)
  }

  return (
    <div
      className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center p-4 z-50"
      onClick={onClose}
    >
      <form
        onSubmit={submit}
        onClick={(e) => e.stopPropagation()}
        className="bg-white rounded-2xl shadow-xl border border-slate-200 p-6 w-full max-w-sm"
      >
        <h2 className="text-lg font-semibold tracking-tight mb-4 text-slate-900">
          {applyMode === 'class'
            ? t('points.quick_modal.title_apply_class')
            : t('points.quick_modal.title_apply_student')}
        </h2>

        <label className="block mb-3">
          <span className="block text-sm font-medium text-slate-700 mb-1">
            {t('points.quick_modal.reason_label')}
          </span>
          {editableReason ? (
            <input
              autoFocus
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              maxLength={50}
              placeholder={t('points.quick_modal.reason_placeholder')}
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500"
            />
          ) : (
            <div className="px-3 py-2 rounded-lg bg-slate-50 border border-slate-200 text-sm text-slate-900">
              {reason}
            </div>
          )}
        </label>

        <label className="block mb-3">
          <span className="block text-sm font-medium text-slate-700 mb-1">
            {t('points.quick_modal.points_label')}
          </span>
          <SignedNumberInput
            value={pts}
            onChange={setPts}
            className="w-full border border-slate-300 rounded-lg px-3 py-2 text-base text-right font-semibold tabular-nums focus:outline-none focus:ring-2 focus:ring-amber-500"
          />
        </label>

        <div className="flex flex-wrap gap-1.5 mb-4">
          {PRESETS.map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => setPts(n)}
              className={`text-xs font-medium px-2 py-1 rounded border ${
                pts === n
                  ? 'bg-amber-100 border-amber-300 text-amber-800'
                  : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
              }`}
            >
              {n > 0 ? `+${n}` : n}
            </button>
          ))}
        </div>

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={pending}
            className={SECONDARY_BTN}
          >
            {t('common.cancel')}
          </button>
          <button
            type="submit"
            disabled={!canSubmit}
            className={PRIMARY_BTN}
          >
            {pending
              ? t('common.saving')
              : applyMode === 'class'
                ? t('points.quick_modal.confirm_class')
                : t('points.quick_modal.confirm_student')}
          </button>
        </div>
      </form>
    </div>
  )
}
