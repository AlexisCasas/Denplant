/**
 * NTS N.° 188 chart geometry — one coordinate space for the whole odontogram.
 *
 * `ntsDentition.ts` describes **one tooth**: its crown, its regions and its
 * roots, in layout units inside its own viewBox. That is everything 05B needed,
 * because 05B draws 52 independent little drawings side by side.
 *
 * It is not enough for anything that spans teeth. A bridge runs from 13 to 23,
 * a removable appliance crosses a whole arch, a diastema sits *between* two
 * crowns and a supernumerary tooth sits between two apices. None of those can
 * be expressed while every tooth is its own viewBox with no shared origin.
 *
 * This module supplies the missing origin. It answers, for any FDI number,
 * where that tooth's parts land on **one** chart-wide canvas, and it derives
 * the bands and spans the norm anchors marks to.
 *
 * Three rules it keeps:
 *
 * * **Pure.** No Vue, no DOM, no `getBoundingClientRect`, no `querySelector`.
 *   The same input always yields the same coordinates, which is what lets the
 *   chart print exactly as it renders.
 * * **Derived.** Nothing here is measured or stored. Every number comes from
 *   the dentition constants and the layout constants below.
 *   Viewport-independent: CSS scales and scrolls the result, the clinical
 *   geometry never changes.
 * * **Structural only.** No clinical vocabulary, no colours, no marks. This
 *   module says *where*; a later ticket says *what*.
 *
 * ## Why the numbers below are px, not layout units
 *
 * The chart is an HTML/flex layout with an SVG per tooth. The cell stack is
 * built from CSS lengths — a 40px annotation box, a 20px number line — while
 * the tooth itself is drawn in layout units scaled by {@link NTS_CHART_SCALE}.
 * A coordinate space that only knew layout units could not place the
 * annotation box at all. So the shared space is **CSS pixels of the rendered
 * chart**, and layout units are converted on the way in.
 */

import type { NtsArch, NtsTooth } from './ntsDentition'
import {
  NTS_ALL_TEETH,
  NTS_BLEED,
  NTS_CELL_HEIGHT,
  NTS_ROWS,
  cellWidthFor,
  rowWidthFor,
  toothGeometry
} from './ntsDentition'

export type NtsRowId = (typeof NTS_ROWS)[number]['id']

export interface NtsPoint {
  x: number
  y: number
}

export interface NtsBox {
  x: number
  y: number
  width: number
  height: number
}

/**
 * The bands a mark can be anchored to, named the way the norm names them.
 *
 * `annotation` is the printed box that holds siglas; `number` the FDI label;
 * `crown` and `apex` the two ends of the tooth; `occlusal` the strip just
 * outside the biting edge, which is where the norm places the marks it words
 * as drawn "fuera del gráfico".
 */
export type NtsLevel = 'annotation' | 'number' | 'crown' | 'apex' | 'occlusal'

// ---------------------------------------------------------------------------
// layout constants
// ---------------------------------------------------------------------------

/**
 * Pixels per layout unit. The single source; `NtsOdontogramChart` imports it.
 *
 * One scale for the whole chart, deciduous rows included — the annex draws a
 * deciduous molar the size of a permanent one.
 */
export const NTS_CHART_SCALE = 0.484

/**
 * The CSS lengths the cell stack is built from.
 *
 * These mirror Tailwind utilities in `NtsToothCell` and `NtsOdontogramChart`
 * (`h-10`, `leading-5`, `py-2`, `space-y-1`, `pt-3`). They are declared here
 * because geometry needs them as numbers and a class name is not a number.
 *
 * The correspondence is not left to trust: `ntsChartGeometry.spec.ts` asserts
 * that each component still carries the matching utility, so changing one
 * without the other fails a test rather than silently shifting every anchor.
 */
const ANNOTATION_HEIGHT = 40
const NUMBER_HEIGHT = 20
const CANVAS_PADDING_Y = 8
const ROW_GAP = 4
const ROW_TOP_PADDING = 12

/** The rows the annex separates from the one above with extra space. */
const PADDED_ROWS: ReadonlySet<string> = new Set(['deciduousUpper', 'permanentLower'])

/** Height of one tooth's `<svg>` element, identical for every class. */
const SVG_HEIGHT = NTS_CELL_HEIGHT * NTS_CHART_SCALE

/** Height of a whole cell: box, number and tooth, in either arch order. */
const CELL_HEIGHT = ANNOTATION_HEIGHT + NUMBER_HEIGHT + SVG_HEIGHT

// ---------------------------------------------------------------------------
// global dimensions
// ---------------------------------------------------------------------------

const ROW_WIDTHS: readonly number[] = NTS_ROWS.map(row => rowWidthFor(row.teeth) * NTS_CHART_SCALE)

/**
 * Width of the coordinate space: the widest row.
 *
 * Rounded because the canvas publishes it as a CSS `min-width` and a
 * fractional one would round differently in different browsers. The narrower
 * rows are centred inside it, which is how the deciduous arches end up nested
 * within the permanent ones.
 */
export const NTS_CHART_WIDTH = Math.round(Math.max(...ROW_WIDTHS))

/** Vertical offset of each row's border box, in order. */
const ROW_TOPS: readonly number[] = NTS_ROWS.map((_, index) => {
  let y = CANVAS_PADDING_Y
  for (let i = 0; i < index; i++) {
    y += (PADDED_ROWS.has(NTS_ROWS[i]!.id) ? ROW_TOP_PADDING : 0) + CELL_HEIGHT + ROW_GAP
  }
  return y
})

/** Height of the coordinate space: four rows, their gaps and the padding. */
export const NTS_CHART_HEIGHT =
  ROW_TOPS[ROW_TOPS.length - 1]! +
  (PADDED_ROWS.has(NTS_ROWS[NTS_ROWS.length - 1]!.id) ? ROW_TOP_PADDING : 0) +
  CELL_HEIGHT +
  CANVAS_PADDING_Y

/**
 * The viewBox an overlay must use to sit exactly on the chart.
 *
 * Deterministic and viewport-independent by construction: no term in it comes
 * from a measurement.
 */
export const NTS_CHART_VIEWBOX = `0 0 ${NTS_CHART_WIDTH} ${NTS_CHART_HEIGHT}`

// ---------------------------------------------------------------------------
// per-tooth placement
// ---------------------------------------------------------------------------

export interface NtsRootAxis {
  /** Where the root meets the crown. */
  base: NtsPoint
  /** The apex. */
  tip: NtsPoint
}

export interface NtsToothPlacement {
  fdi: number
  tooth: NtsTooth
  row: NtsRowId
  arch: NtsArch
  /** Position within the row, left to right as drawn. */
  index: number
  /** The whole column: annotation box, number and tooth. */
  cell: NtsBox
  /** Just the `<svg>` element. */
  svg: NtsBox
  /**
   * Pixels per layout unit **for this tooth**.
   *
   * Not the same for every class, and that is not an oversight here: the cell
   * renders its tooth with `preserveAspectRatio="xMidYMid meet"` into a box
   * whose width follows the tooth class, so a wide molar resolves to a
   * slightly larger scale than a narrow incisor. Modelling the real transform
   * is the only way an overlay lands on the drawing rather than near it.
   */
  scale: number
  crown: NtsBox
  annotation: NtsBox
  number: NtsBox
  /** Bounding box of the roots. */
  root: NtsBox
  roots: NtsRootAxis[]
  center: NtsPoint
}

function placementFor(tooth: NtsTooth): NtsToothPlacement {
  const rowIndex = NTS_ROWS.findIndex(row => row.teeth.some(t => t.fdi === tooth.fdi))
  const row = NTS_ROWS[rowIndex]!
  const index = row.teeth.findIndex(t => t.fdi === tooth.fdi)

  // Rows are centred, so a row narrower than the widest one is inset.
  const rowWidth = ROW_WIDTHS[rowIndex]!
  let x = (NTS_CHART_WIDTH - rowWidth) / 2
  for (let i = 0; i < index; i++) x += cellWidthFor(row.teeth[i]!) * NTS_CHART_SCALE

  const width = cellWidthFor(tooth) * NTS_CHART_SCALE
  const contentTop = ROW_TOPS[rowIndex]! + (PADDED_ROWS.has(row.id) ? ROW_TOP_PADDING : 0)
  const isUpper = tooth.arch === 'upper'

  // The cell stacks box → number → tooth going away from the midline, so the
  // order is reversed for the lower arches.
  const annotationY = isUpper ? contentTop : contentTop + SVG_HEIGHT + NUMBER_HEIGHT
  const numberY = isUpper ? contentTop + ANNOTATION_HEIGHT : contentTop + SVG_HEIGHT
  const svgY = isUpper ? contentTop + ANNOTATION_HEIGHT + NUMBER_HEIGHT : contentTop

  // `meet` fits the viewBox inside the element and centres the remainder. The
  // viewBox is wider relative to its height than the element is, so it is the
  // width that binds and the leftover is vertical.
  const units = cellWidthFor(tooth)
  const scale = width / (units + NTS_BLEED * 2)
  const drawnHeight = (NTS_CELL_HEIGHT + NTS_BLEED * 2) * scale
  const offsetY = (SVG_HEIGHT - drawnHeight) / 2

  const local = toothGeometry(tooth)
  const toGlobal = (lx: number, ly: number): NtsPoint => ({
    x: x + (lx + NTS_BLEED) * scale,
    y: svgY + offsetY + (ly + NTS_BLEED) * scale
  })

  const crownTopLeft = toGlobal(local.crown.x, local.crown.y)
  const crown: NtsBox = {
    x: crownTopLeft.x,
    y: crownTopLeft.y,
    width: local.crown.width * scale,
    height: local.crown.height * scale
  }

  const roots: NtsRootAxis[] = local.rootShapes.map(shape => ({
    base: toGlobal(shape.base.x, shape.base.y),
    tip: toGlobal(shape.tip.x, shape.tip.y)
  }))

  const rootLeft = Math.min(...local.rootShapes.map(s => s.left))
  const rootRight = Math.max(...local.rootShapes.map(s => s.right))
  const rootTopLocal = Math.min(...local.rootShapes.flatMap(s => [s.base.y, s.tip.y]))
  const rootBottomLocal = Math.max(...local.rootShapes.flatMap(s => [s.base.y, s.tip.y]))
  const rootTopLeft = toGlobal(rootLeft, rootTopLocal)

  return {
    fdi: tooth.fdi,
    tooth,
    row: row.id,
    arch: tooth.arch,
    index,
    cell: { x, y: contentTop, width, height: CELL_HEIGHT },
    svg: { x, y: svgY, width, height: SVG_HEIGHT },
    scale,
    crown,
    annotation: { x, y: annotationY, width, height: ANNOTATION_HEIGHT },
    number: { x, y: numberY, width, height: NUMBER_HEIGHT },
    root: {
      x: rootTopLeft.x,
      y: rootTopLeft.y,
      width: (rootRight - rootLeft) * scale,
      height: (rootBottomLocal - rootTopLocal) * scale
    },
    roots,
    center: { x: x + width / 2, y: crown.y + crown.height / 2 }
  }
}

/** Every placement, computed once. The layout cannot change at runtime. */
const PLACEMENTS: ReadonlyMap<number, NtsToothPlacement> = new Map(
  NTS_ALL_TEETH.map(tooth => [tooth.fdi, placementFor(tooth)])
)

/** The placement of a tooth, or `null` for an FDI the chart does not draw. */
export function toothPlacement(fdi: number): NtsToothPlacement | null {
  return PLACEMENTS.get(fdi) ?? null
}

export const NTS_PLACEMENTS: readonly NtsToothPlacement[] = [...PLACEMENTS.values()]

/**
 * A point inside a tooth's own drawing, expressed on the chart.
 *
 * This is what lets `toothGeometry` be reused instead of duplicated: a region
 * path, a crown corner or a root apex is authored once in local units and
 * placed here.
 */
export function localToGlobal(fdi: number, point: NtsPoint): NtsPoint | null {
  const placement = PLACEMENTS.get(fdi)
  if (!placement) return null
  return {
    x: placement.svg.x + (point.x + NTS_BLEED) * placement.scale,
    y: placement.svg.y + svgOffsetY(placement) + (point.y + NTS_BLEED) * placement.scale
  }
}

function svgOffsetY(placement: NtsToothPlacement): number {
  return (SVG_HEIGHT - (NTS_CELL_HEIGHT + NTS_BLEED * 2) * placement.scale) / 2
}

// ---------------------------------------------------------------------------
// single-tooth anchors
// ---------------------------------------------------------------------------

export function toothCenter(fdi: number): NtsPoint | null {
  return PLACEMENTS.get(fdi)?.center ?? null
}

export function crownBox(fdi: number): NtsBox | null {
  return PLACEMENTS.get(fdi)?.crown ?? null
}

/** The printed box on the outer side of the row, where letters are written. */
export function annotationBox(fdi: number): NtsBox | null {
  return PLACEMENTS.get(fdi)?.annotation ?? null
}

/** The strip carrying the FDI number; several marks are anchored to it. */
export function numberBox(fdi: number): NtsBox | null {
  return PLACEMENTS.get(fdi)?.number ?? null
}

export function numberAnchor(fdi: number): NtsPoint | null {
  const box = PLACEMENTS.get(fdi)?.number
  return box ? { x: box.x + box.width / 2, y: box.y + box.height / 2 } : null
}

export function rootBox(fdi: number): NtsBox | null {
  return PLACEMENTS.get(fdi)?.root ?? null
}

/** Base and apex of every root this tooth draws. */
export function rootAxes(fdi: number): NtsRootAxis[] {
  return PLACEMENTS.get(fdi)?.roots ?? []
}

/**
 * The apex of the tooth: the tip furthest from the crown.
 *
 * A multi-rooted tooth has several; this is the one that defines how far the
 * tooth reaches, which is what an apex-level mark has to clear.
 */
export function apexPoint(fdi: number): NtsPoint | null {
  const placement = PLACEMENTS.get(fdi)
  if (!placement || placement.roots.length === 0) return null
  const pick = placement.arch === 'upper'
    ? (a: NtsRootAxis, b: NtsRootAxis) => (a.tip.y <= b.tip.y ? a : b)
    : (a: NtsRootAxis, b: NtsRootAxis) => (a.tip.y >= b.tip.y ? a : b)
  return placement.roots.reduce(pick).tip
}

// ---------------------------------------------------------------------------
// bands
// ---------------------------------------------------------------------------

function teethOfRow(row: NtsRowId): NtsToothPlacement[] {
  return NTS_PLACEMENTS.filter(placement => placement.row === row)
}

/**
 * The y a mark drawn "a nivel de los ápices" sits on, for one row.
 *
 * Everything the norm words as drawn "a nivel de los ápices" anchors here. It
 * is the extreme apex of the row, so the mark clears every tooth in it.
 */
export function apexBand(row: NtsRowId): number | null {
  const placements = teethOfRow(row)
  if (placements.length === 0) return null
  const tips = placements.flatMap(p => p.roots.map(r => r.tip.y))
  return placements[0]!.arch === 'upper' ? Math.min(...tips) : Math.max(...tips)
}

/**
 * The y just outside the biting edge of a row.
 *
 * The marks the norm places outside the tooth figure, on the biting side, sit
 * on this band. Which side that is follows from the arch and nothing else: the
 * upper arch bites downward, the lower upward.
 */
export function occlusalBand(row: NtsRowId): number | null {
  const placements = teethOfRow(row)
  if (placements.length === 0) return null
  const edges = placements.map(p => (p.arch === 'upper' ? p.crown.y + p.crown.height : p.crown.y))
  return placements[0]!.arch === 'upper' ? Math.max(...edges) : Math.min(...edges)
}

/** +1 when a tooth's occlusal side points down the screen, -1 when up. */
export function occlusalDirection(fdi: number): 1 | -1 | null {
  const placement = PLACEMENTS.get(fdi)
  if (!placement) return null
  return placement.arch === 'upper' ? 1 : -1
}

function levelY(placement: NtsToothPlacement, level: NtsLevel): number {
  switch (level) {
    case 'annotation':
      return placement.annotation.y + placement.annotation.height / 2
    case 'number':
      return placement.number.y + placement.number.height / 2
    case 'crown':
      return placement.crown.y + placement.crown.height / 2
    case 'apex':
      return apexBand(placement.row)!
    case 'occlusal':
      return occlusalBand(placement.row)!
  }
}

// ---------------------------------------------------------------------------
// multi-tooth anchors
// ---------------------------------------------------------------------------

export interface NtsSpan {
  x1: number
  x2: number
  y: number
  row: NtsRowId
}

/**
 * The horizontal extent a set of teeth covers, at one level.
 *
 * Teeth are ordered by their **position in the row**, never by FDI number:
 * 11 and 21 are neighbours on the chart and nowhere near each other
 * numerically, so a numeric sort would invert every span that crosses the
 * midline.
 *
 * `null` when the set is empty or spreads across rows — a span has no meaning
 * between an upper tooth and a lower one, and guessing one would draw a
 * clinical claim nobody made.
 */
export function rangeSpan(teeth: readonly number[], level: NtsLevel = 'apex'): NtsSpan | null {
  if (teeth.length === 0) return null
  const placements: NtsToothPlacement[] = []
  for (const fdi of teeth) {
    const placement = PLACEMENTS.get(fdi)
    if (!placement) return null
    placements.push(placement)
  }
  const row = placements[0]!.row
  if (placements.some(p => p.row !== row)) return null

  const sorted = [...placements].sort((a, b) => a.index - b.index)
  return {
    x1: sorted[0]!.cell.x,
    x2: sorted[sorted.length - 1]!.cell.x + sorted[sorted.length - 1]!.cell.width,
    y: levelY(sorted[0]!, level),
    row
  }
}

/**
 * The extent of a whole arch.
 *
 * Product policy settled in the 05D.0 audit: an arch overlay spans the
 * **permanent** row of that arch and does not reach into the deciduous row
 * nested inside it. The norm draws a single 16-tooth arch; our chart stacks
 * four rows, and stretching the mark over both would assert something about
 * the deciduous teeth that the norm does not.
 */
export function archSpan(arch: NtsArch, level: NtsLevel = 'apex'): NtsSpan | null {
  const row: NtsRowId = arch === 'upper' ? 'permanentUpper' : 'permanentLower'
  return rangeSpan(teethOfRow(row).map(p => p.fdi), level)
}

/**
 * The point between two neighbouring teeth.
 *
 * Some marks belong to the gap rather than to either tooth: one is drawn
 * between two crowns, another between the apices of the two teeth that flank
 * an unnumbered one. Both need this point.
 *
 * Returns `null` unless the two teeth are in the same row and in adjacent
 * columns. A midpoint between two teeth that are not neighbours is a number,
 * not an anatomical location, and drawing there would invent a relationship.
 */
export function interproximalPoint(
  a: number,
  b: number,
  level: NtsLevel = 'crown'
): NtsPoint | null {
  const first = PLACEMENTS.get(a)
  const second = PLACEMENTS.get(b)
  if (!first || !second) return null
  if (first.row !== second.row) return null
  if (Math.abs(first.index - second.index) !== 1) return null

  const left = first.index < second.index ? first : second
  return { x: left.cell.x + left.cell.width, y: levelY(left, level) }
}
