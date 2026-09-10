import type { ReactNode } from 'react'

import { Breadcrumb } from '../components/Breadcrumb'

/**
 * Standard page header. Title is always text-2xl → lg:text-3xl so the app
 * doesn't feel like every page is shouting its name. Subtitle is optional;
 * actions render on the right.
 *
 * A Vercel-style breadcrumb sits above the title (issue #250). By default it
 * derives itself from the URL and renders nothing on top-level pages. Pages
 * whose route doesn't carry enough context (StudentDetail) pass their own
 * node; pass `false` to suppress it entirely.
 *
 * See docs/page-checklist.md for the full design rules.
 */
export function PageHeader({
  title,
  subtitle,
  actions,
  breadcrumb,
}: {
  title: ReactNode
  subtitle?: ReactNode
  actions?: ReactNode
  breadcrumb?: ReactNode | false
}) {
  return (
    <header className="mb-8">
      {breadcrumb === undefined ? <Breadcrumb /> : breadcrumb || null}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-2xl lg:text-3xl font-bold text-slate-900 tracking-tight">
            {title}
          </h1>
          {subtitle && (
            <p className="text-sm text-slate-500 mt-1 leading-relaxed">{subtitle}</p>
          )}
        </div>
        {actions && <div className="sm:shrink-0">{actions}</div>}
      </div>
    </header>
  )
}
