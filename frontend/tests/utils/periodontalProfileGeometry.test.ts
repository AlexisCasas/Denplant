/**
 * The periodontal profile strip's geometry (QW-PER).
 *
 * Margen and Sondaje are independent series measured from the baseline; a tooth
 * is its own drawing; null is "not measured" and 0 is a measurement; negative
 * margins are drawn where they are, not clamped.
 *
 * Layer files are imported by relative path: `frontend/module_layers` does not
 * resolve on this Windows host.
 */

import { describe, expect, it } from 'vitest'

import {
  MAX_NEGATIVE_MM,
  PROFILE_GEOMETRY,
  buildMetricSegments,
  buildMetricSegmentsForTooth,
  clinicalSum,
  segmentPath,
  siteX,
  stripHeight,
  valueToY
} from '../../../backend/app/modules/periodontogram/frontend/utils/periodontalProfileGeometry'
import {
  PROBING_ALERT_MM,
  isPathologicalProbing,
  probingDepthClasses,
  probingDepthHex,
  probingDepthTone
} from '../../../backend/app/modules/periodontogram/frontend/composables/usePerioHeatmap'
import type { PerioTooth, SiteCode } from '../../../backend/app/modules/periodontogram/frontend/types'
import {
  PALATAL_SITES,
  VESTIBULAR_SITES
} from '../../../backend/app/modules/periodontogram/frontend/types'

const H = stripHeight() // 60
const MM = PROFILE_GEOMETRY.mmPx // 4

type Reading = { pd?: number | null, gm?: number | null }

/** A tooth whose three vestibular sites carry the given readings, in order. */
function tooth(
  number: number,
  readings: Reading[],
  codes: readonly SiteCode[] = VESTIBULAR_SITES
): PerioTooth {
  return {
    tooth_number: number,
    is_present: true,
    is_implant: false,
    mobility: null,
    prognosis: null,
    furcation_buccal: null,
    furcation_lingual: null,
    keratinized_gingiva_mm: null,
    sites: codes.map((code, i) => ({
      site_code: code,
      probing_depth_mm: readings[i]?.pd ?? null,
      gingival_margin_mm: readings[i]?.gm ?? null,
      bleeding_on_probing: false,
      plaque: false,
      suppuration: false
    }))
  }
}

const margins = (...values: Array<number | null>) => values.map(gm => ({ gm }))
const probings = (...values: Array<number | null>) => values.map(pd => ({ pd }))

const ys = (segments: ReturnType<typeof buildMetricSegments>) =>
  segments.map(s => s.points.map(p => p.y))

// ===========================================================================
// the sum
// ===========================================================================

describe('clinicalSum — Suma = sondaje + margen, sign respected', () => {
  it('adds positives', () => {
    expect(clinicalSum(2, 3)).toBe(5)
  })

  it('the brief\'s example: sondaje 3|5|2 and margen 2|-2|1 give 5|3|3', () => {
    const probing = [3, 5, 2]
    const margin = [2, -2, 1]
    expect(probing.map((pd, i) => clinicalSum(margin[i], pd))).toEqual([5, 3, 3])
  })

  it('respects a negative margin', () => {
    expect(clinicalSum(-2, 5)).toBe(3)
    expect(clinicalSum(-3, 2)).toBe(-1)
  })

  it('clinicalSum(-5, 5) = 0, and that zero is a value, not an absence', () => {
    const sum = clinicalSum(-5, 5)
    expect(sum).toBe(0)
    expect(sum).not.toBeNull()
    // The check the cell uses: never truthiness.
    expect(sum === null ? '' : String(sum)).toBe('0')
  })

  it('the E2E set: margen 3|-5|2 with sondaje 3|5|2 gives 6|0|4', () => {
    const margin = [3, -5, 2]
    const probing = [3, 5, 2]
    expect(probing.map((pd, i) => clinicalSum(margin[i], pd))).toEqual([6, 0, 4])
  })

  it('is null when either is missing, never a zero standing in for it', () => {
    expect(clinicalSum(null, 5)).toBeNull()
    expect(clinicalSum(2, null)).toBeNull()
    expect(clinicalSum(null, null)).toBeNull()
    expect(clinicalSum(undefined, 5)).toBeNull()
    expect(clinicalSum(2, undefined)).toBeNull()
  })

  it('a real 0 on either side still sums', () => {
    expect(clinicalSum(0, 4)).toBe(4)
    expect(clinicalSum(3, 0)).toBe(3)
    expect(clinicalSum(0, 0)).toBe(0)
  })
})

// ===========================================================================
// coordinates
// ===========================================================================

describe('valueToY — every value from its own zero', () => {
  it('depth-up: the baseline is the bottom edge and a positive value runs up', () => {
    expect(valueToY(0, 'depth-up')).toBe(H)
    expect(valueToY(3, 'depth-up')).toBe(H - 3 * MM)
    expect(valueToY(15, 'depth-up')).toBe(0)
  })

  it('depth-down: the baseline is the top edge and a positive value runs down', () => {
    expect(valueToY(0, 'depth-down')).toBe(0)
    expect(valueToY(3, 'depth-down')).toBe(3 * MM)
    expect(valueToY(15, 'depth-down')).toBe(H)
  })

  it.each([-1, -3, -5])('margin %i is drawn at %i mm on the far side of the baseline, not clamped', (mm) => {
    expect(valueToY(mm, 'depth-up')).toBe(H - mm * MM) // below the baseline
    expect(valueToY(mm, 'depth-down')).toBe(mm * MM) // above the baseline
  })

  it('-5 is not drawn as -3 (the old clamp)', () => {
    expect(valueToY(-5, 'depth-up')).not.toBe(valueToY(-3, 'depth-up'))
    expect(valueToY(-5, 'depth-down')).not.toBe(valueToY(-3, 'depth-down'))
    expect(valueToY(-5, 'depth-up')).toBe(80)
    expect(valueToY(-5, 'depth-down')).toBe(-20)
  })

  it('a negative value lies on the opposite side from a positive one, in both directions', () => {
    for (const direction of ['depth-up', 'depth-down'] as const) {
      const zero = valueToY(0, direction)
      const positive = valueToY(2, direction) - zero
      const negative = valueToY(-2, direction) - zero
      expect(Math.sign(positive)).toBe(-Math.sign(negative))
      expect(Math.abs(positive)).toBe(Math.abs(negative))
    }
  })

  it('only the far end is bounded, so a stray value cannot leave the strip', () => {
    expect(valueToY(40, 'depth-down')).toBe(valueToY(15, 'depth-down'))
  })

  it('the largest negative overhang fits the room the strip has on that side', () => {
    // 5 mm past the baseline is 20 px. The strips sit in tooth rows with at
    // least that much clear on the far side of their baseline (the upper
    // palatal and lower vestibular baselines are 61 px below the row top).
    expect(MAX_NEGATIVE_MM * MM).toBe(20)
    expect(MAX_NEGATIVE_MM * MM).toBeLessThan(61)
  })

  it('sites sit at 20 / 50 / 80 % of their own column', () => {
    expect(siteX(0, 0)).toBeCloseTo(12)
    expect(siteX(0, 1)).toBeCloseTo(30)
    expect(siteX(0, 2)).toBeCloseTo(48)
    expect(siteX(2, 0)).toBeCloseTo(120 + 12)
  })
})

// ===========================================================================
// margin
// ===========================================================================

describe('Margen — each site from its own zero', () => {
  const one = (gm: number | null, direction: 'depth-up' | 'depth-down' = 'depth-up') =>
    buildMetricSegments([tooth(14, margins(gm, null, null))], VESTIBULAR_SITES, 'margin', direction)

  it('+3', () => {
    expect(ys(one(3))).toEqual([[H - 3 * MM]])
    expect(ys(one(3, 'depth-down'))).toEqual([[3 * MM]])
  })

  it('-5', () => {
    expect(ys(one(-5))).toEqual([[H + 5 * MM]])
    expect(ys(one(-5, 'depth-down'))).toEqual([[-5 * MM]])
  })

  it('0 is a real point on the baseline', () => {
    const segments = one(0)
    expect(segments).toHaveLength(1)
    expect(segments[0]!.points).toHaveLength(1)
    expect(ys(segments)).toEqual([[H]])
    expect(ys(one(0, 'depth-down'))).toEqual([[0]])
  })

  it.each([-1, -3, -5])('margin %i, depth-up and depth-down', (mm) => {
    expect(ys(one(mm, 'depth-up'))).toEqual([[H - mm * MM]])
    expect(ys(one(mm, 'depth-down'))).toEqual([[mm * MM]])
  })

  it('3 | -5 | 2: each y is its own zero plus its own offset, never the previous y', () => {
    const [segment] = buildMetricSegments(
      [tooth(14, margins(3, -5, 2))], VESTIBULAR_SITES, 'margin', 'depth-up'
    )
    expect(segment!.points.map(p => p.y)).toEqual([
      H + (-3 * MM), // zero(site1) + offset(3)
      H + (5 * MM), //  zero(site2) + offset(-5)
      H + (-2 * MM) //  zero(site3) + offset(2)
    ])
    // Not accumulated: y2 = y1 - 5 mm and y3 = y2 + 2 mm would read 36 / 56 / 48… and
    // the third would differ from a fresh 2 mm.
    expect(segment!.points[2]!.y).toBe(valueToY(2, 'depth-up'))
    expect(segment!.points[1]!.y).toBe(valueToY(-5, 'depth-up'))
  })

  it('and the same in depth-down', () => {
    const [segment] = buildMetricSegments(
      [tooth(14, margins(3, -5, 2))], VESTIBULAR_SITES, 'margin', 'depth-down'
    )
    expect(segment!.points.map(p => p.y)).toEqual([12, -20, 8])
  })

  it('carries the stored value, the tooth and the site on every point', () => {
    const [segment] = buildMetricSegments(
      [tooth(14, margins(3, -5, 2))], VESTIBULAR_SITES, 'margin', 'depth-up'
    )
    expect(segment!.points.map(p => [p.mm, p.toothNumber, p.siteCode])).toEqual([
      [3, 14, 'MV'], [-5, 14, 'V'], [2, 14, 'DV']
    ])
  })

  it('works over the palatal / lingual sites too', () => {
    const [segment] = buildMetricSegments(
      [tooth(14, margins(1, 2, 3), PALATAL_SITES)], PALATAL_SITES, 'margin', 'depth-down'
    )
    expect(segment!.points.map(p => p.siteCode)).toEqual(['ML', 'L', 'DL'])
  })
})

// ===========================================================================
// one tooth is one drawing
// ===========================================================================

describe('a tooth is never joined to its neighbour', () => {
  it('14 and 15 are two segments, not one line from the end of 14 to the start of 15', () => {
    const teeth = [tooth(14, probings(3, 4, 2)), tooth(15, probings(2, 3, 5))]
    const segments = buildMetricSegments(teeth, VESTIBULAR_SITES, 'probing', 'depth-up')

    expect(segments).toHaveLength(2)
    expect(segments.map(s => s.toothNumber)).toEqual([14, 15])
    for (const segment of segments) {
      expect(new Set(segment.points.map(p => p.toothNumber)).size).toBe(1)
    }
  })

  it('no segment spans two columns', () => {
    const teeth = [14, 15, 16].map(n => tooth(n, probings(1, 2, 3)))
    const width = PROFILE_GEOMETRY.colWidth
    for (const segment of buildMetricSegments(teeth, VESTIBULAR_SITES, 'probing', 'depth-down')) {
      const columns = new Set(segment.points.map(p => Math.floor(p.x / width)))
      expect(columns.size).toBe(1)
    }
  })

  it('11 never connects to 21 even though they are adjacent in the arch', () => {
    const teeth = [tooth(12, probings(2, 2, 2)), tooth(11, probings(3, 3, 3)),
      tooth(21, probings(4, 4, 4)), tooth(22, probings(2, 2, 2))]
    const segments = buildMetricSegments(teeth, VESTIBULAR_SITES, 'probing', 'depth-up')

    expect(segments.map(s => s.toothNumber)).toEqual([12, 11, 21, 22])
    expect(segments.every(s => s.points.length === 3)).toBe(true)
  })

  it('holds for margin as well as probing', () => {
    const teeth = [tooth(14, margins(1, 1, 1)), tooth(15, margins(2, 2, 2))]
    expect(buildMetricSegments(teeth, VESTIBULAR_SITES, 'margin', 'depth-up')).toHaveLength(2)
  })

  it.each([
    ['upper vestibular', 'depth-up', VESTIBULAR_SITES],
    ['upper palatal', 'depth-down', PALATAL_SITES],
    ['lower lingual', 'depth-up', PALATAL_SITES],
    ['lower vestibular', 'depth-down', VESTIBULAR_SITES]
  ] as const)('%s: one segment per tooth', (_zone, direction, sites) => {
    const teeth = [44, 43, 42].map(n => tooth(n, probings(1, 2, 3), sites))
    expect(buildMetricSegments(teeth, sites, 'probing', direction)).toHaveLength(3)
  })

  it('the same code serves both arches and both directions', () => {
    const teeth = [tooth(14, probings(3, 5, 2))]
    const up = buildMetricSegments(teeth, VESTIBULAR_SITES, 'probing', 'depth-up')
    const down = buildMetricSegments(teeth, VESTIBULAR_SITES, 'probing', 'depth-down')
    // Same x and same value, mirrored y: only the direction differs.
    expect(up[0]!.points.map(p => p.x)).toEqual(down[0]!.points.map(p => p.x))
    expect(up[0]!.points.map(p => p.y + down[0]!.points.map(q => q.y)[up[0]!.points.indexOf(p)]!))
      .toEqual([H, H, H])
  })

  it('each tooth is placed in its own column', () => {
    const teeth = [tooth(14, probings(1, 1, 1)), tooth(15, probings(1, 1, 1))]
    const [a, b] = buildMetricSegments(teeth, VESTIBULAR_SITES, 'probing', 'depth-up')
    expect(Math.max(...a!.points.map(p => p.x))).toBeLessThan(Math.min(...b!.points.map(p => p.x)))
  })
})

// ===========================================================================
// null versus zero
// ===========================================================================

describe('null breaks the line; 0 is a point', () => {
  const run = (values: Array<number | null>, metric: 'margin' | 'probing' = 'probing') =>
    buildMetricSegmentsForTooth(
      tooth(14, values.map(v => (metric === 'margin' ? { gm: v } : { pd: v }))),
      0, VESTIBULAR_SITES, metric, 'depth-up'
    )

  it('3 | null | 2 is two lone points, never a line through the empty site', () => {
    const segments = run([3, null, 2])
    expect(segments).toHaveLength(2)
    expect(segments.map(s => s.points.length)).toEqual([1, 1])
    expect(segments.map(segmentPath)).toEqual([null, null])
  })

  it('and the same for the margin', () => {
    expect(run([3, null, 2], 'margin')).toHaveLength(2)
  })

  it('a null at the end shortens the line, it does not extend it', () => {
    const segments = run([3, 4, null])
    expect(segments).toHaveLength(1)
    expect(segments[0]!.points).toHaveLength(2)
    expect(segmentPath(segments[0]!)).not.toBeNull()
  })

  it('a null at the start does the same', () => {
    const segments = run([null, 3, 4])
    expect(segments).toHaveLength(1)
    expect(segments[0]!.points.map(p => p.siteCode)).toEqual(['V', 'DV'])
  })

  it('all null draws nothing at all', () => {
    expect(run([null, null, null])).toEqual([])
  })

  it('null is not 0: a zero is drawn on the baseline, a null is not drawn', () => {
    expect(ys(run([0, null, null]))).toEqual([[H]])
    expect(run([null, null, null])).toHaveLength(0)
    expect(run([0, 0, 0])[0]!.points.map(p => p.y)).toEqual([H, H, H])
  })

  it('0 | null | 0 is two points on the baseline, with no line between', () => {
    const segments = run([0, null, 0])
    expect(segments).toHaveLength(2)
    expect(ys(segments)).toEqual([[H], [H]])
  })

  it('a missing margin does not turn a probing depth into a sum', () => {
    // The old series plotted `(margin ?? 0) + probing`. Sondaje is the stored
    // probing depth, whatever the margin is.
    const [segment] = buildMetricSegmentsForTooth(
      tooth(14, [{ pd: 5, gm: null }, { pd: 5, gm: -2 }, { pd: 5, gm: 2 }]),
      0, VESTIBULAR_SITES, 'probing', 'depth-up'
    )
    expect(segment!.points.map(p => p.y)).toEqual([valueToY(5, 'depth-up'), valueToY(5, 'depth-up'), valueToY(5, 'depth-up')])
  })

  it('a site that is absent from the tooth counts as not measured', () => {
    const partial: PerioTooth = { ...tooth(14, probings(3, 3, 3)), sites: [] }
    expect(buildMetricSegments([partial], VESTIBULAR_SITES, 'probing', 'depth-up')).toEqual([])
  })
})

// ===========================================================================
// sondaje
// ===========================================================================

describe('Sondaje — an independent series, the stored value', () => {
  it('3 | 5 | 2 is drawn at 3, 5 and 2 mm from the baseline, margin or no margin', () => {
    const t = tooth(14, [{ pd: 3, gm: 2 }, { pd: 5, gm: -2 }, { pd: 2, gm: 1 }])
    const [segment] = buildMetricSegments([t], VESTIBULAR_SITES, 'probing', 'depth-up')
    expect(segment!.points.map(p => p.mm)).toEqual([3, 5, 2])
    expect(segment!.points.map(p => p.y)).toEqual([H - 12, H - 20, H - 8])
  })

  it('is independent of the margin series on the same sites', () => {
    const t = tooth(14, [{ pd: 3, gm: 3 }, { pd: 5, gm: -5 }, { pd: 2, gm: 2 }])
    const margin = buildMetricSegments([t], VESTIBULAR_SITES, 'margin', 'depth-up')[0]!
    const probing = buildMetricSegments([t], VESTIBULAR_SITES, 'probing', 'depth-up')[0]!
    expect(margin.points.map(p => p.mm)).toEqual([3, -5, 2])
    expect(probing.points.map(p => p.mm)).toEqual([3, 5, 2])
  })
})

// ===========================================================================
// colour
// ===========================================================================

describe('probing colour: 0–3 is normal, 4 or more is red', () => {
  it.each([0, 1, 2, 3])('%i mm is not red', (pd) => {
    expect(isPathologicalProbing(pd)).toBe(false)
    expect(probingDepthTone(pd)).not.toBe('error')
    expect(probingDepthClasses(pd)).not.toMatch(/rose|red/)
    expect(probingDepthHex(pd)).not.toBe(probingDepthHex(4))
  })

  it.each([4, 5, 6, 7, 8, 10, 12, 15])('%i mm is red', (pd) => {
    expect(isPathologicalProbing(pd)).toBe(true)
    expect(probingDepthTone(pd)).toBe('error')
    expect(probingDepthClasses(pd)).toMatch(/rose/)
  })

  it('there is no amber or orange middle any more: 4, 5 and 6 read the same', () => {
    expect(new Set([4, 5, 6].map(probingDepthTone)).size).toBe(1)
    expect(new Set([4, 5, 6].map(probingDepthHex)).size).toBe(1)
    expect(PROBING_ALERT_MM).toBe(4)
  })

  it('not measured is neutral, and neither normal nor red', () => {
    expect(probingDepthTone(null)).toBe('neutral')
    expect(probingDepthTone(undefined)).toBe('neutral')
    expect(isPathologicalProbing(null)).toBe(false)
  })

  it('0 is a measurement: normal, not neutral', () => {
    expect(probingDepthTone(0)).toBe('success')
  })
})

describe('segments are colourless: a red site does not make its line red', () => {
  it('3 | 5 | 2 is one segment of three points; only the middle site is pathological', () => {
    const [segment] = buildMetricSegments(
      [tooth(14, probings(3, 5, 2))], VESTIBULAR_SITES, 'probing', 'depth-up'
    )
    expect(segment!.points).toHaveLength(3)
    expect(segment!.points.map(p => isPathologicalProbing(p.mm))).toEqual([false, true, false])
    // A segment carries geometry only; there is no per-segment colour to set.
    expect(Object.keys(segment!)).toEqual(['toothNumber', 'points'])
  })

  it('two red neighbours still make one neutral line', () => {
    const [segment] = buildMetricSegments(
      [tooth(14, probings(5, 6, 3))], VESTIBULAR_SITES, 'probing', 'depth-up'
    )
    expect(Object.keys(segment!)).toEqual(['toothNumber', 'points'])
  })
})

// ===========================================================================
// paths
// ===========================================================================

describe('segmentPath', () => {
  it('is M then L for each following point', () => {
    const [segment] = buildMetricSegments(
      [tooth(14, probings(3, 5, 2))], VESTIBULAR_SITES, 'probing', 'depth-up'
    )
    expect(segmentPath(segment!)).toBe(`M 12,${H - 12} L 30,${H - 20} L 48,${H - 8}`)
  })

  it('a lone point has no path', () => {
    const [segment] = buildMetricSegments(
      [tooth(14, probings(3, null, null))], VESTIBULAR_SITES, 'probing', 'depth-up'
    )
    expect(segmentPath(segment!)).toBeNull()
  })

  it('is deterministic: the same teeth give the same paths every time', () => {
    const teeth = [tooth(14, probings(3, 5, 2)), tooth(15, probings(4, null, 3))]
    const once = buildMetricSegments(teeth, VESTIBULAR_SITES, 'probing', 'depth-up').map(segmentPath)
    const again = buildMetricSegments(
      JSON.parse(JSON.stringify(teeth)), VESTIBULAR_SITES, 'probing', 'depth-up'
    ).map(segmentPath)
    expect(again).toEqual(once)
  })
})
