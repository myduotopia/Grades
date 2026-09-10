import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import { useLocation } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'

import { api, type StudentDetail } from '../lib/api'
import {
  fillTemplate,
  matchBreadcrumbRoute,
  type Crumb,
  type CrumbSpec,
  type CrumbSwitcher,
  type CrumbSwitcherItem,
} from '../lib/breadcrumbs'
import { classroomDisplayName } from '../lib/classroomFormat'
import { NAV_PRIMARY, NAV_SETTINGS } from '../layout/navItems'
import { useSemesterView } from '../state/SemesterView'
import { useClassrooms } from './useClassrooms'
import { useStudents } from './useStudents'

/**
 * Turn the current URL into breadcrumb levels with real labels + switcher
 * lists (issue #250).
 *
 * Every query below reuses the exact query key the corresponding page already
 * uses, so on a class page the breadcrumb costs zero extra network requests —
 * it reads the same react-query cache entry.
 */
/**
 * First-level switcher: the sidebar's sections (#254).
 *
 * Always the primary group. The settings group is appended only when the
 * current page lives in it — otherwise the ✓ would have nowhere to land and
 * the menu would look broken on /settings and /admin/*.
 */
function sectionSwitcher(
  activeTo: string,
  group: 'primary' | 'settings',
  t: TFunction,
): CrumbSwitcher {
  const items: CrumbSwitcherItem[] = NAV_PRIMARY.map((item) => ({
    id: item.to,
    label: t(item.key),
    to: item.to,
    icon: item.icon,
  }))

  if (group === 'settings') {
    NAV_SETTINGS.forEach((item, i) => {
      items.push({
        id: item.to,
        label: t(item.key),
        to: item.to,
        icon: item.icon,
        dividerBefore: i === 0,
      })
    })
  }

  return { items, activeId: activeTo }
}

export function useBreadcrumbs(): Crumb[] | null {
  const { t, i18n } = useTranslation()
  const { pathname } = useLocation()
  const { viewed } = useSemesterView()

  const specs = matchBreadcrumbRoute(pathname)

  const classroomSpec = specs?.find((s) => s.kind === 'classroom')
  const snapshotSpec = specs?.find((s) => s.kind === 'snapshot')

  // `enabled` keeps admin / settings pages from fetching lists they never show.
  const classroomsQ = useClassrooms({ enabled: !!classroomSpec })
  const classrooms = classroomsQ.data?.data ?? []

  // Same key shape as Snapshots.tsx's unfiltered listing, so navigating from
  // /snapshots into a snapshot reuses the cached page of results.
  const snapshotsQ = useQuery({
    queryKey: ['snapshots', null, null, null, viewed?.id ?? null],
    queryFn: () => api.snapshots.list({ semester_id: viewed?.id }),
    enabled: !!snapshotSpec,
  })
  const snapshots = snapshotsQ.data?.data ?? []

  if (!specs) return null

  const crumbs: Crumb[] = specs.map((spec: CrumbSpec, i) => {
    const isLast = i === specs.length - 1

    if (spec.kind === 'section') {
      return {
        key: spec.key,
        label: t(spec.labelKey),
        to: isLast ? undefined : spec.to,
        switcher: sectionSwitcher(spec.to, spec.group, t),
      }
    }

    if (spec.kind === 'static') {
      return {
        key: spec.key,
        label: t(spec.labelKey),
        to: isLast ? undefined : spec.to,
      }
    }

    if (spec.kind === 'classroom') {
      const active = classrooms.find((c) => c.id === spec.classroomId)
      return {
        key: spec.key,
        label: active
          ? classroomDisplayName(active.grade, active.name, i18n.language)
          : t('breadcrumb.loading'),
        to: isLast ? undefined : fillTemplate(spec.template, spec.classroomId),
        switcher: {
          activeId: spec.classroomId,
          isLoading: classroomsQ.isLoading,
          items: classrooms.map((c) => ({
            id: c.id,
            label: classroomDisplayName(c.grade, c.name, i18n.language),
            to: fillTemplate(spec.template, c.id),
          })),
        },
      }
    }

    const activeSnap = snapshots.find((s) => s.id === spec.snapshotId)
    return {
      key: spec.key,
      label: activeSnap ? activeSnap.name : t('breadcrumb.loading'),
      to: isLast ? undefined : `/snapshots/${spec.snapshotId}/grades`,
      switcher: {
        activeId: spec.snapshotId,
        isLoading: snapshotsQ.isLoading,
        items: snapshots.map((s) => ({
          id: s.id,
          label: `${classroomDisplayName(
            s.classroom_grade,
            s.classroom_name,
            i18n.language,
          )} · ${s.name}`,
          to: `/snapshots/${s.id}/grades`,
        })),
      },
    }
  })

  return crumbs
}

/**
 * Breadcrumbs for /students/:studentId.
 *
 * That route is flat — it carries no classroom id — so the class level has to
 * come from the detail payload the page already fetched. The page passes the
 * result of this hook to <PageHeader breadcrumb>.
 */
export function useStudentBreadcrumbs(
  detail: StudentDetail | undefined,
): Crumb[] | null {
  const { t, i18n } = useTranslation()
  const classroomId = detail?.classroom_id
  const studentsQ = useStudents(classroomId)
  const students = studentsQ.data?.data ?? []

  if (!detail) return null

  const studentLabel = (
    seatNumber: number,
    name: string | null | undefined,
  ) => `${seatNumber} ${name ?? t('students.no_name')}`.trim()

  return [
    {
      key: 'section',
      label: t('nav.classes'),
      to: '/classes',
      // Without this the student page would be the only one whose first level
      // has no section switcher (#254).
      switcher: sectionSwitcher('/classes', 'primary', t),
    },
    {
      key: 'classroom',
      label: classroomDisplayName(
        detail.classroom_grade,
        detail.classroom_name,
        i18n.language,
      ),
      to: `/classes/${detail.classroom_id}/students`,
    },
    {
      key: 'student',
      label: studentLabel(detail.seat_number, detail.name),
      switcher: {
        activeId: detail.id,
        isLoading: studentsQ.isLoading,
        items: students.map((s) => ({
          id: s.id,
          label: studentLabel(s.seat_number, s.name),
          to: `/students/${s.id}`,
        })),
      },
    },
  ]
}
