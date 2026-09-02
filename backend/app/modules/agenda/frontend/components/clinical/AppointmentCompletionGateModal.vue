<script setup lang="ts">
/**
 * "Which treatments were done" gate, shown before an appointment linked
 * to treatment-plan items transitions to ``completed``. Mounted once at
 * the agenda page level (like ``CompletionFollowupHost``) so both the
 * dropdown path and the kanban drag-drop path share the same UI.
 *
 * On confirm: PATCHes ``completed_in_appointment`` on each checked
 * ``AppointmentTreatment`` (the existing visit-note endpoint — no new
 * backend surface), then transitions the appointment to ``completed``.
 * The treatment_plan module's ``on_appointment_completed`` handler reads
 * that flag to decide, per item, whether to mark the linked
 * PlannedTreatmentItem done — items left unchecked (or not linked to
 * this appointment at all) stay untouched.
 */
import { errorDetail } from '~~/app/utils/error'

const { t, locale } = useI18n()
const toast = useToast()
const api = useApi()
const { transition } = useAppointments()
const completionFollowup = useCompletionFollowup()
const { open, appointment, selections, dismiss } = useAppointmentCompletionGate()

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
      <div class="space-y-3 p-4">
        <p class="text-sm text-subtle">
          {{ t('appointments.completionGate.description') }}
        </p>
        <div class="space-y-2">
          <label
            v-for="item in treatments"
            :key="item.id"
            class="flex items-center gap-2.5 p-2 rounded-lg border border-default"
          >
            <UCheckbox v-model="selections[item.id]" />
            <span class="text-sm text-default">{{ treatmentLabel(item) }}</span>
          </label>
        </div>
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
