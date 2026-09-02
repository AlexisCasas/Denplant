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
 *  2. If the clinician typed an evolución, POSTs a ClinicalNote
 *     (``note_type='appointment_clinical'``, ``owner_type='appointment'``)
 *     via the plain HTTP client — agenda does not import clinical_notes
 *     (see docs/technical/appointment-notes.md), so this calls the REST
 *     endpoint directly rather than reaching for that module's composable,
 *     same as this file already does for patients. Evolución is optional:
 *     no existing rule requires it, so an empty textarea skips this step.
 *  3. Transitions the appointment to ``completed``.
 *
 * The note POST isn't idempotent server-side, so a retry after step 2
 * succeeded but step 3 failed must not re-create it — ``createdNoteId``
 * (from the composable, reset only when a fresh gate session opens) guards
 * that.
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
      const noteResponse = await api.post<ApiResponse<{ id: string }>>(
        '/api/v1/clinical_notes/notes',
        {
          note_type: 'appointment_clinical',
          owner_type: 'appointment',
          owner_id: apt.id,
          body: noteBody
        }
      )
      createdNoteId.value = noteResponse.data.id
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
