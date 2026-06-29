// 抽獎系統 (issue #225) — pure draw math, kept out of the page so it stays
// unit-testable and the component is a thin view.
//
// Probability formula from the issue: 學生點數 / 該生班級總點數 × 100%.
// That is the within-class share. Two multi-class modes (teacher's choice):
//   A 各班機會均等: pick a class uniformly, then a student weighted by points.
//                  P(student) = (1 / 班級數) × (points / classTotal).
//   B 全部混在一起: one pool, P(student) = points / 所有選取班級總點數.
//
// Draws are one-at-a-time with no repeats: the caller removes the winner from
// `pool` before the next draw, so all functions operate on the CURRENT pool.

export interface PoolStudent {
  studentId: string
  classroomId: string
  name: string // resolved display name (姓名, or 「N號」 fallback)
  points: number // always > 0 — the page excludes 0/negative before building the pool
}

const sumPoints = (pool: PoolStudent[]): number =>
  pool.reduce((acc, s) => acc + s.points, 0)

/**
 * Weighted single pick. Walks the cumulative weight line. Returns null when the
 * pool is empty or its total weight is <= 0 (guards divide-by-zero callers).
 */
export function weightedPick(
  pool: PoolStudent[],
  rng: () => number = Math.random,
): PoolStudent | null {
  const total = sumPoints(pool)
  if (pool.length === 0 || total <= 0) return null
  let r = rng() * total
  for (const s of pool) {
    r -= s.points
    if (r < 0) return s
  }
  return pool[pool.length - 1] // float-rounding guard
}

/** Mode B: single combined pool, weighted by points. */
export const drawModeB = (
  pool: PoolStudent[],
  rng: () => number = Math.random,
): PoolStudent | null => weightedPick(pool, rng)

/**
 * Mode A: pick a class uniformly among classes that still have eligible
 * students, then a student inside it weighted by points. Each class is equally
 * likely regardless of size.
 */
export function drawModeA(
  pool: PoolStudent[],
  rng: () => number = Math.random,
): PoolStudent | null {
  const classIds = [...new Set(pool.map((s) => s.classroomId))]
  if (classIds.length === 0) return null
  const classId = classIds[Math.floor(rng() * classIds.length)]
  return weightedPick(
    pool.filter((s) => s.classroomId === classId),
    rng,
  )
}

export type LotteryMode = 'A' | 'B'

/**
 * Win chance (0–100) for one student against the CURRENT remaining pool. Shown
 * live in the table; it shifts as the pool shrinks after each no-repeat draw.
 */
export function probabilityPct(
  student: PoolStudent,
  pool: PoolStudent[],
  mode: LotteryMode,
): number {
  if (mode === 'B') {
    const total = sumPoints(pool)
    return total > 0 ? (student.points / total) * 100 : 0
  }
  // Mode A
  const classIds = [...new Set(pool.map((s) => s.classroomId))]
  const classTotal = sumPoints(
    pool.filter((s) => s.classroomId === student.classroomId),
  )
  return classIds.length > 0 && classTotal > 0
    ? (1 / classIds.length) * (student.points / classTotal) * 100
    : 0
}
