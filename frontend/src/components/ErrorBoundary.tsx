import { Component, type ErrorInfo, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { PageContainer } from '../layout/PageContainer'
import { PageHeader } from '../layout/PageHeader'

/**
 * Catches render-time exceptions so a single broken page shows a readable
 * error instead of unmounting the whole tree into a blank white screen
 * (issue #243: a conditional-hook crash on the grades page did exactly that).
 *
 * `resetKey` should be the current pathname — changing it clears the error so
 * navigating away recovers without a manual refresh.
 */
export class ErrorBoundary extends Component<
  { children: ReactNode; resetKey?: string },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Keep the original stack in the console — the fallback UI deliberately
    // doesn't show it to the teacher.
    console.error('[ErrorBoundary]', error, info.componentStack)
  }

  componentDidUpdate(prev: { children: ReactNode; resetKey?: string }) {
    if (this.state.error && prev.resetKey !== this.props.resetKey) {
      this.setState({ error: null })
    }
  }

  render() {
    if (this.state.error) {
      return <ErrorFallback message={this.state.error.message} />
    }
    return this.props.children
  }
}

function ErrorFallback({ message }: { message: string }) {
  const { t } = useTranslation()
  return (
    <PageContainer>
      <PageHeader
        title={t('errors.boundary.title')}
        subtitle={t('errors.boundary.subtitle')}
      />
      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6">
        <p className="text-sm text-slate-600 break-words">{message}</p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="mt-4 inline-flex items-center px-4 py-2 rounded-lg bg-amber-500 hover:bg-amber-600 active:bg-amber-700 text-white text-sm font-medium shadow-sm transition-colors"
        >
          {t('errors.boundary.reload')}
        </button>
      </div>
    </PageContainer>
  )
}
