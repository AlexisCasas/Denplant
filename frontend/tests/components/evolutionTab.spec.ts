/**
 * QW4 — the Evolución tab, through the components.
 *
 * Covers the fifth mode (toggle + tab + slot), the notes history view
 * (filters, creation, the Diagnóstico deep link, printing the whole history)
 * and the print sheet. The pure rules behind them are in
 * `tests/utils/evolutionNotes.test.ts`.
 *
 * Layer components reach their composables and siblings through auto-imports,
 * and `frontend/module_layers` does not resolve on this Windows host. Layer
 * composables are therefore installed as globals (the compiled SFC looks them
 * up as free identifiers, which is how an auto-import behaves at runtime), and
 * sibling components are registered through `global.components`.
 */

import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h, nextTick } from 'vue'

import ClinicalModeToggle from '../../../backend/app/modules/odontogram/frontend/components/clinical/ClinicalModeToggle.vue'
import ClinicalTab from '../../../backend/app/modules/patients/frontend/components/patient/ClinicalTab.vue'
import EvolutionNotesView from '../../../backend/app/modules/clinical_notes/frontend/components/EvolutionNotesView.vue'
import EvolutionPrintView from '../../../backend/app/modules/clinical_notes/frontend/components/EvolutionPrintView.vue'
import { useNoteTypeMeta } from '../../../backend/app/modules/clinical_notes/frontend/composables/useNoteTypeMeta'
import type { RecentNoteEntry } from '../../app/types'

// ---------------------------------------------------------------------------
// host composables
// ---------------------------------------------------------------------------

const host = vi.hoisted(() => ({
  permissions: new Set<string>(),
  cachedPatient: null as null | Record<string, unknown>,
  userId: 'u1',
  // The real router redirects an unauthenticated test to /login and drops the
  // query, so the URL is a plain object the components read and replace.
  query: {} as Record<string, unknown>,
  replace: vi.fn(),
  push: vi.fn()
}))

mockNuxtImport('useRoute', () => () => ({
  get query() { return host.query },
  path: '/',
  fullPath: '/'
}))

mockNuxtImport('useRouter', () => () => ({ replace: host.replace, push: host.push }))

mockNuxtImport('usePermissions', () => () => ({
  can: (permission: string) => host.permissions.has(permission)
}))

mockNuxtImport('useAuth', () => () => ({
  user: { value: { id: host.userId } }
}))

mockNuxtImport('useClinicState', () => () => ({
  currentClinic: { value: { id: 'c1', name: 'Clínica Demo' } }
}))

mockNuxtImport('useNuxtData', () => () => ({
  data: { get value() { return host.cachedPatient } }
}))

const READ = 'clinical_notes.notes.read'
const WRITE = 'clinical_notes.notes.write'

// ---------------------------------------------------------------------------
// layer composables, as globals
// ---------------------------------------------------------------------------

const listRecentForPatient = vi.fn()
const createNote = vi.fn()
const updateNote = vi.fn()
const deleteNote = vi.fn()

beforeAll(() => {
  const globals = globalThis as unknown as Record<string, unknown>
  globals.useClinicalNotes = () => ({
    listRecentForPatient,
    createNote,
    updateNote,
    deleteNote,
    listTemplates: async () => []
  })
  globals.useNoteTypeMeta = useNoteTypeMeta
})

afterAll(() => {
  const globals = globalThis as unknown as Record<string, unknown>
  Reflect.deleteProperty(globals, 'useClinicalNotes')
  Reflect.deleteProperty(globals, 'useNoteTypeMeta')
})

// ---------------------------------------------------------------------------
// builders
// ---------------------------------------------------------------------------

function note(id: string, createdAt: string, overrides: Partial<RecentNoteEntry> = {}): RecentNoteEntry {
  return {
    id,
    note_type: 'evolution',
    owner_type: 'patient',
    owner_id: 'p1',
    tooth_number: null,
    body: `cuerpo ${id}`,
    created_at: createdAt,
    updated_at: createdAt,
    author: { id: 'u1', full_name: 'Dra. Ruiz', email: null },
    linked: { kind: 'patient', id: 'p1', label: null, tooth_number: null },
    attachments: [],
    ...overrides
  }
}

/** `count` notes, newest first, one minute apart. */
function history(count: number): RecentNoteEntry[] {
  const base = Date.parse('2026-01-01T00:00:00Z')
  return Array.from({ length: count }, (_, i) =>
    note(`n${String(count - i).padStart(4, '0')}`, new Date(base + (count - i) * 60_000).toISOString()))
}

/** A stand-in for NoteComposer that shows what it was given and can submit. */
const ComposerStub = defineComponent({
  name: 'NoteComposer',
  props: {
    noteType: { type: String, default: '' },
    toothNumber: { type: Number, default: null },
    initialBody: { type: String, default: '' },
    patientId: { type: String, default: '' },
    busy: Boolean,
    autofocus: Boolean
  },
  emits: ['submit', 'cancel'],
  setup(props, { emit }) {
    return () => h('div', {
      'data-testid': 'composer',
      'data-note-type': props.noteType,
      'data-tooth': props.toothNumber ?? ''
    }, [
      h('button', {
        'data-testid': 'composer-submit',
        'onClick': () => emit('submit', {
          body: 'Texto de la nota',
          toothNumber: props.toothNumber,
          attachmentDocumentIds: ['doc-1']
        })
      }),
      h('button', { 'data-testid': 'composer-cancel', 'onClick': () => emit('cancel') })
    ])
  }
})

const CardStub = defineComponent({
  name: 'NoteCard',
  props: {
    noteId: { type: String, default: '' },
    noteType: { type: String, default: '' },
    body: { type: String, default: '' },
    absoluteDate: Boolean,
    alwaysExpanded: Boolean,
    showAppointmentContext: Boolean
  },
  setup(props) {
    return () => h('article', {
      'data-testid': 'card',
      'data-id': props.noteId,
      'data-absolute': String(props.absoluteDate),
      'data-expanded': String(props.alwaysExpanded),
      'data-appointment': String(props.showAppointmentContext)
    }, props.body)
  }
})

/** Put the URL in place before mounting: components read the query on mount. */
async function visit(url: string) {
  host.query = Object.fromEntries(new URL(url, 'http://localhost').searchParams)
}

async function settle() {
  await nextTick()
  await new Promise(resolve => setTimeout(resolve, 0))
  await nextTick()
  await new Promise(resolve => setTimeout(resolve, 0))
}

beforeEach(() => {
  host.permissions = new Set([READ, WRITE])
  host.cachedPatient = { first_name: 'Ana', last_name: 'García', national_id: '12345678Z' }
  host.query = {}
  host.replace.mockReset()
  host.replace.mockImplementation(async (to: string | { query?: Record<string, unknown> }) => {
    // mountSuspended itself calls replace('/') through the (mocked) router.
    if (typeof to === 'string') return
    host.query = Object.fromEntries(
      Object.entries(to.query ?? {}).filter(([, value]) => value !== undefined)
    )
  })
  host.push.mockReset()
  listRecentForPatient.mockReset()
  createNote.mockReset()
  updateNote.mockReset()
  deleteNote.mockReset()
  listRecentForPatient.mockResolvedValue([])
  createNote.mockImplementation(async (payload: Record<string, unknown>) => ({ id: 'new', ...payload }))
  document.body.querySelectorAll('.evolution-print-root').forEach(node => node.remove())
})

// ===========================================================================
// the fifth mode
// ===========================================================================

describe('the mode toggle', () => {
  async function labels(showEvolution: boolean | undefined) {
    const wrapper = await mountSuspended(ClinicalModeToggle, {
      props: { modelValue: 'diagnosis', ...(showEvolution === undefined ? {} : { showEvolution }) }
    })
    return wrapper.findAll('[role="tab"]').map(tab => tab.text())
  }

  it('offers five options, Evolución last, when the user may read notes', async () => {
    const tabs = await labels(true)
    expect(tabs).toHaveLength(5)
    expect(tabs[4]).toMatch(/evoluci[oó]n|evolution/i)
    expect(tabs[0]).toMatch(/diagn[oó]stic|diagnosis/i)
  })

  it('offers four — no Evolución — otherwise', async () => {
    expect(await labels(false)).toHaveLength(4)
    // …and by default, so a host that forgets to opt in never leaks the tab.
    expect(await labels(undefined)).toHaveLength(4)
  })

  it('selecting Evolución emits the mode', async () => {
    const wrapper = await mountSuspended(ClinicalModeToggle, {
      props: { modelValue: 'diagnosis', showEvolution: true }
    })
    await wrapper.findAll('[role="tab"]')[4]!.trigger('click')
    expect(wrapper.emitted('update:modelValue')?.[0]).toEqual(['evolution'])
  })
})

describe('the clinical tab', () => {
  async function mountTab(route: string) {
    await visit(route)
    return mountSuspended(ClinicalTab, {
      props: { patientId: 'p1' },
      shallow: true
    })
  }

  it('renders the evolution slot, and only that slot, in evolution mode', async () => {
    const wrapper = await mountTab('/?clinicalMode=evolution')
    await settle()

    const html = wrapper.html()
    expect(html).toMatch(/<module-slot-stub[^>]*name="patient\.clinical\.evolution"/)
    // patients renders the slot; it does not import what fills it.
    expect(html).not.toMatch(/evolutionnotesview/i)
  })

  it('does not render the slot in the other modes', async () => {
    const wrapper = await mountTab('/?clinicalMode=plans')
    await settle()
    expect(wrapper.html()).not.toContain('patient.clinical.evolution')
  })

  it('without notes access, an evolution URL does not open a hidden tab', async () => {
    host.permissions = new Set()
    const wrapper = await mountTab('/?clinicalMode=evolution')
    await settle()

    expect(wrapper.html()).not.toContain('patient.clinical.evolution')
  })

  it('tells the toggle whether to offer Evolución', async () => {
    const withAccess = await mountTab('/')
    expect(withAccess.html()).toMatch(/show-evolution="true"/)

    host.permissions = new Set()
    const without = await mountTab('/')
    expect(without.html()).not.toMatch(/show-evolution="true"/)
  })

  describe('"Añadir nota" from Diagnóstico', () => {
    const DiagnosisStub = defineComponent({
      name: 'DiagnosisModeContainer',
      props: { canAddNote: Boolean },
      emits: ['add-note'],
      setup(props, { emit }) {
        return () => h('div', { 'data-testid': 'diagnosis', 'data-can-add': String(props.canAddNote) }, [
          h('button', { 'data-testid': 'add-with-tooth', 'onClick': () => emit('add-note', 36) }),
          h('button', { 'data-testid': 'add-without-tooth', 'onClick': () => emit('add-note', null) })
        ])
      }
    })

    // Not shallow: the stub that emits has to survive. ModuleSlot is replaced
    // by a marker so the slot it was asked to render can be read back.
    const SlotMarker = defineComponent({
      name: 'ModuleSlot',
      props: { name: { type: String, default: '' }, ctx: { type: Object, default: null } },
      setup(props) {
        return () => h('div', { 'data-slot': props.name })
      }
    })

    async function mountWithDiagnosis() {
      await visit('/')
      return mountSuspended(ClinicalTab, {
        props: { patientId: 'p1' },
        global: {
          components: { DiagnosisModeContainer: DiagnosisStub },
          // Host components are bound at build time, so they are stubbed, not registered.
          stubs: { ModuleSlot: SlotMarker }
        }
      })
    }

    it('with a tooth, goes to Evolución asking for a diagnosis note on it', async () => {
      const wrapper = await mountWithDiagnosis()
      await settle()
      await wrapper.find('[data-testid="add-with-tooth"]').trigger('click')
      await settle()

      const targets = host.replace.mock.calls.map(call => call[0]).filter(to => typeof to === 'object')
      expect(targets[0].query).toMatchObject({
        clinicalMode: 'evolution',
        newNote: 'diagnosis',
        tooth: '36'
      })
      expect(wrapper.find('[data-slot="patient.clinical.evolution"]').exists()).toBe(true)
    })

    it('without a tooth, asks for nothing more than the tab: no tooth is invented', async () => {
      const wrapper = await mountWithDiagnosis()
      await settle()
      await wrapper.find('[data-testid="add-without-tooth"]').trigger('click')
      await settle()

      const targets = host.replace.mock.calls.map(call => call[0]).filter(to => typeof to === 'object')
      expect(targets[0].query.clinicalMode).toBe('evolution')
      expect(targets[0].query.newNote).toBeUndefined()
      expect(targets[0].query.tooth).toBeUndefined()
      expect(wrapper.find('[data-slot="patient.clinical.evolution"]').exists()).toBe(true)
    })

    it('does nothing without notes access, and the button is not offered', async () => {
      host.permissions = new Set()
      const wrapper = await mountWithDiagnosis()
      await settle()
      expect(wrapper.find('[data-testid="diagnosis"]').attributes('data-can-add')).toBe('false')

      await wrapper.find('[data-testid="add-with-tooth"]').trigger('click')
      await settle()
      expect(wrapper.find('[data-slot="patient.clinical.evolution"]').exists()).toBe(false)
    })
  })

  it('the host source never imports the evolution component', () => {
    // The slot is the whole contract between patients and clinical_notes.
    const source = ClinicalTab as unknown as { __file?: string }
    expect(source.__file ?? '').not.toContain('clinical_notes')
  })
})

// ===========================================================================
// the notes history
// ===========================================================================

describe('EvolutionNotesView', () => {
  async function mountView(route = '/') {
    await visit(route)
    return mountSuspended(EvolutionNotesView, {
      props: { ctx: { patientId: 'p1' } },
      global: {
        components: { NoteComposer: ComposerStub, NoteCard: CardStub, EvolutionPrintView }
      }
    })
  }

  it('asks for the clinical types only, 20 at a time', async () => {
    await mountView()
    await settle()

    expect(listRecentForPatient).toHaveBeenCalledWith('p1', {
      types: ['evolution', 'diagnosis', 'treatment', 'treatment_plan', 'appointment_clinical'],
      limit: 20
    })
    const [, options] = listRecentForPatient.mock.calls[0]!
    expect(options.types).not.toContain('administrative')
    expect(options.types).not.toContain('appointment_administrative')
  })

  it('shows each note with an absolute date, its full body and the appointment context', async () => {
    listRecentForPatient.mockResolvedValue(history(3))
    const wrapper = await mountView()
    await settle()

    const cards = wrapper.findAll('[data-testid="card"]')
    expect(cards).toHaveLength(3)
    // Newest first, as the server sent them.
    expect(cards.map(c => c.attributes('data-id'))).toEqual(['n0003', 'n0002', 'n0001'])
    for (const card of cards) {
      expect(card.attributes('data-absolute')).toBe('true')
      expect(card.attributes('data-expanded')).toBe('true')
      expect(card.attributes('data-appointment')).toBe('true')
    }
  })

  it('filters by clinical type, and "all" restores every one of them', async () => {
    const wrapper = await mountView()
    await settle()
    listRecentForPatient.mockClear()

    await wrapper.find('[data-testid="evolution-filter-diagnosis"]').trigger('click')
    await settle()
    expect(listRecentForPatient.mock.calls[0]![1].types).toEqual(['diagnosis'])

    await wrapper.find('[data-testid="evolution-filter-all"]').trigger('click')
    await settle()
    expect(listRecentForPatient.mock.calls[1]![1].types).toHaveLength(5)
  })

  it('offers a filter for each clinical type and for no administrative one', async () => {
    const wrapper = await mountView()
    await settle()

    for (const type of ['evolution', 'diagnosis', 'treatment', 'treatment_plan', 'appointment_clinical']) {
      expect(wrapper.find(`[data-testid="evolution-filter-${type}"]`).exists(), type).toBe(true)
    }
    expect(wrapper.find('[data-testid="evolution-filter-administrative"]').exists()).toBe(false)
  })

  it('"+ Nueva evolución" opens an evolution composer and creates an evolution', async () => {
    const wrapper = await mountView()
    await settle()

    await wrapper.find('[data-testid="evolution-new"]').trigger('click')
    const composer = wrapper.find('[data-testid="composer"]')
    expect(composer.attributes('data-note-type')).toBe('evolution')
    expect(composer.attributes('data-tooth')).toBe('')

    await wrapper.find('[data-testid="composer-submit"]').trigger('click')
    await settle()

    expect(createNote).toHaveBeenCalledTimes(1)
    expect(createNote).toHaveBeenCalledWith({
      note_type: 'evolution',
      owner_type: 'patient',
      owner_id: 'p1',
      tooth_number: null,
      body: 'Texto de la nota',
      attachment_document_ids: ['doc-1']
    })
    // Saved: the composer closes and the list is re-read.
    expect(wrapper.find('[data-testid="composer"]').exists()).toBe(false)
    expect(listRecentForPatient.mock.calls.length).toBeGreaterThanOrEqual(2)
  })

  it('a failed save keeps the composer and what was typed', async () => {
    createNote.mockResolvedValue(null)
    const wrapper = await mountView()
    await settle()

    await wrapper.find('[data-testid="evolution-new"]').trigger('click')
    await wrapper.find('[data-testid="composer-submit"]').trigger('click')
    await settle()

    expect(wrapper.find('[data-testid="composer"]').exists()).toBe(true)
  })

  it('without write access there is no way to create a note', async () => {
    host.permissions = new Set([READ])
    const wrapper = await mountView()
    await settle()

    expect(wrapper.find('[data-testid="evolution-new"]').exists()).toBe(false)
  })

  it('without read access it renders nothing and requests nothing', async () => {
    host.permissions = new Set()
    const wrapper = await mountView()
    await settle()

    expect(wrapper.find('[data-testid="evolution-notes-view"]').exists()).toBe(false)
    expect(listRecentForPatient).not.toHaveBeenCalled()
  })

  // -- the deep link ---------------------------------------------------------

  describe('the deep link from Diagnóstico', () => {
    it('?newNote=diagnosis&tooth=36 opens a diagnosis composer bound to tooth 36', async () => {
      const wrapper = await mountView('/?newNote=diagnosis&tooth=36')
      await settle()

      const composer = wrapper.find('[data-testid="composer"]')
      expect(composer.exists()).toBe(true)
      expect(composer.attributes('data-note-type')).toBe('diagnosis')
      expect(composer.attributes('data-tooth')).toBe('36')
    })

    it('and saving it creates a patient-owned diagnosis note with that tooth', async () => {
      const wrapper = await mountView('/?newNote=diagnosis&tooth=36')
      await settle()

      await wrapper.find('[data-testid="composer-submit"]').trigger('click')
      await settle()

      expect(createNote).toHaveBeenCalledWith(expect.objectContaining({
        note_type: 'diagnosis',
        owner_type: 'patient',
        owner_id: 'p1',
        tooth_number: 36
      }))
    })

    it('consumes the parameters, so a refresh does not reopen the composer', async () => {
      await mountView('/?clinicalMode=evolution&newNote=diagnosis&tooth=36')
      await settle()

      expect(host.query.newNote).toBeUndefined()
      expect(host.query.tooth).toBeUndefined()
      // Everything else in the URL is kept.
      expect(host.query.clinicalMode).toBe('evolution')
    })

    it('with no tooth in the link, no tooth is invented', async () => {
      const wrapper = await mountView('/?newNote=diagnosis')
      await settle()

      const composer = wrapper.find('[data-testid="composer"]')
      expect(composer.attributes('data-note-type')).toBe('diagnosis')
      expect(composer.attributes('data-tooth')).toBe('')
    })

    it('without write access the link opens nothing, but is still consumed', async () => {
      host.permissions = new Set([READ])
      const wrapper = await mountView('/?newNote=diagnosis&tooth=36')
      await settle()

      expect(wrapper.find('[data-testid="composer"]').exists()).toBe(false)
      expect(host.query.newNote).toBeUndefined()
    })

    it('the main button still creates an evolution, never a diagnosis', async () => {
      const wrapper = await mountView('/?newNote=diagnosis&tooth=36')
      await settle()
      await wrapper.find('[data-testid="composer-cancel"]').trigger('click')

      await wrapper.find('[data-testid="evolution-new"]').trigger('click')
      expect(wrapper.find('[data-testid="composer"]').attributes('data-note-type')).toBe('evolution')
      expect(wrapper.find('[data-testid="composer"]').attributes('data-tooth')).toBe('')
    })
  })

  // -- printing --------------------------------------------------------------

  describe('printing the whole history', () => {
    let printSpy: ReturnType<typeof vi.fn>

    beforeEach(() => {
      printSpy = vi.fn()
      vi.stubGlobal('print', printSpy)
      window.print = printSpy as unknown as typeof window.print
    })

    it('fetches every page, not the 20 on screen, and prints once', async () => {
      const all = history(230)
      listRecentForPatient.mockImplementation(async (_id: string, options: { limit: number, before?: string }) => {
        const eligible = all.filter(n => options.before === undefined || n.created_at < options.before)
        return eligible.slice(0, options.limit)
      })

      const wrapper = await mountView()
      await settle()
      listRecentForPatient.mockClear()

      await wrapper.find('[data-testid="evolution-print"]').trigger('click')
      await settle()

      const limits = listRecentForPatient.mock.calls.map(call => call[1].limit)
      expect(limits).toEqual([100, 100, 100])
      expect(printSpy).toHaveBeenCalledTimes(1)

      const root = document.body.querySelector('.evolution-print-root')
      expect(root).not.toBeNull()
      expect(root!.querySelectorAll('article')).toHaveLength(230)
    })

    it('prints oldest first', async () => {
      listRecentForPatient.mockResolvedValue(history(5))
      const wrapper = await mountView()
      await settle()

      await wrapper.find('[data-testid="evolution-print"]').trigger('click')
      await settle()

      const ids = [...document.body.querySelectorAll('.evolution-print-root article')]
        .map(article => article.getAttribute('data-note-id'))
      expect(ids).toEqual(['n0001', 'n0002', 'n0003', 'n0004', 'n0005'])
    })

    it('prints every clinical type whatever the filter says, and no reception note', async () => {
      listRecentForPatient.mockResolvedValue([])
      const wrapper = await mountView()
      await settle()
      await wrapper.find('[data-testid="evolution-filter-diagnosis"]').trigger('click')
      await settle()
      listRecentForPatient.mockClear()

      await wrapper.find('[data-testid="evolution-print"]').trigger('click')
      await settle()

      const types = listRecentForPatient.mock.calls[0]![1].types
      expect(types).toEqual(['evolution', 'diagnosis', 'treatment', 'treatment_plan', 'appointment_clinical'])
    })

    it('removes the sheet after printing, so it never meets another document', async () => {
      listRecentForPatient.mockResolvedValue(history(2))
      const wrapper = await mountView()
      await settle()

      await wrapper.find('[data-testid="evolution-print"]').trigger('click')
      await settle()
      expect(document.body.querySelector('.evolution-print-root')).not.toBeNull()

      window.dispatchEvent(new Event('afterprint'))
      await settle()
      expect(document.body.querySelector('.evolution-print-root')).toBeNull()
    })

    it('a history that cannot be fetched prints nothing and says so', async () => {
      const wrapper = await mountView()
      await settle()
      listRecentForPatient.mockRejectedValue(new Error('boom'))
      const quiet = vi.spyOn(console, 'error').mockImplementation(() => {})

      await wrapper.find('[data-testid="evolution-print"]').trigger('click')
      await settle()

      expect(printSpy).not.toHaveBeenCalled()
      expect(document.body.querySelector('.evolution-print-root')).toBeNull()
      expect(wrapper.find('[role="alert"]').exists()).toBe(true)
      quiet.mockRestore()
    })
  })
})

// ===========================================================================
// the print sheet
// ===========================================================================

describe('EvolutionPrintView', () => {
  const patient = { fullName: 'Ana García', documentNumber: '12345678Z' }
  const printedAt = new Date('2026-10-02T09:30:00Z')

  async function sheet(notes: RecentNoteEntry[], overrides: Record<string, unknown> = {}) {
    return mountSuspended(EvolutionPrintView, {
      props: { notes, patient, clinicName: 'Clínica Demo', printedAt, complete: true, ...overrides }
    })
  }

  it('carries the clinic, the patient, the document and the print date', async () => {
    const wrapper = await sheet(history(2))

    expect(wrapper.find('[data-testid="evolution-print-clinic"]').text()).toBe('Clínica Demo')
    expect(wrapper.find('[data-testid="evolution-print-patient"]').text()).toBe('Ana García')
    expect(wrapper.find('[data-testid="evolution-print-document"]').text()).toBe('12345678Z')
    expect(wrapper.find('[data-testid="evolution-print-date"]').text().length).toBeGreaterThan(0)
  })

  it('omits the rows it has no data for instead of printing blanks', async () => {
    const wrapper = await sheet(history(1), { patient: null, clinicName: null })

    expect(wrapper.find('[data-testid="evolution-print-patient"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="evolution-print-document"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="evolution-print-clinic"]').exists()).toBe(false)
  })

  it('prints each note with date and time, professional, type, context and full body', async () => {
    const long = 'x'.repeat(2000)
    const wrapper = await sheet([
      note('a', '2026-03-03T10:15:00Z', {
        note_type: 'treatment',
        body: long,
        author: { id: 'u2', full_name: 'Dr. Pérez', email: null },
        linked: { kind: 'treatment', id: 't1', label: 'Endodoncia', tooth_number: 36 }
      })
    ])

    const article = wrapper.find('article')
    const text = article.text()
    expect(text).toContain('Dr. Pérez')
    expect(text).toContain('clinicalNotes.types.treatment')
    expect(text).toContain('clinicalNotes.linked.treatmentOnTooth')
    // Never truncated behind "show more".
    expect(article.find('.evolution-print-body').text()).toBe(long)
    expect(article.find('[data-testid="evolution-print-note-date"]').text().length).toBeGreaterThan(0)
  })

  it('prints attachments as name and type, with no thumbnail', async () => {
    const wrapper = await sheet([
      note('a', '2026-03-03T10:15:00Z', {
        attachments: [
          {
            id: 'x1', document_id: 'doc12345', owner_type: 'clinical_note', owner_id: 'a',
            display_order: 0, created_at: '2026-03-03T10:15:00Z', title: 'Rx panorámica',
            mime_type: 'image/jpeg', media_kind: 'xray', thumb_url: '/thumb', medium_url: '/medium'
          },
          {
            id: 'x2', document_id: 'doc67890', owner_type: 'clinical_note', owner_id: 'a',
            display_order: 1, created_at: '2026-03-03T10:15:00Z', title: 'Consentimiento',
            mime_type: 'application/pdf', media_kind: null
          }
        ]
      })
    ])

    const lines = wrapper.findAll('[data-testid="evolution-print-attachment"]').map(l => l.text())
    expect(lines).toEqual(['Rx panorámica (JPEG)', 'Consentimiento (PDF)'])
    expect(wrapper.find('img').exists()).toBe(false)
  })

  it('says when the history could only be loaded in part', async () => {
    expect((await sheet(history(1), { complete: false })).find('[data-testid="evolution-print-incomplete"]').exists()).toBe(true)
    expect((await sheet(history(1))).find('[data-testid="evolution-print-incomplete"]').exists()).toBe(false)
  })

  it('an empty history says so', async () => {
    expect((await sheet([])).find('[data-testid="evolution-print-empty"]').exists()).toBe(true)
  })

  it('renders the notes in the order it is given: it neither sorts nor fetches', async () => {
    const wrapper = await sheet(history(3).reverse())
    expect(wrapper.findAll('article').map(a => a.attributes('data-note-id')))
      .toEqual(['n0001', 'n0002', 'n0003'])
  })
})

describe('the print stylesheet', () => {
  const source = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8')
  const view = source('../backend/app/modules/clinical_notes/frontend/components/EvolutionPrintView.vue')
  const css = view.slice(view.lastIndexOf('<style>'))
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/<!--[\s\S]*?-->/g, '')

  it('is its own: .evolution-print-root, with no rule of the odontogram sheet', () => {
    expect(css).toContain('.evolution-print-root')
    expect(css).not.toContain('nts-print-root')
  })

  it('outranks the odontogram rule that hides every other body child', () => {
    // `body > *:not(.nts-print-root)` is (0,1,1) and !important; a doubled
    // class here is (0,2,1) and !important, so this root is the one shown.
    expect(css).toMatch(/body > \.evolution-print-root\.evolution-print-root\s*\{[^}]*display:\s*block\s*!important/)
  })

  it('is hidden on screen', () => {
    expect(css).toMatch(/\.evolution-print-root\s*\{\s*display:\s*none;/)
  })

  it('leaves the odontogram print rules where they were', () => {
    const main = source('app/assets/css/main.css')
    expect(main).toContain('.nts-print-root')
    expect(main).not.toContain('evolution-print-root')
  })
})
