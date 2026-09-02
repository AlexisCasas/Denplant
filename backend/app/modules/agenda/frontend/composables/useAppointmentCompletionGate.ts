import type { Appointment } from '~~/app/types'

/**
 * Singleton state for the "which treatments were actually done" gate
 * shown before an appointment linked to treatment-plan items transitions
 * to ``completed``.
 *
 * Completing an appointment only advances the ``PlannedTreatmentItem``s
 * whose ``AppointmentTreatment.completed_in_appointment`` flag is true
 * (see ``treatment_plan.events.on_appointment_completed``) — that flag
 * has no other UI writer, so without this gate completing an appointment
 * silently left every linked plan item pending forever. Every treatment
 * defaults to checked (the common case: everything planned for the visit
 * got done); the clinician unchecks anything that didn't happen.
 *
 * Appointments with no linked treatments skip the gate entirely — the
 * caller transitions straight to ``completed`` as before.
 *
 * Two call-sites, same as ``useCompletionFollowup``:
 *   - ``AppointmentQuickActions.vue`` — the per-card dropdown menu.
 *   - ``AppointmentKanbanView.vue`` — drag-drop into "Finalizadas".
 */
export function useAppointmentCompletionGate() {
  const open = useState<boolean>('agenda:completion-gate:open', () => false)
  const appointment = useState<Appointment | null>('agenda:completion-gate:appointment', () => null)
  const selections = useState<Record<string, boolean>>('agenda:completion-gate:selections', () => ({}))

  function request(apt: Appointment) {
    const treatments = apt.treatments ?? []
    appointment.value = apt
    selections.value = Object.fromEntries(treatments.map(t => [t.id, true]))
    open.value = true
  }

  function dismiss() {
    open.value = false
    appointment.value = null
  }

  return { open, appointment, selections, request, dismiss }
}
