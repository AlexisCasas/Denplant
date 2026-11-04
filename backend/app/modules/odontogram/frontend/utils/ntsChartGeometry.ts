/**
 * Shared, viewport-independent geometry for the NTS chart.
 *
 * A geometry is derived from the rows it renders. This is intentionally not a
 * visibility filter over the four-row chart: a two-row dentition has its own
 * origin, height, placements and anchors, so overlays cannot retain stale
 * coordinates from teeth that are not on screen.
 */
import type { NtsArch, NtsDentitionRow, NtsTooth } from './ntsDentition'
import { NTS_BLEED, NTS_CELL_HEIGHT, NTS_ROWS, cellWidthFor, rowWidthFor, toothGeometry } from './ntsDentition'

export type NtsRowId = (typeof NTS_ROWS)[number]['id']
export interface NtsPoint { x: number; y: number }
export interface NtsBox { x: number; y: number; width: number; height: number }
export type NtsLevel = 'annotation' | 'number' | 'crown' | 'apex' | 'occlusal'
export interface NtsRootAxis { base: NtsPoint; tip: NtsPoint }
export interface NtsToothPlacement {
  fdi: number
  tooth: NtsTooth
  row: NtsRowId
  arch: NtsArch
  index: number
  cell: NtsBox
  svg: NtsBox
  scale: number
  crown: NtsBox
  annotation: NtsBox
  number: NtsBox
  root: NtsBox
  roots: NtsRootAxis[]
  center: NtsPoint
}
export interface NtsSpan { x1: number; x2: number; y: number; row: NtsRowId }

export const NTS_CHART_SCALE = 0.484
const ANNOTATION_HEIGHT = 40
const NUMBER_HEIGHT = 20
const CANVAS_PADDING_Y = 8
const ROW_GAP = 4
const ROW_TOP_PADDING = 12
const PADDED_ROWS: ReadonlySet<string> = new Set(['deciduousUpper', 'permanentLower'])
const SVG_HEIGHT = NTS_CELL_HEIGHT * NTS_CHART_SCALE
const CELL_HEIGHT = ANNOTATION_HEIGHT + NUMBER_HEIGHT + SVG_HEIGHT

/** Everything a renderer needs to locate marks in one active layout. */
export interface NtsChartGeometry {
  readonly rows: readonly NtsDentitionRow[]
  readonly placements: readonly NtsToothPlacement[]
  readonly width: number
  readonly height: number
  readonly viewBox: string
  hasTooth(fdi: number): boolean
  toothPlacement(fdi: number): NtsToothPlacement | null
  localToGlobal(fdi: number, point: NtsPoint): NtsPoint | null
  toothCenter(fdi: number): NtsPoint | null
  crownBox(fdi: number): NtsBox | null
  annotationBox(fdi: number): NtsBox | null
  numberBox(fdi: number): NtsBox | null
  numberAnchor(fdi: number): NtsPoint | null
  rootBox(fdi: number): NtsBox | null
  rootAxes(fdi: number): NtsRootAxis[]
  apexPoint(fdi: number): NtsPoint | null
  apexBand(row: NtsRowId): number | null
  occlusalBand(row: NtsRowId): number | null
  occlusalDirection(fdi: number): 1 | -1 | null
  rangeSpan(teeth: readonly number[], level?: NtsLevel): NtsSpan | null
  archSpan(arch: NtsArch, level?: NtsLevel): NtsSpan | null
  interproximalPoint(a: number, b: number, level?: NtsLevel): NtsPoint | null
}

/** Create a self-contained coordinate space for exactly the supplied rows. */
export function createNtsChartGeometry(rows: readonly NtsDentitionRow[]): NtsChartGeometry {
  const activeRows = [...rows]
  const rowWidths = activeRows.map(row => rowWidthFor(row.teeth) * NTS_CHART_SCALE)
  const width = Math.round(Math.max(0, ...rowWidths))
  const rowTops = activeRows.map((_, index) => {
    let y = CANVAS_PADDING_Y
    for (let i = 0; i < index; i++) y += (PADDED_ROWS.has(activeRows[i]!.id) ? ROW_TOP_PADDING : 0) + CELL_HEIGHT + ROW_GAP
    return y
  })
  const height = activeRows.length === 0
    ? CANVAS_PADDING_Y * 2
    : rowTops[rowTops.length - 1]! + (PADDED_ROWS.has(activeRows[activeRows.length - 1]!.id) ? ROW_TOP_PADDING : 0) + CELL_HEIGHT + CANVAS_PADDING_Y

  const placementFor = (tooth: NtsTooth): NtsToothPlacement => {
    const rowIndex = activeRows.findIndex(row => row.teeth.some(candidate => candidate.fdi === tooth.fdi))
    const row = activeRows[rowIndex]!
    const index = row.teeth.findIndex(candidate => candidate.fdi === tooth.fdi)
    const rowWidth = rowWidths[rowIndex]!
    let x = (width - rowWidth) / 2
    for (let i = 0; i < index; i++) x += cellWidthFor(row.teeth[i]!) * NTS_CHART_SCALE
    const cellWidth = cellWidthFor(tooth) * NTS_CHART_SCALE
    const contentTop = rowTops[rowIndex]! + (PADDED_ROWS.has(row.id) ? ROW_TOP_PADDING : 0)
    const isUpper = tooth.arch === 'upper'
    const annotationY = isUpper ? contentTop : contentTop + SVG_HEIGHT + NUMBER_HEIGHT
    const numberY = isUpper ? contentTop + ANNOTATION_HEIGHT : contentTop + SVG_HEIGHT
    const svgY = isUpper ? contentTop + ANNOTATION_HEIGHT + NUMBER_HEIGHT : contentTop
    const scale = cellWidth / (cellWidthFor(tooth) + NTS_BLEED * 2)
    const offsetY = (SVG_HEIGHT - (NTS_CELL_HEIGHT + NTS_BLEED * 2) * scale) / 2
    const local = toothGeometry(tooth)
    const toGlobal = (lx: number, ly: number): NtsPoint => ({ x: x + (lx + NTS_BLEED) * scale, y: svgY + offsetY + (ly + NTS_BLEED) * scale })
    const crownTopLeft = toGlobal(local.crown.x, local.crown.y)
    const crown = { x: crownTopLeft.x, y: crownTopLeft.y, width: local.crown.width * scale, height: local.crown.height * scale }
    const roots = local.rootShapes.map(shape => ({ base: toGlobal(shape.base.x, shape.base.y), tip: toGlobal(shape.tip.x, shape.tip.y) }))
    const rootLeft = Math.min(...local.rootShapes.map(shape => Math.min(shape.left, shape.tip.x)))
    const rootRight = Math.max(...local.rootShapes.map(shape => Math.max(shape.right, shape.tip.x)))
    const rootTop = Math.min(...local.rootShapes.flatMap(shape => [shape.base.y, shape.tip.y]))
    const rootBottom = Math.max(...local.rootShapes.flatMap(shape => [shape.base.y, shape.tip.y]))
    const rootTopLeft = toGlobal(rootLeft, rootTop)
    return {
      fdi: tooth.fdi, tooth, row: row.id, arch: tooth.arch, index,
      cell: { x, y: contentTop, width: cellWidth, height: CELL_HEIGHT }, svg: { x, y: svgY, width: cellWidth, height: SVG_HEIGHT }, scale, crown,
      annotation: { x, y: annotationY, width: cellWidth, height: ANNOTATION_HEIGHT }, number: { x, y: numberY, width: cellWidth, height: NUMBER_HEIGHT },
      root: { x: rootTopLeft.x, y: rootTopLeft.y, width: (rootRight - rootLeft) * scale, height: (rootBottom - rootTop) * scale },
      roots, center: { x: x + cellWidth / 2, y: crown.y + crown.height / 2 }
    }
  }
  const placements = new Map<number, NtsToothPlacement>(activeRows.flatMap(row => row.teeth).map(tooth => [tooth.fdi, placementFor(tooth)]))
  const teethOfRow = (row: NtsRowId) => [...placements.values()].filter(placement => placement.row === row)
  const apexBand = (row: NtsRowId) => {
    const teeth = teethOfRow(row); if (teeth.length === 0) return null
    const tips = teeth.flatMap(placement => placement.roots.map(root => root.tip.y))
    return teeth[0]!.arch === 'upper' ? Math.min(...tips) : Math.max(...tips)
  }
  const occlusalBand = (row: NtsRowId) => {
    const teeth = teethOfRow(row); if (teeth.length === 0) return null
    const edges = teeth.map(placement => placement.arch === 'upper' ? placement.crown.y + placement.crown.height : placement.crown.y)
    return teeth[0]!.arch === 'upper' ? Math.max(...edges) : Math.min(...edges)
  }
  const levelY = (placement: NtsToothPlacement, level: NtsLevel) => {
    if (level === 'annotation') return placement.annotation.y + placement.annotation.height / 2
    if (level === 'number') return placement.number.y + placement.number.height / 2
    if (level === 'crown') return placement.crown.y + placement.crown.height / 2
    return level === 'apex' ? apexBand(placement.row)! : occlusalBand(placement.row)!
  }
  const geometry: NtsChartGeometry = {
    rows: activeRows, placements: [...placements.values()], width, height, viewBox: `0 0 ${width} ${height}`,
    hasTooth: fdi => placements.has(fdi), toothPlacement: fdi => placements.get(fdi) ?? null,
    localToGlobal: (fdi, point) => {
      const placement = placements.get(fdi); if (!placement) return null
      const offsetY = (SVG_HEIGHT - (NTS_CELL_HEIGHT + NTS_BLEED * 2) * placement.scale) / 2
      return { x: placement.svg.x + (point.x + NTS_BLEED) * placement.scale, y: placement.svg.y + offsetY + (point.y + NTS_BLEED) * placement.scale }
    },
    toothCenter: fdi => placements.get(fdi)?.center ?? null, crownBox: fdi => placements.get(fdi)?.crown ?? null,
    annotationBox: fdi => placements.get(fdi)?.annotation ?? null, numberBox: fdi => placements.get(fdi)?.number ?? null,
    numberAnchor: fdi => { const box = placements.get(fdi)?.number; return box ? { x: box.x + box.width / 2, y: box.y + box.height / 2 } : null },
    rootBox: fdi => placements.get(fdi)?.root ?? null, rootAxes: fdi => placements.get(fdi)?.roots ?? [],
    apexPoint: fdi => {
      const placement = placements.get(fdi); if (!placement || placement.roots.length === 0) return null
      return placement.roots.reduce((a, b) => placement.arch === 'upper' ? (a.tip.y <= b.tip.y ? a : b) : (a.tip.y >= b.tip.y ? a : b)).tip
    },
    apexBand, occlusalBand, occlusalDirection: fdi => { const placement = placements.get(fdi); return placement ? (placement.arch === 'upper' ? 1 : -1) : null },
    rangeSpan: (teeth, level = 'apex') => {
      if (teeth.length === 0) return null
      const resolved = teeth.map(fdi => placements.get(fdi)); if (resolved.some(placement => !placement)) return null
      const present = resolved as NtsToothPlacement[]; const row = present[0]!.row
      if (present.some(placement => placement.row !== row)) return null
      const sorted = [...present].sort((a, b) => a.index - b.index)
      return { x1: sorted[0]!.cell.x, x2: sorted[sorted.length - 1]!.cell.x + sorted[sorted.length - 1]!.cell.width, y: levelY(sorted[0]!, level), row }
    },
    archSpan: (arch, level = 'apex') => {
      const row = activeRows.find(candidate => candidate.arch === arch && candidate.dentition === 'permanent')
      return row ? geometry.rangeSpan(row.teeth.map(tooth => tooth.fdi), level) : null
    },
    interproximalPoint: (a, b, level = 'crown') => {
      const first = placements.get(a); const second = placements.get(b)
      if (!first || !second || first.row !== second.row || Math.abs(first.index - second.index) !== 1) return null
      const left = first.index < second.index ? first : second
      return { x: left.cell.x + left.cell.width, y: levelY(left, level) }
    }
  }
  return geometry
}

/** Default geometry preserves the NTS four-row/52-piece print contract. */
export const ALL_NTS_CHART_GEOMETRY = createNtsChartGeometry(NTS_ROWS)
export const NTS_CHART_WIDTH = ALL_NTS_CHART_GEOMETRY.width
export const NTS_CHART_HEIGHT = ALL_NTS_CHART_GEOMETRY.height
export const NTS_CHART_VIEWBOX = ALL_NTS_CHART_GEOMETRY.viewBox
export const NTS_PLACEMENTS = ALL_NTS_CHART_GEOMETRY.placements
export const toothPlacement = ALL_NTS_CHART_GEOMETRY.toothPlacement
export const localToGlobal = ALL_NTS_CHART_GEOMETRY.localToGlobal
export const toothCenter = ALL_NTS_CHART_GEOMETRY.toothCenter
export const crownBox = ALL_NTS_CHART_GEOMETRY.crownBox
export const annotationBox = ALL_NTS_CHART_GEOMETRY.annotationBox
export const numberBox = ALL_NTS_CHART_GEOMETRY.numberBox
export const numberAnchor = ALL_NTS_CHART_GEOMETRY.numberAnchor
export const rootBox = ALL_NTS_CHART_GEOMETRY.rootBox
export const rootAxes = ALL_NTS_CHART_GEOMETRY.rootAxes
export const apexPoint = ALL_NTS_CHART_GEOMETRY.apexPoint
export const apexBand = ALL_NTS_CHART_GEOMETRY.apexBand
export const occlusalBand = ALL_NTS_CHART_GEOMETRY.occlusalBand
export const occlusalDirection = ALL_NTS_CHART_GEOMETRY.occlusalDirection
export const rangeSpan = ALL_NTS_CHART_GEOMETRY.rangeSpan
export const archSpan = ALL_NTS_CHART_GEOMETRY.archSpan
export const interproximalPoint = ALL_NTS_CHART_GEOMETRY.interproximalPoint
