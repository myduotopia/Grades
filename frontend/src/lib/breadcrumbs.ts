/**
 * Breadcrumb route table (issue #250).
 *
 * App.tsx uses a flat <Routes> tree, not createBrowserRouter, so there is no
 * `useMatches` / route `handle` API to hang breadcrumb metadata off. Instead we
 * match the pathname against the table below and return a list of *specs* —
 * "which levels does this URL have", with no data attached yet. The
 * useBreadcrumbs hook then fills in labels and switcher items from the caches
 * the pages already populate.
 *
 * Keeping this file JSX-free and hook-free makes the matching testable and
 * keeps the "what levels exist" decision in one place.
 */

import { findNavSection, type NavItem } from '../layout/navItems'

/** One rendered breadcrumb level. */
export type Crumb = {
  key: string
  /** Already-localised display text. */
  label: string
  /** Link target. Omitted on the current (last) level. */
  to?: string
  /** Present => render a ▾ button that opens a same-level switcher. */
  switcher?: CrumbSwitcher
}

export type CrumbSwitcher = {
  items: CrumbSwitcherItem[]
  /** id of the currently-viewed item, marked with a ✓. */
  activeId?: string
  /** Shown while the underlying query is still loading. */
  isLoading?: boolean
}

export type CrumbSwitcherItem = {
  id: string
  label: string
  to: string
  /** Sidebar glyph, so the section switcher reads like the sidebar (#254). */
  icon?: NavItem['icon']
  /** Draw a divider above this row (separates the settings group). */
  dividerBefore?: boolean
}

/** A level before data has been attached. */
export type CrumbSpec =
  | { kind: 'static'; key: string; labelKey: string; to?: string }
  /** The sidebar section this URL lives in — always the first level (#254). */
  | {
      kind: 'section'
      key: 'section'
      labelKey: string
      to: string
      group: 'primary' | 'settings'
    }
  | {
      kind: 'classroom'
      key: string
      classroomId: string
      /**
       * URL template for this level, `{id}` replaced with a classroom id.
       * Switching class from `/classes/A/grades` must land on
       * `/classes/B/grades` — same page, different class — so the tail of the
       * current route has to be baked into the template.
       */
      template: string
    }
  | { kind: 'snapshot'; key: string; snapshotId: string }

/**
 * The sidebar section a URL belongs to, as a breadcrumb level.
 *
 * Every in-shell page has one, which is why the breadcrumb now shows up on
 * top-level pages too (#254) — there the section is the only level.
 */
export function sectionSpec(pathname: string): CrumbSpec | null {
  const found = findNavSection(pathname)
  if (!found) return null
  return {
    kind: 'section',
    key: 'section',
    labelKey: found.item.key,
    to: found.item.to,
    group: found.group,
  }
}

/**
 * Map a pathname to breadcrumb levels.
 *
 * The first level is always the sidebar section; anything below it comes from
 * the table here. Returns null only for routes outside the shell (e.g.
 * /classes/print), where the component renders nothing at all.
 *
 * `/students/:studentId` deliberately returns just its section: that route is
 * not nested under its class, so the class level can only come from the
 * student payload. StudentDetail builds its own crumbs instead.
 */
export function matchBreadcrumbRoute(pathname: string): CrumbSpec[] | null {
  const section = sectionSpec(pathname)
  if (!section) return null

  const seg = pathname.split('/').filter(Boolean)
  const deeper = matchDeeperLevels(seg)
  return [section, ...deeper]
}

/** Levels below the section. Empty on top-level pages. */
function matchDeeperLevels(seg: string[]): CrumbSpec[] {
  // /classes/:classroomId/(students|groups|grades)
  if (seg[0] === 'classes' && seg.length >= 3) {
    const classroomId = seg[1]
    const leaf = seg[2]
    if (leaf !== 'students' && leaf !== 'groups' && leaf !== 'grades') {
      return []
    }
    return [
      {
        kind: 'classroom',
        key: 'classroom',
        classroomId,
        template: `/classes/{id}/${leaf}`,
      },
      { kind: 'static', key: leaf, labelKey: `breadcrumb.${leaf}` },
    ]
  }

  // /points/:classroomId
  if (seg[0] === 'points' && seg.length === 2) {
    return [
      {
        kind: 'classroom',
        key: 'classroom',
        classroomId: seg[1],
        template: '/points/{id}',
      },
    ]
  }

  // /snapshots/:snapshotId/grades
  if (seg[0] === 'snapshots' && seg.length === 3 && seg[2] === 'grades') {
    return [{ kind: 'snapshot', key: 'snapshot', snapshotId: seg[1] }]
  }

  return []
}

/** Fill `{id}` in a template produced by matchBreadcrumbRoute. */
export function fillTemplate(template: string, id: string): string {
  return template.replace('{id}', id)
}
