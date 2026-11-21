<script setup lang="ts">
/**
 * "Which treatments were done" + evolución clínica gate, shown before an
 * appointment linked to treatment-plan items transitions to ``completed``.
 * Mounted once at the agenda page level (like ``CompletionFollowupHost``)
 * so both the dropdown path and the kanban drag-drop path share the same
 * UI.
 *
 * On confirm, in order (each step must succeed before the next starts —
 * the appointment does NOT transition to completed until the writes
 * before it are done):
 *  1. PATCHes ``completed_in_appointment`` on each checked
 *     ``AppointmentTreatment`` (the existing visit-note endpoint — no new
 *     backend surface). The treatment_plan module's
 *     ``on_appointment_completed`` handler reads that flag to decide, per
 *     item, whether to advance the linked PlannedTreatmentItem — items
 *     left unchecked (or not linked to this appointment at all) stay
 *     untouched.
 *  2. If the clinician typed an evolución, finds-or-creates a ClinicalNote
 *     (``note_type='appointment_clinical'``, ``owner_type='appointment'``)
 *     via the plain HTTP client — agenda does not import clinical_notes
 *     (see docs/technical/appointment-notes.md), so this calls the REST
 *     endpoint directly rather than reaching for that module's composable,
 *     same as this file already does for patients. Evolución is optional:
 *     no existing rule requires it, so an empty textarea skips this step.
 *  3. Transitions the appointment to ``completed``.
 *
 * Idempotency (server-side, not just frontend state): ClinicalNote has no
 * per-owner uniqueness — ``appointment_clinical`` is a general feed, a
 * professional can legitimately log several notes on the same appointment
 * over time, so a DB constraint would be wrong here and there is no schema
 * change available to distinguish "the completion note" from any other.
 * Step 2 instead looks up existing appointment_clinical notes for this
 * appointment and reuses one whose body matches exactly instead of
 * creating a new one. That covers retry-after-timeout, a page refresh,
 * and a second frontend instance resubmitting the same text — all of
 * which re-query the server instead of trusting local state — as long as
 * the resubmitted text is byte-identical; ``createdNoteId`` (from the
 * composable) just short-circuits the lookup within the same gate
 * session. A genuinely different retyped note is — correctly, per the
 * feed semantics — a second entry, not a duplicate.
 */
import type { ApiResponse } from '~~/app/types'
import { errorDetail } from '~~/app/utils/error'

const { t, locale } = useI18n()
const toast = useToast()
const api = useApi()
const { transition } = useAppointments()
const completionFollowup = useCompletionFollowup()
const {
  open,
  appointment,
  selections,
  evolutionNote,
  createdNoteId,
  dismiss
} = useAppointmentCompletionGate()

const isBusy = ref(false)
const treatments = computed(() => appointment.value?.treatments ?? [])

function treatmentLabel(t2: (typeof treatments.value)[number]): string {
  const name = t2.names?.[locale.value] || t2.names?.es || t2.internal_code
  return t2.tooth_number ? `#${t2.tooth_number} — ${name}` : name
}

/**
 * Server-side find-or-create: re-queries the appointment's existing
 * appointment_clinical notes and reuses one with an exact body match
 * instead of trusting local state. See the module docblock above for why
 * exact-body match (not a DB constraint) is the right idempotency
 * boundary here.
 */
async function findOrCreateEvolutionNote(appointmentId: string, body: string): Promise<string> {
  const existing = await api.get<ApiResponse<Array<{ id: string, note_type: string, body: string }>>>(
    `/api/v1/clinical_notes/notes?owner_type=appointment&owner_id=${appointmentId}`
  )
  const match = existing.data.find(n => n.note_type === 'appointment_clinical' && n.body === body)
  if (match) return match.id

  const created = await api.post<ApiResponse<{ id: string }>>(
    '/api/v1/clinical_notes/notes',
    {
      note_type: 'appointment_clinical',
      owner_type: 'appointment',
      owner_id: appointmentId,
      body
    }
  )
  return created.data.id
}

async function confirm() {
  const apt = appointment.value
  if (!apt) return
  isBusy.value = true
  try {
    const toMark = treatments.value.filter(item => selections.value[item.id])
    await Promise.all(
      toMark.map(item =>
        api.patch(`/api/v1/agenda/appointment-treatments/${item.id}`, {
          completed_in_appointment: true
        })
      )
    )

    const noteBody = evolutionNote.value.trim()
    if (noteBody && !createdNoteId.value) {
      createdNoteId.value = await findOrCreateEvolutionNote(apt.id, noteBody)
    }

    const updated = await transition(apt.id, 'completed')
    dismiss()
    completionFollowup.trigger(updated)
  } catch (e) {
    toast.add({
      title: t('appointments.transitionFailed'),
      description: errorDetail(e),
      color: 'error'
    })
  } finally {
    isBusy.value = false
  }
}
</script>

<template>
  <UModal
    :open="open"
    :title="t('appointments.completionGate.title')"
    @update:open="(v: boolean) => { if (!v) dismiss() }"
  >
    <template #body>
      <div class="space-y-4 p-4">
        <div class="space-y-2">
          <p class="text-sm text-subtle">
            {{ t('appointments.completionGate.description') }}
          </p>
          <label
            v-for="item in treatments"
            :key="item.id"
            class="flex items-center gap-2.5 p-2 rounded-lg border border-default"
          >
            <UCheckbox v-model="selections[item.id]" />
            <span class="text-sm text-default">{{ treatmentLabel(item) }}</span>
          </label>
        </div>

        <UFormField :label="t('appointments.completionGate.evolutionLabel')">
          <UTextarea
            v-model="evolutionNote"
            :placeholder="t('appointments.completionGate.evolutionPlaceholder')"
            :rows="3"
            :maxlength="4000"
            :disabled="isBusy"
            class="w-full"
          />
        </UFormField>
      </div>
    </template>
    <template #footer>
      <div class="flex justify-end gap-2 p-2">
        <UButton
          color="neutral"
          variant="ghost"
          :disabled="isBusy"
          @click="dismiss"
        >
          {{ t('actions.cancel') }}
        </UButton>
        <UButton
          color="primary"
          :loading="isBusy"
          @click="confirm"
        >
          {{ t('appointments.transitions.completed') }}
        </UButton>
      </div>
    </template>
  </UModal>
</template>
