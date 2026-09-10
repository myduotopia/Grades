import { Fragment, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate } from 'react-router-dom'

import { useBreadcrumbs } from '../hooks/useBreadcrumbs'
import type { Crumb, CrumbSwitcher } from '../lib/breadcrumbs'

/** Above this many options the switcher grows a filter box (issue #250). */
const SEARCH_THRESHOLD = 8

/**
 * Vercel-style breadcrumb (issue #250).
 *
 * Three jobs, matching the reference design:
 *   1. show where you are          — the full path, one crumb per level
 *   2. get you back up             — every non-final crumb is a link
 *   3. move sideways               — a ▾ next to a crumb opens the list of
 *                                    sibling items and jumps to the same page
 *                                    for a different class / student / snapshot
 *
 * The link and the ▾ are deliberately two separate controls: merging them
 * would make "click the class name to go to the class" impossible.
 *
 * Renders nothing on top-level pages, so no blank row appears above the title.
 */
export function Breadcrumb({ items }: { items?: Crumb[] | null }) {
  const { t } = useTranslation()
  const derived = useBreadcrumbs()
  const crumbs = items ?? derived

  if (!crumbs || crumbs.length < 2) return null

  // Narrow screens collapse everything between the first and last crumb into
  // a single "…" menu so a deep path never forces horizontal scrolling.
  const collapsible = crumbs.slice(1, -1)
  const canCollapse = crumbs.length > 2

  return (
    <nav aria-label={t('breadcrumb.aria')} className="mb-2 min-w-0">
      <ol className="flex items-center gap-1 text-sm text-slate-500 min-w-0">
        <CrumbItem crumb={crumbs[0]} isLast={false} />

        {canCollapse && (
          <>
            <Separator className="sm:hidden" />
            <li className="sm:hidden shrink-0">
              <CollapsedMenu crumbs={collapsible} />
            </li>
          </>
        )}

        {collapsible.map((crumb) => (
          <Fragment key={crumb.key}>
            <Separator className="hidden sm:block" />
            <CrumbItem crumb={crumb} isLast={false} className="hidden sm:flex" />
          </Fragment>
        ))}

        <Separator />
        <CrumbItem crumb={crumbs[crumbs.length - 1]} isLast />
      </ol>
    </nav>
  )
}

function Separator({ className = '' }: { className?: string }) {
  return (
    <li aria-hidden className={`text-slate-300 select-none shrink-0 ${className}`}>
      /
    </li>
  )
}

function CrumbItem({
  crumb,
  isLast,
  className = '',
}: {
  crumb: Crumb
  isLast: boolean
  className?: string
}) {
  return (
    <li className={`items-center gap-0.5 min-w-0 ${className || 'flex'}`}>
      {crumb.to ? (
        <Link
          to={crumb.to}
          className="truncate rounded px-1 py-0.5 hover:text-slate-900 hover:bg-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500"
        >
          {crumb.label}
        </Link>
      ) : (
        <span
          aria-current={isLast ? 'page' : undefined}
          className="truncate px-1 py-0.5 text-slate-900 font-medium"
        >
          {crumb.label}
        </span>
      )}
      {crumb.switcher && <Switcher switcher={crumb.switcher} label={crumb.label} />}
    </li>
  )
}

/**
 * The ▾ menu. Mirrors SemesterSwitcher's markup (listbox + full-screen click
 * catcher) and adds what that one lacks: type-ahead filtering, arrow-key
 * navigation and Escape-to-close.
 */
function Switcher({
  switcher,
  label,
}: {
  switcher: CrumbSwitcher
  label: string
}) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [highlight, setHighlight] = useState(0)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)

  const showSearch = switcher.items.length > SEARCH_THRESHOLD
  const needle = query.trim().toLowerCase()
  const visible = needle
    ? switcher.items.filter((i) => i.label.toLowerCase().includes(needle))
    : switcher.items

  useEffect(() => {
    if (!open) return
    setQuery('')
    const idx = switcher.items.findIndex((i) => i.id === switcher.activeId)
    setHighlight(idx >= 0 ? idx : 0)
    if (showSearch) searchRef.current?.focus()
    // Re-running on every items change would fight the user's typing; opening
    // is the only moment the initial highlight matters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const close = (restoreFocus = true) => {
    setOpen(false)
    if (restoreFocus) triggerRef.current?.focus()
  }

  const choose = (to: string) => {
    setOpen(false)
    navigate(to)
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      close()
      return
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      if (visible.length === 0) return
      setHighlight((h) => {
        const cur = Math.min(h, visible.length - 1)
        const next = e.key === 'ArrowDown' ? cur + 1 : cur - 1
        return (next + visible.length) % visible.length
      })
      return
    }
    if (e.key === 'Enter') {
      const target = visible[Math.min(highlight, visible.length - 1)]
      if (target) {
        e.preventDefault()
        choose(target.to)
      }
    }
  }

  return (
    <div className="relative shrink-0">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={t('breadcrumb.switch_aria', { name: label })}
        // -my-2 keeps the 44px tap target from stretching the crumb row.
        className="flex items-center justify-center w-11 h-11 -my-2 text-slate-400 hover:text-slate-700 rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500"
      >
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M3 4.5l3 3 3-3" />
        </svg>
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => close(false)} aria-hidden />
          <div
            onKeyDown={onKeyDown}
            className="absolute left-0 mt-1 w-64 max-w-[calc(100vw-2rem)] rounded-md border border-slate-200 bg-white shadow-lg z-40 py-1"
          >
            {showSearch && (
              <div className="px-2 pb-1">
                <input
                  ref={searchRef}
                  value={query}
                  onChange={(e) => {
                    setQuery(e.target.value)
                    setHighlight(0)
                  }}
                  placeholder={t('breadcrumb.search_placeholder')}
                  className="w-full border border-slate-200 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500"
                />
              </div>
            )}

            <ul role="listbox" className="max-h-72 overflow-y-auto">
              {switcher.isLoading && (
                <li className="px-3 py-2 text-sm text-slate-400">
                  {t('common.loading')}
                </li>
              )}
              {!switcher.isLoading && visible.length === 0 && (
                <li className="px-3 py-2 text-sm text-slate-400">
                  {t('breadcrumb.no_results')}
                </li>
              )}
              {visible.map((item, i) => {
                const isActive = item.id === switcher.activeId
                return (
                  <li key={item.id}>
                    <button
                      type="button"
                      role="option"
                      aria-selected={isActive}
                      onMouseEnter={() => setHighlight(i)}
                      onClick={() => choose(item.to)}
                      className={`w-full text-left px-3 py-2 text-sm flex items-center justify-between gap-2 ${
                        isActive ? 'bg-amber-50 text-amber-800' : 'text-slate-700'
                      } ${i === highlight ? 'bg-slate-50' : ''}`}
                    >
                      <span className="truncate">{item.label}</span>
                      {isActive && <span className="text-xs shrink-0">✓</span>}
                    </button>
                  </li>
                )
              })}
            </ul>
          </div>
        </>
      )}
    </div>
  )
}

/** Mobile-only "…" that reveals the crumbs hidden between first and last. */
function CollapsedMenu({ crumbs }: { crumbs: Crumb[] }) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)

  if (crumbs.length === 0) return null

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="true"
        aria-expanded={open}
        aria-label={t('breadcrumb.more')}
        className="flex items-center justify-center w-11 h-11 -my-2 text-slate-400 hover:text-slate-700 rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500"
      >
        …
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} aria-hidden />
          <ul className="absolute left-0 mt-1 w-56 max-w-[calc(100vw-2rem)] rounded-md border border-slate-200 bg-white shadow-lg z-40 py-1">
            {crumbs.map((c) => (
              <li key={c.key}>
                {c.to ? (
                  <Link
                    to={c.to}
                    onClick={() => setOpen(false)}
                    className="block px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 truncate"
                  >
                    {c.label}
                  </Link>
                ) : (
                  <span className="block px-3 py-2 text-sm text-slate-400 truncate">
                    {c.label}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  )
}
