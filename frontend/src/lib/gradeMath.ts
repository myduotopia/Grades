/**
 * Weighted grade calculations.
 *
 * Inputs come straight from /api/classrooms/:id/grades. The math lives on the
 * frontend (not the backend) so we can render different breakdowns without
 * round-tripping.
 *
 * Formula per (student, subject):
 *   cats_with_grades = non-extra categories that have any score for this student×subject
 *   if none: subject_score = null  (rendered as —)
 *   else:
 *     weight_sum = sum(cat.weight for cat in cats_with_grades)
 *     weighted   = sum(avg(student's scores in cat) × cat.weight) / weight_sum
 *   extra_bonus = sum of student's scores in the `extra` category (this subject)
 *   final = min(100, weighted + extra_bonus)
 *
 * Weights are re-normalised among categories that actually have grades so a
 * student with no 段考 entered doesn't get a zero pulled into their average.
 */
import type { ClassroomGradesView, GradeItem } from './api'

export interface SubjectBreakdown {
  /** Per-category average for this student × subject. Missing → undefined. */
  byCategory: Record<string, number>
  /** Weighted total (capped at 100), or null if nothing graded. */
  weightedTotal: number | null
  /** Raw extra bonus (sum). */
  extraBonus: number
}

export type StudentSubjectMatrix = Record<
  string, // student_id
  Record<string, SubjectBreakdown> // subject_system_key → breakdown
>

const EXTRA_KEY = 'extra'

export function buildMatrix(
  view: ClassroomGradesView,
): StudentSubjectMatrix {
  const itemsById: Record<string, GradeItem> = {}
  for (const it of view.items) itemsById[it.id] = it

  // Group scores: student → subject → category → number[]
  type Triple = Record<string, Record<string, Record<string, number[]>>>
  const grouped: Triple = {}
  for (const g of view.grades) {
    const item = itemsById[g.item_id]
    if (!item || !item.subject_system_key) continue
    const subj = item.subject_system_key
    const cat = item.category_system_key
    grouped[g.student_id] ??= {}
    grouped[g.student_id][subj] ??= {}
    grouped[g.student_id][subj][cat] ??= []
    grouped[g.student_id][subj][cat].push(g.score)
  }

  const weightsByKey: Record<string, number> = {}
  for (const w of view.category_weights) weightsByKey[w.system_key] = w.weight

  const out: StudentSubjectMatrix = {}
  for (const studentId of Object.keys(grouped)) {
    out[studentId] = {}
    for (const subj of Object.keys(grouped[studentId])) {
      out[studentId][subj] = computeSubjectBreakdown(
        grouped[studentId][subj],
        weightsByKey,
      )
    }
  }
  return out
}

function computeSubjectBreakdown(
  byCategory: Record<string, number[]>,
  weightsByKey: Record<string, number>,
): SubjectBreakdown {
  const cats = Object.keys(byCategory)
  const byCategoryAvg: Record<string, number> = {}
  for (const c of cats) {
    const arr = byCategory[c]
    byCategoryAvg[c] = arr.reduce((s, n) => s + n, 0) / arr.length
  }
  const nonExtra = cats.filter((c) => c !== EXTRA_KEY)
  let weightedTotal: number | null = null
  if (nonExtra.length > 0) {
    let weightSum = 0
    let acc = 0
    for (const c of nonExtra) {
      const w = weightsByKey[c] ?? 0
      if (w <= 0) continue
      weightSum += w
      acc += byCategoryAvg[c] * w
    }
    if (weightSum > 0) {
      weightedTotal = acc / weightSum
    }
  }
  const extraBonus = byCategoryAvg[EXTRA_KEY]
    ? byCategoryAvg[EXTRA_KEY]
    : 0
  if (weightedTotal !== null) {
    weightedTotal = Math.min(100, weightedTotal + extraBonus)
  }
  return {
    byCategory: byCategoryAvg,
    weightedTotal,
    extraBonus,
  }
}

/** Which subjects appear anywhere in the data (sorted by SYSTEM_SUBJECT_KEYS order). */
export function subjectsInView(view: ClassroomGradesView): string[] {
  const seen = new Set<string>()
  for (const it of view.items) {
    if (it.subject_system_key) seen.add(it.subject_system_key)
  }
  return Array.from(seen)
}

/** Round to 1 decimal, returning '—' for null. */
export function formatScore(n: number | null | undefined): string {
  if (n === null || n === undefined) return '—'
  return n.toFixed(1)
}
