/**
 * Dental surfaces → crown geometry. **DenPlant clinically validated product
 * policy**, not a table NTS N.° 188 defines.
 *
 * This distinction is the whole reason the module exists separately, and it
 * must not blur. The norm records *which* surfaces a finding involves — its
 * own vocabulary, `M`/`D`/`O`/`V`/`L` — and then says the mark is drawn
 * "según la forma que se observa" (pp. 11, 17). It nowhere states that mesial
 * is this trapezoid and vestibular is that one. Every correspondence below was
 * decided by DenPlant and validated by a dentist so that structured surface
 * data can be shown at all; it is a faithful *representation*, never a
 * normative mapping, and nothing here may be described as one.
 *
 * What was validated:
 *
 * * **Mesial is toward the midline**, so which trapezoid it is depends on the
 *   quadrant — and on nothing else. A fixed left/right assignment would be
 *   wrong in half the mouth.
 * * **Vestibular faces outward in both arches.** On this chart the upper row's
 *   outward side is the top and the lower row's is the bottom, so the two
 *   arches mirror each other. Lingual/palatal takes the opposite side.
 * * **Posterior occlusal is the central table**, however many polygons the
 *   drawing happens to divide it into.
 * * **Anterior incisal is a centred horizontal mark**, clear of the
 *   vestibular/lingual divide so the two cannot be confused.
 * * **Contiguous affected surfaces read as one continuous figure**, with no
 *   internal divider. Surfaces that do not touch stay separate rather than
 *   being bridged.
 *
 * Pure: no Vue, no DOM, no colour, no rule ids, no catalog. Surface codes are
 * named here because this is precisely the module that owns what they mean
 * geometrically; nowhere else in the renderer may name one.
 */

import type { NtsPoint, NtsTooth } from './ntsDentition'
import { centralRegionsOf, isAnterior, NTS_ALL_TEETH, toothGeometry } from './ntsDentition'

/** The norm's own surface vocabulary. */
export type NtsSurfaceCode = 'M' | 'D' | 'O' | 'V' | 'L'

export interface NtsSurfaceRegion {
  /** The crown region's positional id, or `incisal` for the anterior band. */
  id: string
  /** Which surface put it there. */
  surface: NtsSurfaceCode
  /** Closed ring, in the tooth's own layout units. */
  points: NtsPoint[]
}

/**
 * A continuous figure: the rings that make it up, and its outline.
 *
 * Deliberately says nothing about surfaces. Merging adjacent rings and walking
 * their common rim is plain geometry, and a second consumer needs it without
 * inheriting a clinical meaning it does not have — see {@link mergeRegions}.
 */
export interface NtsRegionFigure {
  /** The rings that make it up — filled together, they show no seam. */
  polygons: NtsPoint[][]
  /**
   * The outline of the whole figure, with every shared inner edge removed.
   *
   * One loop for a simple figure, and more when the figure has a hole — which
   * it can: an anterior showing vestibular, incisal and lingual leaves two
   * unaffected slivers trapped between them, because the incisal band is inset
   * from the boundaries it must not sit on. Rims and holes are wound
   * oppositely (see `orient`), so the loops can be drawn as one path and their
   * signed areas sum to the area actually covered.
   */
  boundary: NtsPoint[][]
}

export interface NtsSurfaceComponent extends NtsRegionFigure {
  /** The surfaces that merged into this figure. */
  surfaces: NtsSurfaceCode[]
}

// ---------------------------------------------------------------------------
// the mapping
// ---------------------------------------------------------------------------

/**
 * Mesial faces the midline, so which trapezoid it is depends on which half of
 * the mouth the tooth is in — and on nothing else.
 *
 * The chart is drawn as the clinician sees the patient, so the patient's right
 * quadrants are laid out on the left of the chart and their midline side is
 * the right-hand trapezoid. Read off the tooth's own side rather than a list
 * of quadrant numbers, so it stays true if the rows are ever reordered.
 */
function mesialIsRight(tooth: NtsTooth): boolean {
  return tooth.side === 'right'
}

function mesialRegion(tooth: NtsTooth): string {
  return mesialIsRight(tooth) ? 'outer-right' : 'outer-left'
}

function distalRegion(tooth: NtsTooth): string {
  return mesialIsRight(tooth) ? 'outer-left' : 'outer-right'
}

/**
 * Vestibular faces away from the mouth in both arches.
 *
 * On this chart the upper row's outward side is the top of the cell and the
 * lower row's is the bottom, so the two arches are mirrored. Derived from the
 * arch and nothing else.
 */
function vestibularRegion(tooth: NtsTooth): string {
  return tooth.arch === 'upper' ? 'outer-top' : 'outer-bottom'
}

function lingualRegion(tooth: NtsTooth): string {
  return tooth.arch === 'upper' ? 'outer-bottom' : 'outer-top'
}

// ---------------------------------------------------------------------------
// the anterior incisal band
// ---------------------------------------------------------------------------

/**
 * How tall the incisal mark is, as a fraction of the central zone it sits in.
 *
 * Its **width is not a constant** and must not become one. An anterior's crown
 * closes its diagonals onto a short horizontal segment, and the zone left
 * between them is the incisal surface: the band spans that zone exactly, edge
 * to edge, read off the geometry rather than assumed. A superseded revision of
 * this module widened it to a flat 50% of the crown instead, which pushed it
 * out of the zone and over the mesial and distal trapezoids — the surfaces it
 * would then have been claiming. "It may be a little wider for visibility" is
 * not permission to invade a neighbour, and a mark that overlaps rather than
 * meets its neighbours cannot take part in the tiling either. Both are fixed
 * by taking the zone's own width.
 *
 * Height is where the latitude went instead. The zone's horizontal edges
 * **are** the vestibular/lingual boundaries, and a mark sitting on them is
 * exactly the reading the clinical ruling excludes, so the band keeps clear
 * air above and below. Visibility beyond that is the renderer's business —
 * stroke and fill — not geometry's.
 */
const INCISAL = {
  /** Of the central zone's height, leaving the remainder as clearance. */
  height: 0.6
} as const

export interface NtsIncisalBand {
  points: NtsPoint[]
  /** Clearance to the vestibular and lingual boundaries. Always positive. */
  clearance: number
}

/**
 * The horizontal mark that stands for an anterior's incisal surface.
 *
 * Centred on the crown's own centre — the vertical position the central zone
 * already had, which is the clinically meaningful one — spanning that zone's
 * full width, and deliberately **not** touching either horizontal boundary, so
 * it can never be read as the line dividing vestibular from lingual.
 *
 * This is the *only* geometry for an anterior's occlusal surface: the same
 * polygon that {@link resolveSurfaceRegions} returns and that
 * {@link resolveSurfaceComponents} merges. There is deliberately no second,
 * "logical" shape alongside it — two shapes for one surface would agree today
 * and diverge the first time an outline is drawn from one and a fill from the
 * other.
 *
 * `null` for a posterior, which has a real occlusal table instead.
 */
export function incisalBand(fdi: number): NtsIncisalBand | null {
  const cached = BANDS.get(fdi)
  if (cached !== undefined) return cached

  const band = computeIncisalBand(fdi)
  BANDS.set(fdi, band)
  return band
}

/**
 * Memoised so that every caller sees the *same* polygon, not an equal copy.
 * Pure input, pure output — the cache changes nothing but identity.
 */
const BANDS = new Map<number, NtsIncisalBand | null>()

function computeIncisalBand(fdi: number): NtsIncisalBand | null {
  const tooth = toothFor(fdi)
  if (!tooth || !isAnterior(tooth)) return null

  const centre = toothGeometry(tooth).regions.find(region => region.id === 'center')
  if (!centre) return null

  // The zone's own extent, both ways. Nothing here is a chosen number.
  const xs = centre.points.map(point => point.x)
  const ys = centre.points.map(point => point.y)
  const left = Math.min(...xs)
  const right = Math.max(...xs)
  const zoneTop = Math.min(...ys)
  const zoneBottom = Math.max(...ys)

  const middleY = (zoneTop + zoneBottom) / 2
  const halfHeight = ((zoneBottom - zoneTop) * INCISAL.height) / 2
  const top = round(middleY - halfHeight)
  const bottom = round(middleY + halfHeight)

  return {
    points: [
      { x: left, y: top },
      { x: right, y: top },
      { x: right, y: bottom },
      { x: left, y: bottom }
    ],
    clearance: round((zoneBottom - zoneTop) * (1 - INCISAL.height) / 2)
  }
}

// ---------------------------------------------------------------------------
// resolving surfaces to regions
// ---------------------------------------------------------------------------

const TEETH = new Map<number, NtsTooth>(NTS_ALL_TEETH.map(tooth => [tooth.fdi, tooth]))

function toothFor(fdi: number): NtsTooth | null {
  return TEETH.get(fdi) ?? null
}

/** Surface codes in one canonical order, so the result never depends on input order. */
const CANONICAL: readonly NtsSurfaceCode[] = ['M', 'O', 'D', 'V', 'L']

function normalise(surfaces: readonly string[]): NtsSurfaceCode[] {
  const chosen = new Set(surfaces)
  return CANONICAL.filter(code => chosen.has(code))
}

/**
 * The crown regions a set of surfaces covers.
 *
 * On a posterior, occlusal resolves to every central polygon the class is
 * divided into — clinically one surface, whatever the drawing does with it. On
 * an anterior it resolves to the incisal band, which is the one and only shape
 * that surface has. An unknown code contributes nothing rather than guessing
 * at a region.
 */
export function resolveSurfaceRegions(
  fdi: number,
  surfaces: readonly string[]
): NtsSurfaceRegion[] {
  const tooth = toothFor(fdi)
  if (!tooth) return []

  const geometry = toothGeometry(tooth)
  const byId = new Map(geometry.regions.map(region => [region.id, region]))
  const resolved: NtsSurfaceRegion[] = []

  const take = (surface: NtsSurfaceCode, id: string) => {
    const region = byId.get(id)
    if (region) resolved.push({ id, surface, points: region.points })
  }

  for (const surface of normalise(surfaces)) {
    switch (surface) {
      case 'M':
        take('M', mesialRegion(tooth))
        break
      case 'D':
        take('D', distalRegion(tooth))
        break
      case 'V':
        take('V', vestibularRegion(tooth))
        break
      case 'L':
        take('L', lingualRegion(tooth))
        break
      case 'O': {
        // An anterior's incisal surface is the band, and only the band — the
        // same polygon `incisalBand` hands out, by reference, so no consumer
        // can end up drawing a different shape for the same surface.
        const band = incisalBand(fdi)
        if (band) {
          resolved.push({ id: 'incisal', surface: 'O', points: band.points })
          break
        }
        // A posterior's occlusal table, however many polygons it is drawn in.
        for (const region of centralRegionsOf(tooth)) {
          resolved.push({ id: region.id, surface: 'O', points: region.points })
        }
        break
      }
    }
  }

  return resolved
}

// ---------------------------------------------------------------------------
// merging contiguous surfaces
// ---------------------------------------------------------------------------

/** Coordinates are rounded to this many decimals before anything is compared. */
const PRECISION = 3

function round(value: number): number {
  const factor = 10 ** PRECISION
  return Math.round(value * factor) / factor
}

function key(point: NtsPoint): string {
  return `${round(point.x)},${round(point.y)}`
}

/** An undirected segment, named so the two directions collide. */
function segmentKey(a: NtsPoint, b: NtsPoint): string {
  const first = key(a)
  const second = key(b)
  return first < second ? `${first}|${second}` : `${second}|${first}`
}

function onSegment(a: NtsPoint, b: NtsPoint, p: NtsPoint): boolean {
  const cross = (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x)
  if (Math.abs(cross) > 1e-6) return false
  const withinX = p.x > Math.min(a.x, b.x) + 1e-9 && p.x < Math.max(a.x, b.x) - 1e-9
  const withinY = p.y > Math.min(a.y, b.y) + 1e-9 && p.y < Math.max(a.y, b.y) - 1e-9
  return withinX || withinY
}

/**
 * Split every edge wherever another polygon has a vertex on it.
 *
 * Without this the cancellation below silently fails. A crown's outer
 * trapezoid meets the central table along **one** long edge, while the table's
 * own polygons split that same span into halves, so the long edge and the two
 * short ones are not duplicates of each other and neither cancels. Subdividing
 * first makes them literally the same segments.
 */
function subdivide(rings: readonly NtsPoint[][]): NtsPoint[][][] {
  const vertices: NtsPoint[] = []
  const seen = new Set<string>()
  for (const ring of rings) {
    for (const point of ring) {
      const id = key(point)
      if (!seen.has(id)) {
        seen.add(id)
        vertices.push(point)
      }
    }
  }

  return rings.map(ring =>
    ring.flatMap((start, index) => {
      const end = ring[(index + 1) % ring.length]!
      const inner = vertices
        .filter(vertex => onSegment(start, end, vertex))
        .sort((a, b) => (a.x - start.x) ** 2 + (a.y - start.y) ** 2
          - ((b.x - start.x) ** 2 + (b.y - start.y) ** 2))
      const chain = [start, ...inner, end]
      return chain.slice(0, -1).map((from, i) => [from, chain[i + 1]!] as NtsPoint[])
    })
  )
}

/** Regions that share at least one subdivided edge belong to one figure. */
function groupByAdjacency(edgesPerRing: readonly NtsPoint[][][]): number[][] {
  const owners = new Map<string, number[]>()
  edgesPerRing.forEach((edges, index) => {
    for (const [a, b] of edges) {
      const id = segmentKey(a!, b!)
      const bucket = owners.get(id)
      if (bucket) bucket.push(index)
      else owners.set(id, [index])
    }
  })

  const parent = edgesPerRing.map((_, index) => index)
  const find = (x: number): number => (parent[x] === x ? x : (parent[x] = find(parent[x]!)))
  const union = (a: number, b: number) => { parent[find(a)] = find(b) }

  for (const bucket of owners.values()) {
    for (let i = 1; i < bucket.length; i++) union(bucket[0]!, bucket[i]!)
  }

  const groups = new Map<number, number[]>()
  edgesPerRing.forEach((_, index) => {
    const root = find(index)
    const bucket = groups.get(root)
    if (bucket) bucket.push(index)
    else groups.set(root, [index])
  })
  return [...groups.values()].map(group => group.sort((a, b) => a - b))
}

/**
 * The outline of a set of rings: every edge that only one of them owns.
 *
 * An edge shared by two rings is interior to the figure, and the clinical
 * decision is that a continuous affected area shows no internal divider — so
 * shared edges are dropped and the survivors are chained into closed loops.
 */
function boundaryOf(edgesPerRing: readonly NtsPoint[][][]): NtsPoint[][] {
  const counts = new Map<string, number>()
  const byKey = new Map<string, NtsPoint[]>()
  for (const edges of edgesPerRing) {
    for (const edge of edges) {
      const id = segmentKey(edge[0]!, edge[1]!)
      counts.set(id, (counts.get(id) ?? 0) + 1)
      byKey.set(id, edge)
    }
  }

  const outer = [...counts.entries()]
    .filter(([, count]) => count === 1)
    .map(([id]) => byKey.get(id)!)

  return orient(chain(outer))
}

/** Twice the signed area of a ring: positive one way round, negative the other. */
function cross(ring: readonly NtsPoint[]): number {
  let sum = 0
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i]!
    const b = ring[(i + 1) % ring.length]!
    sum += a.x * b.y - b.x * a.y
  }
  return sum
}

function encloses(ring: readonly NtsPoint[], point: NtsPoint): boolean {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i]!
    const b = ring[j]!
    const straddles = (a.y > point.y) !== (b.y > point.y)
    if (straddles && point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x) {
      inside = !inside
    }
  }
  return inside
}

/**
 * Wind outer loops one way and enclosed loops the other.
 *
 * A figure can now have a hole in it: an anterior with its vestibular, incisal
 * and lingual surfaces affected leaves two unaffected slivers trapped inside
 * the crown, because the incisal band is inset from the boundaries it must not
 * sit on. The chained loops are all equally valid rings and carry no hint of
 * which is rim and which is hole, so nesting is decided here, once. Nesting
 * depth is odd for a hole and even for a rim; winding them oppositely makes
 * the loops usable as a single path under either fill rule, and makes the
 * signed areas sum to the figure's true area.
 */
function orient(loops: NtsPoint[][]): NtsPoint[][] {
  return loops.map(loop => {
    const depth = loops.filter(other => other !== loop && encloses(other, loop[0]!)).length
    const wantPositive = depth % 2 === 0
    return (cross(loop) > 0) === wantPositive ? loop : [...loop].reverse()
  })
}

/** Walk the surviving edges into closed rings. */
function chain(edges: readonly NtsPoint[][]): NtsPoint[][] {
  const adjacency = new Map<string, NtsPoint[][]>()
  for (const edge of edges) {
    for (const [from, to] of [[edge[0]!, edge[1]!], [edge[1]!, edge[0]!]] as const) {
      const bucket = adjacency.get(key(from))
      if (bucket) bucket.push([from, to])
      else adjacency.set(key(from), [[from, to]])
    }
  }

  const used = new Set<string>()
  const loops: NtsPoint[][] = []

  // Started from the lexicographically smallest vertex, and at each step the
  // smallest unused continuation, so the same input always walks the same way.
  const starts = [...adjacency.keys()].sort()
  for (const start of starts) {
    let current = start
    const loop: NtsPoint[] = []
    for (;;) {
      const options = (adjacency.get(current) ?? [])
        .filter(([from, to]) => !used.has(segmentKey(from!, to!)))
        .sort((a, b) => (key(a[1]!) < key(b[1]!) ? -1 : 1))
      const next = options[0]
      if (!next) break
      used.add(segmentKey(next[0]!, next[1]!))
      loop.push(next[0]!)
      current = key(next[1]!)
      if (current === start) break
    }
    if (loop.length >= 3) loops.push(loop)
  }

  return loops
}

/**
 * Merge a set of rings into continuous figures, and outline each one.
 *
 * Rings that share an edge become one figure with one rim and no internal
 * divider; rings that only touch at a point, or not at all, stay separate.
 * Nothing is ever bridged across a gap.
 *
 * Exposed as plain geometry because a second consumer needs exactly this and
 * nothing clinical: a mark anchored to a landmark inside the crown is drawn
 * from the tiles that landmark covers, and merging those is the same problem.
 * Giving it its own copy of the algorithm is how two answers start to drift.
 *
 * Order-independent given a stable input order, and it does not reorder the
 * rings it is given.
 */
export function mergeRegions(rings: readonly NtsPoint[][]): NtsRegionFigure[] {
  if (rings.length === 0) return []
  const edgesPerRing = subdivide(rings)

  return groupByAdjacency(edgesPerRing).map(indices => ({
    polygons: indices.map(i => rings[i]!),
    boundary: boundaryOf(indices.map(i => edgesPerRing[i]!))
  }))
}

/**
 * The figures a set of surfaces makes on one tooth.
 *
 * Contiguous surfaces merge into a single component with one outline; surfaces
 * that do not touch stay separate. Nothing is bridged: a mesial and a distal
 * lesion with a sound occlusal between them are two findings' worth of
 * geometry on one tooth, and drawing them as one shape would claim the middle
 * was affected too.
 *
 * Order-independent: the surfaces are put in a canonical order first, so
 * `['M','O']` and `['O','M']` return the identical structure.
 */
export function resolveSurfaceComponents(
  fdi: number,
  surfaces: readonly string[]
): NtsSurfaceComponent[] {
  const regions = resolveSurfaceRegions(fdi, surfaces)
  if (regions.length === 0) return []

  const rings = regions.map(region => region.points)
  const surfaceOf = new Map(rings.map((ring, index) => [ring, regions[index]!.surface]))

  return mergeRegions(rings)
    .map(figure => ({
      surfaces: CANONICAL.filter(
        code => figure.polygons.some(ring => surfaceOf.get(ring) === code)
      ),
      ...figure
    }))
    .sort((a, b) => (a.surfaces.join() < b.surfaces.join() ? -1 : 1))
}

// ---------------------------------------------------------------------------
// what a consumer actually asks for
// ---------------------------------------------------------------------------

export interface NtsSurfaceResolution {
  /** The crown regions the surfaces cover — the exact tiling. */
  regions: NtsSurfaceRegion[]
  /** Those regions merged into continuous figures. */
  components: NtsSurfaceComponent[]
  /**
   * The incisal mark, when an anterior's occlusal surface is among them.
   *
   * A convenience, not a second shape: its `points` is the very array that
   * appears in `regions` and is merged into `components`, so there is exactly
   * one geometry for that surface and no way for a fill and an outline to be
   * drawn from different ones. `clearance` is the only thing it adds.
   */
  incisal: NtsIncisalBand | null
}

/**
 * Everything the surface policy has to say about one tooth and one set of
 * surfaces, resolved together so the parts cannot be used inconsistently.
 */
export function resolveSurfaces(
  fdi: number,
  surfaces: readonly string[]
): NtsSurfaceResolution {
  const regions = resolveSurfaceRegions(fdi, surfaces)
  return {
    regions,
    components: resolveSurfaceComponents(fdi, surfaces),
    incisal: regions.some(region => region.id === 'incisal') ? incisalBand(fdi) : null
  }
}
