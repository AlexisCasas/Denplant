/**
 * NTS N.° 188 dentition — the structural layout of the official odontogram.
 *
 * Source of truth: the norm's own **Anexo: Gráfico del odontograma**
 * (NTS N.° 188-MINSA/DGIESP-2022, p. 22). Everything here is read off that
 * page: the four rows, their order, the nesting of the deciduous arches
 * inside the permanent ones, and the geometry of one tooth cell.
 *
 * This is **not** a second copy of the catalog. The catalog owns rules,
 * attributes, siglas, target roles and specification requirements; none of
 * that appears here. What lives here is dentition and FDI — the coordinate
 * system the renderer draws on, which the catalog does not describe.
 *
 * FDI numbers are generated from the quadrants rather than listed by hand:
 * 52 literals would be 52 chances to typo a tooth that no test would catch.
 */

/** Permanent = 32 teeth, deciduous = 20. The chart always shows all 52. */
export type NtsDentition = 'permanent' | 'deciduous'
export type NtsArch = 'upper' | 'lower'
/** The patient's own side, not the side of the screen. See `NTS_ROWS`. */
export type NtsSide = 'right' | 'left'
export type NtsToothClass = 'incisor' | 'canine' | 'premolar' | 'molar'

export interface NtsTooth {
  /** FDI "Sistema Dígito Dos" number, e.g. 18 or 51. */
  fdi: number
  quadrant: number
  /** 1 = nearest the midline, counting distally. */
  positionInQuadrant: number
  dentition: NtsDentition
  arch: NtsArch
  side: NtsSide
  toothClass: NtsToothClass
}

/**
 * Quadrant definitions, in FDI order.
 *
 * 1–4 are permanent and 5–8 deciduous; within each half the quadrants run
 * clockwise from the patient's upper right, which is why 1/5 and 4/8 are the
 * patient's right and land on the *left* of the chart.
 */
const QUADRANTS: ReadonlyArray<{
  quadrant: number
  dentition: NtsDentition
  arch: NtsArch
  side: NtsSide
  count: number
}> = [
  { quadrant: 1, dentition: 'permanent', arch: 'upper', side: 'right', count: 8 },
  { quadrant: 2, dentition: 'permanent', arch: 'upper', side: 'left', count: 8 },
  { quadrant: 3, dentition: 'permanent', arch: 'lower', side: 'left', count: 8 },
  { quadrant: 4, dentition: 'permanent', arch: 'lower', side: 'right', count: 8 },
  { quadrant: 5, dentition: 'deciduous', arch: 'upper', side: 'right', count: 5 },
  { quadrant: 6, dentition: 'deciduous', arch: 'upper', side: 'left', count: 5 },
  { quadrant: 7, dentition: 'deciduous', arch: 'lower', side: 'left', count: 5 },
  { quadrant: 8, dentition: 'deciduous', arch: 'lower', side: 'right', count: 5 }
]

/**
 * Tooth class from the position inside the quadrant.
 *
 * Deciduous arches have no premolars: positions 4 and 5 are molars, which is
 * why the annex draws 55/54 with molar crowns and no premolar row exists.
 */
function toothClassFor(dentition: NtsDentition, position: number): NtsToothClass {
  if (position <= 2) return 'incisor'
  if (position === 3) return 'canine'
  if (dentition === 'deciduous') return 'molar'
  return position <= 5 ? 'premolar' : 'molar'
}

function makeTooth(quadrant: number, position: number): NtsTooth {
  const definition = QUADRANTS.find(q => q.quadrant === quadrant)!
  return {
    fdi: quadrant * 10 + position,
    quadrant,
    positionInQuadrant: position,
    dentition: definition.dentition,
    arch: definition.arch,
    side: definition.side,
    toothClass: toothClassFor(definition.dentition, position)
  }
}

/** A quadrant read outward from the midline (11 → 18). */
function quadrantOutward(quadrant: number): NtsTooth[] {
  const { count } = QUADRANTS.find(q => q.quadrant === quadrant)!
  return Array.from({ length: count }, (_, i) => makeTooth(quadrant, i + 1))
}

/** A quadrant read inward toward the midline (18 → 11). */
function quadrantInward(quadrant: number): NtsTooth[] {
  return quadrantOutward(quadrant).reverse()
}

export interface NtsDentitionRow {
  /** Stable id, also the i18n suffix. */
  id: 'permanentUpper' | 'deciduousUpper' | 'deciduousLower' | 'permanentLower'
  dentition: NtsDentition
  arch: NtsArch
  teeth: NtsTooth[]
}

/**
 * The four rows, in the order the annex stacks them top to bottom.
 *
 * Each row reads left to right as the patient's right quadrant inward to the
 * midline, then the patient's left quadrant outward — so the chart is the
 * clinician's view: screen-left is the patient's right. The annex settles
 * this directly, since it prints 18 at the far left and 28 at the far right.
 *
 * The deciduous rows are nested *inside* the permanent ones (permanent upper,
 * deciduous upper, midline, deciduous lower, permanent lower) rather than
 * placed beside them.
 */
export const NTS_ROWS: readonly NtsDentitionRow[] = [
  {
    id: 'permanentUpper',
    dentition: 'permanent',
    arch: 'upper',
    teeth: [...quadrantInward(1), ...quadrantOutward(2)]
  },
  {
    id: 'deciduousUpper',
    dentition: 'deciduous',
    arch: 'upper',
    teeth: [...quadrantInward(5), ...quadrantOutward(6)]
  },
  {
    id: 'deciduousLower',
    dentition: 'deciduous',
    arch: 'lower',
    teeth: [...quadrantInward(8), ...quadrantOutward(7)]
  },
  {
    id: 'permanentLower',
    dentition: 'permanent',
    arch: 'lower',
    teeth: [...quadrantInward(4), ...quadrantOutward(3)]
  }
]

/** Every tooth the chart renders: 32 permanent + 20 deciduous = 52. */
export const NTS_ALL_TEETH: readonly NtsTooth[] = NTS_ROWS.flatMap(row => row.teeth)

// ---------------------------------------------------------------------------
// tooth cell geometry
// ---------------------------------------------------------------------------

/**
 * Proportions, read off the Anexo and expressed relative to the crown.
 *
 * The annex is a 300dpi scan, so its pixel measurements are raster readings,
 * not dimensions the norm states. They are used here only as *ratios* — the
 * shape of the form, never a legal size. Measured on the upper permanent row:
 * crown height ≈ 68 with class-dependent widths (molar ≈ 88, premolar ≈ 82,
 * anterior ≈ 61) and a root extent ≈ 83, i.e. roots a little longer than the
 * crown is tall.
 *
 * Every number below is in those same units, so the whole cell scales as one.
 */
const CROWN_HEIGHT = 68
/** Root reach beyond the crown. ≈1.2 × crown height, as the annex draws it. */
const ROOT_EXTENT = 82
const CELL_HEIGHT = CROWN_HEIGHT + ROOT_EXTENT

/**
 * Crown width by tooth class.
 *
 * The annex draws molars widest, premolars slightly narrower and the six
 * front teeth much narrower; the crown *height* is the same for all of them.
 */
const CROWN_WIDTHS: Readonly<Record<NtsToothClass, number>> = {
  molar: 88,
  premolar: 82,
  canine: 61,
  incisor: 61
}

/**
 * Space between one tooth and the next.
 *
 * The annex packs the teeth with a small, near-constant gap whatever their
 * class, so the column pitch follows the crown width rather than being fixed.
 */
const CELL_GUTTER = 7

/**
 * Where the four corner diagonals meet the central region, as a fraction of
 * the crown.
 *
 * Posteriors get a real central rectangle. Anteriors do not: the annex closes
 * their diagonals onto a short horizontal segment, so the centre is a sliver —
 * roughly a third of the width and almost no height. That is what gives the
 * front teeth their envelope look instead of the boxed look of a molar.
 */
const POSTERIOR_INSET = { x: 0.28, y: 0.28 }
const ANTERIOR_INSET = { x: 0.33, y: 0.44 }

/**
 * Slack around the drawing inside the viewBox.
 *
 * Without it the crown's own left and right edges sit exactly on the viewport
 * boundary and get half-clipped, which makes neighbouring teeth read as one
 * merged shape instead of two cells.
 */
const BLEED = 4

/** Height of every cell in layout units. Identical across classes. */
export const NTS_CELL_HEIGHT = CELL_HEIGHT

/**
 * The bleed, exported so the chart-level coordinate model can undo it.
 *
 * A tooth is drawn inside a viewBox that is `2 × BLEED` larger than the cell in
 * both axes, so mapping a local point onto the chart means accounting for it.
 * Anything that needs to place a mark next to a tooth needs this number; there
 * must not be a second copy of it.
 */
export const NTS_BLEED = BLEED

/**
 * How thick the tooth's own outline is drawn, in layout units.
 *
 * Exported by 05D.4c because a second thing now draws that same outline. A
 * clinical fill sits above the drawing and covers the neutral strokes under
 * it; the parts of them that must stay visible are restored from the overlay,
 * and a restored segment that did not match the original weight would read as
 * a different kind of line rather than as the same one continuing. One
 * constant, used by the cell that draws it and by the overlay that repairs it.
 */
export const NTS_TOOTH_STROKE = 3

/**
 * Width of one tooth's column in layout units — crown plus its gutter.
 *
 * The annotation box, the FDI number and the tooth all share this width, which
 * is how the annex keeps a box glued to the tooth it belongs to.
 */
export function cellWidthFor(tooth: NtsTooth): number {
  return CROWN_WIDTHS[tooth.toothClass] + CELL_GUTTER
}

/** Total width of a row in layout units. */
export function rowWidthFor(teeth: readonly NtsTooth[]): number {
  return teeth.reduce((total, tooth) => total + cellWidthFor(tooth), 0)
}

/**
 * A drawable region of the crown.
 *
 * The ids are **positional, not clinical**. The annex draws the four corner
 * diagonals, but which trapezoid is mesial and which is distal depends on the
 * quadrant, and that mapping belongs with the surface-scoped rules — not
 * here. A later ticket assigns meaning; this one only guarantees the regions
 * exist, are addressable and never move.
 */
export interface NtsCrownRegion {
  id: string
  d: string
  /**
   * The same outline as an ordered ring of points.
   *
   * Added by NTS-05D.4b. `d` is still emitted from exactly these points and is
   * unchanged, so nothing drawn moves; what the ring buys is a shape that can
   * be *reasoned* about — merged with a neighbour, walked for a boundary —
   * without parsing a path string back into numbers.
   */
  points: NtsPoint[]
}

/** A point in a tooth's own layout units. */
export interface NtsPoint {
  x: number
  y: number
}

/** `M…L…Z` for a closed ring. The one place a region's `d` is written. */
function ringPath(points: readonly NtsPoint[]): string {
  const [first, ...rest] = points
  if (!first) return ''
  return `M${first.x},${first.y} ${rest.map(p => `L${p.x},${p.y}`).join(' ')} Z`
}

function region(id: string, points: NtsPoint[]): NtsCrownRegion {
  return { id, d: ringPath(points), points }
}

/**
 * One root, as both a drawing and a measurable shape.
 *
 * `rootPaths` used to compute the base line, the apex and the two flanks and
 * then throw all of it away, keeping only the path string. Anything that has
 * to be placed *on* a root, or level with the apices, needs those numbers, and
 * recovering them by parsing the `d` back would be a second, divergent source
 * for the same geometry.
 *
 * `d` is still emitted from exactly these points, so nothing drawn changes.
 */
export interface NtsRootGeometry {
  d: string
  /** Where the root meets the crown: the midpoint of its base edge. */
  base: { x: number, y: number }
  /** The apex. */
  tip: { x: number, y: number }
  /** The base edge, for a root's own bounding box. */
  left: number
  right: number
}

export interface NtsToothGeometry {
  viewBox: string
  /** Outline of the crown, centred in its column. */
  crown: { x: number, y: number, width: number, height: number }
  regions: NtsCrownRegion[]
  /** Path strings only — what the cell renders. Derived from `rootShapes`. */
  roots: string[]
  /** The same roots, measurable. Added by 05D.1; `roots` is unchanged. */
  rootShapes: NtsRootGeometry[]
}

/**
 * How many roots the annex draws.
 *
 * Upper molars have three, lower molars two, everything else one. (The annex
 * additionally sketches a dashed second root on 14 and 24; that is a variant
 * detail of a single tooth, not layout, and is left out.)
 */
export function rootCountFor(tooth: NtsTooth): number {
  if (tooth.toothClass !== 'molar') return 1
  return tooth.arch === 'upper' ? 3 : 2
}

/**
 * The tiles that make up the middle of the crown, as the annex draws it.
 *
 * A neutral accessor, added by 05D.4: it says which polygons are central and
 * nothing about what being central *means*. Two unrelated consumers need
 * exactly that and must not learn it from each other — the surface policy
 * resolves a posterior's occlusal table here, and a landmark anchored inside
 * the crown resolves its own anatomy here. Letting either read the other's
 * answer is how a landmark would silently acquire a surface's shape.
 */
export function centralRegionsOf(tooth: NtsTooth): NtsCrownRegion[] {
  return toothGeometry(tooth).regions.filter(
    region => region.id === 'center' || region.id.startsWith('center-')
  )
}

/**
 * How the annex subdivides the central region: anteriors leave it whole,
 * premolars split it in two, molars in four.
 */
export function centralRegionCountFor(tooth: NtsTooth): number {
  if (tooth.toothClass === 'molar') return 4
  if (tooth.toothClass === 'premolar') return 2
  return 1
}

/**
 * Incisors and canines — the teeth at the front of the arch.
 *
 * Exported by 05D.4b so the surface policy asks this module rather than
 * re-deriving it from the tooth class and drifting later.
 */
export function isAnterior(tooth: NtsTooth): boolean {
  return tooth.toothClass === 'incisor' || tooth.toothClass === 'canine'
}

/** Rounded to keep the emitted paths short and byte-stable. */
function r(value: number): number {
  return Math.round(value * 100) / 100
}

interface CrownBox {
  left: number
  right: number
  top: number
  bottom: number
  /** Where the diagonals land: the central region's own box. */
  innerLeft: number
  innerRight: number
  innerTop: number
  innerBottom: number
}

function crownBox(tooth: NtsTooth): CrownBox {
  const width = CROWN_WIDTHS[tooth.toothClass]
  const left = (cellWidthFor(tooth) - width) / 2
  const top = tooth.arch === 'upper' ? ROOT_EXTENT : 0
  const inset = isAnterior(tooth) ? ANTERIOR_INSET : POSTERIOR_INSET

  return {
    left: r(left),
    right: r(left + width),
    top: r(top),
    bottom: r(top + CROWN_HEIGHT),
    innerLeft: r(left + width * inset.x),
    innerRight: r(left + width * (1 - inset.x)),
    innerTop: r(top + CROWN_HEIGHT * inset.y),
    innerBottom: r(top + CROWN_HEIGHT * (1 - inset.y))
  }
}

function centralRegions(box: CrownBox, count: number): NtsCrownRegion[] {
  const { innerLeft: a, innerRight: b, innerTop: y0, innerBottom: y1 } = box
  const midX = r((a + b) / 2)
  const midY = r((y0 + y1) / 2)

  const box4 = (x0: number, x1: number, top: number, bottom: number): NtsPoint[] =>
    [{ x: x0, y: top }, { x: x1, y: top }, { x: x1, y: bottom }, { x: x0, y: bottom }]

  if (count === 1) {
    return [region('center', box4(a, b, y0, y1))]
  }
  if (count === 2) {
    return [
      region('center-1', box4(a, b, y0, midY)),
      region('center-2', box4(a, b, midY, y1))
    ]
  }
  return [
    region('center-1', box4(a, midX, y0, midY)),
    region('center-2', box4(midX, b, y0, midY)),
    region('center-3', box4(a, midX, midY, y1)),
    region('center-4', box4(midX, b, midY, y1))
  ]
}

/**
 * How a trifurcated root is spread, as fractions of the crown's width.
 *
 * Clinically validated for DenPlant: a three-rooted tooth is not three
 * separate triangles standing side by side. The roots leave a common trunk, so
 * their bases sit close together and overlap, while the apices stay far enough
 * apart to be counted. The middle root is the one read first, and the two
 * lateral ones cross behind it.
 *
 * Only the horizontal spread is described here. Base and apex *heights* are
 * shared with every other root on the chart and are deliberately untouched:
 * the apex band, the range and arch overlays and the supernumerary anchor are
 * all measured from them.
 */
const TRIFURCATED = {
  /** Half-width of one root's base. */
  baseHalf: 0.13,
  /** How far the outer bases sit from the centre. */
  baseSpread: 0.12,
  /** How far the outer apices sit from the centre. */
  tipSpread: 0.28
} as const

function rootShapes(tooth: NtsTooth, box: CrownBox): NtsRootGeometry[] {
  const count = rootCountFor(tooth)
  const width = box.right - box.left
  const base = tooth.arch === 'upper' ? box.top : box.bottom
  const tip = tooth.arch === 'upper' ? BLEED / 2 : CELL_HEIGHT - BLEED / 2

  if (count === 3) return trifurcated(box, width, base, tip)

  const slice = width / count
  // A single root is a narrow spike; a pair of them fills the crown's width.
  const pad = count === 1 ? width * 0.18 : width * 0.05

  return Array.from({ length: count }, (_, i) => {
    const left = r(box.left + i * slice + pad)
    const right = r(box.left + (i + 1) * slice - pad)
    const apex = r(box.left + i * slice + slice / 2)
    return {
      d: `M${left},${base} L${apex},${tip} L${right},${base} Z`,
      base: { x: apex, y: base },
      tip: { x: apex, y: tip },
      left,
      right
    }
  })
}

/**
 * Three roots leaving a common trunk.
 *
 * Emitted left to right, as every other tooth is. Drawing order carries no
 * visual meaning here: the cell strokes its roots with `fill="none"`, so an
 * overlapping outline crosses its neighbour rather than hiding it, and the
 * middle root reads as the front one because it is the one drawn whole.
 */
function trifurcated(
  box: CrownBox,
  width: number,
  base: number,
  tip: number
): NtsRootGeometry[] {
  const centre = box.left + width / 2
  const half = width * TRIFURCATED.baseHalf
  const baseSpread = width * TRIFURCATED.baseSpread
  const tipSpread = width * TRIFURCATED.tipSpread

  return [-1, 0, 1].map(side => {
    const baseCentre = centre + baseSpread * side
    const apex = r(centre + tipSpread * side)
    const left = r(baseCentre - half)
    const right = r(baseCentre + half)
    return {
      d: `M${left},${base} L${apex},${tip} L${right},${base} Z`,
      // The base midpoint stays the root's own, so a mark placed on a root
      // lands on that root and not on the trunk they share.
      base: { x: r(baseCentre), y: base },
      tip: { x: apex, y: tip },
      left,
      right
    }
  })
}

/**
 * Base geometry for one tooth: crown outline, its regions, and the roots.
 *
 * Pure and deterministic — the same tooth always yields the same paths — so
 * the chart prints identically to how it renders and a later ticket can layer
 * fills and symbols on top without the geometry shifting underneath.
 *
 * The viewBox height is the same for every class and only its width varies,
 * so a row of mixed classes rendered at one common height lands every crown on
 * the same baseline.
 */
export function toothGeometry(tooth: NtsTooth): NtsToothGeometry {
  const box = crownBox(tooth)
  const cellWidth = cellWidthFor(tooth)
  const { left, right, top, bottom, innerLeft, innerRight, innerTop, innerBottom } = box
  const shapes = rootShapes(tooth, box)

  return {
    viewBox: `${-BLEED} ${-BLEED} ${cellWidth + BLEED * 2} ${CELL_HEIGHT + BLEED * 2}`,
    crown: {
      x: left,
      y: top,
      width: r(right - left),
      height: CROWN_HEIGHT
    },
    regions: [
      region('outer-top', [
        { x: left, y: top }, { x: right, y: top },
        { x: innerRight, y: innerTop }, { x: innerLeft, y: innerTop }
      ]),
      region('outer-right', [
        { x: right, y: top }, { x: right, y: bottom },
        { x: innerRight, y: innerBottom }, { x: innerRight, y: innerTop }
      ]),
      region('outer-bottom', [
        { x: right, y: bottom }, { x: left, y: bottom },
        { x: innerLeft, y: innerBottom }, { x: innerRight, y: innerBottom }
      ]),
      region('outer-left', [
        { x: left, y: bottom }, { x: left, y: top },
        { x: innerLeft, y: innerTop }, { x: innerLeft, y: innerBottom }
      ]),
      ...centralRegions(box, centralRegionCountFor(tooth))
    ],
    roots: shapes.map(shape => shape.d),
    rootShapes: shapes
  }
}
