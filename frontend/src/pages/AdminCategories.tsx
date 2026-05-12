import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  useCategories,
  useUpdateCategoryWeights,
} from '../hooks/useCategories'
import { PageContainer } from '../layout/PageContainer'
import { PageHeader } from '../layout/PageHeader'
import type { Category } from '../lib/api'

const PRIMARY_BTN =
  'inline-flex items-center px-4 py-2 rounded-lg bg-amber-500 hover:bg-amber-600 active:bg-amber-700 text-white text-sm font-medium shadow-sm transition-colors disabled:bg-slate-300 disabled:shadow-none disabled:cursor-not-allowed'

const SECONDARY_BTN =
  'inline-flex items-center px-4 py-2 rounded-lg bg-white border border-slate-200 hover:border-slate-300 hover:bg-slate-50 text-slate-700 text-sm font-medium shadow-sm transition-colors disabled:opacity-60 disabled:cursor-not-allowed'

const EXTRA_KEY = 'extra'

export function AdminCategories() {
  const { t } = useTranslation()
  const { data, isLoading, isError, error, refetch } = useCategories()
  const update = useUpdateCategoryWeights()
  const [draft, setDraft] = useState<Record<string, number>>({})
  const [saveErr, setSaveErr] = useState<string | null>(null)
  const [savedAt, setSavedAt] = useState<number | null>(null)

  const categories = data?.data ?? []

  // Re-init draft when server data arrives / changes
  useEffect(() => {
    if (categories.length > 0) {
      setDraft(Object.fromEntries(categories.map((c) => [c.system_key, c.weight])))
    }
  }, [data])

  const nonExtraSum = useMemo(
    () =>
      Object.entries(draft)
        .filter(([k]) => k !== EXTRA_KEY)
        .reduce((sum, [, w]) => sum + w, 0),
    [draft],
  )

  const dirty = useMemo(
    () => categories.some((c) => draft[c.system_key] !== c.weight),
    [categories, draft],
  )

  const sumOk = nonExtraSum === 100
  const canSave = dirty && sumOk && !update.isPending

  async function onSave() {
    setSaveErr(null)
    setSavedAt(null)
    try {
      await update.mutateAsync(
        Object.entries(draft).map(([system_key, weight]) => ({
          system_key,
          weight,
        })),
      )
      setSavedAt(Date.now())
    } catch (err) {
      setSaveErr(err instanceof Error ? err.message : 'unknown')
    }
  }

  function onReset() {
    setDraft(
      Object.fromEntries(categories.map((c) => [c.system_key, c.weight])),
    )
    setSaveErr(null)
    setSavedAt(null)
  }

  return (
    <PageContainer>
      <PageHeader
        title={t('admin_categories.title')}
        subtitle={t('admin_categories.subtitle')}
      />

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

      {!isLoading && !isError && categories.length > 0 && (
        <section className="bg-white border border-slate-200 rounded-xl shadow-sm">
          <ul className="divide-y divide-slate-100">
            {categories.map((c) => (
              <WeightRow
                key={c.system_key}
                category={c}
                value={draft[c.system_key] ?? 0}
                onChange={(w) =>
                  setDraft((d) => ({ ...d, [c.system_key]: w }))
                }
              />
            ))}
          </ul>

          <div className="border-t border-slate-100 px-5 py-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <SumIndicator sum={nonExtraSum} ok={sumOk} />

            <div className="flex items-center gap-2">
              {savedAt && (
                <span className="text-sm text-emerald-600">
                  {t('admin_categories.saved')}
                </span>
              )}
              <button
                onClick={onReset}
                disabled={!dirty || update.isPending}
                className={SECONDARY_BTN}
              >
                {t('common.reset')}
              </button>
              <button
                onClick={onSave}
                disabled={!canSave}
                className={PRIMARY_BTN}
                title={!sumOk ? t('admin_categories.sum_invalid_hint') : undefined}
              >
                {update.isPending ? t('common.saving') : t('common.save')}
              </button>
            </div>
          </div>

          {saveErr && (
            <div className="border-t border-rose-100 bg-rose-50 px-5 py-3 text-sm text-rose-700">
              {t('common.error_generic')}: {saveErr}
            </div>
          )}
        </section>
      )}
    </PageContainer>
  )
}

function WeightRow({
  category,
  value,
  onChange,
}: {
  category: Category
  value: number
  onChange: (w: number) => void
}) {
  const { t } = useTranslation()
  const isExtra = category.system_key === EXTRA_KEY

  return (
    <li className="px-5 py-4 flex items-center justify-between gap-4">
      <div className="min-w-0">
        <div className="font-medium text-slate-900 truncate">
          {t(`category.${category.system_key}`)}
        </div>
        {isExtra && (
          <div className="text-xs text-slate-500 mt-0.5">
            {t('admin_categories.extra_hint')}
          </div>
        )}
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <input
          type="number"
          inputMode="numeric"
          min={0}
          max={100}
          value={value}
          onChange={(e) => {
            const n = e.target.value === '' ? 0 : Number(e.target.value)
            if (Number.isNaN(n)) return
            onChange(Math.max(0, Math.min(100, Math.trunc(n))))
          }}
          className="w-20 border border-slate-300 rounded-lg px-2 py-1.5 text-sm text-right focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-amber-500 transition-colors"
          aria-label={t(`category.${category.system_key}`)}
        />
        <span className="text-sm text-slate-500 w-3">%</span>
      </div>
    </li>
  )
}

function SumIndicator({ sum, ok }: { sum: number; ok: boolean }) {
  const { t } = useTranslation()
  return (
    <div
      className={`text-sm ${ok ? 'text-slate-600' : 'text-rose-600 font-medium'}`}
    >
      {t('admin_categories.sum_label')}:{' '}
      <span className="font-mono tabular-nums">{sum}</span> / 100
      {!ok && (
        <span className="ml-2">{t('admin_categories.sum_invalid_hint')}</span>
      )}
    </div>
  )
}
