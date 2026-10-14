import { useTranslation } from 'react-i18next'
import toast from 'react-hot-toast'

import { useSetStudentAssistant } from '../hooks/useStudents'
import { ApiError, type Student } from '../lib/api'

/**
 * 小老師 on/off switch for one student row (#262). Disabled (with a hint)
 * when the student has no email — that's how their Google sign-in is
 * matched. Stays in sync with the StudentModal checkbox because both read
 * and invalidate the same students query.
 */
export function AssistantSwitch({
  student,
  classroomId,
}: {
  student: Student
  classroomId: string
}) {
  const { t } = useTranslation()
  const mut = useSetStudentAssistant(classroomId)
  const on = !!student.is_assistant
  const noEmail = !student.email
  const label = noEmail
    ? t('assistant_admin.needs_email')
    : t(on ? 'assistant_admin.switch_on' : 'assistant_admin.switch_off', {
        name: student.name || `#${student.seat_number}`,
      })

  function toggle() {
    if (noEmail || mut.isPending) return
    mut.mutate(
      { id: student.id, isAssistant: !on },
      {
        onError: (err) => {
          const key =
            err instanceof ApiError && err.body?.message_key
              ? err.body.message_key
              : 'common.error_generic'
          toast.error(t(key))
        },
      },
    )
  }

  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      title={label}
      disabled={noEmail || mut.isPending}
      onClick={toggle}
      className="inline-flex items-center justify-center min-h-[44px] min-w-[44px] -my-2 disabled:cursor-not-allowed"
    >
      <span
        className={`relative inline-block h-5 w-9 rounded-full transition-colors ${
          on ? 'bg-amber-500' : 'bg-slate-300'
        } ${noEmail ? 'opacity-40' : ''}`}
      >
        <span
          className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${
            on ? 'translate-x-4' : 'translate-x-0.5'
          }`}
        />
      </span>
    </button>
  )
}
