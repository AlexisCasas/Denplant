/**
 * The modes of the patient's Clinical tab, and which of them a user may see.
 *
 * One list, shared by the toggle that draws them and the tab that reads the
 * `?clinicalMode=` query, so a mode can never exist in one and not the other.
 * The order is the order on screen: Diagnóstico | Planes | Citas | Recetas |
 * Histórico | Evolución.
 */

import type { ClinicalMode } from '~~/app/types'

export const CLINICAL_MODES: readonly ClinicalMode[] = [
  'diagnosis',
  'plans',
  'appointments',
  'prescriptions',
  'history',
  'evolution'
]

export function isClinicalMode(value: unknown): value is ClinicalMode {
  return typeof value === 'string' && (CLINICAL_MODES as readonly string[]).includes(value)
}

export interface ClinicalModeAccess {
  /** `clinical_notes.notes.read` — Evolución is the notes history. */
  evolution: boolean
  /** `prescriptions.read` — Recetas is the prescriptions history. */
  prescriptions: boolean
}

/** The modes this user may open, in display order. */
export function visibleClinicalModes(access: ClinicalModeAccess): ClinicalMode[] {
  return CLINICAL_MODES.filter(
    mode =>
      (mode !== 'evolution' || access.evolution)
      && (mode !== 'prescriptions' || access.prescriptions)
  )
}

/** A mode taken from the URL, or `null` when it is unknown or not allowed. */
export function clinicalModeFromQuery(
  value: unknown,
  access: ClinicalModeAccess
): ClinicalMode | null {
  const raw = Array.isArray(value) ? value[0] : value
  return isClinicalMode(raw) && visibleClinicalModes(access).includes(raw) ? raw : null
}
