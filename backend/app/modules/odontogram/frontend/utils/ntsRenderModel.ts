/**
 * NTS N.° 188 render model — findings become drawing instructions.
 *
 * The pure half of the renderer. It takes a stored finding, the catalog rule it
 * cites and the chart geometry, and returns what should be drawn. It never
 * touches the DOM, never imports Vue, and never decides a colour value: it says
 * *a blue thing goes here*, and the layer decides which blue.
 *
 * ## No rule ever gets a special case
 *
 * Every decision is read from the mark:
 *
 * * which attribute supplies a sigla — `mark.text_from`
 * * what to append to it — `mark.suffix_from`
 * * which shape to draw — `mark.params.shape`
 * * where it goes — `mark.params.at`, falling back to what the shape itself
 *   names (a "square bordering the crown" needs no placement token)
 * * which colour — `rule.render.color_semantics`, plus the finding's own
 *   `condition_state` when the norm makes it conditional
 *
 * That is what NTS-05D.0b bought: the supernumerary tooth writes its sigla
 * inside a circumference instead of in the annotation box, and this module
 * draws it correctly without knowing which rule that is. There is no
 * `rule_id` in this file, and a test asserts there never will be.
 *
 * ## What this slice draws
 *
 * `box_siglas` and `symbol`. Everything else — lines, connectors, arrows,
 * fills, outlines — is **deferred**, not ignored: a finding whose marks are
 * only partly drawable reports itself as `partial`, and one that cannot be
 * drawn at all reports `unsupported`. Nothing disappears quietly, because a
 * finding that vanishes from an odontogram reads as a finding that was never
 * made.
 */

import type { NtsFinding, NtsFindingTarget, NtsRule } from '../types/nts'
import type { NtsBox, NtsPoint } from './ntsChartGeometry'
import {
  annotationBox,
  crownBox,
  interproximalPoint,
  numberAnchor,
  rootBox,
  toothPlacement
} from './ntsChartGeometry'

// ---------------------------------------------------------------------------
// the instruction model
// ---------------------------------------------------------------------------

/**
 * Semantic colour, never a value.
 *
 * The norm names two colours and no RGB (§5.12-5.13), so the model stops at
 * the meaning. Keeping the hex out of here is also what lets the same
 * instructions be asserted in a test, rendered on a light theme, rendered on a
 * dark one and printed, without four sets of expectations.
 */
export type NtsPaint = 'good' | 'bad'

/** Painting order. Lower draws first; text is always legible on top. */
export const NTS_LAYERS = {
  fill: 10,
  outline: 20,
  overlay: 30,
  line: 40,
  symbol: 50,
  arrow: 60,
  text: 70
} as const

export type NtsLayer = (typeof NTS_LAYERS)[keyof typeof NTS_LAYERS]

/**
 * Identity carried by every instruction.
 *
 * `normVersion + ruleId` is the identity, never the drawn text: NTS N.° 188
 * writes "M" for two unrelated rules and "S" for two more, so two instructions
 * may legitimately render the same glyph and mean different things.
 *
 * `paint` is nullable here and only here: an instruction that cannot be drawn
 * may also be one whose colour could not be established. Anything that *is*
 * drawn narrows it back to a real colour, so no drawing primitive can ever be
 * handed a `null`.
 */
export interface NtsInstructionBase {
  normVersion: string
  ruleId: string
  findingId: string
  paint: NtsPaint | null
  layer: NtsLayer
}

export interface NtsTextInstruction extends NtsInstructionBase {
  kind: 'text'
  /** Narrowed: nothing is written without a colour. */
  paint: NtsPaint
  /** The normative code, e.g. "CM" — never the human label. */
  text: string
  /** The attribute value the text came from, for traceability. */
  variantCode: string
  /** The annotation box it belongs to. */
  box: NtsBox
  fdi: number
  /**
   * Which line of the box it was laid out on, or `null` when the box was
   * already full. A `null` line is still an instruction: the finding exists
   * and is counted, it simply has no room to be written.
   */
  line: number | null
}

export type NtsSymbolShape =
  | 'circle'
  | 'circle_enclosing_sigla'
  | 'inverted_parenthesis'
  | 'square'
  | 'square_bordering_crown'
  | 'square_with_cross'
  | 'triangle'
  | 'two_intersecting_circles'
  | 'x_cross'

export interface NtsSymbolInstruction extends NtsInstructionBase {
  kind: 'symbol'
  /** Narrowed: nothing is drawn without a colour. */
  paint: NtsPaint
  shape: NtsSymbolShape
  /** Where the shape is centred. */
  at: NtsPoint
  /** The box the shape is sized against. */
  bounds: NtsBox
  /** Set only for a shape that encloses a sigla. */
  enclosedText?: string
}

/** Why something could not be drawn. Always reported, never swallowed. */
export type NtsUnsupportedReason =
  | 'mark_kind_not_in_slice'
  | 'unknown_symbol_shape'
  | 'unknown_placement'
  | 'missing_attribute_value'
  | 'unknown_variant_code'
  | 'tooth_not_on_chart'
  | 'targets_not_adjacent'
  | 'wrong_target_count'
  | 'needs_range_orchestration'
  /**
   * The norm ties this rule's colour to a good/bad state the finding does not
   * carry, or carries as something the catalog does not enumerate. Both
   * colours are clinical claims, so neither may be assumed.
   */
  | 'missing_condition_state'

export interface NtsUnsupportedInstruction extends NtsInstructionBase {
  kind: 'unsupported'
  reason: NtsUnsupportedReason
  /** The mark that could not be drawn. */
  markKind: string
}

export type NtsRenderInstruction =
  | NtsTextInstruction
  | NtsSymbolInstruction
  | NtsUnsupportedInstruction

/** How much of a finding this slice can actually draw. */
export type NtsCompleteness = 'complete' | 'partial' | 'unsupported'

export interface NtsFindingRender {
  findingId: string
  ruleId: string
  normVersion: string
  /** `null` when the finding does not say which of the two colours applies. */
  paint: NtsPaint | null
  completeness: NtsCompleteness
  instructions: NtsRenderInstruction[]
}

/** An annotation box holding more siglas than it can show. */
export interface NtsBoxOverflow {
  fdi: number
  box: NtsBox
  /** How many siglas are not written. Never zero. */
  hidden: number
  /** The line the indicator occupies. */
  line: number
}

export interface NtsChartRender {
  findings: NtsFindingRender[]
  /** Everything drawable, in painting order. */
  instructions: NtsRenderInstruction[]
  overflows: NtsBoxOverflow[]
  partial: string[]
  unsupported: string[]
}

// ---------------------------------------------------------------------------
// colour
// ---------------------------------------------------------------------------

const CONDITION_ATTRIBUTE = 'condition_state'

/**
 * The colour a finding is drawn in, or `null` when the data does not say.
 *
 * Two of the three semantics are fixed by the rule and need nothing from the
 * finding. The third, `condition_dependent`, ties the colour to whether the
 * thing is in good or bad state (§5.12-5.13) — and there, **a missing state is
 * not a good state**.
 *
 * Defaulting to blue would put a clinical claim on the chart that the record
 * does not contain: "this prosthesis is in good condition" is a finding in its
 * own right, and nobody made it. Defaulting to red would be the same mistake
 * pointing the other way. So an absent state — or one the catalog does not
 * enumerate — yields no colour, and the finding is reported rather than drawn.
 *
 * In practice the catalog makes `condition_state` required on all twelve of
 * these rules, so this is a guard against incomplete or foreign data, not a
 * path a well-formed record takes.
 */
export function paintFor(rule: NtsRule, finding: NtsFinding): NtsPaint | null {
  const semantics = (rule.render as { color_semantics?: string } | undefined)?.color_semantics
  if (semantics === 'bad_temporary_or_pathological') return 'bad'
  if (semantics !== 'condition_dependent') return 'good'

  // Matched explicitly against the two codes the norm defines. A third code,
  // were one ever to appear, would be something new rather than a synonym of
  // either — so it is refused too.
  const state = finding.attributes[CONDITION_ATTRIBUTE]
  if (state === 'good') return 'good'
  if (state === 'bad') return 'bad'
  return null
}

// ---------------------------------------------------------------------------
// reading the catalog's marks
// ---------------------------------------------------------------------------

interface CatalogMark {
  kind: string
  params: Record<string, string>
  text_from: string | null
  suffix_from: string | null
  role: string | null
  /** A subset of the finding's targets, chosen by the span's own shape. */
  target_selector: string | null
}

function marksOf(rule: NtsRule): CatalogMark[] {
  const render = rule.render as { marks?: unknown[] } | undefined
  return ((render?.marks ?? []) as CatalogMark[]).map(mark => ({
    kind: mark.kind,
    params: mark.params ?? {},
    text_from: mark.text_from ?? null,
    suffix_from: mark.suffix_from ?? null,
    role: mark.role ?? null,
    target_selector: mark.target_selector ?? null
  }))
}

/**
 * The text a mark writes, read strictly through its declared binding.
 *
 * Never a search for "the attribute that looks like a sigla": 05D.0b made the
 * binding explicit precisely so this could not drift. A value the catalog does
 * not enumerate is refused rather than printed, because an unrecognised code on
 * an odontogram is a clinical statement nobody made.
 */
function textFor(
  rule: NtsRule,
  finding: NtsFinding,
  attributeName: string
): { text: string } | { reason: NtsUnsupportedReason } {
  // Defensive against a rule that arrived without its optional collections:
  // the API always serialises them, but a fixture read straight off the
  // catalog JSON omits whatever equals its default.
  const definition = (rule.attributes ?? []).find(a => a.name === attributeName)
  if (!definition) return { reason: 'missing_attribute_value' }

  const raw = finding.attributes[attributeName]
    // A `fixed` attribute is a constant the rule carries; the finding need not
    // repeat it, and older records may not.
    ?? (definition.kind === 'fixed' ? (definition.values ?? [])[0]?.code : undefined)

  if (typeof raw !== 'string' || raw.length === 0) return { reason: 'missing_attribute_value' }
  if (!(definition.values ?? []).some(value => value.code === raw)) {
    return { reason: 'unknown_variant_code' }
  }
  return { text: raw }
}

/** The suffix appended after a sigla, as a plain scalar. */
function suffixFor(finding: NtsFinding, attributeName: string): string | null {
  const raw = finding.attributes[attributeName]
  if (raw === null || raw === undefined || raw === '') return null
  if (typeof raw === 'number' || typeof raw === 'string') return String(raw)
  return null
}

// ---------------------------------------------------------------------------
// targets
// ---------------------------------------------------------------------------

function subjects(finding: NtsFinding): NtsFindingTarget[] {
  return finding.targets
    .filter(target => target.participation === 'subject')
    .slice()
    .sort((a, b) => a.position - b.position)
}

function anchors(finding: NtsFinding): NtsFindingTarget[] {
  return finding.targets
    .filter(target => target.participation === 'anchor')
    .slice()
    .sort((a, b) => a.position - b.position)
}

function numberedSubjects(finding: NtsFinding): number[] {
  return subjects(finding)
    .filter(target => target.tooth_number !== null)
    .map(target => target.tooth_number!)
}

// ---------------------------------------------------------------------------
// symbol placement
// ---------------------------------------------------------------------------

interface Placed {
  at: NtsPoint
  bounds: NtsBox
}

function centreOf(box: NtsBox): NtsPoint {
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
}

/** A small square centred on a point, sized from the box it sits in. */
function squareAround(point: NtsPoint, reference: NtsBox, fraction: number): NtsBox {
  const size = Math.min(reference.width, reference.height) * fraction
  return { x: point.x - size / 2, y: point.y - size / 2, width: size, height: size }
}

/**
 * Where a symbol goes.
 *
 * Driven by `at` when the mark declares one. When it does not, the shape names
 * its own anchor — "a square bordering the crown" is placed on the crown and
 * needs no separate token — so the fallback is a switch on the shape, never on
 * the rule.
 */
function placeSymbol(
  shape: NtsSymbolShape,
  at: string | undefined,
  finding: NtsFinding
): Placed | { reason: NtsUnsupportedReason } {
  const teeth = numberedSubjects(finding)

  switch (at) {
    case undefined:
      return placeByShape(shape, teeth)

    case 'crown': {
      const box = teeth[0] !== undefined ? crownBox(teeth[0]) : null
      return box ? { at: centreOf(box), bounds: squareAround(centreOf(box), box, 0.5) } : { reason: 'tooth_not_on_chart' }
    }

    case 'near_roots': {
      const box = teeth[0] !== undefined ? rootBox(teeth[0]) : null
      if (!box) return { reason: 'tooth_not_on_chart' }
      const point = centreOf(box)
      return { at: point, bounds: squareAround(point, box, 0.55) }
    }

    case 'tooth_number': {
      const point = teeth[0] !== undefined ? numberAnchor(teeth[0]) : null
      const box = teeth[0] !== undefined ? annotationBox(teeth[0]) : null
      if (!point || !box) return { reason: 'tooth_not_on_chart' }
      return { at: point, bounds: numberBounds(teeth[0]!, point) }
    }

    case 'tooth_numbers': {
      // One shape spanning both numbers: centred between them.
      if (teeth.length !== 2) return { reason: 'wrong_target_count' }
      const first = numberAnchor(teeth[0]!)
      const second = numberAnchor(teeth[1]!)
      if (!first || !second) return { reason: 'tooth_not_on_chart' }
      const point = { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 }
      return {
        at: point,
        bounds: {
          x: Math.min(first.x, second.x) - 9,
          y: point.y - 9,
          width: Math.abs(second.x - first.x) + 18,
          height: 18
        }
      }
    }

    case 'between_teeth': {
      if (teeth.length !== 2) return { reason: 'wrong_target_count' }
      const point = interproximalPoint(teeth[0]!, teeth[1]!, 'crown')
      if (!point) return { reason: 'targets_not_adjacent' }
      const reference = crownBox(teeth[0]!)!
      return { at: point, bounds: squareAround(point, reference, 0.9) }
    }

    case 'between_apices': {
      // The subject has no FDI cell; its anchors locate it.
      const references = anchors(finding)
        .filter(target => target.tooth_number !== null)
        .map(target => target.tooth_number!)
      if (references.length !== 2) return { reason: 'wrong_target_count' }
      const point = interproximalPoint(references[0]!, references[1]!, 'apex')
      if (!point) return { reason: 'targets_not_adjacent' }
      const reference = crownBox(references[0]!)!
      return { at: point, bounds: squareAround(point, reference, 0.85) }
    }

    default:
      return { reason: 'unknown_placement' }
  }
}

/** The band a number-anchored shape is sized against. */
function numberBounds(fdi: number, point: NtsPoint): NtsBox {
  const placement = toothPlacement(fdi)!
  const size = Math.min(placement.number.height, placement.number.width) * 1.1
  return { x: point.x - size / 2, y: point.y - size / 2, width: size, height: size }
}

function placeByShape(
  shape: NtsSymbolShape,
  teeth: number[]
): Placed | { reason: NtsUnsupportedReason } {
  switch (shape) {
    case 'square_bordering_crown':
    case 'x_cross': {
      const box = teeth[0] !== undefined ? crownBox(teeth[0]) : null
      return box ? { at: centreOf(box), bounds: box } : { reason: 'tooth_not_on_chart' }
    }
    default:
      return { reason: 'unknown_placement' }
  }
}

const KNOWN_SHAPES: ReadonlySet<string> = new Set<NtsSymbolShape>([
  'circle',
  'circle_enclosing_sigla',
  'inverted_parenthesis',
  'square',
  'square_bordering_crown',
  'square_with_cross',
  'triangle',
  'two_intersecting_circles',
  'x_cross'
])

// ---------------------------------------------------------------------------
// one finding
// ---------------------------------------------------------------------------

/** Mark kinds this slice can draw. The rest are deferred, never dropped. */
const DRAWABLE_KINDS: ReadonlySet<string> = new Set(['box_siglas', 'symbol'])

export function resolveFinding(finding: NtsFinding, rule: NtsRule): NtsFindingRender {
  const paint = paintFor(rule, finding)
  const base = {
    normVersion: finding.norm_version,
    ruleId: finding.rule_id,
    findingId: finding.id,
    paint
  }

  const instructions: NtsRenderInstruction[] = []
  let drawn = 0
  let total = 0

  for (const mark of marksOf(rule)) {
    total += 1

    // Without a colour there is nothing to draw: both of the norm's colours
    // are clinical statements, and picking one would be making it up.
    if (paint === null) {
      instructions.push({
        ...base,
        kind: 'unsupported',
        layer: NTS_LAYERS.overlay,
        reason: 'missing_condition_state',
        markKind: mark.kind
      })
      continue
    }

    if (!DRAWABLE_KINDS.has(mark.kind)) {
      instructions.push({
        ...base,
        kind: 'unsupported',
        layer: NTS_LAYERS.overlay,
        reason: 'mark_kind_not_in_slice',
        markKind: mark.kind
      })
      continue
    }

    const drawable = { ...base, paint }
    const produced =
      mark.kind === 'box_siglas'
        ? resolveBox(mark, rule, finding, drawable)
        : resolveSymbol(mark, rule, finding, drawable)

    instructions.push(produced)
    if (produced.kind !== 'unsupported') drawn += 1
  }

  const completeness: NtsCompleteness =
    drawn === 0 ? 'unsupported' : drawn === total ? 'complete' : 'partial'

  return { ...base, completeness, instructions }
}

/** The identity of an instruction that is going to be drawn: colour known. */
type DrawableBase = Omit<NtsInstructionBase, 'layer' | 'paint'> & { paint: NtsPaint }

function resolveBox(
  mark: CatalogMark,
  rule: NtsRule,
  finding: NtsFinding,
  base: DrawableBase
): NtsRenderInstruction {
  const fdi = numberedSubjects(finding)[0]
  const box = fdi !== undefined ? annotationBox(fdi) : null
  if (fdi === undefined || !box) {
    return { ...base, kind: 'unsupported', layer: NTS_LAYERS.text, reason: 'tooth_not_on_chart', markKind: mark.kind }
  }
  if (!mark.text_from) {
    return { ...base, kind: 'unsupported', layer: NTS_LAYERS.text, reason: 'missing_attribute_value', markKind: mark.kind }
  }

  const resolved = textFor(rule, finding, mark.text_from)
  if ('reason' in resolved) {
    return { ...base, kind: 'unsupported', layer: NTS_LAYERS.text, reason: resolved.reason, markKind: mark.kind }
  }

  const suffix = mark.suffix_from ? suffixFor(finding, mark.suffix_from) : null

  return {
    ...base,
    kind: 'text',
    layer: NTS_LAYERS.text,
    text: suffix === null ? resolved.text : `${resolved.text}${suffix}`,
    variantCode: resolved.text,
    box,
    fdi,
    line: null
  }
}

function resolveSymbol(
  mark: CatalogMark,
  rule: NtsRule,
  finding: NtsFinding,
  base: DrawableBase
): NtsRenderInstruction {
  const shape = mark.params.shape
  const fail = (reason: NtsUnsupportedReason): NtsUnsupportedInstruction => ({
    ...base,
    kind: 'unsupported',
    layer: NTS_LAYERS.symbol,
    reason,
    markKind: mark.kind
  })

  if (!shape || !KNOWN_SHAPES.has(shape)) return fail('unknown_symbol_shape')

  // A mark drawn on only some of the finding's targets needs the span resolved
  // before it can be placed, and the span primitives belong to a later slice.
  // The placement itself is now stated (`at`), so this is a missing primitive
  // rather than missing metadata — and drawing the marks without the connector
  // that joins them would show half a mark.
  if (mark.target_selector !== null) return fail('needs_range_orchestration')

  const placed = placeSymbol(shape as NtsSymbolShape, mark.params.at, finding)
  if ('reason' in placed) return fail(placed.reason)

  let enclosedText: string | undefined
  if (mark.text_from) {
    const resolved = textFor(rule, finding, mark.text_from)
    if ('reason' in resolved) return fail(resolved.reason)
    enclosedText = resolved.text
  }

  return {
    ...base,
    kind: 'symbol',
    layer: NTS_LAYERS.symbol,
    shape: shape as NtsSymbolShape,
    at: placed.at,
    bounds: placed.bounds,
    ...(enclosedText === undefined ? {} : { enclosedText })
  }
}

// ---------------------------------------------------------------------------
// the whole chart
// ---------------------------------------------------------------------------

/**
 * How many siglas one annotation box shows before it has to say "+n".
 *
 * Two, stacked vertically. That is what the norm's own figure does — p.15
 * writes "D" over "L" in a single box, one per line — and it is what the real
 * boxes can hold: a front tooth's column is under 30px wide, so packing three
 * codes across it was never going to be legible, and codes run to four
 * characters.
 */
const BOX_CAPACITY = 2

/**
 * Resolve every finding on a record and lay out the annotation boxes.
 *
 * Two passes on purpose. Resolving a finding is a property of that finding;
 * whether its sigla fits in the box depends on every *other* finding on the
 * same tooth, and that is not knowable one finding at a time.
 */
export function resolveChart(
  findings: readonly NtsFinding[],
  rules: readonly NtsRule[]
): NtsChartRender {
  const byRuleId = new Map(rules.map(rule => [rule.rule_id, rule]))
  const resolved: NtsFindingRender[] = []

  for (const finding of findings) {
    const rule = byRuleId.get(finding.rule_id)
    if (!rule) {
      // A record citing a rule this build cannot interpret still counts.
      resolved.push({
        findingId: finding.id,
        ruleId: finding.rule_id,
        normVersion: finding.norm_version,
        paint: 'good',
        completeness: 'unsupported',
        instructions: [{
          normVersion: finding.norm_version,
          ruleId: finding.rule_id,
          findingId: finding.id,
          paint: null,
          kind: 'unsupported',
          layer: NTS_LAYERS.overlay,
          reason: 'mark_kind_not_in_slice',
          markKind: 'unknown_rule'
        }]
      })
      continue
    }
    resolved.push(resolveFinding(finding, rule))
  }

  const instructions = resolved.flatMap(entry => entry.instructions)
  const overflows = layoutBoxes(instructions)

  return {
    findings: resolved,
    instructions: instructions.sort((a, b) => a.layer - b.layer),
    overflows,
    partial: resolved.filter(r => r.completeness === 'partial').map(r => r.findingId),
    unsupported: resolved.filter(r => r.completeness === 'unsupported').map(r => r.findingId)
  }
}

/**
 * Assign each sigla a line in its box, and report what did not fit.
 *
 * Mutates `line` on the text instructions rather than dropping any of them:
 * an instruction with `line === null` is a finding that exists, is counted in
 * the overflow indicator, and simply has no room to be written. Losing it here
 * would make the chart claim the finding was never recorded.
 *
 * Order is the order the findings arrive in, which is the record's own
 * sequence — deterministic, and the same on every render and every print.
 */
function layoutBoxes(instructions: readonly NtsRenderInstruction[]): NtsBoxOverflow[] {
  const byTooth = new Map<number, NtsTextInstruction[]>()
  for (const instruction of instructions) {
    if (instruction.kind !== 'text') continue
    const bucket = byTooth.get(instruction.fdi)
    if (bucket) bucket.push(instruction)
    else byTooth.set(instruction.fdi, [instruction])
  }

  const overflows: NtsBoxOverflow[] = []
  for (const [fdi, texts] of byTooth) {
    // Everything fits: one per line.
    if (texts.length <= BOX_CAPACITY) {
      texts.forEach((text, index) => { text.line = index })
      continue
    }
    // It does not: show the first and give the count of the rest, so the
    // reader can see there is more rather than being shown a silent subset.
    texts.forEach((text, index) => { text.line = index === 0 ? 0 : null })
    overflows.push({
      fdi,
      box: texts[0]!.box,
      hidden: texts.length - 1,
      line: 1
    })
  }
  return overflows.sort((a, b) => a.fdi - b.fdi)
}
