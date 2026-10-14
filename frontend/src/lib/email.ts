/**
 * Student email helpers (#261). Mirrors backend/email_validation.py so the
 * form can flag problems before the round-trip; the backend re-validates
 * and is the source of truth.
 */
const EMAIL_RE =
  /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/

/** trim + lowercase; blank → null. */
export function normalizeEmail(raw: string | null | undefined): string | null {
  const v = (raw ?? '').trim().toLowerCase()
  return v === '' ? null : v
}

export function isValidEmail(value: string): boolean {
  return value.length <= 255 && EMAIL_RE.test(value)
}
