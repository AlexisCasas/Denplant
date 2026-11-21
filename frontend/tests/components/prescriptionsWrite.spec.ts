/**
 * Recetas, Phase D: issue a prescription and void one, through the real
 * components.
 *
 * `useApi`, `useAuth`, `usePermissions`, `useNuxtData`, `useToast` and
 * `useI18n` are doubled; `useI18n` answers from the module's real `es.json`.
 * The reading side (history, detail, PDF) is in `prescriptionsView.spec.ts`.
 */

import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'

import PrescriptionsView from '../../../backend/app/modules/prescriptions/frontend/components/PrescriptionsView.vue'
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
    post: vi.fn(),
    fetch: vi.fn(),
    open: vi.fn(),
    refresh: vi.fn(),
    toastAdd: vi.fn(),
    role: 'dentist' as string | null,
    user: { id: 'u1', first_name: 'María', last_name: 'García', professional_id: '28/12345' as string | undefined },
    permissions: new Set<string>(),
    cache: null as unknown,
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

mockNuxtImport('useApi', () => () => ({ get: state.get, post: state.post }))
mockNuxtImport('useAuth', () => () => ({
  accessToken: { value: 'tok' },
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
  locale: { value: 'es' }
}))

// ---------------------------------------------------------------------------
// builders and helpers
// ---------------------------------------------------------------------------

const PRESCRIBE = 'prescriptions.prescribe'
const VOID = 'prescriptions.void'
const READ = 'prescriptions.read'

function listItem(id: string, over: Partial<PrescriptionListItem> = {}): PrescriptionListItem {
  return {
    id,
    number: `RX-2026-${id.padStart(6, '0')}`,
    issued_at: '2026-10-03T22:33:18.146773Z',
    issue_date: '2026-10-03',
    valid_until: '2026-10-10',
    prescriber_name_snapshot: 'María García',
    item_count: 1,
    status: 'issued',
    voided_at: null,
    ...over
  }
}

function detailOf(id: string, over: Partial<PrescriptionDetail> = {}): PrescriptionDetail {
  return {
    id,
    clinic_id: 'clinic-1',
    patient_id: 'p1',
    prescriber_user_id: 'u1',
    number: `RX-2026-${id.padStart(6, '0')}`,
    sequence: Number(id) || 1,
    year: 2026,
    issued_at: '2026-10-03T22:33:18.146773Z',
    issue_date: '2026-10-03',
    valid_until: '2026-10-10',
    status: 'issued',
    voided_at: null,
    voided_by: null,
    void_reason: null,
    patient_name_snapshot: 'Manuel Castro',
    patient_national_id_snapshot: '45678912',
    patient_national_id_type_snapshot: 'dni',
    patient_date_of_birth_snapshot: '1945-11-19',
    prescriber_name_snapshot: 'María García',
    prescriber_professional_id_snapshot: '28/12345',
    clinic_name_snapshot: 'Clínica Demo',
    clinic_legal_name_snapshot: null,
    clinic_tax_id_snapshot: 'B12345678',
    clinic_address_snapshot: null,
    clinic_phone_snapshot: null,
    items: [{
      id: 'i1',
      position: 1,
      active_ingredient: 'Amoxicilina',
      strength: '500 mg',
      pharmaceutical_form: 'Cápsula',
      dose: '1',
      route: 'Oral',
      frequency: '8 h',
      duration: '7 días',
      total_quantity: '21',
      commercial_name: null,
      presentation: null,
      instructions: null
    }],
    ...over
  } as PrescriptionDetail
}

function envelope(rows: PrescriptionListItem[], total = rows.length, page = 1) {
  return { data: rows, total, page, page_size: 10, message: null }
}

function failure(status: number, code: string | null, extra: Record<string, unknown> = {}) {
  return Object.assign(new Error(`HTTP ${status}`), {
    statusCode: status,
    data: code ? { code, message: 'server text that must never be shown', errors: ['x'] } : extra
  })
}

function deferred<T>() {
  let resolveIt!: (value: T) => void
  const promise = new Promise<T>((res) => {
    resolveIt = res
  })
  return { promise, resolve: resolveIt }
}

async function settle() {
  for (let i = 0; i < 3; i++) {
    await nextTick()
    await new Promise(resolve => setTimeout(resolve, 0))
  }
}

const mounted: Array<{ unmount: () => void }> = []

async function mountView(patientId = 'p1', readonly?: boolean) {
  const wrapper = await mountSuspended(PrescriptionsView, {
    props: { ctx: { patientId, readonly } }
  })
  mounted.push(wrapper)
  await settle()
  return wrapper
}

type Wrapper = Awaited<ReturnType<typeof mountView>>

const $ = (testid: string) => document.querySelector<HTMLElement>(`[data-testid="${testid}"]`)
const click = async (testid: string) => {
  const element = $(testid)
  if (!element) throw new Error(`no ${testid}`)
  element.click()
  await settle()
}

/** Type into the input or textarea inside the element with this test id. */
async function type(testid: string, value: string) {
  const field = $(testid)?.querySelector<HTMLInputElement | HTMLTextAreaElement>('input, textarea')
  if (!field) throw new Error(`no field in ${testid}`)
  field.value = value
  field.dispatchEvent(new Event('input', { bubbles: true }))
  await nextTick()
}

const REQUIRED = [
  'active_ingredient', 'strength', 'pharmaceutical_form', 'dose',
  'route', 'frequency', 'duration', 'total_quantity'
] as const

async function fillItem(n: number, over: Record<string, string> = {}) {
  const values: Record<string, string> = {
    active_ingredient: `Medicamento ${n}`,
    strength: '500 mg',
    pharmaceutical_form: 'Tableta',
    dose: '1 tableta',
    route: 'Vía oral',
    frequency: 'Cada 8 horas',
    duration: '7 días',
    total_quantity: '21 tabletas',
    ...over
  }
  for (const [field, value] of Object.entries(values)) {
    await type(`prescription-item-${n}-${field}`, value)
  }
}

async function fillValid(validUntil = '2026-10-31') {
  await type('prescription-create-valid-until', validUntil)
  await fillItem(1)
}

async function openForm(wrapper: Wrapper) {
  await wrapper.find('[data-testid="prescription-new"]').trigger('click')
  await settle()
}

function apiRoutes(rows: PrescriptionListItem[] = [], detail?: PrescriptionDetail) {
  state.get.mockImplementation(async (url: string) => {
    if (url === '/api/v1/prescriptions') return envelope(rows)
    return { data: detail ?? detailOf('4'), message: null }
  })
}

const postCalls = () => state.post.mock.calls
const issuePosts = () => postCalls().filter(c => c[0] === '/api/v1/prescriptions')
const voidPosts = () => postCalls().filter(c => String(c[0]).endsWith('/void'))

const mountedForms = () => document.querySelectorAll('[data-testid="prescription-create"]').length

beforeEach(() => {
  state.messages = { ...readLocale('es'), common: { error: 'Error' } }
  state.role = 'dentist'
  state.user = { id: 'u1', first_name: 'María', last_name: 'García', professional_id: '28/12345' }
  state.permissions = new Set([READ, PRESCRIBE, VOID])
  state.cache = { first_name: 'Manuel', last_name: 'Castro', date_of_birth: '1945-11-19' }
  for (const fn of [state.get, state.post, state.fetch, state.open, state.refresh, state.toastAdd]) fn.mockReset()
  state.get.mockResolvedValue(envelope([]))
  useState('clinic:current').value = { id: 'c1', name: 'Clínica Demo' }
  vi.stubGlobal('fetch', state.fetch)
})

afterEach(async () => {
  while (mounted.length) mounted.pop()?.unmount()
  await nextTick()
  vi.unstubAllGlobals()
})

// ===========================================================================
// who sees "Nueva receta"
// ===========================================================================

describe('Nueva receta: who sees it', () => {
  const newButton = (wrapper: Wrapper) => wrapper.find('[data-testid="prescription-new"]')

  it('a dentist with the permission and a registration number gets an enabled button', async () => {
    const wrapper = await mountView()

    expect(newButton(wrapper).exists()).toBe(true)
    expect(newButton(wrapper).text()).toBe('Nueva receta')
    expect(newButton(wrapper).attributes('disabled')).toBeUndefined()
    expect(wrapper.find('[data-testid="prescription-new-notice"]').exists()).toBe(false)
  })

  it('an admin does not, although the * wildcard gives them prescriptions.prescribe', async () => {
    state.role = 'admin'
    state.permissions = new Set(['*', READ, PRESCRIBE, VOID])

    expect((await mountView()).find('[data-testid="prescription-new"]').exists()).toBe(false)
  })

  it.each(['hygienist', 'receptionist', 'assistant'])('a %s does not, even holding the permission', async (role) => {
    state.role = role

    expect((await mountView()).find('[data-testid="prescription-new"]').exists()).toBe(false)
  })

  it('a dentist without the permission does not', async () => {
    state.permissions = new Set([READ])

    expect((await mountView()).find('[data-testid="prescription-new"]').exists()).toBe(false)
  })

  it('nobody gets it while the role is unknown', async () => {
    state.role = null

    expect((await mountView()).find('[data-testid="prescription-new"]').exists()).toBe(false)
  })

  it.each([undefined, '', '   '])('a dentist with registration number %j sees it disabled, with the reason', async (professionalId) => {
    state.user = { ...state.user, professional_id: professionalId }
    const wrapper = await mountView()

    expect(newButton(wrapper).exists()).toBe(true)
    expect(newButton(wrapper).attributes('disabled')).toBeDefined()
    const notice = wrapper.find('[data-testid="prescription-new-notice"]')
    expect(notice.text()).toBe('Tu colegiatura no está registrada. Contacta al administrador.')
    expect(notice.attributes('role')).toBe('status')
    expect(newButton(wrapper).attributes('aria-describedby')).toBe(notice.attributes('id'))
  })

  it('clicking the disabled button opens nothing', async () => {
    state.user = { ...state.user, professional_id: '' }
    const wrapper = await mountView()

    await newButton(wrapper).trigger('click')
    await settle()

    expect(mountedForms()).toBe(0)
  })

  it.each([true, false, undefined])('the Clinical tab\'s readonly flag (%j) changes nothing', async (readonly) => {
    const wrapper = await mountView('p1', readonly)

    expect(newButton(wrapper).exists()).toBe(true)
    expect(newButton(wrapper).attributes('disabled')).toBeUndefined()
  })
})

// ===========================================================================
// the date of birth, from the patient page's cache
// ===========================================================================

describe('Nueva receta: date of birth', () => {
  it('a cached patient with a date of birth may be prescribed for', async () => {
    const wrapper = await mountView()
    expect(wrapper.find('[data-testid="prescription-new"]').attributes('disabled')).toBeUndefined()
  })

  it('a cached patient without one blocks the form and says why', async () => {
    state.cache = { first_name: 'Manuel', last_name: 'Castro', date_of_birth: undefined }
    const wrapper = await mountView()

    expect(wrapper.find('[data-testid="prescription-new"]').attributes('disabled')).toBeDefined()
    expect(wrapper.find('[data-testid="prescription-new-notice"]').text())
      .toBe('Complete la fecha de nacimiento del paciente antes de emitir una receta.')

    await wrapper.find('[data-testid="prescription-new"]').trigger('click')
    await settle()
    expect(mountedForms()).toBe(0)
  })

  it('no cached patient is not a "no": the form opens and the backend decides', async () => {
    state.cache = null
    const wrapper = await mountView()

    expect(wrapper.find('[data-testid="prescription-new"]').attributes('disabled')).toBeUndefined()
    await openForm(wrapper)
    expect(mountedForms()).toBe(1)
  })

  it('asks for no age and fetches no patient', async () => {
    const wrapper = await mountView()
    await openForm(wrapper)

    expect(state.get.mock.calls.every(call => String(call[0]).startsWith('/api/v1/prescriptions'))).toBe(true)
    expect(document.body.textContent).not.toMatch(/\bedad\b/i)
  })

  it('a backend date-of-birth refusal keeps the draft and says what to do', async () => {
    state.cache = null
    state.post.mockRejectedValue(failure(422, 'patient_date_of_birth_required'))
    const wrapper = await mountView()
    await openForm(wrapper)
    await fillValid()
    await click('prescription-create-review')
    await click('prescription-create-submit')

    expect($('prescription-create-error')!.textContent)
      .toContain('Complete la fecha de nacimiento del paciente antes de emitir una receta.')
    expect($('prescription-item-1-active_ingredient')!.querySelector('input')!.value).toBe('Medicamento 1')
  })
})

// ===========================================================================
// the form
// ===========================================================================

describe('the new-prescription form', () => {
  it('opens with a read-only header: patient, dentist, registration number, clinic', async () => {
    await openForm(await mountView())

    expect($('prescription-create-patient')!.textContent!.trim()).toBe('Manuel Castro')
    expect($('prescription-create-prescriber')!.textContent!.trim()).toBe('María García')
    expect($('prescription-create-professional-id')!.textContent!.trim()).toBe('28/12345')
    expect($('prescription-create-clinic')!.textContent!.trim()).toBe('Clínica Demo')
    // text, not controls: the only inputs are the validity and the medication
    for (const id of ['patient', 'prescriber', 'professional-id', 'clinic']) {
      expect($(`prescription-create-${id}`)!.querySelector('input, textarea, select')).toBeNull()
    }
  })

  it('leaves the patient out of the header when there is no cached record', async () => {
    state.cache = null
    await openForm(await mountView())

    expect($('prescription-create-patient')).toBeNull()
    expect($('prescription-create-prescriber')).not.toBeNull()
  })

  it('has a heading and a description', async () => {
    await openForm(await mountView())

    const dialog = $('prescription-create')!.closest('[role="dialog"]')!
    expect(dialog.textContent).toContain('Nueva receta')
    expect(dialog.textContent).toContain('Una vez emitida ya no podrá editarse')
  })

  it('valid_until starts empty: no default, no minimum', async () => {
    await openForm(await mountView())

    const input = $('prescription-create-valid-until')!.querySelector('input')!
    expect(input.type).toBe('date')
    expect(input.value).toBe('')
    expect(input.hasAttribute('min')).toBe(false)
    expect(input.hasAttribute('max')).toBe(false)
  })

  it('starts with exactly one empty medication', async () => {
    await openForm(await mountView())

    expect(document.querySelectorAll('[data-testid^="prescription-item-"][data-item-key]')).toHaveLength(1)
    for (const field of REQUIRED) {
      expect($(`prescription-item-1-${field}`)!.querySelector('input')!.value).toBe('')
    }
  })

  it('marks the required fields as required and the others as not', async () => {
    await openForm(await mountView())

    for (const field of REQUIRED) {
      expect($(`prescription-item-1-${field}`)!.querySelector('input')!.required, field).toBe(true)
    }
    for (const field of ['commercial_name', 'presentation']) {
      expect($(`prescription-item-1-${field}`)!.querySelector('input')!.required, field).toBe(false)
    }
    expect($('prescription-create-valid-until')!.querySelector('input')!.required).toBe(true)
  })

  it('limits each field by the backend\'s own maximum', async () => {
    await openForm(await mountView())

    const limits: Record<string, number> = {
      active_ingredient: 200, strength: 100, pharmaceutical_form: 100, dose: 200, route: 100,
      frequency: 200, duration: 100, total_quantity: 100, commercial_name: 200, presentation: 200
    }
    for (const [field, max] of Object.entries(limits)) {
      expect($(`prescription-item-1-${field}`)!.querySelector('input')!.maxLength, field).toBe(max)
    }
    expect($('prescription-item-1-instructions')!.querySelector('textarea')!.maxLength).toBe(4000)
  })

  it('counts the instructions', async () => {
    await openForm(await mountView())
    expect($('prescription-item-1-instructions')!.textContent).toContain('0/4000')

    await type('prescription-item-1-instructions', 'Con agua')

    expect($('prescription-item-1-instructions')!.textContent).toContain('8/4000')
  })

  it('offers no search, suggestions, calculation or warnings', async () => {
    await openForm(await mountView())

    const text = $('prescription-create')!.textContent!
    expect(text).not.toMatch(/buscar|vadem[eé]cum|sugerenc|calcular|interacci[oó]n|contraindicaci|alergia/i)
    expect($('prescription-create')!.querySelector('datalist, [role="listbox"], [role="combobox"]')).toBeNull()
  })

  describe('medications', () => {
    it('adds one, numbered, and removes it by name', async () => {
      await openForm(await mountView())
      await click('prescription-create-add')

      expect(document.querySelectorAll('[data-item-key]')).toHaveLength(2)
      expect($('prescription-item-2')!.textContent).toContain('Medicamento 2')
      expect($('prescription-item-2-remove')!.getAttribute('aria-label')).toBe('Eliminar medicamento 2')

      await click('prescription-item-2-remove')
      expect(document.querySelectorAll('[data-item-key]')).toHaveLength(1)
    })

    it('never lets the last one go', async () => {
      await openForm(await mountView())

      expect($('prescription-item-1-remove')).toBeNull()
      await click('prescription-create-add')
      expect($('prescription-item-1-remove')).not.toBeNull()
      await click('prescription-item-2-remove')
      expect($('prescription-item-1-remove')).toBeNull()
      expect(document.querySelectorAll('[data-item-key]')).toHaveLength(1)
    })

    it('removing one keeps the others\' text, in order', async () => {
      await openForm(await mountView())
      await click('prescription-create-add')
      await click('prescription-create-add')
      await fillItem(1, { active_ingredient: 'Primero' })
      await fillItem(2, { active_ingredient: 'Segundo' })
      await fillItem(3, { active_ingredient: 'Tercero' })

      await click('prescription-item-2-remove')

      expect($('prescription-item-1-active_ingredient')!.querySelector('input')!.value).toBe('Primero')
      expect($('prescription-item-2-active_ingredient')!.querySelector('input')!.value).toBe('Tercero')
    })

    it('puts the cursor in the new medication\'s first field', async () => {
      await openForm(await mountView())
      await click('prescription-create-add')

      const first = $('prescription-item-2-active_ingredient')!.querySelector('input')
      expect(document.activeElement).toBe(first)
    })

    it('stops at fifty and says so', async () => {
      await openForm(await mountView())
      for (let i = 0; i < 60; i++) {
        const add = $('prescription-create-add') as HTMLButtonElement
        if (add.disabled) break
        add.click()
        await nextTick()
      }
      await settle()

      expect(document.querySelectorAll('[data-item-key]')).toHaveLength(50)
      expect(($('prescription-create-add') as HTMLButtonElement).disabled).toBe(true)
      expect($('prescription-create-max')!.textContent).toContain('50')
    })

    it('stays usable with ten: every one is its own labelled group in a scrolling body', async () => {
      await openForm(await mountView())
      for (let i = 0; i < 9; i++) await click('prescription-create-add')

      const cards = document.querySelectorAll('[data-item-key]')
      expect(cards).toHaveLength(10)
      for (const card of cards) {
        expect(card.getAttribute('aria-labelledby')).toBeTruthy()
        expect(card.querySelector('h4')).not.toBeNull()
        expect(card.className).toMatch(/\bborder\b/)
      }
      expect($('prescription-create')!.className).toContain('overflow-y-auto')
      expect($('prescription-create')!.className).toContain('max-h-')
      // single column on a phone, two from sm up; never a table
      expect(document.querySelector('[data-item-key] .grid-cols-1.sm\\:grid-cols-2')).not.toBeNull()
      expect($('prescription-create')!.querySelector('table')).toBeNull()
    })
  })

  describe('validation before the confirmation', () => {
    it('refuses an empty form: no confirmation, no request, and says where', async () => {
      await openForm(await mountView())

      await click('prescription-create-review')

      expect($('prescription-create-confirm')).toBeNull()
      expect(postCalls()).toHaveLength(0)
      expect($('prescription-create-summary')!.textContent).toContain('Revise los campos marcados.')
      expect($('prescription-create-valid-until')!.textContent).toContain('Indique hasta qué fecha')
      expect($('prescription-item-1-active_ingredient')!.textContent).toContain('Este campo es obligatorio.')
      expect(document.querySelector('[aria-invalid="true"]')).not.toBeNull()
    })

    it('moves the cursor to the first mistake', async () => {
      await openForm(await mountView())
      await type('prescription-create-valid-until', '2026-10-31')

      await click('prescription-create-review')

      expect(document.activeElement).toBe($('prescription-item-1-active_ingredient')!.querySelector('input'))
    })

    it('treats whitespace as empty', async () => {
      await openForm(await mountView())
      await fillValid()
      await type('prescription-item-1-dose', '    ')

      await click('prescription-create-review')

      expect($('prescription-create-confirm')).toBeNull()
      expect($('prescription-item-1-dose')!.textContent).toContain('Este campo es obligatorio.')
    })

    it('a date the calendar does not have is not accepted', async () => {
      await openForm(await mountView())
      await fillValid('2026-02-31')

      await click('prescription-create-review')

      expect($('prescription-create-confirm')).toBeNull()
    })

    it('does not compare the validity with today: any real day goes on', async () => {
      await openForm(await mountView())
      await fillValid('1999-01-01')

      await click('prescription-create-review')

      expect($('prescription-create-confirm')).not.toBeNull()
    })

    it('clears a mistake as soon as it is fixed', async () => {
      await openForm(await mountView())
      await click('prescription-create-review')
      expect($('prescription-create-valid-until')!.textContent).toContain('Indique hasta qué fecha')

      await type('prescription-create-valid-until', '2026-10-31')

      expect($('prescription-create-valid-until')!.textContent).not.toContain('Indique hasta qué fecha')
    })
  })

  describe('closing', () => {
    it('an untouched form closes at once', async () => {
      await openForm(await mountView())

      await click('prescription-create-cancel')

      expect(mountedForms()).toBe(0)
    })

    it('a form with text asks first, and keeping it changes nothing', async () => {
      await openForm(await mountView())
      await fillValid()

      await click('prescription-create-cancel')

      expect($('prescription-create-discard')!.textContent).toContain('¿Descartar la receta?')
      expect($('prescription-create-discard')!.textContent).toContain('Se perderán los cambios.')
      expect(mountedForms()).toBe(1)

      await click('prescription-create-keep')
      expect($('prescription-create-discard')).toBeNull()
      expect($('prescription-item-1-active_ingredient')!.querySelector('input')!.value).toBe('Medicamento 1')
    })

    it('discarding closes it and the next one starts empty', async () => {
      const wrapper = await mountView()
      await openForm(wrapper)
      await fillValid()
      await click('prescription-create-cancel')

      await click('prescription-create-discard-confirm')
      expect(mountedForms()).toBe(0)

      await openForm(wrapper)
      expect($('prescription-create-valid-until')!.querySelector('input')!.value).toBe('')
      expect($('prescription-item-1-active_ingredient')!.querySelector('input')!.value).toBe('')
    })

    it('adding a second medication already counts as a change', async () => {
      await openForm(await mountView())
      await click('prescription-create-add')

      await click('prescription-create-cancel')

      expect($('prescription-create-discard')).not.toBeNull()
    })

    it('stores nothing: no local storage, no session storage, no request', async () => {
      const local = vi.spyOn(Storage.prototype, 'setItem')
      const wrapper = await mountView()
      await openForm(wrapper)
      await fillValid()
      await click('prescription-create-cancel')
      await click('prescription-create-discard-confirm')

      expect(local).not.toHaveBeenCalled()
      expect(postCalls()).toHaveLength(0)
      local.mockRestore()
    })
  })

  describe('another patient', () => {
    it('closes the form and drops the draft at once, without asking', async () => {
      const wrapper = await mountView('pA')
      await openForm(wrapper)
      await fillValid()
      expect(mountedForms()).toBe(1)

      await wrapper.setProps({ ctx: { patientId: 'pB' } })
      await settle()

      expect(mountedForms()).toBe(0)
      expect($('prescription-create-discard')).toBeNull()

      await openForm(wrapper)
      expect($('prescription-item-1-active_ingredient')!.querySelector('input')!.value).toBe('')
      expect(issuePosts()).toHaveLength(0)
    })

    it('a request already sent for the old patient does not touch the new one', async () => {
      const pending = deferred<unknown>()
      state.post.mockReturnValue(pending.promise)
      const wrapper = await mountView('pA')
      await openForm(wrapper)
      await fillValid()
      await click('prescription-create-review')
      await click('prescription-create-submit')
      expect(issuePosts()).toHaveLength(1)

      await wrapper.setProps({ ctx: { patientId: 'pB' } })
      await settle()
      pending.resolve({ data: detailOf('9', { patient_id: 'pA' }), message: null })
      await settle()

      expect(document.querySelector('[data-testid="prescription-detail-number"]')).toBeNull()
      expect(state.toastAdd).not.toHaveBeenCalled()
    })
  })
})

// ===========================================================================
// the confirmation and the request
// ===========================================================================

describe('issuing', () => {
  async function ready(wrapper: Wrapper) {
    await openForm(wrapper)
    await fillValid()
  }

  it('asks before sending anything: the first "Emitir receta" only reaches the confirmation', async () => {
    const wrapper = await mountView()
    await ready(wrapper)

    await click('prescription-create-review')

    expect(issuePosts()).toHaveLength(0)
    const dialog = $('prescription-create-confirm')!
    expect(dialog.querySelector('h3')!.textContent).toContain('Confirmar emisión')
    expect(dialog.textContent).toContain('Al emitir la receta ya no podrá editarse.')
    expect(dialog.textContent).toContain('Si necesita corregirla deberá anularla y emitir una nueva.')
  })

  it('offers Volver and Emitir receta there, and Volver returns to the untouched form', async () => {
    await ready(await mountView())
    await click('prescription-create-review')

    expect($('prescription-create-back')!.textContent!.trim()).toBe('Volver')
    expect($('prescription-create-submit')!.textContent!.trim()).toBe('Emitir receta')

    await click('prescription-create-back')

    expect($('prescription-create-confirm')).toBeNull()
    expect($('prescription-item-1-active_ingredient')!.querySelector('input')!.value).toBe('Medicamento 1')
    expect(issuePosts()).toHaveLength(0)
  })

  it('confirming sends exactly patient_id, valid_until and items', async () => {
    state.post.mockResolvedValue({ data: detailOf('4'), message: null })
    const wrapper = await mountView('p7')
    await ready(wrapper)
    await click('prescription-create-review')

    await click('prescription-create-submit')

    expect(issuePosts()).toHaveLength(1)
    const [url, body, options] = issuePosts()[0]!
    expect(url).toBe('/api/v1/prescriptions')
    expect(Object.keys(body).sort()).toEqual(['items', 'patient_id', 'valid_until'])
    expect(body.patient_id).toBe('p7')
    expect(body.valid_until).toBe('2026-10-31')
    // a 403 is explained by the form, not by the generic toast as well
    expect(options).toEqual({ silentForbidden: true })
  })

  it('sends the medications trimmed, in order, with empty optionals left out', async () => {
    state.post.mockResolvedValue({ data: detailOf('4'), message: null })
    const wrapper = await mountView()
    await openForm(wrapper)
    await type('prescription-create-valid-until', '2026-10-31')
    await click('prescription-create-add')
    await fillItem(1, { active_ingredient: '  Amoxicilina  ' })
    await fillItem(2, { active_ingredient: 'Ibuprofeno' })
    await type('prescription-item-1-commercial_name', ' Amoxil ')
    await type('prescription-item-1-instructions', '  Con agua  ')
    await type('prescription-item-2-presentation', '   ')
    await click('prescription-create-review')
    await click('prescription-create-submit')

    const { items } = issuePosts()[0]![1]
    expect(items.map((item: { active_ingredient: string }) => item.active_ingredient)).toEqual(['Amoxicilina', 'Ibuprofeno'])
    expect(items[0].commercial_name).toBe('Amoxil')
    expect(items[0].instructions).toBe('Con agua')
    expect(items[0]).not.toHaveProperty('presentation')
    expect(items[1]).not.toHaveProperty('commercial_name')
    expect(items[1]).not.toHaveProperty('presentation')
    expect(items[1]).not.toHaveProperty('instructions')
    expect(Object.keys(items[0]).sort()).toEqual([
      'active_ingredient', 'commercial_name', 'dose', 'duration', 'frequency', 'instructions',
      'pharmaceutical_form', 'route', 'strength', 'total_quantity'
    ])
  })

  it('never sends what the server decides, nor the header it shows', async () => {
    state.post.mockResolvedValue({ data: detailOf('4'), message: null })
    await ready(await mountView())
    await click('prescription-create-review')
    await click('prescription-create-submit')

    const json = JSON.stringify(issuePosts()[0]![1])
    for (const forbidden of [
      'clinic_id', 'prescriber', 'professional', 'number', 'status', 'issued_at', 'issue_date',
      'snapshot', 'voided', '28/12345', 'Clínica Demo', 'Manuel Castro'
    ]) {
      expect(json, forbidden).not.toContain(forbidden)
    }
  })

  it('a double click sends one request and shows progress', async () => {
    const pending = deferred<unknown>()
    state.post.mockReturnValue(pending.promise)
    await ready(await mountView())
    await click('prescription-create-review')
    const submit = $('prescription-create-submit') as HTMLButtonElement

    submit.click()
    submit.click()
    submit.click()
    await settle()

    expect(issuePosts()).toHaveLength(1)
    expect(($('prescription-create-submit') as HTMLButtonElement).disabled).toBe(true)
    expect(($('prescription-create-back') as HTMLButtonElement).disabled).toBe(true)

    pending.resolve({ data: detailOf('4'), message: null })
    await settle()
    expect(issuePosts()).toHaveLength(1)
  })

  it('cannot be closed while the request is running', async () => {
    const pending = deferred<unknown>()
    state.post.mockReturnValue(pending.promise)
    await ready(await mountView())
    await click('prescription-create-review')
    await click('prescription-create-submit')

    await click('prescription-create-back')

    expect(mountedForms()).toBe(1)
    pending.resolve({ data: detailOf('4'), message: null })
    await settle()
  })

  describe('when it works', () => {
    async function issue(options: { rows?: PrescriptionListItem[] } = {}) {
      const created = detailOf('4')
      state.post.mockResolvedValue({ data: created, message: null })
      apiRoutes(options.rows ?? [listItem('4')], created)
      const wrapper = await mountView()
      await ready(wrapper)
      await click('prescription-create-review')
      await click('prescription-create-submit')
      return wrapper
    }

    it('closes the form and forgets the draft', async () => {
      const wrapper = await issue()
      expect(mountedForms()).toBe(0)

      await openForm(wrapper)
      expect($('prescription-create-valid-until')!.querySelector('input')!.value).toBe('')
    })

    it('opens the detail of what was issued, from the response itself', async () => {
      await issue()

      expect($('prescription-detail-number')!.textContent!.trim()).toBe('RX-2026-000004')
      expect($('prescription-detail-status')!.textContent!.trim()).toBe('Emitida')
      // one source of truth: no extra request for the detail
      expect(state.get.mock.calls.filter(c => String(c[0]).endsWith('/4'))).toHaveLength(0)
    })

    it('reloads the history from the first page', async () => {
      const wrapper = await mountView()
      const before = state.get.mock.calls.filter(c => c[0] === '/api/v1/prescriptions').length
      state.post.mockResolvedValue({ data: detailOf('4'), message: null })
      await ready(wrapper)
      await click('prescription-create-review')
      await click('prescription-create-submit')

      const lists = state.get.mock.calls.filter(c => c[0] === '/api/v1/prescriptions')
      expect(lists.length).toBe(before + 1)
      expect(lists.at(-1)![1].query).toEqual({ patient_id: 'p1', page: 1, page_size: 10 })
    })

    it('says so with a toast', async () => {
      await issue()

      expect(state.toastAdd).toHaveBeenCalledWith(expect.objectContaining({
        color: 'success',
        description: 'Receta RX-2026-000004 emitida.'
      }))
    })

    it('does not print anything by itself', async () => {
      await issue()

      expect(state.open).not.toHaveBeenCalled()
      expect(state.fetch).not.toHaveBeenCalled()
    })
  })

  describe('when it fails', () => {
    async function failWith(error: unknown) {
      state.post.mockRejectedValue(error)
      const wrapper = await mountView()
      await ready(wrapper)
      await click('prescription-create-review')
      await click('prescription-create-submit')
      return wrapper
    }

    it('keeps the form open and everything typed, back on the form', async () => {
      await failWith(failure(500, null))

      expect(mountedForms()).toBe(1)
      expect($('prescription-create-confirm')).toBeNull()
      expect($('prescription-create-valid-until')!.querySelector('input')!.value).toBe('2026-10-31')
      expect($('prescription-item-1-active_ingredient')!.querySelector('input')!.value).toBe('Medicamento 1')
      expect($('prescription-detail-number')).toBeNull()
      expect(state.toastAdd).not.toHaveBeenCalled()
    })

    it.each([
      ['prescriber_not_eligible', 403, 'Solo un odontólogo puede emitir recetas.'],
      ['prescriber_professional_id_required', 422, 'Tu colegiatura no está registrada. Contacta al administrador.'],
      ['patient_date_of_birth_required', 422, 'Complete la fecha de nacimiento del paciente antes de emitir una receta.'],
      ['patient_date_of_birth_invalid', 422, 'La fecha de nacimiento del paciente no es válida.'],
      ['clinic_timezone_invalid', 422, 'La clínica no tiene una zona horaria válida. Contacte al administrador.'],
      ['patient_not_found', 404, 'No se encontró al paciente.']
    ])('%s is explained in words', async (code, status, message) => {
      await failWith(failure(status, code))

      const alert = $('prescription-create-error')!
      expect(alert.textContent).toContain(message)
      expect(alert.getAttribute('role')).toBe('alert')
      expect(alert.textContent).not.toContain('server text that must never be shown')
    })

    it('a validity before the issue date is shown on that field', async () => {
      await failWith(failure(422, 'valid_until_before_issue_date'))

      expect($('prescription-create-valid-until')!.textContent)
        .toContain('La vigencia no puede terminar antes del día de emisión.')
      expect($('prescription-create-valid-until')!.querySelector('input')!.getAttribute('aria-invalid')).toBe('true')
      expect($('prescription-create-valid-until')!.querySelector('input')!.value).toBe('2026-10-31')
    })

    it('fixing that date lets the user try again', async () => {
      await failWith(failure(422, 'valid_until_before_issue_date'))
      state.post.mockResolvedValue({ data: detailOf('4'), message: null })

      await type('prescription-create-valid-until', '2026-11-15')
      await click('prescription-create-review')
      await click('prescription-create-submit')

      expect(issuePosts()).toHaveLength(2)
      expect(issuePosts()[1]![1].valid_until).toBe('2026-11-15')
      expect(mountedForms()).toBe(0)
    })

    it('FastAPI\'s validation array becomes "review the fields", not JSON', async () => {
      await failWith(failure(422, null, { detail: [{ loc: ['body', 'items', 0], msg: 'bad', type: 'string_too_short' }] }))

      expect($('prescription-create-error')!.textContent).toContain('Revise los campos de la receta.')
      expect(document.body.textContent).not.toContain('string_too_short')
    })

    it.each([
      ['a server error', failure(500, null)],
      ['a network error', new TypeError('Failed to fetch')],
      ['an unknown code', failure(400, 'something_new')]
    ])('%s is a generic message', async (_name, error) => {
      await failWith(error)

      expect($('prescription-create-error')!.textContent).toContain('No se pudo emitir la receta. Inténtelo de nuevo.')
    })

    it('can be retried without retyping', async () => {
      await failWith(failure(500, null))
      state.post.mockResolvedValue({ data: detailOf('4'), message: null })

      await click('prescription-create-review')
      await click('prescription-create-submit')

      expect(issuePosts()).toHaveLength(2)
      expect(issuePosts()[1]![1]).toEqual(issuePosts()[0]![1])
      expect(mountedForms()).toBe(0)
    })

    it('a second try does not show the previous error', async () => {
      await failWith(failure(500, null))
      state.post.mockReturnValue(new Promise(() => {}))

      await click('prescription-create-review')
      await click('prescription-create-submit')

      expect($('prescription-create-error')).toBeNull()
    })
  })
})

// ===========================================================================
// voiding
// ===========================================================================

describe('Anular receta: who sees it', () => {
  async function openDetail(over: Partial<PrescriptionDetail> = {}) {
    apiRoutes([listItem('4')], detailOf('4', over))
    const wrapper = await mountView()
    await wrapper.find('[data-testid="prescription-row-view"]').trigger('click')
    await settle()
    return wrapper
  }
  const voidButton = () => $('prescription-detail-void-action')

  it('the dentist who issued it', async () => {
    await openDetail()
    expect(voidButton()).not.toBeNull()
    expect(voidButton()!.textContent!.trim()).toBe('Anular receta')
    expect(voidButton()!.getAttribute('aria-label')).toBe('Anular la receta RX-2026-000004')
  })

  it('not another dentist, even with the void permission', async () => {
    await openDetail({ prescriber_user_id: 'someone-else' })
    expect(voidButton()).toBeNull()
  })

  it('an admin, even for somebody else\'s prescription', async () => {
    state.role = 'admin'
    state.permissions = new Set(['*', READ, VOID])
    state.user = { ...state.user, id: 'admin-1' }
    await openDetail({ prescriber_user_id: 'u1' })
    expect(voidButton()).not.toBeNull()
  })

  it('not once it is voided', async () => {
    await openDetail({ status: 'voided', voided_at: '2026-10-04T10:00:00Z', void_reason: 'x' })
    expect(voidButton()).toBeNull()
  })

  it('not without the void permission', async () => {
    state.permissions = new Set([READ, PRESCRIBE])
    await openDetail()
    expect(voidButton()).toBeNull()
  })

  it.each(['hygienist', 'assistant', 'receptionist'])('not a %s, even as the same user', async (role) => {
    state.role = role
    await openDetail()
    expect(voidButton()).toBeNull()
  })

  it('not while the role is unknown', async () => {
    state.role = null
    await openDetail()
    expect(voidButton()).toBeNull()
  })

  it('only in the detail: no row of the history has it', async () => {
    apiRoutes([listItem('4'), listItem('5')])
    const wrapper = await mountView()

    const labels = wrapper.findAll('[data-testid^="prescription-row-"] button').map(b => b.text())
    expect(new Set(labels)).toEqual(new Set(['Ver', 'Imprimir']))
  })

  it('the Clinical tab\'s readonly flag changes nothing', async () => {
    apiRoutes([listItem('4')], detailOf('4'))
    const wrapper = await mountView('p1', true)
    await wrapper.find('[data-testid="prescription-row-view"]').trigger('click')
    await settle()

    expect(voidButton()).not.toBeNull()
  })

  it('a read-only user has neither action', async () => {
    state.permissions = new Set([READ])
    state.role = 'receptionist'
    apiRoutes([listItem('4')], detailOf('4'))
    const wrapper = await mountView()
    await wrapper.find('[data-testid="prescription-row-view"]').trigger('click')
    await settle()

    expect($('prescription-detail-number')).not.toBeNull()
    expect(wrapper.find('[data-testid="prescription-new"]').exists()).toBe(false)
    expect(voidButton()).toBeNull()
  })
})

describe('the void dialog', () => {
  async function openVoid(over: Partial<PrescriptionDetail> = {}) {
    apiRoutes([listItem('4')], detailOf('4', over))
    const wrapper = await mountView()
    await wrapper.find('[data-testid="prescription-row-view"]').trigger('click')
    await settle()
    await click('prescription-detail-void-action')
    return wrapper
  }

  it('opens with a heading, the warning and an empty reason', async () => {
    await openVoid()

    const dialog = $('prescription-void')!.closest('[role="dialog"]')!
    expect(dialog.textContent).toContain('Anular receta')
    expect($('prescription-void-warning')!.textContent).toContain('La anulación no se puede revertir.')
    expect($('prescription-void-reason')!.querySelector('textarea')!.value).toBe('')
    expect(voidPosts()).toHaveLength(0)
  })

  it('has Cancelar and a differentiated Anular receta', async () => {
    await openVoid()

    expect($('prescription-void-cancel')!.textContent!.trim()).toBe('Cancelar')
    expect($('prescription-void-submit')!.textContent!.trim()).toBe('Anular receta')
  })

  it('the reason has no suggestions and allows 2000 characters', async () => {
    await openVoid()

    const area = $('prescription-void-reason')!.querySelector('textarea')!
    expect(area.maxLength).toBe(2000)
    expect($('prescription-void')!.querySelector('datalist, select, [role="listbox"]')).toBeNull()
  })

  it.each(['', '    ', '\n\t '])('refuses a reason of %j without any request', async (reason) => {
    await openVoid()
    await type('prescription-void-reason', reason)

    await click('prescription-void-submit')

    expect(voidPosts()).toHaveLength(0)
    expect($('prescription-void')!.textContent).toContain('Indique el motivo de la anulación.')
    expect($('prescription-void')).not.toBeNull()
  })

  it('cancelling closes it and sends nothing; the detail stays', async () => {
    await openVoid()
    await type('prescription-void-reason', 'Error de dosis')

    await click('prescription-void-cancel')

    expect($('prescription-void')).toBeNull()
    expect(voidPosts()).toHaveLength(0)
    expect($('prescription-detail-number')).not.toBeNull()
  })

  it('what was typed does not survive closing it', async () => {
    await openVoid()
    await type('prescription-void-reason', 'Error de dosis')
    await click('prescription-void-cancel')

    await click('prescription-detail-void-action')

    expect($('prescription-void-reason')!.querySelector('textarea')!.value).toBe('')
  })

  it('sends exactly { reason }, trimmed, to this prescription', async () => {
    state.post.mockResolvedValue({
      data: detailOf('4', { status: 'voided', voided_at: '2026-10-04T10:00:00Z', voided_by: 'u1', void_reason: 'Error de dosis' }),
      message: null
    })
    await openVoid()
    await type('prescription-void-reason', '   Error de dosis   ')

    await click('prescription-void-submit')

    expect(voidPosts()).toHaveLength(1)
    const [url, body, options] = voidPosts()[0]!
    expect(url).toBe('/api/v1/prescriptions/4/void')
    expect(body).toEqual({ reason: 'Error de dosis' })
    expect(options).toEqual({ silentForbidden: true })
  })

  it('a double click sends one request', async () => {
    const pending = deferred<unknown>()
    state.post.mockReturnValue(pending.promise)
    await openVoid()
    await type('prescription-void-reason', 'Error de dosis')
    const submit = $('prescription-void-submit') as HTMLButtonElement

    submit.click()
    submit.click()
    submit.click()
    await settle()

    expect(voidPosts()).toHaveLength(1)
    expect(($('prescription-void-submit') as HTMLButtonElement).disabled).toBe(true)
    expect(($('prescription-void-cancel') as HTMLButtonElement).disabled).toBe(true)
    pending.resolve({ data: detailOf('4', { status: 'voided' }), message: null })
    await settle()
  })

  describe('when it works', () => {
    async function voidIt() {
      const voided = detailOf('4', {
        status: 'voided',
        voided_at: '2026-10-04T10:00:00.123Z',
        voided_by: 'u1',
        void_reason: 'Error de dosis'
      })
      state.post.mockResolvedValue({ data: voided, message: null })
      const wrapper = await openVoid()
      await type('prescription-void-reason', 'Error de dosis')
      const listCalls = state.get.mock.calls.filter(c => c[0] === '/api/v1/prescriptions').length
      await click('prescription-void-submit')
      return { wrapper, listCalls }
    }

    it('closes the void dialog and leaves the detail open', async () => {
      await voidIt()

      expect($('prescription-void')).toBeNull()
      expect($('prescription-detail-number')).not.toBeNull()
    })

    it('the detail now says ANULADA with the reason, from the response', async () => {
      await voidIt()

      expect($('prescription-detail-status')!.textContent!.trim()).toBe('Anulada')
      expect($('prescription-detail-void')!.textContent).toContain('Receta anulada')
      expect($('prescription-detail-void-reason')!.textContent).toContain('Error de dosis')
      expect($('prescription-detail-void-at')!.textContent).toMatch(/2026/)
    })

    it('the void action is gone', async () => {
      await voidIt()
      expect($('prescription-detail-void-action')).toBeNull()
    })

    it('reloads the history, on the page the user is on', async () => {
      const { listCalls } = await voidIt()

      const lists = state.get.mock.calls.filter(c => c[0] === '/api/v1/prescriptions')
      expect(lists.length).toBe(listCalls + 1)
      expect(lists.at(-1)![1].query.page).toBe(1)
    })

    it('says so with a toast', async () => {
      await voidIt()

      expect(state.toastAdd).toHaveBeenCalledWith(expect.objectContaining({
        color: 'success',
        description: 'Receta RX-2026-000004 anulada.'
      }))
    })
  })

  describe('when somebody got there first, or it no longer applies', () => {
    async function voidWith(error: unknown) {
      state.post.mockRejectedValue(error)
      const wrapper = await openVoid()
      await type('prescription-void-reason', 'Error de dosis')
      state.get.mockClear()
      apiRoutes([listItem('4', { status: 'voided' })], detailOf('4', {
        status: 'voided', voided_at: '2026-10-04T09:00:00Z', void_reason: 'Otro motivo'
      }))
      await click('prescription-void-submit')
      return wrapper
    }

    it('a conflict says it was already voided, reloads detail and list, and does not retry', async () => {
      await voidWith(failure(409, 'prescription_state_conflict'))

      expect(state.toastAdd).toHaveBeenCalledWith(expect.objectContaining({
        color: 'warning',
        description: 'Esta receta ya fue anulada.'
      }))
      expect(voidPosts()).toHaveLength(1)
      expect($('prescription-void')).toBeNull()
      expect(state.get.mock.calls.some(c => c[0] === '/api/v1/prescriptions/4')).toBe(true)
      expect(state.get.mock.calls.some(c => c[0] === '/api/v1/prescriptions')).toBe(true)
      // what is true now: voided, with the other actor's reason
      expect($('prescription-detail-status')!.textContent!.trim()).toBe('Anulada')
      expect($('prescription-detail-void-reason')!.textContent).toContain('Otro motivo')
      expect($('prescription-detail-void-action')).toBeNull()
    })

    it('not allowed is explained, the dialog closes and the detail is reloaded', async () => {
      await voidWith(failure(403, 'void_not_allowed'))

      expect(state.toastAdd).toHaveBeenCalledWith(expect.objectContaining({
        description: 'Solo el odontólogo que emitió la receta o un administrador puede anularla.'
      }))
      expect($('prescription-void')).toBeNull()
      expect(state.get.mock.calls.some(c => c[0] === '/api/v1/prescriptions/4')).toBe(true)
      expect(voidPosts()).toHaveLength(1)
    })

    it('a prescription that is gone closes the detail too: no ghost on screen', async () => {
      await voidWith(failure(404, 'prescription_not_found'))

      expect(state.toastAdd).toHaveBeenCalledWith(expect.objectContaining({
        description: 'La receta ya no existe o no está disponible.'
      }))
      expect($('prescription-void')).toBeNull()
      expect($('prescription-detail-number')).toBeNull()
      expect(state.get.mock.calls.some(c => c[0] === '/api/v1/prescriptions')).toBe(true)
    })

    it('a missing-reason answer stays on the dialog, on the field', async () => {
      await voidWith(failure(422, 'void_reason_required'))

      expect($('prescription-void')).not.toBeNull()
      expect($('prescription-void')!.textContent).toContain('Indique el motivo de la anulación.')
    })

    it('anything else stays on the dialog with a generic message and the reason kept', async () => {
      await voidWith(failure(500, null))

      expect($('prescription-void-error')!.textContent).toContain('No se pudo anular la receta. Inténtelo de nuevo.')
      expect($('prescription-void-reason')!.querySelector('textarea')!.value).toBe('Error de dosis')
      expect($('prescription-detail-void-action')).not.toBeNull()
    })
  })

  it('another patient closes both dialogs', async () => {
    const wrapper = await openVoid()
    await type('prescription-void-reason', 'Error de dosis')

    await wrapper.setProps({ ctx: { patientId: 'pB' } })
    await settle()

    expect($('prescription-void')).toBeNull()
    expect($('prescription-detail-number')).toBeNull()
    expect(voidPosts()).toHaveLength(0)
  })

  it('an answer for the old patient does not mark anything as voided', async () => {
    const pending = deferred<unknown>()
    state.post.mockReturnValue(pending.promise)
    const wrapper = await openVoid()
    await type('prescription-void-reason', 'Error de dosis')
    await click('prescription-void-submit')

    await wrapper.setProps({ ctx: { patientId: 'pB' } })
    await settle()
    pending.resolve({ data: detailOf('4', { status: 'voided' }), message: null })
    await settle()

    expect($('prescription-detail-number')).toBeNull()
    expect(state.toastAdd).not.toHaveBeenCalled()
  })
})

// ===========================================================================
// what Phase D does not do
// ===========================================================================

describe('Phase D offers no edit, delete or duplicate', () => {
  it('neither the history nor the detail has such an action', async () => {
    apiRoutes([listItem('4')], detailOf('4'))
    const wrapper = await mountView()
    await wrapper.find('[data-testid="prescription-row-view"]').trigger('click')
    await settle()

    const labels = [
      ...wrapper.findAll('button').map(b => b.text()),
      ...Array.from(document.querySelectorAll('[role="dialog"] button')).map(b => b.textContent!.trim())
    ].join(' | ')
    expect(labels).not.toMatch(/editar|eliminar|borrar|duplicar|copiar|reemitir|edit|delete|duplicate|copy/i)
  })

  it('there is no HTTP verb but GET and POST in the layer', () => {
    const source = readFileSync(resolve(MODULE, 'composables/usePrescriptions.ts'), 'utf8')
    expect(source).not.toMatch(/api\.(put|patch|del)\(/)
    expect(source).toMatch(/api\.post</)
  })
})
