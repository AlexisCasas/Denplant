/**
 * NTS-05F.3 — when printing is offered, what it warns about, and what the
 * sheet says it is.
 *
 * Three things are under test and they are deliberately separate:
 *
 * * **Availability** is a pure function of the shell's state. It is tested as
 *   arithmetic, because the interesting cases (a failed refetch, an
 *   unacknowledged conflict) are states, not clicks.
 * * **The control** — label, disabled reason, and the fact that confirming
 *   calls `window.print()` exactly once and cancelling calls it not at all.
 * * **The sheet** — the qualification a draft, a discarded or a superseded
 *   record carries, in words rather than in colour.
 *
 * The one property tying them together has its own test: the button and the
 * always-mounted print root consume the *same* availability object, so the
 * browser's own Ctrl+P cannot reach a document the button refuses.
 */

import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { nextTick } from 'vue'

import NtsOdontogramShell from '../../../backend/app/modules/odontogram/frontend/components/odontogram/NtsOdontogramShell.vue'
import {
  canRenderPrintRecord,
  resolvePrintAvailability
} from '../../../backend/app/modules/odontogram/frontend/utils/ntsPrintModel'
import type {
  NtsPrintAvailabilityInput
} from '../../../backend/app/modules/odontogram/frontend/utils/ntsPrintModel'
import type { NtsRecord } from '../../../backend/app/modules/odontogram/frontend/types/nts'

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
// fixtures
// ---------------------------------------------------------------------------

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

function tooth(id: string, fdi: number) {
  return {
    id, group_index: 0, position: 0, participation: 'subject' as const, role: null,
    target_kind: 'fdi_tooth' as const, tooth_number: fdi, arch: null,
    local_ordinal: null, geometry: null
  }
}

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

/** Everything clear: a finalized record nobody is touching. */
function clearState(
  overrides: Partial<NtsPrintAvailabilityInput> = {}
): NtsPrintAvailabilityInput {
  return {
    record: record() as unknown as NtsRecord,
    catalog: REAL_CATALOG,
    dirty: false,
    writing: false,
    loading: false,
    refreshing: false,
    openingHistorical: false,
    refreshFailed: false,
    conflict: false,
    ...overrides
  }
}

// ---------------------------------------------------------------------------
// §38 — the availability model
// ---------------------------------------------------------------------------

describe('print availability is one decision, taken from the shell\'s own state', () => {
  it('A/B/C/D — status qualifies a document, it never refuses one', () => {
    // §5.6 makes a *recorded finding* inalterable. It does not make a working
    // copy unprintable; the sheet says what it is instead.
    for (const status of ['finalized', 'draft', 'discarded']) {
      const result = resolvePrintAvailability(
        clearState({ record: record({ status }) as unknown as NtsRecord })
      )
      expect(result.printable, status).toBe(true)
      expect(result.blocker, status).toBeNull()
    }
  })

  it('D — a superseded finalized record is printable too', () => {
    // Supersession is not carried by the record and is not a blocker either;
    // the sheet qualifies it.
    expect(resolvePrintAvailability(clearState()).printable).toBe(true)
  })

  it.each([
    ['E', 'dirty', { dirty: true }],
    ['F', 'writing', { writing: true }],
    ['G', 'refreshing', { refreshing: true }],
    ['H/I', 'refresh_failed', { refreshFailed: true }],
    ['J', 'conflict', { conflict: true }],
    ['N', 'opening_historical', { openingHistorical: true }],
    ['', 'loading', { loading: true }]
  ])('%s — %s blocks printing, transiently', (_label, blocker, patch) => {
    const result = resolvePrintAvailability(clearState(patch as Partial<NtsPrintAvailabilityInput>))
    expect(result.printable).toBe(false)
    expect(result.blocker).toBe(blocker)
    // Transient: the affordance stays, so the reason can be read and acted on.
    expect(result.transient).toBe(true)
  })

  it.each([
    ['K', 'no_record', { record: null }],
    ['L', 'catalog_unavailable', { catalog: null }]
  ])('%s — %s removes the affordance entirely', (_label, blocker, patch) => {
    const result = resolvePrintAvailability(clearState(patch as Partial<NtsPrintAvailabilityInput>))
    expect(result.printable).toBe(false)
    expect(result.blocker).toBe(blocker)
    expect(result.transient).toBe(false)
  })

  it('M — a catalog for another norm is refused as a mismatch, not as absence', () => {
    const result = resolvePrintAvailability(clearState({
      record: record({ norm_version: 'norm-B' }) as unknown as NtsRecord
    }))
    expect(result.printable).toBe(false)
    expect(result.blocker).toBe('norm_mismatch')
    expect(result.transient).toBe(false)
  })

  it('O — clearing the blocker restores printability, with nothing else changed', () => {
    const blocked = clearState({ refreshFailed: true })
    expect(resolvePrintAvailability(blocked).printable).toBe(false)
    expect(resolvePrintAvailability({ ...blocked, refreshFailed: false }).printable).toBe(true)
  })

  it('agrees with the 05F.1 coherence gate whenever nothing is in flight', () => {
    // The availability model must reduce to `canRenderPrintRecord` when the
    // shell is idle — otherwise the print root's two conditions could diverge.
    const cases: Array<[NtsRecord | null, unknown]> = [
      [record() as unknown as NtsRecord, REAL_CATALOG],
      [record() as unknown as NtsRecord, null],
      [null, REAL_CATALOG],
      [record({ norm_version: 'norm-B' }) as unknown as NtsRecord, REAL_CATALOG]
    ]
    for (const [rec, cat] of cases) {
      const availability = resolvePrintAvailability(
        clearState({ record: rec, catalog: cat as never })
      )
      expect(availability.printable).toBe(canRenderPrintRecord(rec, cat as never))
    }
  })
})

// ---------------------------------------------------------------------------
// the shell: button, modal, qualification, Ctrl+P
// ---------------------------------------------------------------------------

describe('the print control and the sheet it produces', () => {
  const mounted: Array<{ unmount: () => void }> = []
  let printSpy: ReturnType<typeof vi.fn>

  function route(options: {
    current?: unknown
    draft?: unknown
    history?: unknown[]
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

  function printRoot(): HTMLElement | null {
    return document.querySelector('[data-testid="nts-print-root"]')
  }

  /** The preflight is a teleported modal: it is not inside the wrapper. */
  function modal(testid: string): HTMLElement | null {
    return document.querySelector(`[data-testid="${testid}"]`)
  }

  beforeEach(() => {
    payload.data = {}
    state.get.mockReset()
    state.post.mockReset()
    state.put.mockReset()
    state.patch.mockReset()
    printSpy = vi.fn()
    vi.stubGlobal('print', printSpy)
  })

  afterEach(() => {
    mounted.forEach(w => w.unmount())
    mounted.length = 0
    document.querySelectorAll('[data-testid="nts-print-root"]').forEach(n => n.remove())
    vi.unstubAllGlobals()
  })

  // --- §39 the button ------------------------------------------------------

  it('A — a finalized record offers a plain Print', async () => {
    route({ current: record() })
    const wrapper = await shell()

    const button = wrapper.find('[data-testid="nts-print-action"]')
    expect(button.exists()).toBe(true)
    expect(button.text()).toContain('Print')
    expect(button.attributes('disabled')).toBeUndefined()
    // F — the accessible name is explicit, not inferred from an icon.
    expect(button.attributes('aria-label')).toBe('Print')
  })

  it('B — a draft says so on the button itself', async () => {
    route({ draft: record({ status: 'draft', finalized_at: null }) })
    const wrapper = await shell()

    expect(wrapper.find('[data-testid="nts-print-action"]').text()).toContain('Print draft')
  })

  it('C — a discarded record on screen says so too', async () => {
    const discarded = record({ id: 'rec-old', status: 'discarded', discard_reason: 'Duplicado' })
    route({
      current: record({ id: 'rec-new' }),
      records: { 'rec-old': discarded, 'rec-new': record({ id: 'rec-new' }) },
      history: [
        { ...discarded, is_superseded: false },
        { ...record({ id: 'rec-new' }), is_superseded: false }
      ]
    })
    const wrapper = await shell()

    await wrapper.find('[data-testid="nts-history-open-0"]').trigger('click')
    await new Promise(r => setTimeout(r, 0))
    await nextTick()

    expect(wrapper.find('[data-testid="nts-print-action"]').text())
      .toContain('Print discarded record')
  })

  it('D — unsaved text disables the button and says why, without offering an override', async () => {
    route({ draft: record({ status: 'draft', finalized_at: null }) })
    const wrapper = await shell()

    await wrapper.find('[data-testid="nts-observations-input"]').setValue('sin guardar')
    await nextTick()

    const button = wrapper.find('[data-testid="nts-print-action"]')
    expect(button.attributes('disabled')).toBeDefined()
    expect(button.attributes('data-blocker')).toBe('dirty')

    const reason = wrapper.find('[data-testid="nts-print-blocked-reason"]')
    expect(reason.exists()).toBe(true)
    expect(reason.text()).toContain('Save or discard')
    // There is no "print anyway": the sheet would not contain what was typed.
    expect(wrapper.text()).not.toContain('anyway')
  })

  it('E — no affordance at all when the record\'s norm cannot be served', async () => {
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

    // Structural, not transient: nothing here would make it printable.
    expect(wrapper.find('[data-testid="nts-print-action"]').exists()).toBe(false)
  })

  it('G/H — the control prints the record on screen, historical included', async () => {
    const current = record({ id: 'rec-new' })
    const old = record({ id: 'rec-old', observations: 'histórico' })
    route({
      current,
      records: { 'rec-old': old, 'rec-new': current },
      history: [{ ...old, is_superseded: true }, { ...current, is_superseded: false }]
    })
    const wrapper = await shell()

    // One control, not one per card.
    expect(wrapper.findAll('[data-testid="nts-print-action"]')).toHaveLength(1)

    await wrapper.find('[data-testid="nts-history-open-0"]').trigger('click')
    await new Promise(r => setTimeout(r, 0))
    await nextTick()

    expect(wrapper.findAll('[data-testid="nts-print-action"]')).toHaveLength(1)
    expect(printRoot()!.querySelector('[data-testid="nts-print-record-id"]')!.textContent)
      .toContain('rec-old')
  })

  // --- §40 the preflight ---------------------------------------------------

  it('the preflight states the four settings the browser controls', async () => {
    route({ current: record() })
    const wrapper = await shell()

    expect(printSpy).not.toHaveBeenCalled()
    await wrapper.find('[data-testid="nts-print-action"]').trigger('click')
    await nextTick()

    const settings = modal('nts-print-settings')!
    expect(settings).not.toBeNull()
    expect(settings.textContent).toContain('A4')
    expect(settings.textContent).toContain('portrait')
    expect(settings.textContent).toContain('100%')
    expect(settings.textContent).toContain('colour')

    // The one setting that silently breaks §5.17.
    expect(modal('nts-print-fit-warning')!.textContent).toContain('Fit to page')

    // Opening the preflight is not printing.
    expect(printSpy).not.toHaveBeenCalled()
  })

  it('cancelling the preflight prints nothing', async () => {
    route({ current: record() })
    const wrapper = await shell()

    await wrapper.find('[data-testid="nts-print-action"]').trigger('click')
    await nextTick()
    ;(modal('nts-print-cancel') as HTMLElement).click()
    await nextTick()

    expect(printSpy).not.toHaveBeenCalled()
  })

  it('confirming hands over to the browser exactly once', async () => {
    route({ current: record() })
    const wrapper = await shell()

    await wrapper.find('[data-testid="nts-print-action"]').trigger('click')
    await nextTick()
    ;(modal('nts-print-confirm') as HTMLElement).click()
    await nextTick()
    await nextTick()

    expect(printSpy).toHaveBeenCalledTimes(1)
    // No mutation rides along with a print.
    expect(state.post).not.toHaveBeenCalled()
    expect(state.put).not.toHaveBeenCalled()
    expect(state.patch).not.toHaveBeenCalled()
  })

  it('the preflight counts what the chart cannot carry, and says where it lands', async () => {
    route({
      current: record({
        findings: [
          finding({ id: 'f-ok', rule_id: '6.1.9', targets: [tooth('t-ok', 16)] }),
          finding({ id: 'f-frac', rule_id: '6.1.10', targets: [tooth('t-frac', 46)] }),
          finding({
            id: 'f-giro', rule_id: '6.1.13',
            attributes: { rotation_sense: 'mesial' }, targets: [tooth('t-giro', 23)]
          }),
          finding({
            id: 'f-seal', rule_id: '6.1.35',
            attributes: { condition_state: 'good' }, targets: [tooth('t-seal', 37)]
          })
        ]
      })
    })
    const wrapper = await shell()
    await wrapper.find('[data-testid="nts-print-action"]').trigger('click')
    await nextTick()

    expect(modal('nts-print-unsupported-count')!.textContent).toContain('2')
    expect(modal('nts-print-partial-count')!.textContent).toContain('1')
    // It does not block, and it says the sheet will carry the note.
    expect(modal('nts-print-incomplete-warning')!.textContent).toContain('system note')
    expect(modal('nts-print-confirm')).not.toBeNull()
  })

  it('a record the chart carries in full raises no incompleteness warning', async () => {
    route({
      current: record({
        findings: [finding({ id: 'f-ok', rule_id: '6.1.9', targets: [tooth('t-ok', 16)] })]
      })
    })
    const wrapper = await shell()
    await wrapper.find('[data-testid="nts-print-action"]').trigger('click')
    await nextTick()

    expect(modal('nts-print-incomplete-warning')).toBeNull()
  })

  // --- §41 qualification on the sheet --------------------------------------

  it('a finalized record in force carries no qualification', async () => {
    route({ current: record() })
    await shell()

    expect(printRoot()!.querySelector('[data-testid="nts-print-qualification"]')).toBeNull()
  })

  it('a draft is marked as a draft, before the chart', async () => {
    route({ draft: record({ status: 'draft', finalized_at: null }) })
    await shell()

    const root = printRoot()!
    const qualification = root.querySelector('[data-testid="nts-print-qualification"]')!
    expect(qualification).not.toBeNull()
    expect(qualification.getAttribute('data-status')).toBe('draft')
    expect(qualification.textContent).toContain('DRAFT')
    expect(qualification.textContent).toContain('not the definitive record')

    // Before the chart, so it cannot be read after the fact.
    const html = root.innerHTML
    expect(html.indexOf('nts-print-qualification'))
      .toBeLessThan(html.indexOf('nts-odontogram-chart'))
  })

  it('a draft with carried-forward findings says how many are unreviewed', async () => {
    route({
      draft: record({
        status: 'draft',
        finalized_at: null,
        findings: [
          finding({ id: 'f1', rule_id: '6.1.9', provenance: 'carried_forward', targets: [tooth('t1', 16)] }),
          finding({ id: 'f2', rule_id: '6.1.9', provenance: 'carried_forward', targets: [tooth('t2', 26)] }),
          finding({ id: 'f3', rule_id: '6.1.9', targets: [tooth('t3', 36)] })
        ]
      })
    })
    await shell()

    const carried = printRoot()!
      .querySelector('[data-testid="nts-print-qualification-carried-forward"]')!
    expect(carried).not.toBeNull()
    // Two of the three, and nothing was confirmed to get that number.
    expect(carried.textContent).toContain('2')
    expect(state.post).not.toHaveBeenCalled()
  })

  it('a discarded record is marked, with its reason', async () => {
    const discarded = record({ id: 'rec-old', status: 'discarded', discard_reason: 'Duplicado del 12/01' })
    const current = record({ id: 'rec-new' })
    route({
      current,
      records: { 'rec-old': discarded, 'rec-new': current },
      history: [{ ...discarded, is_superseded: false }, { ...current, is_superseded: false }]
    })
    const wrapper = await shell()

    await wrapper.find('[data-testid="nts-history-open-0"]').trigger('click')
    await new Promise(r => setTimeout(r, 0))
    await nextTick()

    const root = printRoot()!
    expect(root.querySelector('[data-testid="nts-print-qualification-discarded"]')!.textContent)
      .toContain('DISCARDED')
    expect(root.querySelector('[data-testid="nts-print-qualification-discard-reason"]')!.textContent)
      .toContain('Duplicado del 12/01')
    // The content it holds is still there: discarding does not redact it.
    expect(root.querySelector('[data-testid="nts-odontogram-chart"]')).not.toBeNull()
  })

  it('a superseded finalized record says a later one exists, and nothing harsher', async () => {
    const old = record({ id: 'rec-old' })
    const current = record({ id: 'rec-new' })
    route({
      current,
      records: { 'rec-old': old, 'rec-new': current },
      history: [{ ...old, is_superseded: true }, { ...current, is_superseded: false }]
    })
    const wrapper = await shell()

    await wrapper.find('[data-testid="nts-history-open-0"]').trigger('click')
    await new Promise(r => setTimeout(r, 0))
    await nextTick()

    const root = printRoot()!
    const superseded = root.querySelector('[data-testid="nts-print-qualification-superseded"]')!
    expect(superseded.textContent).toContain('SUPERSEDED')
    expect(superseded.textContent).toContain('later record exists')

    // §36 — no claim DenPlant has no standing to make.
    const text = root.textContent!.toLowerCase()
    for (const overclaim of ['invalid', 'annulled', 'void', 'certified', 'legally']) {
      expect(text, overclaim).not.toContain(overclaim)
    }
  })

  it('qualification survives a printer with background graphics turned off', async () => {
    // Border and weight, never a fill: a background is the one thing a print
    // dialog can switch off.
    route({ draft: record({ status: 'draft', finalized_at: null }) })
    await shell()

    const qualification = printRoot()!
      .querySelector('[data-testid="nts-print-qualification"]')!
    expect(qualification.className).toContain('border')
    expect(qualification.className).not.toContain('bg-')
    // And the words are real text, not a CSS pseudo-element.
    expect(qualification.textContent!.trim().length).toBeGreaterThan(0)
  })

  // --- §42 Ctrl+P cannot outflank the button -------------------------------

  it('CRITICAL — the button and the print root take the same decision', async () => {
    route({ draft: record({ status: 'draft', finalized_at: null }) })
    const wrapper = await shell()

    // Clean: both allow.
    expect(wrapper.find('[data-testid="nts-print-action"]').attributes('disabled'))
      .toBeUndefined()
    expect(printRoot()!.querySelector('[data-testid="nts-odontogram-chart"]')).not.toBeNull()
    expect(printRoot()!.querySelector('[data-testid="nts-print-unsafe"]')).toBeNull()

    // Dirty: both refuse, and the root refuses by withdrawing the document —
    // which is what Ctrl+P would otherwise have printed.
    await wrapper.find('[data-testid="nts-observations-input"]').setValue('sin guardar')
    await nextTick()

    expect(wrapper.find('[data-testid="nts-print-action"]').attributes('disabled'))
      .toBeDefined()
    const unsafe = printRoot()!.querySelector('[data-testid="nts-print-unsafe"]')!
    expect(unsafe).not.toBeNull()
    expect(unsafe.getAttribute('data-blocker')).toBe('dirty')
    expect(printRoot()!.querySelector('[data-testid="nts-odontogram-chart"]')).toBeNull()
  })

  it('a write in flight withdraws the document from Ctrl+P too', async () => {
    route({ draft: record({ status: 'draft', finalized_at: null }) })
    const wrapper = await shell()

    state.patch.mockImplementation(() => new Promise(() => {}))
    await wrapper.find('[data-testid="nts-observations-input"]').setValue('guardado')
    await wrapper.find('[data-testid="nts-observations-save"]').trigger('click')
    await nextTick()

    const root = printRoot()!
    expect(root.querySelector('[data-testid="nts-print-unsafe"]')!.getAttribute('data-blocker'))
      .toBe('writing')
    expect(root.querySelector('[data-testid="nts-odontogram-chart"]')).toBeNull()
  })

  it('§32 — a landed write whose refetch failed blocks printing until re-read', async () => {
    route({ draft: record({ status: 'draft', finalized_at: null, version: 7 }) })
    const wrapper = await shell()

    // The save lands; the re-read does not.
    state.patch.mockResolvedValue({ data: record({ status: 'draft', version: 8 }) })
    state.get.mockRejectedValue({ statusCode: 500, data: { message: 'boom' } })
    await wrapper.find('[data-testid="nts-observations-input"]').setValue('guardado')
    await wrapper.find('[data-testid="nts-observations-save"]').trigger('click')
    await new Promise(r => setTimeout(r, 0))
    await nextTick()

    expect(wrapper.find('[data-testid="nts-text-refresh-failed"]').exists()).toBe(true)
    const root = printRoot()!
    expect(root.querySelector('[data-testid="nts-print-unsafe"]')!.getAttribute('data-blocker'))
      .toBe('refresh_failed')
    expect(wrapper.find('[data-testid="nts-print-action"]').attributes('data-blocker'))
      .toBe('refresh_failed')

    // The retry is a GET. Nothing is re-sent.
    const mutationsBefore = state.patch.mock.calls.length
    route({ draft: record({ status: 'draft', finalized_at: null, version: 8 }) })
    await wrapper.find('[data-testid="nts-text-refresh-retry"]').trigger('click')
    await new Promise(r => setTimeout(r, 0))
    await nextTick()

    expect(state.patch.mock.calls.length).toBe(mutationsBefore)
    expect(printRoot()!.querySelector('[data-testid="nts-print-unsafe"]')).toBeNull()
    expect(wrapper.find('[data-testid="nts-print-action"]').attributes('disabled'))
      .toBeUndefined()
  })

  it('§33 — cancelling the local edit restores printing without saving anything', async () => {
    route({ draft: record({ status: 'draft', finalized_at: null }) })
    const wrapper = await shell()

    await wrapper.find('[data-testid="nts-observations-input"]').setValue('sin guardar')
    await nextTick()
    expect(wrapper.find('[data-testid="nts-print-action"]').attributes('disabled')).toBeDefined()

    await wrapper.find('[data-testid="nts-observations-cancel"]').trigger('click')
    await nextTick()

    expect(wrapper.find('[data-testid="nts-print-action"]').attributes('disabled')).toBeUndefined()
    expect(printRoot()!.querySelector('[data-testid="nts-odontogram-chart"]')).not.toBeNull()
    // Discarding a local edit is not a mutation.
    expect(state.patch).not.toHaveBeenCalled()
  })

  // --- §43 the unsupported record, end to end ------------------------------

  it('§43 — a mixed record prints, warns, and declares, with no mutation', async () => {
    route({
      current: record({
        findings: [
          finding({ id: 'f-ok', rule_id: '6.1.9', targets: [tooth('t-ok', 16)] }),
          finding({ id: 'f-frac', rule_id: '6.1.10', targets: [tooth('t-frac', 46)] }),
          finding({
            id: 'f-giro', rule_id: '6.1.13',
            attributes: { rotation_sense: 'mesial' }, targets: [tooth('t-giro', 23)]
          }),
          finding({
            id: 'f-seal', rule_id: '6.1.35',
            attributes: { condition_state: 'good' }, targets: [tooth('t-seal', 37)]
          })
        ]
      })
    })
    const wrapper = await shell()

    // The screen survives all four.
    for (const id of ['f-ok', 'f-frac', 'f-giro', 'f-seal']) {
      expect(wrapper.find(`[data-testid="nts-finding-${id}"]`).exists(), id).toBe(true)
    }

    // Printing is offered: incompleteness is a warning, not a refusal.
    expect(wrapper.find('[data-testid="nts-print-action"]').attributes('disabled'))
      .toBeUndefined()

    const root = printRoot()!
    expect(root.textContent).toContain('FFP')
    expect(root.querySelector('[data-testid="nts-print-declaration-f-frac"]')!
      .getAttribute('data-completeness')).toBe('unsupported')
    expect(root.querySelector('[data-testid="nts-print-declaration-f-giro"]')!
      .getAttribute('data-completeness')).toBe('unsupported')
    expect(root.querySelector('[data-testid="nts-print-declaration-f-seal"]')!
      .getAttribute('data-completeness')).toBe('partial')

    expect(state.post).not.toHaveBeenCalled()
    expect(state.put).not.toHaveBeenCalled()
    expect(state.patch).not.toHaveBeenCalled()
  })

  // --- NTS-05F.4a — identity on every printed page ------------------------
  //
  // A second page separated from the first was otherwise an anonymous sheet
  // of clinical text. The strip lives in a `<thead>` because that is the only
  // construct this Chromium repeats on every page: `position: fixed` was
  // measured dropping off the last page of a five-page document, and `@page`
  // margin boxes would carry a patient's name through a CSS `content:`
  // string, where an apostrophe becomes an escaping bug in the data that has
  // to be right. Page-level PDF evidence lives in the 05F.4a QA run; these
  // assert the DOM the browser repeats.

  it('A — the repeated identity is built from data the sheet already has', async () => {
    payload.data['patient:p1'] = {
      first_name: 'Rosa',
      last_name: 'Mamani',
      national_id: '87654321',
      national_id_type: 'dni'
    }
    route({ current: record() })
    await shell()

    const root = printRoot()!
    const strip = root.querySelector('[data-testid="nts-print-continuation"]')!
    expect(strip).not.toBeNull()
    expect(strip.textContent).toContain('Rosa Mamani')
    expect(strip.textContent).toContain('87654321')
    expect(strip.textContent).toContain('rec-1')
    expect(strip.textContent).toContain('pe_nts_188_2022')

    // It sits in the table head, which is what makes it repeat.
    expect(strip.closest('thead')).not.toBeNull()
    expect(root.querySelector('[data-testid="nts-print-sheet"]')).not.toBeNull()
  })

  it('B/C — it costs no request and no mutation', async () => {
    payload.data['patient:p1'] = { first_name: 'Rosa', last_name: 'Mamani' }
    route({ current: record() })
    await shell()

    expect(printRoot()!.querySelector('[data-testid="nts-print-continuation-patient"]')!.textContent)
      .toContain('Rosa Mamani')
    // The identity comes from the page cache and the record already in hand.
    const urls = state.get.mock.calls.map(call => String(call[0]))
    expect(urls.every(url => url.startsWith('/api/v1/odontogram'))).toBe(true)
    expect(state.post).not.toHaveBeenCalled()
    expect(state.put).not.toHaveBeenCalled()
    expect(state.patch).not.toHaveBeenCalled()
  })

  it('D — a historical record repeats its own id and its own norm', async () => {
    const current = record({ id: 'rec-new' })
    const old = record({ id: 'rec-old', norm_version: 'norm-B' })
    route({
      current,
      records: { 'rec-old': old, 'rec-new': current },
      history: [{ ...old, is_superseded: false }, { ...current, is_superseded: false }],
      catalogs: {
        'pe_nts_188_2022': REAL_CATALOG,
        'norm-B': { ...REAL_CATALOG, norm_version: 'norm-B' }
      }
    })
    const wrapper = await shell()

    await wrapper.find('[data-testid="nts-history-open-0"]').trigger('click')
    await new Promise(r => setTimeout(r, 0))
    await nextTick()

    const strip = printRoot()!.querySelector('[data-testid="nts-print-continuation"]')!
    expect(strip.textContent).toContain('rec-old')
    expect(strip.textContent).toContain('norm-B')
    // Never the active profile's norm.
    expect(strip.textContent).not.toContain('pe_nts_188_2022')
  })

  it('E — a blocked sheet repeats no clinical identity at all', async () => {
    // The strip must not make an unprintable state look like a document.
    route({ draft: record({ status: 'draft', finalized_at: null }) })
    const wrapper = await shell()

    await wrapper.find('[data-testid="nts-observations-input"]').setValue('sin guardar')
    await nextTick()

    const root = printRoot()!
    expect(root.querySelector('[data-testid="nts-print-unsafe"]')).not.toBeNull()
    expect(root.querySelector('[data-testid="nts-print-continuation"]')).toBeNull()
    expect(root.querySelector('[data-testid="nts-print-sheet"]')).toBeNull()
  })

  it('E — nor does a record whose norm cannot be served', async () => {
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
    expect(root.querySelector('[data-testid="nts-print-continuation"]')).toBeNull()
  })

  it('F — the repeated identity never appears on screen', async () => {
    payload.data['patient:p1'] = { first_name: 'Rosa', last_name: 'Mamani' }
    route({ current: record() })
    const wrapper = await shell()

    expect(wrapper.find('[data-testid="nts-print-continuation"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="nts-print-sheet"]').exists()).toBe(false)
    // And the screen still has exactly one chart of its own.
    expect(wrapper.findAll('[data-testid="nts-odontogram-chart"]')).toHaveLength(1)
  })

  it('J/K/L — a qualified record repeats identity and qualifies only once', async () => {
    route({ draft: record({ status: 'draft', finalized_at: null }) })
    await shell()

    const root = printRoot()!
    expect(root.querySelector('[data-testid="nts-print-continuation"]')).not.toBeNull()
    // The qualification banner is page-one content, not part of the repeat.
    expect(root.querySelectorAll('[data-testid="nts-print-qualification"]')).toHaveLength(1)
    expect(root.querySelector('[data-testid="nts-print-continuation"]')!.closest('thead'))
      .not.toBeNull()
    expect(root.querySelector('[data-testid="nts-print-qualification"]')!.closest('thead'))
      .toBeNull()
  })

  it('Q — wrapping the sheet in a table did not disturb the chart', async () => {
    route({ current: record() })
    const wrapper = await shell()

    // Rows carry `data-dentition`, overlay text carries `data-fdi`; only a
    // tooth cell carries both.
    const toothCell = '[data-fdi][data-dentition]'
    const printChart = printRoot()!.querySelector('[data-testid="nts-odontogram-chart"]')
    expect(printChart).not.toBeNull()
    expect(printChart!.querySelectorAll(toothCell)).toHaveLength(52)
    expect(wrapper.find('[data-testid="nts-odontogram-chart"]').findAll(toothCell))
      .toHaveLength(52)
  })

  it('§27 — printing never touches document.title', async () => {
    const before = document.title
    route({ current: record() })
    const wrapper = await shell()

    await wrapper.find('[data-testid="nts-print-action"]').trigger('click')
    await nextTick()
    ;(modal('nts-print-confirm') as HTMLElement).click()
    await nextTick()

    // No PHI in a filename the browser derives from the title, because the
    // title is not ours to set.
    expect(document.title).toBe(before)
  })
})
