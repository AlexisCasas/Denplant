/**
 * The periodontal profile strip and the arch table, through the components
 * (QW-PER). The rules themselves are in
 * `tests/utils/periodontalProfileGeometry.test.ts`; this suite checks that what
 * is drawn is what they compute: a path per tooth, null breaking the line, the
 * red dot only on a site of 4 mm or more, the Suma row in all four zones, and
 * that a snapshot rebuilt later draws exactly the same.
 *
 * `PerioArchBlock` reaches its siblings through auto-imports, and
 * `frontend/module_layers` does not resolve on this Windows host, so they are
 * registered through `global.components`.
 */

import { mountSuspended } from '@nuxt/test-utils/runtime'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { defineComponent, h } from 'vue'

import PerioArchBlock from '../../../backend/app/modules/periodontogram/frontend/components/PerioArchBlock.vue'
import PerioProfileStrip from '../../../backend/app/modules/periodontogram/frontend/components/PerioProfileStrip.vue'
import type {
  PerioTooth,
  SiteCode
} from '../../../backend/app/modules/periodontogram/frontend/types'
import { SITE_CODES } from '../../../backend/app/modules/periodontogram/frontend/types'

type Reading = { pd?: number | null, gm?: number | null }

/** A tooth whose six sites take readings in MV V DV ML L DL order. */
function tooth(number: number, readings: Partial<Record<SiteCode, Reading>> = {}): PerioTooth {
  return {
    tooth_number: number,
    is_present: true,
    is_implant: false,
    mobility: null,
    prognosis: null,
    furcation_buccal: null,
    furcation_lingual: null,
    keratinized_gingiva_mm: null,
    sites: SITE_CODES.map(code => ({
      site_code: code,
      probing_depth_mm: readings[code]?.pd ?? null,
      gingival_margin_mm: readings[code]?.gm ?? null,
      bleeding_on_probing: false,
      plaque: false,
      suppuration: false
    }))
  }
}

const vest = (a: Reading, b: Reading, c: Reading) => ({ MV: a, V: b, DV: c })

async function strip(
  teeth: PerioTooth[],
  direction: 'depth-up' | 'depth-down' = 'depth-up',
  face: 'vestibular' | 'palatal' | 'lingual' = 'vestibular'
) {
  return mountSuspended(PerioProfileStrip, { props: { teeth, face, direction } })
}

const paths = (wrapper: Awaited<ReturnType<typeof strip>>, metric: 'margin' | 'probing') =>
  wrapper.findAll(`[data-testid="perio-strip-path-${metric}"]`)
const dots = (wrapper: Awaited<ReturnType<typeof strip>>, metric: 'margin' | 'probing') =>
  wrapper.findAll(`[data-testid="perio-strip-dot-${metric}"]`)

// ===========================================================================

describe('PerioProfileStrip — one path per tooth', () => {
  const teeth = [
    tooth(14, vest({ pd: 3, gm: 1 }, { pd: 4, gm: 1 }, { pd: 2, gm: 1 })),
    tooth(15, vest({ pd: 2, gm: 2 }, { pd: 3, gm: 2 }, { pd: 5, gm: 2 }))
  ]

  it('14 and 15 are two paths for each series, never one that runs from 14 into 15', async () => {
    const wrapper = await strip(teeth)

    for (const metric of ['margin', 'probing'] as const) {
      const drawn = paths(wrapper, metric)
      expect(drawn, metric).toHaveLength(2)
      expect(drawn.map(p => p.attributes('data-tooth'))).toEqual(['14', '15'])
    }
  })

  it('no path crosses a column boundary', async () => {
    const wrapper = await strip(teeth)
    for (const path of [...paths(wrapper, 'margin'), ...paths(wrapper, 'probing')]) {
      const xs = [...path.attributes('d')!.matchAll(/[ML] ([\d.]+),/g)].map(m => Number(m[1]))
      expect(new Set(xs.map(x => Math.floor(x / 60))).size).toBe(1)
    }
  })

  it('11 does not connect to 21', async () => {
    const wrapper = await strip([
      tooth(11, vest({ pd: 3 }, { pd: 3 }, { pd: 3 })),
      tooth(21, vest({ pd: 3 }, { pd: 3 }, { pd: 3 }))
    ])
    expect(paths(wrapper, 'probing')).toHaveLength(2)
  })

  it.each([
    ['upper vestibular', 'depth-up', 'vestibular'],
    ['upper palatal', 'depth-down', 'palatal'],
    ['lower lingual', 'depth-up', 'lingual'],
    ['lower vestibular', 'depth-down', 'vestibular']
  ] as const)('%s: a path per tooth', async (_zone, direction, face) => {
    const inner = face === 'vestibular'
      ? { MV: { pd: 3 }, V: { pd: 3 }, DV: { pd: 3 } }
      : { ML: { pd: 3 }, L: { pd: 3 }, DL: { pd: 3 } }
    const wrapper = await strip([tooth(44, inner), tooth(43, inner)], direction, face)
    expect(paths(wrapper, 'probing')).toHaveLength(2)
    expect(wrapper.find('svg').attributes('data-direction')).toBe(direction)
  })
})

describe('PerioProfileStrip — null breaks the line, 0 is a point', () => {
  it('3 | null | 2 draws two dots and no path', async () => {
    const wrapper = await strip([tooth(14, vest({ pd: 3 }, { pd: null }, { pd: 2 }))])

    expect(paths(wrapper, 'probing')).toHaveLength(0)
    expect(dots(wrapper, 'probing').map(d => d.attributes('data-site'))).toEqual(['MV', 'DV'])
  })

  it('the margin series breaks the same way', async () => {
    const wrapper = await strip([tooth(14, vest({ gm: 3 }, { gm: null }, { gm: 2 }))])
    expect(paths(wrapper, 'margin')).toHaveLength(0)
    expect(dots(wrapper, 'margin')).toHaveLength(2)
  })

  it('a 0 is drawn, on the baseline', async () => {
    const wrapper = await strip([tooth(14, vest({ gm: 0 }, { gm: null }, { gm: null }))])
    const [dot] = dots(wrapper, 'margin')
    expect(dot).toBeDefined()
    expect(Number(dot!.attributes('cy'))).toBe(60) // depth-up baseline
    expect(dot!.attributes('data-mm')).toBe('0')
  })

  it('an unmeasured site draws nothing', async () => {
    const wrapper = await strip([tooth(14)])
    expect(paths(wrapper, 'margin')).toHaveLength(0)
    expect(dots(wrapper, 'probing')).toHaveLength(0)
  })

  it('a lone point is a circle, not an empty path', async () => {
    const wrapper = await strip([tooth(14, vest({ pd: 4 }, { pd: null }, { pd: null }))])
    expect(paths(wrapper, 'probing')).toHaveLength(0)
    expect(dots(wrapper, 'probing')).toHaveLength(1)
  })
})

describe('PerioProfileStrip — Margen from zero, negatives where they are', () => {
  it.each([-1, -3, -5])('a margin of %i is drawn at its own height, in both directions', async (mm) => {
    const t = tooth(14, vest({ gm: mm }, { gm: null }, { gm: null }))

    const up = dots(await strip([t], 'depth-up'), 'margin')[0]!
    const down = dots(await strip([t], 'depth-down'), 'margin')[0]!

    expect(Number(up.attributes('cy'))).toBe(60 - mm * 4)
    expect(Number(down.attributes('cy'))).toBe(mm * 4)
    expect(up.attributes('data-mm')).toBe(String(mm))
  })

  it('-5 is not drawn at -3', async () => {
    const at = async (mm: number) => Number(
      dots(await strip([tooth(14, vest({ gm: mm }, {}, {}))]), 'margin')[0]!.attributes('cy')
    )
    expect(await at(-5)).not.toBe(await at(-3))
  })

  it('3 | -5 | 2 draws one path whose points are each measured from the baseline', async () => {
    const wrapper = await strip([tooth(14, vest({ gm: 3 }, { gm: -5 }, { gm: 2 }))])

    const [path] = paths(wrapper, 'margin')
    expect(path!.attributes('d')).toBe('M 12,48 L 30,80 L 48,52')
  })

  it('the SVG does not clip what lies past the baseline', async () => {
    const wrapper = await strip([tooth(14, vest({ gm: -5 }, {}, {}))])
    expect(wrapper.find('svg').attributes('style')).toMatch(/overflow:\s*visible/)
  })

  it('no ancestor in the component tree clips the strip vertically', () => {
    // The overlay is an absolutely positioned div over a table cell; none of
    // the module's components sets overflow on the way up except the chart's
    // horizontal scroller, which wraps the whole table and so also contains
    // every strip's overhang.
    const dir = '../backend/app/modules/periodontogram/frontend/components'
    const read = (f: string) => readFileSync(resolve(process.cwd(), dir, f), 'utf8')
    expect(read('PerioArchBlock.vue')).not.toMatch(/overflow(-hidden|:\s*hidden)/)
    expect(read('PerioProfileStrip.vue')).not.toMatch(/overflow(-hidden|:\s*hidden)/)
    const chart = read('PeriodontogramChart.vue')
    expect([...chart.matchAll(/overflow[-\w]*/g)].map(m => m[0])).toEqual(['overflow-x-auto'])
  })
})

describe('PerioProfileStrip — Sondaje: neutral line, red dot from 4 mm', () => {
  const teeth = [tooth(14, vest({ pd: 3 }, { pd: 5 }, { pd: 2 }))]

  it('3 | 5 | 2: one neutral path, three dots, only the 5 is red', async () => {
    const wrapper = await strip(teeth)

    const [path] = paths(wrapper, 'probing')
    expect(path!.attributes('stroke')).toBe('var(--color-text-muted)')
    expect(path!.attributes('stroke')).not.toMatch(/pd-stroke|red/)

    const drawn = dots(wrapper, 'probing')
    expect(drawn.map(d => d.attributes('data-alert'))).toEqual(['false', 'true', 'false'])
    expect(drawn.map(d => d.attributes('fill'))).toEqual([
      'var(--color-text-muted)', 'var(--perio-pd-stroke)', 'var(--color-text-muted)'
    ])
  })

  it.each([0, 1, 2, 3])('%i mm is not red', async (pd) => {
    const wrapper = await strip([tooth(14, vest({ pd }, {}, {}))])
    const [dot] = dots(wrapper, 'probing')
    expect(dot!.attributes('data-alert')).toBe('false')
    expect(dot!.attributes('fill')).not.toBe('var(--perio-pd-stroke)')
  })

  it.each([4, 5, 6, 7, 10, 15])('%i mm is red', async (pd) => {
    const wrapper = await strip([tooth(14, vest({ pd }, {}, {}))])
    const [dot] = dots(wrapper, 'probing')
    expect(dot!.attributes('data-alert')).toBe('true')
    expect(dot!.attributes('fill')).toBe('var(--perio-pd-stroke)')
  })

  it('the path does not turn red, even when both ends are 4 or more', async () => {
    const wrapper = await strip([tooth(14, vest({ pd: 5 }, { pd: 6 }, { pd: 4 }))])
    const [path] = paths(wrapper, 'probing')
    expect(path!.attributes('stroke')).toBe('var(--color-text-muted)')
    expect(dots(wrapper, 'probing').every(d => d.attributes('data-alert') === 'true')).toBe(true)
  })

  it('draws the probing depth itself, not margin + probing', async () => {
    const wrapper = await strip([tooth(14, vest({ pd: 3, gm: 2 }, { pd: 5, gm: -2 }, { pd: 2, gm: 1 }))])
    expect(dots(wrapper, 'probing').map(d => Number(d.attributes('cy')))).toEqual([48, 40, 52])
    expect(dots(wrapper, 'probing').map(d => d.attributes('data-mm'))).toEqual(['3', '5', '2'])
  })

  it('no pocket band is drawn any more', async () => {
    const wrapper = await strip([tooth(14, vest({ pd: 3, gm: 2 }, { pd: 5, gm: 1 }, { pd: 2, gm: 1 }))])
    expect(wrapper.html()).not.toContain('perio-pocket-band')
    expect(wrapper.findAll('path[fill]:not([fill="none"])')).toHaveLength(0)
  })
})

describe('PerioProfileStrip — the same snapshot draws the same, every time', () => {
  const snapshot = [
    tooth(14, vest({ pd: 3, gm: 3 }, { pd: 5, gm: -5 }, { pd: 2, gm: 2 })),
    tooth(15, vest({ pd: 4, gm: null }, { pd: null, gm: 1 }, { pd: 6, gm: 0 }))
  ]

  it('saved, left and reopened (a fresh copy of the data) renders identically', async () => {
    const first = await strip(snapshot)
    const reopened = await strip(JSON.parse(JSON.stringify(snapshot)))
    expect(reopened.html()).toBe(first.html())
  })

  it('a closed snapshot opened from the history draws what the draft drew', async () => {
    // The history view hands the closed snapshot's teeth to the same
    // component; a snapshot differs only by being immutable.
    const draft = await strip(snapshot, 'depth-up')
    const closed = await strip(structuredClone(snapshot), 'depth-up')
    expect(closed.findAll('path').map(p => p.attributes('d')))
      .toEqual(draft.findAll('path').map(p => p.attributes('d')))
    expect(closed.findAll('circle').map(c => c.attributes('cy')))
      .toEqual(draft.findAll('circle').map(c => c.attributes('cy')))
  })
})

// ===========================================================================
// the Suma row
// ===========================================================================

describe('PerioArchBlock — the Suma row', () => {
  const StripStub = defineComponent({
    name: 'PerioProfileStrip',
    props: { teeth: { type: Array, default: () => [] }, face: { type: String, default: '' }, direction: { type: String, default: '' } },
    setup() { return () => h('div', { 'data-testid': 'strip-stub' }) }
  })
  const LateralStub = defineComponent({
    name: 'PerioToothLateral',
    props: { tooth: { type: Object, default: null }, face: { type: String, default: '' }, readonly: Boolean, markersPosition: { type: String, default: '' } },
    setup() { return () => h('div') }
  })

  const teeth = [
    tooth(14, {
      ...vest({ pd: 3, gm: 2 }, { pd: 5, gm: -5 }, { pd: 2, gm: null }),
      ML: { pd: 4, gm: 1 }, L: { pd: 5, gm: -5 }, DL: { pd: null, gm: 2 }
    }),
    tooth(15)
  ]

  async function arch(which: 'upper' | 'lower') {
    const lower = [44, 45].map(n => tooth(n, {
      ...vest({ pd: 3, gm: 2 }, { pd: 5, gm: -5 }, { pd: 2, gm: null }),
      ML: { pd: 4, gm: 1 }, L: { pd: 5, gm: -5 }, DL: { pd: null, gm: 2 }
    }))
    return mountSuspended(PerioArchBlock, {
      props: { arch: which, teeth: which === 'upper' ? teeth : lower },
      global: { components: { PerioProfileStrip: StripStub, PerioToothLateral: LateralStub } }
    })
  }

  const sumCells = (wrapper: Awaited<ReturnType<typeof arch>>, tooth: number) =>
    wrapper.findAll(`[data-testid^="perio-sum-${tooth}-"]`)

  it.each(['upper', 'lower'] as const)('%s arch: one Suma row in each of its two zones', async (which) => {
    const wrapper = await arch(which)
    const rows = wrapper.findAll('tr').filter(r => r.find('[data-testid^="perio-sum-"]').exists())

    expect(rows).toHaveLength(2)
    // One per face: the amber (vestibular) zone and the sky (palatal/lingual) one.
    expect(rows.map(r => r.classes().find(c => c.startsWith('perio-row-'))).sort())
      .toEqual(['perio-row-palatal', 'perio-row-vestibular'])
  })

  it('every zone shows three cells per tooth, one for each site', async () => {
    const wrapper = await arch('upper')
    expect(wrapper.findAll('[data-testid^="perio-sum-"]')).toHaveLength(2 /* zones */ * 2 /* teeth */ * 3)
  })

  it('shows probing + margin, sign respected, and a real 0', async () => {
    const wrapper = await arch('upper')
    const vestibular = wrapper.findAll('tr.perio-row-vestibular [data-testid^="perio-sum-14-"]')

    // MV 3+2, V 5+(-5), DV 2+null
    expect(vestibular.map(c => c.text())).toEqual(['5', '0', ''])
  })

  it('the 0 from clinicalSum(-5, 5) is displayed, not hidden', async () => {
    const wrapper = await arch('upper')
    const cell = wrapper.find('[data-testid="perio-sum-14-V"]')
    expect(cell.text()).toBe('0')
  })

  it('shows the same on the palatal / lingual face', async () => {
    const upper = await arch('upper')
    expect(upper.findAll('tr.perio-row-palatal [data-testid^="perio-sum-14-"]').map(c => c.text()))
      .toEqual(['5', '0', ''])
    const lower = await arch('lower')
    expect(lower.findAll('tr.perio-row-palatal [data-testid^="perio-sum-44-"]').map(c => c.text()))
      .toEqual(['5', '0', ''])
    expect(lower.findAll('tr.perio-row-vestibular [data-testid^="perio-sum-44-"]').map(c => c.text()))
      .toEqual(['5', '0', ''])
  })

  it('is empty when either value is missing — never a 0 standing in for it', async () => {
    const wrapper = await arch('upper')
    expect(sumCells(wrapper, 15).map(c => c.text()).every(text => text === '')).toBe(true)
    // DV has a margin but no probing depth on the palatal side.
    expect(wrapper.find('tr.perio-row-palatal [data-testid="perio-sum-14-DL"]').text()).toBe('')
  })

  it('is read-only: it is not an input', async () => {
    const wrapper = await arch('upper')
    expect(wrapper.find('[data-testid="perio-sum-14-V"]').element.tagName).toBe('SPAN')
  })

  it('keeps the table\'s mirrored layout: Suma sits beside Margen, away from Sondaje', async () => {
    const order = async (which: 'upper' | 'lower', zone: 'vestibular' | 'palatal') => {
      const wrapper = await arch(which)
      return wrapper.findAll(`tr.perio-row-${zone}`).map((r) => {
        const label = r.find('th').text()
        return ['probing', 'margin', 'sum', 'plaque', 'bleeding'].find(k => label.includes(`arch.${k}`))
      })
    }
    expect(await order('upper', 'vestibular')).toEqual(['probing', 'margin', 'sum', 'plaque', 'bleeding'])
    expect(await order('upper', 'palatal')).toEqual(['bleeding', 'plaque', 'sum', 'margin', 'probing'])
    expect(await order('lower', 'palatal')).toEqual(['probing', 'margin', 'sum', 'plaque', 'bleeding'])
    expect(await order('lower', 'vestibular')).toEqual(['bleeding', 'plaque', 'sum', 'margin', 'probing'])
  })

  it('leaves the other rows alone: probing and margin inputs, plaque and bleeding toggles', async () => {
    const wrapper = await arch('upper')
    expect(wrapper.findAll('input[type="number"][max="15"]').length).toBeGreaterThan(0)
    expect(wrapper.findAll('input[type="number"][min="-5"]').length).toBeGreaterThan(0)
    expect(wrapper.findAll('.perio-cell-toggle--bop').length).toBeGreaterThan(0)
    expect(wrapper.findAll('.perio-cell-toggle--plaque').length).toBeGreaterThan(0)
  })
})
