import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { useQueries, useQuery } from '@tanstack/react-query'

import { PageContainer } from '../layout/PageContainer'
import { PageHeader } from '../layout/PageHeader'
import { api, type ClassPointsSummary } from '../lib/api'
import {
  drawModeA,
  drawModeB,
  probabilityPct,
  type LotteryMode,
  type PoolStudent,
} from '../lib/lottery'

const PRIMARY_BTN =
  'inline-flex items-center justify-center px-6 py-3 rounded-xl bg-amber-600 hover:bg-amber-700 text-white text-base font-semibold shadow-sm transition-colors disabled:opacity-40 disabled:cursor-not-allowed'
const SECONDARY_BTN =
  'inline-flex items-center px-4 py-2 rounded-lg bg-white border border-slate-200 hover:border-slate-300 hover:bg-slate-50 text-slate-700 text-sm font-medium shadow-sm transition-colors disabled:opacity-60'

export function Lottery() {
  const { t } = useTranslation()

  const summaryQ = useQuery({
    queryKey: ['points-classrooms'],
    queryFn: () => api.points.listClassrooms(),
  })
  const summaries: ClassPointsSummary[] = summaryQ.data?.data ?? []

  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [mode, setMode] = useState<LotteryMode>('A')
  const [winners, setWinners] = useState<PoolStudent[]>([])

  const selectedIds = useMemo(() => [...selected], [selected])

  // One query per selected class — cached, so a draw is pure local computation
  // (no network) and toggling a class back on reuses the cache.
  const studentQs = useQueries({
    queries: selectedIds.map((id) => ({
      queryKey: ['points-classroom-students', id],
      queryFn: () => api.points.listClassroomStudents(id),
      staleTime: 60_000,
    })),
  })

  const studentsLoading =
    selectedIds.length > 0 && studentQs.some((q) => q.isLoading)
  const studentsError = studentQs.some((q) => q.isError)

  // Eligible pool: every selected class's students with points > 0
  // (0/negative are excluded). Name falls back to 「N號」 when blank.
  const allEligible: PoolStudent[] = []
  for (const q of studentQs) {
    const list = q.data
    if (!list) continue
    for (const s of list.data) {
      if (s.semester_points > 0) {
        allEligible.push({
          studentId: s.student_id,
          classroomId: list.classroom_id,
          name:
            s.name && s.name.trim()
              ? s.name
              : t('lottery.seat_label', { seat: s.seat_number }),
          points: s.semester_points,
        })
      }
    }
  }

  const drawnIds = new Set(winners.map((w) => w.studentId))
  const pool = allEligible.filter((s) => !drawnIds.has(s.studentId))
  const poolSorted = [...pool].sort(
    (a, b) => probabilityPct(b, pool, mode) - probabilityPct(a, pool, mode),
  )

  const classLabel = (classroomId: string): string => {
    const c = summaries.find((x) => x.classroom_id === classroomId)
    return c ? `${c.grade}年${c.name}` : ''
  }

  // Switching mode changes the odds semantics — start the draw fresh.
  useEffect(() => {
    setWinners([])
  }, [mode])

  // Deselecting a class drops its already-drawn winners from the list so it
  // always reflects the active selection.
  useEffect(() => {
    setWinners((w) => w.filter((x) => selected.has(x.classroomId)))
  }, [selected])

  const allSelected =
    summaries.length > 0 && selected.size === summaries.length

  function toggleClass(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }
  function toggleAll() {
    setSelected(
      allSelected ? new Set() : new Set(summaries.map((c) => c.classroom_id)),
    )
  }

  function handleDraw() {
    if (pool.length === 0) return
    const pick = mode === 'A' ? drawModeA(pool) : drawModeB(pool)
    if (pick) setWinners((w) => [...w, pick])
  }

  const drawDisabled =
    selectedIds.length === 0 || studentsLoading || pool.length === 0

  // Hint under the draw button explaining why it's disabled / what's going on.
  let drawHint: string | null = null
  if (selectedIds.length === 0) drawHint = t('lottery.empty.no_selection')
  else if (studentsLoading) drawHint = t('common.loading')
  else if (allEligible.length === 0) drawHint = t('lottery.empty.no_eligible')
  else if (pool.length === 0) drawHint = t('lottery.exhausted')

  const latestWinner = winners[winners.length - 1] ?? null

  return (
    <PageContainer>
      <PageHeader title={t('lottery.title')} subtitle={t('lottery.subtitle')} />

      {summaryQ.isLoading && (
        <div className="text-center text-slate-400 py-16">
          {t('common.loading')}
        </div>
      )}

      {!summaryQ.isLoading && summaries.length === 0 && (
        <div className="bg-white border border-slate-200 rounded-xl p-12 text-center text-sm text-slate-500">
          {t('points.empty_classrooms')}
          <div className="mt-3">
            <Link
              to="/classes"
              className="text-amber-700 hover:text-amber-800 font-medium"
            >
              {t('points.goto_classes')} →
            </Link>
          </div>
        </div>
      )}

      {!summaryQ.isLoading && summaries.length > 0 && (
        <div className="flex flex-col gap-6">
          {/* 1. Class picker */}
          <section className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold text-slate-700">
                {t('lottery.section.classes')}
              </h2>
              <button
                onClick={toggleAll}
                className="text-sm text-amber-700 hover:text-amber-800 font-medium"
              >
                {allSelected ? t('lottery.clear') : t('lottery.select_all')}
              </button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
              {summaries.map((c) => {
                const on = selected.has(c.classroom_id)
                return (
                  <label
                    key={c.classroom_id}
                    className={`flex items-center gap-3 px-3 py-2.5 rounded-lg border cursor-pointer transition-colors ${
                      on
                        ? 'border-amber-300 bg-amber-50'
                        : 'border-slate-200 hover:bg-slate-50'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={on}
                      onChange={() => toggleClass(c.classroom_id)}
                      className="h-4 w-4 rounded border-slate-300 text-amber-600 focus:ring-amber-500"
                    />
                    <span className="font-medium text-slate-900">
                      {c.grade}年{c.name}
                    </span>
                    <span className="ml-auto text-xs text-slate-400 tabular-nums">
                      {t('lottery.class_meta', {
                        count: c.student_count,
                        total: c.semester_points,
                      })}
                    </span>
                  </label>
                )
              })}
            </div>
          </section>

          {/* 2. Mode toggle */}
          <section className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm">
            <h2 className="text-sm font-semibold text-slate-700 mb-3">
              {t('lottery.section.mode')}
            </h2>
            <div className="inline-flex gap-1 mb-2">
              <button
                onClick={() => setMode('A')}
                className={`px-3 py-1.5 text-sm rounded-md transition-colors ${
                  mode === 'A'
                    ? 'bg-slate-900 text-white'
                    : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'
                }`}
              >
                {t('lottery.mode.a')}
              </button>
              <button
                onClick={() => setMode('B')}
                className={`px-3 py-1.5 text-sm rounded-md transition-colors ${
                  mode === 'B'
                    ? 'bg-slate-900 text-white'
                    : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'
                }`}
              >
                {t('lottery.mode.b')}
              </button>
            </div>
            <p className="text-xs text-slate-500 leading-relaxed">
              {mode === 'A' ? t('lottery.mode.a_hint') : t('lottery.mode.b_hint')}
            </p>
          </section>

          {/* 3. Draw panel */}
          <section className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm">
            <h2 className="text-sm font-semibold text-slate-700 mb-4">
              {t('lottery.section.draw')}
            </h2>

            {studentsError && (
              <div className="mb-4 flex items-center justify-between gap-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
                <span>{t('common.error_generic')}</span>
                <button
                  onClick={() => studentQs.forEach((q) => q.refetch())}
                  className="font-medium hover:underline"
                >
                  {t('common.retry')}
                </button>
              </div>
            )}

            {latestWinner && (
              <div className="mb-5 rounded-xl bg-amber-50 border border-amber-200 px-6 py-5 text-center">
                <div className="text-xs font-medium uppercase tracking-wide text-amber-700">
                  🎉 {t('lottery.latest_winner')}
                </div>
                <div className="mt-1 text-2xl font-bold text-slate-900">
                  {latestWinner.name}
                </div>
                <div className="text-sm text-slate-500">
                  {classLabel(latestWinner.classroomId)}
                </div>
              </div>
            )}

            <div className="flex flex-wrap items-center gap-3">
              <button
                onClick={handleDraw}
                disabled={drawDisabled}
                className={PRIMARY_BTN}
              >
                {t('lottery.draw_button')}
              </button>
              <button
                onClick={() => setWinners([])}
                disabled={winners.length === 0}
                className={SECONDARY_BTN}
              >
                {t('lottery.reset')}
              </button>
              <span className="text-sm text-slate-500 tabular-nums">
                {t('lottery.pool_count', { count: pool.length })}
              </span>
            </div>
            {drawHint && (
              <p className="mt-3 text-xs text-slate-500">{drawHint}</p>
            )}
          </section>

          {/* 4. Probability table (current pool) */}
          {pool.length > 0 && (
            <section className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
              <table className="min-w-full text-sm">
                <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
                  <tr>
                    <th className="px-4 py-3 text-left font-medium">
                      {t('lottery.col.student')}
                    </th>
                    <th className="px-4 py-3 text-left font-medium">
                      {t('lottery.col.class')}
                    </th>
                    <th className="px-4 py-3 text-right font-medium">
                      {t('lottery.col.points')}
                    </th>
                    <th className="px-4 py-3 text-right font-medium">
                      {t('lottery.col.chance')}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {poolSorted.map((s) => (
                    <tr
                      key={s.studentId}
                      className="border-b border-slate-100 last:border-b-0"
                    >
                      <td className="px-4 py-2.5 text-slate-900 font-medium">
                        {s.name}
                      </td>
                      <td className="px-4 py-2.5 text-slate-600">
                        {classLabel(s.classroomId)}
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-slate-700">
                        {s.points}
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums font-semibold text-slate-900">
                        {probabilityPct(s, pool, mode).toFixed(1)}%
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}

          {/* 5. Winners list */}
          {winners.length > 0 && (
            <section className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm">
              <h2 className="text-sm font-semibold text-slate-700 mb-3">
                {t('lottery.section.winners')}
              </h2>
              <ol className="flex flex-col gap-2">
                {winners.map((w, i) => (
                  <li
                    key={w.studentId}
                    className="flex items-center gap-3 text-sm"
                  >
                    <span className="inline-flex items-center justify-center h-6 min-w-6 px-2 rounded-full bg-slate-900 text-white text-xs tabular-nums">
                      {t('lottery.winner_index', { index: i + 1 })}
                    </span>
                    <span className="font-medium text-slate-900">{w.name}</span>
                    <span className="text-slate-500">
                      {classLabel(w.classroomId)}
                    </span>
                  </li>
                ))}
              </ol>
            </section>
          )}
        </div>
      )}
    </PageContainer>
  )
}
