import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { OdontogramMapping } from '~/types'
import {
  buildCatalogOdontogramMapping,
  CATALOG_ODONTOGRAM_TREATMENT_TYPES,
  getVisualizationRuleLayers,
  isCatalogOdontogramTreatmentType,
  isOdontogramMappingIncomplete,
  normalizeTreatmentType,
  OCCLUSAL_VISUALIZATION,
  PATTERN_CONFIG,
  PULP_FILL_CONFIG,
  resolveCatalogOdontogramType
} from '~/config/odontogramConstants'

const NOT_BACKEND_WRITABLE = ['filling', 'root_canal', 'bridge_pontic', 'pontic', 'bridge_abutment', 'migrated']

// Regression coverage for HOTFIX-CATALOG-01: the catalog editor used to send
// visualization_rules as an array of bare rule-name strings (e.g. "occlusal_surface"),
// which the backend rejects because OdontogramMapping(Create).visualization_rules is
// `list[dict]`. getVisualizationRuleLayers must always build structured objects.

describe('getVisualizationRuleLayers', () => {
  it('returns structured objects, not bare rule-name strings, for filling_composite', () => {
    const layers = getVisualizationRuleLayers('filling_composite')
    expect(layers.length).toBeGreaterThan(0)
    for (const layer of layers) {
      expect(typeof layer).toBe('object')
      expect(typeof layer.layer).toBe('string')
    }
  })

  it('builds an occlusal_surface layer with the configured color and kind', () => {
    const layers = getVisualizationRuleLayers('filling_composite')
    const occlusal = layers.find(l => l.layer === 'occlusal_surface')
    expect(occlusal).toBeDefined()
    expect(occlusal?.color).toBe(OCCLUSAL_VISUALIZATION.filling_composite?.color)
    expect(occlusal?.kind).toBe(OCCLUSAL_VISUALIZATION.filling_composite?.type)
  })

  it('maps the legacy pattern_fill rule name to the cenital_pattern layer', () => {
    const layers = getVisualizationRuleLayers('crown')
    const pattern = layers.find(l => l.layer === 'cenital_pattern')
    expect(pattern).toBeDefined()
    expect(pattern?.pattern).toBe(PATTERN_CONFIG.crown?.type)
    expect(pattern?.color).toBe(PATTERN_CONFIG.crown?.color)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(layers.some(l => (l as any).layer === 'pattern_fill')).toBe(false)
  })

  it('builds a pulp_fill layer with color and the documented extent values', () => {
    const full = getVisualizationRuleLayers('root_canal_full').find(l => l.layer === 'pulp_fill')
    expect(full).toMatchObject({ layer: 'pulp_fill', color: PULP_FILL_CONFIG.root_canal_full?.color, extent: 'full' })

    const twoThirds = getVisualizationRuleLayers('root_canal_two_thirds').find(l => l.layer === 'pulp_fill')
    expect(twoThirds).toMatchObject({ extent: 'partial_2_3' })

    const half = getVisualizationRuleLayers('root_canal_half').find(l => l.layer === 'pulp_fill')
    expect(half).toMatchObject({ extent: 'partial_1_2' })
  })

  it('only emits layers with keys the backend model recognises (list[dict], no incompatible shapes)', () => {
    const validLayers = new Set(['pulp_fill', 'occlusal_surface', 'lateral_icon', 'cenital_pattern'])
    const validKeys = new Set(['layer', 'icon', 'pattern', 'color', 'kind', 'extent'])

    for (const type of CATALOG_ODONTOGRAM_TREATMENT_TYPES) {
      for (const rule of getVisualizationRuleLayers(type)) {
        expect(validLayers.has(rule.layer)).toBe(true)
        for (const key of Object.keys(rule)) {
          expect(validKeys.has(key)).toBe(true)
        }
      }
    }
  })
})

describe('CATALOG_ODONTOGRAM_TREATMENT_TYPES', () => {
  it('contains no legacy, role-only or import-only value the backend rejects', () => {
    for (const value of NOT_BACKEND_WRITABLE) {
      expect(CATALOG_ODONTOGRAM_TREATMENT_TYPES).not.toContain(value)
      expect(isCatalogOdontogramTreatmentType(value)).toBe(false)
    }
  })

  it('offers the modern types the backend accepts, including multi-tooth and implant crowns', () => {
    for (const value of ['filling_composite', 'bridge', 'splint', 'crown_on_implant', 'provisional_crown_on_implant']) {
      expect(CATALOG_ODONTOGRAM_TREATMENT_TYPES).toContain(value)
    }
  })

  it('matches the backend TreatmentType enum exactly', () => {
    // vitest runs with frontend/ as cwd
    const source = readFileSync(resolve(process.cwd(), '../backend/app/modules/odontogram/constants.py'), 'utf-8')
    const enumBody = source.split('class TreatmentType(StrEnum):')[1]!.split(/\nclass /)[0]!
    const backendValues = [...enumBody.matchAll(/^\s+[A-Z_]+ = "([a-z_]+)"/gm)].map(m => m[1])
    expect(backendValues.length).toBeGreaterThan(0)
    expect([...CATALOG_ODONTOGRAM_TREATMENT_TYPES].sort()).toEqual(backendValues.sort())
  })

  it('has no duplicates', () => {
    expect(new Set(CATALOG_ODONTOGRAM_TREATMENT_TYPES).size).toBe(CATALOG_ODONTOGRAM_TREATMENT_TYPES.length)
  })
})

describe('resolveCatalogOdontogramType (catalog editor read policy)', () => {
  it('keeps a modern stored type as-is', () => {
    expect(resolveCatalogOdontogramType('filling_composite')).toBe('filling_composite')
    expect(resolveCatalogOdontogramType('bridge')).toBe('bridge')
  })

  it('safely normalizes legacy filling to filling_composite', () => {
    expect(resolveCatalogOdontogramType('filling')).toBe('filling_composite')
  })

  it('safely normalizes legacy root_canal to root_canal_full', () => {
    expect(resolveCatalogOdontogramType('root_canal')).toBe('root_canal_full')
  })

  it('never turns bridge_pontic into pontic (or any other type) for writing', () => {
    // The generic render-side normalizer still maps it to pontic; the editor must not.
    expect(normalizeTreatmentType('bridge_pontic')).toBe('pontic')
    expect(resolveCatalogOdontogramType('bridge_pontic')).toBeUndefined()
  })

  it('treats other non-writable stored values as unsupported', () => {
    for (const value of ['pontic', 'bridge_abutment', 'migrated', 'not_a_type']) {
      expect(resolveCatalogOdontogramType(value)).toBeUndefined()
    }
    expect(resolveCatalogOdontogramType(undefined)).toBeUndefined()
  })
})

describe('buildCatalogOdontogramMapping (catalog editor write guard)', () => {
  it('builds a structured mapping for a writable type', () => {
    const mapping = buildCatalogOdontogramMapping('filling_composite', 'restauradora')
    expect(mapping).toMatchObject({
      odontogram_treatment_type: 'filling_composite',
      clinical_category: 'restauradora',
      visualization_rules: [{ layer: 'occlusal_surface', color: '#3B82F6', kind: 'solid_fill' }],
      visualization_config: { color: '#3B82F6' }
    })
  })

  it('refuses to build a mapping for any clinical type the backend does not accept', () => {
    for (const value of NOT_BACKEND_WRITABLE) {
      expect(buildCatalogOdontogramMapping(value, 'restauradora')).toBeNull()
    }
  })

  it('refuses to build a mapping without a clinical category', () => {
    expect(buildCatalogOdontogramMapping('filling_composite', undefined)).toBeNull()
  })
})

describe('isOdontogramMappingIncomplete (catalog editor form state)', () => {
  it('flags a selected writable type with no clinical category, which also yields no mapping', () => {
    expect(isOdontogramMappingIncomplete('bridge', undefined)).toBe(true)
    expect(isOdontogramMappingIncomplete('splint', '')).toBe(true)
    expect(buildCatalogOdontogramMapping('bridge', undefined)).toBeNull()
  })

  it('accepts a type with a category, and "no mapping" without one', () => {
    expect(isOdontogramMappingIncomplete('bridge', 'restauradora')).toBe(false)
    expect(isOdontogramMappingIncomplete(undefined, undefined)).toBe(false)
  })
})

describe('buildCatalogOdontogramMapping with an existing mapping', () => {
  const customCrown: OdontogramMapping = {
    id: 'mapping-1',
    odontogram_treatment_type: 'crown',
    visualization_rules: [{ layer: 'cenital_pattern', pattern: 'solid', color: '#FBBF24' }],
    visualization_config: { color: '#FBBF24', note: 'zirconia variant' },
    clinical_category: 'restauradora'
  }

  it('preserves exact custom rules/config when the type is unchanged, without the mapping id', () => {
    const mapping = buildCatalogOdontogramMapping('crown', 'restauradora', customCrown)
    expect(mapping).toEqual({
      odontogram_treatment_type: 'crown',
      visualization_rules: customCrown.visualization_rules,
      visualization_config: customCrown.visualization_config,
      clinical_category: 'restauradora'
    })
    expect(mapping).not.toHaveProperty('id')
  })

  it('lets the clinical category change while rules/config stay preserved', () => {
    const mapping = buildCatalogOdontogramMapping('crown', 'cirugia', customCrown)
    expect(mapping?.clinical_category).toBe('cirugia')
    expect(mapping?.visualization_rules).toEqual(customCrown.visualization_rules)
    expect(mapping?.visualization_config).toEqual(customCrown.visualization_config)
  })

  it('regenerates defaults when the type changes (crown -> filling_composite)', () => {
    const mapping = buildCatalogOdontogramMapping('filling_composite', 'restauradora', customCrown)
    expect(mapping?.visualization_rules).toEqual(getVisualizationRuleLayers('filling_composite'))
    expect(mapping?.visualization_config).toEqual({ color: '#3B82F6' })
  })

  it('treats a stored legacy filling upgraded to filling_composite as a type change', () => {
    const legacyFilling: OdontogramMapping = {
      id: 'mapping-2',
      odontogram_treatment_type: 'filling',
      visualization_rules: [{ layer: 'occlusal_surface', color: '#000000', kind: 'dot' }],
      visualization_config: { color: '#000000' },
      clinical_category: 'restauradora'
    }
    const selected = resolveCatalogOdontogramType(legacyFilling.odontogram_treatment_type)
    expect(selected).toBe('filling_composite')

    const mapping = buildCatalogOdontogramMapping(selected, 'restauradora', legacyFilling)
    expect(mapping?.odontogram_treatment_type).toBe('filling_composite')
    expect(mapping?.visualization_rules).toEqual(getVisualizationRuleLayers('filling_composite'))
    expect(mapping?.visualization_config).toEqual({ color: '#3B82F6' })
  })

  it('keeps unsupported bridge_pontic unresolved and unwritable', () => {
    const legacyPontic: OdontogramMapping = {
      id: 'mapping-3',
      odontogram_treatment_type: 'bridge_pontic',
      visualization_rules: [],
      visualization_config: {},
      clinical_category: 'restauradora'
    }
    const selected = resolveCatalogOdontogramType(legacyPontic.odontogram_treatment_type)
    expect(selected).toBeUndefined()
    expect(buildCatalogOdontogramMapping(selected, 'restauradora', legacyPontic)).toBeNull()
    expect(buildCatalogOdontogramMapping('bridge_pontic', 'restauradora', legacyPontic)).toBeNull()
  })
})
