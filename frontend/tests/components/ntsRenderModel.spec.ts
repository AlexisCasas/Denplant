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
  NtsSymbolInstruction,
  NtsTextInstruction,
  NtsUnsupportedInstruction
} from '../../../backend/app/modules/odontogram/frontend/utils/ntsRenderModel'
import {
  annotationBox,
  crownBox,
  numberAnchor
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

  it('a symbol drawn on a subset of the targets is deferred, not approximated', () => {
    // Since NTS-05D.3a the mark states where it goes (`at`) and which targets
    // it applies to (`target_selector`) separately. The placement is known;
    // what is missing is the span primitive, and drawing the squares without
    // the connector that joins them would show half a mark.
    const r = rule({
      rule_id: 'X.35',
      scope: 'range',
      render: {
        color_semantics: 'good_or_non_pathological',
        marks: [symbolMark('square_with_cross', 'apex_level', undefined, 'range_endpoints')]
      }
    })
    expect(unsupported(resolveFinding(finding({ rule_id: 'X.35' }), r))[0]!.reason)
      .toBe('needs_range_orchestration')
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

  it('a drawable mark beside a deferred one is partial, and the deferred one is reported', () => {
    const r = rule({
      rule_id: 'X.51',
      render: {
        color_semantics: 'good_or_non_pathological',
        marks: [{ kind: 'line', params: { style: 'straight_vertical' }, text_from: null, suffix_from: null, role: null },
          symbolMark('square', 'crown')]
      }
    })
    const result = resolveFinding(finding({ rule_id: 'X.51' }), r)

    expect(result.completeness).toBe('partial')
    expect(symbols(result)).toHaveLength(1)
    expect(unsupported(result)[0]).toMatchObject({
      reason: 'mark_kind_not_in_slice',
      markKind: 'line'
    })
  })

  it.each(['line', 'connector', 'arrow', 'shape_fill', 'outline'])(
    'a %s-only rule is unsupported, and never silently empty',
    (kind) => {
      const r = rule({
        rule_id: `X.${kind}`,
        render: {
          color_semantics: 'good_or_non_pathological',
          marks: [{ kind, params: {}, text_from: null, suffix_from: null, role: null }]
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

  it('a span rule draws nothing yet, and reports both deferred marks', () => {
    const r = real('6.1.29')
    const result = resolveFinding(
      finding({ rule_id: '6.1.29', attributes: { condition_state: 'good' } }), r
    )
    expect(result.completeness).toBe('unsupported')
    expect(unsupported(result).map(i => i.markKind).sort()).toEqual(['connector', 'line'])
  })

  it('the whole catalog classifies exactly as the slice promises', () => {
    const counts = { complete: 0, partial: 0, unsupported: 0 }
    for (const r of CATALOG.rules) {
      const attributes: Record<string, unknown> = {}
      for (const attribute of r.attributes ?? []) {
        const values = attribute.values ?? []
        if (values.length > 0) attributes[attribute.name] = values[0]!.code
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

    // box_siglas / symbol are drawn; everything else waits for 05D.3+.
    //
    // 18 complete: every rule whose marks are only siglas and symbols.
    //  7 partial: a symbol or a sigla beside a line, fill or outline.
    // 13 unsupported: nothing drawable at all, which includes the range rule
    //    whose symbol applies to the span's endpoints — placing those without
    //    the connector that joins them would show half a mark.
    expect(counts).toEqual({ complete: 18, partial: 7, unsupported: 13 })
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

  it.each(FILES)('%s switches only on mark kind, shape, placement or paint', (file) => {
    const code = source(file)
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/<!--[\s\S]*?-->/g, '')
      .replace(/\/\/.*$/gm, '')
    expect(code).not.toMatch(/rule_id\s*===/)
    expect(code).not.toMatch(/switch\s*\(\s*\w*rule\w*\.?rule_id/i)
  })
})
