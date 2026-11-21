/**
 * The Clinical tab's modes: Evolución (QW4) and Recetas (prescriptions), their
 * place, and who sees them.
 */

import { describe, expect, it } from 'vitest'

import {
  CLINICAL_MODES,
  clinicalModeFromQuery,
  isClinicalMode,
  visibleClinicalModes
} from '../../app/utils/clinicalModes'

const BOTH = { evolution: true, prescriptions: true }
const NEITHER = { evolution: false, prescriptions: false }

describe('clinical modes', () => {
  it('are Diagnóstico | Planes | Citas | Recetas | Histórico | Evolución, in that order', () => {
    expect([...CLINICAL_MODES]).toEqual([
      'diagnosis',
      'plans',
      'appointments',
      'prescriptions',
      'history',
      'evolution'
    ])
    expect(visibleClinicalModes(BOTH)).toEqual([
      'diagnosis',
      'plans',
      'appointments',
      'prescriptions',
      'history',
      'evolution'
    ])
  })

  it('Recetas sits between Citas and Histórico, and it is a ClinicalMode', () => {
    expect(isClinicalMode('prescriptions')).toBe(true)
    expect(CLINICAL_MODES).toHaveLength(6)
    expect(CLINICAL_MODES.indexOf('prescriptions')).toBe(CLINICAL_MODES.indexOf('appointments') + 1)
    expect(CLINICAL_MODES.indexOf('prescriptions')).toBe(CLINICAL_MODES.indexOf('history') - 1)
  })

  it('Evolución is still last, and it is a ClinicalMode', () => {
    expect(isClinicalMode('evolution')).toBe(true)
    expect(CLINICAL_MODES[CLINICAL_MODES.length - 1]).toBe('evolution')
  })

  it('hides Evolución, and only it, without notes access', () => {
    expect(visibleClinicalModes({ evolution: false, prescriptions: true })).toEqual([
      'diagnosis',
      'plans',
      'appointments',
      'prescriptions',
      'history'
    ])
  })

  it('hides Recetas, and only it, without prescriptions.read', () => {
    expect(visibleClinicalModes({ evolution: true, prescriptions: false })).toEqual([
      'diagnosis',
      'plans',
      'appointments',
      'history',
      'evolution'
    ])
  })

  it('with neither, the four everyone has remain', () => {
    expect(visibleClinicalModes(NEITHER)).toEqual(['diagnosis', 'plans', 'appointments', 'history'])
  })

  it('a URL asking for evolution without access falls through to nothing', () => {
    expect(clinicalModeFromQuery('evolution', { evolution: false, prescriptions: true })).toBeNull()
    expect(clinicalModeFromQuery('evolution', BOTH)).toBe('evolution')
  })

  it('a URL asking for prescriptions is accepted with access and refused without it', () => {
    expect(clinicalModeFromQuery('prescriptions', BOTH)).toBe('prescriptions')
    expect(clinicalModeFromQuery('prescriptions', { evolution: false, prescriptions: true })).toBe('prescriptions')
    expect(clinicalModeFromQuery('prescriptions', { evolution: true, prescriptions: false })).toBeNull()
    expect(clinicalModeFromQuery('prescriptions', NEITHER)).toBeNull()
  })

  it('having one of the two permissions never opens the other mode', () => {
    expect(clinicalModeFromQuery('evolution', { evolution: false, prescriptions: true })).toBeNull()
    expect(clinicalModeFromQuery('prescriptions', { evolution: true, prescriptions: false })).toBeNull()
  })

  it('every other mode is reachable from the URL either way', () => {
    for (const mode of ['diagnosis', 'plans', 'appointments', 'history']) {
      expect(clinicalModeFromQuery(mode, NEITHER)).toBe(mode)
    }
  })

  it('unknown or repeated values are handled', () => {
    expect(clinicalModeFromQuery('periodontogram', BOTH)).toBeNull()
    expect(clinicalModeFromQuery(undefined, BOTH)).toBeNull()
    expect(clinicalModeFromQuery(['evolution', 'plans'], BOTH)).toBe('evolution')
    expect(clinicalModeFromQuery(['prescriptions', 'plans'], BOTH)).toBe('prescriptions')
  })
})
