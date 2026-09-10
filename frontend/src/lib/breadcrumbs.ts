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
}

/** A level before data has been attached. */
export type CrumbSpec =
  | { kind: 'static'; key: string; labelKey: string; to?: string }
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
 * Map a pathname to breadcrumb levels.
 *
 * Returns null when the page is top-level (a single crumb would just repeat
 * the page title) or unknown — the component then renders nothing at all, so
 * no empty row is left above the title.
 *
 * `/students/:studentId` deliberately returns null: that route is not nested
 * under its class, so the class level can only come from the student payload.
 * StudentDetail builds its own crumbs via `studentCrumbSpecs` instead.
 */
export function matchBreadcrumbRoute(pathname: string): CrumbSpec[] | null {
  const seg = pathname.split('/').filter(Boolean)

  // /classes/:classroomId/(students|groups|grades)
  if (seg[0] === 'classes' && seg.length >= 3) {
    const classroomId = seg[1]
    const leaf = seg[2]
    if (leaf !== 'students' && leaf !== 'groups' && leaf !== 'grades') {
      return null
    }
    const specs: CrumbSpec[] = [
      { kind: 'static', key: 'classes', labelKey: 'nav.classes', to: '/classes' },
      {
        kind: 'classroom',
        key: 'classroom',
        classroomId,
        template: `/classes/{id}/${leaf}`,
      },
      { kind: 'static', key: leaf, labelKey: `breadcrumb.${leaf}` },
    ]
    return specs
  }

  // /points/:classroomId
  if (seg[0] === 'points' && seg.length === 2) {
    return [
      { kind: 'static', key: 'points', labelKey: 'nav.points', to: '/points' },
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
    return [
      {
        kind: 'static',
        key: 'snapshots',
        labelKey: 'nav.snapshots',
        to: '/snapshots',
      },
      { kind: 'snapshot', key: 'snapshot', snapshotId: seg[1] },
    ]
  }

  return null
}

/** Fill `{id}` in a template produced by matchBreadcrumbRoute. */
export function fillTemplate(template: string, id: string): string {
  return template.replace('{id}', id)
}
