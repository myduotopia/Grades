import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { ItemNameCombobox } from './ItemNameCombobox'
import { SignedNumberInput } from './SignedNumberInput'

// Quick-amount chips per mode (#215). 加點 is always positive (1..500),
// 扣點 always negative (-1..-500).
const ADD_PRESETS = [1, 5, 10, 20, 30, 40, 50, 100] as const
const DEDUCT_PRESETS = [-1, -5, -10, -20, -30, -40, -50, -100] as const

const PRIMARY_BTN =
  'inline-flex items-center px-4 py-2 rounded-lg bg-amber-500 hover:bg-amber-600 active:bg-amber-700 text-white text-sm font-medium shadow-sm transition-colors disabled:bg-slate-300 disabled:cursor-not-allowed'

const SECONDARY_BTN =
  'inline-flex items-center px-4 py-2 rounded-lg bg-white border border-slate-200 hover:border-slate-300 hover:bg-slate-50 text-slate-700 text-sm font-medium shadow-sm transition-colors disabled:opacity-60'

/**
 * Add / deduct points modal (#215). The teacher picks a reason — typed fresh
 * or chosen from previously-used reasons via the combobox — and an amount,
 * independently. A brand-new reason is auto-filed by the backend on submit.
 *
 * `mode` locks the sign: 'add' clamps the amount to 1..500 with + chips,
 * 'deduct' clamps to -500..-1 with − chips. `applyMode` only changes copy
 * (single student vs whole class).
 */
export function PointEntryModal({
  mode,
  applyMode,
  reasonSuggestions,
  pending,
  onClose,
  onConfirm,
}: {
  mode: 'add' | 'deduct'
  applyMode: 'class' | 'student'
  reasonSuggestions: string[]
  pending: boolean
  onClose: () => void
  onConfirm: (reason: string, points: number) => void
}) {
  const { t } = useTranslation()
  const presets = mode === 'add' ? ADD_PRESETS : DEDUCT_PRESETS
  const [reason, setReason] = useState('')
  const [pts, setPts] = useState<number>(presets[0])

  // Reset the amount default when the mode flips (the parent remounts via key
  // in practice, but stay defensive).
  useEffect(() => {
    setPts(presets[0])
    setReason('')
  }, [mode]) // eslint-disable-line react-hooks/exhaustive-deps

  // Reason can stay blank — the row just displays as 「—」. Amount must be a
  // valid non-zero value within the mode's sign.
  const canSubmit =
    !pending && pts !== 0 && (mode === 'add' ? pts > 0 : pts < 0)

  function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!canSubmit) return
    onConfirm(reason.trim(), pts)
  }

  const title =
    applyMode === 'class'
      ? mode === 'add'
        ? t('points.entry_modal.title_add_class')
        : t('points.entry_modal.title_deduct_class')
      : mode === 'add'
        ? t('points.entry_modal.title_add_student')
        : t('points.entry_modal.title_deduct_student')

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
          {title}
        </h2>

        <label className="block mb-3">
          <span className="block text-sm font-medium text-slate-700 mb-1">
            {t('points.entry_modal.reason_label')}
          </span>
          <ItemNameCombobox
            value={reason}
            onChange={setReason}
            suggestions={reasonSuggestions}
            maxLength={50}
            placeholder={t('points.entry_modal.reason_placeholder')}
          />
        </label>

        <label className="block mb-3">
          <span className="block text-sm font-medium text-slate-700 mb-1">
            {t('points.entry_modal.points_label')}
          </span>
          <SignedNumberInput
            value={pts}
            onChange={setPts}
            min={mode === 'add' ? 1 : -500}
            max={mode === 'add' ? 500 : -1}
            className="w-full border border-slate-300 rounded-lg px-3 py-2 text-base text-right font-semibold tabular-nums focus:outline-none focus:ring-2 focus:ring-amber-500"
          />
        </label>

        <div className="flex flex-wrap gap-1.5 mb-4">
          {presets.map((n) => (
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
          <button type="submit" disabled={!canSubmit} className={PRIMARY_BTN}>
            {pending
              ? t('common.saving')
              : mode === 'add'
                ? t('points.entry_modal.confirm_add')
                : t('points.entry_modal.confirm_deduct')}
          </button>
        </div>
      </form>
    </div>
  )
}
