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
  // Evolución clínica captured at completion time. Reused by the clinical_notes
  // mechanism (note_type='appointment_clinical', owner_type='appointment') — see
  // AppointmentCompletionGateModal.vue. Optional: no business rule found that
  // requires it, so an empty value skips note creation entirely.
  const evolutionNote = useState<string>('agenda:completion-gate:evolution-note', () => '')
  // Sticky guard against duplicate notes: the note-create call isn't
  // idempotent server-side, so if `confirm()` is retried after the note
  // POST succeeded but a later step (transition) failed, we must not
  // POST it again. Set once the note is created, cleared only when a
  // fresh gate session starts.
  const createdNoteId = useState<string | null>('agenda:completion-gate:created-note-id', () => null)

  function request(apt: Appointment) {
    const treatments = apt.treatments ?? []
    appointment.value = apt
    selections.value = Object.fromEntries(treatments.map(t => [t.id, true]))
    evolutionNote.value = ''
    createdNoteId.value = null
    open.value = true
  }

  function dismiss() {
    open.value = false
    appointment.value = null
  }

  return { open, appointment, selections, evolutionNote, createdNoteId, request, dismiss }
}
