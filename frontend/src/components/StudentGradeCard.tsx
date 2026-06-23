/**
 * Shared student grade cards (#210 follow-up).
 *
 * `SubjectCard` is the per-subject detail card (category 比重 breakdown) used on
 * the student detail page. `StudentSummaryCard` is the compact one-card-per-
 * student 成績總覽卡 — 班級/姓名/座號 + 達標次數 + 總點數 + each subject's
 * weighted total on one line — used both at the top of the detail page and on
 * the class print page (`subjectFilter` lets the print page show only picked
 * subjects). Both reuse the #210 projection logic from gradeMath.
 */
import { useTranslation } from 'react-i18next'

import { type StudentSubjectSummary } from '../lib/api'
import {
  computeProjection,
  formatScore,
  type Projection,
  projectionNote,
} from '../lib/gradeMath'

type TFn = (key: string, opts?: Record<string, unknown>) => string

// Canonical category order for the per-subject detail card (#210).
const CATEGORY_ORDER: readonly string[] = [
  'major_exam',
  'quiz',
  'homework',
  'attendance',
  'extra',
]

function subjectLabel(
  s: { subject_system_key: string | null; subject_display_name: string | null },
  t: TFn,
): string {
  return s.subject_system_key
    ? t(`subject.${s.subject_system_key}`)
    : (s.subject_display_name ?? '—')
}

/** The big 加權總分 number — ALWAYS the real current total; red + `*` only when
 * 及格 is impossible / the student is failing (#210). */
export function ProjectionTotal({ proj }: { proj: Projection }) {
  const { t } = useTranslation()
  const base = 'text-2xl font-semibold tabular-nums'
  if (proj.weightedTotal === null) {
    return <span className={`${base} text-slate-400`}>—</span>
  }
  const failing = proj.status === 'fail' || proj.status === 'impossible'
  return (
    <span
      className={`${base} ${failing ? 'text-rose-600' : 'text-slate-900'}`}
      title={failing ? projectionNote(proj, t) : undefined}
    >
      {formatScore(proj.weightedTotal)}
      {failing ? '*' : ''}
    </span>
  )
}

/** 備註 line under the total: the 段考 projection / pass-status note (#210). */
export function ProjectionNoteLine({ proj }: { proj: Projection }) {
  const { t } = useTranslation()
  const note = projectionNote(proj, t)
  if (!note) return null
  const danger = proj.status === 'fail' || proj.status === 'impossible'
  return (
    <div
      className={`mt-1 text-xs text-right ${danger ? 'text-rose-600' : 'text-slate-400'}`}
    >
      {note}
    </div>
  )
}

/** Per-subject category 比重 breakdown — subject label + categories + 額外加分 +
 * 加權總分 + note. Borderless so it can sit inside other cards (#210). */
export function SubjectBreakdown({
  summary,
}: {
  summary: StudentSubjectSummary
}) {
  const { t } = useTranslation()
  const label = subjectLabel(summary, t)
  const proj = computeProjection(
    summary.category_averages,
    summary.category_weights,
  )
  const cats = CATEGORY_ORDER.filter(
    (c) => c !== 'extra' && c in summary.category_averages,
  )
  const hasExtra = 'extra' in summary.category_averages
  const extraBonus =
    ((summary.category_averages['extra'] ?? 0) *
      (summary.category_weights['extra'] ?? 0)) /
    100

  return (
    <div>
      <div className="text-xs text-slate-500 uppercase tracking-wider">
        {label}
      </div>
      <dl className="mt-2 space-y-1 text-sm text-slate-600">
        {cats.map((k) => {
          const w = summary.category_weights[k] ?? 0
          return (
            <div key={k} className="flex justify-between gap-2">
              <dt className="truncate">
                {t(`category.${k}`)}
                {w > 0 && (
                  <span className="ml-1 text-xs text-slate-400">
                    {t('grades.weight_suffix', { weight: w })}
                  </span>
                )}
              </dt>
              <dd className="font-mono tabular-nums">
                {summary.category_averages[k].toFixed(1)}
              </dd>
            </div>
          )
        })}
        {hasExtra && (
          <div className="flex justify-between gap-2 text-emerald-700">
            <dt className="truncate">{t('grades.extra_bonus')}</dt>
            <dd className="font-mono tabular-nums">+{extraBonus.toFixed(1)}</dd>
          </div>
        )}
      </dl>
      <div className="mt-3 pt-3 border-t border-slate-100">
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-xs text-slate-500">
            {t('grades.weighted_total')}
          </span>
          <ProjectionTotal proj={proj} />
        </div>
        <ProjectionNoteLine proj={proj} />
      </div>
    </div>
  )
}

/** Bordered per-subject detail card (#210). */
export function SubjectCard({ summary }: { summary: StudentSubjectSummary }) {
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4">
      <SubjectBreakdown summary={summary} />
    </div>
  )
}

/** Compact 成績總覽卡: header + 達標/點數 + one line per subject. Used on the
 * detail page and the print page (where `subjectFilter` narrows the subjects). */
export function StudentSummaryCard({
  classroomGrade,
  classroomName,
  seatNumber,
  name,
  metCount,
  semesterPoints,
  subjects,
  subjectFilter,
  className,
}: {
  classroomGrade: number
  classroomName: string
  seatNumber: number
  name: string | null
  metCount: number
  semesterPoints: number
  subjects: StudentSubjectSummary[]
  subjectFilter?: string[]
  className?: string
}) {
  const { t } = useTranslation()
  const filtered = subjectFilter
    ? subjects.filter((s) => subjectFilter.includes(s.subject_id))
    : subjects

  return (
    <div
      className={`bg-white border border-slate-200 rounded-xl p-4 ${className ?? ''}`}
    >
      <div className="font-semibold text-slate-900">
        {classroomGrade}
        {t('print.grade_suffix')}
        {classroomName}
        {t('print.class_suffix')} {seatNumber}
        {t('print.seat_suffix')} {name ?? ''}
      </div>
      <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-xs">
        <span className="text-emerald-700">
          {t('student_detail.met_count', { count: metCount })}
        </span>
        <span className="text-amber-700">
          {t('print.total_points', { count: semesterPoints })}
        </span>
      </div>
      {filtered.length === 0 ? (
        <div className="mt-3 pt-3 border-t border-slate-100 text-sm text-slate-400">
          {t('student_detail.no_grades')}
        </div>
      ) : (
        <div className="mt-3 pt-3 border-t border-slate-100 grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3">
          {filtered.map((s) => (
            <SubjectBreakdown key={s.subject_id} summary={s} />
          ))}
        </div>
      )}
    </div>
  )
}
