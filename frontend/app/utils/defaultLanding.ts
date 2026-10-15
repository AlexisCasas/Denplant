import { PERMISSIONS } from '~/config/permissions'

export interface DefaultLandingContext {
  activeModules: ReadonlyArray<{ name: string }> | null
  permissions: readonly string[]
}

/**
 * Choose the home destination from server-provided module availability and
 * effective permissions. An unavailable (including not-yet-loaded) Agenda
 * deliberately falls back to the stable dashboard route.
 */
export function resolveDefaultLanding({ activeModules, permissions }: DefaultLandingContext): string {
  const agendaActive = activeModules?.some(module => module.name === 'agenda') ?? false
  const canReadAppointments = permissions.includes(PERMISSIONS.appointments.read)

  return agendaActive && canReadAppointments ? '/appointments' : '/dashboard'
}
