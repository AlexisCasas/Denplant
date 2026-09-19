/**
 * NTS-05D.2 — findings become drawing instructions.
 *
 * The rules here are **synthetic**, with rule ids the norm does not use. That
 * is the whole point: if a test passed because the renderer recognised a real
 * rule id, the renderer would have a special case in it, and the architecture
 * this phase is built on would already be broken. A handful of real rules
 * appear at the end as integration fixtures, asserting the same generic paths.
 *
 * Module-layer files are imported by relative path: `frontend/module_layers`
 * does not resolve on this Windows host.
 */

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import {
  NTS_LAYERS,
  paintFor,
  resolveChart,
  resolveFinding
} from '../../../backend/app/modules/odontogram/frontend/utils/ntsRenderModel'
import type {
  NtsArrowInstruction,
  NtsConnectorInstruction,
  NtsLineInstruction,
  NtsOutlineInstruction,
  NtsShapeFillInstruction,
  NtsSymbolInstruction,
  NtsTextInstruction,
  NtsUnsupportedInstruction
} from '../../../backend/app/modules/odontogram/frontend/utils/ntsRenderModel'
import {
  incisalBand,
  resolveSurfaceComponents
} from '../../../backend/app/modules/odontogram/frontend/utils/ntsSurfaceGeometry'
import {
  NTS_ALL_TEETH,
  centralRegionsOf
} from '../../../backend/app/modules/odontogram/frontend/utils/ntsDentition'
import {
  annotationBox,
  apexBand,
  apexPoint,
  archSpan,
  crownBox,
  numberAnchor,
  occlusalBand,
  rangeSpan,
  rootAxes,
  toothPlacement
} from '../../../backend/app/modules/odontogram/frontend/utils/ntsChartGeometry'
import type {
  NtsFinding,
  NtsFindingTarget,
  NtsRule
} from '../../../backend/app/modules/odontogram/frontend/types/nts'

const LAYER = resolve(process.cwd(), '../backend/app/modules/odontogram/frontend')
const source = (file: string) => readFileSync(resolve(LAYER, file), 'utf8')

const CATALOG = JSON.parse(
  readFileSync(
    resolve(process.cwd(), '../backend/app/modules/odontogram/nts/catalog/pe_nts_188_2022.json'),
    'utf8'
  )
) as { rules: NtsRule[] }

// ---------------------------------------------------------------------------
// builders
// ---------------------------------------------------------------------------

function rule(overrides: Partial<NtsRule> & { rule_id: string }): NtsRule {
  return {
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
    render: { color_semantics: 'good_or_non_pathological', marks: [] },
    geometry_input: { mode: 'standard_geometry', constraints: [] },
    ...overrides
  } as unknown as NtsRule
}

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

let seq = 0
function finding(overrides: Partial<NtsFinding> & { rule_id: string }): NtsFinding {
  seq += 1
  return {
    id: `f${seq}`,
    record_id: 'rec-1',
    norm_version: 'pe_nts_188_2022',
    attributes: {},
    provenance: 'observed',
    source_finding_id: null,
    sequence: seq,
    created_at: '2026-01-02T10:00:00Z',
    created_by: 'u1',
    targets: [target()],
    ...overrides
  }
}

const SIGLA_ATTR = (name: string, codes: string[], kind = 'fixed') => ({
  name,
  kind,
  required: true,
  is_sigla: true,
  values: codes.map(code => ({
    code,
    name: `Label ${code}`,
    status: 'verified',
    notes: null,
    specification_requirement: null
  })),
  status: 'verified',
  notes: null
})

const CONDITION_ATTR = {
  name: 'condition_state',
  kind: 'enum',
  required: true,
  is_sigla: false,
  values: [
    { code: 'good', name: 'Good', status: 'verified', notes: null, specification_requirement: null },
    { code: 'bad', name: 'Bad', status: 'verified', notes: null, specification_requirement: null }
  ],
  status: 'verified',
  notes: null
}

const boxMark = (textFrom: string, suffixFrom?: string) => ({
  kind: 'box_siglas',
  params: { case: 'uppercase' },
  text_from: textFrom,
  suffix_from: suffixFrom ?? null,
  role: null,
  target_selector: null
})

const symbolMark = (shape: string, at?: string, textFrom?: string, selector?: string) => ({
  kind: 'symbol',
  params: at ? { shape, at } : { shape },
  text_from: textFrom ?? null,
  suffix_from: null,
  role: null,
  target_selector: selector ?? null
})

const texts = (r: ReturnType<typeof resolveFinding>) =>
  r.instructions.filter((i): i is NtsTextInstruction => i.kind === 'text')
const symbols = (r: ReturnType<typeof resolveFinding>) =>
  r.instructions.filter((i): i is NtsSymbolInstruction => i.kind === 'symbol')
const unsupported = (r: ReturnType<typeof resolveFinding>) =>
  r.instructions.filter((i): i is NtsUnsupportedInstruction => i.kind === 'unsupported')
const fills = (r: ReturnType<typeof resolveFinding>) =>
  r.instructions.filter((i): i is NtsShapeFillInstruction => i.kind === 'shape_fill')
const outlines = (r: ReturnType<typeof resolveFinding>) =>
  r.instructions.filter((i): i is NtsOutlineInstruction => i.kind === 'outline')

// ---------------------------------------------------------------------------
// text resolution
// ---------------------------------------------------------------------------

describe('a sigla is read through its declared binding, never guessed', () => {
  it('a fixed sigla is written even when the finding does not repeat it', () => {
    const r = rule({
      rule_id: 'X.1',
      attributes: [SIGLA_ATTR('sigla', ['ZZZ'])],
      render: { color_semantics: 'good_or_non_pathological', marks: [boxMark('sigla')] }
    })
    const result = resolveFinding(finding({ rule_id: 'X.1', attributes: {} }), r)

    expect(result.completeness).toBe('complete')
    expect(texts(result)[0]!.text).toBe('ZZZ')
    expect(texts(result)[0]!.variantCode).toBe('ZZZ')
  })

  it('an enum sigla writes the stored code, not the human label', () => {
    const r = rule({
      rule_id: 'X.2',
      attributes: [SIGLA_ATTR('kind_of_thing', ['AAA', 'BBB'], 'enum')],
      render: { color_semantics: 'good_or_non_pathological', marks: [boxMark('kind_of_thing')] }
    })
    const result = resolveFinding(
      finding({ rule_id: 'X.2', attributes: { kind_of_thing: 'BBB' } }),
      r
    )

    expect(texts(result)[0]!.text).toBe('BBB')
    expect(texts(result)[0]!.text).not.toContain('Label')
  })

  it('a code the catalog does not enumerate is refused, not printed', () => {
    const r = rule({
      rule_id: 'X.3',
      attributes: [SIGLA_ATTR('kind_of_thing', ['AAA'], 'enum')],
      render: { color_semantics: 'good_or_non_pathological', marks: [boxMark('kind_of_thing')] }
    })
    const result = resolveFinding(
      finding({ rule_id: 'X.3', attributes: { kind_of_thing: 'WAT' } }),
      r
    )

    expect(texts(result)).toHaveLength(0)
    expect(unsupported(result)[0]!.reason).toBe('unknown_variant_code')
    expect(result.completeness).toBe('unsupported')
  })

  it('a binding pointing at an attribute that is not there is refused', () => {
    const r = rule({
      rule_id: 'X.4',
      attributes: [],
      render: { color_semantics: 'good_or_non_pathological', marks: [boxMark('nope')] }
    })
    const result = resolveFinding(finding({ rule_id: 'X.4' }), r)
    expect(unsupported(result)[0]!.reason).toBe('missing_attribute_value')
  })

  it('an enum sigla the clinician has not chosen yet is refused', () => {
    const r = rule({
      rule_id: 'X.5',
      attributes: [SIGLA_ATTR('kind_of_thing', ['AAA'], 'enum')],
      render: { color_semantics: 'good_or_non_pathological', marks: [boxMark('kind_of_thing')] }
    })
    const result = resolveFinding(finding({ rule_id: 'X.5', attributes: {} }), r)
    expect(unsupported(result)[0]!.reason).toBe('missing_attribute_value')
  })
})

describe('a suffix is a second datum, appended from its own binding', () => {
  it('appends the suffix attribute after the sigla', () => {
    const r = rule({
      rule_id: 'X.6',
      attributes: [
        SIGLA_ATTR('sigla', ['Q']),
        { name: 'degree', kind: 'integer', required: true, is_sigla: false, values: [], status: 'verified', notes: null }
      ],
      render: { color_semantics: 'good_or_non_pathological', marks: [boxMark('sigla', 'degree')] }
    })
    const result = resolveFinding(
      finding({ rule_id: 'X.6', attributes: { degree: 2 } }),
      r
    )

    expect(texts(result)[0]!.text).toBe('Q2')
    // The variant code stays the sigla alone: identity is not the rendered glyph.
    expect(texts(result)[0]!.variantCode).toBe('Q')
  })

  it('writes the sigla alone when the suffix has no value', () => {
    const r = rule({
      rule_id: 'X.7',
      attributes: [
        SIGLA_ATTR('sigla', ['Q']),
        { name: 'degree', kind: 'integer', required: false, is_sigla: false, values: [], status: 'verified', notes: null }
      ],
      render: { color_semantics: 'good_or_non_pathological', marks: [boxMark('sigla', 'degree')] }
    })
    expect(texts(resolveFinding(finding({ rule_id: 'X.7' }), r))[0]!.text).toBe('Q')
  })
})

// ---------------------------------------------------------------------------
// paint
// ---------------------------------------------------------------------------

describe('colour comes from the norm\'s semantics, never from a hex', () => {
  const withSemantics = (semantics: string, id: string) => rule({
    rule_id: id,
    attributes: semantics === 'condition_dependent'
      ? [SIGLA_ATTR('sigla', ['Q']), CONDITION_ATTR]
      : [SIGLA_ATTR('sigla', ['Q'])],
    render: { color_semantics: semantics, marks: [boxMark('sigla')] }
  })

  it('always-blue and always-red rules ignore the finding', () => {
    expect(paintFor(withSemantics('good_or_non_pathological', 'X.8'), finding({ rule_id: 'X.8' })))
      .toBe('good')
    expect(paintFor(withSemantics('bad_temporary_or_pathological', 'X.9'), finding({ rule_id: 'X.9' })))
      .toBe('bad')
  })

  it('a condition-dependent rule reads condition_state', () => {
    const r = withSemantics('condition_dependent', 'X.10')
    expect(paintFor(r, finding({ rule_id: 'X.10', attributes: { condition_state: 'good' } }))).toBe('good')
    expect(paintFor(r, finding({ rule_id: 'X.10', attributes: { condition_state: 'bad' } }))).toBe('bad')
  })

  it('E/F — a fixed-colour rule needs no condition_state at all', () => {
    const good = withSemantics('good_or_non_pathological', 'X.8b')
    const bad = withSemantics('bad_temporary_or_pathological', 'X.9b')

    const a = resolveFinding(finding({ rule_id: 'X.8b', attributes: {} }), good)
    const b = resolveFinding(finding({ rule_id: 'X.9b', attributes: {} }), bad)

    expect(a.completeness).toBe('complete')
    expect(texts(a)[0]!.paint).toBe('good')
    expect(b.completeness).toBe('complete')
    expect(texts(b)[0]!.paint).toBe('bad')
  })

  // -- the semantic gate -----------------------------------------------------
  //
  // "Absent" is not "in good state". Drawing blue would put a clinical claim on
  // the chart that the record does not contain — and drawing red would be the
  // same mistake the other way round.

  it('C — a missing condition_state yields no colour at all', () => {
    const r = withSemantics('condition_dependent', 'X.11')
    expect(paintFor(r, finding({ rule_id: 'X.11', attributes: {} }))).toBeNull()
  })

  it('C — and the finding is reported instead of drawn', () => {
    const r = withSemantics('condition_dependent', 'X.11b')
    const result = resolveFinding(finding({ rule_id: 'X.11b', attributes: {} }), r)

    expect(result.completeness).toBe('unsupported')
    expect(result.paint).toBeNull()
    // Nothing clinical reaches the chart: no text, no symbol, no invented blue.
    expect(texts(result)).toHaveLength(0)
    expect(symbols(result)).toHaveLength(0)
    expect(unsupported(result)[0]!.reason).toBe('missing_condition_state')
    expect(result.instructions.every(i => i.paint === null)).toBe(true)
  })

  it.each([null, '', 'maybe', 'GOOD', 'unknown', 0, true])(
    'D — condition_state of %p is refused, not coerced',
    (value) => {
      const r = withSemantics('condition_dependent', 'X.11c')
      const result = resolveFinding(
        finding({ rule_id: 'X.11c', attributes: { condition_state: value } }), r
      )

      expect(result.paint).toBeNull()
      expect(result.completeness).toBe('unsupported')
      expect(unsupported(result)[0]!.reason).toBe('missing_condition_state')
    }
  )

  it('every mark of the finding is reported, not just the first', () => {
    const r = rule({
      rule_id: 'X.11d',
      attributes: [SIGLA_ATTR('sigla', ['Q']), CONDITION_ATTR],
      render: {
        color_semantics: 'condition_dependent',
        marks: [symbolMark('x_cross'), boxMark('sigla')]
      }
    })
    const result = resolveFinding(finding({ rule_id: 'X.11d', attributes: {} }), r)

    expect(result.instructions).toHaveLength(2)
    expect(unsupported(result).map(i => i.markKind)).toEqual(['symbol', 'box_siglas'])
  })

  it('every instruction of one finding carries the same paint', () => {
    const r = rule({
      rule_id: 'X.12',
      attributes: [SIGLA_ATTR('sigla', ['Q']), CONDITION_ATTR],
      render: {
        color_semantics: 'condition_dependent',
        marks: [symbolMark('x_cross'), boxMark('sigla')]
      }
    })
    const result = resolveFinding(
      finding({ rule_id: 'X.12', attributes: { condition_state: 'bad' } }),
      r
    )
    expect(result.instructions.every(i => i.paint === 'bad')).toBe(true)
  })

  it('the model never emits a colour value', () => {
    const text = source('utils/ntsRenderModel.ts')
    expect(text).not.toMatch(/#[0-9a-f]{3,8}\b/i)
    expect(text).not.toMatch(/\brgb\(|\bhsl\(/)
  })
})

// ---------------------------------------------------------------------------
// identity
// ---------------------------------------------------------------------------

describe('identity is the rule, never the glyph', () => {
  it('two different rules may write the same text and stay distinguishable', () => {
    const a = rule({
      rule_id: 'X.20',
      attributes: [SIGLA_ATTR('sigla', ['M'])],
      render: { color_semantics: 'bad_temporary_or_pathological', marks: [boxMark('sigla')] }
    })
    const b = rule({
      rule_id: 'X.21',
      attributes: [SIGLA_ATTR('position', ['M'], 'enum')],
      render: { color_semantics: 'good_or_non_pathological', marks: [boxMark('position')] }
    })

    const first = texts(resolveFinding(finding({ rule_id: 'X.20', targets: [target()] }), a))[0]!
    const second = texts(resolveFinding(
      finding({ rule_id: 'X.21', attributes: { position: 'M' }, targets: [target()] }), b
    ))[0]!

    expect(first.text).toBe(second.text)
    expect(first.ruleId).not.toBe(second.ruleId)
    expect(first.paint).not.toBe(second.paint)
    expect(first.findingId).not.toBe(second.findingId)
    expect(first.normVersion).toBe('pe_nts_188_2022')
  })
})

// ---------------------------------------------------------------------------
// symbols
// ---------------------------------------------------------------------------

describe('every declared symbol shape resolves to real geometry', () => {
  const PAIR = [target({ id: 'a', position: 0, tooth_number: 11 }),
    target({ id: 'b', position: 1, tooth_number: 21 })]

  const CASES: Array<[string, string | undefined, NtsFindingTarget[], NtsFindingTarget[]]> = [
    ['square_bordering_crown', undefined, [target()], []],
    ['x_cross', undefined, [target()], []],
    ['square', 'crown', [target()], []],
    ['triangle', 'near_roots', [target()], []],
    ['circle', 'tooth_number', [target()], []],
    ['two_intersecting_circles', 'tooth_numbers', PAIR, []],
    ['inverted_parenthesis', 'between_teeth', PAIR, []],
    [
      'circle_enclosing_sigla',
      'between_apices',
      [target({ target_kind: 'unnumbered_tooth', tooth_number: null })],
      [target({ id: 'n1', position: 1, participation: 'anchor', tooth_number: 11 }),
        target({ id: 'n2', position: 2, participation: 'anchor', tooth_number: 21 })]
    ]
  ]

  it.each(CASES)('%s produces finite, on-chart geometry', (shape, at, subs, anch) => {
    const needsText = shape === 'circle_enclosing_sigla'
    const r = rule({
      rule_id: `X.${shape}`,
      attributes: needsText ? [SIGLA_ATTR('sigla', ['S'])] : [],
      render: {
        color_semantics: 'good_or_non_pathological',
        marks: [symbolMark(shape, at, needsText ? 'sigla' : undefined)]
      }
    })
    const result = resolveFinding(
      finding({ rule_id: r.rule_id, targets: [...subs, ...anch] }),
      r
    )

    expect(result.completeness).toBe('complete')
    const symbol = symbols(result)[0]!
    expect(symbol.shape).toBe(shape)
    for (const n of [symbol.at.x, symbol.at.y, symbol.bounds.width, symbol.bounds.height]) {
      expect(Number.isFinite(n)).toBe(true)
      expect(Number.isNaN(n)).toBe(false)
    }
    expect(symbol.bounds.width).toBeGreaterThan(0)
    expect(symbol.bounds.height).toBeGreaterThan(0)
    expect(symbol.at.x).toBeGreaterThan(0)
    expect(symbol.at.y).toBeGreaterThan(0)
    expect(symbol.layer).toBe(NTS_LAYERS.symbol)
  })

  it('the crown shapes land exactly on the crown box', () => {
    const r = rule({
      rule_id: 'X.30',
      render: { color_semantics: 'good_or_non_pathological', marks: [symbolMark('x_cross')] }
    })
    const symbol = symbols(resolveFinding(finding({ rule_id: 'X.30' }), r))[0]!
    expect(symbol.bounds).toEqual(crownBox(16))
  })

  it('a number-anchored shape is centred on the FDI strip', () => {
    const r = rule({
      rule_id: 'X.31',
      render: { color_semantics: 'good_or_non_pathological', marks: [symbolMark('circle', 'tooth_number')] }
    })
    const symbol = symbols(resolveFinding(finding({ rule_id: 'X.31' }), r))[0]!
    expect(symbol.at).toEqual(numberAnchor(16))
  })

  it('an unknown shape is refused rather than drawn as something else', () => {
    const r = rule({
      rule_id: 'X.32',
      render: { color_semantics: 'good_or_non_pathological', marks: [symbolMark('spiral')] }
    })
    expect(unsupported(resolveFinding(finding({ rule_id: 'X.32' }), r))[0]!.reason)
      .toBe('unknown_symbol_shape')
  })

  it('an unknown placement token is refused', () => {
    const r = rule({
      rule_id: 'X.33',
      render: { color_semantics: 'good_or_non_pathological', marks: [symbolMark('circle', 'somewhere')] }
    })
    expect(unsupported(resolveFinding(finding({ rule_id: 'X.33' }), r))[0]!.reason)
      .toBe('unknown_placement')
  })

  it('teeth that are not neighbours get no between-teeth symbol', () => {
    const r = rule({
      rule_id: 'X.34',
      render: { color_semantics: 'good_or_non_pathological', marks: [symbolMark('inverted_parenthesis', 'between_teeth')] }
    })
    const result = resolveFinding(finding({
      rule_id: 'X.34',
      targets: [target({ id: 'a', position: 0, tooth_number: 11 }),
        target({ id: 'b', position: 1, tooth_number: 22 })]
    }), r)

    expect(unsupported(result)[0]!.reason).toBe('targets_not_adjacent')
  })

  it('a selector without a band is still refused', () => {
    // The two questions are separate: naming which targets does not say where.
    const r = rule({
      rule_id: 'X.35',
      scope: 'range',
      render: {
        color_semantics: 'good_or_non_pathological',
        marks: [symbolMark('square_with_cross', undefined, undefined, 'range_endpoints')]
      }
    })
    expect(unsupported(resolveFinding(finding({ rule_id: 'X.35' }), r))[0]!.reason)
      .toBe('unknown_placement')
  })

  it('a band placement with no selector is still an unknown placement for a symbol', () => {
    // `apex_level` positions a span, not a lone symbol: without a selector the
    // renderer has nothing to anchor the shape to, and says so.
    const r = rule({
      rule_id: 'X.36',
      render: {
        color_semantics: 'good_or_non_pathological',
        marks: [symbolMark('square_with_cross', 'apex_level')]
      }
    })
    expect(unsupported(resolveFinding(finding({ rule_id: 'X.36' }), r))[0]!.reason)
      .toBe('unknown_placement')
  })
})

// ---------------------------------------------------------------------------
// the supernumerary path, without a rule branch
// ---------------------------------------------------------------------------

describe('a sigla can ride inside a symbol instead of in the box', () => {
  const r = rule({
    rule_id: 'X.40',
    target_identity: 'unnumbered',
    attributes: [SIGLA_ATTR('sigla', ['S'])],
    render: {
      color_semantics: 'good_or_non_pathological',
      marks: [symbolMark('circle_enclosing_sigla', 'between_apices', 'sigla')]
    }
  })

  const between = (a: number, b: number) => finding({
    rule_id: 'X.40',
    targets: [
      target({ target_kind: 'unnumbered_tooth', tooth_number: null }),
      target({ id: 'n1', position: 1, participation: 'anchor', tooth_number: a }),
      target({ id: 'n2', position: 2, participation: 'anchor', tooth_number: b })
    ]
  })

  it('the text goes in the circle and no box instruction is produced', () => {
    const result = resolveFinding(between(11, 21), r)

    expect(symbols(result)[0]!.enclosedText).toBe('S')
    expect(texts(result)).toHaveLength(0)
    expect(result.completeness).toBe('complete')
  })

  it('it is located by its anchors, and no FDI is invented for it', () => {
    const result = resolveFinding(between(11, 21), r)
    const symbol = symbols(result)[0]!
    const eleven = crownBox(11)!
    const twentyOne = crownBox(21)!

    expect(symbol.at.x).toBeGreaterThan(eleven.x)
    expect(symbol.at.x).toBeLessThan(twentyOne.x + twentyOne.width)
    // Apex level: above the crowns of the upper arch.
    expect(symbol.at.y).toBeLessThan(eleven.y)
  })

  it('anchors that are not neighbours yield no position at all', () => {
    expect(unsupported(resolveFinding(between(11, 22), r))[0]!.reason).toBe('targets_not_adjacent')
  })

  it('the wrong number of anchors is refused', () => {
    const result = resolveFinding(finding({
      rule_id: 'X.40',
      targets: [target({ target_kind: 'unnumbered_tooth', tooth_number: null })]
    }), r)
    expect(unsupported(result)[0]!.reason).toBe('wrong_target_count')
  })
})

// ---------------------------------------------------------------------------
// partial rendering
// ---------------------------------------------------------------------------

describe('a finding that is only partly drawable says so', () => {
  it('two drawable marks are complete', () => {
    const r = rule({
      rule_id: 'X.50',
      attributes: [SIGLA_ATTR('sigla', ['Q'])],
      render: {
        color_semantics: 'good_or_non_pathological',
        marks: [symbolMark('x_cross'), boxMark('sigla')]
      }
    })
    expect(resolveFinding(finding({ rule_id: 'X.50' }), r).completeness).toBe('complete')
  })

  it('a drawable mark beside an unresolvable one is partial, and the other is reported', () => {
    // Every mark kind draws as of 05D.4, so the way a finding becomes partial
    // is no longer a deferred *kind* but a mark whose geometry cannot be
    // resolved — here an area that says neither which attribute supplies its
    // regions nor which landmark it sits on.
    const r = rule({
      rule_id: 'X.51',
      render: {
        color_semantics: 'good_or_non_pathological',
        marks: [{ kind: 'shape_fill', params: { fill: 'solid' }, text_from: null, suffix_from: null, role: null, target_selector: null, regions_from: null },
          symbolMark('square', 'crown')]
      }
    })
    const result = resolveFinding(finding({ rule_id: 'X.51' }), r)

    expect(result.completeness).toBe('partial')
    expect(symbols(result)).toHaveLength(1)
    expect(unsupported(result)[0]).toMatchObject({
      reason: 'unknown_placement',
      markKind: 'shape_fill'
    })
  })

  it('an unknown mark kind is still reported rather than dropped', () => {
    const r = rule({
      rule_id: 'X.52',
      render: {
        color_semantics: 'good_or_non_pathological',
        marks: [{ kind: 'shading', params: {}, text_from: null, suffix_from: null, role: null, target_selector: null, regions_from: null },
          symbolMark('square', 'crown')]
      }
    })
    const result = resolveFinding(finding({ rule_id: 'X.52' }), r)

    expect(result.completeness).toBe('partial')
    expect(unsupported(result)[0]).toMatchObject({
      reason: 'mark_kind_not_in_slice',
      markKind: 'shading'
    })
  })

  it.each(['shape_fill', 'outline'])(
    'a %s-only rule with no geometry source is unsupported, never silently empty',
    (kind) => {
      const r = rule({
        rule_id: `X.${kind}`,
        render: {
          color_semantics: 'good_or_non_pathological',
          marks: [{ kind, params: {}, text_from: null, suffix_from: null, role: null, target_selector: null, regions_from: null }]
        }
      })
      const result = resolveFinding(finding({ rule_id: r.rule_id }), r)

      expect(result.completeness).toBe('unsupported')
      expect(result.instructions).toHaveLength(1)
      expect(unsupported(result)[0]!.markKind).toBe(kind)
    }
  )
})

// ---------------------------------------------------------------------------
// provenance and lifecycle
// ---------------------------------------------------------------------------

describe('what must not change the drawing', () => {
  const r = rule({
    rule_id: 'X.60',
    attributes: [SIGLA_ATTR('sigla', ['Q'])],
    render: { color_semantics: 'good_or_non_pathological', marks: [boxMark('sigla')] }
  })
  const strip = (f: NtsFinding) => {
    const { instructions } = resolveFinding(f, r)
    return instructions.map(i => ({ ...i, findingId: 'x' }))
  }

  it('a carried-forward finding draws exactly like an observed one', () => {
    const observed = finding({ rule_id: 'X.60', provenance: 'observed' })
    const carried = finding({
      rule_id: 'X.60',
      provenance: 'carried_forward',
      source_finding_id: observed.id
    })

    expect(strip(carried)).toEqual(strip(observed))
  })

  it('nothing in the model can see a record status', () => {
    // The resolver takes a finding and a rule. Draft or finalized is a property
    // of the *record*, which never reaches here — so the two cannot diverge.
    // `readonly` as a TypeScript modifier is not a record status, so this looks
    // for the status vocabulary rather than the keyword.
    const code = source('utils/ntsRenderModel.ts')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '')

    for (const forbidden of ['draft', 'finalized', 'discarded', 'NtsRecord', '.status']) {
      expect(code).not.toContain(forbidden)
    }
  })
})

// ---------------------------------------------------------------------------
// the annotation box
// ---------------------------------------------------------------------------

describe('several findings on one tooth share its box', () => {
  const r = rule({
    rule_id: 'X.70',
    attributes: [SIGLA_ATTR('sigla', ['Q'])],
    render: { color_semantics: 'good_or_non_pathological', marks: [boxMark('sigla')] }
  })
  const many = (count: number, fdi = 16) =>
    Array.from({ length: count }, () => finding({
      rule_id: 'X.70',
      targets: [target({ tooth_number: fdi })]
    }))

  it('one sigla takes the first line', () => {
    const chart = resolveChart(many(1), [r])
    const laid = chart.instructions.filter((i): i is NtsTextInstruction => i.kind === 'text')

    expect(laid).toHaveLength(1)
    expect(laid[0]!.line).toBe(0)
    expect(laid[0]!.box).toEqual(annotationBox(16))
    expect(chart.overflows).toHaveLength(0)
  })

  it('two siglas stack, one per line, as the annex draws them', () => {
    const chart = resolveChart(many(2), [r])
    const laid = chart.instructions.filter((i): i is NtsTextInstruction => i.kind === 'text')

    expect(laid.map(i => i.line)).toEqual([0, 1])
    expect(chart.overflows).toHaveLength(0)
  })

  it('six siglas keep six instructions, show one, and count the rest', () => {
    const chart = resolveChart(many(6), [r])
    const laid = chart.instructions.filter((i): i is NtsTextInstruction => i.kind === 'text')

    // Nothing is dropped from the model.
    expect(laid).toHaveLength(6)
    expect(laid.filter(i => i.line !== null)).toHaveLength(1)
    expect(chart.overflows).toEqual([
      { fdi: 16, box: annotationBox(16), hidden: 5, line: 1 }
    ])
  })

  it('the overflow count always equals what is not shown', () => {
    for (const n of [3, 4, 5, 9]) {
      const chart = resolveChart(many(n), [r])
      const laid = chart.instructions.filter((i): i is NtsTextInstruction => i.kind === 'text')
      const shown = laid.filter(i => i.line !== null).length
      expect(chart.overflows[0]!.hidden).toBe(n - shown)
      expect(shown + chart.overflows[0]!.hidden).toBe(n)
    }
  })

  it('different teeth do not share a box', () => {
    const chart = resolveChart([...many(1, 16), ...many(1, 26)], [r])
    const laid = chart.instructions.filter((i): i is NtsTextInstruction => i.kind === 'text')

    expect(laid.map(i => i.line)).toEqual([0, 0])
    expect(laid[0]!.box).not.toEqual(laid[1]!.box)
    expect(chart.overflows).toHaveLength(0)
  })

  it('layout is deterministic: the same record lays out the same way twice', () => {
    const findings = many(5)
    const first = resolveChart(findings, [r])
    const second = resolveChart(findings, [r])
    expect(JSON.stringify(first.overflows)).toBe(JSON.stringify(second.overflows))
  })
})

describe('the chart-level result', () => {
  it('sorts instructions so text is painted over symbols', () => {
    const r = rule({
      rule_id: 'X.80',
      attributes: [SIGLA_ATTR('sigla', ['Q'])],
      render: {
        color_semantics: 'good_or_non_pathological',
        marks: [boxMark('sigla'), symbolMark('x_cross')]
      }
    })
    const chart = resolveChart([finding({ rule_id: 'X.80' })], [r])
    const kinds = chart.instructions.map(i => i.kind)
    expect(kinds.indexOf('symbol')).toBeLessThan(kinds.indexOf('text'))
  })

  it('a finding citing a rule this build cannot interpret is still counted', () => {
    const chart = resolveChart([finding({ rule_id: 'X.NOPE' })], [])
    expect(chart.unsupported).toHaveLength(1)
    expect(chart.findings[0]!.completeness).toBe('unsupported')
  })

  it('partial and unsupported findings are listed by id', () => {
    const partial = rule({
      rule_id: 'X.81',
      render: {
        color_semantics: 'good_or_non_pathological',
        marks: [symbolMark('x_cross'), { kind: 'arrow', params: {}, text_from: null, suffix_from: null, role: null }]
      }
    })
    const none = rule({
      rule_id: 'X.82',
      render: {
        color_semantics: 'good_or_non_pathological',
        marks: [{ kind: 'outline', params: {}, text_from: null, suffix_from: null, role: null }]
      }
    })
    const a = finding({ rule_id: 'X.81' })
    const b = finding({ rule_id: 'X.82' })
    const chart = resolveChart([a, b], [partial, none])

    expect(chart.partial).toEqual([a.id])
    expect(chart.unsupported).toEqual([b.id])
  })
})

// ---------------------------------------------------------------------------
// real rules, as integration fixtures
// ---------------------------------------------------------------------------

describe('the real catalog drives the same generic paths', () => {
  const real = (id: string) => CATALOG.rules.find(r => r.rule_id === id)!

  it('a box-only rule writes its fixed sigla', () => {
    const r = real('6.1.9')
    const result = resolveFinding(finding({ rule_id: '6.1.9' }), r)
    expect(result.completeness).toBe('complete')
    expect(texts(result)[0]!.text).toBe('FFP')
  })

  it('an absent tooth draws a cross over the crown and its code in the box', () => {
    const r = real('6.1.20')
    const result = resolveFinding(
      finding({ rule_id: '6.1.20', attributes: { absence_type: 'DEX' } }), r
    )

    expect(result.completeness).toBe('complete')
    expect(symbols(result)[0]!.shape).toBe('x_cross')
    expect(symbols(result)[0]!.bounds).toEqual(crownBox(16))
    expect(texts(result)[0]!.text).toBe('DEX')
  })

  it('a supernumerary tooth writes its sigla inside a circumference, not in a box', () => {
    const r = real('6.1.26')
    const result = resolveFinding(finding({
      rule_id: '6.1.26',
      targets: [
        target({ target_kind: 'unnumbered_tooth', tooth_number: null }),
        target({ id: 'n1', position: 1, participation: 'anchor', tooth_number: 11 }),
        target({ id: 'n2', position: 2, participation: 'anchor', tooth_number: 21 })
      ]
    }), r)

    expect(result.completeness).toBe('complete')
    expect(symbols(result)[0]!.shape).toBe('circle_enclosing_sigla')
    expect(symbols(result)[0]!.enclosedText).toBe('S')
    expect(texts(result)).toHaveLength(0)
  })

  it('mobility writes its sigla with the degree appended, in red', () => {
    const r = real('6.1.19')
    const result = resolveFinding(
      finding({ rule_id: '6.1.19', attributes: { mobility_degree: 3 } }), r
    )

    expect(texts(result)[0]!.text).toBe('M3')
    expect(texts(result)[0]!.paint).toBe('bad')
  })

  it('two abnormal positions on one tooth both survive into the model', () => {
    const r = real('6.1.28')
    const chart = resolveChart([
      finding({ rule_id: '6.1.28', attributes: { abnormal_position: 'D' } }),
      finding({ rule_id: '6.1.28', attributes: { abnormal_position: 'L' } })
    ], [r])
    const laid = chart.instructions.filter((i): i is NtsTextInstruction => i.kind === 'text')

    // The annex stacks D over L in a single box (p.15).
    expect(laid.map(i => i.text)).toEqual(['D', 'L'])
    expect(laid.map(i => i.line)).toEqual([0, 1])
  })

  it('a bridge draws its span, and its verticals only where the role is', () => {
    const r = real('6.1.29')
    const result = resolveFinding(finding({
      rule_id: '6.1.29',
      attributes: { condition_state: 'good' },
      targets: [13, 12, 11, 21, 22, 23].map((tooth, index) => target({
        id: `t${index}`, position: index, tooth_number: tooth,
        role: tooth === 21 ? 'pilar' : null
      }))
    }), r)

    expect(result.completeness).toBe('complete')
    const horizontal = result.instructions.find(i => i.kind === 'line') as NtsLineInstruction
    const ticks = result.instructions.find(i => i.kind === 'connector') as NtsConnectorInstruction

    expect(horizontal.strokes[0]![0]!.x).toBeCloseTo(rangeSpan([13, 23], 'apex')!.x1, 6)
    expect(horizontal.strokes[0]![1]!.x).toBeCloseTo(rangeSpan([13, 23], 'apex')!.x2, 6)
    // The role decides, not the ends of the span.
    expect(ticks.strokes).toHaveLength(1)
    expect(ticks.strokes[0]![0]!.x).toBeCloseTo(toothPlacement(21)!.center.x, 6)
  })

  it('the whole catalog classifies exactly as the slice promises', () => {
    const counts = { complete: 0, partial: 0, unsupported: 0 }
    for (const r of CATALOG.rules) {
      const attributes: Record<string, unknown> = {}
      for (const attribute of r.attributes ?? []) {
        const values = attribute.values ?? []
        if (values.length === 0) continue
        // A multi-valued attribute is a *list* of codes, and the record model
        // rejects a bare string for one. Synthesising it as a string produced
        // data no stored finding could have, which is worse than useless in a
        // census meant to say what the renderer does with real records.
        attributes[attribute.name] = attribute.kind === 'enum_multi'
          ? [values[0]!.code]
          : values[0]!.code
      }
      const targets = r.target_identity === 'unnumbered'
        ? [target({ target_kind: 'unnumbered_tooth', tooth_number: null }),
            target({ id: 'n1', position: 1, participation: 'anchor', tooth_number: 11 }),
            target({ id: 'n2', position: 2, participation: 'anchor', tooth_number: 21 })]
        : r.scope === 'pair'
          ? [target({ id: 'a', position: 0, tooth_number: 11 }),
              target({ id: 'b', position: 1, tooth_number: 21 })]
          : [target()]
      const result = resolveFinding(
        finding({ rule_id: r.rule_id, attributes, targets }), r
      )
      counts[result.completeness] += 1
    }

    // Every mark kind the catalog declares now draws.
    //
    // 35 complete.
    //  1 partial: a sigla beside a mark anchored to fissure anatomy the chart
    //    does not model, which is a geometry gap and not a renderer one.
    //  2 unsupported: a freehand shape the clinician has no channel to supply,
    //    and a direction the norm leaves unenumerated. Both are open questions
    //    about the data, not about drawing.
    expect(counts).toEqual({ complete: 35, partial: 1, unsupported: 2 })
    expect(counts.complete + counts.partial + counts.unsupported).toBe(38)
  })
})

// ---------------------------------------------------------------------------
// anti-branching
// ---------------------------------------------------------------------------

describe('the renderer knows no rule and no clinical word', () => {
  const FILES = ['utils/ntsRenderModel.ts', 'components/odontogram/NtsFindingLayer.vue']

  it.each(FILES)('%s carries no rule id', (file) => {
    expect(source(file)).not.toMatch(/6\.1\.\d/)
  })

  it.each(FILES)('%s names no finding, sigla or colour word', (file) => {
    const text = source(file)
    expect(text).not.toMatch(/\b(caries|corona|obturaci|endodon|implante|pr[oó]tesis|sellante|fractura|pilar|diastema)\b/i)
    expect(text).not.toMatch(/\b(rojo|azul)\b/i)
    // The sigla vocabulary itself must never appear as a literal.
    for (const sigla of ['FFP', 'IMP', 'MAC', 'MIC', 'DNE', 'DEX', 'DAO', 'CMC', 'CDP', 'PP']) {
      expect(text).not.toContain(`'${sigla}'`)
      expect(text).not.toContain(`"${sigla}"`)
    }
  })

  it.each(FILES)('%s owns no surface vocabulary and no attribute name', (file) => {
    // NTS-05D.4. What a surface code means geometrically belongs to the
    // surface policy module, and which attribute carries the codes is the
    // mark's own declaration. Either one appearing here would be the renderer
    // deciding something it has no business deciding — and would be right by
    // accident on this norm, until a norm named the attribute differently.
    const code = source(file)
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/<!--[\s\S]*?-->/g, '')
      .replace(/\/\/.*$/gm, '')

    expect(code).not.toContain('surfaces')
    expect(code).not.toMatch(/['"][MDOVL]['"]/)
  })

  it.each(FILES)('%s switches only on mark kind, shape, placement or paint', (file) => {
    const code = source(file)
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/<!--[\s\S]*?-->/g, '')
      .replace(/\/\/.*$/gm, '')
    expect(code).not.toMatch(/rule_id\s*===/)
    expect(code).not.toMatch(/switch\s*\(\s*\w*rule\w*\.?rule_id/i)
  })
})

// ---------------------------------------------------------------------------
// NTS-05D.3 — lines, connectors and arrows
// ---------------------------------------------------------------------------

const lineMark = (style: string, at?: string) => ({
  kind: 'line',
  params: at ? { style, at } : { style },
  text_from: null,
  suffix_from: null,
  role: null,
  target_selector: null
})

const connectorMark = (style: string, at?: string, role?: string) => ({
  kind: 'connector',
  params: at ? { style, at } : { style },
  text_from: null,
  suffix_from: null,
  role: role ?? null,
  target_selector: null
})

const arrowMark = (style: string, at?: string, toward?: string) => ({
  kind: 'arrow',
  params: { style, ...(at ? { at } : {}), ...(toward ? { toward } : {}) },
  text_from: null,
  suffix_from: null,
  role: null,
  target_selector: null
})

const lines = (r: ReturnType<typeof resolveFinding>) =>
  r.instructions.filter((i): i is NtsLineInstruction => i.kind === 'line')
const connectors = (r: ReturnType<typeof resolveFinding>) =>
  r.instructions.filter((i): i is NtsConnectorInstruction => i.kind === 'connector')
const arrowsOf = (r: ReturnType<typeof resolveFinding>) =>
  r.instructions.filter((i): i is NtsArrowInstruction => i.kind === 'arrow')

/** Subjects spanning teeth, in the order given. */
const span = (teeth: number[], group = 0) =>
  teeth.map((tooth, index) => target({
    id: `t${group}-${index}`, position: index, tooth_number: tooth, group_index: group
  }))

const archTarget = (arch: string) =>
  target({ target_kind: 'arch', tooth_number: null, arch })

const finite = (points: { x: number, y: number }[][]) =>
  points.every(stroke => stroke.every(p => Number.isFinite(p.x) && Number.isFinite(p.y)))

describe('lines are drawn across the extent their scope defines', () => {
  it('an arch line spans the permanent row and nothing else', () => {
    const r = rule({
      rule_id: 'X.100',
      scope: 'arch',
      render: {
        color_semantics: 'good_or_non_pathological',
        marks: [lineMark('straight_horizontal', 'over_crowns')]
      }
    })
    const result = resolveFinding(
      finding({ rule_id: 'X.100', targets: [archTarget('upper')] }), r
    )
    const stroke = lines(result)[0]!.strokes[0]!

    expect(result.completeness).toBe('complete')
    expect(lines(result)[0]!.strokes).toHaveLength(1)
    // The whole upper permanent row, at the crown band.
    expect(stroke[0]!.x).toBeCloseTo(archSpan('upper', 'crown')!.x1, 6)
    expect(stroke[1]!.x).toBeCloseTo(archSpan('upper', 'crown')!.x2, 6)
    expect(stroke[0]!.y).toBeCloseTo(archSpan('upper', 'crown')!.y, 6)
    // ...which is wider than the deciduous row nested inside it.
    expect(stroke[1]!.x - stroke[0]!.x).toBeGreaterThan(
      rangeSpan([55, 65], 'crown')!.x2 - rangeSpan([55, 65], 'crown')!.x1
    )
  })

  it('a range line spans the teeth in row order, crossing the midline', () => {
    const r = rule({
      rule_id: 'X.101',
      scope: 'range',
      render: {
        color_semantics: 'good_or_non_pathological',
        marks: [lineMark('straight_horizontal', 'apex_level')]
      }
    })
    const result = resolveFinding(
      finding({ rule_id: 'X.101', targets: span([13, 12, 11, 21, 22, 23]) }), r
    )
    const stroke = lines(result)[0]!.strokes[0]!
    const expected = rangeSpan([13, 23], 'apex')!

    expect(stroke[0]!.x).toBeCloseTo(expected.x1, 6)
    expect(stroke[1]!.x).toBeCloseTo(expected.x2, 6)
    expect(stroke[0]!.y).toBeCloseTo(apexBand('permanentUpper')!, 6)
  })

  it('two parallel horizontals are two strokes at a fixed separation', () => {
    const r = rule({
      rule_id: 'X.102',
      scope: 'arch',
      render: {
        color_semantics: 'good_or_non_pathological',
        marks: [lineMark('two_parallel_horizontal', 'apex_level')]
      }
    })
    const instruction = lines(resolveFinding(
      finding({ rule_id: 'X.102', targets: [archTarget('lower')] }), r
    ))[0]!

    expect(instruction.strokes).toHaveLength(2)
    const [first, second] = instruction.strokes as [{ y: number }[], { y: number }[]]
    expect(first[0]!.y).not.toBe(second[0]!.y)
    expect(Math.abs(first[0]!.y - second[0]!.y)).toBeCloseTo(3, 6)
    // Both run the same extent.
    expect(instruction.strokes[0]![0]!.x).toBeCloseTo(instruction.strokes[1]![0]!.x, 6)
  })

  it('a zigzag is deterministic and stays within its band', () => {
    const r = rule({
      rule_id: 'X.103',
      scope: 'arch',
      render: {
        color_semantics: 'good_or_non_pathological',
        marks: [lineMark('zigzag', 'apex_level')]
      }
    })
    const build = () => lines(resolveFinding(
      finding({ rule_id: 'X.103', targets: [archTarget('upper')] }), r
    ))[0]!

    const first = build()
    const second = build()
    expect(JSON.stringify(first.strokes)).toBe(JSON.stringify(second.strokes))

    const points = first.strokes[0]!
    expect(points.length).toBeGreaterThan(4)
    expect(finite(first.strokes)).toBe(true)
    // x strictly increases; y alternates either side of the band.
    for (let i = 1; i < points.length; i++) {
      expect(points[i]!.x).toBeGreaterThan(points[i - 1]!.x)
    }
    const band = apexBand('permanentUpper')!
    expect(new Set(points.map(p => Math.sign(p.y - band))).size).toBe(2)
  })

  it('a vertical line is one central stroke per tooth, never one per root', () => {
    const r = rule({
      rule_id: 'X.104',
      render: {
        color_semantics: 'good_or_non_pathological',
        marks: [lineMark('straight_vertical', 'root')]
      }
    })
    // 16 is an upper molar: three roots, and still one line.
    const instruction = lines(resolveFinding(
      finding({ rule_id: 'X.104', targets: [target({ tooth_number: 16 })] }), r
    ))[0]!

    expect(rootAxes(16)).toHaveLength(3)
    expect(instruction.strokes).toHaveLength(1)

    const [from, to] = instruction.strokes[0]! as [{ x: number, y: number }, { x: number, y: number }]
    expect(from.x).toBeCloseTo(toothPlacement(16)!.center.x, 6)
    expect(to.x).toBeCloseTo(from.x, 6)
    // Runs from inside the crown out to the apex.
    expect(to.y).toBeCloseTo(apexPoint(16)!.y, 6)
    expect(from.y).toBeGreaterThan(to.y)
  })

  it.each([
    ['fracture_trace', 'needs_clinician_shape'],
    ['sealant_path', 'needs_fissure_anatomy']
  ])('a %s line is deferred with its real reason', (style, reason) => {
    const r = rule({
      rule_id: `X.${style}`,
      render: {
        color_semantics: 'good_or_non_pathological',
        marks: [lineMark(style)]
      },
      geometry_input: { mode: 'clinician_defined_shape', constraints: [] }
    })
    const result = resolveFinding(finding({ rule_id: r.rule_id }), r)

    expect(lines(result)).toHaveLength(0)
    expect(unsupported(result)[0]!.reason).toBe(reason)
    expect(result.completeness).toBe('unsupported')
  })

  it('an unknown line style is refused', () => {
    const r = rule({
      rule_id: 'X.105',
      render: { color_semantics: 'good_or_non_pathological', marks: [lineMark('squiggle', 'apex_level')] }
    })
    expect(unsupported(resolveFinding(finding({ rule_id: 'X.105' }), r))[0]!.reason)
      .toBe('unknown_line_style')
  })
})

describe('multi-segment spans', () => {
  const r = rule({
    rule_id: 'X.110',
    scope: 'range',
    render: {
      color_semantics: 'good_or_non_pathological',
      marks: [lineMark('two_parallel_horizontal', 'apex_level')]
    }
  })

  it('one group is one span', () => {
    const result = resolveFinding(
      finding({ rule_id: 'X.110', targets: span([46, 45, 44]) }), r
    )
    // Two strokes because the style is a pair, one segment.
    expect(lines(result)[0]!.strokes).toHaveLength(2)
  })

  it('two groups are two spans, and neither is invented', () => {
    const result = resolveFinding(finding({
      rule_id: 'X.110',
      targets: [...span([46, 45, 44], 0), ...span([34, 35, 36], 1)]
    }), r)
    const instruction = lines(result)[0]!

    // Two segments × two parallel strokes each.
    expect(instruction.strokes).toHaveLength(4)
    const first = rangeSpan([46, 44], 'apex')!
    const second = rangeSpan([34, 36], 'apex')!
    const xs = instruction.strokes.map(s => s[0]!.x)
    expect(xs.filter(x => Math.abs(x - first.x1) < 0.001)).toHaveLength(2)
    expect(xs.filter(x => Math.abs(x - second.x1) < 0.001)).toHaveLength(2)
  })
})

describe('connectors', () => {
  it('a straight_line connector runs the whole span', () => {
    const r = rule({
      rule_id: 'X.120',
      scope: 'range',
      render: {
        color_semantics: 'good_or_non_pathological',
        marks: [connectorMark('straight_line', 'apex_level')]
      }
    })
    const result = resolveFinding(
      finding({ rule_id: 'X.120', targets: span([16, 15, 14, 13]) }), r
    )
    const stroke = connectors(result)[0]!.strokes[0]!
    const expected = rangeSpan([16, 13], 'apex')!

    expect(connectors(result)[0]!.style).toBe('straight_line')
    expect(stroke[0]!.x).toBeCloseTo(expected.x1, 6)
    expect(stroke[1]!.x).toBeCloseTo(expected.x2, 6)
  })

  // -- the one that matters: endpoints are not the role ----------------------

  const roleRule = rule({
    rule_id: 'X.121',
    scope: 'range',
    target_roles: [{
      code: 'anchor_tooth', name: 'Anchor', applies_to: 'subject',
      min_count: null, max_count: null, status: 'verified', notes: null
    }],
    render: {
      color_semantics: 'good_or_non_pathological',
      marks: [
        lineMark('straight_horizontal', 'apex_level'),
        connectorMark('vertical_marks', 'apex_level', 'anchor_tooth')
      ]
    }
  })

  const withRoles = (teeth: number[], roles: Record<number, string>) =>
    finding({
      rule_id: 'X.121',
      targets: teeth.map((tooth, index) => target({
        id: `t${index}`, position: index, tooth_number: tooth,
        role: roles[tooth] ?? null
      }))
    })

  it('a role marked only in the middle gets its tick there, not at the ends', () => {
    const result = resolveFinding(
      withRoles([13, 12, 11, 21, 22, 23], { 21: 'anchor_tooth' }), roleRule
    )
    const ticks = connectors(result)[0]!.strokes

    // The horizontal still covers the whole span...
    const horizontal = lines(result)[0]!.strokes[0]!
    expect(horizontal[0]!.x).toBeCloseTo(rangeSpan([13, 23], 'apex')!.x1, 6)
    expect(horizontal[1]!.x).toBeCloseTo(rangeSpan([13, 23], 'apex')!.x2, 6)

    // ...and exactly one tick, on the marked tooth alone.
    expect(ticks).toHaveLength(1)
    expect(ticks[0]![0]!.x).toBeCloseTo(toothPlacement(21)!.center.x, 6)
    expect(ticks[0]![0]!.x).not.toBeCloseTo(toothPlacement(13)!.center.x, 3)
    expect(ticks[0]![0]!.x).not.toBeCloseTo(toothPlacement(23)!.center.x, 3)

    // It is a visible stroke dropped from the band onto the tooth, not a
    // vanishing stub: the band is the row's extreme apex, so measuring to the
    // tooth's own apex would collapse to nothing for whichever tooth defines
    // it. Upper arch, so the tick runs down toward the crowns.
    const [from, to] = ticks[0]! as [{ y: number }, { y: number }]
    expect(from.y).toBeCloseTo(apexBand('permanentUpper')!, 6)
    expect(to.y - from.y).toBeCloseTo(7, 6)
  })

  it('several marked targets each get a tick', () => {
    const result = resolveFinding(
      withRoles([13, 12, 11, 21, 22, 23], { 13: 'anchor_tooth', 23: 'anchor_tooth' }), roleRule
    )
    expect(connectors(result)[0]!.strokes).toHaveLength(2)
  })

  it('the tick is mirrored between the arches, and neither is named', () => {
    const upper = resolveFinding(withRoles([13, 12, 11], { 12: 'anchor_tooth' }), roleRule)
    const lower = resolveFinding(withRoles([43, 42, 41], { 42: 'anchor_tooth' }), roleRule)
    const travel = (r: ReturnType<typeof resolveFinding>) => {
      const [from, to] = connectors(r)[0]!.strokes[0]! as [{ y: number }, { y: number }]
      return Math.sign(to.y - from.y)
    }

    expect(travel(upper)).toBe(1)
    expect(travel(lower)).toBe(-1)
  })

  it('no marked target means no ticks, and the horizontal stays', () => {
    const result = resolveFinding(withRoles([13, 12, 11, 21, 22, 23], {}), roleRule)

    expect(connectors(result)[0]!.strokes).toHaveLength(0)
    expect(lines(result)[0]!.strokes).toHaveLength(1)
    // The span is still drawn, so nothing is lost by the absence of a role.
    expect(result.completeness).toBe('complete')
  })

  it('a connector without a placement is refused rather than guessed', () => {
    const r = rule({
      rule_id: 'X.122',
      scope: 'range',
      render: {
        color_semantics: 'good_or_non_pathological',
        marks: [connectorMark('straight_line')]
      }
    })
    expect(unsupported(resolveFinding(
      finding({ rule_id: 'X.122', targets: span([16, 15]) }), r
    ))[0]!.reason).toBe('unknown_placement')
  })

  it('an unknown connector style is refused', () => {
    const r = rule({
      rule_id: 'X.123',
      scope: 'range',
      render: {
        color_semantics: 'good_or_non_pathological',
        marks: [connectorMark('dotted', 'apex_level')]
      }
    })
    expect(unsupported(resolveFinding(
      finding({ rule_id: 'X.123', targets: span([16, 15]) }), r
    ))[0]!.reason).toBe('unknown_connector_style')
  })
})

describe('symbols on the endpoints of a span', () => {
  const r = rule({
    rule_id: 'X.130',
    scope: 'range',
    render: {
      color_semantics: 'good_or_non_pathological',
      marks: [symbolMark('square_with_cross', 'apex_level', undefined, 'range_endpoints')]
    }
  })

  it('one symbol at each extreme, and none in between', () => {
    const result = resolveFinding(
      finding({ rule_id: 'X.130', targets: span([16, 15, 14, 13]) }), r
    )
    const placed = symbols(result)

    expect(result.completeness).toBe('complete')
    expect(placed).toHaveLength(2)
    const xs = placed.map(s => s.at.x).sort((a, b) => a - b)
    expect(xs[0]).toBeCloseTo(toothPlacement(16)!.center.x, 6)
    expect(xs[1]).toBeCloseTo(toothPlacement(13)!.center.x, 6)
    // Both sit on the declared band.
    for (const symbol of placed) expect(symbol.at.y).toBeCloseTo(apexBand('permanentUpper')!, 6)
  })

  it('11 → 21 is contiguous: the extremes are the neighbours, not the numbers', () => {
    const result = resolveFinding(
      finding({ rule_id: 'X.130', targets: span([11, 21]) }), r
    )
    const xs = symbols(result).map(s => s.at.x).sort((a, b) => a - b)

    expect(symbols(result)).toHaveLength(2)
    expect(xs[0]).toBeCloseTo(toothPlacement(11)!.center.x, 6)
    expect(xs[1]).toBeCloseTo(toothPlacement(21)!.center.x, 6)
    // Adjacent columns: the span is two teeth wide, not ten.
    expect(toothPlacement(21)!.index - toothPlacement(11)!.index).toBe(1)
  })

  it('the order the targets arrive in does not change the drawing', () => {
    const forwards = resolveFinding(finding({ rule_id: 'X.130', targets: span([13, 14, 15, 16]) }), r)
    const backwards = resolveFinding(finding({ rule_id: 'X.130', targets: span([16, 15, 14, 13]) }), r)
    const xs = (x: ReturnType<typeof resolveFinding>) =>
      symbols(x).map(s => Math.round(s.at.x * 100)).sort((a, b) => a - b)

    expect(xs(forwards)).toEqual(xs(backwards))
  })

  it('two groups yield two pairs of endpoints', () => {
    const result = resolveFinding(finding({
      rule_id: 'X.130',
      targets: [...span([46, 45, 44], 0), ...span([34, 35, 36], 1)]
    }), r)
    expect(symbols(result)).toHaveLength(4)
  })
})

describe('arrows point the way the arch decides', () => {
  const arrowRule = (id: string, at: string, toward: string, style = 'straight_vertical') =>
    rule({
      rule_id: id,
      render: { color_semantics: 'good_or_non_pathological', marks: [arrowMark(style, at, toward)] }
    })

  /** Sign of the arrow's travel: +1 down the screen, -1 up. */
  const sense = (r: ReturnType<typeof resolveFinding>) => {
    const points = arrowsOf(r)[0]!.arrows[0]!.points
    return Math.sign(points[points.length - 1]!.y - points[0]!.y)
  }

  const on = (id: string, fdi: number) =>
    finding({ rule_id: id, targets: [target({ tooth_number: fdi })] })

  it('outward runs away from the tooth: down on an upper, up on a lower', () => {
    const r = arrowRule('X.140', 'outside_occlusal', 'outward')
    expect(sense(resolveFinding(on('X.140', 16), r))).toBe(1)
    expect(sense(resolveFinding(on('X.140', 46), r))).toBe(-1)
  })

  it('inward is the mirror of outward on the same tooth', () => {
    const out = arrowRule('X.141', 'outside_occlusal', 'outward')
    const into = arrowRule('X.142', 'outside_occlusal', 'incisal_occlusal')

    expect(sense(resolveFinding(on('X.141', 16), out)))
      .toBe(-sense(resolveFinding(on('X.142', 16), into)))
    expect(sense(resolveFinding(on('X.141', 46), out)))
      .toBe(-sense(resolveFinding(on('X.142', 46), into)))
  })

  it('an on-figure arrow sits over the tooth, not outside it', () => {
    const r = arrowRule('X.143', 'on_figure', 'occlusal_plane', 'zigzag')
    const result = resolveFinding(on('X.143', 16), r)
    const points = arrowsOf(result)[0]!.arrows[0]!.points
    const crown = crownBox(16)!

    expect(arrowsOf(result)[0]!.style).toBe('zigzag')
    expect(points.length).toBeGreaterThan(2)
    // Its tip lands on the crown rather than clear of the row's biting edge.
    const tip = points[points.length - 1]!
    expect(tip.y).toBeLessThanOrEqual(crown.y + crown.height + 0.001)
    expect(tip.y).toBeGreaterThanOrEqual(crown.y - 0.001)
  })

  it('an outside arrow clears the row\'s occlusal band', () => {
    const r = arrowRule('X.144', 'outside_occlusal', 'outward')
    const points = arrowsOf(resolveFinding(on('X.144', 16), r))[0]!.arrows[0]!.points
    const band = occlusalBand('permanentUpper')!

    for (const point of points) expect(point.y).toBeGreaterThan(band)
  })

  it('two crossed curves are symmetric, whichever order the pair arrives in', () => {
    const r = rule({
      rule_id: 'X.145',
      scope: 'pair',
      render: {
        color_semantics: 'good_or_non_pathological',
        marks: [arrowMark('two_crossed_curved', 'tooth_numbers')]
      }
    })
    const build = (teeth: number[]) => arrowsOf(resolveFinding(
      finding({ rule_id: 'X.145', targets: span(teeth) }), r
    ))[0]!

    const forwards = build([26, 27])
    const backwards = build([27, 26])

    expect(forwards.arrows).toHaveLength(2)
    expect(forwards.arrows.every(a => a.curved)).toBe(true)
    expect(JSON.stringify(forwards.arrows)).toBe(JSON.stringify(backwards.arrows))

    // One bows above the numbers and the other below.
    const bows = forwards.arrows.map(a => Math.sign(a.points[1]!.y - a.points[0]!.y))
    expect(new Set(bows)).toEqual(new Set([-1, 1]))
    // Anchored on the FDI strip.
    expect(forwards.arrows[0]!.points[0]!.y).toBeCloseTo(numberAnchor(26)!.y, 6)
  })

  it('a curved arrow whose sense is a clinical observation is not invented', () => {
    const r = arrowRule('X.146', 'occlusal_zone', '', 'curved')
    const result = resolveFinding(on('X.146', 16), r)

    expect(arrowsOf(result)).toHaveLength(0)
    expect(unsupported(result)[0]!.reason).toBe('needs_clinical_direction')
  })

  it('an arrow with no recognised direction token is refused', () => {
    const r = arrowRule('X.147', 'outside_occlusal', 'sideways')
    expect(unsupported(resolveFinding(on('X.147', 16), r))[0]!.reason)
      .toBe('unknown_arrow_direction')
  })
})

// ---------------------------------------------------------------------------
// NTS-05D.4 — shape_fill and outline
// ---------------------------------------------------------------------------

/** Synthetic: a rule whose area mark reads its regions from a named attribute. */
const areaRule = (
  ruleId: string,
  kind: 'shape_fill' | 'outline',
  options: { regionsFrom?: string | null, at?: string, style?: string, box?: boolean } = {}
) => rule({
  rule_id: ruleId,
  attributes: [{
    name: 'zones',
    kind: 'enum_multi',
    required: true,
    is_sigla: false,
    values: ['M', 'D', 'O', 'V', 'L'].map(code => ({
      code, name: `Label ${code}`, status: 'verified', notes: null, specification_requirement: null
    })),
    status: 'verified',
    notes: null
  }, ...(options.box ? [SIGLA_ATTR('sigla', ['Q'])] : [])] as never,
  render: {
    color_semantics: 'good_or_non_pathological',
    marks: [
      {
        kind,
        params: {
          ...(options.style === undefined
            ? (kind === 'shape_fill' ? { fill: 'solid' } : { style: 'contour' })
            : options.style === '' ? {} : (kind === 'shape_fill' ? { fill: options.style } : { style: options.style })),
          ...(options.at ? { at: options.at } : {})
        },
        text_from: null,
        suffix_from: null,
        role: null,
        target_selector: null,
        regions_from: options.regionsFrom === undefined ? 'zones' : options.regionsFrom
      },
      ...(options.box ? [boxMark('sigla')] : [])
    ]
  }
})

const onTooth = (ruleId: string, fdi: number, zones: unknown) => finding({
  rule_id: ruleId,
  attributes: (zones === undefined ? {} : { zones }) as never,
  targets: [target({ tooth_number: fdi })]
})

/** Every point of every ring of every figure. */
const allPoints = (instruction: NtsShapeFillInstruction | NtsOutlineInstruction) =>
  instruction.components.flatMap(c => [...c.polygons.flat(), ...c.boundary.flat()])

describe('NTS-05D.4 — an area reads its regions through the declared binding', () => {
  it('resolves the bound attribute, whatever it is called', () => {
    // The attribute is deliberately not named "surfaces": a renderer that
    // hardcoded that word would pass on this norm and fail on the next.
    const r = areaRule('X.200', 'shape_fill')
    const result = resolveFinding(onTooth('X.200', 16, ['M']), r)

    expect(result.completeness).toBe('complete')
    expect(fills(result)).toHaveLength(1)
    expect(fills(result)[0]!.fdi).toBe(16)
    expect(fills(result)[0]!.style).toBe('solid')
  })

  it.each([
    ['the mark declares no source', { regionsFrom: null }, undefined, 'unknown_placement'],
    ['the attribute is absent', {}, undefined, 'missing_attribute_value'],
    ['the value is a bare code', {}, 'M', 'invalid_region_source'],
    ['the value is empty', {}, [], 'invalid_region_source'],
    ['the value holds a non-code', {}, [1], 'invalid_region_source'],
    ['every code is unknown', {}, ['Z', 'Q'], 'unresolved_regions']
  ])('reports %s rather than inventing geometry', (_label, ruleOpts, zones, reason) => {
    // The first case keeps a valid value and breaks the mark instead.
    const isBindingCase = (ruleOpts as { regionsFrom?: unknown }).regionsFrom === null
    const r = areaRule('X.201', 'shape_fill', ruleOpts as never)
    const result = resolveFinding(
      onTooth('X.201', 16, isBindingCase ? ['M'] : zones), r
    )

    expect(result.completeness).toBe('unsupported')
    expect(unsupported(result)[0]!.reason).toBe(reason)
    expect(fills(result)).toHaveLength(0)
  })

  it('an unknown code among known ones is simply not drawn', () => {
    const r = areaRule('X.202', 'shape_fill')
    const withJunk = fills(resolveFinding(onTooth('X.202', 16, ['M', 'Z']), r))
    const without = fills(resolveFinding(onTooth('X.202', 16, ['M']), r))

    expect(withJunk[0]!.regions).toEqual(without[0]!.regions)
  })

  it('a tooth the chart does not draw is reported', () => {
    const r = areaRule('X.203', 'shape_fill')
    const result = resolveFinding(onTooth('X.203', 99, ['M']), r)
    expect(unsupported(result)[0]!.reason).toBe('tooth_not_on_chart')
  })

  it('an unknown style is refused, and an absent one falls back to the only style', () => {
    expect(unsupported(resolveFinding(
      onTooth('X.204', 16, ['M']), areaRule('X.204', 'shape_fill', { style: 'hatched' })
    ))[0]!.reason).toBe('unknown_fill_style')

    expect(unsupported(resolveFinding(
      onTooth('X.205', 16, ['M']), areaRule('X.205', 'outline', { style: 'dotted' })
    ))[0]!.reason).toBe('unknown_outline_style')

    // Absent is legal: the catalog makes the param optional.
    expect(fills(resolveFinding(
      onTooth('X.206', 16, ['M']), areaRule('X.206', 'shape_fill', { style: '' })
    ))[0]!.style).toBe('solid')
  })

  it('a finding with no colour draws no area at all', () => {
    const r = rule({
      rule_id: 'X.207',
      attributes: [CONDITION_ATTR] as never,
      render: {
        color_semantics: 'condition_dependent',
        marks: [{ kind: 'shape_fill', params: { fill: 'solid' }, text_from: null, suffix_from: null, role: null, target_selector: null, regions_from: 'zones' }]
      }
    })
    const result = resolveFinding(finding({ rule_id: 'X.207', attributes: { zones: ['M'] } as never }), r)
    expect(unsupported(result)[0]!.reason).toBe('missing_condition_state')
    expect(fills(result)).toHaveLength(0)
  })
})

describe('NTS-05D.4 — the geometry comes from the surface policy, unchanged', () => {
  it('a single surface is one figure of one ring', () => {
    const r = areaRule('X.210', 'shape_fill')
    const [instruction] = fills(resolveFinding(onTooth('X.210', 16, ['M']), r))

    expect(instruction!.components).toHaveLength(1)
    expect(instruction!.components[0]!.polygons).toHaveLength(1)
    expect(instruction!.components[0]!.boundary).toHaveLength(1)
  })

  it('a posterior occlusal surface fills every central tile as one figure', () => {
    const r = areaRule('X.211', 'shape_fill')
    const [instruction] = fills(resolveFinding(onTooth('X.211', 16, ['O']), r))

    expect(instruction!.components).toHaveLength(1)
    expect(instruction!.components[0]!.polygons).toHaveLength(4)
    // Merged: one rim, no seam between the four.
    expect(instruction!.components[0]!.boundary).toHaveLength(1)
    expect(instruction!.regions).toEqual(['center-1', 'center-2', 'center-3', 'center-4'])
  })

  it('an anterior occlusal surface is the incisal band, not the whole central zone', () => {
    const r = areaRule('X.212', 'shape_fill')
    const [instruction] = fills(resolveFinding(onTooth('X.212', 11, ['O']), r))

    expect(instruction!.regions).toEqual(['incisal'])

    // The very polygon the policy owns, moved onto the chart and nothing else.
    const band = incisalBand(11)!
    const placed = instruction!.components[0]!.polygons[0]!
    expect(placed).toHaveLength(band.points.length)

    // Horizontal and centred: two distinct heights, wider than it is tall.
    const ys = new Set(placed.map(p => Math.round(p.y * 100)))
    expect(ys.size).toBe(2)
    const width = Math.max(...placed.map(p => p.x)) - Math.min(...placed.map(p => p.x))
    const height = Math.max(...placed.map(p => p.y)) - Math.min(...placed.map(p => p.y))
    expect(width).toBeGreaterThan(height)
  })

  it('contiguous surfaces fill as one figure and non-contiguous ones do not', () => {
    const r = areaRule('X.213', 'shape_fill')
    const merged = fills(resolveFinding(onTooth('X.213', 16, ['M', 'O']), r))[0]!
    const split = fills(resolveFinding(onTooth('X.213', 16, ['M', 'D']), r))[0]!

    expect(merged.components).toHaveLength(1)
    expect(merged.components[0]!.polygons).toHaveLength(5)
    expect(merged.components[0]!.boundary).toHaveLength(1)

    expect(split.components).toHaveLength(2)
    for (const figure of split.components) expect(figure.boundary).toHaveLength(1)
  })

  it('the order the surfaces were recorded in changes nothing', () => {
    const r = areaRule('X.214', 'shape_fill')
    const a = fills(resolveFinding(onTooth('X.214', 16, ['O', 'M', 'V']), r))[0]!
    const b = fills(resolveFinding(onTooth('X.214', 16, ['V', 'O', 'M']), r))[0]!
    expect(a.components).toEqual(b.components)
    expect(a.regions).toEqual(b.regions)
  })

  it('every coordinate is on the chart, inside that tooth', () => {
    const r = areaRule('X.215', 'shape_fill')
    for (const fdi of [16, 26, 36, 46, 11, 41, 55, 85]) {
      const instruction = fills(resolveFinding(onTooth('X.215', fdi, ['M', 'D', 'O', 'V', 'L']), r))[0]!
      const crown = crownBox(fdi)!
      for (const point of allPoints(instruction)) {
        expect(point.x, String(fdi)).toBeGreaterThanOrEqual(crown.x - 0.01)
        expect(point.x).toBeLessThanOrEqual(crown.x + crown.width + 0.01)
        expect(point.y).toBeGreaterThanOrEqual(crown.y - 0.01)
        expect(point.y).toBeLessThanOrEqual(crown.y + crown.height + 0.01)
      }
    }
  })

  it('one instruction per tooth when a finding names several', () => {
    const r = areaRule('X.216', 'shape_fill')
    const result = resolveFinding(finding({
      rule_id: 'X.216',
      attributes: { zones: ['M'] } as never,
      targets: [target({ id: 'a', tooth_number: 16 }), target({ id: 'b', position: 1, tooth_number: 26 })]
    }), r)

    expect(fills(result).map(i => i.fdi)).toEqual([16, 26])
  })
})

describe('NTS-05D.4 — an outline keeps every loop it was given', () => {
  it('strokes the boundary, not the tiles', () => {
    const r = areaRule('X.220', 'outline')
    const [instruction] = outlines(resolveFinding(onTooth('X.220', 16, ['M', 'O']), r))

    expect(instruction!.style).toBe('contour')
    expect(instruction!.components).toHaveLength(1)
    // Five tiles, one contour: the shared edges are gone.
    expect(instruction!.components[0]!.polygons).toHaveLength(5)
    expect(instruction!.components[0]!.boundary).toHaveLength(1)
  })

  it('two separated surfaces give two contours', () => {
    const r = areaRule('X.221', 'outline')
    const [instruction] = outlines(resolveFinding(onTooth('X.221', 16, ['M', 'D']), r))
    expect(instruction!.components).toHaveLength(2)
  })

  it('CRITICAL — a figure with holes keeps all of its loops', () => {
    // An anterior with every surface affected encloses two slivers that were
    // never recorded. Keeping only the rim would fill them in and claim ground
    // nobody observed; keeping only the first loop is the exact bug 05D.4b
    // uncovered when the boundary stopped being a single ring.
    const r = areaRule('X.222', 'outline')
    const [instruction] = outlines(resolveFinding(onTooth('X.222', 11, ['M', 'D', 'O', 'V', 'L']), r))

    expect(instruction!.components).toHaveLength(1)
    expect(instruction!.components[0]!.boundary).toHaveLength(3)

    // And it is exactly what the geometry module produced, loop for loop.
    const expected = resolveSurfaceComponents(11, ['M', 'D', 'O', 'V', 'L'])
    expect(instruction!.components[0]!.boundary.map(l => l.length))
      .toEqual(expected[0]!.boundary.map(l => l.length))
  })

  it('the loops keep the winding the geometry gave them', () => {
    // `fill-rule="nonzero"` is only correct while rim and hole are wound
    // against each other, so the renderer must not normalise or reverse them.
    const r = areaRule('X.223', 'outline')
    const [instruction] = outlines(resolveFinding(onTooth('X.223', 11, ['M', 'D', 'O', 'V', 'L']), r))

    const turn = (ring: { x: number, y: number }[]) => {
      let sum = 0
      for (let i = 0; i < ring.length; i++) {
        const a = ring[i]!
        const b = ring[(i + 1) % ring.length]!
        sum += a.x * b.y - b.x * a.y
      }
      return Math.sign(sum)
    }
    const signs = instruction!.components[0]!.boundary.map(turn)
    expect(new Set(signs).size).toBe(2)
  })
})

describe('NTS-05D.4 — a landmark-anchored area is not a surface', () => {
  const pulpRule = (ruleId: string) => rule({
    rule_id: ruleId,
    render: {
      color_semantics: 'good_or_non_pathological',
      marks: [{ kind: 'shape_fill', params: { at: 'coronal_pulp' }, text_from: null, suffix_from: null, role: null, target_selector: null, regions_from: null }]
    }
  })

  it('fills the crown tiles the landmark covers, merged into one figure', () => {
    const result = resolveFinding(onTooth('X.230', 16, undefined), pulpRule('X.230'))
    const [instruction] = fills(result)

    expect(result.completeness).toBe('complete')
    expect(instruction!.components).toHaveLength(1)
    expect(instruction!.components[0]!.polygons).toHaveLength(4)
    expect(instruction!.components[0]!.boundary).toHaveLength(1)
  })

  it('on a front tooth it is the whole central zone, NOT the incisal band', () => {
    // The two are different polygons on the same tooth, and confusing them
    // would draw an anatomical landmark with a surface's shape.
    const [instruction] = fills(resolveFinding(onTooth('X.231', 11, undefined), pulpRule('X.231')))
    const placed = instruction!.components[0]!.polygons[0]!
    const height = Math.max(...placed.map(p => p.y)) - Math.min(...placed.map(p => p.y))

    const zone = centralRegionsOf(NTS_ALL_TEETH.find(t => t.fdi === 11)!)[0]!
    const zoneHeight = Math.max(...zone.points.map(p => p.y)) - Math.min(...zone.points.map(p => p.y))
    const band = incisalBand(11)!
    const bandHeight = Math.max(...band.points.map(p => p.y)) - Math.min(...band.points.map(p => p.y))

    const scale = toothPlacement(11)!.scale
    expect(height).toBeCloseTo(zoneHeight * scale, 6)
    expect(height).not.toBeCloseTo(bandHeight * scale, 6)
    expect(instruction!.regions).toEqual(['center'])
  })

  it('needs no surface attribute, and refuses a landmark it does not model', () => {
    const r = rule({
      rule_id: 'X.232',
      render: {
        color_semantics: 'good_or_non_pathological',
        marks: [{ kind: 'shape_fill', params: { at: 'root_canal' }, text_from: null, suffix_from: null, role: null, target_selector: null, regions_from: null }]
      }
    })
    expect(unsupported(resolveFinding(onTooth('X.232', 16, undefined), r))[0]!.reason)
      .toBe('unknown_landmark')
  })
})

describe('NTS-05D.4 — areas sit under everything else', () => {
  it('fill and outline take the two lowest layers', () => {
    const fill = fills(resolveFinding(onTooth('X.240', 16, ['M']), areaRule('X.240', 'shape_fill')))[0]!
    const outline = outlines(resolveFinding(onTooth('X.241', 16, ['M']), areaRule('X.241', 'outline')))[0]!

    expect(fill.layer).toBe(NTS_LAYERS.fill)
    expect(outline.layer).toBe(NTS_LAYERS.outline)
    expect(NTS_LAYERS.fill).toBeLessThan(NTS_LAYERS.outline)
    for (const above of [NTS_LAYERS.line, NTS_LAYERS.symbol, NTS_LAYERS.arrow, NTS_LAYERS.text]) {
      expect(NTS_LAYERS.outline).toBeLessThan(above)
    }
  })

  it('the chart orders them first, and a sigla beside a fill still sits on top', () => {
    const r = areaRule('X.242', 'shape_fill', { box: true })
    const chart = resolveChart([onTooth('X.242', 16, ['M'])], [r])
    const kinds = chart.instructions.map(i => i.kind)

    expect(kinds.indexOf('shape_fill')).toBeLessThan(kinds.indexOf('text'))
  })
})

describe('NTS-05D.4 — two findings on the same ground are reported, never merged', () => {
  it('overlapping areas are both kept, in the order recorded', () => {
    const r = areaRule('X.250', 'shape_fill', { box: true })
    const first = onTooth('X.250', 16, ['M', 'O'])
    const second = onTooth('X.250', 16, ['O'])
    const chart = resolveChart([first, second], [r])

    const drawn = chart.instructions.filter(
      (i): i is NtsShapeFillInstruction => i.kind === 'shape_fill'
    )
    expect(drawn.map(i => i.findingId)).toEqual([first.id, second.id])
    // Never merged across findings: each keeps its own figures.
    expect(drawn[0]!.components[0]!.polygons).toHaveLength(5)
    expect(drawn[1]!.components[0]!.polygons).toHaveLength(4)
  })

  it('the overlap is reported once, with the regions they share', () => {
    const r = areaRule('X.251', 'shape_fill', { box: true })
    const first = onTooth('X.251', 16, ['M', 'O'])
    const second = onTooth('X.251', 16, ['O'])
    const chart = resolveChart([first, second], [r])

    expect(chart.overlaps).toHaveLength(1)
    expect(chart.overlaps[0]).toMatchObject({
      fdi: 16,
      findingIds: [first.id, second.id],
      regions: ['center-1', 'center-2', 'center-3', 'center-4'],
      silent: false
    })
  })

  it('no overlap is reported when the areas only touch', () => {
    const r = areaRule('X.252', 'shape_fill', { box: true })
    const chart = resolveChart(
      [onTooth('X.252', 16, ['M']), onTooth('X.252', 16, ['O'])],
      [r]
    )
    expect(chart.overlaps).toEqual([])
  })

  it('nor across different teeth', () => {
    const r = areaRule('X.253', 'shape_fill', { box: true })
    const chart = resolveChart(
      [onTooth('X.253', 16, ['M']), onTooth('X.253', 26, ['M'])],
      [r]
    )
    expect(chart.overlaps).toEqual([])
  })

  it('an area with no sigla to fall back on is flagged as silent', () => {
    // A finding whose only representation is the area itself can be covered
    // completely by whatever is painted over it, and then it is simply gone
    // from the chart. That is worth saying out loud.
    const silent = areaRule('X.254', 'outline')
    const spoken = areaRule('X.255', 'shape_fill', { box: true })
    const chart = resolveChart(
      [onTooth('X.255', 16, ['O']), onTooth('X.254', 16, ['O'])],
      [silent, spoken]
    )

    expect(chart.overlaps).toHaveLength(1)
    expect(chart.overlaps[0]!.silent).toBe(true)
  })

  it('the warning changes nothing about what is drawn', () => {
    const r = areaRule('X.256', 'shape_fill', { box: true })
    const alone = resolveChart([onTooth('X.256', 16, ['O'])], [r])
    const together = resolveChart(
      [onTooth('X.256', 16, ['O']), onTooth('X.256', 16, ['O'])],
      [r]
    )
    const shapes = (c: typeof alone) => c.instructions
      .filter((i): i is NtsShapeFillInstruction => i.kind === 'shape_fill')
      .map(i => i.components)

    expect(together.overlaps).toHaveLength(1)
    expect(shapes(together)[0]).toEqual(shapes(alone)[0])
    expect(shapes(together)[1]).toEqual(shapes(alone)[0])
  })
})

describe('NTS-05D.4 — the style vocabularies are still single-valued', () => {
  it('falling back to the only style stays honest', () => {
    // The fallback for an absent style param is "the one style the catalog
    // declares". The moment either vocabulary gains a second member that stops
    // being a reading of the contract and becomes a guess, and the catalog has
    // to declare a default instead. This test is the tripwire.
    const styles = { fill: new Set<string>(), outline: new Set<string>() }
    for (const r of CATALOG.rules) {
      const marks = (r.render as unknown as { marks: Array<{ kind: string, params?: Record<string, string> }> }).marks
      for (const mark of marks) {
        if (mark.kind === 'shape_fill' && mark.params?.fill) styles.fill.add(mark.params.fill)
        if (mark.kind === 'outline' && mark.params?.style) styles.outline.add(mark.params.style)
      }
    }
    expect([...styles.fill]).toEqual(['solid'])
    expect([...styles.outline]).toEqual(['contour'])
  })
})
