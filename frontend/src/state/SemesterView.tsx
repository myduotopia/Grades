import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'

import { useSemesters } from '../hooks/useSemesters'
import type { Semester } from '../lib/api'

const LS_KEY = 'app.viewed_semester_id'

interface SemesterViewValue {
  /** The semester the user is currently viewing on app pages. */
  viewed: Semester | null
  /** Whichever semester has is_current=true server-side. */
  current: Semester | null
  /** True when viewed exists and is not the same as current. */
  isArchived: boolean
  /** All semesters owned by the user. */
  all: Semester[]
  /** Pick a different semester to view (does NOT mutate is_current). */
  setViewed: (id: string) => void
}

const Ctx = createContext<SemesterViewValue | null>(null)

export function SemesterViewProvider({ children }: { children: ReactNode }) {
  const semestersQ = useSemesters()
  const all = useMemo(() => semestersQ.data?.data ?? [], [semestersQ.data])
  const current = useMemo(() => all.find((s) => s.is_current) ?? null, [all])

  const [viewedId, setViewedId] = useState<string | null>(() => {
    if (typeof window === 'undefined') return null
    return localStorage.getItem(LS_KEY)
  })

  // Persist localStorage updates so other tabs can pick it up if needed.
  const setViewed = useCallback((id: string) => {
    setViewedId(id)
    try {
      localStorage.setItem(LS_KEY, id)
    } catch {
      // Ignore quota / privacy-mode errors.
    }
  }, [])

  // If the stored id no longer exists in the user's semesters (deleted, or
  // viewed from another account), forget it.
  useEffect(() => {
    if (!viewedId) return
    if (all.length === 0) return
    if (!all.some((s) => s.id === viewedId)) {
      setViewedId(null)
      try {
        localStorage.removeItem(LS_KEY)
      } catch {
        // Ignore.
      }
    }
  }, [viewedId, all])

  const viewed = useMemo(() => {
    if (viewedId) {
      const hit = all.find((s) => s.id === viewedId)
      if (hit) return hit
    }
    return current
  }, [viewedId, all, current])

  const isArchived = !!viewed && !!current && viewed.id !== current.id

  const value = useMemo<SemesterViewValue>(
    () => ({
      viewed,
      current,
      isArchived,
      all,
      setViewed,
    }),
    [viewed, current, isArchived, all, setViewed],
  )

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useSemesterView(): SemesterViewValue {
  const v = useContext(Ctx)
  if (v === null) {
    throw new Error(
      'useSemesterView must be used inside a <SemesterViewProvider>',
    )
  }
  return v
}
