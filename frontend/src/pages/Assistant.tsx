import { useTranslation } from 'react-i18next'

import { useMe } from '../hooks/useMe'
import { MinimalShell } from '../layout/MinimalShell'
import { PageContainer } from '../layout/PageContainer'
import { PageHeader } from '../layout/PageHeader'

/**
 * Student 小老師 landing page (#261 skeleton). The score-entry UI itself
 * arrives with #262; until then the route exists so identity routing has a
 * destination.
 */
export function Assistant() {
  const { t } = useTranslation()
  const { data } = useMe()
  const contexts = data?.identity.assistant_contexts ?? []
  const name = contexts.find((c) => c.student_name)?.student_name

  return (
    <MinimalShell
      label={name ? t('assistant.header', { name }) : t('assistant.role')}
    >
      <PageContainer>
        <PageHeader
          title={t('assistant.title')}
          subtitle={t('assistant.subtitle')}
          breadcrumb={false}
        />
      </PageContainer>
    </MinimalShell>
  )
}
