/**
 * NTS-05F.1 — the odontogram as a printed document.
 *
 * The print view is deliberately a function of its props: give it a record
 * and the catalog of that record's norm and it renders one document. That is
 * what makes these assertions about data and DOM rather than about pixels,
 * and it is why no print stylesheet is involved — 05F.1 adds none.
 *
 * Module-layer files are imported by relative path: `frontend/module_layers`
 * does not resolve on this Windows host, so the layer's auto-imports are
 * unavailable in the test environment.
 */

import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { defineComponent, h, nextTick } from 'vue'

import NtsOdontogramPrintView from '../../../backend/app/modules/odontogram/frontend/components/odontogram/NtsOdontogramPrintView.vue'
import { useNtsPrintIdentity } from '../../../backend/app/modules/odontogram/frontend/composables/useNtsPrintIdentity'
import {
  canRenderPrintRecord,
  formatPrintDate,
  printDateSource,
  printDeclarations,
  toPrintFooter,
  toPrintPatient,
  toPrintProfessional,
  toPrintStatus
} from '../../../backend/app/modules/odontogram/frontend/utils/ntsPrintModel'
import type {
  NtsFinding,
  NtsRecord,
  NtsSpecification
} from '../../../backend/app/modules/odontogram/frontend/types/nts'

/**
 * The real 38 rules. The declaration tests are only meaningful against the
 * catalog the product ships: what this build can and cannot draw is the
 * renderer's answer, not a fixture's.
 */
const REAL_CATALOG = JSON.parse(
  readFileSync(
    resolve(process.cwd(), '../backend/app/modules/odontogram/nts/catalog/pe_nts_188_2022.json'),
    'utf8'
  )
)

/**
 * The API client, doubled purely so the suite can prove it is never touched.
 *
 * The print view imports no composable that would use it; this turns that
 * design property into a failing test if it ever stops being true.
 */
const api = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  put: vi.fn(),
  patch: vi.fn(),
  delete: vi.fn()
}))
mockNuxtImport('useApi', () => () => api)

/** The payload cache the patient page fills. Empty unless a test fills it. */
const payload = vi.hoisted(() => ({ data: {} as Record<string, unknown> }))
mockNuxtImport('useNuxtData', () => (key: string) => ({
  data: { get value() { return payload.data[key] ?? null } }
}))

// ---------------------------------------------------------------------------
// fixtures
// ---------------------------------------------------------------------------

function tooth(id: string, fdi: number) {
  return {
    id,
    group_index: 0,
    position: 0,
    participation: 'subject' as const,
    role: null,
    target_kind: 'fdi_tooth' as const,
    tooth_number: fdi,
    arch: null,
    local_ordinal: null,
    geometry: null
  }
}

function finding(overrides: Partial<NtsFinding> & { id: string, rule_id: string }): NtsFinding {
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
  } as NtsFinding
}

function spec(id: string, sequence: number, text: string): NtsSpecification {
  return { id, record_id: 'rec-1', finding_id: null, text, sequence }
}

function record(overrides: Partial<NtsRecord> = {}): NtsRecord {
  return {
    id: 'rec-1',
    clinic_id: 'clinic-a',
    patient_id: 'p1',
    norm_version: 'pe_nts_188_2022',
    stage: 'diagnosis',
    stage_label: null,
    status: 'finalized',
    version: 3,
    observations: null,
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

const mounted: Array<{ unmount: () => void }> = []
afterEach(() => {
  mounted.forEach(w => w.unmount())
  mounted.length = 0
  payload.data = {}
  Object.values(api).forEach(fn => fn.mockReset())
})

async function printView(props: Record<string, unknown>) {
  const wrapper = await mountSuspended(NtsOdontogramPrintView, {
    props: { catalog: REAL_CATALOG, ...props }
  })
  mounted.push(wrapper)
  await nextTick()
  return wrapper
}

async function runInSetup<T>(fn: () => T): Promise<T> {
  let captured!: T
  const wrapper = await mountSuspended(defineComponent({
    setup() {
      captured = fn()
      return () => h('div')
    }
  }))
  mounted.push(wrapper)
  return captured
}

// ---------------------------------------------------------------------------

describe('NtsOdontogramPrintView — the document', () => {
  // --- A/B/C/D: the four kinds of record it may be asked to print ----------

  it('A — a finalized record prints as the document, with its own date', async () => {
    const wrapper = await printView({ record: record() })

    expect(wrapper.find('[data-testid="nts-print-document"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="nts-print-unavailable"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="nts-print-status"]').text()).toContain('Finalized')
  })

  it('B — a draft prints, dated when it was opened', async () => {
    // It has never been finalized, so the only date it has is its own.
    const draft = record({ status: 'draft', finalized_at: null, content_hash: null, hash_algorithm: null })
    const wrapper = await printView({ record: draft })

    expect(wrapper.find('[data-testid="nts-print-document"]').exists()).toBe(true)
    expect(printDateSource(draft)).toBe(draft.recorded_at)
  })

  it('C — a discarded record keeps the date it earned', async () => {
    // Discarding does not retroactively unmake a finalization.
    const discarded = record({ status: 'discarded', discarded_at: '2026-02-01T09:00:00Z' })
    const wrapper = await printView({ record: discarded })

    expect(printDateSource(discarded)).toBe(discarded.finalized_at)
    expect(wrapper.find('[data-testid="nts-print-status"]').text()).toContain('Discarded')
  })

  it('D — a historical record is printed from whatever it was handed', async () => {
    // The view resolves no state of its own: the caller pairs the record with
    // the catalog of the record's norm, and that pair is the whole document.
    const historical = record({ id: 'rec-old', version: 9 })
    const wrapper = await printView({ record: historical, isSuperseded: true })

    expect(wrapper.find('[data-testid="nts-print-record-id"]').text()).toBe('rec-old')
    expect(wrapper.find('[data-testid="nts-print-status"]').text()).toContain('Corrected')
  })

  // --- E/F: patient identity ----------------------------------------------

  it('E — the header carries the patient name and document', async () => {
    const wrapper = await printView({
      record: record(),
      patient: { fullName: 'Rosa Mamani', documentType: 'dni', documentNumber: '87654321' }
    })

    expect(wrapper.find('[data-testid="nts-print-patient-name"]').text()).toBe('Rosa Mamani')
    expect(wrapper.find('[data-testid="nts-print-patient-document"]').text())
      .toContain('87654321')
  })

  it('F — no patient in the cache: the rows are omitted, not faked', async () => {
    // A rendered "Documento: —" would tell the reader this patient has no
    // document on file. The truth is only that this page did not have it.
    const wrapper = await printView({ record: record(), patient: null })

    expect(wrapper.find('[data-testid="nts-print-document"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="nts-print-patient-name"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="nts-print-patient-document"]').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('—')
  })

  it('F — the identity comes from the page cache, and never from a request', async () => {
    payload.data['patient:p1'] = {
      first_name: 'Rosa',
      last_name: 'Mamani',
      national_id: '87654321',
      national_id_type: 'dni'
    }
    const { identity } = await runInSetup(() => useNtsPrintIdentity(() => 'p1'))

    expect(identity.value).toEqual({
      fullName: 'Rosa Mamani',
      documentType: 'dni',
      documentNumber: '87654321'
    })
    // Not one call: the patient page already fetched this.
    expect(api.get).not.toHaveBeenCalled()
  })

  it('F — an empty cache yields no identity and still no request', async () => {
    const { identity } = await runInSetup(() => useNtsPrintIdentity(() => 'p-unknown'))

    expect(identity.value).toBeNull()
    expect(api.get).not.toHaveBeenCalled()
  })

  it('F — a patient with a name but no document prints only the name', async () => {
    expect(toPrintPatient({ first_name: 'Rosa', last_name: 'Mamani' })).toEqual({
      fullName: 'Rosa Mamani',
      documentType: null,
      documentNumber: null
    })
    // A document type with no number describes nothing and goes with it.
    expect(toPrintPatient({ national_id_type: 'dni' })).toBeNull()
  })

  // --- G: the date ---------------------------------------------------------

  it('G — the printed date is the same instant the screen shows', async () => {
    // NTS timestamps are serialized in UTC; rendering them in the reader's
    // zone is what the shell already does. Pinned here so a well-meant switch
    // to a wall-clock helper fails instead of silently shifting an hour.
    const iso = '2026-01-03T15:30:00Z'
    const expected = new Date(iso).toLocaleString('en', {
      dateStyle: 'medium',
      timeStyle: 'short'
    })

    expect(formatPrintDate(iso, 'en')).toBe(expected)

    const wrapper = await printView({ record: record({ finalized_at: iso }) })
    expect(wrapper.find('[data-testid="nts-print-date"]').text()).toBe(expected)
  })

  it('G — no date at all is rendered as no row', async () => {
    expect(formatPrintDate(null, 'en')).toBeNull()
  })

  // --- H/I: the professional ----------------------------------------------

  it('H — the professional is the one who recorded the finding', async () => {
    const wrapper = await printView({ record: record() })

    expect(wrapper.find('[data-testid="nts-print-professional-name"]').text()).toBe('Ana Quispe')
    expect(wrapper.find('[data-testid="nts-print-professional-role"]').text()).toBe('dentist')
    expect(wrapper.find('[data-testid="nts-print-professional-id"]').text()).toBe('COP-12345')
  })

  it('I — whoever pressed finalize is never printed as the professional', async () => {
    // The service snapshots `recorded_by`, "even when somebody else presses
    // finalize". Printing the finaliser would attribute the clinical content
    // to a person who did not record it.
    const wrapper = await printView({
      record: record({ finalized_by: 'u-supervisor' })
    })

    expect(wrapper.text()).not.toContain('u-supervisor')
    expect(toPrintProfessional(record())?.name).toBe('Ana Quispe')
  })

  it('I — a record that names nobody prints no professional block', async () => {
    const anonymous = record({
      recorded_by_name: null,
      recorded_by_role: null,
      recorded_by_professional_id: null
    })
    const wrapper = await printView({ record: anonymous })

    expect(wrapper.find('[data-testid="nts-print-professional"]').exists()).toBe(false)
  })

  it('I — there is no signature line: §5.3 puts firma y sello on the Ficha', async () => {
    const wrapper = await printView({ record: record() })
    const text = wrapper.text().toLowerCase()

    expect(text).not.toContain('firma')
    expect(text).not.toContain('sello')
    expect(text).not.toContain('signature')
  })

  // --- J/K: the chart ------------------------------------------------------

  it('J — the document contains the real chart, all 52 teeth', async () => {
    const wrapper = await printView({ record: record() })

    expect(wrapper.find('[data-testid="nts-odontogram-chart"]').exists()).toBe(true)
    expect(wrapper.findAll('[data-fdi]')).toHaveLength(52)
  })

  it('J — the editing advisories do not follow the chart onto paper', async () => {
    // A printed sheet cannot act on advice addressed to an editor.
    const wrapper = await printView({
      record: record({ findings: [finding({ id: 'f1', rule_id: '6.1.10' })] })
    })

    expect(wrapper.find('[data-testid="nts-chart-findings-pending"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="nts-chart-siglas-hidden"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="nts-chart-readonly"]').exists()).toBe(false)
  })

  it('K — a box that cannot show every sigla still says so on paper', async () => {
    // The +n is part of the drawing, not advice: hiding it would make the
    // sheet claim the tooth carries only the siglas that fit.
    const crowded = [1, 2, 3, 4].map(n =>
      finding({ id: `f${n}`, rule_id: '6.1.9', sequence: n, targets: [tooth(`t${n}`, 16)] })
    )
    const wrapper = await printView({ record: record({ findings: crowded }) })

    expect(wrapper.find('[data-testid="nts-box-overflow-16"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="nts-box-overflow-16"]').text()).toContain('+')
  })

  // --- L/M/N: specifications ----------------------------------------------

  it('L — specifications print in their recorded sequence', async () => {
    const wrapper = await printView({
      record: record({
        specifications: [spec('s2', 2, 'segunda'), spec('s1', 1, 'primera')]
      })
    })

    const items = wrapper.findAll('[data-testid^="nts-print-spec-item-"]').map(el => el.text())
    expect(items).toEqual(['primera', 'segunda'])
  })

  it('M — a specification keeps its text verbatim, line breaks included', async () => {
    const wrapper = await printView({
      record: record({ specifications: [spec('s1', 1, 'línea uno\nlínea dos')] })
    })

    expect(wrapper.find('[data-testid="nts-print-spec-item-0"]').text())
      .toContain('línea dos')
  })

  it('N — an empty specifications block is printed, not omitted', async () => {
    // A missing block cannot be told apart from one nobody filled in.
    const wrapper = await printView({ record: record({ specifications: [] }) })

    expect(wrapper.find('[data-testid="nts-print-specifications"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="nts-print-spec-empty"]').exists()).toBe(true)
  })

  // --- O/P/Q: observations -------------------------------------------------

  it('O — observations print exactly as persisted', async () => {
    const text = 'Paciente refiere sensibilidad.\nSegunda línea.'
    const wrapper = await printView({ record: record({ observations: text }) })

    expect(wrapper.find('[data-testid="nts-print-observations-text"]').text()).toBe(text)
  })

  it('P — an empty observations block is printed, not omitted', async () => {
    const wrapper = await printView({ record: record({ observations: null }) })

    expect(wrapper.find('[data-testid="nts-print-observations"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="nts-print-observations-empty"]').exists()).toBe(true)
  })

  it('Q — text typed and never saved does not reach the page', async () => {
    // The clinician has not recorded it. A document that printed it would be
    // claiming they had.
    const persisted = 'guardado'
    const wrapper = await printView({ record: record({ observations: persisted }) })

    expect(wrapper.find('[data-testid="nts-print-observations-text"]').text()).toBe(persisted)
    expect(wrapper.text()).not.toContain('sin guardar')
    // And there is nowhere for a buffer to come from.
    expect(wrapper.findAll('textarea')).toHaveLength(0)
  })

  // --- R/S/T/U: incompletely drawn findings --------------------------------

  it('R — a partially drawn finding is declared, with its clinical name', async () => {
    const sealant = finding({
      id: 'f-seal',
      rule_id: '6.1.35',
      attributes: { condition_state: 'good' },
      targets: [tooth('t-seal', 16)]
    })
    const declarations = printDeclarations(record({ findings: [sealant] }), REAL_CATALOG)

    expect(declarations).toHaveLength(1)
    expect(declarations[0]!.completeness).toBe('partial')
    expect(declarations[0]!.label).toBe('Sellantes')

    const wrapper = await printView({ record: record({ findings: [sealant] }) })
    const entry = wrapper.find('[data-testid="nts-print-declaration-f-seal"]')
    expect(entry.attributes('data-completeness')).toBe('partial')
    expect(entry.text()).toContain('Sellantes')
    expect(entry.text()).toContain('16')
    // The sigla code is not the sentence: the clinical name says more.
    expect(entry.text()).not.toContain('6.1.35')
  })

  it('S — a finding that cannot be drawn at all is declared as recorded', async () => {
    const fracture = finding({ id: 'f-frac', rule_id: '6.1.10', targets: [tooth('t-frac', 36)] })
    const wrapper = await printView({ record: record({ findings: [fracture] }) })

    const entry = wrapper.find('[data-testid="nts-print-declaration-f-frac"]')
    expect(entry.attributes('data-completeness')).toBe('unsupported')
    expect(entry.text()).toContain('Fractura dental')
    expect(entry.text()).toContain('36')
    // The tooth must never read as a tooth with nothing found.
    expect(entry.text()).toContain('recorded')
  })

  it('S — the note declares itself as DenPlant, not as the norm', async () => {
    const wrapper = await printView({
      record: record({ findings: [finding({ id: 'f1', rule_id: '6.1.10' })] })
    })

    expect(wrapper.find('[data-testid="nts-print-declarations"]').text())
      .toContain('Not part of the normative chart')
  })

  it('T — nothing is declared when the drawing carries everything', async () => {
    const drawable = finding({ id: 'f1', rule_id: '6.1.9', targets: [tooth('t1', 16)] })
    const wrapper = await printView({ record: record({ findings: [drawable] }) })

    expect(printDeclarations(record({ findings: [drawable] }), REAL_CATALOG)).toEqual([])
    expect(wrapper.find('[data-testid="nts-print-declarations"]').exists()).toBe(false)
  })

  it('T — declarations follow the record sequence, not the renderer order', async () => {
    const findings = [
      finding({ id: 'f-b', rule_id: '6.1.10', sequence: 2, targets: [tooth('tb', 11)] }),
      finding({ id: 'f-a', rule_id: '6.1.10', sequence: 1, targets: [tooth('ta', 21)] })
    ]
    const declarations = printDeclarations(record({ findings }), REAL_CATALOG)

    expect(declarations.map(d => d.findingId)).toEqual(['f-a', 'f-b'])
  })

  it('U — declaring a gap writes nothing, anywhere', async () => {
    // It is a statement about the record. The moment it could append to
    // `observations` it would author clinical text and move the content hash.
    const gaps = record({
      findings: [
        finding({ id: 'f1', rule_id: '6.1.10' }),
        finding({ id: 'f2', rule_id: '6.1.13', attributes: { rotation_sense: 'mesial' } })
      ],
      observations: null,
      specifications: []
    })
    const wrapper = await printView({ record: gaps })

    expect(wrapper.findAll('[data-testid^="nts-print-declaration-"]').length).toBeGreaterThan(0)
    expect(api.post).not.toHaveBeenCalled()
    expect(api.put).not.toHaveBeenCalled()
    expect(api.patch).not.toHaveBeenCalled()
    expect(api.delete).not.toHaveBeenCalled()
    // The record itself is untouched.
    expect(gaps.observations).toBeNull()
    expect(gaps.specifications).toEqual([])
    expect(wrapper.find('[data-testid="nts-print-observations-empty"]').exists()).toBe(true)
  })

  it('U — the note sits after Observaciones, outside the annex blocks', async () => {
    // So that no DenPlant content is inserted between the three blocks the
    // annex orders: chart → Especificaciones → Observaciones.
    const wrapper = await printView({
      record: record({ findings: [finding({ id: 'f1', rule_id: '6.1.10' })] })
    })
    const html = wrapper.html()
    const at = (testid: string) => html.indexOf(`data-testid="${testid}"`)

    expect(at('nts-odontogram-chart')).toBeLessThan(at('nts-print-specifications'))
    expect(at('nts-print-specifications')).toBeLessThan(at('nts-print-observations'))
    expect(at('nts-print-observations')).toBeLessThan(at('nts-print-declarations'))
  })

  // --- V/W: the fingerprint ------------------------------------------------

  it('V — the content hash is printed whole', async () => {
    // Half a digest attests nothing, so it is never shortened to fit.
    const digest = 'b'.repeat(64)
    const wrapper = await printView({
      record: record({ content_hash: digest, hash_algorithm: 'sha256' })
    })

    const node = wrapper.find('[data-testid="nts-print-content-hash"]')
    expect(node.text()).toContain(digest)
    expect(node.text()).not.toContain('…')
    expect(node.classes()).toContain('break-all')
    expect(node.classes()).not.toContain('truncate')
  })

  it('W — no hash is invented for a record that has none', async () => {
    const draft = record({ status: 'draft', content_hash: null, hash_algorithm: null })
    const wrapper = await printView({ record: draft })

    expect(wrapper.find('[data-testid="nts-print-content-hash"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="nts-print-content-hash-unavailable"]').exists()).toBe(true)
    expect(toPrintFooter(draft)?.contentHash).toBeNull()
  })

  it('W — a digest with no algorithm is not offered as a fingerprint', async () => {
    expect(toPrintFooter(record({ hash_algorithm: null }))?.contentHash).toBeNull()
  })

  it('W — the footer never claims a signature or legal validity', async () => {
    const wrapper = await printView({ record: record() })
    const text = wrapper.text().toLowerCase()

    expect(text).toContain('content fingerprint')
    expect(text).not.toContain('digital signature')
    expect(text).not.toContain('certified')
    expect(text).not.toContain('legally')
  })

  // --- X: it is a document, not a surface ----------------------------------

  it('X — the document holds no control of any kind', async () => {
    const wrapper = await printView({
      record: record({
        observations: 'texto',
        specifications: [spec('s1', 1, 'una')],
        findings: [finding({ id: 'f1', rule_id: '6.1.10' })]
      }),
      patient: { fullName: 'Rosa Mamani', documentType: 'dni', documentNumber: '1' }
    })

    expect(wrapper.findAll('button')).toHaveLength(0)
    expect(wrapper.findAll('input')).toHaveLength(0)
    expect(wrapper.findAll('textarea')).toHaveLength(0)
    expect(wrapper.findAll('select')).toHaveLength(0)
    expect(wrapper.findAll('form')).toHaveLength(0)
  })

  it('X — the outline is headings, not styled text', async () => {
    const wrapper = await printView({
      record: record({ findings: [finding({ id: 'f1', rule_id: '6.1.10' })] })
    })

    expect(wrapper.findAll('h1')).toHaveLength(1)
    const headings = wrapper.findAll('h2').map(h => h.text())
    expect(headings).toContain('Specifications')
    expect(headings).toContain('Observations')
    expect(headings).toContain('Findings not fully represented')
  })

  it('X — no clinical text is hidden from a screen reader', async () => {
    const wrapper = await printView({
      record: record({ observations: 'texto clínico', specifications: [spec('s1', 1, 'una')] })
    })

    expect(wrapper.find('[data-testid="nts-print-observations-text"]').attributes('aria-hidden'))
      .toBeUndefined()
    expect(wrapper.find('[data-testid="nts-print-spec-item-0"]').attributes('aria-hidden'))
      .toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// §28 — the norm on the page is the record's own
// ---------------------------------------------------------------------------

describe('NtsOdontogramPrintView — norm resolution', () => {
  it('draws the findings under the catalog it was given', async () => {
    const wrapper = await printView({
      record: record({
        norm_version: 'pe_nts_188_2022',
        findings: [finding({ id: 'f1', rule_id: '6.1.9', targets: [tooth('t1', 16)] })]
      })
    })

    // FFP is this norm's sigla for the rule; it reached the box from the
    // catalog passed in, which is the only catalog this component can see.
    expect(wrapper.find('[data-testid="nts-odontogram-chart"]').text()).toContain('FFP')
  })

  it('HAPPY PATH — record B with catalog B prints, whatever the active profile is', async () => {
    // The view never sees the active profile. What it is handed is a pair,
    // and a pair that agrees is printable under any norm name — nothing here
    // is keyed to `pe_nts_188_2022`.
    const wrapper = await printView({
      record: record({
        norm_version: 'norm-B',
        findings: [finding({ id: 'f1', rule_id: '6.1.9', targets: [tooth('t1', 16)] })]
      }),
      catalog: { ...REAL_CATALOG, norm_version: 'norm-B' }
    })

    expect(wrapper.find('[data-testid="nts-print-unavailable"]').exists()).toBe(false)
    expect(wrapper.findAll('[data-fdi]').length).toBeGreaterThanOrEqual(52)
    expect(wrapper.find('[data-testid="nts-odontogram-chart"]').text()).toContain('FFP')
    expect(wrapper.find('[data-testid="nts-print-norm-version"]').text()).toBe('norm-B')
  })

  it('without the record\'s own catalog there is no document at all', async () => {
    // Not a blank form: a blank odontogram is a clinical statement of its
    // own, and drawing one norm's findings under another's rules is worse.
    const wrapper = await printView({
      record: record({ norm_version: 'pe_nts_999_2099' }),
      catalog: null
    })

    expect(wrapper.find('[data-testid="nts-print-unavailable"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="nts-odontogram-chart"]').exists()).toBe(false)
    expect(wrapper.findAll('[data-fdi]')).toHaveLength(0)
  })

  it('no record, no document', async () => {
    const wrapper = await printView({ record: null })

    expect(wrapper.find('[data-testid="nts-print-unavailable"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="nts-odontogram-chart"]').exists()).toBe(false)
  })

  // --- the coherence gate -------------------------------------------------
  //
  // Two non-null objects are not a valid pair. `ruleFor` matches a finding to
  // a rule by `rule_id` alone and rule ids are stable across revisions, so a
  // mismatched catalog does not fail loudly — it draws the wrong norm's marks
  // for this record's findings. Measured before the gate existed: the chart
  // rendered, catalog A's sigla FFP appeared on a norm-B record, and the
  // declarations were computed under A.

  it('GATE — a catalog for another norm prints nothing at all', async () => {
    const mismatched = record({
      norm_version: 'norm-B',
      findings: [finding({ id: 'f1', rule_id: '6.1.9', targets: [tooth('t1', 16)] })]
    })
    const catalogA = { ...REAL_CATALOG, norm_version: 'norm-A' }
    const wrapper = await printView({ record: mismatched, catalog: catalogA })

    expect(wrapper.find('[data-testid="nts-print-unavailable"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="nts-odontogram-chart"]').exists()).toBe(false)
    expect(wrapper.findAll('[data-fdi]')).toHaveLength(0)
    // Not one mark from the wrong norm reaches the page.
    expect(wrapper.html()).not.toContain('FFP')
    expect(wrapper.find('[data-testid="nts-print-declarations"]').exists()).toBe(false)
  })

  it('GATE — the pure model refuses a mismatched pair on its own', async () => {
    // It is called directly, so it cannot rely on a caller having gated first.
    const mismatched = record({
      norm_version: 'norm-B',
      findings: [finding({
        id: 'f-s',
        rule_id: '6.1.35',
        attributes: { condition_state: 'good' }
      })]
    })
    const catalogA = { ...REAL_CATALOG, norm_version: 'norm-A' }

    // Against its own norm this finding does produce a declaration…
    expect(printDeclarations(
      record({ ...mismatched, norm_version: REAL_CATALOG.norm_version }),
      REAL_CATALOG
    )).toHaveLength(1)
    // …and under a foreign catalog it produces none, rather than one computed
    // from rules the record never cited.
    expect(printDeclarations(mismatched, catalogA)).toEqual([])
  })

  it('GATE — the invariant answers only whether the two agree', async () => {
    // No norm version is named in the check itself.
    expect(canRenderPrintRecord(record(), REAL_CATALOG)).toBe(true)
    expect(canRenderPrintRecord(record({ norm_version: 'norm-B' }), REAL_CATALOG)).toBe(false)
    expect(canRenderPrintRecord(null, REAL_CATALOG)).toBe(false)
    expect(canRenderPrintRecord(record(), null)).toBe(false)
    // Agreement is enough, whatever the norm happens to be called.
    expect(canRenderPrintRecord(
      record({ norm_version: 'norm-Z' }),
      { ...REAL_CATALOG, norm_version: 'norm-Z' }
    )).toBe(true)
  })

  it('the status model reports what kind of sheet this is', async () => {
    // 05F.1 computes it; 05F.3 decorates it.
    expect(toPrintStatus(record())!.isQualified).toBe(false)
    expect(toPrintStatus(record({ status: 'draft' }))!.isQualified).toBe(true)
    expect(toPrintStatus(record({ status: 'discarded' }))!.isQualified).toBe(true)
    expect(toPrintStatus(record(), { isSuperseded: true })!.isQualified).toBe(true)
  })
})
