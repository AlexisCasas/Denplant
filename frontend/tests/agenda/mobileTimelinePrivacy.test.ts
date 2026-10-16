import { mount } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import { describe, expect, it, vi } from 'vitest'
import AppointmentMobileTimeline from '../../../backend/app/modules/agenda/frontend/components/clinical/AppointmentMobileTimeline.vue'

vi.stubGlobal('useAppointmentNotesIndicator', () => ({ has: () => false }))
const appointment = { id: 'hidden', status: 'scheduled', professional_id: 'p1', cabinet: 'A', start_time: '2030-01-02T10:00:00', end_time: '2030-01-02T10:30:00', patient: { first_name: 'Paciente', last_name: 'Oculto QA' } } as any
const entry = { type: 'busy', start: new Date(2030, 0, 2, 10), end: new Date(2030, 0, 2, 10, 30), appointment }
const i18n = createI18n({ legacy: false, locale: 'en', messages: { en: { appointments: { freeSlots: { occupied: 'Occupied' }, noPatient: 'No patient' } } } })

describe('mobile timeline filtered privacy', () => {
  it('renders an inaccessible neutral occupied block until the appointment is visible', async () => {
    const hidden = mount(AppointmentMobileTimeline, { props: { entries: [entry], professionals: [], visibleAppointmentIds: [] }, global: { plugins: [i18n], stubs: { UIcon: true, UBadge: true } } })
    expect(hidden.text()).toContain('Occupied')
    expect(hidden.text()).not.toContain('Paciente Oculto QA')
    expect(hidden.find('button').exists()).toBe(false)
    expect(hidden.text()).toContain('10:00')
    const visible = mount(AppointmentMobileTimeline, { props: { entries: [entry], professionals: [], visibleAppointmentIds: ['hidden'] }, global: { plugins: [i18n], stubs: { UIcon: true, UBadge: true } } })
    expect(visible.text()).toContain('Paciente Oculto QA')
  })
})
