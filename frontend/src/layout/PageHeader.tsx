import type { ReactNode } from 'react'

/**
 * Standard page header. Title is always text-2xl → lg:text-3xl so the app
 * doesn't feel like every page is shouting its name. Subtitle is optional;
 * actions render on the right.
 *
 * See docs/page-checklist.md for the full design rules.
 */
export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: ReactNode
  subtitle?: ReactNode
  actions?: ReactNode
}) {
  return (
    <header className="flex items-start justify-between gap-4 mb-8">
      <div className="min-w-0">
        <h1 className="text-2xl lg:text-3xl font-bold text-slate-900 tracking-tight">
          {title}
        </h1>
        {subtitle && (
          <p className="text-sm text-slate-500 mt-1 leading-relaxed">{subtitle}</p>
        )}
      </div>
      {actions && <div className="shrink-0">{actions}</div>}
    </header>
  )
}
