/**
 * Colour mapping for probing depth.
 *
 * Two readings only, because that is all the chart claims: a probing depth of
 * 0–3 mm is normal and carries no pathological colour; 4 mm or more is
 * red. Unmeasured sites stay neutral. The condition belongs to the *site that
 * was measured* — nothing here colours the interval between two sites.
 *
 * This is a display threshold. It is deliberately not the backend's
 * deep-pocket count (>= 5 mm), which is a different index. Frontend-only —
 * the backend never cares about colours.
 */

export type HeatmapTone = 'neutral' | 'success' | 'error'

/** The first probing depth (mm) drawn as pathological. */
export const PROBING_ALERT_MM = 4

// Calm-design pastel mapping — matches DentalPin's status badge tonal
// scale (soft fill + accent ring + dark readable text).
const TONE_TO_CLASS: Record<HeatmapTone, string> = {
  neutral: 'bg-gray-100 ring-gray-300 text-gray-500 dark:bg-gray-700/70 dark:ring-gray-500 dark:text-gray-300',
  success: 'bg-emerald-50 ring-emerald-400 text-emerald-700 dark:bg-emerald-900/50 dark:ring-emerald-500 dark:text-emerald-200',
  error: 'bg-rose-50 ring-rose-400 text-rose-700 dark:bg-rose-900/50 dark:ring-rose-500 dark:text-rose-200'
}

const TONE_TO_HEX: Record<HeatmapTone, string> = {
  neutral: '#d1d5db', // gray-300
  success: '#34d399', // emerald-400
  error: '#fb7185' // rose-400
}

/** True for a measured probing depth of 4 mm or more. `0` is measured, and normal. */
export function isPathologicalProbing(pd: number | null | undefined): boolean {
  return pd !== null && pd !== undefined && pd >= PROBING_ALERT_MM
}

export function probingDepthTone(pd: number | null | undefined): HeatmapTone {
  if (pd === null || pd === undefined) return 'neutral'
  return isPathologicalProbing(pd) ? 'error' : 'success'
}

export function probingDepthClasses(pd: number | null | undefined): string {
  return TONE_TO_CLASS[probingDepthTone(pd)]
}

export function probingDepthHex(pd: number | null | undefined): string {
  return TONE_TO_HEX[probingDepthTone(pd)]
}
