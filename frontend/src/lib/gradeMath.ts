/**
 * Weighted grade calculations.
 *
 * Each subject has its own per-category weights (a teacher might weight 國語
 * differently from 體育). Inputs come from /api/classrooms/:id/grades.
 *
 * Per (student, subject):
 *   cats_with_grades = non-extra categories with any score for this student×subject
 *   if none: subject_score = null
 *   else:
 *     weighted = Σ avg(student×cat scores) × weight[subject, cat] / 100
 *   extra_bonus = avg(student's `extra` scores in this subject) × weight[subject, extra] / 100
 *   final = min(100, weighted + extra_bonus)
 *
 * Weights are stored as integer percents (5 means 5%). Categories with no
 * items contribute 0 — the weighted total is NOT renormalised. If a teacher
 * sets 出席率 10% but never enters attendance scores, students simply lose
 * those 10 points; the system does not silently redistribute. Teachers who
 * care will enter the scores themselves.
 *
 * The matrix is keyed by `subject_id` (UUID) so custom subjects are first-class.
 */
import type { ClassroomGradesView } from './api'

export interface SubjectBreakdown {
  byCategory: Record<string, number>
  weightedTotal: number | null
  extraBonus: number
}

export type StudentSubjectMatrix = Record<
  string, // student_id
  Record<string, SubjectBreakdown> // subject_id → breakdown
>

const EXTRA_KEY = 'extra'
const EXAM_KEY = 'major_exam'

/** Total a student must reach to be considered 及格 (issue #210). */
export const PASS_THRESHOLD = 60

export function buildMatrix(
  view: ClassroomGradesView,
): StudentSubjectMatrix {
  // index: subject_id → category_system_key → weight
  const weightLookup: Record<string, Record<string, number>> = {}
  for (const w of view.subject_category_weights) {
    weightLookup[w.subject_id] ??= {}
    weightLookup[w.subject_id][w.category_system_key] = w.weight
  }

  // Group: student_id → subject_id → category_system_key → number[]
  type Triple = Record<string, Record<string, Record<string, number[]>>>
  const grouped: Triple = {}
  const itemsById: Record<string, (typeof view.items)[number]> = {}
  for (const it of view.items) itemsById[it.id] = it
  for (const g of view.grades) {
    const item = itemsById[g.item_id]
    if (!item) continue
    grouped[g.student_id] ??= {}
    grouped[g.student_id][item.subject_id] ??= {}
    grouped[g.student_id][item.subject_id][item.category_system_key] ??= []
    grouped[g.student_id][item.subject_id][item.category_system_key].push(
      g.score,
    )
  }

  const out: StudentSubjectMatrix = {}
  for (const studentId of Object.keys(grouped)) {
    out[studentId] = {}
    for (const subjectId of Object.keys(grouped[studentId])) {
      out[studentId][subjectId] = computeSubjectBreakdown(
        grouped[studentId][subjectId],
        weightLookup[subjectId] ?? {},
      )
    }
  }
  return out
}

function computeSubjectBreakdown(
  byCategory: Record<string, number[]>,
  weights: Record<string, number>,
): SubjectBreakdown {
  const byCategoryAvg: Record<string, number> = {}
  for (const c of Object.keys(byCategory)) {
    const arr = byCategory[c]
    byCategoryAvg[c] = arr.reduce((s, n) => s + n, 0) / arr.length
  }
  const nonExtra = Object.keys(byCategoryAvg).filter((c) => c !== EXTRA_KEY)
  let weightedTotal: number | null = null
  if (nonExtra.length > 0) {
    let acc = 0
    let hasAny = false
    for (const c of nonExtra) {
      const w = weights[c] ?? 0
      if (w <= 0) continue
      hasAny = true
      acc += (byCategoryAvg[c] * w) / 100
    }
    if (hasAny) weightedTotal = acc
  }
  const extraAvg = byCategoryAvg[EXTRA_KEY] ?? 0
  const extraWeight = weights[EXTRA_KEY] ?? 0
  const extraBonus = (extraAvg * extraWeight) / 100
  if (weightedTotal !== null) {
    weightedTotal = Math.min(100, weightedTotal + extraBonus)
  }
  return { byCategory: byCategoryAvg, weightedTotal, extraBonus }
}

/**
 * Pass projection for one (student, subject) — issue #210.
 *
 * `weightedTotal` is ALWAYS the real no-renormalise total computed from
 * whatever scores exist now (段考 included once entered) — it is shown as-is,
 * even before 段考 lands. `requiredExam` / `status` drive a separate 備註
 * (note) telling the teacher the minimum 段考 average still needed to pass.
 * Empty categories count as 0 (lose their weight).
 *
 *  - `pass` / `fail`  — 段考 entered; total ≥ / < `PASS_THRESHOLD`.
 *  - `safe`           — 段考 blank but already 及格 even with 0 on 段考.
 *  - `projected`      — 段考 blank; needs 0 < requiredExam ≤ 100 to pass.
 *  - `impossible`     — 段考 blank but even 100 on 段考 can't reach 60.
 *  - `none`           — no weighted category has any score yet.
 *
 * `fail` and `impossible` are the two states that mark the total red + `*`.
 */
export type ProjectionStatus =
  | 'pass'
  | 'fail'
  | 'safe'
  | 'projected'
  | 'impossible'
  | 'none'

export interface Projection {
  /** Real current weighted total (no renormalise); `null` only when no
   * weighted category has a score yet. Always safe to display as-is. */
  weightedTotal: number | null
  examRecorded: boolean
  /** Minimum 段考 average needed to reach `PASS_THRESHOLD`; null unless the
   * status is `projected`, `safe`, or `impossible`. */
  requiredExam: number | null
  status: ProjectionStatus
}

export function computeProjection(
  byCategoryAvg: Record<string, number>,
  weights: Record<string, number>,
): Projection {
  const examW = weights[EXAM_KEY] ?? 0
  const examEntered = byCategoryAvg[EXAM_KEY] !== undefined

  // Real current total from every entered weighted category (incl. 段考 if
  // present), no renormalise — shown as-is regardless of 段考 status.
  let acc = 0
  let hasWeighted = false
  for (const c of Object.keys(byCategoryAvg)) {
    if (c === EXTRA_KEY) continue
    const w = weights[c] ?? 0
    if (w <= 0) continue
    hasWeighted = true
    acc += (byCategoryAvg[c] * w) / 100
  }
  const extraAvg = byCategoryAvg[EXTRA_KEY] ?? 0
  const extraWeight = weights[EXTRA_KEY] ?? 0
  const bonus = (extraAvg * extraWeight) / 100
  const weightedTotal = hasWeighted ? Math.min(100, acc + bonus) : null

  if (weightedTotal === null) {
    return {
      weightedTotal: null,
      examRecorded: examEntered,
      requiredExam: null,
      status: 'none',
    }
  }

  // 段考 entered and weighted → final pass/fail.
  if (examEntered && examW > 0) {
    return {
      weightedTotal,
      examRecorded: true,
      requiredExam: null,
      status: weightedTotal >= PASS_THRESHOLD ? 'pass' : 'fail',
    }
  }

  // 段考 blank but the subject weights it → project the needed average. The
  // base excludes 段考 (which contributes 0 while blank).
  if (!examEntered && examW > 0) {
    let base = 0
    for (const c of Object.keys(byCategoryAvg)) {
      if (c === EXTRA_KEY || c === EXAM_KEY) continue
      const w = weights[c] ?? 0
      if (w <= 0) continue
      base += (byCategoryAvg[c] * w) / 100
    }
    const required = ((PASS_THRESHOLD - base - bonus) * 100) / examW
    if (required <= 0) {
      return { weightedTotal, examRecorded: false, requiredExam: 0, status: 'safe' }
    }
    if (required > 100) {
      return {
        weightedTotal,
        examRecorded: false,
        requiredExam: required,
        status: 'impossible',
      }
    }
    return {
      weightedTotal,
      examRecorded: false,
      requiredExam: required,
      status: 'projected',
    }
  }

  // No 段考 weight (e.g. 非主科) — just pass/fail on the current total.
  return {
    weightedTotal,
    examRecorded: examEntered,
    requiredExam: null,
    status: weightedTotal >= PASS_THRESHOLD ? 'pass' : 'fail',
  }
}

/** Pass-status note for the 備註 column / card (#210). Returns '' when there's
 * nothing useful to add (already passed, or no data). `t` is passed in so this
 * module stays i18n-free. */
export function projectionNote(
  proj: Projection,
  t: (k: string, opts?: Record<string, unknown>) => string,
): string {
  switch (proj.status) {
    case 'projected': {
      const need = Math.ceil((proj.requiredExam ?? 0) * 10) / 10
      return t('grades.required_exam', { score: need })
    }
    case 'safe':
      return t('grades.note_safe')
    case 'fail':
      return t('grades.note_failing')
    case 'impossible':
      return t('grades.note_cannot')
    default:
      return '' // pass / none → nothing to add
  }
}

/** Subjects that have any item in the data, in canonical built-in order with
 * custom subjects appended. */
export function subjectsInView(
  view: ClassroomGradesView,
  canonicalSystemOrder: readonly string[],
): { id: string; system_key: string | null; display_name: string | null }[] {
  const seen = new Map<
    string,
    { id: string; system_key: string | null; display_name: string | null }
  >()
  for (const it of view.items) {
    if (!seen.has(it.subject_id)) {
      seen.set(it.subject_id, {
        id: it.subject_id,
        system_key: it.subject_system_key,
        display_name: it.subject_display_name,
      })
    }
  }
  // Sort: built-ins by canonical order; customs alphabetical, appended.
  const builtins: typeof seen extends Map<string, infer T> ? T[] : never = []
  const customs: typeof builtins = []
  for (const s of seen.values()) {
    if (s.system_key) builtins.push(s)
    else customs.push(s)
  }
  const order = new Map<string, number>(
    canonicalSystemOrder.map((k, idx) => [k, idx]),
  )
  builtins.sort(
    (a, b) =>
      (order.get(a.system_key as string) ?? 999) -
      (order.get(b.system_key as string) ?? 999),
  )
  customs.sort((a, b) =>
    (a.display_name ?? '').localeCompare(b.display_name ?? ''),
  )
  return [...builtins, ...customs]
}

export function formatScore(n: number | null | undefined): string {
  if (n === null || n === undefined) return '—'
  return n.toFixed(1)
}

/**
 * Arithmetic mean of a list of numbers, or null when the list is empty.
 * Used for the per-item / per-column class averages (issue #190): callers
 * filter out null/undefined cells first, so the denominator is the count of
 * students who actually have a score (未應考者不計入).
 */
export function mean(nums: number[]): number | null {
  if (nums.length === 0) return null
  return nums.reduce((a, b) => a + b, 0) / nums.length
}
