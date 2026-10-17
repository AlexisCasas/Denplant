/**
 * DP-08.B2 (F5) — pure helpers for editing a treatment's surfaces.
 *
 * The server is the authority (`PUT /odontogram/treatments/{id}` answers 409
 * `surfaces_locked_<reason>` when the edit is unsafe); the UI only avoids
 * sending no-op changes and explains refusals.
 */
import type { Surface } from '~~/app/types'

export const SURFACES_LOCKED_PREFIX = 'surfaces_locked_'

/** Reasons the backend may give (suffix of the stable code). */
export const SURFACES_LOCKED_REASONS = [
  'not_planned',
  'not_single_tooth',
  'type_without_surfaces',
  'no_surfaces',
  'linked_to_plan',
  'linked_to_budget',
  'price_snapshot_drift'
] as const
export type SurfacesLockedReason = typeof SURFACES_LOCKED_REASONS[number] | 'locked'

/** Order-insensitive, duplicate-free view of a surface list. */
export function normalizeSurfaces(surfaces: readonly Surface[] | null | undefined): Surface[] {
  return [...new Set(surfaces ?? [])].sort() as Surface[]
}

/** True only when the SET of surfaces differs: `['O','M']` equals `['M','O']`. */
export function surfacesChanged(
  original: readonly Surface[] | null | undefined,
  selected: readonly Surface[] | null | undefined
): boolean {
  const a = normalizeSurfaces(original)
  const b = normalizeSurfaces(selected)
  return a.length !== b.length || a.some((s, i) => s !== b[i])
}

interface HttpErrorLike {
  statusCode?: number
  status?: number
  data?: { code?: unknown } | null
}

/** The lock reason of a refused surfaces edit, or `null` for any other failure. */
export function surfacesLockedReason(error: unknown): SurfacesLockedReason | null {
  const e = error as HttpErrorLike | null
  const status = e?.statusCode ?? e?.status
  const code = e?.data?.code
  if (status !== 409 || typeof code !== 'string' || !code.startsWith(SURFACES_LOCKED_PREFIX)) {
    return null
  }
  const reason = code.slice(SURFACES_LOCKED_PREFIX.length)
  return (SURFACES_LOCKED_REASONS as readonly string[]).includes(reason)
    ? (reason as SurfacesLockedReason)
    : 'locked'
}
