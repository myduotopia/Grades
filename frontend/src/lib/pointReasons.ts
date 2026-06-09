import type { PointReason } from './api'

/**
 * Display label for a configured point reason (#193).
 *
 * Seeded presets carry a `preset_key` and are shown via the bilingual i18n
 * label `point_reason.<preset_key>`; teacher-added reasons are free text and
 * render their stored `name` verbatim.
 *
 * NOTE: this is only for rows coming from the teacher's `point_reasons` list
 * (the reason picker / admin page). Historical `PointRecord.reason` values are
 * already-resolved strings — render those as-is.
 */
export function reasonLabel(
  r: Pick<PointReason, 'preset_key' | 'name'>,
  t: (key: string) => string,
): string {
  return r.preset_key ? t(`point_reason.${r.preset_key}`) : r.name
}
