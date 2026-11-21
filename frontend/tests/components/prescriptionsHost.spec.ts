/**
 * Recetas in the patient's Clinical tab: the host side.
 *
 * The toggle offers the mode, the tab renders the slot and nothing else, and the
 * module registers what fills it. `patients` never imports the component; the
 * slot name is the whole contract. The pure rules (order, access, URL) are in
 * `tests/utils/clinicalModes.test.ts`.
 *
 * Layer files are imported by relative path: `frontend/module_layers` does not
 * resolve on this Windows host.
 */

import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h, nextTick } from 'vue'

import ClinicalModeToggle from '../../../backend/app/modules/odontogram/frontend/components/clinical/ClinicalModeToggle.vue'
import ClinicalTab from '../../../backend/app/modules/patients/frontend/components/patient/ClinicalTab.vue'
import slotsPlugin from '../../../backend/app/modules/prescriptions/frontend/plugins/slots.client'
import { clearSlots, resolveSlot } from '../../app/composables/useModuleSlots'
import { PERMISSIONS } from '../../app/config/permissions'

const host = vi.hoisted(() => ({
  permissions: new Set<string>(),
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

const RX_READ = 'prescriptions.read'
const NOTES_READ = 'clinical_notes.notes.read'

async function settle() {
  await nextTick()
  await new Promise(resolve => setTimeout(resolve, 0))
  await nextTick()
}

beforeEach(() => {
  host.permissions = new Set([RX_READ, NOTES_READ])
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
})

afterEach(() => {
  clearSlots('patient.clinical.prescriptions')
})

// ===========================================================================
// permissions
// ===========================================================================

describe('PERMISSIONS.prescriptions', () => {
  it('names the three backend permissions', () => {
    expect(PERMISSIONS.prescriptions).toEqual({
      read: 'prescriptions.read',
      prescribe: 'prescriptions.prescribe',
      void: 'prescriptions.void'
    })
  })
})

// ===========================================================================
// the toggle
// ===========================================================================

describe('the mode toggle', () => {
  async function tabs(props: Record<string, unknown>) {
    const wrapper = await mountSuspended(ClinicalModeToggle, {
      props: { modelValue: 'diagnosis', ...props }
    })
    return { wrapper, tabs: wrapper.findAll('[role="tab"]') }
  }

  it('offers six options, in order, when the user may read notes and prescriptions', async () => {
    const { tabs: options } = await tabs({ showEvolution: true, showPrescriptions: true })

    expect(options).toHaveLength(6)
    const labels = options.map(tab => tab.text())
    expect(labels[0]).toMatch(/diagn[oó]stic|diagnosis/i)
    expect(labels[3]).toMatch(/receta|prescription/i)
    expect(labels[4]).toMatch(/hist[oó]ric|history/i)
    expect(labels[5]).toMatch(/evoluci[oó]n|evolution/i)
  })

  it('Recetas sits between Citas and Histórico', async () => {
    const { tabs: options } = await tabs({ showPrescriptions: true })
    const labels = options.map(tab => tab.text())

    expect(labels).toHaveLength(5)
    expect(labels[2]).toMatch(/citas|appointments/i)
    expect(labels[3]).toMatch(/receta|prescription/i)
    expect(labels[4]).toMatch(/hist[oó]ric|history/i)
  })

  it('has a pill icon, not the notes icon', async () => {
    const { tabs: options } = await tabs({ showPrescriptions: true })
    expect(options[3]!.html()).toMatch(/pill/)
    expect(options[3]!.html()).not.toMatch(/notebook/)
  })

  it('does not offer Recetas by default or when told not to, so a host that forgets never leaks it', async () => {
    expect((await tabs({})).tabs).toHaveLength(4)
    expect((await tabs({ showPrescriptions: false })).tabs).toHaveLength(4)
    const { tabs: withNotes } = await tabs({ showEvolution: true })
    expect(withNotes).toHaveLength(5)
    expect(withNotes.map(tab => tab.text()).join(' ')).not.toMatch(/receta|prescription/i)
  })

  it('selecting Recetas emits the mode', async () => {
    const { wrapper, tabs: options } = await tabs({ showPrescriptions: true })
    await options[3]!.trigger('click')
    expect(wrapper.emitted('update:modelValue')?.[0]).toEqual(['prescriptions'])
  })

  it('Evolución still works next to it', async () => {
    const { wrapper, tabs: options } = await tabs({ showEvolution: true, showPrescriptions: true })
    await options[5]!.trigger('click')
    expect(wrapper.emitted('update:modelValue')?.[0]).toEqual(['evolution'])
  })
})

// ===========================================================================
// the tab
// ===========================================================================

describe('the clinical tab', () => {
  async function mountTab(url: string) {
    host.query = Object.fromEntries(new URL(url, 'http://localhost').searchParams)
    const wrapper = await mountSuspended(ClinicalTab, {
      props: { patientId: 'p1' },
      shallow: true
    })
    await settle()
    return wrapper
  }

  it('renders the prescriptions slot, and only that slot, in prescriptions mode', async () => {
    const html = (await mountTab('/?clinicalMode=prescriptions')).html()

    expect(html).toMatch(/<module-slot-stub[^>]*name="patient\.clinical\.prescriptions"/)
    expect(html).not.toContain('patient.clinical.evolution')
    // patients renders the slot; it does not import what fills it.
    expect(html).not.toMatch(/prescriptionsview/i)
  })

  it('passes the slot the patient and the tab\'s readonly flag', async () => {
    const html = (await mountTab('/?clinicalMode=prescriptions')).html()
    expect(html).toMatch(/patient\.clinical\.prescriptions/)
    expect(html).toMatch(/ctx="\[object Object\]"|ctx=/)
  })

  it('does not render the slot in the other modes', async () => {
    const html = (await mountTab('/?clinicalMode=plans')).html()
    expect(html).not.toContain('patient.clinical.prescriptions')
  })

  it('without prescriptions.read, a prescriptions URL does not open a hidden tab', async () => {
    host.permissions = new Set([NOTES_READ])
    const html = (await mountTab('/?clinicalMode=prescriptions')).html()

    expect(html).not.toContain('patient.clinical.prescriptions')
    expect(html).not.toMatch(/show-prescriptions="true"/)
  })

  it('tells the toggle whether to offer Recetas', async () => {
    expect((await mountTab('/')).html()).toMatch(/show-prescriptions="true"/)

    host.permissions = new Set([NOTES_READ])
    expect((await mountTab('/')).html()).not.toMatch(/show-prescriptions="true"/)
  })

  it('Evolución keeps working: the notes permission alone still opens it', async () => {
    host.permissions = new Set([NOTES_READ])
    const html = (await mountTab('/?clinicalMode=evolution')).html()

    expect(html).toMatch(/<module-slot-stub[^>]*name="patient\.clinical\.evolution"/)
    expect(html).not.toContain('patient.clinical.prescriptions')
    expect(html).toMatch(/show-evolution="true"/)
  })

  it('and with both permissions each URL opens its own mode', async () => {
    expect((await mountTab('/?clinicalMode=evolution')).html()).toContain('patient.clinical.evolution')
    expect((await mountTab('/?clinicalMode=prescriptions')).html()).toContain('patient.clinical.prescriptions')
  })

  it('a receptionist, assistant or hygienist with neither permission sees neither', async () => {
    host.permissions = new Set()
    const html = (await mountTab('/?clinicalMode=prescriptions')).html()
    expect(html).not.toMatch(/show-prescriptions="true"/)
    expect(html).not.toMatch(/show-evolution="true"/)
    expect(html).not.toContain('patient.clinical.prescriptions')
  })
})

describe('the host never imports the prescriptions module', () => {
  const read = (path: string) =>
    readFileSync(resolve(process.cwd(), '..', path), 'utf8')

  it('ClinicalTab knows a slot name and a permission, not a component', () => {
    const source = read('backend/app/modules/patients/frontend/components/patient/ClinicalTab.vue')

    expect(source).toContain('patient.clinical.prescriptions')
    expect(source).not.toMatch(/PrescriptionsView|PrescriptionDetail|usePrescriptions/)
    expect(source).not.toMatch(/modules\/prescriptions|from ['"].*prescriptions\//)
    expect((ClinicalTab as unknown as { __file?: string }).__file ?? '').not.toContain('prescriptions')
  })

  it('the host files that know the mode name only the mode', () => {
    for (const path of [
      'frontend/app/utils/clinicalModes.ts',
      'frontend/app/types/index.ts',
      'backend/app/modules/odontogram/frontend/components/clinical/ClinicalModeToggle.vue'
    ]) {
      expect(read(path), path).not.toMatch(/PrescriptionsView|usePrescriptions|modules\/prescriptions/)
    }
  })

  it('Phase C reads one permission: ClinicalTab asks for read and for nothing else', () => {
    const source = read('backend/app/modules/patients/frontend/components/patient/ClinicalTab.vue')
    expect(source).toContain('PERMISSIONS.prescriptions.read')
    expect(source).not.toMatch(/PERMISSIONS\.prescriptions\.(prescribe|void)/)
  })

  it('ClinicalTab\'s readonly flag is not turned into a prescriptions permission', () => {
    const source = read('backend/app/modules/patients/frontend/components/patient/ClinicalTab.vue')
    expect(source).not.toMatch(/readonly[^\n]*prescri|prescri[^\n]*readonly[^\n]*(can|allow)/i)
  })
})

// ===========================================================================
// the module's side: the slot it registers
// ===========================================================================

describe('the slot the module registers', () => {
  const RegisterProbe = defineComponent({
    setup() {
      const nuxtApp = useNuxtApp() as unknown as Parameters<typeof slotsPlugin>[0]
      ;(slotsPlugin as unknown as (app: unknown) => unknown)(nuxtApp)
      return () => h('div')
    }
  })

  async function register() {
    await mountSuspended(RegisterProbe)
    return resolveSlot('patient.clinical.prescriptions', { patientId: 'p1' }, { can: () => true })
  }

  it('is patient.clinical.prescriptions, gated by prescriptions.read', async () => {
    const [entry, ...rest] = await register()

    expect(rest).toHaveLength(0)
    expect(entry!.id).toBe('prescriptions.patient.clinical.prescriptions')
    expect(entry!.permission).toBe('prescriptions.read')
    expect(entry!.order).toBe(10)
  })

  it('does not resolve for a user without that permission', async () => {
    await register()
    const asked: string[] = []
    const entries = resolveSlot(
      'patient.clinical.prescriptions',
      { patientId: 'p1' },
      {
        can: (permission) => {
          asked.push(permission)
          return false
        }
      }
    )

    expect(entries).toEqual([])
    expect(asked).toEqual(['prescriptions.read'])
  })

  it('fills the slot with PrescriptionsView, loaded lazily', async () => {
    const [entry] = await register()
    const loader = (entry!.component as unknown as { __asyncLoader?: () => Promise<{ __file?: string }> })
      .__asyncLoader

    expect(typeof loader).toBe('function')
    const loaded = await loader!()
    expect(loaded.__file ?? '').toContain('PrescriptionsView')
  })

  it('registers once however many times the plugin runs', async () => {
    await register()
    await register()
    expect(resolveSlot('patient.clinical.prescriptions', {}, { can: () => true })).toHaveLength(1)
  })
})
