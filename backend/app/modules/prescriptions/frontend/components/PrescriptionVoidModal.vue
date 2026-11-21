<script setup lang="ts">
/**
 * PrescriptionVoidModal — void an issued prescription, with a reason.
 *
 * Voiding cannot be undone, so it is its own dialog with its own heading and
 * warning, never a button that acts on the first click. The reason is required
 * (trimmed, 1 to 2000 characters) and has no default and no suggestions.
 *
 * Mounted with `v-if` by the parent: closing it, or changing patient, destroys
 * what was typed. Only `reason` leaves this component.
 */

import type { WriteError } from '../types/prescriptions'
import { MAX_REASON, voidErrorKey } from '../utils/prescriptionForm'

const props = defineProps<{
  number: string
  voiding: boolean
  error: WriteError | null
}>()

const emit = defineEmits<{
  close: []
  submit: [reason: string]
}>()

const { t } = useI18n()

const reason = ref('')
const missing = ref(false)

const reasonMessage = computed(() => {
  if (missing.value || props.error?.code === 'void_reason_required') {
    return t('prescriptions.void.reasonRequired')
  }
  return undefined
})

// Other failures are shown as a notice; the reason itself has its own message.
const errorMessage = computed(() => {
  if (!props.error || props.error.code === 'void_reason_required') return null
  return t(`prescriptions.void.errors.${voidErrorKey(props.error)}`)
})

function onInput(value: string): void {
  reason.value = value
  if (value.trim()) missing.value = false
}

function submit(): void {
  if (props.voiding) return
  const text = reason.value.trim()
  if (!text) {
    missing.value = true
    return
  }
  emit('submit', text.slice(0, MAX_REASON))
}

function onOpenChange(open: boolean): void {
  if (!open && !props.voiding) emit('close')
}
</script>

<template>
  <UModal
    :open="true"
    :title="t('prescriptions.void.title')"
    :description="t('prescriptions.void.description', { number })"
    :dismissible="!voiding"
    @update:open="onOpenChange"
  >
    <template #body>
      <div
        class="space-y-4"
        data-testid="prescription-void"
      >
        <UAlert
          color="error"
          variant="subtle"
          icon="i-lucide-triangle-alert"
          :title="t('prescriptions.void.warning')"
          data-testid="prescription-void-warning"
        />

        <UAlert
          v-if="errorMessage"
          color="warning"
          variant="subtle"
          icon="i-lucide-info"
          role="alert"
          :title="errorMessage"
          data-testid="prescription-void-error"
        />

        <div data-testid="prescription-void-reason">
          <UFormField
            :label="t('prescriptions.void.reason')"
            name="reason"
            required
            :error="reasonMessage"
            :hint="t('prescriptions.create.counter', { count: reason.length, max: MAX_REASON })"
            class="w-full"
          >
            <UTextarea
              :model-value="reason"
              :maxlength="MAX_REASON"
              :rows="4"
              :disabled="voiding"
              autofocus
              class="w-full"
              @update:model-value="onInput(String($event ?? ''))"
            />
          </UFormField>
        </div>
      </div>
    </template>

    <template #footer>
      <div class="flex flex-wrap justify-end gap-2 w-full">
        <UButton
          color="neutral"
          variant="ghost"
          :disabled="voiding"
          data-testid="prescription-void-cancel"
          @click="emit('close')"
        >
          {{ t('prescriptions.actions.cancel') }}
        </UButton>
        <UButton
          color="error"
          icon="i-lucide-ban"
          :loading="voiding"
          :disabled="voiding"
          data-testid="prescription-void-submit"
          @click="submit"
        >
          {{ t('prescriptions.void.confirm') }}
        </UButton>
      </div>
    </template>
  </UModal>
</template>
