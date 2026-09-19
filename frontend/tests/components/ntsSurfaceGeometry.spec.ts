/**
 * NTS-05D.4b — the clinically validated surface policy, and the root geometry
 * that goes with it.
 *
 * Two things are pinned here, and the difference between them matters.
 *
 * NTS N.° 188 supplies the surface *vocabulary* — M, D, O, V, L — and then
 * says the mark is drawn "según la forma que se observa". It never states
 * which part of a drawn crown a surface code corresponds to. Every
 * correspondence asserted below is therefore a **DenPlant product decision,
 * validated by a dentist**, and these tests exist so that decision stays
 * decided. They are not a reading of the norm and must never be cited as one.
 *
 * The one assertion that is emphatically not a matter of taste is the
 * vestibular/lingual orientation. A provisional design document had it the
 * other way round; the clinician's ruling reversed it, and the guard below
 * fails loudly rather than letting a future reader of that document quietly
 * flip it back.
 *
 * Module-layer files are imported by relative path: `frontend/module_layers`
 * does not resolve on this Windows host, so the layer's auto-imports are
 * unavailable in the test environment.
 */

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import {
  incisalBand,
  resolveSurfaceComponents,
  resolveSurfaceRegions,
  resolveSurfaces
} from '../../../backend/app/modules/odontogram/frontend/utils/ntsSurfaceGeometry'
import type {
  NtsSurfaceCode,
  NtsSurfaceComponent
} from '../../../backend/app/modules/odontogram/frontend/utils/ntsSurfaceGeometry'
import {
  NTS_ALL_TEETH,
  NTS_BLEED,
  NTS_CELL_HEIGHT,
  centralRegionCountFor,
  isAnterior,
  rootCountFor,
  toothGeometry
} from '../../../backend/app/modules/odontogram/frontend/utils/ntsDentition'
import type {
  NtsPoint,
  NtsTooth
} from '../../../backend/app/modules/odontogram/frontend/utils/ntsDentition'
import {
  NTS_PLACEMENTS,
  apexPoint,
  rootAxes,
  rootBox
} from '../../../backend/app/modules/odontogram/frontend/utils/ntsChartGeometry'

const UTILS = resolve(
  __dirname,
  '../../../backend/app/modules/odontogram/frontend/utils'
)

const tooth = (fdi: number): NtsTooth => NTS_ALL_TEETH.find(t => t.fdi === fdi)!

const regionOf = (fdi: number, surface: NtsSurfaceCode): string =>
  resolveSurfaceRegions(fdi, [surface])[0]!.id

/** Signed area of a ring, by the shoelace formula: sign follows the winding. */
function signedArea(ring: readonly NtsPoint[]): number {
  let sum = 0
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i]!
    const b = ring[(i + 1) % ring.length]!
    sum += a.x * b.y - b.x * a.y
  }
  return sum / 2
}

const area = (ring: readonly NtsPoint[]): number => Math.abs(signedArea(ring))

const componentArea = (component: NtsSurfaceComponent): number =>
  component.polygons.reduce((total, ring) => total + area(ring), 0)

/**
 * Area shared by two convex rings, by Sutherland–Hodgman clipping.
 *
 * Every shape here is convex — a rectangle or a trapezoid — so clipping one
 * against the other's half-planes gives the exact intersection. Used to prove
 * that two regions *touch* without *overlapping*: an edge in common has zero
 * area, so any positive result means one is claiming the other's surface.
 */
function intersectionArea(subject: readonly NtsPoint[], clip: readonly NtsPoint[]): number {
  // Both rings are walked in a known winding so "inside" has one meaning.
  const wind = (ring: readonly NtsPoint[]) =>
    signedArea(ring) < 0 ? [...ring].reverse() : [...ring]
  const box = wind(clip)
  let out = wind(subject)

  for (let i = 0; i < box.length && out.length > 0; i++) {
    const a = box[i]!
    const b = box[(i + 1) % box.length]!
    const side = (p: NtsPoint) => (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x)
    const input = out
    out = []
    for (let j = 0; j < input.length; j++) {
      const current = input[j]!
      const previous = input[(j + input.length - 1) % input.length]!
      const sCurrent = side(current)
      const sPrevious = side(previous)
      if (sCurrent >= 0) {
        if (sPrevious < 0) {
          const t = sPrevious / (sPrevious - sCurrent)
          out.push({
            x: previous.x + t * (current.x - previous.x),
            y: previous.y + t * (current.y - previous.y)
          })
        }
        out.push(current)
      } else if (sPrevious >= 0) {
        const t = sPrevious / (sPrevious - sCurrent)
        out.push({
          x: previous.x + t * (current.x - previous.x),
          y: previous.y + t * (current.y - previous.y)
        })
      }
    }
  }
  return out.length < 3 ? 0 : area(out)
}

/**
 * The area the outline actually encloses.
 *
 * Summed *signed*, so a hole — wound against its rim — subtracts itself
 * instead of being counted as more covered area.
 */
const boundaryArea = (component: NtsSurfaceComponent): number =>
  Math.abs(component.boundary.reduce((total, ring) => total + signedArea(ring), 0))

// ---------------------------------------------------------------------------
// A — mesial and distal follow the quadrant
// ---------------------------------------------------------------------------

describe('A — mesial faces the midline, so it depends on the quadrant', () => {
  it.each([
    [18, 'outer-right'],
    [11, 'outer-right'],
    [28, 'outer-left'],
    [21, 'outer-left'],
    [46, 'outer-right'],
    [36, 'outer-left'],
    [55, 'outer-right'],
    [65, 'outer-left'],
    [85, 'outer-right'],
    [75, 'outer-left']
  ])('%i takes its mesial from the side of the mouth it is on', (fdi, expected) => {
    expect(regionOf(fdi, 'M')).toBe(expected)
  })

  it('distal is always the opposite trapezoid, never the same one', () => {
    for (const t of NTS_ALL_TEETH) {
      const mesial = regionOf(t.fdi, 'M')
      const distal = regionOf(t.fdi, 'D')
      expect(new Set([mesial, distal])).toEqual(new Set(['outer-left', 'outer-right']))
    }
  })

  it('a fixed left-is-mesial rule would be wrong for half the mouth', () => {
    const mesialOnTheLeft = NTS_ALL_TEETH.filter(t => regionOf(t.fdi, 'M') === 'outer-left')
    expect(mesialOnTheLeft).toHaveLength(NTS_ALL_TEETH.length / 2)
  })

  it('mesial and distal are horizontal — never the vestibular or lingual side', () => {
    for (const t of NTS_ALL_TEETH) {
      for (const surface of ['M', 'D'] as const) {
        expect(regionOf(t.fdi, surface)).toMatch(/^outer-(left|right)$/)
      }
    }
  })
})

// ---------------------------------------------------------------------------
// B — vestibular faces outward. THE CLINICIAN'S RULING.
// ---------------------------------------------------------------------------

describe('B — vestibular faces outward in both arches', () => {
  it('every upper tooth puts vestibular at the top and lingual at the bottom', () => {
    const upper = NTS_ALL_TEETH.filter(t => t.arch === 'upper')
    expect(upper).toHaveLength(26)
    for (const t of upper) {
      expect(regionOf(t.fdi, 'V')).toBe('outer-top')
      expect(regionOf(t.fdi, 'L')).toBe('outer-bottom')
    }
  })

  it('every lower tooth puts vestibular at the bottom and lingual at the top', () => {
    const lower = NTS_ALL_TEETH.filter(t => t.arch === 'lower')
    expect(lower).toHaveLength(26)
    for (const t of lower) {
      expect(regionOf(t.fdi, 'V')).toBe('outer-bottom')
      expect(regionOf(t.fdi, 'L')).toBe('outer-top')
    }
  })

  it('REGRESSION GUARD — the provisional, reversed reading must never come back', () => {
    // A pre-implementation design note proposed upper V at the bottom. The
    // dentist reviewed it and ruled the opposite: vestibular faces outward in
    // both arches, so on this chart it is the top of the upper row and the
    // bottom of the lower one. If this test starts failing, someone has
    // re-derived the mapping from the superseded note — restore the ruling,
    // do not update the expectation.
    expect(regionOf(11, 'V')).not.toBe('outer-bottom')
    expect(regionOf(11, 'L')).not.toBe('outer-top')
    expect(regionOf(41, 'V')).not.toBe('outer-top')
    expect(regionOf(41, 'L')).not.toBe('outer-bottom')
  })

  it('the two arches mirror each other, and the deciduous rows follow their arch', () => {
    for (const t of NTS_ALL_TEETH) {
      expect(regionOf(t.fdi, 'V')).toBe(t.arch === 'upper' ? 'outer-top' : 'outer-bottom')
      expect(regionOf(t.fdi, 'V')).not.toBe(regionOf(t.fdi, 'L'))
    }
    // Deciduous teeth take the same side as the permanent teeth above them.
    expect(regionOf(55, 'V')).toBe(regionOf(15, 'V'))
    expect(regionOf(85, 'V')).toBe(regionOf(45, 'V'))
  })

  it('vestibular does not depend on the quadrant, and mesial does not depend on the arch', () => {
    expect(regionOf(18, 'V')).toBe(regionOf(28, 'V'))
    expect(regionOf(18, 'M')).not.toBe(regionOf(28, 'M'))
    expect(regionOf(18, 'M')).toBe(regionOf(48, 'M'))
    expect(regionOf(18, 'V')).not.toBe(regionOf(48, 'V'))
  })
})

// ---------------------------------------------------------------------------
// C — occlusal is the central table, however it is subdivided
// ---------------------------------------------------------------------------

describe('C — occlusal is the whole central table', () => {
  it('takes every central polygon the class is drawn with', () => {
    for (const t of NTS_ALL_TEETH.filter(t => !isAnterior(t))) {
      const regions = resolveSurfaceRegions(t.fdi, ['O'])
      expect(regions).toHaveLength(centralRegionCountFor(t))
      for (const region of regions) {
        expect(region.surface).toBe('O')
        expect(region.id.startsWith('center')).toBe(true)
      }
    }
  })

  it('on an anterior it is the incisal band, and nothing else', () => {
    for (const t of NTS_ALL_TEETH.filter(isAnterior)) {
      const regions = resolveSurfaceRegions(t.fdi, ['O'])
      expect(regions, String(t.fdi)).toHaveLength(1)
      expect(regions[0]!.id).toBe('incisal')
      expect(regions[0]!.surface).toBe('O')
    }
  })

  it.each([[16, 4], [14, 2], [11, 1], [55, 4], [51, 1]])(
    '%i resolves to %i occlusal polygon(s)',
    (fdi, count) => {
      expect(resolveSurfaceRegions(fdi, ['O'])).toHaveLength(count)
    }
  )

  it('covers exactly the central zone, no more and no less', () => {
    const geometry = toothGeometry(tooth(16))
    const central = geometry.regions.filter(r => r.id.startsWith('center'))
    const resolved = resolveSurfaceRegions(16, ['O'])
    const total = resolved.reduce((sum, r) => sum + area(r.points), 0)
    expect(total).toBeCloseTo(central.reduce((sum, r) => sum + area(r.points), 0), 6)
  })

  it('never claims a lateral trapezoid', () => {
    for (const t of NTS_ALL_TEETH) {
      for (const region of resolveSurfaceRegions(t.fdi, ['O'])) {
        expect(region.id.startsWith('outer-')).toBe(false)
      }
    }
  })
})

// ---------------------------------------------------------------------------
// D — the incisal band on an anterior
// ---------------------------------------------------------------------------

describe('D — an anterior shows its incisal surface as a centred horizontal mark', () => {
  it('exists for every incisor and canine, in both dentitions', () => {
    for (const t of NTS_ALL_TEETH.filter(isAnterior)) {
      expect(incisalBand(t.fdi), String(t.fdi)).not.toBeNull()
    }
    expect(incisalBand(51)).not.toBeNull()
    expect(incisalBand(13)).not.toBeNull()
  })

  it('does not exist for a posterior, which has a real occlusal table', () => {
    for (const t of NTS_ALL_TEETH.filter(t => !isAnterior(t))) {
      expect(incisalBand(t.fdi), String(t.fdi)).toBeNull()
    }
  })

  it('is centred on the middle of the tooth in both directions', () => {
    const geometry = toothGeometry(tooth(11))
    const band = incisalBand(11)!
    const xs = band.points.map(p => p.x)
    const ys = band.points.map(p => p.y)

    expect((Math.min(...xs) + Math.max(...xs)) / 2)
      .toBeCloseTo(geometry.crown.x + geometry.crown.width / 2, 6)

    const centre = geometry.regions.find(r => r.id === 'center')!
    const zoneYs = centre.points.map(p => p.y)
    expect((Math.min(...ys) + Math.max(...ys)) / 2)
      .toBeCloseTo((Math.min(...zoneYs) + Math.max(...zoneYs)) / 2, 6)
  })

  it('CLINICAL RULING — never sits on the vestibular/lingual divide', () => {
    // The ruling is a zone in the middle of the tooth, explicitly not a mark
    // placed on the line between vestibular and lingual. The band therefore
    // keeps clear air above and below it.
    for (const t of NTS_ALL_TEETH.filter(isAnterior)) {
      const centre = toothGeometry(t).regions.find(r => r.id === 'center')!
      const zoneYs = centre.points.map(p => p.y)
      const band = incisalBand(t.fdi)!
      const bandYs = band.points.map(p => p.y)

      expect(band.clearance).toBeGreaterThan(0)
      expect(Math.min(...bandYs)).toBeGreaterThan(Math.min(...zoneYs))
      expect(Math.max(...bandYs)).toBeLessThan(Math.max(...zoneYs))
    }
  })

  it('SUPERSEDED READING — it must never be widened past the central zone', () => {
    // An earlier revision set the width to a flat 50% of the crown, which put
    // the band over the mesial and distal trapezoids — claiming surfaces that
    // had not been recorded, and making the band overlap its neighbours
    // instead of meeting them, so it could not tile either. The width is now
    // the zone's own and is not a constant at all. If this fails, someone has
    // reintroduced a chosen width.
    for (const t of NTS_ALL_TEETH.filter(isAnterior)) {
      const centre = toothGeometry(t).regions.find(r => r.id === 'center')!
      const zoneXs = centre.points.map(p => p.x)
      const bandXs = incisalBand(t.fdi)!.points.map(p => p.x)

      expect(Math.min(...bandXs), String(t.fdi)).toBe(Math.min(...zoneXs))
      expect(Math.max(...bandXs), String(t.fdi)).toBe(Math.max(...zoneXs))
    }
  })

  it('never overlaps the mesial or distal trapezoid — it meets them edge to edge', () => {
    for (const t of NTS_ALL_TEETH.filter(isAnterior)) {
      const band = incisalBand(t.fdi)!
      const bandXs = band.points.map(p => p.x)
      for (const id of ['outer-left', 'outer-right']) {
        const trapezoid = toothGeometry(t).regions.find(r => r.id === id)!
        const overlap = intersectionArea(band.points, trapezoid.points)
        expect(overlap, `${t.fdi} ${id}`).toBe(0)
      }
      // Its own sides are exactly where the trapezoids end.
      const inner = toothGeometry(t).regions
        .find(r => r.id === 'outer-left')!.points.map(p => p.x)
      expect(Math.min(...bandXs)).toBe(Math.max(...inner))
    }
  })

  it('never overlaps the vestibular or lingual trapezoid either', () => {
    for (const t of NTS_ALL_TEETH.filter(isAnterior)) {
      const band = incisalBand(t.fdi)!
      for (const id of ['outer-top', 'outer-bottom']) {
        const trapezoid = toothGeometry(t).regions.find(r => r.id === id)!
        expect(intersectionArea(band.points, trapezoid.points), `${t.fdi} ${id}`).toBe(0)
      }
    }
  })

  it('is the one and only geometry for that surface', () => {
    // No "logical" shape beside a "visual" one: `regions`, `components` and
    // `incisal` all carry the identical polygon, by reference.
    const resolution = resolveSurfaces(11, ['O'])
    const band = incisalBand(11)!

    expect(resolution.regions.map(r => r.id)).toEqual(['incisal'])
    expect(resolution.regions[0]!.points).toBe(band.points)
    expect(resolution.components).toHaveLength(1)
    expect(resolution.components[0]!.polygons[0]).toBe(band.points)
    expect(resolution.incisal!.points).toBe(band.points)
  })

  it('is offered only when the occlusal surface is actually involved', () => {
    expect(resolveSurfaces(11, ['M', 'V']).incisal).toBeNull()
    expect(resolveSurfaces(11, ['M', 'O']).incisal).not.toBeNull()
    // A posterior never has one, whatever is recorded.
    expect(resolveSurfaces(16, ['O']).incisal).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// E — contiguous surfaces merge; separated ones do not
// ---------------------------------------------------------------------------

describe('E — contiguous surfaces read as one continuous figure', () => {
  it('a single surface is one figure outlined by its own ring', () => {
    const [component, ...rest] = resolveSurfaceComponents(16, ['M'])
    expect(rest).toHaveLength(0)
    expect(component!.surfaces).toEqual(['M'])
    expect(component!.boundary).toHaveLength(1)
    expect(boundaryArea(component!)).toBeCloseTo(componentArea(component!), 6)
  })

  it('an occlusal surface merges its own polygons with no internal divider', () => {
    const [component] = resolveSurfaceComponents(16, ['O'])
    expect(component!.polygons).toHaveLength(4)
    expect(component!.boundary).toHaveLength(1)
    // The outline encloses exactly the four tiles: no edge was left inside and
    // none was dropped from the rim.
    expect(boundaryArea(component!)).toBeCloseTo(componentArea(component!), 6)
  })

  it('mesial and occlusal touch along a shared edge and become one figure', () => {
    const components = resolveSurfaceComponents(16, ['M', 'O'])
    expect(components).toHaveLength(1)
    expect(components[0]!.surfaces).toEqual(['M', 'O'])
    expect(components[0]!.polygons).toHaveLength(5)
    expect(components[0]!.boundary).toHaveLength(1)
    expect(boundaryArea(components[0]!)).toBeCloseTo(componentArea(components[0]!), 6)
  })

  it('mesial and vestibular touch along the diagonal and become one figure', () => {
    const components = resolveSurfaceComponents(16, ['M', 'V'])
    expect(components).toHaveLength(1)
    expect(components[0]!.boundary).toHaveLength(1)
    expect(boundaryArea(components[0]!)).toBeCloseTo(componentArea(components[0]!), 6)
  })

  it('mesial and distal are not contiguous, and are not bridged', () => {
    // Drawing them as one shape would claim the sound surface between them was
    // affected too.
    const components = resolveSurfaceComponents(16, ['M', 'D'])
    expect(components).toHaveLength(2)
    expect(components.map(c => c.surfaces)).toEqual([['D'], ['M']])
    for (const component of components) {
      expect(component.boundary).toHaveLength(1)
    }
  })

  it('an occlusal surface between them joins the two into one', () => {
    const components = resolveSurfaceComponents(16, ['M', 'O', 'D'])
    expect(components).toHaveLength(1)
    expect(components[0]!.surfaces).toEqual(['M', 'O', 'D'])
    expect(boundaryArea(components[0]!)).toBeCloseTo(componentArea(components[0]!), 6)
  })

  it('every surface at once outlines the whole crown', () => {
    const [component] = resolveSurfaceComponents(16, ['M', 'D', 'O', 'V', 'L'])
    const crown = toothGeometry(tooth(16)).crown
    expect(component!.boundary).toHaveLength(1)
    expect(boundaryArea(component!)).toBeCloseTo(crown.width * crown.height, 4)
  })

  it('holds for every tooth class, not just the four-tiled molar', () => {
    for (const fdi of [16, 14, 11, 55, 51, 36, 45]) {
      for (const surfaces of [['O'], ['M', 'O'], ['V', 'O', 'L'], ['M', 'O', 'D', 'V', 'L']]) {
        for (const component of resolveSurfaceComponents(fdi, surfaces)) {
          expect(boundaryArea(component), `${fdi} ${surfaces.join('')}`)
            .toBeCloseTo(componentArea(component), 4)
        }
      }
    }
  })

  it('a merged outline keeps no trace of the seams inside it', () => {
    // Every boundary vertex lies on the rim of the merged figure, so an
    // outline drawn from it cannot cut across the middle.
    const [component] = resolveSurfaceComponents(16, ['V', 'O'])
    const all = component!.polygons.flat()
    const xs = all.map(p => p.x)
    const ys = all.map(p => p.y)
    for (const point of component!.boundary.flat()) {
      expect(point.x).toBeGreaterThanOrEqual(Math.min(...xs) - 1e-9)
      expect(point.x).toBeLessThanOrEqual(Math.max(...xs) + 1e-9)
      expect(point.y).toBeGreaterThanOrEqual(Math.min(...ys) - 1e-9)
      expect(point.y).toBeLessThanOrEqual(Math.max(...ys) + 1e-9)
    }
  })

  it.each([11, 13, 21, 41, 33, 51, 63, 83])(
    'anterior %i — the band shares a partial vertical edge with M and with D',
    (fdi) => {
      // The band spans the central zone edge to edge but is inset vertically,
      // so its side is only *part* of the trapezoid's inner edge. Cancellation
      // therefore depends on the subdivision step splitting that long edge at
      // the band's two corners. Asserted, not assumed.
      for (const pair of [['M', 'O'], ['O', 'D']]) {
        const components = resolveSurfaceComponents(fdi, pair)
        expect(components, `${fdi} ${pair.join('+')}`).toHaveLength(1)
        expect(components[0]!.polygons).toHaveLength(2)
        expect(components[0]!.boundary).toHaveLength(1)
      }
    }
  )

  it.each([11, 13, 41, 33, 51, 83])('anterior %i — M+O+D is one figure', (fdi) => {
    const components = resolveSurfaceComponents(fdi, ['M', 'O', 'D'])
    expect(components).toHaveLength(1)
    expect(components[0]!.surfaces).toEqual(['M', 'O', 'D'])
    expect(components[0]!.boundary).toHaveLength(1)
  })

  it.each([11, 13, 41, 33, 51, 83])('anterior %i — M+D stays two figures', (fdi) => {
    expect(resolveSurfaceComponents(fdi, ['M', 'D'])).toHaveLength(2)
  })

  it('anterior V+O and L+O are two figures — and that is the real topology', () => {
    // Not an artificial result and not something to "fix". The band is inset
    // from the vestibular and lingual boundaries precisely so it never sits on
    // the divide between them; the price is that it does not touch them
    // either. Bridging the gap would draw a shape over sound enamel.
    for (const fdi of [11, 13, 41, 33]) {
      for (const pair of [['V', 'O'], ['L', 'O']]) {
        const components = resolveSurfaceComponents(fdi, pair)
        expect(components, `${fdi} ${pair.join('+')}`).toHaveLength(2)
        for (const component of components) {
          expect(component.boundary).toHaveLength(1)
          expect(boundaryArea(component)).toBeCloseTo(componentArea(component), 6)
        }
      }
    }
  })

  it('OUTLINE READINESS — an anterior outline keeps no internal segment', () => {
    // The identity 6.1.34 depends on: what the contour encloses is exactly
    // what the fill covers, so the shared edge between the trapezoid and the
    // band cannot have survived.
    for (const fdi of [11, 13, 21, 41, 33, 51, 63, 83]) {
      for (const surfaces of [['M', 'O'], ['O', 'D'], ['M', 'O', 'D']]) {
        for (const component of resolveSurfaceComponents(fdi, surfaces)) {
          expect(boundaryArea(component), `${fdi} ${surfaces.join('')}`)
            .toBeCloseTo(componentArea(component), 6)
        }
      }
    }
  })

  it('an anterior with every surface has two holes, and the arithmetic holds', () => {
    // The four trapezoids close a ring around the central zone; the band fills
    // its middle and reaches M and D, so the figure is continuous. What it is
    // not is solid: the slivers above and below the band were never recorded
    // as affected, and they stay unfilled.
    const [component, ...rest] = resolveSurfaceComponents(11, ['M', 'D', 'O', 'V', 'L'])
    expect(rest).toHaveLength(0)
    expect(component!.boundary).toHaveLength(3)

    // Rim and holes are wound oppositely, so the signed areas net out to the
    // area actually covered rather than adding the holes back in.
    expect(boundaryArea(component!)).toBeCloseTo(componentArea(component!), 6)
    const naive = component!.boundary.reduce((sum, loop) => sum + area(loop), 0)
    expect(naive).toBeGreaterThan(componentArea(component!))

    // And the covered area is the crown less exactly those two slivers.
    const crown = toothGeometry(tooth(11)).crown
    const centre = toothGeometry(tooth(11)).regions.find(r => r.id === 'center')!
    const band = incisalBand(11)!
    const slivers = area(centre.points) - area(band.points)
    expect(boundaryArea(component!)).toBeCloseTo(crown.width * crown.height - slivers, 4)
  })

  it('the boundary closes: every vertex is met by exactly two edges', () => {
    for (const fdi of [16, 14, 11]) {
      for (const component of resolveSurfaceComponents(fdi, ['M', 'O', 'V'])) {
        for (const loop of component.boundary) {
          const seen = new Set(loop.map(p => `${p.x},${p.y}`))
          expect(seen.size).toBe(loop.length)
          expect(loop.length).toBeGreaterThanOrEqual(3)
        }
      }
    }
  })
})

// ---------------------------------------------------------------------------
// F — the result does not depend on how the surfaces were written down
// ---------------------------------------------------------------------------

describe('F — resolution is order-independent and total', () => {
  it('the same surfaces in any order give the identical result', () => {
    const orders = [
      ['M', 'O', 'V'],
      ['V', 'M', 'O'],
      ['O', 'V', 'M'],
      ['V', 'O', 'M']
    ]
    const first = JSON.stringify(resolveSurfaces(16, orders[0]!))
    for (const order of orders.slice(1)) {
      expect(JSON.stringify(resolveSurfaces(16, order))).toBe(first)
    }
  })

  it('a repeated surface is not drawn twice', () => {
    expect(resolveSurfaceRegions(16, ['M', 'M'])).toEqual(resolveSurfaceRegions(16, ['M']))
  })

  it('an unrecognised code contributes nothing rather than a guess', () => {
    expect(resolveSurfaceRegions(16, ['X'])).toEqual([])
    expect(resolveSurfaceRegions(16, ['X', 'M'])).toEqual(resolveSurfaceRegions(16, ['M']))
  })

  it('no surfaces, or a tooth the chart does not draw, yields nothing', () => {
    expect(resolveSurfaceRegions(16, [])).toEqual([])
    expect(resolveSurfaceComponents(16, [])).toEqual([])
    expect(resolveSurfaceRegions(99, ['M'])).toEqual([])
    expect(incisalBand(99)).toBeNull()
    expect(resolveSurfaces(99, ['M'])).toEqual({ regions: [], components: [], incisal: null })
  })

  it('is deterministic — the same call twice gives the same numbers', () => {
    expect(resolveSurfaces(16, ['M', 'O'])).toEqual(resolveSurfaces(16, ['M', 'O']))
  })

  it('every tooth resolves every surface to a region that exists', () => {
    for (const t of NTS_ALL_TEETH) {
      // `incisal` is the one shape the policy owns rather than borrows: it is
      // derived from the central zone but inset from it, so it is not one of
      // the drawing's tiles and is not expected among them.
      const ids = new Set([...toothGeometry(t).regions.map(r => r.id), 'incisal'])
      for (const region of resolveSurfaceRegions(t.fdi, ['M', 'D', 'O', 'V', 'L'])) {
        expect(ids.has(region.id), `${t.fdi} ${region.id}`).toBe(true)
        expect(region.points.length).toBeGreaterThanOrEqual(3)
        expect(area(region.points)).toBeGreaterThan(0)
      }
    }
  })

  it('every resolved region stays inside its crown', () => {
    for (const t of NTS_ALL_TEETH) {
      const { crown } = toothGeometry(t)
      for (const region of resolveSurfaceRegions(t.fdi, ['M', 'D', 'O', 'V', 'L'])) {
        for (const point of region.points) {
          expect(point.x, `${t.fdi} ${region.id}`).toBeGreaterThanOrEqual(crown.x - 1e-9)
          expect(point.x).toBeLessThanOrEqual(crown.x + crown.width + 1e-9)
          expect(point.y).toBeGreaterThanOrEqual(crown.y - 1e-9)
          expect(point.y).toBeLessThanOrEqual(crown.y + crown.height + 1e-9)
        }
      }
    }
  })
})

// ---------------------------------------------------------------------------
// G — three roots leave a common trunk
// ---------------------------------------------------------------------------

describe('G — a trifurcated root is not three separate triangles', () => {
  it('exactly the upper molars have three roots', () => {
    const three = NTS_ALL_TEETH.filter(t => rootCountFor(t) === 3).map(t => t.fdi)
    expect(three.sort((a, b) => a - b)).toEqual([16, 17, 18, 26, 27, 28, 54, 55, 64, 65])
  })

  it('the roots overlap at the base instead of standing apart', () => {
    for (const t of NTS_ALL_TEETH.filter(t => rootCountFor(t) === 3)) {
      const shapes = toothGeometry(t).rootShapes
      expect(shapes).toHaveLength(3)
      for (let i = 0; i < shapes.length - 1; i++) {
        // Positive overlap: the next root's base starts before this one ends.
        expect(shapes[i]!.right - shapes[i + 1]!.left, String(t.fdi)).toBeGreaterThan(0)
      }
    }
  })

  it('the apices stay far enough apart to be counted', () => {
    const shapes = toothGeometry(tooth(16)).rootShapes
    const tips = shapes.map(s => s.tip.x)
    expect(new Set(tips).size).toBe(3)
    expect(tips[1]! - tips[0]!).toBeGreaterThan(0)
    expect(tips[2]! - tips[1]!).toBeGreaterThan(0)
    // Symmetric about the crown's centre, so the middle root is the middle one.
    const crown = toothGeometry(tooth(16)).crown
    expect(tips[1]!).toBeCloseTo(crown.x + crown.width / 2, 6)
    expect(tips[2]! - tips[1]!).toBeCloseTo(tips[1]! - tips[0]!, 6)
  })

  it('every root stays inside the crown it grows from', () => {
    for (const t of NTS_ALL_TEETH.filter(t => rootCountFor(t) === 3)) {
      const { crown, rootShapes } = toothGeometry(t)
      for (const shape of rootShapes) {
        expect(shape.left).toBeGreaterThanOrEqual(crown.x)
        expect(shape.right).toBeLessThanOrEqual(crown.x + crown.width)
        expect(shape.tip.x).toBeGreaterThanOrEqual(crown.x)
        expect(shape.tip.x).toBeLessThanOrEqual(crown.x + crown.width)
      }
    }
  })

  it('a root still draws as one closed triangle, and the cell still gets a path each', () => {
    const geometry = toothGeometry(tooth(16))
    expect(geometry.roots).toHaveLength(3)
    for (const shape of geometry.rootShapes) {
      expect(shape.d).toMatch(/^M[-\d.]+,[-\d.]+ L[-\d.]+,[-\d.]+ L[-\d.]+,[-\d.]+ Z$/)
    }
    expect(geometry.roots).toEqual(geometry.rootShapes.map(s => s.d))
  })

  it('one- and two-rooted teeth are untouched', () => {
    // Golden strings: the change was scoped to the three-rooted case, and
    // these prove nothing else moved.
    expect(toothGeometry(tooth(11)).roots).toEqual(['M14.48,82 L34,2 L53.52,82 Z'])
    expect(toothGeometry(tooth(46)).roots).toEqual([
      'M7.9,68 L25.5,148 L43.1,68 Z',
      'M51.9,68 L69.5,148 L87.1,68 Z'
    ])
  })
})

// ---------------------------------------------------------------------------
// H — the overlays measured from the roots did not move
// ---------------------------------------------------------------------------

describe('H — everything placed against a root still lands where it did', () => {
  it('apex height is unchanged for every tooth on the chart', () => {
    for (const t of NTS_ALL_TEETH) {
      const expected = t.arch === 'upper'
        ? NTS_BLEED / 2
        : NTS_CELL_HEIGHT - NTS_BLEED / 2
      for (const shape of toothGeometry(t).rootShapes) {
        expect(shape.tip.y, String(t.fdi)).toBe(expected)
      }
    }
  })

  it('a root still meets its crown on the crown edge', () => {
    for (const t of NTS_ALL_TEETH) {
      const { crown, rootShapes } = toothGeometry(t)
      const expected = t.arch === 'upper' ? crown.y : crown.y + crown.height
      for (const shape of rootShapes) {
        expect(shape.base.y, String(t.fdi)).toBe(expected)
      }
    }
  })

  it('the chart-level apex of a three-rooted tooth did not move', () => {
    // Its three roots all reach the same height, so which one `apexPoint`
    // picks cannot matter — and that height is the one every molar has.
    const tips = toothGeometry(tooth(16)).rootShapes.map(s => s.tip.y)
    expect(new Set(tips).size).toBe(1)
    expect(apexPoint(16)!.y).toBeCloseTo(apexPoint(17)!.y, 6)
    expect(apexPoint(16)!.y).toBeCloseTo(apexPoint(26)!.y, 6)

    // A premolar's apex sits at a different chart height, and always did: the
    // cell fits each class with `meet`, so a narrower tooth resolves to a
    // slightly smaller scale. Nothing in this ticket touched that.
    expect(apexPoint(16)!.y).not.toBeCloseTo(apexPoint(15)!.y, 6)
  })

  it('the root box contains every axis, apices included', () => {
    // It used to be measured from the base edges alone, which was equivalent
    // while a tip always fell between its own two flanks. A leaning root
    // breaks that, so the box now takes the apices into account too.
    for (const placement of NTS_PLACEMENTS) {
      const box = rootBox(placement.fdi)!
      for (const axis of rootAxes(placement.fdi)) {
        for (const point of [axis.base, axis.tip]) {
          expect(point.x, String(placement.fdi)).toBeGreaterThanOrEqual(box.x - 0.001)
          expect(point.x).toBeLessThanOrEqual(box.x + box.width + 0.001)
        }
      }
    }
  })

  it('a one- or two-rooted box is unchanged: still exactly its base extent', () => {
    for (const placement of NTS_PLACEMENTS.filter(p => rootCountFor(p.tooth) < 3)) {
      const box = rootBox(placement.fdi)!
      const shapes = toothGeometry(placement.tooth).rootShapes
      const span = Math.max(...shapes.map(s => s.right)) - Math.min(...shapes.map(s => s.left))
      expect(box.width, String(placement.fdi)).toBeCloseTo(span * placement.scale, 6)
    }
  })

  it('a three-rooted box now contains all of the root geometry', () => {
    for (const placement of NTS_PLACEMENTS.filter(p => rootCountFor(p.tooth) === 3)) {
      const box = rootBox(placement.fdi)!
      const shapes = toothGeometry(placement.tooth).rootShapes
      const bases = Math.max(...shapes.map(s => s.right)) - Math.min(...shapes.map(s => s.left))

      // Wider than the bases alone, because the outer apices reach past them.
      expect(box.width, String(placement.fdi)).toBeGreaterThan(bases * placement.scale)

      // And wide enough for every corner of every triangle.
      const local = [...shapes.flatMap(s => [s.left, s.right, s.tip.x])]
      const span = Math.max(...local) - Math.min(...local)
      expect(box.width).toBeCloseTo(span * placement.scale, 6)
    }
  })
})

// ---------------------------------------------------------------------------
// I — the regions are still exactly what they were, now measurable
// ---------------------------------------------------------------------------

describe('I — a region carries its outline as points as well as a path', () => {
  it('the path is emitted from the points, for every region of every tooth', () => {
    for (const t of NTS_ALL_TEETH) {
      for (const region of toothGeometry(t).regions) {
        const [first, ...rest] = region.points
        const rebuilt = `M${first!.x},${first!.y} ${rest.map(p => `L${p.x},${p.y}`).join(' ')} Z`
        expect(region.d, `${t.fdi} ${region.id}`).toBe(rebuilt)
      }
    }
  })

  it('the regions tile the crown exactly — no gap, no overlap', () => {
    for (const t of NTS_ALL_TEETH) {
      const { crown, regions } = toothGeometry(t)
      const total = regions.reduce((sum, region) => sum + area(region.points), 0)
      expect(total, String(t.fdi)).toBeCloseTo(crown.width * crown.height, 4)
    }
  })

  it('every region is a closed ring of at least three points', () => {
    for (const t of NTS_ALL_TEETH) {
      for (const region of toothGeometry(t).regions) {
        expect(region.points.length).toBeGreaterThanOrEqual(3)
        expect(area(region.points)).toBeGreaterThan(0)
      }
    }
  })
})

// ---------------------------------------------------------------------------
// J — the policy module stays a policy module
// ---------------------------------------------------------------------------

describe('J — the module is pure, and owns only what it is allowed to own', () => {
  const source = readFileSync(resolve(UTILS, 'ntsSurfaceGeometry.ts'), 'utf8')
  const code = source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')

  it('reads nothing from a browser and imports no component', () => {
    for (const forbidden of ['document', 'window', 'navigator', 'getBoundingClientRect', 'vue']) {
      expect(code, forbidden).not.toContain(forbidden)
    }
  })

  it('decides nothing about colour', () => {
    for (const forbidden of ['fill', 'stroke', 'paint', '--color', '#']) {
      expect(code, forbidden).not.toContain(forbidden)
    }
  })

  it('branches on no rule id and reads no catalog', () => {
    expect(code).not.toMatch(/\b6\.\d+\.\d+\b/)
    expect(code).not.toMatch(/rule_?[Ii]d/)
    expect(code).not.toContain('catalog')
  })

  it('draws nothing — it has no path strings and emits no instruction', () => {
    expect(code).not.toMatch(/['"`]M\$?\{/)
    expect(code).not.toContain('renderShapeFill')
    expect(code).not.toContain('renderOutline')
    expect(code).not.toContain('instruction')
  })

  it('says in its own words that the mapping is not normative', () => {
    expect(source).toContain('clinically validated')
    expect(source).toMatch(/never a normative mapping|not a table NTS N\.° 188 defines/)
  })
})
