import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'

/**
 * The "tappable card with a label" pattern used for entry-point grids
 * (home Quick Actions, Classes empty-state CTAs, etc.). One component,
 * three modes: link (`to`), button (`onClick`), or disabled (`disabled`).
 *
 * Visual rules live in docs/page-checklist.md §Visual design rules.
 */
export function ActionCard({
  label,
  hint,
  to,
  onClick,
  disabled,
  primary,
  trailing,
}: {
  label: ReactNode
  hint?: ReactNode
  to?: string
  onClick?: () => void
  disabled?: boolean
  primary?: boolean
  trailing?: ReactNode
}) {
  if (disabled) {
    return (
      <div
        title={typeof hint === 'string' ? hint : undefined}
        className="rounded-xl border border-dashed border-slate-200 bg-slate-50/50 p-5 cursor-not-allowed"
      >
        <div className="font-semibold text-slate-400 text-sm tracking-tight">{label}</div>
        {hint && <div className="text-xs text-slate-400 mt-1">{hint}</div>}
      </div>
    )
  }

  const base = 'rounded-xl border p-5 transition-all flex flex-col gap-1 text-left'
  const cls = primary
    ? 'bg-amber-500 border-amber-500 text-white hover:bg-amber-600 hover:border-amber-600 hover:-translate-y-0.5 shadow-sm hover:shadow-md'
    : 'bg-white border-slate-200 text-slate-900 hover:border-slate-300 hover:-translate-y-0.5 shadow-sm hover:shadow-md'

  const hintText = (
    <div className={`text-xs mt-1 ${primary ? 'text-amber-50' : 'text-slate-500'}`}>
      {hint}
    </div>
  )

  const body = (
    <>
      <div className="font-semibold text-sm tracking-tight">{label}</div>
      {hint && hintText}
      {trailing && <div className="mt-1">{trailing}</div>}
    </>
  )

  if (to) {
    return (
      <Link to={to} className={`${base} ${cls}`}>
        {body}
      </Link>
    )
  }
  return (
    <button type="button" onClick={onClick} className={`${base} ${cls}`}>
      {body}
    </button>
  )
}
