/**
 * NTS-05B — the official MINSA dental layout.
 *
 * The expected values are read off the norm's own **Anexo: Gráfico del
 * odontograma** (NTS N.° 188-MINSA/DGIESP-2022, p. 22), not from the Original
 * profile's chart and not from clinical memory. The annex prints 18 at the
 * far left of the upper row and 28 at the far right, which is what fixes the
 * orientation asserted below.
 *
 * Module-layer files are imported by relative path: `frontend/module_layers`
 * does not resolve on this Windows host, so the layer's auto-imports are
 * unavailable in the test environment.
 */

import { mountSuspended } from '@nuxt/test-utils/runtime'
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { nextTick } from 'vue'

import NtsOdontogramChart from '../../../backend/app/modules/odontogram/frontend/components/odontogram/NtsOdontogramChart.vue'
import {
  NTS_ALL_TEETH,
  NTS_CELL_HEIGHT,
  NTS_ROWS,
  cellWidthFor,
  centralRegionCountFor,
  rootCountFor,
  rowWidthFor,
  toothGeometry
} from '../../../backend/app/modules/odontogram/frontend/utils/ntsDentition'
import {
  NTS_CHART_VIEWBOX,
  NTS_CHART_WIDTH
} from '../../../backend/app/modules/odontogram/frontend/utils/ntsChartGeometry'
import type { NtsRecord } from '../../../backend/app/modules/odontogram/frontend/types/nts'

// ---------------------------------------------------------------------------
// the four rows, exactly as the annex prints them
// ---------------------------------------------------------------------------

const PERMANENT_UPPER = [18, 17, 16, 15, 14, 13, 12, 11, 21, 22, 23, 24, 25, 26, 27, 28]
const DECIDUOUS_UPPER = [55, 54, 53, 52, 51, 61, 62, 63, 64, 65]
const DECIDUOUS_LOWER = [85, 84, 83, 82, 81, 71, 72, 73, 74, 75]
const PERMANENT_LOWER = [48, 47, 46, 45, 44, 43, 42, 41, 31, 32, 33, 34, 35, 36, 37, 38]

function makeRecord(overrides: Partial<NtsRecord> = {}): NtsRecord {
  return {
    id: 'rec-1',
    clinic_id: 'clinic-a',
    patient_id: 'p1',
    norm_version: 'pe_nts_188_2022',
    stage: 'diagnosis',
    stage_label: null,
    status: 'draft',
    version: 1,
    observations: null,
    recorded_at: '2026-01-02T10:00:00Z',
    recorded_by: 'u1',
    finalized_at: null,
    finalized_by: null,
    discarded_at: null,
    discarded_by: null,
    discard_reason: null,
    recorded_by_name: null,
    recorded_by_role: null,
    recorded_by_professional_id: null,
    supersedes_record_id: null,
    supersession_reason: null,
    content_hash: null,
    hash_algorithm: null,
    canonicalization_version: null,
    created_at: '2026-01-02T10:00:00Z',
    updated_at: '2026-01-02T10:00:00Z',
    findings: [],
    specifications: [],
    ...overrides
  }
}

async function mountChart(props: Record<string, unknown> = {}) {
  const wrapper = await mountSuspended(NtsOdontogramChart, { props })
  await nextTick()
  return wrapper
}

/** FDI numbers in DOM order, for one row or for the whole chart. */
function fdiOrder(wrapper: { findAll: (s: string) => Array<{ attributes: (a: string) => string | undefined }> }, selector: string) {
  return wrapper.findAll(selector).map(el => Number(el.attributes('data-fdi')))
}

// ---------------------------------------------------------------------------
// §27 — row order
// ---------------------------------------------------------------------------

describe('§27 — FDI order of the four rows', () => {
  it.each([
    ['permanentUpper', PERMANENT_UPPER],
    ['deciduousUpper', DECIDUOUS_UPPER],
    ['deciduousLower', DECIDUOUS_LOWER],
    ['permanentLower', PERMANENT_LOWER]
  ])('%s matches the annex exactly', async (rowId, expected) => {
    const wrapper = await mountChart()
    const rendered = fdiOrder(wrapper, `[data-row="${rowId}"] [data-fdi]`)
    expect(rendered).toEqual(expected)
  })

  it('the rows are stacked permanent → deciduous → deciduous → permanent', async () => {
    const wrapper = await mountChart()
    const order = wrapper.findAll('[data-row]').map(el => el.attributes('data-row'))
    expect(order).toEqual([
      'permanentUpper',
      'deciduousUpper',
      'deciduousLower',
      'permanentLower'
    ])
  })

  it('the pure row definition agrees with what is rendered', () => {
    expect(NTS_ROWS.map(r => r.teeth.map(t => t.fdi))).toEqual([
      PERMANENT_UPPER,
      DECIDUOUS_UPPER,
      DECIDUOUS_LOWER,
      PERMANENT_LOWER
    ])
  })
})

// ---------------------------------------------------------------------------
// §10 — orientation
// ---------------------------------------------------------------------------

describe('§10 — orientation is the clinician\'s view', () => {
  it('the extremes of every row are the teeth the annex prints there', async () => {
    const wrapper = await mountChart()
    const ends = (rowId: string) => {
      const row = fdiOrder(wrapper, `[data-row="${rowId}"] [data-fdi]`)
      return [row[0], row[row.length - 1]]
    }

    expect(ends('permanentUpper')).toEqual([18, 28])
    expect(ends('deciduousUpper')).toEqual([55, 65])
    expect(ends('deciduousLower')).toEqual([85, 75])
    expect(ends('permanentLower')).toEqual([48, 38])
  })

  it('screen-left is the patient\'s right in all four rows', async () => {
    const wrapper = await mountChart()
    for (const rowId of ['permanentUpper', 'deciduousUpper', 'deciduousLower', 'permanentLower']) {
      const cells = wrapper.findAll(`[data-row="${rowId}"] [data-fdi]`)
      expect(cells[0]!.attributes('data-side')).toBe('right')
      expect(cells[cells.length - 1]!.attributes('data-side')).toBe('left')
    }
  })

  it('upper rows carry arch "upper" and lower rows "lower"', async () => {
    const wrapper = await mountChart()
    const archOf = (rowId: string) =>
      wrapper.find(`[data-row="${rowId}"]`).attributes('data-arch')

    expect(archOf('permanentUpper')).toBe('upper')
    expect(archOf('deciduousUpper')).toBe('upper')
    expect(archOf('deciduousLower')).toBe('lower')
    expect(archOf('permanentLower')).toBe('lower')
  })
})

// ---------------------------------------------------------------------------
// §28 / §29 — 52 teeth, no duplicates, right split
// ---------------------------------------------------------------------------

describe('§28 — 52 unique teeth', () => {
  it('renders exactly 52 cells with 52 distinct FDI numbers', async () => {
    const wrapper = await mountChart()
    const all = fdiOrder(wrapper, '[data-fdi]')

    expect(all).toHaveLength(52)
    expect(new Set(all).size).toBe(52)
  })

  it('every FDI is a valid "Sistema Dígito Dos" number', async () => {
    const wrapper = await mountChart()
    for (const fdi of fdiOrder(wrapper, '[data-fdi]')) {
      const quadrant = Math.floor(fdi / 10)
      const position = fdi % 10
      expect(quadrant).toBeGreaterThanOrEqual(1)
      expect(quadrant).toBeLessThanOrEqual(8)
      expect(position).toBeGreaterThanOrEqual(1)
      expect(position).toBeLessThanOrEqual(quadrant <= 4 ? 8 : 5)
    }
  })

  it('every tooth is reachable by its own test id', async () => {
    const wrapper = await mountChart()
    for (const fdi of [18, 11, 28, 55, 51, 65, 85, 71, 75, 48, 41, 38]) {
      expect(wrapper.find(`[data-testid="nts-tooth-${fdi}"]`).exists()).toBe(true)
    }
  })
})

describe('§29 — dentition counts', () => {
  it('32 permanent and 20 deciduous are rendered', async () => {
    const wrapper = await mountChart()
    expect(wrapper.findAll('[data-dentition="permanent"][data-fdi]')).toHaveLength(32)
    expect(wrapper.findAll('[data-dentition="deciduous"][data-fdi]')).toHaveLength(20)
  })

  it('the deciduous arches are never hidden or toggled away', async () => {
    const wrapper = await mountChart()
    // No dentition switch exists: an adult patient still gets the full form,
    // because the norm's own format prints both dentitions.
    expect(wrapper.html()).not.toMatch(/dentition-toggle|showDeciduous|toggleDentition/)
    expect(wrapper.findAll('[data-dentition="deciduous"][data-fdi]')).toHaveLength(20)
  })

  it('the pure definition also holds 52 / 32 / 20', () => {
    expect(NTS_ALL_TEETH).toHaveLength(52)
    expect(NTS_ALL_TEETH.filter(t => t.dentition === 'permanent')).toHaveLength(32)
    expect(NTS_ALL_TEETH.filter(t => t.dentition === 'deciduous')).toHaveLength(20)
    expect(new Set(NTS_ALL_TEETH.map(t => t.fdi)).size).toBe(52)
  })
})

// ---------------------------------------------------------------------------
// derived tooth properties
// ---------------------------------------------------------------------------

describe('tooth properties are derived from the FDI, never stored', () => {
  it.each([
    [18, { quadrant: 1, dentition: 'permanent', arch: 'upper', side: 'right', toothClass: 'molar' }],
    [11, { quadrant: 1, dentition: 'permanent', arch: 'upper', side: 'right', toothClass: 'incisor' }],
    [23, { quadrant: 2, dentition: 'permanent', arch: 'upper', side: 'left', toothClass: 'canine' }],
    [45, { quadrant: 4, dentition: 'permanent', arch: 'lower', side: 'right', toothClass: 'premolar' }],
    [55, { quadrant: 5, dentition: 'deciduous', arch: 'upper', side: 'right', toothClass: 'molar' }],
    [71, { quadrant: 7, dentition: 'deciduous', arch: 'lower', side: 'left', toothClass: 'incisor' }]
  ])('%i', (fdi, expected) => {
    const tooth = NTS_ALL_TEETH.find(t => t.fdi === fdi)!
    expect(tooth).toMatchObject(expected)
  })

  it('deciduous arches have no premolars — positions 4 and 5 are molars', () => {
    const deciduous = NTS_ALL_TEETH.filter(t => t.dentition === 'deciduous')
    expect(deciduous.some(t => t.toothClass === 'premolar')).toBe(false)
    expect(deciduous.filter(t => t.toothClass === 'molar')).toHaveLength(8)
  })

  it('root and central-region counts follow the annex', () => {
    const tooth = (fdi: number) => NTS_ALL_TEETH.find(t => t.fdi === fdi)!

    // Upper molars three roots, lower molars two, everything else one.
    expect(rootCountFor(tooth(16))).toBe(3)
    expect(rootCountFor(tooth(46))).toBe(2)
    expect(rootCountFor(tooth(55))).toBe(3)
    expect(rootCountFor(tooth(85))).toBe(2)
    expect(rootCountFor(tooth(11))).toBe(1)
    expect(rootCountFor(tooth(14))).toBe(1)

    // The annex leaves the centre whole on anteriors, halves it on premolars
    // and quarters it on molars.
    expect(centralRegionCountFor(tooth(11))).toBe(1)
    expect(centralRegionCountFor(tooth(13))).toBe(1)
    expect(centralRegionCountFor(tooth(14))).toBe(2)
    expect(centralRegionCountFor(tooth(16))).toBe(4)
  })
})

// ---------------------------------------------------------------------------
// §8 — a stable base for the finding renderer
// ---------------------------------------------------------------------------

describe('§8 — tooth base geometry', () => {
  it('every tooth exposes the four outer regions plus its centre', () => {
    for (const tooth of NTS_ALL_TEETH) {
      const ids = toothGeometry(tooth).regions.map(r => r.id)
      expect(ids.slice(0, 4)).toEqual(['outer-top', 'outer-right', 'outer-bottom', 'outer-left'])
      expect(ids).toHaveLength(4 + centralRegionCountFor(tooth))
      expect(new Set(ids).size).toBe(ids.length)
    }
  })

  it('geometry is deterministic — the same tooth always yields the same paths', () => {
    const tooth = NTS_ALL_TEETH.find(t => t.fdi === 16)!
    expect(toothGeometry(tooth)).toEqual(toothGeometry(tooth))
  })

  it('roots point away from the midline: up for upper arches, down for lower', () => {
    const apexY = (fdi: number) => {
      const tooth = NTS_ALL_TEETH.find(t => t.fdi === fdi)!
      const first = toothGeometry(tooth).roots[0]!
      return Number(first.split(' L')[1]!.split(',')[1])
    }
    // Upper roots reach the top of the cell, lower roots the bottom.
    expect(apexY(16)).toBeLessThan(10)
    expect(apexY(46)).toBeGreaterThan(NTS_CELL_HEIGHT - 10)
  })

  it('region ids stay positional — no surface is named clinically yet', () => {
    const ids = NTS_ALL_TEETH.flatMap(t => toothGeometry(t).regions.map(r => r.id))
    expect(ids.some(id => /mesial|distal|vestibular|lingual|palatin|occlusal/i.test(id))).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// FIDELITY PASS — class proportions read off the Anexo
// ---------------------------------------------------------------------------

/**
 * The annex is a 300dpi scan, so its measurements are raster readings and not
 * dimensions the norm states. They are asserted here as *ratios* only.
 *
 * Measured on the upper permanent row: crown height ~68 with class-dependent
 * widths (molar ~88, premolar ~82, anterior ~61) and a root extent ~83.
 */
const PDF = {
  crownHeight: 68,
  molarWidth: 88,
  premolarWidth: 82,
  anteriorWidth: 61,
  rootExtent: 83
}

function toothOf(fdi: number) {
  return NTS_ALL_TEETH.find(t => t.fdi === fdi)!
}

function crownOf(fdi: number) {
  return toothGeometry(toothOf(fdi)).crown
}

describe('crown width follows the tooth class', () => {
  it('A/B — molar wider than premolar, premolar wider than anterior', () => {
    expect(crownOf(16).width).toBeGreaterThan(crownOf(15).width)
    expect(crownOf(15).width).toBeGreaterThan(crownOf(13).width)
    expect(crownOf(46).width).toBeGreaterThan(crownOf(45).width)
    expect(crownOf(45).width).toBeGreaterThan(crownOf(41).width)
  })

  it('the width ratios stay close to the annex', () => {
    const ratio = (fdi: number) => crownOf(fdi).width / crownOf(16).width
    expect(ratio(15)).toBeCloseTo(PDF.premolarWidth / PDF.molarWidth, 1)
    expect(ratio(13)).toBeCloseTo(PDF.anteriorWidth / PDF.molarWidth, 1)
    expect(ratio(11)).toBeCloseTo(PDF.anteriorWidth / PDF.molarWidth, 1)
  })

  it('canines are drawn like the other front teeth, not like premolars', () => {
    expect(crownOf(13).width).toBe(crownOf(11).width)
    expect(crownOf(13).width).toBeLessThan(crownOf(14).width)
  })

  it('C — crown height is identical across classes, as in the annex', () => {
    const heights = [16, 15, 13, 11, 46, 45, 41, 55, 53, 85, 83]
      .map(fdi => crownOf(fdi).height)
    expect(new Set(heights).size).toBe(1)
  })

  it('the column carries the class width, so a box sits over its own tooth', () => {
    expect(cellWidthFor(toothOf(16))).toBeGreaterThan(cellWidthFor(toothOf(15)))
    expect(cellWidthFor(toothOf(15))).toBeGreaterThan(cellWidthFor(toothOf(11)))
    // Gutter is constant: the pitch difference is the crown, not the spacing.
    const gutter = (fdi: number) => cellWidthFor(toothOf(fdi)) - crownOf(fdi).width
    expect(gutter(16)).toBeCloseTo(gutter(11), 5)
  })

  it('deciduous follows the same two widths the annex uses for it', () => {
    // The annex draws no deciduous premolar: positions 4 and 5 are molars.
    expect(crownOf(55).width).toBe(crownOf(16).width)
    expect(crownOf(53).width).toBe(crownOf(13).width)
    expect(crownOf(55).width).toBeGreaterThan(crownOf(53).width)
  })
})

describe('deciduous teeth are not miniaturised', () => {
  it('shares the permanent class widths in layout units', () => {
    expect(crownOf(55).width).toBe(crownOf(16).width)
    expect(crownOf(54).width).toBe(crownOf(17).width)
    expect(crownOf(53).width).toBe(crownOf(13).width)
    expect(crownOf(51).width).toBe(crownOf(11).width)
    expect(crownOf(85).width).toBe(crownOf(46).width)
    expect(crownOf(83).width).toBe(crownOf(43).width)
  })

  it('shares the permanent column pitch, so its boxes match too', () => {
    expect(cellWidthFor(toothOf(55))).toBe(cellWidthFor(toothOf(16)))
    expect(cellWidthFor(toothOf(53))).toBe(cellWidthFor(toothOf(13)))
  })

  it('keeps one root:crown ratio for both dentitions', () => {
    const ratio = (fdi: number) => {
      const crown = crownOf(fdi)
      return (NTS_CELL_HEIGHT - crown.height) / crown.height
    }
    expect(ratio(55)).toBe(ratio(16))
    expect(ratio(83)).toBe(ratio(43))
  })
})

describe('D — root reaches past the crown, as in the annex', () => {
  it('the root:crown ratio is close to the annex and never shorter than 1', () => {
    const expected = PDF.rootExtent / PDF.crownHeight
    for (const fdi of [16, 15, 13, 11, 46, 45, 41, 55, 53, 85, 83]) {
      const crown = crownOf(fdi)
      const rootExtent = NTS_CELL_HEIGHT - crown.height
      const ratio = rootExtent / crown.height
      expect(ratio).toBeGreaterThanOrEqual(1)
      expect(ratio).toBeCloseTo(expected, 1)
    }
  })

  it('roots still point away from the midline', () => {
    const apexY = (fdi: number) => {
      const first = toothGeometry(toothOf(fdi)).roots[0]!
      return Number(first.split(' L')[1]!.split(',')[1])
    }
    // Upper arches reach the top of the cell, lower arches the bottom.
    expect(apexY(16)).toBeLessThan(10)
    expect(apexY(55)).toBeLessThan(10)
    expect(apexY(46)).toBeGreaterThan(NTS_CELL_HEIGHT - 10)
    expect(apexY(85)).toBeGreaterThan(NTS_CELL_HEIGHT - 10)
  })

  it('root counts are untouched by this pass', () => {
    expect(rootCountFor(toothOf(16))).toBe(3)
    expect(rootCountFor(toothOf(46))).toBe(2)
    expect(rootCountFor(toothOf(55))).toBe(3)
    expect(rootCountFor(toothOf(85))).toBe(2)
    expect(rootCountFor(toothOf(11))).toBe(1)
    expect(rootCountFor(toothOf(14))).toBe(1)
  })

  it('no root escapes its own cell', () => {
    for (const tooth of NTS_ALL_TEETH) {
      const geometry = toothGeometry(tooth)
      const parts = geometry.viewBox.split(' ').map(Number)
      const vbHeight = parts[3]!
      for (const root of geometry.roots) {
        const ys = [...root.matchAll(/[ML][\d.]+,([\d.-]+)/g)].map(m => Number(m[1]))
        for (const y of ys) {
          expect(y).toBeGreaterThanOrEqual(-4)
          expect(y).toBeLessThanOrEqual(vbHeight - 4)
        }
      }
    }
  })
})

describe('E — the anterior centre is not the posterior rectangle', () => {
  /** The whole central area, across every sub-region a class splits it into. */
  function centreBox(fdi: number) {
    const paths = toothGeometry(toothOf(fdi)).regions
      .filter(region => region.id.startsWith('center'))
      .map(region => region.d)
      .join(' ')
    const nums = [...paths.matchAll(/([\d.]+),([\d.]+)/g)]
      .map(m => [Number(m[1]), Number(m[2])] as const)
    const xs = nums.map(n => n[0])
    const ys = nums.map(n => n[1])
    return {
      width: Math.max(...xs) - Math.min(...xs),
      height: Math.max(...ys) - Math.min(...ys)
    }
  }

  it('an anterior centre is a flat sliver, a posterior one is a box', () => {
    const incisor = centreBox(11)
    const molar = centreBox(16)
    const crownHeight = crownOf(11).height

    // The annex closes the anterior diagonals onto a short segment.
    expect(incisor.height).toBeLessThan(crownHeight * 0.2)
    expect(incisor.height).toBeGreaterThan(0)
    // A molar's centre is a real rectangle, several times taller.
    expect(molar.height).toBeGreaterThan(incisor.height * 2)
  })

  it('every front tooth gets the envelope, both dentitions and both arches', () => {
    const crownHeight = crownOf(11).height
    for (const fdi of [13, 12, 11, 21, 43, 41, 53, 51, 83, 81]) {
      expect(centreBox(fdi).height).toBeLessThan(crownHeight * 0.2)
    }
  })

  it('premolars and molars keep a full central box', () => {
    const crownHeight = crownOf(15).height
    for (const fdi of [15, 14, 16, 45, 46, 55, 85]) {
      expect(centreBox(fdi).height).toBeGreaterThan(crownHeight * 0.3)
    }
  })
})

describe('F/G — posterior subdivision is unchanged by this pass', () => {
  it('molars keep four central regions and premolars two', () => {
    expect(centralRegionCountFor(toothOf(16))).toBe(4)
    expect(centralRegionCountFor(toothOf(46))).toBe(4)
    expect(centralRegionCountFor(toothOf(55))).toBe(4)
    expect(centralRegionCountFor(toothOf(15))).toBe(2)
    expect(centralRegionCountFor(toothOf(14))).toBe(2)
    expect(centralRegionCountFor(toothOf(45))).toBe(2)
    expect(centralRegionCountFor(toothOf(11))).toBe(1)
  })

  it('14 and 24 are halved like every other premolar', () => {
    // The updated preview draws them undivided; the PDF does not.
    expect(centralRegionCountFor(toothOf(14))).toBe(2)
    expect(centralRegionCountFor(toothOf(24))).toBe(2)
  })

  it('molars are 2x2 and never 3x2', () => {
    const ids = toothGeometry(toothOf(16)).regions
      .filter(r => r.id.startsWith('center'))
      .map(r => r.id)
    expect(ids).toEqual(['center-1', 'center-2', 'center-3', 'center-4'])
  })
})

describe('H — region ids are stable across the fidelity pass', () => {
  it('the four outer ids and the centre ids are exactly as before', () => {
    for (const tooth of NTS_ALL_TEETH) {
      const ids = toothGeometry(tooth).regions.map(r => r.id)
      expect(ids.slice(0, 4)).toEqual(['outer-top', 'outer-right', 'outer-bottom', 'outer-left'])

      const centres = ids.slice(4)
      const count = centralRegionCountFor(tooth)
      expect(centres).toEqual(
        count === 1
          ? ['center']
          : Array.from({ length: count }, (_, i) => `center-${i + 1}`)
      )
    }
  })

  it('no clinical surface name has leaked in', () => {
    const ids = NTS_ALL_TEETH.flatMap(t => toothGeometry(t).regions.map(r => r.id))
    expect(ids.some(id => /mesial|distal|vestibular|lingual|palatin|occlusal/i.test(id))).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// §30 — responsive structure
// ---------------------------------------------------------------------------

describe('§30 — responsive structure', () => {
  it('one scroll container holds all four rows, so they cannot drift apart', async () => {
    const wrapper = await mountChart()
    const scroll = wrapper.find('[data-testid="nts-chart-scroll"]')

    expect(scroll.exists()).toBe(true)
    expect(scroll.classes()).toContain('overflow-x-auto')
    expect(wrapper.findAll('[data-testid="nts-chart-scroll"]')).toHaveLength(1)
    expect(scroll.findAll('[data-row]')).toHaveLength(4)
  })

  it('the canvas keeps a deterministic minimum width instead of squeezing teeth', async () => {
    const wrapper = await mountChart()
    const canvas = wrapper.find('[data-testid="nts-chart-canvas"]')

    // Derived from the widest row rather than hardcoded, but it must stay a
    // deterministic pixel value so the chart prints as it renders.
    expect(canvas.attributes('style')).toMatch(/min-width:\s*6\d\dpx/)
  })

  it('the DOM order never changes — narrow screens scroll, they do not reorder', async () => {
    // There is no breakpoint-dependent ordering to assert against: the order
    // comes from `NTS_ROWS` and nothing in the component can permute it.
    const wrapper = await mountChart()
    expect(fdiOrder(wrapper, '[data-fdi]')).toEqual([
      ...PERMANENT_UPPER,
      ...DECIDUOUS_UPPER,
      ...DECIDUOUS_LOWER,
      ...PERMANENT_LOWER
    ])
    // Scoped to the tooth canvas: the heading above it may wrap freely, but
    // nothing inside the rows may reflow, reverse or reorder.
    const canvas = wrapper.find('[data-testid="nts-chart-canvas"]').html()
    expect(canvas).not.toMatch(/flex-wrap|flex-col-reverse|order-\d/)
  })

  it('A/B — a deciduous tooth is rendered the size of its permanent counterpart', async () => {
    const wrapper = await mountChart()
    const pxOf = (fdi: number) => {
      const style = wrapper.find(`[data-testid="nts-tooth-${fdi}"]`).attributes('style')!
      return Number(/width:\s*([\d.]+)px/.exec(style)![1])
    }

    // The annex scales nothing down: its deciduous rows are shorter because
    // they hold ten teeth, not because the teeth are miniaturised.
    expect(pxOf(55)).toBe(pxOf(16))
    expect(pxOf(53)).toBe(pxOf(13))
    expect(pxOf(85)).toBe(pxOf(46))
    expect(pxOf(83)).toBe(pxOf(43))

    // Class still separates them: a deciduous molar is wider than an incisor.
    expect(pxOf(55)).toBeGreaterThan(pxOf(53))
  })

  it('C — every crown is rendered at one height, both dentitions', async () => {
    const wrapper = await mountChart()
    const heightOf = (fdi: number) => {
      const svg = wrapper.find(`[data-testid="nts-tooth-${fdi}"] svg`).attributes('style')!
      return /height:\s*([\d.]+)px/.exec(svg)![1]
    }
    const heights = [16, 15, 13, 46, 45, 41, 55, 53, 85, 83].map(heightOf)
    expect(new Set(heights).size).toBe(1)
  })

  it('D/E — the deciduous rows hold ten teeth and the permanent ones sixteen', async () => {
    const wrapper = await mountChart()
    const count = (rowId: string) =>
      wrapper.findAll(`[data-row="${rowId}"] [data-fdi]`).length

    expect(count('permanentUpper')).toBe(16)
    expect(count('permanentLower')).toBe(16)
    expect(count('deciduousUpper')).toBe(10)
    expect(count('deciduousLower')).toBe(10)
  })

  it('F — the deciduous rows stay shorter than, and centred in, the permanent ones', async () => {
    const wrapper = await mountChart()

    // Shorter by tooth count alone: same class widths, fewer columns.
    const permanentUnits = rowWidthFor(NTS_ROWS[0]!.teeth)
    const deciduousUnits = rowWidthFor(NTS_ROWS[1]!.teeth)
    expect(deciduousUnits).toBeLessThan(permanentUnits)

    // Centring comes from the layout, never from per-tooth padding.
    for (const rowId of ['permanentUpper', 'deciduousUpper', 'deciduousLower', 'permanentLower']) {
      expect(wrapper.find(`[data-row="${rowId}"]`).classes()).toContain('justify-center')
    }
    expect(wrapper.find('[data-testid="nts-chart-canvas"]').classes()).toContain('mx-auto')
    // One canvas width for all four rows is what makes centring comparable.
    expect(wrapper.findAll('[data-testid="nts-chart-canvas"]')).toHaveLength(1)
  })
})

// ---------------------------------------------------------------------------
// §32 / §22 / §23 — what the chart says about the record behind it
// ---------------------------------------------------------------------------

describe('§32 — existing findings are never silently dropped', () => {
  it('a record with findings says so instead of drawing invented symbols', async () => {
    const record = makeRecord({
      findings: [
        { id: 'f1', record_id: 'rec-1', norm_version: 'pe_nts_188_2022', rule_id: '6.1.1', attributes: {}, provenance: 'observed', source_finding_id: null, sequence: 1, created_at: '', created_by: 'u1', targets: [] },
        { id: 'f2', record_id: 'rec-1', norm_version: 'pe_nts_188_2022', rule_id: '6.1.2', attributes: {}, provenance: 'observed', source_finding_id: null, sequence: 2, created_at: '', created_by: 'u1', targets: [] }
      ] as NtsRecord['findings']
    })

    const wrapper = await mountChart({ record })
    const notice = wrapper.find('[data-testid="nts-chart-findings-pending"]')

    expect(notice.exists()).toBe(true)
    expect(notice.text()).toContain('2')
    // Nothing was painted onto the teeth to stand in for those findings.
    expect(wrapper.findAll('[data-finding]')).toHaveLength(0)
  })

  it('a record with no findings shows no notice', async () => {
    const wrapper = await mountChart({ record: makeRecord() })
    expect(wrapper.find('[data-testid="nts-chart-findings-pending"]').exists()).toBe(false)
  })
})

describe('§22 / §23 — record state', () => {
  it('with no record the chart is the blank official form and says so', async () => {
    const wrapper = await mountChart()

    expect(wrapper.find('[data-testid="nts-chart-no-record"]').exists()).toBe(true)
    expect(wrapper.findAll('[data-fdi]')).toHaveLength(52)
  })

  it('with a record the "no record" note is gone', async () => {
    const wrapper = await mountChart({ record: makeRecord() })
    expect(wrapper.find('[data-testid="nts-chart-no-record"]').exists()).toBe(false)
  })

  it('readonly is announced and reflected on the root element', async () => {
    const editable = await mountChart({ record: makeRecord() })
    expect(editable.find('[data-testid="nts-chart-readonly"]').exists()).toBe(false)
    expect(editable.find('[data-testid="nts-odontogram-chart"]').attributes('data-readonly')).toBe('false')

    const locked = await mountChart({ record: makeRecord({ status: 'finalized' }), readonly: true })
    expect(locked.find('[data-testid="nts-chart-readonly"]').exists()).toBe(true)
    expect(locked.find('[data-testid="nts-odontogram-chart"]').attributes('data-readonly')).toBe('true')
  })
})

// ---------------------------------------------------------------------------
// §17 — accessibility
// ---------------------------------------------------------------------------

describe('§17 — accessibility', () => {
  it('each tooth is labelled rather than identified by position alone', async () => {
    const wrapper = await mountChart()
    const labels = wrapper.findAll('svg[role="img"]').map(el => el.attributes('aria-label'))

    expect(labels).toHaveLength(52)
    expect(labels).toContain('Tooth 11')
    expect(labels).toContain('Deciduous tooth 51')
  })

  it('the layout invents no keyboard stops while it is not interactive', async () => {
    const wrapper = await mountChart()
    expect(wrapper.findAll('[tabindex]')).toHaveLength(0)
    expect(wrapper.findAll('[data-fdi] button')).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// §25 / §26 — what 05B must not contain
// ---------------------------------------------------------------------------

const CHART_SOURCES = [
  '../../../backend/app/modules/odontogram/frontend/utils/ntsDentition.ts',
  // 05D.1's coordinate model is held to the same standard: it says where a
  // mark goes, never which finding goes there.
  '../../../backend/app/modules/odontogram/frontend/utils/ntsChartGeometry.ts',
  '../../../backend/app/modules/odontogram/frontend/components/odontogram/NtsOdontogramChart.vue',
  '../../../backend/app/modules/odontogram/frontend/components/odontogram/NtsDentitionRow.vue',
  '../../../backend/app/modules/odontogram/frontend/components/odontogram/NtsToothCell.vue'
].map(relative => ({
  relative,
  source: readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8')
}))

// ---------------------------------------------------------------------------
// NTS-05D.1 — the overlay exists, and is inert
// ---------------------------------------------------------------------------

describe('NTS-05D.1 — the shared coordinate space is present and harmless', () => {
  it('carries the deterministic viewBox and is centred like the rows', async () => {
    const wrapper = await mountChart()
    const overlay = wrapper.find('[data-testid="nts-chart-overlay"]')

    expect(overlay.exists()).toBe(true)
    expect(overlay.attributes('viewBox')).toBe(NTS_CHART_VIEWBOX)
    expect(Number(overlay.attributes('width'))).toBe(NTS_CHART_WIDTH)
    expect(overlay.classes()).toContain('absolute')
    expect(overlay.classes()).toContain('left-1/2')
    expect(overlay.classes()).toContain('-translate-x-1/2')
    // The canvas has to be the positioning context, or `absolute` escapes it.
    expect(wrapper.find('[data-testid="nts-chart-canvas"]').classes()).toContain('relative')
  })

  it('cannot swallow a click, and is invisible to assistive tech', async () => {
    const wrapper = await mountChart()
    const overlay = wrapper.find('[data-testid="nts-chart-overlay"]')

    // The chart's hit areas are the tooth buttons underneath. An overlay that
    // took pointer events would break every selection flow silently.
    expect(overlay.classes()).toContain('pointer-events-none')
    expect(overlay.attributes('aria-hidden')).toBe('true')
    expect(overlay.attributes('focusable')).toBe('false')
    // It draws nothing yet: 05D.1 is geometry, not findings.
    expect(overlay.element.children).toHaveLength(0)
  })

  it('does not take the row gap onto itself, which would drop it off the teeth', async () => {
    const wrapper = await mountChart()
    const overlay = wrapper.find('[data-testid="nts-chart-overlay"]')
    expect(overlay.attributes('style')).toMatch(/margin-top:\s*0/)
  })

  it('selecting a tooth still works with the overlay mounted', async () => {
    const wrapper = await mountChart({ selectable: true })
    await wrapper.find('[data-testid="nts-tooth-16"]').trigger('click')

    expect(wrapper.emitted('toothSelect')).toBeTruthy()
    expect(wrapper.emitted('toothSelect')![0]![0]).toBe(16)
    expect(wrapper.findAll('[data-fdi][aria-pressed]')).toHaveLength(52)
  })
})

// ---------------------------------------------------------------------------
// NTS-05D.2 — findings reach the drawing
// ---------------------------------------------------------------------------

describe('NTS-05D.2 — the finding layer draws inside the shared space', () => {
  // Resolved from the working directory, like the render-model spec does:
  // `import.meta.url` is not always a file: URL under the Nuxt test runtime.
  const REAL_CATALOG = JSON.parse(
    readFileSync(
      resolve(process.cwd(), '../backend/app/modules/odontogram/nts/catalog/pe_nts_188_2022.json'),
      'utf8'
    )
  )

  const boxOnly = (fdi: number, id: string) => ({
    id,
    record_id: 'rec-1',
    norm_version: 'pe_nts_188_2022',
    rule_id: '6.1.9',
    attributes: {},
    provenance: 'observed' as const,
    source_finding_id: null,
    sequence: 1,
    created_at: '2026-01-02T10:00:00Z',
    created_by: 'u1',
    targets: [{
      id: `t-${id}`, group_index: 0, position: 0, participation: 'subject', role: null,
      target_kind: 'fdi_tooth', tooth_number: fdi, arch: null, local_ordinal: null, geometry: null
    }]
  })

  it('a sigla is drawn, inside the overlay and nowhere else', async () => {
    const wrapper = await mountChart({
      record: makeRecord({ findings: [boxOnly(16, 'f1')] as never }),
      catalog: REAL_CATALOG
    })
    const overlay = wrapper.find('[data-testid="nts-chart-overlay"]')

    expect(overlay.find('[data-testid="nts-finding-layer"]').exists()).toBe(true)
    const sigla = wrapper.find('[data-testid="nts-sigla-f1"]')
    expect(sigla.exists()).toBe(true)
    expect(sigla.text()).toBe('FFP')
    // It lives in the overlay, not loose in the tooth cells.
    expect(overlay.find('[data-testid="nts-sigla-f1"]').exists()).toBe(true)
  })

  it('the layer cannot take a click away from the teeth', async () => {
    const wrapper = await mountChart({
      record: makeRecord({ findings: [boxOnly(16, 'f1')] as never }),
      catalog: REAL_CATALOG,
      selectable: true
    })
    const layer = wrapper.find('[data-testid="nts-finding-layer"]')

    expect(layer.classes()).toContain('pointer-events-none')
    expect(layer.attributes('aria-hidden')).toBe('true')

    await wrapper.find('[data-testid="nts-tooth-16"]').trigger('click')
    expect(wrapper.emitted('toothSelect')![0]![0]).toBe(16)
  })

  it('without a catalog nothing is drawn, and the record still says so', async () => {
    const wrapper = await mountChart({
      record: makeRecord({ findings: [boxOnly(16, 'f1')] as never })
    })

    expect(wrapper.find('[data-testid="nts-finding-layer"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="nts-chart-findings-pending"]').exists()).toBe(true)
  })

  it('a finding this slice cannot draw is announced instead of omitted', async () => {
    // 6.1.30 is drawn with two parallel lines; no line primitive exists yet.
    const arch = {
      ...boxOnly(16, 'f9'),
      rule_id: '6.1.30',
      attributes: { condition_state: 'good' },
      targets: [{
        id: 'ta', group_index: 0, position: 0, participation: 'subject', role: null,
        target_kind: 'arch', tooth_number: null, arch: 'upper', local_ordinal: null, geometry: null
      }]
    }
    const wrapper = await mountChart({
      record: makeRecord({ findings: [arch] as never }),
      catalog: REAL_CATALOG
    })

    expect(wrapper.find('[data-testid="nts-sigla-f9"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="nts-chart-findings-pending"]').exists()).toBe(true)
  })

  it('a box with more siglas than it can hold shows the count, and says so', async () => {
    const crowded = [1, 2, 3, 4].map(n => boxOnly(16, `c${n}`))
    const wrapper = await mountChart({
      record: makeRecord({ findings: crowded as never }),
      catalog: REAL_CATALOG
    })

    expect(wrapper.find('[data-testid="nts-box-overflow-16"]').text()).toBe('+3')
    expect(wrapper.find('[data-testid="nts-chart-siglas-hidden"]').exists()).toBe(true)
    // ...and the ones that did not fit were never rendered as text.
    expect(wrapper.findAll('[data-testid^="nts-sigla-c"]')).toHaveLength(1)
  })
})

describe('§25 — the renderer hardcodes no normative content', () => {
  it.each(CHART_SOURCES)('$relative carries no rule ids', ({ source }) => {
    expect(source).not.toMatch(/6\.1\.\d/)
  })

  it.each(CHART_SOURCES)('$relative names no finding or sigla', ({ source }) => {
    expect(source).not.toMatch(/\b(caries|corona|obturaci|endodon|implante|pr[oó]tesis|sellante|fractura)/i)
  })
})

describe('§26 — the chart performs no I/O', () => {
  it.each(CHART_SOURCES)('$relative issues no request', ({ source }) => {
    expect(source).not.toMatch(/api\.(get|post|put|patch|delete)|\$fetch|useFetch|XMLHttpRequest|useNtsApi/)
  })

  it.each(CHART_SOURCES)('$relative holds no lifecycle state of its own', ({ source }) => {
    expect(source).not.toMatch(/useNtsOdontogramRecord|localStorage|sessionStorage/)
  })
})

describe('§12 — 05B is chromatically neutral', () => {
  it.each(CHART_SOURCES)('$relative claims neither red nor blue', ({ source }) => {
    // The norm gives those two colours meaning; the layout must not spend
    // them on decoration before the finding renderer needs them.
    expect(source).not.toMatch(/\b(text|bg|fill|stroke|border)-(red|blue)-\d/)
    expect(source).not.toMatch(/#[0-9a-f]{3,6}\b/i)
  })
})
