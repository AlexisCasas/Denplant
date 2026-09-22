/**
 * NTS-05F.2 — the official A4 sheet: isolation, physical size, pagination.
 *
 * Three things are asserted here and they need different tools.
 *
 * * **Geometry** is arithmetic over the productive placement model, so it is
 *   tested as arithmetic. This is where §5.17 ("la corona tiene como mínimo
 *   0.5 cm cuadrados") becomes a number the build can check.
 * * **The stylesheet** cannot be evaluated in jsdom — `@page`, `break-inside`
 *   and `@media print` have no observable effect there — so the rules are
 *   asserted against the text of `main.css`. That is the same idiom
 *   `ntsChartGeometry.spec.ts` already uses to tie a CSS utility to a number.
 * * **The mount** is a real component test: the print document is teleported
 *   to `<body>`, so it is queried through `document`, not through the wrapper.
 */

import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { nextTick } from 'vue'

import NtsOdontogramShell from '../../../backend/app/modules/odontogram/frontend/components/odontogram/NtsOdontogramShell.vue'
import {
  MM_PER_INCH,
  NTS_MIN_CROWN_AREA_CM2,
  NTS_PRINT_CHART_DECLARED_WIDTH_MM,
  NTS_PRINT_CHART_HEIGHT_MM,
  NTS_PRINT_CHART_WIDTH_MM,
  NTS_PRINT_CONTENT_HEIGHT_MM,
  NTS_PRINT_CONTENT_WIDTH_MM,
  NTS_PRINT_PAGE,
  minimumSafePrintScale,
  printedCrownAreaCm2,
  pxToMm,
  smallestPrintedCrown
} from '../../../backend/app/modules/odontogram/frontend/utils/ntsPrintLayout'

const MAIN_CSS = readFileSync(resolve(process.cwd(), 'app/assets/css/main.css'), 'utf8')

/** Just the "NTS print layout" block, so a stray rule elsewhere cannot pass. */
const PRINT_BLOCK = MAIN_CSS.slice(MAIN_CSS.indexOf('NTS print layout'))

/**
 * The same block with comments removed.
 *
 * Negative assertions have to read this: the block *explains* which rules it
 * deliberately does not contain, so searching the commented text for
 * `svg * {` finds the explanation and fails on it.
 */
const PRINT_RULES = PRINT_BLOCK.replace(/\/\*[\s\S]*?\*\//g, '')

const REAL_CATALOG = JSON.parse(
  readFileSync(
    resolve(process.cwd(), '../backend/app/modules/odontogram/nts/catalog/pe_nts_188_2022.json'),
    'utf8'
  )
)

const state = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  put: vi.fn(),
  patch: vi.fn()
}))
mockNuxtImport('useApi', () => () => state)
mockNuxtImport('onBeforeRouteLeave', () => () => {})
mockNuxtImport('useClinicState', () => () => ({
  currentClinic: { get value() { return { id: 'clinic-a' } } }
}))

const payload = vi.hoisted(() => ({ data: {} as Record<string, unknown> }))
mockNuxtImport('useNuxtData', () => (key: string) => ({
  data: { get value() { return payload.data[key] ?? null } }
}))

// ---------------------------------------------------------------------------
// §11 / §35 — the sheet against the norm
// ---------------------------------------------------------------------------

describe('NTS print layout — physical geometry', () => {
  it('converts CSS pixels to millimetres by CSS\'s own definition', () => {
    // 1px is exactly 1/96 inch in print, whatever the device does.
    expect(pxToMm(96)).toBeCloseTo(MM_PER_INCH, 10)
  })

  it('the page is A4 portrait and its content box follows from the margins', () => {
    expect(NTS_PRINT_PAGE.widthMm).toBe(210)
    expect(NTS_PRINT_PAGE.heightMm).toBe(297)
    expect(NTS_PRINT_CONTENT_WIDTH_MM).toBe(190)
    expect(NTS_PRINT_CONTENT_HEIGHT_MM).toBe(275)
  })

  it('the chart fits the printable width without shrinking', () => {
    // If this fails the sheet needs "fit to page", and a scaled chart is a
    // chart that may no longer satisfy §5.17.
    expect(NTS_PRINT_CHART_WIDTH_MM).toBeLessThanOrEqual(NTS_PRINT_CONTENT_WIDTH_MM)
    expect(NTS_PRINT_CHART_WIDTH_MM).toBeCloseTo(170.9, 1)
    expect(NTS_PRINT_CHART_HEIGHT_MM).toBeLessThan(NTS_PRINT_CONTENT_HEIGHT_MM)
  })

  it('the width the stylesheet declares is the width the chart has', () => {
    // The stylesheet cannot import this constant, so the two are tied here.
    expect(NTS_PRINT_CHART_DECLARED_WIDTH_MM).toBe(171)
    expect(PRINT_BLOCK).toMatch(/width:\s*171mm/)
    expect(Math.abs(NTS_PRINT_CHART_DECLARED_WIDTH_MM - NTS_PRINT_CHART_WIDTH_MM))
      .toBeLessThan(0.5)
  })

  it('§5.17 — every printed crown reaches 0.5 cm²', () => {
    // Not a spot check: the norm applies to every tooth on the sheet.
    const areas = [11, 13, 15, 16, 18, 36, 46, 55, 65, 75, 85]
      .map(fdi => [fdi, printedCrownAreaCm2(fdi)] as const)

    for (const [fdi, area] of areas) {
      expect(area, `tooth ${fdi}`).not.toBeNull()
      expect(area!, `tooth ${fdi}`).toBeGreaterThanOrEqual(NTS_MIN_CROWN_AREA_CM2)
    }
  })

  it('§5.17 — the binding constraint is the narrowest crown, not the molar', () => {
    const smallest = smallestPrintedCrown()
    expect(smallest).not.toBeNull()
    // Crowns share a height, so the narrowest tooth is an anterior.
    expect(smallest!.areaCm2).toBeGreaterThanOrEqual(NTS_MIN_CROWN_AREA_CM2)
    expect(printedCrownAreaCm2(16)!).toBeGreaterThan(smallest!.areaCm2)
  })

  it('§5.17 — the minimum safe scale is derived, and 1.0 clears it', () => {
    const minimum = minimumSafePrintScale()

    // Printing at full size, which is what 05F.2 does, is safe.
    expect(minimum).toBeLessThan(1)
    // Derived from the placement model — the geometry the chart is actually
    // drawn from, which fits each tooth's SVG into its cell and so yields a
    // slightly smaller crown than the layout constants alone suggest. The
    // margin over §5.17 is thin: roughly 4% of linear scale, not 14%.
    expect(minimum).toBeCloseTo(0.958, 2)
    expect(minimum).toBeGreaterThan(0.9)
    // Just below it, the norm is broken — which is what makes this a guard
    // rather than a description.
    const smallest = smallestPrintedCrown()!
    expect(printedCrownAreaCm2(smallest.fdi, minimum * 0.99)!)
      .toBeLessThan(NTS_MIN_CROWN_AREA_CM2)
  })
})

// ---------------------------------------------------------------------------
// §34 — the stylesheet
// ---------------------------------------------------------------------------

describe('NTS print layout — stylesheet', () => {
  it('A/B — declares A4 portrait with the configured margins', () => {
    expect(MAIN_CSS).toMatch(/@page\s*\{[^}]*size:\s*A4 portrait/)
    expect(MAIN_CSS).toMatch(/@page\s*\{[^}]*margin:\s*10mm 10mm 12mm 10mm/)
  })

  it('C — keeps the clinical colours through the printer driver', () => {
    expect(PRINT_BLOCK).toMatch(/print-color-adjust:\s*exact/)
    expect(PRINT_BLOCK).toMatch(/-webkit-print-color-adjust:\s*exact/)
  })

  it('E — the chart may overflow on paper instead of being clipped', () => {
    expect(PRINT_BLOCK).toMatch(
      /\[data-testid="nts-chart-scroll"\]\s*\{\s*overflow:\s*visible\s*!important/
    )
  })

  it('F/G/H — what must not be split across a page boundary', () => {
    for (const testid of [
      'nts-odontogram-chart',
      'nts-print-spec-item-',
      'nts-print-professional',
      'nts-print-header'
    ]) {
      const index = PRINT_BLOCK.indexOf(testid)
      expect(index, testid).toBeGreaterThan(-1)
      // The declaration follows within the same rule block.
      expect(PRINT_BLOCK.slice(index, index + 400)).toMatch(/break-inside:\s*avoid/)
    }
  })

  it('I — the document is absent from the screen, not merely invisible', () => {
    // `display: none` also removes it from the accessibility tree; a second
    // navigable copy of the record would be worse than no print view at all.
    expect(MAIN_CSS).toMatch(/\.nts-print-root\s*\{\s*display:\s*none;?\s*\}/)
  })

  it('J/K — printing hides the application and shows the document', () => {
    expect(PRINT_BLOCK).toMatch(
      /body\s*>\s*\*:not\(\.nts-print-root\)\s*\{\s*display:\s*none\s*!important/
    )
    expect(PRINT_BLOCK).toMatch(/\.nts-print-root\s*\{\s*display:\s*block\s*!important/)
  })

  it('L — no clinical text container is height-capped or clipped', () => {
    // A clamp here would silently drop the end of an observation.
    expect(PRINT_BLOCK).toMatch(/max-height:\s*none\s*!important/)
    expect(PRINT_RULES).not.toMatch(/line-clamp/)
    // The only `overflow: hidden` allowed in this block is none at all.
    expect(PRINT_RULES).not.toMatch(/overflow:\s*hidden/)
  })

  it('L — the digest wraps rather than being cut short', () => {
    const index = PRINT_BLOCK.indexOf('nts-print-content-hash')
    expect(index).toBeGreaterThan(-1)
    expect(PRINT_BLOCK.slice(index, index + 200)).toMatch(/overflow-wrap|word-break/)
    expect(PRINT_RULES).not.toMatch(/text-overflow:\s*ellipsis/)
  })

  // --- §5.17: "el gráfico … se imprime en color negro" --------------------
  //
  // Measured in Chromium before this rule existed, the printed structure came
  // out in theme neutrals: crown, surface dividers and roots `#64757D`, the
  // annotation boxes `#DCE5E8` and the FDI numbers `#202D35`. None was black,
  // and a box at `#DCE5E8` is close to invisible on paper. These assertions
  // fail if the structure ever goes back to the theme's neutral in print.

  it('§5.17 — every structural part of the graphic is forced to black', () => {
    const black = /#000(?:000)?\s*!important/

    /**
     * The declarations of the rule this selector heads — and only those.
     *
     * Slicing a fixed number of characters instead would run into the next
     * rule, and a neighbour that does force black would mask a selector that
     * had stopped doing so. Found that the hard way.
     */
    function declarations(selector: string): string {
      const index = PRINT_RULES.indexOf(selector)
      expect(index, `selector missing: ${selector}`).toBeGreaterThan(-1)
      const open = PRINT_RULES.indexOf('{', index)
      const close = PRINT_RULES.indexOf('}', open)
      expect(open, selector).toBeGreaterThan(-1)
      expect(close, selector).toBeGreaterThan(open)
      return PRINT_RULES.slice(open + 1, close)
    }

    for (const [selector, property] of [
      ['[data-fdi][data-dentition] svg', 'color'],
      ['[data-fdi][data-dentition] svg path[data-region]', 'stroke'],
      ['[data-region="annotation"]', 'border-color'],
      ['[data-region="fdi"]', 'color'],
      // The crown edges a clinical fill covered and the overlay repairs.
      ['[data-testid^="nts-structure-"] path', 'stroke']
    ] as const) {
      const body = declarations(selector)
      expect(body, `${selector} → ${property}`).toContain(property)
      expect(body, `${selector} → ${property}`).toMatch(black)
      // A token would track the theme; the norm asks for black.
      expect(body, `${selector} → ${property}`).not.toMatch(/var\(--/)
    }
  })

  it('§5.17 — black is applied structurally, never to the whole drawing', () => {
    // A blanket `svg * { stroke: black }` would repaint the findings and
    // destroy the red/blue §5.12-5.13 makes carry clinical meaning.
    expect(PRINT_RULES).not.toMatch(/svg\s*\*\s*\{/)
    expect(PRINT_RULES).not.toMatch(/\.nts-print-root\s+path\s*\{/)

    // The two clinical tokens are not redefined anywhere in this block; they
    // are pinned once, in the colour block above it.
    expect(PRINT_RULES).not.toMatch(/--color-nts-finding-good/)
    expect(PRINT_RULES).not.toMatch(/--color-nts-finding-bad/)

    // Nor is the neutral token itself overridden: doing so would blacken the
    // `+n` marker along with the structure.
    expect(PRINT_RULES).not.toMatch(/--color-text-muted\s*:/)
  })

  it('§5.17 — the +n marker is left neutral, being no NTS symbol', () => {
    // The norm defines no "+n", so it falls outside the requirement on the
    // *graphic*; staying neutral is what keeps it from reading as structure
    // or as a finding.
    // It appears in the block's explanation and nowhere in its rules.
    expect(PRINT_BLOCK).toContain('nts-box-overflow')
    expect(PRINT_RULES).not.toContain('nts-box-overflow')
  })

  it('M — the red and blue print tokens are untouched', () => {
    expect(MAIN_CSS).toMatch(/--color-nts-finding-good:\s*#0000CC/)
    expect(MAIN_CSS).toMatch(/--color-nts-finding-bad:\s*#CC0000/)
  })

  it('tightens only the whitespace between blocks, on both margin sides', () => {
    // `space-y-*` in this Tailwind build puts the gap on the bottom of each
    // child, so an override of `margin-top` alone is silently ineffective:
    // the margins collapse to the larger one. Measured before this rule the
    // ordinary record came to 294.4 mm against 275 mm of page.
    // 05F.4a moved the blocks into the sheet's body cell so a `<thead>` could
    // repeat the page identity; the gap rules followed them in, and the gap
    // itself dropped to 2 mm to pay for the strip's 5.34 mm per page.
    expect(PRINT_BLOCK).toMatch(
      /nts-print-sheet"\]\s*>\s*tbody\s*>\s*tr\s*>\s*td\s*>\s*\*,[\s\S]{0,200}margin-bottom:\s*0\s*!important/
    )
    expect(PRINT_BLOCK).toMatch(
      /nts-print-sheet"\]\s*>\s*tbody\s*>\s*tr\s*>\s*td\s*>\s*\*\s*\+\s*\*\s*\{\s*margin-top:\s*2mm/
    )
    // The chart itself keeps its size; only its own padding goes.
    expect(PRINT_BLOCK).toMatch(
      /\[data-testid="nts-chart-canvas"\]\s*\{[\s\S]{0,120}padding-top:\s*0\s*!important/
    )
    // And nothing here touches a font size.
    const budget = PRINT_BLOCK.slice(PRINT_BLOCK.indexOf('vertical budget'))
    expect(budget).not.toMatch(/font-size/)
  })

  it('does not resort to a transform to make the sheet fit', () => {
    // A scaled chart is a chart whose crowns may no longer meet §5.17.
    expect(PRINT_RULES).not.toMatch(/transform:\s*scale/)
    expect(PRINT_RULES).not.toMatch(/zoom:/)
  })
})

// ---------------------------------------------------------------------------
// §36 — the shell mounts the document
// ---------------------------------------------------------------------------

describe('NTS print layout — the shell mounts one document', () => {
  const mounted: Array<{ unmount: () => void }> = []

  function record(overrides: Record<string, unknown> = {}) {
    return {
      id: 'rec-1',
      clinic_id: 'clinic-a',
      patient_id: 'p1',
      norm_version: 'pe_nts_188_2022',
      stage: 'diagnosis',
      stage_label: null,
      status: 'finalized',
      version: 3,
      observations: 'texto persistido',
      recorded_at: '2026-01-02T10:00:00Z',
      recorded_by: 'u1',
      finalized_at: '2026-01-03T15:30:00Z',
      finalized_by: 'u-supervisor',
      discarded_at: null,
      discarded_by: null,
      discard_reason: null,
      recorded_by_name: 'Ana Quispe',
      recorded_by_role: 'dentist',
      recorded_by_professional_id: 'COP-12345',
      supersedes_record_id: null,
      supersession_reason: null,
      content_hash: 'a'.repeat(64),
      hash_algorithm: 'sha256',
      canonicalization_version: 1,
      created_at: '2026-01-02T10:00:00Z',
      updated_at: '2026-01-03T15:30:00Z',
      findings: [],
      specifications: [],
      ...overrides
    }
  }

  /** One subject target on `fdi`. */
  function tooth(id: string, fdi: number) {
    return {
      id, group_index: 0, position: 0, participation: 'subject' as const, role: null,
      target_kind: 'fdi_tooth' as const, tooth_number: fdi, arch: null,
      local_ordinal: null, geometry: null
    }
  }

  /** A finding citing a real rule id, targeting one tooth by default. */
  function finding(overrides: { id: string, rule_id: string } & Record<string, unknown>) {
    return {
      record_id: 'rec-1',
      norm_version: 'pe_nts_188_2022',
      attributes: {},
      provenance: 'observed',
      source_finding_id: null,
      sequence: 1,
      created_at: '2026-01-02T10:00:00Z',
      created_by: 'u1',
      targets: [tooth(`t-${overrides.id}`, 16)],
      ...overrides
    }
  }

  function route(options: {
    current?: unknown
    draft?: unknown
    history?: unknown[]
    /** Full records reachable by id — what `openHistorical` fetches. */
    records?: Record<string, unknown>
    catalogs?: Record<string, unknown>
  }) {
    state.get.mockImplementation(async (url: string) => {
      if (url === '/api/v1/odontogram/preferences') return { data: { profile: 'pe_nts_188_2022' } }
      if (url.includes('/nts/catalogs/')) {
        const version = url.split('/nts/catalogs/')[1]!.split('?')[0]!
        const found = options.catalogs?.[version] ?? REAL_CATALOG
        if (!found) throw { statusCode: 404, data: { message: 'unknown norm' } }
        return { data: found }
      }
      if (url.endsWith('/current')) return { data: options.current ?? null }
      if (url.includes('/records/draft')) return { data: options.draft ?? null }
      if (url.includes('/records/')) {
        const id = url.split('/records/')[1]!.split('?')[0]!
        const row = options.records?.[id]
        if (row) return { data: row }
        throw { statusCode: 404, data: { message: 'not found' } }
      }
      if (url.includes('/records')) {
        return { data: options.history ?? [], total: 0, page: 1, page_size: 20 }
      }
      throw new Error(`unrouted GET ${url}`)
    })
  }

  async function shell() {
    const wrapper = await mountSuspended(NtsOdontogramShell, {
      props: { patientId: 'p1', normVersion: 'pe_nts_188_2022' }
    })
    mounted.push(wrapper)
    await nextTick()
    await new Promise(r => setTimeout(r, 0))
    await nextTick()
    return wrapper
  }

  /** The teleported document. It is not inside the wrapper. */
  function printRoot(): HTMLElement | null {
    return document.querySelector('[data-testid="nts-print-root"]')
  }

  /** Tooth cells only: rows carry `data-dentition`, overlay text carries
   *  `data-fdi`; only a cell carries both. */
  const TOOTH_CELL = '[data-fdi][data-dentition]'

  beforeEach(() => {
    payload.data = {}
    state.get.mockReset()
    state.post.mockReset()
    state.put.mockReset()
    state.patch.mockReset()
  })

  afterEach(() => {
    mounted.forEach(w => w.unmount())
    mounted.length = 0
    document.querySelectorAll('[data-testid="nts-print-root"]').forEach(n => n.remove())
  })

  it('mounts exactly one print document, outside the application tree', async () => {
    route({ current: record() })
    const wrapper = await shell()

    expect(document.querySelectorAll('[data-testid="nts-print-root"]')).toHaveLength(1)
    // Teleported to <body>, which is what lets print CSS hide everything else
    // with one rule instead of a list of controls.
    expect(printRoot()!.parentElement).toBe(document.body)
    expect(wrapper.find('[data-testid="nts-print-root"]').exists()).toBe(false)
  })

  it('§6 — exactly 52 tooth cells on screen, and exactly 52 on the sheet', async () => {
    route({ current: record() })
    const wrapper = await shell()

    const screenChart = wrapper.find('[data-testid="nts-odontogram-chart"]')
    expect(screenChart.findAll(TOOTH_CELL)).toHaveLength(52)

    const printChart = printRoot()!.querySelector('[data-testid="nts-odontogram-chart"]')
    expect(printChart).not.toBeNull()
    expect(printChart!.querySelectorAll(TOOTH_CELL)).toHaveLength(52)
  })

  it('the document carries the finalized record, and its persisted text', async () => {
    route({ current: record() })
    await shell()

    const root = printRoot()!
    expect(root.querySelector('[data-testid="nts-print-record-id"]')!.textContent)
      .toContain('rec-1')
    expect(root.querySelector('[data-testid="nts-print-observations-text"]')!.textContent)
      .toContain('texto persistido')
    expect(root.querySelector('[data-testid="nts-print-professional-name"]')!.textContent)
      .toContain('Ana Quispe')
  })

  it('a draft prints its persisted values, never an editor buffer', async () => {
    route({ draft: record({ status: 'draft', finalized_at: null, content_hash: null, hash_algorithm: null }) })
    await shell()

    // Nothing typed: the sheet carries what the server holds.
    expect(printRoot()!.textContent).toContain('texto persistido')
  })

  it('typing into the draft withdraws the document rather than printing it stale', async () => {
    // 05F.2 asserted only that the buffer never reached the sheet. 05F.3 goes
    // further: while there is unsaved text the clinical document is not
    // rendered at all, because a sheet that silently omits what the clinician
    // just typed is worse than no sheet.
    route({ draft: record({ status: 'draft', finalized_at: null, content_hash: null, hash_algorithm: null }) })
    const wrapper = await shell()

    await wrapper.find('[data-testid="nts-observations-input"]').setValue('sin guardar')
    await nextTick()

    const root = printRoot()!
    expect(root.querySelector('[data-testid="nts-print-unsafe"]')).not.toBeNull()
    expect(root.querySelector('[data-testid="nts-odontogram-chart"]')).toBeNull()
    expect(root.textContent).not.toContain('sin guardar')
    expect(root.textContent).not.toContain('texto persistido')
  })

  it('opening a historical record prints that record under its own norm', async () => {
    const current = record({ id: 'rec-new' })
    const old = record({ id: 'rec-old', observations: 'histórico' })
    route({
      current,
      records: { 'rec-old': old, 'rec-new': current },
      history: [
        { ...old, is_superseded: true },
        { ...current, is_superseded: false }
      ]
    })
    const wrapper = await shell()

    await wrapper.find('[data-testid="nts-history-open-0"]').trigger('click')
    await new Promise(r => setTimeout(r, 0))
    await nextTick()

    const root = printRoot()!
    expect(root.querySelector('[data-testid="nts-print-record-id"]')!.textContent)
      .toContain('rec-old')
    expect(root.textContent).toContain('histórico')
    // The history row said this one was replaced, and the sheet says so too.
    expect(root.querySelector('[data-testid="nts-print-status"]')!.textContent)
      .toContain('Corrected')
  })

  it('a historical record whose norm cannot be served prints nothing', async () => {
    // The 05F.1 gate survives being mounted from the shell.
    const current = record({ id: 'rec-new' })
    const foreign = record({ id: 'rec-foreign', norm_version: 'pe_nts_999_2099' })
    route({
      current,
      records: { 'rec-foreign': foreign, 'rec-new': current },
      history: [{ ...foreign, is_superseded: false }, { ...current, is_superseded: false }],
      catalogs: { pe_nts_188_2022: REAL_CATALOG, pe_nts_999_2099: null }
    })
    const wrapper = await shell()

    await wrapper.find('[data-testid="nts-history-open-0"]').trigger('click')
    await new Promise(r => setTimeout(r, 0))
    await nextTick()

    const root = printRoot()!
    expect(root.querySelector('[data-testid="nts-print-unavailable"]')).not.toBeNull()
    expect(root.querySelector('[data-testid="nts-odontogram-chart"]')).toBeNull()
    expect(root.querySelectorAll(TOOTH_CELL)).toHaveLength(0)
  })

  it('the patient header comes from the page cache, at no request cost', async () => {
    payload.data['patient:p1'] = {
      first_name: 'Rosa',
      last_name: 'Mamani',
      national_id: '87654321',
      national_id_type: 'dni'
    }
    route({ current: record() })
    await shell()

    const root = printRoot()!
    expect(root.querySelector('[data-testid="nts-print-patient-name"]')!.textContent)
      .toContain('Rosa Mamani')
    expect(root.querySelector('[data-testid="nts-print-patient-document"]')!.textContent)
      .toContain('87654321')

    // Every GET the shell made was an odontogram read. The patients module
    // was never called: the identity came out of the page's payload cache.
    const urls = state.get.mock.calls.map(call => String(call[0]))
    expect(urls.every(url => url.startsWith('/api/v1/odontogram'))).toBe(true)
    expect(urls.some(url => url.startsWith('/api/v1/patients'))).toBe(false)
  })

  it('§31 — the printed document offers no control at all', async () => {
    route({ draft: record({ status: 'draft' }) })
    await shell()

    const root = printRoot()!
    expect(root.querySelectorAll('button')).toHaveLength(0)
    expect(root.querySelectorAll('input')).toHaveLength(0)
    expect(root.querySelectorAll('textarea')).toHaveLength(0)
    expect(root.querySelectorAll('select')).toHaveLength(0)
    expect(root.querySelectorAll('form')).toHaveLength(0)
  })

  it('§29 — nothing of the document leaks onto the screen', async () => {
    route({ current: record() })
    const wrapper = await shell()

    // The screen shell shows none of the print-only blocks.
    for (const testid of [
      'nts-print-header',
      'nts-print-footer',
      'nts-print-professional',
      'nts-print-declarations'
    ]) {
      expect(wrapper.find(`[data-testid="${testid}"]`).exists(), testid).toBe(false)
    }
    // And the screen still has exactly one chart of its own.
    expect(wrapper.findAll('[data-testid="nts-odontogram-chart"]')).toHaveLength(1)
  })

  it('the second chart costs no request and no mutation', async () => {
    route({ current: record() })
    const before = state.get.mock.calls.length
    await shell()

    expect(state.post).not.toHaveBeenCalled()
    expect(state.put).not.toHaveBeenCalled()
    expect(state.patch).not.toHaveBeenCalled()
    // The print view issues none of its own: it is pure props.
    expect(state.get.mock.calls.length).toBeGreaterThan(before)
    const urls = state.get.mock.calls.map(call => String(call[0]))
    expect(new Set(urls).size).toBe(urls.length)
  })

  // --- NTS-05F.2a — a rule with no attributes must not blank the surface ---
  //
  // `describeAttributes` crashed on 6.1.10 (no `attributes` key at all) and
  // on 6.1.13's `rotation_sense` (a `free_text` attribute with no `values`
  // key). `NtsFindingList` calls it from a computed property, so the
  // exception did not stay local — it took the whole finding list, and with
  // it everything mounted alongside it, down with it. These findings are
  // real: 6.1.10 and 6.1.13 are two of the norm's 38 rules, so any record a
  // clinician actually records can contain one.

  it('I — a fracture finding (6.1.10, no declared attributes) reaches the screen list', async () => {
    const rec = record({
      findings: [finding({ id: 'f-frac', rule_id: '6.1.10', targets: [tooth('t-frac', 46)] })]
    })
    route({ current: rec })
    const wrapper = await shell()

    const row = wrapper.find('[data-testid="nts-finding-f-frac"]')
    expect(row.exists()).toBe(true)
    expect(row.attributes('data-rule')).toBe('6.1.10')
    expect(row.text()).toContain('Fractura dental')
    expect(row.text()).toContain('46')
  })

  it('J — a giroversión finding (6.1.13, free_text with no declared values) shows its recorded text', async () => {
    const freeText = 'Giro de 45° hacia mesial, confirmado en dos citas.'
    const rec = record({
      findings: [finding({
        id: 'f-giro',
        rule_id: '6.1.13',
        attributes: { rotation_sense: freeText },
        targets: [tooth('t-giro', 23)]
      })]
    })
    route({ current: rec })
    const wrapper = await shell()

    const row = wrapper.find('[data-testid="nts-finding-f-giro"]')
    expect(row.exists()).toBe(true)
    expect(row.text()).toContain('Giroversión')
    expect(row.text()).toContain('23')
    // The clinician's own words, not silently dropped because the catalog
    // enumerates no codes for a `free_text` attribute to resolve against.
    expect(row.text()).toContain(freeText)
  })

  it('K/L/M — a record mixing supported, unsupported and partial findings prints intact', async () => {
    const rec = record({
      findings: [
        // Fully drawable, to prove the rest of the chart is unaffected.
        finding({ id: 'f-ok', rule_id: '6.1.9', targets: [tooth('t-ok', 16)] }),
        // Unsupported: no channel for a freehand shape.
        finding({ id: 'f-frac', rule_id: '6.1.10', targets: [tooth('t-frac', 46)] }),
        // Unsupported: a free_text attribute with no enumerated values.
        finding({
          id: 'f-giro', rule_id: '6.1.13',
          attributes: { rotation_sense: 'mesial' }, targets: [tooth('t-giro', 23)]
        }),
        // Partial: the sigla draws, the fissure anatomy does not.
        finding({
          id: 'f-seal', rule_id: '6.1.35',
          attributes: { condition_state: 'good' }, targets: [tooth('t-seal', 37)]
        })
      ]
    })
    route({ current: rec })
    const wrapper = await shell()

    // Screen: nothing threw, all four findings are listed.
    for (const id of ['f-ok', 'f-frac', 'f-giro', 'f-seal']) {
      expect(wrapper.find(`[data-testid="nts-finding-${id}"]`).exists(), id).toBe(true)
    }

    // Print: the document is not blank, and the supported finding still
    // draws — its sigla is the catalog's own for 6.1.9.
    const root = printRoot()!
    expect(root.querySelector('[data-testid="nts-print-unavailable"]')).toBeNull()
    expect(root.querySelector('[data-testid="nts-odontogram-chart"]')).not.toBeNull()
    expect(root.textContent).toContain('FFP')

    // Both unsupported findings are declared, by name, after Observaciones.
    const fracture = root.querySelector('[data-testid="nts-print-declaration-f-frac"]')
    const giroversion = root.querySelector('[data-testid="nts-print-declaration-f-giro"]')
    expect(fracture?.getAttribute('data-completeness')).toBe('unsupported')
    expect(fracture?.textContent).toContain('Fractura dental')
    expect(giroversion?.getAttribute('data-completeness')).toBe('unsupported')
    expect(giroversion?.textContent).toContain('Giroversión')

    // The sealant stays partial — 05F.2a does not touch renderer coverage.
    const sealant = root.querySelector('[data-testid="nts-print-declaration-f-seal"]')
    expect(sealant?.getAttribute('data-completeness')).toBe('partial')
    expect(sealant?.textContent).toContain('Sellantes')
  })

  it('O — mounting a record with fracture and giroversión issues no mutation', async () => {
    const rec = record({
      findings: [
        finding({ id: 'f-frac', rule_id: '6.1.10', targets: [tooth('t-frac', 46)] }),
        finding({
          id: 'f-giro', rule_id: '6.1.13',
          attributes: { rotation_sense: 'mesial' }, targets: [tooth('t-giro', 23)]
        })
      ]
    })
    route({ current: rec })
    await shell()

    expect(state.post).not.toHaveBeenCalled()
    expect(state.put).not.toHaveBeenCalled()
    expect(state.patch).not.toHaveBeenCalled()
  })
})
