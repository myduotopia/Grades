import { useMemo } from 'react'

import type { Group, GroupColor } from '../lib/api'

/** One group a student belongs to, plus their 1-based position inside it. */
export interface StudentGroupRef {
  groupId: string
  name: string
  color: GroupColor | null
  /** 1-based order within the group, matching the 組別設定 member list. */
  order: number
}

// Static map — Tailwind only sees class names written out in full.
const BADGE_TONE: Record<GroupColor, string> = {
  amber: 'bg-amber-50 text-amber-800 border-amber-200',
  rose: 'bg-rose-50 text-rose-800 border-rose-200',
  sky: 'bg-sky-50 text-sky-800 border-sky-200',
  emerald: 'bg-emerald-50 text-emerald-800 border-emerald-200',
  violet: 'bg-violet-50 text-violet-800 border-violet-200',
  slate: 'bg-slate-50 text-slate-700 border-slate-200',
}

const BADGE_NEUTRAL = 'bg-slate-50 text-slate-700 border-slate-200'

/**
 * student_id → the groups they are in, in group display order.
 *
 * A student can belong to several groups at once (a class may run an English
 * grouping and a cleaning grouping side by side), so this is a list, not a
 * single value.
 */
export function buildStudentGroupIndex(groups: Group[]) {
  const index = new Map<string, StudentGroupRef[]>()
  groups.forEach((g) => {
    g.members.forEach((m, i) => {
      const refs = index.get(m.student_id) ?? []
      refs.push({
        groupId: g.id,
        name: g.name,
        color: g.color,
        order: i + 1,
      })
      index.set(m.student_id, refs)
    })
  })
  return index
}

export function useStudentGroupIndex(groups: Group[]) {
  return useMemo(() => buildStudentGroupIndex(groups), [groups])
}

/**
 * Renders nothing when the student is in no group — callers can drop this in
 * unconditionally and rows stay clean for classes that never set groups up.
 */
export function StudentGroupBadges({
  refs,
  className = '',
}: {
  refs: StudentGroupRef[] | undefined
  className?: string
}) {
  if (!refs || refs.length === 0) return null
  return (
    <span className={`inline-flex flex-wrap items-center gap-1 ${className}`}>
      {refs.map((r) => (
        <span
          key={r.groupId}
          className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs whitespace-nowrap ${
            r.color ? BADGE_TONE[r.color] : BADGE_NEUTRAL
          }`}
        >
          <span className="truncate max-w-[8rem]">{r.name}</span>
          <span className="tabular-nums opacity-70">#{r.order}</span>
        </span>
      ))}
    </span>
  )
}
