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
 * `box_siglas`, `symbol`, `line`, `connector` and `arrow`. What is left —
 * `shape_fill` and `outline` — both need the shape the clinician observed,
 * which has no channel to arrive through yet.
 *
 * Deferral is **reported, never silent**: a finding whose marks are only
 * partly drawable reports itself as `partial`, one that cannot be drawn at all
 * reports `unsupported`, and each undrawable mark carries the reason. A
 * finding that vanished from an odontogram would read as a finding that was
 * never made.
 */

import type { NtsFinding, NtsFindingTarget, NtsRule } from '../types/nts'
import type { NtsBox, NtsLevel, NtsPoint, NtsRowId, NtsSpan } from './ntsChartGeometry'
import {
  annotationBox,
  apexPoint,
  archSpan,
  crownBox,
  interproximalPoint,
  localToGlobal,
  numberAnchor,
  occlusalBand,
  occlusalDirection,
  rangeSpan,
  rootBox,
  toothPlacement
} from './ntsChartGeometry'
import type { NtsTooth } from './ntsDentition'
import { centralRegionsOf } from './ntsDentition'
import {
  mergeRegions,
  resolveSurfaceComponents,
  resolveSurfaceRegions
} from './ntsSurfaceGeometry'

/**
 * Re-exported because they are part of this module's own contract: every
 * instruction carries boxes and points, and a consumer should not have to
 * import half of its types from the geometry module to read one.
 */
export type { NtsBox, NtsPoint } from './ntsChartGeometry'

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

export type NtsLineStyle =
  | 'straight_horizontal'
  | 'straight_vertical'
  | 'two_parallel_horizontal'
  | 'zigzag'

/**
 * A stroke, or several, already resolved to chart coordinates.
 *
 * Polylines rather than path strings: a zigzag is its points, a pair of
 * parallels is two of them, and a test can say where a line runs without
 * parsing SVG. The layer turns each into one `<polyline>` and nothing else.
 */
export interface NtsLineInstruction extends NtsInstructionBase {
  kind: 'line'
  /** Narrowed: nothing is drawn without a colour. */
  paint: NtsPaint
  style: NtsLineStyle
  strokes: NtsPoint[][]
}

export type NtsConnectorStyle = 'straight_line' | 'vertical_marks'

export interface NtsConnectorInstruction extends NtsInstructionBase {
  kind: 'connector'
  paint: NtsPaint
  style: NtsConnectorStyle
  strokes: NtsPoint[][]
}

export type NtsArrowStyle = 'zigzag' | 'straight_vertical' | 'two_crossed_curved'

/**
 * One arrow: a spine and the way its head faces.
 *
 * `points` runs tail → tip, so the head is always at the last point and its
 * facing is the last segment. `curved` marks a three-point spine to be drawn
 * as a quadratic through its middle, which is what the two crossed arrows of a
 * transposition need.
 */
export interface NtsArrowShape {
  points: NtsPoint[]
  curved: boolean
}

export interface NtsArrowInstruction extends NtsInstructionBase {
  kind: 'arrow'
  paint: NtsPaint
  style: NtsArrowStyle
  arrows: NtsArrowShape[]
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
  /** The norm draws the shape the clinician observed; there is no channel. */
  | 'needs_clinician_shape'
  /** The norm anchors the mark to anatomy the chart does not model. */
  | 'needs_fissure_anatomy'
  /** The direction is a clinical observation the norm leaves unenumerated. */
  | 'needs_clinical_direction'
  | 'unknown_line_style'
  | 'unknown_connector_style'
  | 'unknown_arrow_style'
  | 'unknown_arrow_direction'
  | 'no_targets'
  | 'unknown_fill_style'
  | 'unknown_outline_style'
  /** The mark says which attribute supplies its regions; the mark has none. */
  | 'missing_region_source'
  /** The bound attribute is there but is not a set of codes. */
  | 'invalid_region_source'
  /** The codes are well formed and name no geometry on this tooth. */
  | 'unresolved_regions'
  /** The mark is anchored to a landmark this chart does not model. */
  | 'unknown_landmark'
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

export type NtsFillStyle = 'solid'
export type NtsOutlineStyle = 'contour'

/**
 * One continuous figure on one tooth, already in chart coordinates.
 *
 * `polygons` is what gets filled and `boundary` is what gets stroked, and the
 * two are **not** interchangeable: the boundary has had every edge shared
 * between two polygons removed, which is what makes a merged area read as one
 * figure instead of a grid of tiles.
 *
 * Both are arrays of closed rings, and `boundary` legitimately holds more than
 * one: a figure that encloses an unaffected area has a rim *and* holes, wound
 * against each other. Drawing only the first ring would quietly fill in a hole
 * and claim an area nobody recorded, so a consumer must emit all of them —
 * together, in one path, so the winding still relates them.
 */
export interface NtsAreaFigure {
  polygons: NtsPoint[][]
  boundary: NtsPoint[][]
}

/**
 * An area the finding covers, painted solid.
 *
 * The geometry arrives resolved. This module does not know which part of a
 * crown a surface code means, and the layer below knows even less — it is
 * handed rings and fills them.
 */
export interface NtsShapeFillInstruction extends NtsInstructionBase {
  kind: 'shape_fill'
  /** Narrowed: nothing is drawn without a colour. */
  paint: NtsPaint
  style: NtsFillStyle
  fdi: number
  components: NtsAreaFigure[]
  /**
   * The geometry ids the figures were built from, for traceability and for
   * spotting two findings that cover the same ground. Positional ids from the
   * drawing, never a clinical code.
   */
  regions: string[]
}

/** The same area, contoured instead of filled. */
export interface NtsOutlineInstruction extends NtsInstructionBase {
  kind: 'outline'
  paint: NtsPaint
  style: NtsOutlineStyle
  fdi: number
  components: NtsAreaFigure[]
  regions: string[]
}

export type NtsRenderInstruction =
  | NtsTextInstruction
  | NtsSymbolInstruction
  | NtsLineInstruction
  | NtsConnectorInstruction
  | NtsArrowInstruction
  | NtsShapeFillInstruction
  | NtsOutlineInstruction
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

/**
 * Two or more findings covering the same ground on one tooth.
 *
 * Not a clinical judgement and not an error: a lesion and the restoration that
 * treats it legitimately occupy the same surface, and the chart draws both.
 * What it costs is legibility — whichever is painted second sits on top — and
 * that is worth saying out loud, outside the drawing.
 *
 * `silent` is the case that actually loses information: a finding whose only
 * representation is the area itself, with no sigla in the annotation box to
 * fall back on, can be completely hidden by whatever is drawn over it.
 */
export interface NtsAreaOverlap {
  fdi: number
  /** The findings sharing a region. Two or more, in the record's own order. */
  findingIds: string[]
  /** The geometry ids they have in common. Never empty. */
  regions: string[]
  /** True when at least one of them writes no sigla anywhere. */
  silent: boolean
}

export interface NtsChartRender {
  findings: NtsFindingRender[]
  /** Everything drawable, in painting order. */
  instructions: NtsRenderInstruction[]
  overflows: NtsBoxOverflow[]
  /** Reported alongside the chart, never drawn on it. */
  overlaps: NtsAreaOverlap[]
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
  /** Which attribute supplies the regions an area mark covers. */
  regions_from: string | null
}

function marksOf(rule: NtsRule): CatalogMark[] {
  const render = rule.render as { marks?: unknown[] } | undefined
  return ((render?.marks ?? []) as CatalogMark[]).map(mark => ({
    kind: mark.kind,
    params: mark.params ?? {},
    text_from: mark.text_from ?? null,
    suffix_from: mark.suffix_from ?? null,
    role: mark.role ?? null,
    target_selector: mark.target_selector ?? null,
    regions_from: mark.regions_from ?? null
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
// placement tokens
// ---------------------------------------------------------------------------
//
// The catalog and the geometry module name bands differently, on purpose: the
// catalog speaks the norm's language ("a nivel de los ápices") and the geometry
// speaks the chart's. The translation is one explicit table, not a guess, and
// it is the *only* place the two vocabularies meet.
//
// `geometry_input.constraints` is deliberately absent from all of this.
// NTS-05D.3a settled that it cannot place a mark: it is declared once per rule
// while marks are many, and at least one rule declares two areas for two
// different marks.

/** Catalog placement token → the band the geometry module knows. */
const BAND_FOR_TOKEN: Readonly<Record<string, NtsLevel>> = {
  apex_level: 'apex',
  over_crowns: 'crown'
}

/**
 * Distance a mark sits clear of the band it is anchored outside of.
 *
 * Chart units, like everything else here: the coordinate space is derived from
 * the dentition and never from a viewport, so this is the same number at every
 * screen width and in print.
 */
const OUTSIDE_MARGIN = 5

/** Gap between the two strokes of a parallel pair. */
const PARALLEL_GAP = 3

/** Zigzag geometry, in chart units. */
const ZIGZAG_AMPLITUDE = 3
const ZIGZAG_WAVELENGTH = 11

/** Length of an arrow's shaft. */
const ARROW_LENGTH = 13

/**
 * Length of a tick dropped from a band onto a target.
 *
 * The norm draws these as short strokes and states no length, so this is a
 * presentation choice like stroke width. It is a constant rather than "down to
 * that tooth's apex" for a concrete reason: the band is already the *extreme*
 * apex of the row, so a tooth whose own apex sits near it would get a tick a
 * fraction of a pixel long and effectively vanish.
 */
const TICK_LENGTH = 7

// ---------------------------------------------------------------------------
// spans
// ---------------------------------------------------------------------------

/**
 * The subject targets, grouped as the record stores them.
 *
 * One span per `group_index`. The editor produces a single group today, so
 * this changes nothing now — but the norm's own figure draws two disjoint
 * stretches for one appliance, and when the persistence gap closes the
 * renderer already knows what to do with the second group. It never invents a
 * group that is not there.
 */
function subjectGroups(finding: NtsFinding): number[][] {
  const groups = new Map<number, number[]>()
  for (const target of subjects(finding)) {
    if (target.tooth_number === null) continue
    const bucket = groups.get(target.group_index)
    if (bucket) bucket.push(target.tooth_number)
    else groups.set(target.group_index, [target.tooth_number])
  }
  return [...groups.entries()].sort((a, b) => a[0] - b[0]).map(([, teeth]) => teeth)
}

function archesOf(finding: NtsFinding): string[] {
  return subjects(finding)
    .filter(target => target.target_kind === 'arch' && target.arch !== null)
    .map(target => target.arch!)
}

/**
 * Every span this finding covers at the given band.
 *
 * An arch-scoped finding spans the permanent row of each arch it names — the
 * policy the 05D.0 audit settled, since the norm draws one 16-tooth arch and
 * stretching the mark over the nested deciduous row would assert something
 * about those teeth that the norm does not.
 */
function spansFor(finding: NtsFinding, level: NtsLevel): NtsSpan[] {
  const arches = archesOf(finding)
  if (arches.length > 0) {
    return arches
      .map(arch => archSpan(arch as 'upper' | 'lower', level))
      .filter((span): span is NtsSpan => span !== null)
  }
  return subjectGroups(finding)
    .map(teeth => rangeSpan(teeth, level))
    .filter((span): span is NtsSpan => span !== null)
}

// ---------------------------------------------------------------------------
// stroke builders
// ---------------------------------------------------------------------------

function horizontal(span: NtsSpan, y: number): NtsPoint[] {
  return [{ x: span.x1, y }, { x: span.x2, y }]
}

/**
 * A zigzag across the span, deterministic for a given width.
 *
 * The number of teeth is computed from the span rather than fixed, so a
 * removable appliance over a whole arch and one over half of it have the same
 * tooth size instead of the same tooth count.
 */
function zigzagPoints(span: NtsSpan, y: number): NtsPoint[] {
  const width = span.x2 - span.x1
  const teeth = Math.max(2, Math.round(width / ZIGZAG_WAVELENGTH))
  const step = width / teeth
  const points: NtsPoint[] = []
  for (let i = 0; i <= teeth; i++) {
    points.push({
      x: span.x1 + step * i,
      y: i % 2 === 0 ? y - ZIGZAG_AMPLITUDE : y + ZIGZAG_AMPLITUDE
    })
  }
  return points
}

// ---------------------------------------------------------------------------
// line
// ---------------------------------------------------------------------------

const LINE_STYLES: ReadonlySet<string> = new Set<NtsLineStyle>([
  'straight_horizontal',
  'straight_vertical',
  'two_parallel_horizontal',
  'zigzag'
])

/**
 * Styles the norm words as "the shape the clinician observed".
 *
 * They are named here so the deferral carries the real reason rather than
 * "unknown style": the catalog declares them properly, what is missing is a
 * channel to store a drawn shape (G6) and a model of fissure anatomy (G10).
 */
const FREEHAND_LINE_STYLES: Readonly<Record<string, NtsUnsupportedReason>> = {
  fracture_trace: 'needs_clinician_shape',
  sealant_path: 'needs_fissure_anatomy'
}

function resolveLine(
  mark: CatalogMark,
  finding: NtsFinding,
  base: DrawableBase
): NtsRenderInstruction[] {
  const fail = (reason: NtsUnsupportedReason): NtsRenderInstruction[] => [
    { ...base, kind: 'unsupported', layer: NTS_LAYERS.line, reason, markKind: mark.kind }
  ]

  const style = mark.params.style
  if (style && style in FREEHAND_LINE_STYLES) return fail(FREEHAND_LINE_STYLES[style]!)
  if (!style || !LINE_STYLES.has(style)) return fail('unknown_line_style')

  // A vertical line belongs to one tooth, not to a span: the norm draws it
  // down the tooth's own axis.
  if (style === 'straight_vertical') return verticalLines(mark, finding, base)

  const token = mark.params.at
  const level = token === undefined ? undefined : BAND_FOR_TOKEN[token]
  if (level === undefined) return fail('unknown_placement')

  const spans = spansFor(finding, level)
  if (spans.length === 0) return fail('no_targets')

  const strokes: NtsPoint[][] = []
  for (const span of spans) {
    if (style === 'zigzag') {
      strokes.push(zigzagPoints(span, span.y))
    } else if (style === 'two_parallel_horizontal') {
      strokes.push(horizontal(span, span.y - PARALLEL_GAP / 2))
      strokes.push(horizontal(span, span.y + PARALLEL_GAP / 2))
    } else {
      strokes.push(horizontal(span, span.y))
    }
  }

  return [{
    ...base,
    kind: 'line',
    layer: NTS_LAYERS.line,
    style: style as NtsLineStyle,
    strokes
  }]
}

/**
 * The vertical line down a tooth.
 *
 * **One line per tooth, on its centre axis** — settled from the norm's own
 * figures, magnified: p.19 draws a two-rooted deciduous molar with a single
 * line running *between* its roots, and p.9 draws a three-rooted molar with
 * one line. `rootAxes` exists and is deliberately not used here: it is a
 * geometric capability, not an instruction to repeat the mark per root.
 */
function verticalLines(
  mark: CatalogMark,
  finding: NtsFinding,
  base: DrawableBase
): NtsRenderInstruction[] {
  const strokes: NtsPoint[][] = []

  for (const fdi of numberedSubjects(finding)) {
    const placement = toothPlacement(fdi)
    const apex = apexPoint(fdi)
    if (!placement || !apex) continue
    const crown = placement.crown
    const from = crown.y + crown.height / 2
    strokes.push([{ x: placement.center.x, y: from }, { x: placement.center.x, y: apex.y }])
  }

  if (strokes.length === 0) {
    return [{
      ...base,
      kind: 'unsupported',
      layer: NTS_LAYERS.line,
      reason: 'tooth_not_on_chart',
      markKind: mark.kind
    }]
  }

  return [{
    ...base,
    kind: 'line',
    layer: NTS_LAYERS.line,
    style: 'straight_vertical',
    strokes
  }]
}

// ---------------------------------------------------------------------------
// connector
// ---------------------------------------------------------------------------

function resolveConnector(
  mark: CatalogMark,
  finding: NtsFinding,
  base: DrawableBase
): NtsRenderInstruction[] {
  const fail = (reason: NtsUnsupportedReason): NtsRenderInstruction[] => [
    { ...base, kind: 'unsupported', layer: NTS_LAYERS.line, reason, markKind: mark.kind }
  ]

  const style = mark.params.style
  const token = mark.params.at
  const level = token === undefined ? undefined : BAND_FOR_TOKEN[token]
  if (level === undefined) return fail('unknown_placement')

  const spans = spansFor(finding, level)
  if (spans.length === 0) return fail('no_targets')

  if (style === 'straight_line') {
    // Joins the marks at the extremes of the span, which is the span itself.
    return [{
      ...base,
      kind: 'connector',
      layer: NTS_LAYERS.line,
      style: 'straight_line',
      strokes: spans.map(span => horizontal(span, span.y))
    }]
  }

  if (style === 'vertical_marks') {
    // Dropped onto the targets carrying the mark's role, and onto no others.
    // The norm names a role for these and never equates it with the extremes
    // of the span; the figure it prints merely happens to have them coincide.
    // So the role is read off the targets, never inferred from position — and
    // a span with no target carrying it gets the horizontal alone.
    const strokes: NtsPoint[][] = []
    const band = spans[0]!.y

    for (const target of subjects(finding)) {
      if (mark.role === null || target.role !== mark.role) continue
      if (target.tooth_number === null) continue
      const placement = toothPlacement(target.tooth_number)
      const toward = occlusalDirection(target.tooth_number)
      if (!placement || toward === null) continue
      // Dropped from the band onto the tooth. The teeth lie on the biting side
      // of an apex band, so the tick follows the same sense as the arch's
      // occlusal direction and is mirrored between upper and lower without
      // either being named.
      strokes.push([
        { x: placement.center.x, y: band },
        { x: placement.center.x, y: band + TICK_LENGTH * toward }
      ])
    }

    return [{
      ...base,
      kind: 'connector',
      layer: NTS_LAYERS.line,
      style: 'vertical_marks',
      strokes
    }]
  }

  return fail('unknown_connector_style')
}

// ---------------------------------------------------------------------------
// arrow
// ---------------------------------------------------------------------------

/**
 * Which way an arrow points, on the screen.
 *
 * Never stored, always derived: `toward` says what the arrow means relative to
 * the tooth, and the arch says which way that is. An upper and a lower tooth
 * with the same finding point opposite ways, and neither the catalog nor the
 * clinician is asked about it.
 *
 * `occlusalDirection` is +1 when a tooth's biting edge faces down the screen.
 */
function arrowDirection(toward: string | undefined, fdi: number): number | null {
  const occlusal = occlusalDirection(fdi)
  if (occlusal === null) return null
  switch (toward) {
    // "en sentido externo": out of the arch, away from the tooth.
    case 'outward':
      return occlusal
    // Toward the tooth's own incisal/occlusal zone: inward.
    case 'incisal_occlusal':
      return -occlusal
    // Toward the occlusal plane, drawn over the figure.
    case 'occlusal_plane':
      return occlusal
    default:
      return null
  }
}

function resolveArrow(
  mark: CatalogMark,
  finding: NtsFinding,
  base: DrawableBase
): NtsRenderInstruction[] {
  const fail = (reason: NtsUnsupportedReason): NtsRenderInstruction[] => [
    { ...base, kind: 'unsupported', layer: NTS_LAYERS.arrow, reason, markKind: mark.kind }
  ]

  const style = mark.params.style
  const at = mark.params.at
  const teeth = numberedSubjects(finding)

  if (style === 'two_crossed_curved') return crossedArrows(mark, teeth, base, at)

  if (style !== 'zigzag' && style !== 'straight_vertical') {
    // A curved arrow follows "el sentido de la giroversión" — an observed
    // datum the norm never enumerates. Its placement is known; its direction
    // is a clinical fact nobody has recorded in a form this can read, and
    // guessing one would draw a rotation that may not exist.
    return fail(style === 'curved' ? 'needs_clinical_direction' : 'unknown_arrow_style')
  }

  const fdi = teeth[0]
  if (fdi === undefined) return fail('no_targets')
  const placement = toothPlacement(fdi)
  if (!placement) return fail('tooth_not_on_chart')

  const direction = arrowDirection(mark.params.toward, fdi)
  if (direction === null) return fail('unknown_arrow_direction')

  const x = placement.center.x
  const crown = placement.crown
  let tail: number
  let tip: number

  if (at === 'on_figure') {
    // Over the tooth itself: the norm draws this one "sobre la gráfica".
    tail = direction > 0 ? crown.y - ARROW_LENGTH / 2 : crown.y + crown.height + ARROW_LENGTH / 2
    tip = direction > 0 ? crown.y + crown.height : crown.y
  } else if (at === 'outside_occlusal') {
    const band = occlusalBand(placement.row as NtsRowId)
    if (band === null) return fail('unknown_placement')
    // Clear of the biting edge, on that side. An outward arrow runs away from
    // the band; an inward one runs back toward it.
    const near = band + OUTSIDE_MARGIN * occlusalDirection(fdi)!
    const far = near + ARROW_LENGTH * occlusalDirection(fdi)!
    const outward = direction === occlusalDirection(fdi)
    tail = outward ? near : far
    tip = outward ? far : near
  } else {
    return fail('unknown_placement')
  }

  return [{
    ...base,
    kind: 'arrow',
    layer: NTS_LAYERS.arrow,
    style: style as NtsArrowStyle,
    arrows: [{
      points: style === 'zigzag'
        ? zigzagSpine(x, tail, tip)
        : [{ x, y: tail }, { x, y: tip }],
      curved: false
    }]
  }]
}

/** A zigzag running vertically from tail to tip. */
function zigzagSpine(x: number, tail: number, tip: number): NtsPoint[] {
  const steps = 4
  const dy = (tip - tail) / steps
  const points: NtsPoint[] = []
  for (let i = 0; i <= steps; i++) {
    points.push({
      x: i === steps ? x : x + (i % 2 === 0 ? -ZIGZAG_AMPLITUDE : ZIGZAG_AMPLITUDE),
      y: tail + dy * i
    })
  }
  return points
}

/**
 * Two curved arrows crossing between the tooth numbers.
 *
 * Symmetric by construction: one runs left to right and the other right to
 * left, each bowing to the opposite side. Which target the record happens to
 * list first therefore changes nothing about the drawing.
 */
function crossedArrows(
  mark: CatalogMark,
  teeth: number[],
  base: DrawableBase,
  at: string | undefined
): NtsRenderInstruction[] {
  const fail = (reason: NtsUnsupportedReason): NtsRenderInstruction[] => [
    { ...base, kind: 'unsupported', layer: NTS_LAYERS.arrow, reason, markKind: mark.kind }
  ]

  if (at !== 'tooth_numbers') return fail('unknown_placement')
  if (teeth.length !== 2) return fail('wrong_target_count')

  const anchors = teeth.map(numberAnchor)
  if (anchors.some(point => point === null)) return fail('tooth_not_on_chart')

  // Ordered by position on the chart, so the pair is drawn the same way round
  // whichever order the targets arrive in.
  const [left, right] = (anchors as NtsPoint[]).slice().sort((a, b) => a.x - b.x) as [NtsPoint, NtsPoint]
  const midX = (left.x + right.x) / 2
  const y = (left.y + right.y) / 2
  const bow = Math.max(6, (right.x - left.x) / 3)

  return [{
    ...base,
    kind: 'arrow',
    layer: NTS_LAYERS.arrow,
    style: 'two_crossed_curved',
    arrows: [
      { points: [left, { x: midX, y: y - bow }, right], curved: true },
      { points: [right, { x: midX, y: y + bow }, left], curved: true }
    ]
  }]
}

// ---------------------------------------------------------------------------
// one finding
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// areas: shape_fill and outline
// ---------------------------------------------------------------------------

/**
 * The closed style vocabularies, each of which currently has one member.
 *
 * The catalog makes these params optional — only an arrow is required to carry
 * its own — so a mark may legitimately declare none, and one area mark in this
 * norm does. Falling back to the single declared style is therefore reading
 * the contract rather than guessing: with one value in the vocabulary there is
 * nothing else the mark could have meant.
 *
 * That stops being true the moment a second style exists, so a test pins the
 * size of both sets. If one grows, the fallback has to become an explicit
 * default in the catalog before this can keep working.
 */
const FILL_STYLES: ReadonlySet<string> = new Set<NtsFillStyle>(['solid'])
const OUTLINE_STYLES: ReadonlySet<string> = new Set<NtsOutlineStyle>(['contour'])

function soleStyle(styles: ReadonlySet<string>): string | null {
  return styles.size === 1 ? [...styles][0]! : null
}

/**
 * Landmarks a mark can be anchored to, each resolved to the rings it covers.
 *
 * A landmark is anatomy, not a surface. The rings come from the drawing's own
 * tiles and are read through the dentition's neutral accessor, so a mark
 * anchored inside the crown can never inherit the shape a *surface* would have
 * had there — which on a front tooth is a materially different polygon.
 *
 * Keyed by the token the catalog declares, so adding one is catalog work plus
 * a line here, never a branch on which rule is being drawn.
 */
const LANDMARK_RINGS: Readonly<Record<string, (tooth: NtsTooth) => NtsPoint[][]>> = {
  coronal_pulp: tooth => centralRegionsOf(tooth).map(region => region.points)
}

interface ResolvedArea {
  components: NtsAreaFigure[]
  regions: string[]
}

/**
 * The regions a mark covers on one tooth, read strictly through its binding.
 *
 * Never `finding.attributes.surfaces`: the attribute happens to be called that
 * in every rule this norm has, and a renderer that hardcoded the name would be
 * right by accident until a norm named it otherwise. 05D.4a made the binding
 * explicit precisely so this could not drift.
 */
function surfaceArea(
  mark: CatalogMark,
  finding: NtsFinding,
  fdi: number
): ResolvedArea | { reason: NtsUnsupportedReason } {
  const binding = mark.regions_from
  if (!binding) return { reason: 'missing_region_source' }

  const value = finding.attributes[binding]
  if (value === undefined || value === null) return { reason: 'missing_attribute_value' }

  // A set of codes, and nothing else. The record model refuses a bare string
  // for a multi-valued attribute, so one arriving here is foreign or damaged
  // data — and guessing that it meant a set of one would be inventing part of
  // a clinical finding.
  if (!Array.isArray(value) || value.length === 0) return { reason: 'invalid_region_source' }
  if (value.some(code => typeof code !== 'string')) return { reason: 'invalid_region_source' }

  const codes = value as string[]
  const regions = resolveSurfaceRegions(fdi, codes)
  const components = resolveSurfaceComponents(fdi, codes)
  // Well-formed codes that name nothing drawable — every one unrecognised.
  // Reported rather than drawn as an empty area, which would look like a
  // finding with no lesion.
  if (components.length === 0) return { reason: 'unresolved_regions' }

  return { components, regions: regions.map(region => region.id) }
}

/** The rings a landmark-anchored mark covers, merged the same way surfaces are. */
function landmarkArea(
  mark: CatalogMark,
  tooth: NtsTooth
): ResolvedArea | { reason: NtsUnsupportedReason } {
  const at = mark.params.at
  const rings = at ? LANDMARK_RINGS[at] : undefined
  if (!rings) return { reason: at ? 'unknown_landmark' : 'unknown_placement' }

  const figures = mergeRegions(rings(tooth))
  if (figures.length === 0) return { reason: 'unresolved_regions' }
  return { components: figures, regions: centralRegionsOf(tooth).map(region => region.id) }
}

/** Move a figure from a tooth's own units onto the chart. */
function toChart(fdi: number, figure: NtsAreaFigure): NtsAreaFigure | null {
  const move = (rings: NtsPoint[][]): NtsPoint[][] | null => {
    const moved: NtsPoint[][] = []
    for (const ring of rings) {
      const points: NtsPoint[] = []
      for (const point of ring) {
        const placed = localToGlobal(fdi, point)
        if (!placed) return null
        points.push(placed)
      }
      moved.push(points)
    }
    return moved
  }

  const polygons = move(figure.polygons)
  const boundary = move(figure.boundary)
  if (!polygons || !boundary) return null
  return { polygons, boundary }
}

/**
 * `shape_fill` and `outline`: the same geometry, painted two ways.
 *
 * One instruction per tooth, carrying every figure that tooth has. The two
 * kinds differ only in which style token they read, which layer they sit on
 * and whether the layer below fills or strokes them — so they share a resolver
 * rather than drifting apart in two.
 */
function resolveArea(
  mark: CatalogMark,
  finding: NtsFinding,
  base: DrawableBase,
  kind: 'shape_fill' | 'outline'
): NtsRenderInstruction[] {
  const layer = kind === 'shape_fill' ? NTS_LAYERS.fill : NTS_LAYERS.outline
  const fail = (reason: NtsUnsupportedReason): NtsRenderInstruction[] => [{
    ...base,
    kind: 'unsupported',
    layer,
    reason,
    markKind: mark.kind
  }]

  const known = kind === 'shape_fill' ? FILL_STYLES : OUTLINE_STYLES
  const declared = kind === 'shape_fill' ? mark.params.fill : mark.params.style
  const style = declared ?? soleStyle(known)
  if (!style || !known.has(style)) {
    return fail(kind === 'shape_fill' ? 'unknown_fill_style' : 'unknown_outline_style')
  }

  const teeth = numberedSubjects(finding)
  if (teeth.length === 0) return fail('no_targets')

  const produced: NtsRenderInstruction[] = []
  for (const fdi of teeth) {
    const tooth = toothPlacement(fdi)?.tooth
    if (!tooth) {
      produced.push(...fail('tooth_not_on_chart'))
      continue
    }

    // Exactly one source of geometry, which is the invariant the catalog
    // enforces: a declared attribute, or a declared landmark.
    const area = mark.regions_from
      ? surfaceArea(mark, finding, fdi)
      : landmarkArea(mark, tooth)
    if ('reason' in area) {
      produced.push(...fail(area.reason))
      continue
    }

    const components = area.components.map(figure => toChart(fdi, figure))
    if (components.some(figure => figure === null)) {
      produced.push(...fail('tooth_not_on_chart'))
      continue
    }

    produced.push({
      ...base,
      kind,
      layer,
      style: style as NtsFillStyle & NtsOutlineStyle,
      fdi,
      components: components as NtsAreaFigure[],
      regions: area.regions
    })
  }

  return produced
}

/**
 * Mark kinds this slice can draw — which, as of 05D.4, is all of them.
 *
 * The set stays because it is what makes an unrecognised kind report itself
 * instead of falling through to whichever resolver happens to be last.
 */
const DRAWABLE_KINDS: ReadonlySet<string> = new Set([
  'box_siglas',
  'symbol',
  'line',
  'connector',
  'arrow',
  'shape_fill',
  'outline'
])

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

    // One mark can become several instructions: a pair of endpoint symbols,
    // a vertical tick per role-bearing target, a stroke per segment of a span.
    const drawable = { ...base, paint }
    const produced =
      mark.kind === 'box_siglas' ? [resolveBox(mark, rule, finding, drawable)]
        : mark.kind === 'symbol' ? resolveSymbol(mark, rule, finding, drawable)
          : mark.kind === 'line' ? resolveLine(mark, finding, drawable)
            : mark.kind === 'connector' ? resolveConnector(mark, finding, drawable)
              : mark.kind === 'shape_fill' ? resolveArea(mark, finding, drawable, 'shape_fill')
                : mark.kind === 'outline' ? resolveArea(mark, finding, drawable, 'outline')
                  : resolveArrow(mark, finding, drawable)

    instructions.push(...produced)
    if (produced.some(instruction => instruction.kind !== 'unsupported')) drawn += 1
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
): NtsRenderInstruction[] {
  const shape = mark.params.shape
  const fail = (reason: NtsUnsupportedReason): NtsRenderInstruction[] => [{
    ...base,
    kind: 'unsupported',
    layer: NTS_LAYERS.symbol,
    reason,
    markKind: mark.kind
  }]

  if (!shape || !KNOWN_SHAPES.has(shape)) return fail('unknown_symbol_shape')

  let enclosedText: string | undefined
  if (mark.text_from) {
    const resolved = textFor(rule, finding, mark.text_from)
    if ('reason' in resolved) return fail(resolved.reason)
    enclosedText = resolved.text
  }

  const emit = (placed: Placed): NtsSymbolInstruction => ({
    ...base,
    kind: 'symbol',
    layer: NTS_LAYERS.symbol,
    shape: shape as NtsSymbolShape,
    at: placed.at,
    bounds: placed.bounds,
    ...(enclosedText === undefined ? {} : { enclosedText })
  })

  // A mark that applies to a subset of the targets: one symbol per selected
  // target, placed at the band the mark declares. The two questions are read
  // from two fields, which is what NTS-05D.3a separated them for.
  if (mark.target_selector !== null) {
    return resolveSelectedSymbols(mark, finding, base, emit, fail)
  }

  const placed = placeSymbol(shape as NtsSymbolShape, mark.params.at, finding)
  if ('reason' in placed) return fail(placed.reason)
  return [emit(placed)]
}

/**
 * Symbols drawn on a chosen subset of the finding's targets.
 *
 * The extremes are taken **in row order**, never by FDI number: 11 and 21 are
 * neighbours on the chart and ten apart numerically, so sorting by number
 * would invert every span that crosses the midline. `rangeSpan` already orders
 * by position, so the endpoints fall out of the span it returns.
 */
function resolveSelectedSymbols(
  mark: CatalogMark,
  finding: NtsFinding,
  base: DrawableBase,
  emit: (placed: Placed) => NtsSymbolInstruction,
  fail: (reason: NtsUnsupportedReason) => NtsRenderInstruction[]
): NtsRenderInstruction[] {
  if (mark.target_selector !== 'range_endpoints') return fail('unknown_placement')

  const token = mark.params.at
  const level = token === undefined ? undefined : BAND_FOR_TOKEN[token]
  if (level === undefined) return fail('unknown_placement')

  const instructions: NtsSymbolInstruction[] = []
  for (const teeth of subjectGroups(finding)) {
    const span = rangeSpan(teeth, level)
    if (!span || teeth.length === 0) continue
    const ordered = orderedByColumn(teeth)
    const ends = ordered.length === 1 ? [ordered[0]!] : [ordered[0]!, ordered[ordered.length - 1]!]

    for (const fdi of ends) {
      const placement = toothPlacement(fdi)
      if (!placement) continue
      const point = { x: placement.center.x, y: span.y }
      instructions.push(emit({ at: point, bounds: squareAround(point, placement.crown, 0.35) }))
    }
  }

  return instructions.length > 0 ? instructions : fail('no_targets')
}

/** Teeth sorted by where they sit on the chart, not by their number. */
function orderedByColumn(teeth: readonly number[]): number[] {
  return teeth
    .map(fdi => ({ fdi, placement: toothPlacement(fdi) }))
    .filter(entry => entry.placement !== null)
    .sort((a, b) => a.placement!.index - b.placement!.index)
    .map(entry => entry.fdi)
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
  const overlaps = findOverlaps(instructions)

  return {
    findings: resolved,
    // Stable sort, so findings that share a layer keep the record's own order
    // and the chart paints the same way twice.
    instructions: instructions.sort((a, b) => a.layer - b.layer),
    overflows,
    overlaps,
    partial: resolved.filter(r => r.completeness === 'partial').map(r => r.findingId),
    unsupported: resolved.filter(r => r.completeness === 'unsupported').map(r => r.findingId)
  }
}

/**
 * Findings whose areas land on the same region of the same tooth.
 *
 * Compared by the geometry ids the instructions already carry rather than by
 * intersecting polygons: the ids are what the regions *are*, so two findings
 * naming the same one cover the same ground exactly, with no tolerance to pick
 * and no arithmetic to get wrong.
 *
 * Changes nothing about the drawing. Both findings keep every instruction they
 * had, in the order they were recorded.
 */
function findOverlaps(instructions: readonly NtsRenderInstruction[]): NtsAreaOverlap[] {
  const writesSigla = new Set(
    instructions.filter(i => i.kind === 'text').map(i => i.findingId)
  )

  // fdi → region id → the findings that claimed it, in arrival order.
  const claims = new Map<number, Map<string, string[]>>()
  for (const instruction of instructions) {
    if (instruction.kind !== 'shape_fill' && instruction.kind !== 'outline') continue
    const perTooth = claims.get(instruction.fdi) ?? new Map<string, string[]>()
    claims.set(instruction.fdi, perTooth)
    for (const region of instruction.regions) {
      const holders = perTooth.get(region) ?? []
      if (!holders.includes(instruction.findingId)) holders.push(instruction.findingId)
      perTooth.set(region, holders)
    }
  }

  const overlaps: NtsAreaOverlap[] = []
  for (const [fdi, perTooth] of claims) {
    // One entry per set of findings, listing every region they share, so two
    // findings covering four regions are reported once and not four times.
    const byGroup = new Map<string, string[]>()
    for (const [region, holders] of perTooth) {
      if (holders.length < 2) continue
      const groupKey = holders.join(' ')
      const regions = byGroup.get(groupKey) ?? []
      regions.push(region)
      byGroup.set(groupKey, regions)
    }
    for (const [groupKey, regions] of byGroup) {
      const findingIds = groupKey.split(' ')
      overlaps.push({
        fdi,
        findingIds,
        regions: regions.sort(),
        silent: findingIds.some(id => !writesSigla.has(id))
      })
    }
  }

  return overlaps.sort((a, b) => a.fdi - b.fdi || (a.findingIds[0]! < b.findingIds[0]! ? -1 : 1))
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
