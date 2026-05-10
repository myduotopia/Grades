import type { ReactNode } from 'react'

/**
 * Standard page wrapper. Every routed page should be wrapped in this so the
 * max-width and horizontal centering stay consistent across the app.
 *
 * Width rule: max-w-6xl (1152px). See docs/page-checklist.md.
 */
export function PageContainer({ children }: { children: ReactNode }) {
  return <div className="max-w-6xl mx-auto">{children}</div>
}
