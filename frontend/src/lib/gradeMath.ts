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
