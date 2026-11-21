/**
 * NTS-05D.1 — the chart-wide coordinate space.
 *
 * 05B gave every tooth its own viewBox, which is all a row of independent
 * drawings needs. It is not enough for a bridge that runs from 13 to 23, an
 * appliance that crosses an arch, or a supernumerary tooth that sits between
 * two apices: none of those has anywhere to be drawn while there is no shared
 * origin. This module supplies one, and these tests pin it.
 *
 * Nothing clinical is asserted here. No finding, no sigla, no colour — 05D.1
 * says *where*, and a later ticket says *what*.
 *
 * Module-layer files are imported by relative path: `frontend/module_layers`
 * does not resolve on this Windows host, so the layer's auto-imports are
 * unavailable in the test environment.
 */

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import {
  NTS_CHART_HEIGHT,
  NTS_CHART_SCALE,
  NTS_CHART_VIEWBOX,
  NTS_CHART_WIDTH,
  NTS_PLACEMENTS,
  annotationBox,
  apexBand,
  apexPoint,
  archSpan,
  crownBox,
  interproximalPoint,
  localToGlobal,
  numberAnchor,
  numberBox,
  occlusalBand,
  occlusalDirection,
  rangeSpan,
  rootAxes,
  rootBox,
  toothCenter,
  toothPlacement
} from '../../../backend/app/modules/odontogram/frontend/utils/ntsChartGeometry'
import {
  NTS_ALL_TEETH,
  NTS_ROWS,
  rootCountFor,
  toothGeometry
} from '../../../backend/app/modules/odontogram/frontend/utils/ntsDentition'

const PERMANENT_UPPER = [18, 17, 16, 15, 14, 13, 12, 11, 21, 22, 23, 24, 25, 26, 27, 28]
const DECIDUOUS_UPPER = [55, 54, 53, 52, 51, 61, 62, 63, 64, 65]
const DECIDUOUS_LOWER = [85, 84, 83, 82, 81, 71, 72, 73, 74, 75]
const PERMANENT_LOWER = [48, 47, 46, 45, 44, 43, 42, 41, 31, 32, 33, 34, 35, 36, 37, 38]

const LAYER = resolve(process.cwd(), '../backend/app/modules/odontogram/frontend')
const source = (file: string) => readFileSync(resolve(LAYER, file), 'utf8')

// ---------------------------------------------------------------------------
// A / B — the population and its order
// ---------------------------------------------------------------------------

describe('A/B — every tooth is placed exactly once, in the annex\'s order', () => {
  it('A — 52 placements with 52 distinct FDI numbers', () => {
    expect(NTS_PLACEMENTS).toHaveLength(52)
    expect(new Set(NTS_PLACEMENTS.map(p => p.fdi)).size).toBe(52)
    expect(NTS_PLACEMENTS.map(p => p.fdi).sort()).toEqual(
      NTS_ALL_TEETH.map(t => t.fdi).sort()
    )
  })

  it('B — the four rows hold exactly the teeth the annex prints in them', () => {
    const of = (row: string) => NTS_PLACEMENTS.filter(p => p.row === row).map(p => p.fdi)

    expect(of('permanentUpper')).toEqual(PERMANENT_UPPER)
    expect(of('deciduousUpper')).toEqual(DECIDUOUS_UPPER)
    expect(of('deciduousLower')).toEqual(DECIDUOUS_LOWER)
    expect(of('permanentLower')).toEqual(PERMANENT_LOWER)
  })

  it('an FDI the chart does not draw has no placement, rather than a guessed one', () => {
    for (const absent of [0, 9, 19, 29, 49, 56, 66, 99]) {
      expect(toothPlacement(absent)).toBeNull()
      expect(toothCenter(absent)).toBeNull()
      expect(crownBox(absent)).toBeNull()
      expect(annotationBox(absent)).toBeNull()
    }
  })
})

// ---------------------------------------------------------------------------
// C / D — horizontal layout
// ---------------------------------------------------------------------------

describe('C/D — columns run left to right and the deciduous rows are centred', () => {
  it('C — x increases monotonically across every row, with no gaps or overlaps', () => {
    for (const row of NTS_ROWS) {
      const placements = NTS_PLACEMENTS.filter(p => p.row === row.id)
      for (let i = 1; i < placements.length; i++) {
        const previous = placements[i - 1]!
        const current = placements[i]!
        expect(current.cell.x).toBeGreaterThan(previous.cell.x)
        // Columns are flush: each starts exactly where the last one ended.
        expect(current.cell.x).toBeCloseTo(previous.cell.x + previous.cell.width, 6)
      }
    }
  })

  it('D — the deciduous rows are narrower than the permanent ones and centred in them', () => {
    const extent = (row: string) => {
      const p = NTS_PLACEMENTS.filter(x => x.row === row)
      const first = p[0]!
      const last = p[p.length - 1]!
      return { left: first.cell.x, right: last.cell.x + last.cell.width }
    }

    for (const [deciduous, permanent] of [
      ['deciduousUpper', 'permanentUpper'],
      ['deciduousLower', 'permanentLower']
    ] as const) {
      const child = extent(deciduous)
      const parent = extent(permanent)

      expect(child.right - child.left).toBeLessThan(parent.right - parent.left)
      expect(child.left).toBeGreaterThan(parent.left)
      expect(child.right).toBeLessThan(parent.right)
      // Centred, not merely inside.
      const childCentre = (child.left + child.right) / 2
      const parentCentre = (parent.left + parent.right) / 2
      expect(childCentre).toBeCloseTo(parentCentre, 6)
    }
  })

  it('the widest row fills the coordinate space it defines', () => {
    const upper = NTS_PLACEMENTS.filter(p => p.row === 'permanentUpper')
    const last = upper[upper.length - 1]!
    expect(upper[0]!.cell.x).toBeCloseTo(0, 0)
    expect(last.cell.x + last.cell.width).toBeCloseTo(NTS_CHART_WIDTH, 0)
  })
})

// ---------------------------------------------------------------------------
// E — local → global
// ---------------------------------------------------------------------------

describe('E — a tooth\'s own drawing maps onto the chart', () => {
  it('the crown corners round-trip from local units to chart coordinates', () => {
    for (const fdi of [18, 11, 26, 41, 55, 75]) {
      const local = toothGeometry(NTS_ALL_TEETH.find(t => t.fdi === fdi)!)
      const placement = toothPlacement(fdi)!
      const topLeft = localToGlobal(fdi, { x: local.crown.x, y: local.crown.y })!
      const bottomRight = localToGlobal(fdi, {
        x: local.crown.x + local.crown.width,
        y: local.crown.y + local.crown.height
      })!

      expect(topLeft.x).toBeCloseTo(placement.crown.x, 6)
      expect(topLeft.y).toBeCloseTo(placement.crown.y, 6)
      expect(bottomRight.x).toBeCloseTo(placement.crown.x + placement.crown.width, 6)
      expect(bottomRight.y).toBeCloseTo(placement.crown.y + placement.crown.height, 6)
    }
  })

  it('the mapping is affine and monotonic, so nothing folds over itself', () => {
    const a = localToGlobal(16, { x: 0, y: 0 })!
    const b = localToGlobal(16, { x: 10, y: 0 })!
    const c = localToGlobal(16, { x: 20, y: 0 })!
    expect(b.x - a.x).toBeCloseTo(c.x - b.x, 9)
    expect(a.y).toBeCloseTo(b.y, 9)
  })

  it('every crown lands inside its own column', () => {
    for (const placement of NTS_PLACEMENTS) {
      expect(placement.crown.x).toBeGreaterThanOrEqual(placement.cell.x - 0.001)
      expect(placement.crown.x + placement.crown.width).toBeLessThanOrEqual(
        placement.cell.x + placement.cell.width + 0.001
      )
    }
  })

  it('localToGlobal refuses an unknown tooth instead of returning an origin', () => {
    expect(localToGlobal(99, { x: 0, y: 0 })).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// F / G — the two bands 05B renders as HTML
// ---------------------------------------------------------------------------

describe('F/G — annotation boxes and FDI numbers become geometry', () => {
  it('F — all 52 teeth expose an annotation box, aligned with their column', () => {
    for (const placement of NTS_PLACEMENTS) {
      const box = annotationBox(placement.fdi)!
      expect(box).not.toBeNull()
      expect(box.x).toBeCloseTo(placement.cell.x, 9)
      expect(box.width).toBeCloseTo(placement.cell.width, 9)
      expect(box.height).toBeGreaterThan(0)
    }
    expect(new Set(NTS_PLACEMENTS.map(p => annotationBox(p.fdi)!.y)).size).toBe(4)
  })

  it('G — all 52 teeth expose a number box and its anchor', () => {
    for (const placement of NTS_PLACEMENTS) {
      const box = numberBox(placement.fdi)!
      const anchor = numberAnchor(placement.fdi)!
      expect(box.x).toBeCloseTo(placement.cell.x, 9)
      expect(anchor.x).toBeCloseTo(box.x + box.width / 2, 9)
      expect(anchor.y).toBeCloseTo(box.y + box.height / 2, 9)
    }
  })

  it('the box sits on the outer side of the arch and the number between it and the tooth', () => {
    const upper = toothPlacement(16)!
    expect(annotationBox(16)!.y).toBeLessThan(numberBox(16)!.y)
    expect(numberBox(16)!.y).toBeLessThan(upper.svg.y)

    const lower = toothPlacement(46)!
    expect(annotationBox(46)!.y).toBeGreaterThan(numberBox(46)!.y)
    expect(numberBox(46)!.y).toBeGreaterThan(lower.svg.y)
  })
})

// ---------------------------------------------------------------------------
// H / P — roots
// ---------------------------------------------------------------------------

describe('H/P — roots point away from the midline and expose their axes', () => {
  it('H — upper apices sit above their crowns, lower apices below', () => {
    for (const placement of NTS_PLACEMENTS) {
      const apex = apexPoint(placement.fdi)!
      const crown = placement.crown
      if (placement.arch === 'upper') {
        expect(apex.y).toBeLessThan(crown.y)
      } else {
        expect(apex.y).toBeGreaterThan(crown.y + crown.height)
      }
    }
  })

  it('P — the number of root axes matches the number of roots drawn', () => {
    for (const tooth of NTS_ALL_TEETH) {
      expect(rootAxes(tooth.fdi)).toHaveLength(rootCountFor(tooth))
    }
    // Spot-checks of the annex's own counts.
    expect(rootAxes(16)).toHaveLength(3)
    expect(rootAxes(46)).toHaveLength(2)
    expect(rootAxes(11)).toHaveLength(1)
  })

  it('each axis runs from the crown to the apex, never the other way round', () => {
    for (const placement of NTS_PLACEMENTS) {
      for (const axis of rootAxes(placement.fdi)) {
        if (placement.arch === 'upper') {
          expect(axis.tip.y).toBeLessThan(axis.base.y)
        } else {
          expect(axis.tip.y).toBeGreaterThan(axis.base.y)
        }
      }
    }
  })

  it('the root bounding box contains every axis it belongs to', () => {
    for (const placement of NTS_PLACEMENTS) {
      const box = rootBox(placement.fdi)!
      for (const axis of rootAxes(placement.fdi)) {
        for (const point of [axis.base, axis.tip]) {
          expect(point.x).toBeGreaterThanOrEqual(box.x - 0.001)
          expect(point.x).toBeLessThanOrEqual(box.x + box.width + 0.001)
          expect(point.y).toBeGreaterThanOrEqual(box.y - 0.001)
          expect(point.y).toBeLessThanOrEqual(box.y + box.height + 0.001)
        }
      }
    }
  })

  it('the apex band of a row clears every tooth in it', () => {
    for (const row of NTS_ROWS) {
      const band = apexBand(row.id)!
      const placements = NTS_PLACEMENTS.filter(p => p.row === row.id)
      for (const placement of placements) {
        for (const axis of rootAxes(placement.fdi)) {
          if (placement.arch === 'upper') expect(band).toBeLessThanOrEqual(axis.tip.y + 0.001)
          else expect(band).toBeGreaterThanOrEqual(axis.tip.y - 0.001)
        }
      }
    }
  })
})

// ---------------------------------------------------------------------------
// I — the occlusal band
// ---------------------------------------------------------------------------

describe('I — the occlusal band is on the biting side, which follows from the arch', () => {
  it('upper rows band below the crowns, lower rows above', () => {
    const upper = toothPlacement(16)!
    expect(occlusalBand('permanentUpper')!).toBeGreaterThanOrEqual(
      upper.crown.y + upper.crown.height - 0.001
    )

    const lower = toothPlacement(46)!
    expect(occlusalBand('permanentLower')!).toBeLessThanOrEqual(lower.crown.y + 0.001)
  })

  it('the band is on the opposite side of the crown from the apex', () => {
    for (const row of NTS_ROWS) {
      const apex = apexBand(row.id)!
      const occlusal = occlusalBand(row.id)!
      const sample = NTS_PLACEMENTS.find(p => p.row === row.id)!
      if (sample.arch === 'upper') expect(apex).toBeLessThan(occlusal)
      else expect(apex).toBeGreaterThan(occlusal)
    }
  })

  it('the direction an arrow takes there is derived, never asked for', () => {
    expect(occlusalDirection(16)).toBe(1)
    expect(occlusalDirection(11)).toBe(1)
    expect(occlusalDirection(55)).toBe(1)
    expect(occlusalDirection(46)).toBe(-1)
    expect(occlusalDirection(31)).toBe(-1)
    expect(occlusalDirection(85)).toBe(-1)
    expect(occlusalDirection(99)).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// J / K — range spans
// ---------------------------------------------------------------------------

describe('J/K — spans follow row order, not FDI arithmetic', () => {
  it('J — 18 → 28 spans the whole upper permanent row', () => {
    const span = rangeSpan(PERMANENT_UPPER)!
    const row = NTS_PLACEMENTS.filter(p => p.row === 'permanentUpper')
    const last = row[row.length - 1]!

    expect(span.row).toBe('permanentUpper')
    expect(span.x1).toBeCloseTo(row[0]!.cell.x, 9)
    expect(span.x2).toBeCloseTo(last.cell.x + last.cell.width, 9)
    expect(span.y).toBeCloseTo(apexBand('permanentUpper')!, 9)
  })

  it('K — 11 → 21 is contiguous across the midline', () => {
    const span = rangeSpan([11, 21])!
    const eleven = toothPlacement(11)!
    const twentyOne = toothPlacement(21)!

    // Adjacent columns, in that order, even though 11 > 21 is false and
    // 21 - 11 = 10 says nothing about adjacency.
    expect(twentyOne.index - eleven.index).toBe(1)
    expect(span.x1).toBeCloseTo(eleven.cell.x, 9)
    expect(span.x2).toBeCloseTo(twentyOne.cell.x + twentyOne.cell.width, 9)
    expect(span.x2 - span.x1).toBeCloseTo(eleven.cell.width + twentyOne.cell.width, 9)
  })

  it('the endpoints may be given in either order', () => {
    expect(rangeSpan([23, 13])).toEqual(rangeSpan([13, 23]))
  })

  it('a span across two rows is refused rather than invented', () => {
    expect(rangeSpan([16, 46])).toBeNull()
    expect(rangeSpan([11, 51])).toBeNull()
    expect(rangeSpan([])).toBeNull()
    expect(rangeSpan([16, 99])).toBeNull()
  })

  it('a span can be taken at a level other than the apex', () => {
    const apex = rangeSpan([13, 23], 'apex')!
    const crown = rangeSpan([13, 23], 'crown')!
    expect(apex.x1).toBeCloseTo(crown.x1, 9)
    expect(apex.y).not.toBeCloseTo(crown.y, 3)
  })
})

// ---------------------------------------------------------------------------
// N / O — arch spans
// ---------------------------------------------------------------------------

describe('N/O — an arch overlay covers the permanent row of that arch', () => {
  it('N — the upper arch spans permanentUpper', () => {
    expect(archSpan('upper')).toEqual(rangeSpan(PERMANENT_UPPER))
  })

  it('O — the lower arch spans permanentLower', () => {
    expect(archSpan('lower')).toEqual(rangeSpan(PERMANENT_LOWER))
  })

  it('it does not reach into the deciduous row nested inside it', () => {
    const upper = archSpan('upper')!
    const deciduous = NTS_PLACEMENTS.filter(p => p.row === 'deciduousUpper')

    expect(upper.row).toBe('permanentUpper')
    // Wider than the deciduous row, and anchored to the permanent apices.
    expect(upper.x1).toBeLessThan(deciduous[0]!.cell.x)
    expect(upper.y).toBeCloseTo(apexBand('permanentUpper')!, 9)
    expect(upper.y).not.toBeCloseTo(apexBand('deciduousUpper')!, 3)
  })
})

// ---------------------------------------------------------------------------
// L / M — interproximal
// ---------------------------------------------------------------------------

describe('L/M — an interproximal point needs two actual neighbours', () => {
  it('L — 11 and 21 are neighbours, and the point sits between them', () => {
    const point = interproximalPoint(11, 21)!
    const eleven = toothPlacement(11)!
    const twentyOne = toothPlacement(21)!

    expect(point.x).toBeCloseTo(eleven.cell.x + eleven.cell.width, 9)
    expect(point.x).toBeCloseTo(twentyOne.cell.x, 9)
    expect(interproximalPoint(21, 11)).toEqual(point)
  })

  it('M — 11 and 22 are not neighbours, so there is no point between them', () => {
    expect(interproximalPoint(11, 22)).toBeNull()
    expect(interproximalPoint(16, 13)).toBeNull()
    expect(interproximalPoint(16, 46)).toBeNull()
    expect(interproximalPoint(11, 51)).toBeNull()
    expect(interproximalPoint(11, 99)).toBeNull()
  })

  it('the level chooses the band: crowns for a diastema, apices for a supernumerary', () => {
    const crown = interproximalPoint(11, 21, 'crown')!
    const apex = interproximalPoint(11, 21, 'apex')!
    const number = interproximalPoint(11, 21, 'number')!

    expect(crown.x).toBeCloseTo(apex.x, 9)
    expect(apex.y).toBeLessThan(crown.y) // upper arch: apices are above
    expect(number.y).toBeLessThan(crown.y)
    expect(apex.y).toBeCloseTo(apexBand('permanentUpper')!, 9)
  })
})

// ---------------------------------------------------------------------------
// global dimensions and purity
// ---------------------------------------------------------------------------

describe('the coordinate space is deterministic and viewport-independent', () => {
  it('its dimensions are derived from the dentition, not from a screen size', () => {
    expect(NTS_CHART_WIDTH).toBeGreaterThan(0)
    expect(NTS_CHART_HEIGHT).toBeGreaterThan(0)
    expect(NTS_CHART_VIEWBOX).toBe(`0 0 ${NTS_CHART_WIDTH} ${NTS_CHART_HEIGHT}`)
    // No breakpoint ever appears in the geometry.
    for (const viewport of [1440, 768, 390]) {
      expect(NTS_CHART_WIDTH).not.toBe(viewport)
      expect(NTS_CHART_HEIGHT).not.toBe(viewport)
    }
  })

  it('every placement lies inside the declared space', () => {
    for (const placement of NTS_PLACEMENTS) {
      expect(placement.cell.x).toBeGreaterThanOrEqual(-0.5)
      expect(placement.cell.x + placement.cell.width).toBeLessThanOrEqual(NTS_CHART_WIDTH + 0.5)
      expect(placement.cell.y).toBeGreaterThanOrEqual(0)
      expect(placement.cell.y + placement.cell.height).toBeLessThanOrEqual(NTS_CHART_HEIGHT)
    }
  })

  it('the module reads nothing from a browser', () => {
    // Comments are stripped first: the module's own docstring names the APIs
    // it promises not to use, and a test that cannot tell prose from code
    // would fail on the promise itself.
    const code = source('utils/ntsChartGeometry.ts')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '')

    for (const forbidden of [
      'getBoundingClientRect',
      'querySelector',
      'document',
      'window',
      'innerWidth',
      'offsetWidth',
      'ref(',
      'computed('
    ]) {
      expect(code).not.toContain(forbidden)
    }
    expect(code).not.toMatch(/from ['"]vue['"]/)
  })

  it('it names no clinical vocabulary — 05D.1 says where, not what', () => {
    const text = source('utils/ntsChartGeometry.ts')
    expect(text).not.toMatch(/\bmesial\b|\bdistal\b|vestibular|palatin|lingual/i)
    expect(text).not.toMatch(/\bred\b|\bblue\b|\brojo\b|\bazul\b/i)
    expect(text).not.toMatch(/box_siglas|shape_fill|RenderInstruction/)
  })
})

// ---------------------------------------------------------------------------
// the CSS lengths the model mirrors
// ---------------------------------------------------------------------------

describe('the layout constants still match the components they mirror', () => {
  it('the cell still stacks a 40px box and a 20px number line', () => {
    const cell = source('components/odontogram/NtsToothCell.vue')
    // h-10 = 40px, leading-5 = 20px. If either utility changes, the geometry
    // silently shifts every anchor on the chart — so it fails here instead.
    expect(cell).toContain('h-10 border')
    expect(cell).toContain('leading-5')
    expect(cell).toContain('preserveAspectRatio="xMidYMid meet"')
  })

  it('the canvas still pads by 8px, gaps by 4px and indents two rows by 12px', () => {
    const chart = source('components/odontogram/NtsOdontogramChart.vue')
    expect(chart).toContain('py-2')
    expect(chart).toContain('space-y-1')
    expect(chart).toMatch(/'pt-3'/)
  })

  it('the chart takes its scale and width from the geometry module', () => {
    const chart = source('components/odontogram/NtsOdontogramChart.vue')
    expect(chart).toContain('NTS_CHART_SCALE')
    expect(chart).toContain('NTS_CHART_WIDTH')
    // ...and no longer keeps a second copy of either.
    expect(chart).not.toMatch(/const CHART_SCALE = 0\.\d+/)
    expect(NTS_CHART_SCALE).toBe(0.484)
  })
})
