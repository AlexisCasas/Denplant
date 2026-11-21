import { describe, expect, it } from 'vitest'
import { resolveDefaultLanding } from '~/utils/defaultLanding'

const agenda = [{ name: 'agenda' }]
const appointmentRead = ['agenda.appointments.read']

describe('resolveDefaultLanding', () => {
  it('sends users with active Agenda and read access to appointments', () => {
    expect(resolveDefaultLanding({ activeModules: agenda, permissions: appointmentRead })).toBe('/appointments')
  })

  it('falls back to the dashboard without the Agenda permission', () => {
    expect(resolveDefaultLanding({ activeModules: agenda, permissions: [] })).toBe('/dashboard')
  })

  it('falls back to the dashboard when Agenda is disabled', () => {
    expect(resolveDefaultLanding({ activeModules: [{ name: 'patients' }], permissions: appointmentRead })).toBe('/dashboard')
  })

  it('falls back to the dashboard while module availability is unknown', () => {
    expect(resolveDefaultLanding({ activeModules: null, permissions: appointmentRead })).toBe('/dashboard')
  })
})
