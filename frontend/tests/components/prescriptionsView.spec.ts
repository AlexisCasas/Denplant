/**
 * Recetas: the history, the detail and the PDF, through the real components.
 *
 * This file covers what Phase C shipped: the read-only history, detail and PDF.
 * The user here is a signed-in reader with no write permission, so no write
 * control appears; the writes are in `prescriptionsWrite.spec.ts`.
 *
 * `useApi`, `useAuth`, `useToast` and `useI18n` are doubled; the layer is
 * imported by relative path (`frontend/module_layers` does not resolve on this
 * Windows host). `useI18n` answers from the module's real `es.json`, and a key
 * the file does not have comes back as the key itself, so a missing string shows
 * up as `prescriptions.something` in the text assertions.
 *
 * The PDF is checked against doubles for `fetch`, `window.open`,
 * `URL.createObjectURL` and `URL.revokeObjectURL`.
 */

import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'

import PrescriptionsView from '../../../backend/app/modules/prescriptions/frontend/components/PrescriptionsView.vue'
import { filenameFromDisposition } from '../../../backend/app/modules/prescriptions/frontend/composables/usePrescriptions'
import type {
  PrescriptionDetail,
  PrescriptionListItem
} from '../../../backend/app/modules/prescriptions/frontend/types/prescriptions'

const MODULE = resolve(process.cwd(), '../backend/app/modules/prescriptions/frontend')
const readLocale = (code: string) =>
  JSON.parse(readFileSync(resolve(MODULE, 'i18n/locales', `${code}.json`), 'utf8'))

const state = vi.hoisted(() => {
  const s = {
    get: vi.fn(),
    fetch: vi.fn(),
    open: vi.fn(),
    refresh: vi.fn(),
    toastAdd: vi.fn(),
    token: 'tok-1',
    role: null as string | null,
    user: { id: 'u1', first_name: 'Ana', last_name: 'Reader', professional_id: undefined as string | undefined },
    permissions: new Set<string>(),
    cache: null as unknown,
    locale: 'es',
    messages: {} as Record<string, unknown>,
    t: (key: string, params: Record<string, unknown> = {}): string => {
      let node: unknown = s.messages
      for (const part of key.split('.')) {
        node = node && typeof node === 'object' ? (node as Record<string, unknown>)[part] : undefined
      }
      if (typeof node !== 'string') return key
      return node.replace(/\{(\w+)\}/g, (_, name) => String(params[name] ?? `{${name}}`))
    }
  }
  return s
})

mockNuxtImport('useApi', () => () => ({ get: state.get }))
mockNuxtImport('useAuth', () => () => ({
  accessToken: { get value() { return state.token } },
  currentRole: { get value() { return state.role } },
  user: { get value() { return state.user } },
  refresh: state.refresh
}))
mockNuxtImport('usePermissions', () => () => ({
  can: (permission: string) => state.permissions.has(permission)
}))
mockNuxtImport('useNuxtData', () => () => ({
  data: { get value() { return state.cache } }
}))
mockNuxtImport('useToast', () => () => ({ add: state.toastAdd }))
mockNuxtImport('useI18n', () => () => ({
  t: state.t,
  locale: { get value() { return state.locale } }
}))

// ---------------------------------------------------------------------------
// builders and doubles
// ---------------------------------------------------------------------------

function listItem(id: string, over: Partial<PrescriptionListItem> = {}): PrescriptionListItem {
  return {
    id,
    number: `RX-2026-${id.padStart(6, '0')}`,
    issued_at: '2026-10-03T22:33:18.146773Z',
    issue_date: '2026-10-03',
    valid_until: '2026-10-10',
    prescriber_name_snapshot: 'María García López',
    item_count: 2,
    status: 'issued',
    voided_at: null,
    ...over
  }
}

function item(position: number, over: Record<string, unknown> = {}) {
  return {
    id: `item-${position}`,
    position,
    active_ingredient: `QA MED ${position}`,
    strength: '500 mg',
    pharmaceutical_form: 'Tableta',
    dose: '1 tableta',
    route: 'Vía oral',
    frequency: 'Cada 8 horas',
    duration: '7 días',
    total_quantity: '21 tabletas',
    commercial_name: null,
    presentation: null,
    instructions: null,
    ...over
  }
}

function detailOf(id: string, over: Partial<PrescriptionDetail> = {}): PrescriptionDetail {
  return {
    id,
    clinic_id: 'clinic-1',
    patient_id: 'p1',
    prescriber_user_id: 'user-1',
    number: `RX-2026-${id.padStart(6, '0')}`,
    sequence: 4,
    year: 2026,
    issued_at: '2026-10-03T22:33:18.146773Z',
    issue_date: '2026-10-03',
    valid_until: '2026-10-10',
    status: 'issued',
    voided_at: null,
    voided_by: null,
    void_reason: null,
    patient_name_snapshot: 'Manuel Castro Delgado',
    patient_national_id_snapshot: '45678912',
    patient_national_id_type_snapshot: 'dni',
    patient_date_of_birth_snapshot: '1945-11-19',
    prescriber_name_snapshot: 'María García López',
    prescriber_professional_id_snapshot: '28/12345',
    clinic_name_snapshot: 'Clínica Dental Demo',
    clinic_legal_name_snapshot: null,
    clinic_tax_id_snapshot: 'B12345678',
    clinic_address_snapshot: 'Calle Gran Vía 123',
    clinic_phone_snapshot: '+51 916 533 047',
    items: [item(1)],
    ...over
  } as PrescriptionDetail
}

function envelope(rows: PrescriptionListItem[], total = rows.length, page = 1) {
  return { data: rows, total, page, page_size: 10, message: null }
}

function deferred<T>() {
  let resolveIt!: (value: T) => void
  let rejectIt!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolveIt = res
    rejectIt = rej
  })
  return { promise, resolve: resolveIt, reject: rejectIt }
}

function pdfResponse(init: { status?: number, type?: string, disposition?: string | null } = {}) {
  const headers: Record<string, string> = { 'Content-Type': init.type ?? 'application/pdf' }
  if (init.disposition !== null) {
    headers['Content-Disposition'] = init.disposition ?? 'inline; filename="receta-RX-2026-000004.pdf"'
  }
  return new Response(new Blob(['%PDF-1.7'], { type: init.type ?? 'application/pdf' }), {
    status: init.status ?? 200,
    headers
  })
}

function fakePopup() {
  return { opener: 'the-opener' as unknown, closed: false, close: vi.fn(), location: { href: '' } }
}

async function settle() {
  await nextTick()
  await new Promise(resolve => setTimeout(resolve, 0))
  await nextTick()
  await new Promise(resolve => setTimeout(resolve, 0))
  await nextTick()
}

const mounted: Array<{ unmount: () => void }> = []

async function mountView(patientId = 'p1') {
  const wrapper = await mountSuspended(PrescriptionsView, {
    props: { ctx: { patientId } }
  })
  mounted.push(wrapper)
  await settle()
  return wrapper
}

type Wrapper = Awaited<ReturnType<typeof mountView>>

const body = () => document.body
const $ = (testid: string) => document.querySelector(`[data-testid="${testid}"]`)
const rowButtons = (wrapper: Wrapper, testid: string) =>
  wrapper.findAll(`[data-testid="${testid}"]`)

let createdUrls = 0
const original = {
  createObjectURL: URL.createObjectURL,
  revokeObjectURL: URL.revokeObjectURL,
  open: window.open
}

beforeEach(() => {
  state.messages = { ...readLocale('es'), common: { error: 'Error' } }
  state.locale = 'es'
  state.token = 'tok-1'
  state.role = null
  state.permissions = new Set()
  state.cache = null
  for (const fn of [state.get, state.fetch, state.open, state.refresh, state.toastAdd]) fn.mockReset()
  state.get.mockResolvedValue(envelope([]))
  state.refresh.mockResolvedValue(true)

  createdUrls = 0
  URL.createObjectURL = vi.fn(() => `blob:fake-${++createdUrls}`) as typeof URL.createObjectURL
  URL.revokeObjectURL = vi.fn() as typeof URL.revokeObjectURL
  window.open = state.open as typeof window.open
  vi.stubGlobal('fetch', state.fetch)
})

afterEach(async () => {
  while (mounted.length) mounted.pop()?.unmount()
  await nextTick()
  URL.createObjectURL = original.createObjectURL
  URL.revokeObjectURL = original.revokeObjectURL
  window.open = original.open
  vi.unstubAllGlobals()
})

// ===========================================================================
// the history
// ===========================================================================

describe('the history', () => {
  it('shows a skeleton while it loads', async () => {
    const pending = deferred<unknown>()
    state.get.mockReturnValue(pending.promise)

    const wrapper = await mountView()

    expect(wrapper.find('[data-testid="prescriptions-loading"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="prescriptions-empty"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="prescriptions-error"]').exists()).toBe(false)

    pending.resolve(envelope([listItem('4')]))
    await settle()
    expect(wrapper.find('[data-testid="prescriptions-loading"]').exists()).toBe(false)
  })

  it('says so when there are no prescriptions', async () => {
    const wrapper = await mountView()
    expect(wrapper.find('[data-testid="prescriptions-empty"]').text()).toBe('Aún no hay recetas registradas.')
    expect(wrapper.find('[data-testid="prescriptions-list"]').exists()).toBe(false)
  })

  it('asks for the page of this patient, 10 at a time, and can be cancelled', async () => {
    await mountView('p7')

    expect(state.get).toHaveBeenCalledTimes(1)
    const [url, options] = state.get.mock.calls[0]!
    expect(url).toBe('/api/v1/prescriptions')
    expect(options.query).toEqual({ patient_id: 'p7', page: 1, page_size: 10 })
    expect(options.signal).toBeInstanceOf(AbortSignal)
  })

  it('lists a row per prescription, in the order the API sent them', async () => {
    state.get.mockResolvedValue(envelope([
      listItem('5', { number: 'RX-2026-000005', item_count: 10 }),
      listItem('4', { number: 'RX-2026-000004', issue_date: '2026-10-03' }),
      listItem('1', { number: 'RX-2026-000001', status: 'voided', voided_at: '2026-10-03T22:26:33Z' })
    ]))

    const wrapper = await mountView()
    const rows = wrapper.findAll('[data-testid^="prescription-row-"][data-status]')

    expect(rows).toHaveLength(3)
    expect(rows.map(r => r.find('[data-testid="prescription-row-number"]').text()))
      .toEqual(['RX-2026-000005', 'RX-2026-000004', 'RX-2026-000001'])
    expect(rows[0]!.find('[data-testid="prescription-row-items"]').text()).toBe('10')
    expect(rows[0]!.find('[data-testid="prescription-row-prescriber"]').text()).toBe('María García López')
    expect(wrapper.find('[data-testid="prescriptions-total"]').text()).toBe('Total: 3')
  })

  it('writes the state from the API\'s own field, in words', async () => {
    state.get.mockResolvedValue(envelope([
      listItem('4'),
      listItem('1', { status: 'voided', voided_at: '2026-10-03T22:26:33Z' })
    ]))

    const wrapper = await mountView()
    const statuses = wrapper.findAll('[data-testid="prescription-row-status"]')

    expect(statuses.map(s => s.text())).toEqual(['Emitida', 'Anulada'])
    expect(wrapper.findAll('[data-status]').map(r => r.attributes('data-status'))).toEqual(['issued', 'voided'])
  })

  it('shows a calendar date as that day, in the order of the locale', async () => {
    state.get.mockResolvedValue(envelope([listItem('4', { issue_date: '2026-10-03' })]))

    const wrapper = await mountView()
    expect(wrapper.find('[data-testid="prescription-row-date"]').text()).toBe('03/10/2026')
    expect(wrapper.text()).not.toContain('02/10/2026')
  })

  it('offers View and Print on each row, and nothing that writes', async () => {
    state.get.mockResolvedValue(envelope([listItem('4'), listItem('1', { status: 'voided' })]))

    const wrapper = await mountView()

    expect(rowButtons(wrapper, 'prescription-row-view')).toHaveLength(2)
    expect(rowButtons(wrapper, 'prescription-row-print')).toHaveLength(2)
    const labels = wrapper.findAll('button').map(b => b.text())
    expect(new Set(labels)).toEqual(new Set(['Ver', 'Imprimir']))
    expect(wrapper.text()).not.toMatch(/nueva receta|new prescription|crear|emitir/i)
    // accessible names say which prescription
    expect(rowButtons(wrapper, 'prescription-row-view')[0]!.attributes('aria-label')).toBe('Ver la receta RX-2026-000004')
    expect(rowButtons(wrapper, 'prescription-row-print')[0]!.attributes('aria-label')).toBe('Imprimir la receta RX-2026-000004')
  })

  it('does not read the Clinical tab\'s readonly flag: the same rows, the same buttons', async () => {
    state.get.mockResolvedValue(envelope([listItem('4')]))
    const view = async (readonly: boolean) => {
      const wrapper = await mountSuspended(PrescriptionsView, {
        props: { ctx: { patientId: 'p1', readonly } }
      })
      mounted.push(wrapper)
      await settle()
      return wrapper.findAll('button').map(b => b.text())
    }

    expect(await view(true)).toEqual(await view(false))
  })

  describe('when it fails', () => {
    it('shows a notice with a retry, and the rest of the view is intact', async () => {
      state.get.mockRejectedValue(new Error('boom'))

      const wrapper = await mountView()

      expect(wrapper.find('[data-testid="prescriptions-error"]').text()).toContain('No se pudieron cargar las recetas.')
      expect(wrapper.find('[data-testid="prescriptions-empty"]').exists()).toBe(false)
      expect(wrapper.find('[data-testid="prescriptions-view"]').exists()).toBe(true)
    })

    it('retries the same page and recovers', async () => {
      state.get.mockRejectedValueOnce(new Error('boom'))
      state.get.mockResolvedValue(envelope([listItem('4')]))

      const wrapper = await mountView()
      await wrapper.find('[data-testid="prescriptions-retry"]').trigger('click')
      await settle()

      expect(state.get).toHaveBeenCalledTimes(2)
      expect(state.get.mock.calls[1]![1].query.page).toBe(1)
      expect(wrapper.find('[data-testid="prescriptions-error"]').exists()).toBe(false)
      expect(wrapper.findAll('[data-testid^="prescription-row-"][data-status]')).toHaveLength(1)
    })
  })
})

// ===========================================================================
// pagination
// ===========================================================================

describe('pagination', () => {
  const rowsOf = (from: number, count: number) =>
    Array.from({ length: count }, (_, i) => listItem(String(from + i)))

  it('has no paginator for a single page', async () => {
    state.get.mockResolvedValue(envelope(rowsOf(1, 10), 10))
    const wrapper = await mountView()
    expect(wrapper.find('[data-testid="prescriptions-pagination"]').exists()).toBe(false)
  })

  it('shows "Página X de Y" from the total and the page size', async () => {
    state.get.mockResolvedValue(envelope(rowsOf(1, 10), 25))
    const wrapper = await mountView()

    expect(wrapper.find('[data-testid="prescriptions-page"]').text()).toBe('Página 1 de 3')
    expect(wrapper.find('[data-testid="prescriptions-pagination"]').attributes('aria-label')).toBe('Paginación de recetas')
  })

  it('goes forward and back, asking for exactly that page', async () => {
    state.get.mockImplementation(async (_url: string, options: { query: { page: number } }) =>
      envelope(rowsOf((options.query.page - 1) * 10 + 1, 10), 25, options.query.page))
    const wrapper = await mountView()

    const prev = () => wrapper.find('[data-testid="prescriptions-prev"]')
    const next = () => wrapper.find('[data-testid="prescriptions-next"]')
    expect(prev().attributes('disabled')).toBeDefined()
    expect(next().attributes('disabled')).toBeUndefined()

    await next().trigger('click')
    await settle()
    expect(state.get.mock.calls.at(-1)![1].query).toEqual({ patient_id: 'p1', page: 2, page_size: 10 })
    expect(wrapper.find('[data-testid="prescriptions-page"]').text()).toBe('Página 2 de 3')
    expect(prev().attributes('disabled')).toBeUndefined()

    await next().trigger('click')
    await settle()
    expect(wrapper.find('[data-testid="prescriptions-page"]').text()).toBe('Página 3 de 3')
    expect(next().attributes('disabled')).toBeDefined()

    await prev().trigger('click')
    await settle()
    expect(state.get.mock.calls.at(-1)![1].query.page).toBe(2)
    expect(wrapper.find('[data-testid="prescriptions-page"]').text()).toBe('Página 2 de 3')
  })

  it('shows the rows of the page it landed on', async () => {
    state.get.mockImplementation(async (_url: string, options: { query: { page: number } }) =>
      envelope(rowsOf((options.query.page - 1) * 10 + 1, 10), 25, options.query.page))
    const wrapper = await mountView()

    await wrapper.find('[data-testid="prescriptions-next"]').trigger('click')
    await settle()

    const numbers = wrapper.findAll('[data-testid="prescription-row-number"]').map(n => n.text())
    expect(numbers[0]).toBe('RX-2026-000011')
    expect(numbers).toHaveLength(10)
  })

  it('a failed page offers a retry of that page, not of the first', async () => {
    state.get.mockImplementation(async (_url: string, options: { query: { page: number } }) =>
      envelope(rowsOf((options.query.page - 1) * 10 + 1, 10), 25, options.query.page))
    const wrapper = await mountView()

    state.get.mockRejectedValueOnce(new Error('boom'))
    await wrapper.find('[data-testid="prescriptions-next"]').trigger('click')
    await settle()
    expect(wrapper.find('[data-testid="prescriptions-error"]').exists()).toBe(true)

    await wrapper.find('[data-testid="prescriptions-retry"]').trigger('click')
    await settle()
    expect(state.get.mock.calls.at(-1)![1].query.page).toBe(2)
    expect(wrapper.find('[data-testid="prescriptions-error"]').exists()).toBe(false)
  })
})

// ===========================================================================
// another patient
// ===========================================================================

describe('when the patient changes', () => {
  it('clears the previous patient at once, starts again at page 1 and asks for the new one', async () => {
    const forB = deferred<unknown>()
    state.get.mockImplementation(async (_url: string, options: { query: { patient_id: string, page: number } }) => {
      if (options.query.patient_id === 'pA') {
        return envelope(Array.from({ length: 10 }, (_, i) => listItem(`a${i}`)), 25, options.query.page)
      }
      return await forB.promise
    })
    const wrapper = await mountView('pA')
    await wrapper.find('[data-testid="prescriptions-next"]').trigger('click')
    await settle()
    expect(wrapper.find('[data-testid="prescriptions-page"]').text()).toBe('Página 2 de 3')

    await wrapper.setProps({ ctx: { patientId: 'pB' } })
    await nextTick()

    // before B's first byte: nothing of A, a loading state, back on page 1
    expect(wrapper.findAll('[data-testid^="prescription-row-"][data-status]')).toHaveLength(0)
    expect(wrapper.find('[data-testid="prescriptions-loading"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="prescriptions-pagination"]').exists()).toBe(false)
    const last = state.get.mock.calls.at(-1)![1]
    expect(last.query).toEqual({ patient_id: 'pB', page: 1, page_size: 10 })

    forB.resolve(envelope([listItem('b1')]))
    await settle()
    expect(wrapper.findAll('[data-testid^="prescription-row-"][data-status]')).toHaveLength(1)
  })

  it('aborts the request that was in flight and ignores its late answer', async () => {
    const forA = deferred<unknown>()
    const signals: Record<string, AbortSignal> = {}
    state.get.mockImplementation(async (_url: string, options: { query: { patient_id: string }, signal: AbortSignal }) => {
      signals[options.query.patient_id] = options.signal
      if (options.query.patient_id === 'pA') return await forA.promise
      return envelope([listItem('b1', { number: 'RX-B-1' })])
    })
    const wrapper = await mountView('pA')

    await wrapper.setProps({ ctx: { patientId: 'pB' } })
    await settle()
    expect(signals.pA!.aborted).toBe(true)
    expect(signals.pB!.aborted).toBe(false)

    // A answers late. It must not show up under B.
    forA.resolve(envelope([listItem('a1', { number: 'RX-A-1' })]))
    await settle()

    const numbers = wrapper.findAll('[data-testid="prescription-row-number"]').map(n => n.text())
    expect(numbers).toEqual(['RX-B-1'])
    expect(wrapper.text()).not.toContain('RX-A-1')
  })

  it('a late error from the previous patient shows nothing under the new one', async () => {
    const forA = deferred<unknown>()
    state.get.mockImplementation(async (_url: string, options: { query: { patient_id: string } }) =>
      options.query.patient_id === 'pA' ? await forA.promise : envelope([listItem('b1')]))
    const wrapper = await mountView('pA')

    await wrapper.setProps({ ctx: { patientId: 'pB' } })
    await settle()
    forA.reject(new Error('late'))
    await settle()

    expect(wrapper.find('[data-testid="prescriptions-error"]').exists()).toBe(false)
    expect(wrapper.findAll('[data-testid^="prescription-row-"][data-status]')).toHaveLength(1)
  })

  it('a late page answer for the old patient does not replace the new patient\'s page', async () => {
    const latePage = deferred<unknown>()
    state.get.mockImplementation(async (_url: string, options: { query: { patient_id: string, page: number } }) => {
      if (options.query.patient_id === 'pA' && options.query.page === 2) return await latePage.promise
      if (options.query.patient_id === 'pA') {
        return envelope(Array.from({ length: 10 }, (_, i) => listItem(`a${i}`)), 25)
      }
      return envelope([listItem('b1', { number: 'RX-B-1' })])
    })
    const wrapper = await mountView('pA')
    await wrapper.find('[data-testid="prescriptions-next"]').trigger('click')
    await wrapper.setProps({ ctx: { patientId: 'pB' } })
    await settle()

    latePage.resolve(envelope([listItem('a99', { number: 'RX-A-99' })], 25, 2))
    await settle()

    expect(wrapper.text()).not.toContain('RX-A-99')
    expect(wrapper.find('[data-testid="prescription-row-number"]').text()).toBe('RX-B-1')
  })

  it('closes an open detail and drops it', async () => {
    state.get.mockImplementation(async (url: string) => {
      if (url === '/api/v1/prescriptions') return envelope([listItem('4')])
      return { data: detailOf('4'), message: null }
    })
    const wrapper = await mountView('pA')
    await wrapper.find('[data-testid="prescription-row-view"]').trigger('click')
    await settle()
    expect($('prescription-detail-number')).not.toBeNull()

    await wrapper.setProps({ ctx: { patientId: 'pB' } })
    await settle()

    expect($('prescription-detail-number')).toBeNull()
    expect(body().textContent).not.toContain('Manuel Castro Delgado')
  })
})

// ===========================================================================
// the detail
// ===========================================================================

describe('the detail', () => {
  function routes(detail: PrescriptionDetail, rows: PrescriptionListItem[] = [listItem('4')]) {
    state.get.mockImplementation(async (url: string) => {
      if (url === '/api/v1/prescriptions') return envelope(rows)
      return { data: detail, message: null }
    })
  }

  async function open(wrapper: Wrapper) {
    await wrapper.find('[data-testid="prescription-row-view"]').trigger('click')
    await settle()
  }

  it('asks for the prescription and shows a skeleton while it comes', async () => {
    const pending = deferred<unknown>()
    state.get.mockImplementation(async (url: string) =>
      url === '/api/v1/prescriptions' ? envelope([listItem('4')]) : await pending.promise)
    const wrapper = await mountView()

    await wrapper.find('[data-testid="prescription-row-view"]').trigger('click')
    await nextTick()

    expect(state.get.mock.calls.at(-1)![0]).toBe('/api/v1/prescriptions/4')
    expect($('prescription-detail-loading')).not.toBeNull()

    pending.resolve({ data: detailOf('4'), message: null })
    await settle()
    expect($('prescription-detail-loading')).toBeNull()
    expect($('prescription-detail-number')).not.toBeNull()
  })

  it('shows the receipt, the patient and the prescriber from the snapshots', async () => {
    routes(detailOf('4'))
    await open(await mountView())

    expect($('prescription-detail-number')!.textContent!.trim()).toBe('RX-2026-000004')
    expect($('prescription-detail-status')!.textContent!.trim()).toBe('Emitida')
    expect($('prescription-detail-issue-date')!.textContent!.trim()).toBe('03/10/2026')
    expect($('prescription-detail-valid-until')!.textContent!.trim()).toBe('10/10/2026')
    expect($('prescription-detail-patient-name')!.textContent!.trim()).toBe('Manuel Castro Delgado')
    expect($('prescription-detail-patient-document')!.textContent!.trim()).toBe('DNI: 45678912')
    expect($('prescription-detail-prescriber-name')!.textContent!.trim()).toBe('María García López')
    expect($('prescription-detail-professional-id')!.textContent!.trim()).toBe('28/12345')
  })

  it('shows the date of birth as that day, and no age', async () => {
    routes(detailOf('4', { patient_date_of_birth_snapshot: '1945-11-19' }))
    await open(await mountView())

    expect($('prescription-detail-patient-birth')!.textContent!.trim()).toBe('19/11/1945')
    expect(body().textContent).not.toMatch(/\bedad\b|\bage\b/i)
  })

  it('leaves the document out when the patient had none', async () => {
    routes(detailOf('4', { patient_national_id_snapshot: null, patient_national_id_type_snapshot: null }))
    await open(await mountView())
    expect($('prescription-detail-patient-document')).toBeNull()
  })

  it('lists the medications by position, with every required field', async () => {
    routes(detailOf('4', {
      items: [item(3, { active_ingredient: 'Tercera' }), item(1, { active_ingredient: 'Primera' }), item(2, { active_ingredient: 'Segunda' })]
    }))
    await open(await mountView())

    const names = [1, 2, 3].map(n => $(`prescription-detail-item-${n}`)!.textContent!)
    expect(names[0]).toContain('Primera')
    expect(names[1]).toContain('Segunda')
    expect(names[2]).toContain('Tercera')
    for (const fragment of ['500 mg', 'Tableta', '1 tableta', 'Vía oral', 'Cada 8 horas', '7 días', '21 tabletas']) {
      expect(names[0]).toContain(fragment)
    }
  })

  it('shows the optional fields only when they exist', async () => {
    routes(detailOf('4', {
      items: [
        item(1, { commercial_name: 'Amoxil', presentation: 'Caja x 21', instructions: 'Con agua\nSin alcohol' }),
        item(2)
      ]
    }))
    await open(await mountView())

    const first = $('prescription-detail-item-1')!
    const second = $('prescription-detail-item-2')!
    expect(first.querySelector('[data-testid="prescription-detail-item-commercial"]')!.textContent).toContain('Amoxil')
    expect(first.querySelector('[data-testid="prescription-detail-item-presentation"]')!.textContent).toContain('Caja x 21')
    expect(first.querySelector('[data-testid="prescription-detail-item-instructions"]')!.textContent).toContain('Con agua')
    expect(second.querySelector('[data-testid="prescription-detail-item-commercial"]')).toBeNull()
    expect(second.querySelector('[data-testid="prescription-detail-item-presentation"]')).toBeNull()
    expect(second.querySelector('[data-testid="prescription-detail-item-instructions"]')).toBeNull()
  })

  it('shows what is written as text, never as markup', async () => {
    routes(detailOf('4', {
      patient_name_snapshot: '<img src=x onerror=alert(1)>',
      items: [item(1, { instructions: '<script>alert(2)</script>' })]
    }))
    await open(await mountView())

    expect(body().querySelector('img[src="x"]')).toBeNull()
    expect(body().querySelector('[data-testid="prescription-detail"] script')).toBeNull()
    expect($('prescription-detail-patient-name')!.textContent).toContain('<img src=x onerror=alert(1)>')
  })

  it('an issued prescription shows no void block', async () => {
    routes(detailOf('4'))
    await open(await mountView())
    expect($('prescription-detail-void')).toBeNull()
  })

  it('a voided one says ANULADA with the reason and the instant, and not who', async () => {
    routes(
      detailOf('1', {
        status: 'voided',
        voided_at: '2026-10-03T22:26:33.764122Z',
        voided_by: 'b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a22',
        void_reason: 'Dosis mal escrita\nVer la nueva receta'
      }),
      [listItem('1', { status: 'voided' })]
    )
    await open(await mountView())

    expect($('prescription-detail-void')!.textContent).toContain('Receta anulada')
    expect($('prescription-detail-status')!.textContent!.trim()).toBe('Anulada')
    expect($('prescription-detail-void-reason')!.textContent).toContain('Dosis mal escrita')
    expect($('prescription-detail-void-at')!.textContent!.trim()).not.toBe('')
    expect($('prescription-detail-void-at')!.textContent).toMatch(/2026/)
    // an identifier is not a person
    expect(body().textContent).not.toContain('b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a22')
    expect(body().textContent).not.toMatch(/anulad[oa] por/i)
  })

  it('offers close and print, and nothing that edits', async () => {
    routes(detailOf('4'))
    await open(await mountView())

    const modal = $('prescription-detail')!.closest('[role="dialog"]') ?? body()
    const labels = Array.from(modal.querySelectorAll('button')).map(b => b.textContent!.trim()).filter(Boolean)
    expect(labels).toEqual(expect.arrayContaining(['Cerrar', 'Imprimir']))
    expect(labels.join(' ')).not.toMatch(/editar|eliminar|anular|duplicar|edit|delete|void|duplicate/i)
    expect(modal.querySelectorAll('input, textarea, select')).toHaveLength(0)
  })

  it('has a heading, a description and scrolls', async () => {
    routes(detailOf('4'))
    await open(await mountView())

    const dialog = $('prescription-detail')!.closest('[role="dialog"]')!
    expect(dialog.textContent).toContain('Receta RX-2026-000004')
    expect(dialog.textContent).toContain('Detalle de solo lectura')
    expect($('prescription-detail')!.className).toContain('overflow-y-auto')
    expect(dialog.querySelectorAll('h3').length).toBeGreaterThanOrEqual(4)
  })

  it('closing it clears it and does not reload the history', async () => {
    routes(detailOf('4'))
    const wrapper = await mountView()
    await open(wrapper)
    const calls = state.get.mock.calls.length

    ;($('prescription-detail-close') as HTMLElement).click()
    await settle()

    expect($('prescription-detail-number')).toBeNull()
    expect(state.get.mock.calls.length).toBe(calls)
    expect(wrapper.findAll('[data-testid^="prescription-row-"][data-status]')).toHaveLength(1)
  })

  describe('when it fails', () => {
    it('shows the error inside the dialog and leaves the history alone', async () => {
      state.get.mockImplementation(async (url: string) => {
        if (url === '/api/v1/prescriptions') return envelope([listItem('4')])
        throw new Error('boom')
      })
      const wrapper = await mountView()
      const calls = state.get.mock.calls.length

      await open(wrapper)

      expect($('prescription-detail-error')!.textContent).toContain('No se pudo cargar la receta.')
      expect(wrapper.find('[data-testid="prescriptions-error"]').exists()).toBe(false)
      expect(wrapper.findAll('[data-testid^="prescription-row-"][data-status]')).toHaveLength(1)
      // only the detail was asked for: the list was not requested again
      expect(state.get.mock.calls.length).toBe(calls + 1)
    })

    it('retries only the detail', async () => {
      state.get.mockImplementation(async (url: string) => {
        if (url === '/api/v1/prescriptions') return envelope([listItem('4')])
        return { data: detailOf('4'), message: null }
      })
      const wrapper = await mountView()
      state.get.mockRejectedValueOnce(new Error('boom'))
      await open(wrapper)
      expect($('prescription-detail-error')).not.toBeNull()

      ;($('prescription-detail-retry') as HTMLElement).click()
      await settle()

      expect(state.get.mock.calls.at(-1)![0]).toBe('/api/v1/prescriptions/4')
      expect($('prescription-detail-error')).toBeNull()
      expect($('prescription-detail-number')).not.toBeNull()
    })

    it('a slow detail that arrives after another one was opened does not replace it', async () => {
      const first = deferred<unknown>()
      state.get.mockImplementation(async (url: string) => {
        if (url === '/api/v1/prescriptions') return envelope([listItem('4'), listItem('5')])
        if (url.endsWith('/4')) return await first.promise
        return { data: detailOf('5'), message: null }
      })
      const wrapper = await mountView()
      const views = wrapper.findAll('[data-testid="prescription-row-view"]')
      await views[0]!.trigger('click')
      await views[1]!.trigger('click')
      await settle()

      first.resolve({ data: detailOf('4'), message: null })
      await settle()

      expect($('prescription-detail-number')!.textContent!.trim()).toBe('RX-2026-000005')
    })
  })
})

// ===========================================================================
// the PDF
// ===========================================================================

describe('printing', () => {
  const ID = '4'

  async function withRow(detail?: PrescriptionDetail) {
    state.get.mockImplementation(async (url: string) =>
      url === '/api/v1/prescriptions' ? envelope([listItem(ID)]) : { data: detail ?? detailOf(ID), message: null })
    return await mountView()
  }

  const printButton = (wrapper: Wrapper) =>
    wrapper.find('[data-testid="prescription-row-print"]')

  it('opens the window inside the click, before the fetch can answer', async () => {
    const order: string[] = []
    const pending = deferred<Response>()
    state.open.mockImplementation(() => {
      order.push('open')
      return fakePopup()
    })
    state.fetch.mockImplementation(() => {
      order.push('fetch')
      return pending.promise
    })
    const wrapper = await withRow()

    ;(printButton(wrapper).element as HTMLElement).click()

    // synchronously, with the response still pending
    expect(order).toEqual(['open', 'fetch'])
    expect(state.open).toHaveBeenCalledWith('', '_blank')
    pending.resolve(pdfResponse())
    await settle()
  })

  it('asks for the PDF of that prescription with the user\'s token', async () => {
    state.open.mockReturnValue(fakePopup())
    state.fetch.mockImplementation(async () => pdfResponse())
    const wrapper = await withRow()

    await printButton(wrapper).trigger('click')
    await settle()

    expect(state.fetch).toHaveBeenCalledTimes(1)
    const [url, options] = state.fetch.mock.calls[0]!
    expect(String(url)).toMatch(/\/api\/v1\/prescriptions\/4\/pdf\?locale=es$/)
    expect(options.headers).toEqual({ Authorization: 'Bearer tok-1' })
    expect(options.signal).toBeInstanceOf(AbortSignal)
  })

  it('shows the PDF in the window it opened, detached from the page', async () => {
    const popup = fakePopup()
    state.open.mockReturnValue(popup)
    state.fetch.mockImplementation(async () => pdfResponse())
    const wrapper = await withRow()

    await printButton(wrapper).trigger('click')
    await settle()

    expect(popup.opener).toBeNull()
    expect(popup.location.href).toBe('blob:fake-1')
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1)
    expect(((URL.createObjectURL as unknown as ReturnType<typeof vi.fn>).mock.calls[0]![0]) instanceof Blob).toBe(true)
    expect(popup.close).not.toHaveBeenCalled()
    // not released while the viewer may still be reading it
    expect(URL.revokeObjectURL).not.toHaveBeenCalled()
    expect(state.toastAdd).not.toHaveBeenCalled()
  })

  it.each([
    ['es', '?locale=es'],
    ['en', '?locale=en'],
    ['fr', ''],
    ['pt', ''],
    ['ta', '']
  ])('with the interface in %s it asks for %j', async (locale, query) => {
    state.locale = locale
    state.open.mockReturnValue(fakePopup())
    state.fetch.mockImplementation(async () => pdfResponse())
    const wrapper = await withRow()

    await printButton(wrapper).trigger('click')
    await settle()

    const url = String(state.fetch.mock.calls[0]![0])
    expect(url.endsWith(`/api/v1/prescriptions/4/pdf${query}`)).toBe(true)
    expect(url).not.toMatch(/locale=(fr|pt|ta)/)
  })

  describe('an expired token', () => {
    it('is refreshed once and the request is repeated once with the new token', async () => {
      const popup = fakePopup()
      state.open.mockReturnValue(popup)
      state.fetch
        .mockResolvedValueOnce(new Response('expired', { status: 401 }))
        .mockImplementation(async () => pdfResponse())
      state.refresh.mockImplementation(async () => {
        state.token = 'tok-2'
        return true
      })
      const wrapper = await withRow()

      await printButton(wrapper).trigger('click')
      await settle()

      expect(state.refresh).toHaveBeenCalledTimes(1)
      expect(state.fetch).toHaveBeenCalledTimes(2)
      expect(state.fetch.mock.calls[0]![1].headers.Authorization).toBe('Bearer tok-1')
      expect(state.fetch.mock.calls[1]![1].headers.Authorization).toBe('Bearer tok-2')
      expect(popup.location.href).toBe('blob:fake-1')
    })

    it('when the refresh fails, it stops: no second request, the window is closed, an error is shown', async () => {
      const popup = fakePopup()
      state.open.mockReturnValue(popup)
      state.fetch.mockImplementation(async () => new Response('expired', { status: 401 }))
      state.refresh.mockResolvedValue(false)
      const wrapper = await withRow()

      await printButton(wrapper).trigger('click')
      await settle()

      expect(state.fetch).toHaveBeenCalledTimes(1)
      expect(popup.close).toHaveBeenCalledTimes(1)
      expect(popup.location.href).toBe('')
      expect(state.toastAdd).toHaveBeenCalledWith(expect.objectContaining({
        color: 'error',
        description: 'No se pudo abrir el PDF de la receta.'
      }))
    })

    it('a second 401 is final: one refresh, two requests, no loop', async () => {
      const popup = fakePopup()
      state.open.mockReturnValue(popup)
      state.fetch.mockImplementation(async () => new Response('expired', { status: 401 }))
      state.refresh.mockResolvedValue(true)
      const wrapper = await withRow()

      await printButton(wrapper).trigger('click')
      await settle()

      expect(state.refresh).toHaveBeenCalledTimes(1)
      expect(state.fetch).toHaveBeenCalledTimes(2)
      expect(popup.close).toHaveBeenCalledTimes(1)
      expect(state.toastAdd).toHaveBeenCalledTimes(1)
    })

    it('a different failure on the retry is final too', async () => {
      const popup = fakePopup()
      state.open.mockReturnValue(popup)
      state.fetch
        .mockResolvedValueOnce(new Response('expired', { status: 401 }))
        .mockResolvedValueOnce(new Response('boom', { status: 500 }))
      const wrapper = await withRow()

      await printButton(wrapper).trigger('click')
      await settle()

      expect(state.fetch).toHaveBeenCalledTimes(2)
      expect(popup.close).toHaveBeenCalled()
    })
  })

  describe('when it fails', () => {
    it.each([
      ['a network error', () => Promise.reject(new TypeError('Failed to fetch'))],
      ['a 404', () => Promise.resolve(new Response('{}', { status: 404 }))],
      ['a 500', () => Promise.resolve(new Response('{}', { status: 500 }))],
      ['an answer that is not a PDF', () => Promise.resolve(pdfResponse({ type: 'text/html' }))]
    ])('%s closes the window and says so', async (_name, answer) => {
      const popup = fakePopup()
      state.open.mockReturnValue(popup)
      state.fetch.mockImplementation(answer)
      const wrapper = await withRow()

      await printButton(wrapper).trigger('click')
      await settle()

      expect(popup.close).toHaveBeenCalledTimes(1)
      expect(popup.location.href).toBe('')
      expect(URL.createObjectURL).not.toHaveBeenCalled()
      expect(state.toastAdd).toHaveBeenCalledWith(expect.objectContaining({ color: 'error' }))
    })

    it('does not close the detail, does not reload the history and frees the button', async () => {
      const popup = fakePopup()
      state.open.mockReturnValue(popup)
      state.fetch.mockRejectedValue(new TypeError('Failed to fetch'))
      const wrapper = await withRow()
      await wrapper.find('[data-testid="prescription-row-view"]').trigger('click')
      await settle()
      expect($('prescription-detail-number')).not.toBeNull()
      const listCalls = state.get.mock.calls.filter(c => c[0] === '/api/v1/prescriptions').length

      ;($('prescription-detail-print') as HTMLElement).click()
      await settle()

      expect($('prescription-detail-number')).not.toBeNull()
      expect(state.get.mock.calls.filter(c => c[0] === '/api/v1/prescriptions').length).toBe(listCalls)
      expect(wrapper.findAll('[data-testid^="prescription-row-"][data-status]')).toHaveLength(1)
      expect(printButton(wrapper).attributes('disabled')).toBeUndefined()
    })
  })

  describe('when the browser blocks the window', () => {
    function captureAnchors() {
      const anchors: Array<{ download: string, href: string }> = []
      const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
        anchors.push({ download: this.download, href: this.href })
      })
      return { anchors, click }
    }

    it('still fetches, then downloads the PDF with the name the server gave it', async () => {
      state.open.mockReturnValue(null)
      state.fetch.mockImplementation(async () => pdfResponse())
      const { anchors, click } = captureAnchors()
      const wrapper = await withRow()

      await printButton(wrapper).trigger('click')
      await settle()

      expect(state.fetch).toHaveBeenCalledTimes(1)
      expect(anchors).toEqual([{ download: 'receta-RX-2026-000004.pdf', href: 'blob:fake-1' }])
      expect(body().querySelector('a[download]')).toBeNull()
      expect(state.toastAdd).toHaveBeenCalledWith(expect.objectContaining({
        color: 'info',
        description: 'El navegador bloqueó la ventana emergente; el PDF se ha descargado.'
      }))
      click.mockRestore()
    })

    it('falls back to a name of its own when the server sent none', async () => {
      state.open.mockReturnValue(null)
      state.fetch.mockImplementation(async () => pdfResponse({ disposition: null }))
      const { anchors, click } = captureAnchors()
      const wrapper = await withRow()

      await printButton(wrapper).trigger('click')
      await settle()

      expect(anchors[0]!.download).toBe('receta-RX-2026-000004.pdf')
      click.mockRestore()
    })

    it('never uses a file name that could climb out of the downloads folder', async () => {
      state.open.mockReturnValue(null)
      state.fetch.mockImplementation(async () =>
        pdfResponse({ disposition: 'inline; filename="../../evil name.pdf"' }))
      const { anchors, click } = captureAnchors()
      const wrapper = await withRow()

      await printButton(wrapper).trigger('click')
      await settle()

      expect(anchors[0]!.download).not.toMatch(/[/\\ ]/)
      expect(anchors[0]!.download.endsWith('.pdf')).toBe(true)
      click.mockRestore()
    })

    it('reports a failure instead of downloading anything', async () => {
      state.open.mockReturnValue(null)
      state.fetch.mockRejectedValue(new TypeError('Failed to fetch'))
      const { anchors, click } = captureAnchors()
      const wrapper = await withRow()

      await printButton(wrapper).trigger('click')
      await settle()

      expect(anchors).toEqual([])
      expect(state.toastAdd).toHaveBeenCalledWith(expect.objectContaining({ color: 'error' }))
      click.mockRestore()
    })
  })

  describe('a double click', () => {
    it('renders once: one window, one request', async () => {
      const pending = deferred<Response>()
      state.open.mockReturnValue(fakePopup())
      state.fetch.mockReturnValue(pending.promise)
      const wrapper = await withRow()
      const button = printButton(wrapper).element as HTMLElement

      button.click()
      button.click()
      button.click()

      expect(state.open).toHaveBeenCalledTimes(1)
      expect(state.fetch).toHaveBeenCalledTimes(1)
      await nextTick()
      expect(printButton(wrapper).attributes('disabled')).toBeDefined()

      pending.resolve(pdfResponse())
      await settle()
      expect(state.fetch).toHaveBeenCalledTimes(1)
      expect(printButton(wrapper).attributes('disabled')).toBeUndefined()
    })

    it('can be printed again once it finished', async () => {
      state.open.mockImplementation(() => fakePopup())
      state.fetch.mockImplementation(async () => pdfResponse())
      const wrapper = await withRow()

      await printButton(wrapper).trigger('click')
      await settle()
      await printButton(wrapper).trigger('click')
      await settle()

      expect(state.fetch).toHaveBeenCalledTimes(2)
    })

    it('the same prescription from the dialog and from the row counts as one', async () => {
      const pending = deferred<Response>()
      state.open.mockReturnValue(fakePopup())
      state.fetch.mockReturnValue(pending.promise)
      const wrapper = await withRow()
      await wrapper.find('[data-testid="prescription-row-view"]').trigger('click')
      await settle()

      ;(printButton(wrapper).element as HTMLElement).click()
      ;($('prescription-detail-print') as HTMLElement).click()

      expect(state.fetch).toHaveBeenCalledTimes(1)
      pending.resolve(pdfResponse())
      await settle()
    })
  })

  describe('the blob URLs', () => {
    it('are released when the view goes away', async () => {
      state.open.mockImplementation(() => fakePopup())
      state.fetch.mockImplementation(async () => pdfResponse())
      const wrapper = await withRow()
      for (let i = 0; i < 3; i++) {
        await printButton(wrapper).trigger('click')
        await settle()
      }
      expect(URL.revokeObjectURL).not.toHaveBeenCalled()

      wrapper.unmount()
      mounted.pop()

      const revoked = (URL.revokeObjectURL as unknown as ReturnType<typeof vi.fn>).mock.calls.map(c => c[0])
      expect(revoked).toEqual(['blob:fake-1', 'blob:fake-2', 'blob:fake-3'])
    })

    it('are released when the patient changes', async () => {
      state.open.mockImplementation(() => fakePopup())
      state.fetch.mockImplementation(async () => pdfResponse())
      const wrapper = await withRow()
      await printButton(wrapper).trigger('click')
      await settle()

      await wrapper.setProps({ ctx: { patientId: 'p2' } })
      await settle()

      expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:fake-1')
    })

    it('do not pile up without limit: past ten, the oldest is released', async () => {
      state.open.mockImplementation(() => fakePopup())
      state.fetch.mockImplementation(async () => pdfResponse())
      const wrapper = await withRow()
      for (let i = 0; i < 12; i++) {
        await printButton(wrapper).trigger('click')
        await settle()
      }

      const revoked = (URL.revokeObjectURL as unknown as ReturnType<typeof vi.fn>).mock.calls.map(c => c[0])
      expect(revoked).toEqual(['blob:fake-1', 'blob:fake-2'])

      wrapper.unmount()
      mounted.pop()
      expect((URL.revokeObjectURL as unknown as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(12)
    })

    it('the download case registers its URL too', async () => {
      state.open.mockReturnValue(null)
      state.fetch.mockImplementation(async () => pdfResponse())
      const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
      const wrapper = await withRow()
      await printButton(wrapper).trigger('click')
      await settle()

      wrapper.unmount()
      mounted.pop()
      expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:fake-1')
      click.mockRestore()
    })
  })

  describe('when the patient changes meanwhile', () => {
    it('drops the answer: closes the window, creates no URL, shows no error', async () => {
      const popup = fakePopup()
      const pending = deferred<Response>()
      state.open.mockReturnValue(popup)
      state.fetch.mockReturnValue(pending.promise)
      const wrapper = await withRow()

      ;(printButton(wrapper).element as HTMLElement).click()
      await wrapper.setProps({ ctx: { patientId: 'p2' } })
      await settle()
      pending.resolve(pdfResponse())
      await settle()

      expect(popup.close).toHaveBeenCalled()
      expect(popup.location.href).toBe('')
      expect(URL.createObjectURL).not.toHaveBeenCalled()
      expect(state.toastAdd).not.toHaveBeenCalled()
    })

    it('aborts the request that was running', async () => {
      state.open.mockReturnValue(fakePopup())
      state.fetch.mockReturnValue(new Promise(() => {}))
      const wrapper = await withRow()

      ;(printButton(wrapper).element as HTMLElement).click()
      const signal = state.fetch.mock.calls[0]![1].signal as AbortSignal
      expect(signal.aborted).toBe(false)

      await wrapper.setProps({ ctx: { patientId: 'p2' } })
      expect(signal.aborted).toBe(true)
    })
  })
})

describe('the Content-Disposition file name', () => {
  it.each([
    ['inline; filename="receta-RX-2026-000004.pdf"', 'receta-RX-2026-000004.pdf'],
    ['attachment; filename=receta-RX-2026-000004.pdf', 'receta-RX-2026-000004.pdf'],
    ['inline; filename="../../x/receta.pdf"', '..-..-x-receta.pdf'],
    ['inline; filename="a b.pdf"', 'a-b.pdf']
  ])('%s -> %s', (header, expected) => {
    expect(filenameFromDisposition(header)).toBe(expected)
  })

  it.each([null, '', 'inline', 'inline; filename="notes.txt"'])('%j -> nothing usable', (header) => {
    expect(filenameFromDisposition(header)).toBeNull()
  })
})

// ===========================================================================
// the layer itself
// ===========================================================================

describe('the layer', () => {
  const walk = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap(entry =>
      entry.isDirectory() ? walk(resolve(dir, entry.name)) : [resolve(dir, entry.name)])
  const sources = walk(MODULE).filter(f => /\.(vue|ts)$/.test(f))

  it('never edits or deletes: no PUT, PATCH or DELETE, ever', () => {
    expect(sources.length).toBeGreaterThanOrEqual(6)
    for (const file of sources) {
      const text = readFileSync(file, 'utf8')
      expect(text, file).not.toMatch(/\.(put|patch|del)\(/)
      expect(text, file).not.toMatch(/method:\s*['"](PUT|PATCH|DELETE)['"]/i)
    }
  })

  it('does not read the Clinical tab\'s readonly flag', () => {
    for (const file of sources) {
      // it may be mentioned in a comment to explain why it is ignored, never used
      const code = readFileSync(file, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/<!--[\s\S]*?-->/g, '')
        .replace(/^\s*\/\/.*$/gm, '')
      expect(code, file).not.toMatch(/\.readonly\b/)
    }
  })

  it('every string it asks for exists in all five languages', () => {
    const keys = new Set<string>()
    for (const file of sources.filter(f => f.endsWith('.vue'))) {
      const text = readFileSync(file, 'utf8')
      for (const match of text.matchAll(/\bt\('(prescriptions\.[A-Za-z.]+)'/g)) keys.add(match[1]!)
      if (/t\(`prescriptions\.status\.\$\{/.test(text)) {
        keys.add('prescriptions.status.issued')
        keys.add('prescriptions.status.voided')
      }
    }
    expect(keys.size).toBeGreaterThan(30)

    const lookup = (messages: Record<string, unknown>, key: string) =>
      key.split('.').reduce<unknown>((node, part) =>
        (node && typeof node === 'object' ? (node as Record<string, unknown>)[part] : undefined), messages)
    for (const code of ['es', 'en', 'fr', 'pt', 'ta']) {
      const messages = readLocale(code)
      for (const key of keys) {
        expect(typeof lookup(messages, key), `${code}: ${key}`).toBe('string')
      }
    }
  })

  it('the five languages have exactly the same keys', () => {
    const flat = (node: unknown, prefix = ''): string[] =>
      node && typeof node === 'object'
        ? Object.entries(node).flatMap(([k, v]) => flat(v, `${prefix}${k}.`))
        : [prefix]
    const base = flat(readLocale('es')).sort()
    for (const code of ['en', 'fr', 'pt', 'ta']) {
      expect(flat(readLocale(code)).sort(), code).toEqual(base)
    }
  })
})
