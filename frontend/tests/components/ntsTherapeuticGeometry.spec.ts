/** DP-08.A — the Plan's therapeutic anchors derive from the diagnostic NTS geometry. */
import { describe, expect, it } from 'vitest'

import { LATERAL_ICONS } from '../../../backend/app/modules/odontogram/frontend/components/odontogram/LateralViewIcons'
import { apexPoint, localToGlobal, toothPlacement } from '../../../backend/app/modules/odontogram/frontend/utils/ntsChartGeometry'
import { NTS_ALL_TEETH } from '../../../backend/app/modules/odontogram/frontend/utils/ntsDentition'
import { resolveSurfaceRegions } from '../../../backend/app/modules/odontogram/frontend/utils/ntsSurfaceGeometry'
import {
  isTherapeuticSurface,
  therapeuticIconPlacement,
  therapeuticIconTransform,
  therapeuticPulpBox,
  therapeuticSurfaceAnchor,
  therapeuticSurfacePath
} from '../../../backend/app/modules/odontogram/frontend/utils/ntsTherapeuticGeometry'
import {
  renderableTherapeuticInstructions,
  resolveTherapeuticPattern,
  THERAPEUTIC_PATTERNS,
  therapeuticInstructions
} from '../../../backend/app/modules/odontogram/frontend/utils/therapeuticVisualization'

const anchor = (fdi: number, surface: string) => therapeuticSurfaceAnchor(fdi, surface)!

describe('DP-08.A F1 — surface orientation follows side and arch', () => {
  // One tooth per quadrant, permanent and deciduous: the four arches of both dentitions.
  it.each([16, 26, 36, 46, 55, 65, 75, 85])('places M/D/V/L of tooth %i from its own side and arch', (fdi) => {
    const tooth = NTS_ALL_TEETH.find(candidate => candidate.fdi === fdi)!
    const mesial = anchor(fdi, 'M')
    const distal = anchor(fdi, 'D')
    // Mesial faces the midline: the right-hand trapezoid for the patient's right side.
    if (tooth.side === 'right') expect(mesial.x).toBeGreaterThan(distal.x)
    else expect(mesial.x).toBeLessThan(distal.x)
    const vestibular = anchor(fdi, 'V')
    const lingual = anchor(fdi, 'L')
    // Vestibular is the outward side: top of the upper cell, bottom of the lower one.
    if (tooth.arch === 'upper') expect(vestibular.y).toBeLessThan(lingual.y)
    else expect(vestibular.y).toBeGreaterThan(lingual.y)
  })

  it('differs from the previous fixed layout for 16 and 46', () => {
    const crown16 = toothPlacement(16)!.crown
    expect(anchor(16, 'M').x).toBeGreaterThan(crown16.x + crown16.width / 2)
    const crown46 = toothPlacement(46)!.crown
    expect(anchor(46, 'V').y).toBeGreaterThan(crown46.y + crown46.height / 2)
  })

  it('resolves every surface of all 52 teeth inside the tooth cell', () => {
    for (const tooth of NTS_ALL_TEETH) {
      const cell = toothPlacement(tooth.fdi)!.cell
      for (const surface of ['M', 'D', 'O', 'V', 'L']) {
        const point = anchor(tooth.fdi, surface)
        expect(point.x).toBeGreaterThanOrEqual(cell.x)
        expect(point.x).toBeLessThanOrEqual(cell.x + cell.width)
        expect(point.y).toBeGreaterThanOrEqual(cell.y)
        expect(point.y).toBeLessThanOrEqual(cell.y + cell.height)
      }
    }
  })

  it('reuses the diagnostic region resolver instead of a second mapping', () => {
    const local = resolveSurfaceRegions(16, ['M'])[0]!.points
    const first = localToGlobal(16, local[0]!)!
    expect(therapeuticSurfacePath(16, 'M')!.startsWith(`M${Math.round(first.x * 100) / 100},${Math.round(first.y * 100) / 100}`)).toBe(true)
  })

  it('draws an occlusal surface from every polygon the diagnosis uses', () => {
    const regions = resolveSurfaceRegions(16, ['O'])
    expect(regions.length).toBeGreaterThan(0)
    expect(therapeuticSurfacePath(16, 'O')!.match(/M/g)).toHaveLength(regions.length)
  })

  it('ignores unknown surfaces and unknown teeth', () => {
    expect(therapeuticSurfacePath(16, 'X')).toBeNull()
    expect(therapeuticSurfaceAnchor(99, 'M')).toBeNull()
    expect(isTherapeuticSurface('O')).toBe(true)
    expect(isTherapeuticSurface('Z')).toBe(false)
  })
})

describe('DP-08.A F2 — icon anchors use the tooth geometry', () => {
  it('anchors apex icons at the apex of upper and lower teeth', () => {
    for (const fdi of [16, 46, 26, 36, 55, 85]) {
      const placement = therapeuticIconPlacement(fdi, LATERAL_ICONS.apicoectomy!)!
      const apex = apexPoint(fdi)!
      const crown = toothPlacement(fdi)!.center
      expect(Math.abs(placement.y - apex.y)).toBeLessThan(Math.abs(crown.y - apex.y) / 2)
      expect(placement.x).toBeCloseTo(apex.x, 5)
    }
  })

  it('pulls a resection line back from the apex and pushes a periapical lesion past it', () => {
    const upper = apexPoint(16)!
    // Upper apices point up: towards the crown is down the screen.
    expect(therapeuticIconPlacement(16, LATERAL_ICONS.apicoectomy!)!.y).toBeGreaterThan(upper.y)
    expect(therapeuticIconPlacement(16, LATERAL_ICONS.periapical_medium!)!.y).toBeLessThan(upper.y)
    const lower = apexPoint(46)!
    expect(therapeuticIconPlacement(46, LATERAL_ICONS.apicoectomy!)!.y).toBeLessThan(lower.y)
    expect(therapeuticIconPlacement(46, LATERAL_ICONS.periapical_medium!)!.y).toBeGreaterThan(lower.y)
  })

  it('mirrors a beyond-apex icon in the upper arch only', () => {
    expect(therapeuticIconPlacement(16, LATERAL_ICONS.root_canal_overfill!)!.flipY).toBe(true)
    expect(therapeuticIconPlacement(46, LATERAL_ICONS.root_canal_overfill!)!.flipY).toBe(false)
    expect(therapeuticIconTransform(16, LATERAL_ICONS.root_canal_overfill!)).toMatch(/scale\([\d.]+, -[\d.]+\)/)
    expect(therapeuticIconTransform(46, LATERAL_ICONS.root_canal_overfill!)).not.toMatch(/-[\d.]+\)$/)
  })

  it('keeps coronal icons on the crown and root icons in the root', () => {
    for (const fdi of [16, 46]) {
      const placement = toothPlacement(fdi)!
      expect(therapeuticIconPlacement(fdi, LATERAL_ICONS.fracture!)).toMatchObject({ x: placement.center.x, y: placement.center.y })
      const post = therapeuticIconPlacement(fdi, LATERAL_ICONS.post!)!
      expect(post.y).toBeGreaterThan(placement.root.y)
      expect(post.y).toBeLessThan(placement.root.y + placement.root.height)
    }
  })

  it('resolves an anchor for every lateral icon on every tooth', () => {
    for (const tooth of NTS_ALL_TEETH) {
      for (const icon of Object.values(LATERAL_ICONS)) {
        const placement = therapeuticIconPlacement(tooth.fdi, icon)!
        expect(Number.isFinite(placement.x)).toBe(true)
        expect(Number.isFinite(placement.y)).toBe(true)
      }
    }
    expect(therapeuticIconTransform(16, null)).toBe('')
    expect(therapeuticIconTransform(99, LATERAL_ICONS.fracture!)).toBe('')
  })

  it('grows a pulp fill from the crown towards the apex in both arches', () => {
    for (const fdi of [16, 46]) {
      const root = toothPlacement(fdi)!.root
      const full = therapeuticPulpBox(fdi, 1)!
      const half = therapeuticPulpBox(fdi, 0.5)!
      expect(full.height).toBeCloseTo(root.height, 5)
      expect(half.height).toBeCloseTo(root.height / 2, 5)
    }
    const upperRoot = toothPlacement(16)!.root
    const lowerRoot = toothPlacement(46)!.root
    const upperHalf = therapeuticPulpBox(16, 0.5)!
    const lowerHalf = therapeuticPulpBox(46, 0.5)!
    expect(upperHalf.y + upperHalf.height).toBeCloseTo(upperRoot.y + upperRoot.height, 5)
    expect(lowerHalf.y).toBeCloseTo(lowerRoot.y, 5)
  })
})

describe('DP-08.A F2 — snapshot interpretation', () => {
  it.each(['diagonal_stripes', 'horizontal_stripes', 'dots', 'grid', 'solid', 'outline'])('understands the catalog pattern %s', (pattern) => {
    expect(resolveTherapeuticPattern(pattern)).toBe(pattern)
    expect(THERAPEUTIC_PATTERNS).toContain(pattern)
  })

  it('defaults a missing pattern to the original stripes and never invents one for an unknown value', () => {
    expect(resolveTherapeuticPattern(undefined)).toBe('diagonal_stripes')
    expect(resolveTherapeuticPattern('hologram')).toBe('outline')
  })

  it('draws surface rules only when a valid surface exists', () => {
    const snapshot = { schema_version: 1, visualization_rules: [{ layer: 'occlusal_surface', color: '#3B82F6', kind: 'solid_fill' }, { layer: 'pulp_fill', extent: 'full' }] }
    expect(renderableTherapeuticInstructions(snapshot, []).map(rule => rule.layer)).toEqual(['pulp_fill'])
    expect(renderableTherapeuticInstructions(snapshot, ['X']).map(rule => rule.layer)).toEqual(['pulp_fill'])
    expect(renderableTherapeuticInstructions(snapshot, ['M']).map(rule => rule.layer)).toEqual(['occlusal_surface', 'pulp_fill'])
  })

  it('keeps null, old, partial and future snapshots inert', () => {
    for (const snapshot of [null, undefined, 'x', {}, { schema_version: 0, visualization_rules: [] }, { schema_version: 2, visualization_rules: [{ layer: 'pulp_fill' }] }, { schema_version: 1 }]) {
      expect(therapeuticInstructions(snapshot)).toEqual([])
      expect(renderableTherapeuticInstructions(snapshot, ['M'])).toEqual([])
    }
  })
})
