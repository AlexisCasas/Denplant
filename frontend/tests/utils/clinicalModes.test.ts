/**
 * The Clinical tab's modes (QW4): the fifth one, its place, and who sees it.
 */

import { describe, expect, it } from 'vitest'

import {
  CLINICAL_MODES,
  clinicalModeFromQuery,
  isClinicalMode,
  visibleClinicalModes
} from '../../app/utils/clinicalModes'

describe('clinical modes', () => {
  it('are Diagnóstico | Planes | Citas | Histórico | Evolución, in that order', () => {
    expect([...CLINICAL_MODES]).toEqual(['diagnosis', 'plans', 'appointments', 'history', 'evolution'])
    expect(visibleClinicalModes({ evolution: true })).toEqual([
      'diagnosis',
      'plans',
      'appointments',
      'history',
      'evolution'
    ])
  })

  it('Evolución is the fifth, and it is a ClinicalMode', () => {
    expect(isClinicalMode('evolution')).toBe(true)
    expect(CLINICAL_MODES).toHaveLength(5)
    expect(CLINICAL_MODES[4]).toBe('evolution')
  })

  it('hides Evolución, and only it, without notes access', () => {
    expect(visibleClinicalModes({ evolution: false })).toEqual([
      'diagnosis',
      'plans',
      'appointments',
      'history'
    ])
  })

  it('a URL asking for evolution without access falls through to nothing', () => {
    expect(clinicalModeFromQuery('evolution', { evolution: false })).toBeNull()
    expect(clinicalModeFromQuery('evolution', { evolution: true })).toBe('evolution')
  })

  it('every other mode is reachable from the URL either way', () => {
    for (const mode of ['diagnosis', 'plans', 'appointments', 'history']) {
      expect(clinicalModeFromQuery(mode, { evolution: false })).toBe(mode)
    }
  })

  it('unknown or repeated values are handled', () => {
    expect(clinicalModeFromQuery('periodontogram', { evolution: true })).toBeNull()
    expect(clinicalModeFromQuery(undefined, { evolution: true })).toBeNull()
    expect(clinicalModeFromQuery(['evolution', 'plans'], { evolution: true })).toBe('evolution')
  })
})
