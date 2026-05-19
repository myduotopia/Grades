import { useTranslation } from 'react-i18next'

/**
 * Shown when the page is viewing data tagged with a non-current semester.
 * Read-only signalling only — the backend independently rejects writes
 * targeting non-current semesters (issue #55). Switch the global top-bar
 * SemesterSwitcher to re-enable edits.
 */
export function ArchivedSemesterBanner({ label }: { label?: string | null }) {
  const { t } = useTranslation()
  return (
    <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
      {label
        ? t('archived_banner.body_with_label', { label })
        : t('archived_banner.body')}
    </div>
  )
}
