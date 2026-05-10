import { useTranslation } from 'react-i18next'

import { ActionCard } from '../components/ActionCard'
import { PageContainer } from '../layout/PageContainer'
import { PageHeader } from '../layout/PageHeader'

export function Home() {
  const { t } = useTranslation()

  return (
    <PageContainer>
      <PageHeader title={t('home.welcome')} subtitle={t('home.intro')} />

      <section className="mb-10">
        <h2 className="text-sm font-semibold text-slate-500 uppercase tracking-wide mb-4">
          {t('home.quick_actions')}
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <ActionCard to="/classes" label={t('home.action.add_classroom')} primary />
          <ActionCard
            disabled
            label={t('home.action.add_assessment')}
            hint={t('home.action.coming_soon')}
          />
          <ActionCard
            disabled
            label={t('home.action.import_grades')}
            hint={t('home.action.coming_soon')}
          />
        </div>
      </section>

      <section className="bg-white border border-slate-200 rounded-xl p-6 lg:p-8">
        <h2 className="text-lg font-semibold text-slate-900 mb-4 tracking-tight">
          {t('home.workflow.heading')}
        </h2>
        <ol className="space-y-3">
          {[1, 2, 3].map((n) => (
            <li key={n} className="flex gap-3">
              <span className="shrink-0 w-6 h-6 rounded-full bg-amber-50 text-amber-700 text-xs font-semibold flex items-center justify-center">
                {n}
              </span>
              <span className="text-slate-700 leading-relaxed">
                {t(`home.workflow.step${n}`)}
              </span>
            </li>
          ))}
        </ol>
      </section>
    </PageContainer>
  )
}
