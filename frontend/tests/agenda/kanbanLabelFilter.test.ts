import { mount } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import { describe, expect, it, vi } from 'vitest'
import AppointmentKanbanView from '../../../backend/app/modules/agenda/frontend/components/clinical/AppointmentKanbanView.vue'

vi.stubGlobal('useToast', () => ({ add: vi.fn() }))
vi.stubGlobal('useAppointments', () => ({ fetchAppointments: vi.fn(), transition: vi.fn(), assignCabinet: vi.fn() }))
vi.stubGlobal('useCompletionFollowup', () => ({ trigger: vi.fn() }))
vi.stubGlobal('useAppointmentCompletionGate', () => ({ request: vi.fn() }))
vi.stubGlobal('useAppointmentStatus', () => ({ canTransition: () => true, statusColour: () => '#000', statusLabel: () => '' }))

describe('Kanban label-filter safety', () => {
  it('keeps a filtered in-chair appointment operationally occupied without rendering its card', () => {
    const hidden = {
      id: 'hidden', cabinet: 'A', status: 'in_treatment', start_time: '2030-01-02T10:00:00',
      end_time: '2030-01-02T10:30:00', current_status_since: '2030-01-02T10:00:00', patient: { name: 'Private patient' }
    } as any
    const wrapper = mount(AppointmentKanbanView, {
      props: { appointments: [], allAppointments: [hidden], cabinets: [{ name: 'A', color: '#000' }], professionals: [], currentDate: new Date(2030, 0, 2) },
      global: { plugins: [createI18n({ legacy: false, locale: 'en', messages: { en: {} } })], stubs: { UButton: true, UIcon: true, ProfessionalsStrip: true, AppointmentCard: { template: '<div class="card">{{ appointment.patient?.name }}</div>', props: ['appointment'] } } }
    })
    expect(wrapper.text()).toContain('appointments.kanban.inChair')
    expect(wrapper.text()).not.toContain('Private patient')
    expect(wrapper.find('.card').exists()).toBe(false)
  })
})
