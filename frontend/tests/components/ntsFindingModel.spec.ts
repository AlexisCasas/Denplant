/**
 * NTS-05C — the catalog-driven finding model.
 *
 * Most fixtures here are **synthetic rules**, not the real 38. That is the
 * point: a test that only ever feeds `6.1.2` through the editor cannot tell
 * whether the code read `scope` or recognised the id. A made-up rule with
 * `scope: 'arch'` proves the metadata is what drives the behaviour.
 *
 * The real catalog is then checked separately, once, to prove the synthetic
 * fixtures describe the same shapes the backend actually serves.
 */

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import type { NtsFindingTarget, NtsRule } from '../../../backend/app/modules/odontogram/frontend/types/nts'
import {
  activeSpecificationRequirements,
  anchorCount,
  buildTargets,
  describeAttributes,
  describeTargets,
  editableAttributes,
  emptySelection,
  expandRange,
  hasNumberedSubject,
  initialAttributes,
  missingRequiredAttributes,
  selectionFromTargets,
  selectionProblems,
  subjectRoles,
  subjectToothCount,
  usesToothSelection
} from '../../../backend/app/modules/odontogram/frontend/utils/ntsFindingModel'

// ---------------------------------------------------------------------------
// fixtures — deliberately invented rule ids
// ---------------------------------------------------------------------------

function makeRule(overrides: Partial<NtsRule> = {}): NtsRule {
  return {
    rule_id: 'X.1',
    ordinal: 1,
    official_name: 'Synthetic rule',
    scope: 'tooth',
    target_identity: 'numbered',
    anchor: null,
    arch_cardinality: null,
    range_grouping: null,
    attributes: [],
    target_roles: [],
    specification_requirement: null,
    status: 'verified',
    ...overrides
  }
}

function attribute(overrides: Partial<NtsRule['attributes'][number]> = {}) {
  return {
    name: 'attr',
    kind: 'enum',
    required: true,
    is_sigla: false,
    values: [],
    status: 'verified',
    notes: null,
    ...overrides
  }
}

const UPPER_ROW = [18, 17, 16, 15, 14, 13, 12, 11, 21, 22, 23, 24, 25, 26, 27, 28]

// ---------------------------------------------------------------------------
// scope → what must be picked
// ---------------------------------------------------------------------------

describe('scope decides the target requirement, never a rule id', () => {
  it.each([
    ['tooth', 1],
    ['surface', 1],
    ['pair', 2],
    ['range', null],
    ['arch', null]
  ])('%s takes %s subject teeth', (scope, expected) => {
    expect(subjectToothCount(makeRule({ scope: scope as NtsRule['scope'] }))).toBe(expected)
  })

  it('an arch-scoped rule never asks for teeth', () => {
    expect(usesToothSelection(makeRule({ scope: 'arch', arch_cardinality: 'one' }))).toBe(false)
  })

  it('a surface-scoped rule targets one tooth; the surfaces are an attribute', () => {
    // The API has no surface target kind: `attributes.surfaces` carries the
    // norm's own M/D/O/V/L codes, so nothing geometric is sent.
    const rule = makeRule({
      scope: 'surface',
      attributes: [attribute({
        name: 'surfaces',
        kind: 'enum_multi',
        values: [
          { code: 'M', name: 'Mesial', status: 'verified', notes: null, specification_requirement: null },
          { code: 'O', name: 'Oclusal/Incisal', status: 'verified', notes: null, specification_requirement: null }
        ]
      })]
    })
    const selection = { ...emptySelection(), teeth: [16] }
    const targets = buildTargets(rule, selection)

    expect(targets).toHaveLength(1)
    expect(targets[0]).toMatchObject({ participation: 'subject', target_kind: 'fdi_tooth', tooth_number: 16 })
    expect(JSON.stringify(targets)).not.toMatch(/outer-|center-|surface/)
  })
})

describe('buildTargets produces exactly what the API declares', () => {
  it('tooth', () => {
    const targets = buildTargets(makeRule(), { ...emptySelection(), teeth: [21] })
    expect(targets).toEqual([
      { participation: 'subject', target_kind: 'fdi_tooth', tooth_number: 21, role: null, group_index: 0, position: 0 }
    ])
  })

  it('pair keeps both teeth as subjects', () => {
    const targets = buildTargets(makeRule({ scope: 'pair' }), { ...emptySelection(), teeth: [11, 21] })
    expect(targets.map(t => t.tooth_number)).toEqual([11, 21])
    expect(targets.every(t => t.participation === 'subject')).toBe(true)
  })

  it('range sends every tooth of the span in one group, not one finding each', () => {
    const rule = makeRule({ scope: 'range', range_grouping: 'single_segment' })
    const teeth = expandRange(UPPER_ROW, 16, 26)
    const targets = buildTargets(rule, { ...emptySelection(), teeth })

    // 16 down to 11 then 21 up to 26: twelve teeth across the midline.
    expect(targets).toHaveLength(12)
    expect(new Set(targets.map(t => t.group_index))).toEqual(new Set([0]))
    expect(targets.map(t => t.position)).toEqual([...Array(12).keys()])
  })

  it('arch sends arch targets, never teeth', () => {
    const rule = makeRule({ scope: 'arch', arch_cardinality: 'one' })
    const targets = buildTargets(rule, { ...emptySelection(), arches: ['upper'] })

    expect(targets).toEqual([
      { participation: 'subject', target_kind: 'arch', arch: 'upper', group_index: 0, position: 0 }
    ])
    expect(targets.every(t => t.tooth_number === undefined)).toBe(true)
  })

  it('an unnumbered subject is sent with no tooth number, located by anchors', () => {
    const rule = makeRule({
      target_identity: 'unnumbered',
      anchor: { kind: 'interproximal', cardinality: 2, role: 'spatial_reference_only' }
    })
    const targets = buildTargets(rule, { ...emptySelection(), anchors: [11, 12] })

    expect(targets[0]).toMatchObject({
      participation: 'subject',
      target_kind: 'unnumbered_tooth',
      tooth_number: null
    })
    expect(targets.filter(t => t.participation === 'anchor').map(t => t.tooth_number)).toEqual([11, 12])
    expect(hasNumberedSubject(rule)).toBe(false)
    expect(anchorCount(rule)).toBe(2)
  })

  it('a role rides on the target, never on the attributes', () => {
    const rule = makeRule({
      scope: 'range',
      target_roles: [{ code: 'pilar', name: 'Pilar', applies_to: 'subject', min_count: null, max_count: null, status: 'verified', notes: null }]
    })
    const targets = buildTargets(rule, { ...emptySelection(), teeth: [13, 12, 11], roles: { 13: 'pilar' } })

    expect(targets.find(t => t.tooth_number === 13)!.role).toBe('pilar')
    expect(targets.find(t => t.tooth_number === 12)!.role).toBeNull()
    expect(subjectRoles(rule).map(r => r.code)).toEqual(['pilar'])
  })
})

// ---------------------------------------------------------------------------
// range
// ---------------------------------------------------------------------------

describe('range spans follow the row as drawn', () => {
  it('expands between two endpoints across the midline', () => {
    expect(expandRange(UPPER_ROW, 16, 26)).toEqual([16, 15, 14, 13, 12, 11, 21, 22, 23, 24, 25, 26])
  })

  it('clicking the endpoints in reverse order gives the same span', () => {
    expect(expandRange(UPPER_ROW, 26, 16)).toEqual(expandRange(UPPER_ROW, 16, 26))
  })

  it('a single tooth is a one-tooth span, never empty', () => {
    expect(expandRange(UPPER_ROW, 16, 16)).toEqual([16])
  })

  it('a tooth outside the row yields nothing, so a cross-arch span cannot form', () => {
    expect(expandRange(UPPER_ROW, 16, 46)).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// pre-flight problems
// ---------------------------------------------------------------------------

describe('selectionProblems reports only what the catalog states', () => {
  it('a tooth rule needs exactly one subject', () => {
    const rule = makeRule()
    expect(selectionProblems(rule, emptySelection())[0]!.key).toBe('subjectCount')
    expect(selectionProblems(rule, { ...emptySelection(), teeth: [11] })).toEqual([])
  })

  it('a pair rule needs exactly two, and refuses one or three', () => {
    const rule = makeRule({ scope: 'pair' })
    expect(selectionProblems(rule, { ...emptySelection(), teeth: [11] })).not.toEqual([])
    expect(selectionProblems(rule, { ...emptySelection(), teeth: [11, 21] })).toEqual([])
    expect(selectionProblems(rule, { ...emptySelection(), teeth: [11, 21, 22] })).not.toEqual([])
  })

  it('a range needs at least one tooth but no invented minimum span', () => {
    const rule = makeRule({ scope: 'range', range_grouping: 'single_segment' })
    expect(selectionProblems(rule, emptySelection())[0]!.key).toBe('rangeRequired')
    // The norm states no minimum length, so a two-tooth span is acceptable.
    expect(selectionProblems(rule, { ...emptySelection(), teeth: [16, 15] })).toEqual([])
  })

  it('arch cardinality is read from the catalog', () => {
    const one = makeRule({ scope: 'arch', arch_cardinality: 'one' })
    expect(selectionProblems(one, { ...emptySelection(), arches: ['upper'] })).toEqual([])
    expect(selectionProblems(one, { ...emptySelection(), arches: ['upper', 'lower'] })[0]!.key)
      .toBe('archExactlyOne')

    const both = makeRule({ scope: 'arch', arch_cardinality: 'one_or_both' })
    expect(selectionProblems(both, { ...emptySelection(), arches: ['upper', 'lower'] })).toEqual([])
    expect(selectionProblems(both, emptySelection())[0]!.key).toBe('archOneOrBoth')
  })

  it('anchors must match the declared cardinality and be distinct', () => {
    const rule = makeRule({
      target_identity: 'unnumbered',
      anchor: { kind: 'interproximal', cardinality: 2, role: 'spatial_reference_only' }
    })
    expect(selectionProblems(rule, { ...emptySelection(), anchors: [11] })[0]!.key).toBe('anchorCount')
    expect(selectionProblems(rule, { ...emptySelection(), anchors: [11, 12] })).toEqual([])
  })

  it('a role the norm gives no bounds is never made mandatory', () => {
    const rule = makeRule({
      scope: 'range',
      target_roles: [{ code: 'pilar', name: 'Pilar', applies_to: 'subject', min_count: null, max_count: null, status: 'needs_clinical_review', notes: null }]
    })
    // Silence is not a constraint: a span with no pilar at all is fine.
    expect(selectionProblems(rule, { ...emptySelection(), teeth: [13, 12, 11] })).toEqual([])
  })

  it('a role the norm does bound is enforced', () => {
    const rule = makeRule({
      scope: 'range',
      target_roles: [{ code: 'pilar', name: 'Pilar', applies_to: 'subject', min_count: 2, max_count: 2, status: 'verified', notes: null }]
    })
    const problems = selectionProblems(rule, { ...emptySelection(), teeth: [13, 12, 11], roles: { 13: 'pilar' } })
    expect(problems.map(p => p.key)).toContain('roleMin')
  })
})

// ---------------------------------------------------------------------------
// attributes
// ---------------------------------------------------------------------------

describe('attributes are generated from metadata', () => {
  it('a fixed attribute is pre-filled and never asked for', () => {
    const rule = makeRule({
      attributes: [attribute({
        name: 'sigla',
        kind: 'fixed',
        is_sigla: true,
        values: [{ code: 'S', name: 'Sigla', status: 'verified', notes: null, specification_requirement: null }]
      })]
    })
    expect(initialAttributes(rule)).toEqual({ sigla: 'S' })
    expect(editableAttributes(rule)).toEqual([])
    expect(missingRequiredAttributes(rule, initialAttributes(rule))).toEqual([])
  })

  it('a required attribute blocks until it is filled, an optional one does not', () => {
    const rule = makeRule({
      attributes: [
        attribute({ name: 'must', required: true }),
        attribute({ name: 'may', required: false })
      ]
    })
    expect(missingRequiredAttributes(rule, {}).map(a => a.name)).toEqual(['must'])
    expect(missingRequiredAttributes(rule, { must: 'x' })).toEqual([])
  })

  it('required comes from the catalog, never from the attribute name', () => {
    // Same name, opposite flags: only the metadata decides.
    const optional = makeRule({ attributes: [attribute({ name: 'condition_state', required: false })] })
    const required = makeRule({ attributes: [attribute({ name: 'condition_state', required: true })] })
    expect(missingRequiredAttributes(optional, {})).toEqual([])
    expect(missingRequiredAttributes(required, {}).map(a => a.name)).toEqual(['condition_state'])
  })

  it('an empty multi-select counts as missing when required', () => {
    const rule = makeRule({ attributes: [attribute({ name: 'surfaces', kind: 'enum_multi', required: true })] })
    expect(initialAttributes(rule)).toEqual({ surfaces: [] })
    expect(missingRequiredAttributes(rule, { surfaces: [] }).map(a => a.name)).toEqual(['surfaces'])
    expect(missingRequiredAttributes(rule, { surfaces: ['M'] })).toEqual([])
  })

  it('blank text and null are missing; zero and false are values', () => {
    const rule = makeRule({
      attributes: [
        attribute({ name: 'text', kind: 'free_text' }),
        attribute({ name: 'number', kind: 'integer' })
      ]
    })
    expect(missingRequiredAttributes(rule, { text: '   ', number: null }).map(a => a.name))
      .toEqual(['text', 'number'])
    expect(missingRequiredAttributes(rule, { text: 'x', number: 0 })).toEqual([])
  })
})

describe('specification requirements', () => {
  const requirement = (code: string, required: boolean) => ({
    code, label: `${code} label`, required, status: 'verified', notes: null
  })

  it('a rule-level requirement is always active', () => {
    const rule = makeRule({ specification_requirement: requirement('rule_level', true) })
    expect(activeSpecificationRequirements(rule, {}).map(r => r.code)).toEqual(['rule_level'])
  })

  it('a variant-level requirement activates only with that variant selected', () => {
    const rule = makeRule({
      attributes: [attribute({
        name: 'kind',
        values: [
          { code: 'A', name: 'A', status: 'verified', notes: null, specification_requirement: requirement('needs_a', true) },
          { code: 'B', name: 'B', status: 'verified', notes: null, specification_requirement: null }
        ]
      })]
    })
    expect(activeSpecificationRequirements(rule, { kind: 'B' })).toEqual([])
    expect(activeSpecificationRequirements(rule, { kind: 'A' }).map(r => r.code)).toEqual(['needs_a'])
  })

  it('an advisory requirement is surfaced but is not a blocker', () => {
    // NTS-03.1: `required=false` means no normative evidence for a block,
    // which is not the same as the norm making the datum optional.
    const rule = makeRule({ specification_requirement: requirement('advisory', false) })
    const active = activeSpecificationRequirements(rule, {})
    expect(active).toHaveLength(1)
    expect(active.filter(r => r.required)).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// summaries and round-trip
// ---------------------------------------------------------------------------

function target(overrides: Partial<NtsFindingTarget> = {}): NtsFindingTarget {
  return {
    id: 't1',
    group_index: 0,
    position: 0,
    participation: 'subject',
    role: null,
    target_kind: 'fdi_tooth',
    tooth_number: 16,
    arch: null,
    local_ordinal: null,
    geometry: null,
    ...overrides
  }
}

describe('stored targets round-trip back into a selection', () => {
  it('teeth, roles, arches and anchors all survive', () => {
    const selection = selectionFromTargets([
      target({ tooth_number: 13, role: 'pilar' }),
      target({ id: 't2', tooth_number: 12, position: 1 }),
      target({ id: 't3', participation: 'anchor', tooth_number: 11, position: 2 })
    ])
    expect(selection.teeth).toEqual([13, 12])
    expect(selection.roles).toEqual({ 13: 'pilar' })
    expect(selection.anchors).toEqual([11])
  })

  it('an edit re-sends exactly what was stored when nothing changed', () => {
    const rule = makeRule({ scope: 'pair' })
    const stored = [target({ tooth_number: 11 }), target({ id: 't2', tooth_number: 21, position: 1 })]
    expect(buildTargets(rule, selectionFromTargets(stored)).map(t => t.tooth_number)).toEqual([11, 21])
  })
})

describe('summaries are generic, never per-rule formatters', () => {
  it('an enum shows the catalog label for the stored code', () => {
    const rule = makeRule({
      attributes: [attribute({
        name: 'material',
        values: [{ code: 'AM', name: 'Amalgama Dental', status: 'verified', notes: null, specification_requirement: null }]
      })]
    })
    expect(describeAttributes(rule, { material: 'AM' }))
      .toEqual([{ name: 'material', label: 'material', value: 'Amalgama Dental' }])
  })

  it('a multi-select joins its labels', () => {
    const rule = makeRule({
      attributes: [attribute({
        name: 'surfaces',
        kind: 'enum_multi',
        values: [
          { code: 'M', name: 'Mesial', status: 'verified', notes: null, specification_requirement: null },
          { code: 'O', name: 'Oclusal/Incisal', status: 'verified', notes: null, specification_requirement: null }
        ]
      })]
    })
    expect(describeAttributes(rule, { surfaces: ['M', 'O'] })[0]!.value).toBe('Mesial, Oclusal/Incisal')
  })

  it('an unknown rule degrades to raw values instead of crashing', () => {
    expect(describeAttributes(null, { anything: 'X' }))
      .toEqual([{ name: 'anything', label: 'anything', value: 'X' }])
  })

  it('target summaries come from the stored structure, not the drawing', () => {
    const summary = describeTargets(makeRule({ scope: 'range' }), [
      target({ tooth_number: 16 }),
      target({ id: 't2', tooth_number: 15, position: 1, role: 'pilar' }),
      target({ id: 't3', participation: 'anchor', tooth_number: 14, position: 2 })
    ])
    expect(summary.teeth).toEqual([16, 15])
    expect(summary.anchors).toEqual([14])
    expect(summary.roles).toEqual([{ tooth: 15, role: 'pilar' }])
    expect(summary.unnumberedSubject).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// NTS-05F.2a — a rule that declares nothing must describe as nothing,
// never crash
// ---------------------------------------------------------------------------
//
// `NtsRule.attributes` and `NtsRuleAttribute.values` are typed as always
// present, and the live API keeps that promise: verified end-to-end against
// the running backend (`GET /api/v1/odontogram/nts/catalogs/pe_nts_188_2022`)
// for this ticket, 6.1.10 comes back with `"attributes":[]` and 6.1.13's
// `rotation_sense` with `"values":[]` — never an absent key.
//
// The catalog's own *source* file is a different matter. It is the
// pre-validation authoring format — the same file this suite's own
// "the real catalog matches..." block below reads directly — and a rule or
// attribute that declares nothing simply omits the key there. `6.1.10
// Fractura dental` has no `attributes` key at all; `6.1.13 Giroversión`'s
// `rotation_sense` (`kind: 'free_text'`) has no `values` key. Before this
// ticket, `describeAttributes` read `rule?.attributes.map(...)` and
// `definition?.values.find(...)` — optional chaining that only guards the
// `rule?.`/`definition?.` step, not the property access right after it — so
// either shape threw `Cannot read properties of undefined`.
//
// Fixtures below are the real rules, not synthetic ones: the whole point is
// the exact shape the catalog source file has, which `makeRule`/`attribute`
// (always filling `attributes: []`/`values: []`) cannot reproduce.

describe('an attribute description is total for the catalog SOURCE file\'s shape', () => {
  const catalog = JSON.parse(
    readFileSync(
      resolve(process.cwd(), '../backend/app/modules/odontogram/nts/catalog/pe_nts_188_2022.json'),
      'utf8'
    )
  ) as { rules: Array<Record<string, unknown>> }

  function findRule(ruleId: string): NtsRule {
    const found = catalog.rules.find(r => r.rule_id === ruleId)
    if (!found) throw new Error(`fixture rule missing from catalog: ${ruleId}`)
    // Deliberately typed as NtsRule despite omitting a field the type
    // declares required — that omission is the real shape under test, and
    // is exactly what `Object.prototype.hasOwnProperty` below confirms.
    return found as unknown as NtsRule
  }

  const FRACTURE_RULE = findRule('6.1.10')
  const GIROVERSION_RULE = findRule('6.1.13')
  const SEALANT_RULE = findRule('6.1.35')

  it('confirms the fixture shape these tests depend on', () => {
    expect(Object.prototype.hasOwnProperty.call(FRACTURE_RULE, 'attributes')).toBe(false)
    const rotationSense = (GIROVERSION_RULE.attributes as unknown as Array<Record<string, unknown>>)[0]
    expect(rotationSense).toBeTruthy()
    expect(rotationSense!.kind).toBe('free_text')
    expect(Object.prototype.hasOwnProperty.call(rotationSense, 'values')).toBe(false)
  })

  it('C — a rule with no attributes key describes as no attributes, not a crash', () => {
    expect(() => describeAttributes(FRACTURE_RULE, {})).not.toThrow()
    expect(describeAttributes(FRACTURE_RULE, {})).toEqual([])
  })

  it('D — a free_text attribute with no values key does not throw', () => {
    expect(() => describeAttributes(GIROVERSION_RULE, { rotation_sense: 'mesial' })).not.toThrow()
  })

  it('E — the free_text value recorded is shown verbatim, never dropped', () => {
    const freeText = 'Giro de 45° hacia mesial, confirmado en dos citas.'
    // `definition?.values?.find(...)` degrading to "nothing shown" would
    // pass a naive not-throwing test while silently losing the clinician's
    // own words — the exact failure this ticket refuses to accept.
    expect(describeAttributes(GIROVERSION_RULE, { rotation_sense: freeText }))
      .toEqual([{ name: 'rotation_sense', label: 'rotation_sense', value: freeText }])
  })

  it('F — an enumerated attribute (sealant) still resolves its catalog label', () => {
    // Regression: the fix must not turn every attribute into raw text.
    expect(describeAttributes(SEALANT_RULE, { condition_state: 'good' }))
      .toEqual([{ name: 'condition_state', label: 'condition_state', value: 'Buen estado' }])
  })

  it('G — a stored key this rule does not declare renders raw, not blank', () => {
    expect(describeAttributes(FRACTURE_RULE, { some_future_field: 'texto libre' }))
      .toEqual([{ name: 'some_future_field', label: 'some_future_field', value: 'texto libre' }])
  })

  it('H — null, undefined and empty values never produce garbage strings', () => {
    const described = describeAttributes(GIROVERSION_RULE, {
      rotation_sense: null,
      other: undefined,
      empty: ''
    })
    expect(described).toHaveLength(3)
    for (const row of described) {
      expect(row.value).not.toBe('undefined')
      expect(row.value).not.toBe('null')
      expect(row.value).not.toContain('[object Object]')
    }
  })

  it('the sibling attribute functions tolerate the same missing-key shape', () => {
    // `describeAttributes` is the one the crashing screen and print paths
    // call, but every function in this module that walks `rule.attributes`
    // had the identical unguarded pattern.
    expect(() => editableAttributes(FRACTURE_RULE)).not.toThrow()
    expect(editableAttributes(FRACTURE_RULE)).toEqual([])

    expect(() => initialAttributes(FRACTURE_RULE)).not.toThrow()
    expect(initialAttributes(FRACTURE_RULE)).toEqual({})

    expect(() => missingRequiredAttributes(FRACTURE_RULE, {})).not.toThrow()
    expect(missingRequiredAttributes(FRACTURE_RULE, {})).toEqual([])

    expect(() => activeSpecificationRequirements(FRACTURE_RULE, {})).not.toThrow()
    expect(activeSpecificationRequirements(GIROVERSION_RULE, { rotation_sense: 'mesial' })).toEqual([])
  })

  it('P — no rule id ever appears in the production fix', () => {
    // The guard is `?? []` on a field, not a branch on which rule this is.
    const source = readFileSync(
      resolve(process.cwd(), '../backend/app/modules/odontogram/frontend/utils/ntsFindingModel.ts'),
      'utf8'
    )
    expect(source).not.toMatch(/rule_id\s*===\s*['"]6\.1\.\d+['"]/)
    expect(source).not.toContain('\'6.1.10\'')
    expect(source).not.toContain('\'6.1.13\'')
  })
})

// ---------------------------------------------------------------------------
// the synthetic fixtures describe the real catalog
// ---------------------------------------------------------------------------

describe('the real catalog matches the shapes these fixtures assume', () => {
  // Resolved from the vitest root (frontend/) rather than from import.meta,
  // which this environment does not expose as a file URL.
  const catalog = JSON.parse(
    readFileSync(
      resolve(process.cwd(), '../backend/app/modules/odontogram/nts/catalog/pe_nts_188_2022.json'),
      'utf8'
    )
  ) as { rules: Array<Record<string, unknown>> }

  it('uses every scope the editor builds UI for, and never `mouth`', () => {
    const scopes = new Set(catalog.rules.map(r => r.scope))
    expect(scopes).toEqual(new Set(['tooth', 'surface', 'pair', 'range', 'arch']))
  })

  it('carries surfaces as an attribute, since no target kind can hold one', () => {
    const surfaceRules = catalog.rules.filter(r => r.scope === 'surface')
    expect(surfaceRules.length).toBeGreaterThan(0)
    const withSurfaces = surfaceRules.filter(r =>
      (r.attributes as Array<{ name: string }>).some(a => a.name === 'surfaces')
    )
    expect(withSurfaces.length).toBeGreaterThan(0)
    for (const rule of withSurfaces) {
      const attr = (rule.attributes as Array<{ name: string, kind: string, values: Array<{ code: string }> }>)
        .find(a => a.name === 'surfaces')!
      expect(attr.kind).toBe('enum_multi')
      expect(attr.values.map(v => v.code)).toEqual(['M', 'D', 'O', 'V', 'L'])
    }
  })

  it('has exactly one unnumbered subject, and it declares anchors', () => {
    const unnumbered = catalog.rules.filter(r => r.target_identity === 'unnumbered')
    expect(unnumbered).toHaveLength(1)
    expect(unnumbered[0]!.anchor).toMatchObject({ cardinality: 2 })
  })

  it('declares arch cardinality on every arch-scoped rule', () => {
    for (const rule of catalog.rules.filter(r => r.scope === 'arch')) {
      expect(['one', 'one_or_both']).toContain(rule.arch_cardinality)
    }
  })
})
