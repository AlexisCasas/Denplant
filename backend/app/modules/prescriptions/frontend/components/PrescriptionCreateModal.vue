<script setup lang="ts">
/**
 * PrescriptionCreateModal — write a prescription and issue it.
 *
 * Three steps in one dialog, so focus never has to hop between two:
 *
 * - `form`     the validity and the medications;
 * - `confirm`  "once issued it cannot be edited" — **no request is made before
 *              the user confirms here**;
 * - `discard`  "your changes will be lost", when closing a form that has text.
 *
 * The draft lives in this component and nowhere else (no store, no storage, no
 * server): the parent mounts it with `v-if`, so closing it or changing patient
 * destroys the draft with it. A failed request leaves the form as it was.
 *
 * The header (patient, dentist, registration number, clinic) is read-only and
 * is never sent: only `valid_until` and `items` leave this component, and the
 * patient is added by whoever makes the request.
 */

import type { PrescriptionCreatePayload, WriteError } from '../types/prescriptions'
import { usePrescriptionDraft } from '../composables/usePrescriptionDraft'
import { createErrorKey, MAX_ITEMS } from '../utils/prescriptionForm'
import PrescriptionItemFields from './PrescriptionItemFields.vue'

const props = defineProps<{
  patientName: string | null
  prescriberName: string
  professionalId: string
  clinicName: string | null
  submitting: boolean
  error: WriteError | null
}>()

const emit = defineEmits<{
  close: []
  submit: [body: Omit<PrescriptionCreatePayload, 'patient_id'>]
}>()

const { t } = useI18n()
const draft = usePrescriptionDraft()
const { validUntil, items, errors, canAdd, canRemove } = draft

type Step = 'form' | 'confirm' | 'discard'
const step = ref<Step>('form')
const body = ref<HTMLElement | null>(null)

const title = computed(() => {
  if (step.value === 'confirm') return t('prescriptions.create.confirm.title')
  if (step.value === 'discard') return t('prescriptions.create.discard.title')
  return t('prescriptions.create.title')
})

const description = computed(() => {
  if (step.value === 'confirm') return t('prescriptions.create.confirm.text')
  if (step.value === 'discard') return t('prescriptions.create.discard.text')
  return t('prescriptions.create.description')
})

const errorMessage = computed(() =>
  props.error ? t(`prescriptions.create.errors.${createErrorKey(props.error)}`) : null
)

const validUntilMessage = computed(() => {
  switch (errors.value.validUntil) {
    case 'required': return t('prescriptions.create.validation.validUntilRequired')
    case 'invalid': return t('prescriptions.create.validation.validUntilInvalid')
    case 'beforeIssue': return t('prescriptions.create.errors.valid_until_before_issue_date')
    default: return undefined
  }
})

// A refused request: back to the form, with everything still typed in.
watch(() => props.error, (failure) => {
  if (!failure) return
  step.value = 'form'
  if (failure.code === 'valid_until_before_issue_date') draft.rejectValidUntil()
})

function focusFirstField(): void {
  body.value?.querySelector<HTMLElement>('[data-testid="prescription-create-valid-until"] input')?.focus()
}

async function focusFirstInvalid(): Promise<void> {
  await nextTick()
  body.value?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus()
}

async function addItem(): Promise<void> {
  const key = draft.addItem()
  if (key === null) return
  await nextTick()
  body.value?.querySelector<HTMLElement>(`[data-item-key="${key}"] input`)?.focus()
}

/** Every way out of the dialog (button, Escape, overlay) goes through here. */
function requestClose(): void {
  if (props.submitting) return
  if (step.value !== 'form') {
    step.value = 'form'
    return
  }
  if (draft.dirty.value) step.value = 'discard'
  else emit('close')
}

function review(): void {
  if (!draft.validate()) {
    void focusFirstInvalid()
    return
  }
  step.value = 'confirm'
}

function issue(): void {
  if (props.submitting) return
  emit('submit', draft.body())
}
</script>

<template>
  <UModal
    :open="true"
    :title="title"
    :description="description"
    :dismissible="!submitting"
    :ui="{ content: 'sm:max-w-3xl' }"
    @update:open="$event || requestClose()"
    @after:enter="focusFirstField"
  >
    <template #body>
      <div
        ref="body"
        class="max-h-[70vh] overflow-y-auto pr-1"
        data-testid="prescription-create"
      >
        <!-- 1. the form -->
        <div
          v-show="step === 'form'"
          class="space-y-5"
        >
          <UAlert
            v-if="errorMessage"
            color="error"
            variant="subtle"
            icon="i-lucide-triangle-alert"
            role="alert"
            :title="errorMessage"
            data-testid="prescription-create-error"
          />

          <dl class="grid grid-cols-1 gap-x-4 gap-y-2 text-sm sm:grid-cols-2 rounded-token-md bg-surface-muted p-3">
            <div v-if="patientName">
              <dt class="text-caption text-subtle">
                {{ t('prescriptions.create.header.patient') }}
              </dt>
              <dd data-testid="prescription-create-patient">
                {{ patientName }}
              </dd>
            </div>
            <div>
              <dt class="text-caption text-subtle">
                {{ t('prescriptions.create.header.prescriber') }}
              </dt>
              <dd data-testid="prescription-create-prescriber">
                {{ prescriberName }}
              </dd>
            </div>
            <div>
              <dt class="text-caption text-subtle">
                {{ t('prescriptions.create.header.professionalId') }}
              </dt>
              <dd data-testid="prescription-create-professional-id">
                {{ professionalId }}
              </dd>
            </div>
            <div v-if="clinicName">
              <dt class="text-caption text-subtle">
                {{ t('prescriptions.create.header.clinic') }}
              </dt>
              <dd data-testid="prescription-create-clinic">
                {{ clinicName }}
              </dd>
            </div>
          </dl>

          <p class="text-caption text-subtle">
            {{ t('prescriptions.create.requiredNote') }}
          </p>

          <div data-testid="prescription-create-valid-until">
            <UFormField
              :label="t('prescriptions.create.validUntil')"
              name="valid_until"
              required
              :help="t('prescriptions.create.validUntilHint')"
              :error="validUntilMessage"
              class="sm:max-w-xs"
            >
              <UInput
                type="date"
                :model-value="validUntil"
                :disabled="submitting"
                required
                class="w-full"
                @update:model-value="draft.setValidUntil(String($event ?? ''))"
              />
            </UFormField>
          </div>

          <section aria-labelledby="rx-create-medications">
            <h3
              id="rx-create-medications"
              class="text-sm font-semibold text-default mb-2"
            >
              {{ t('prescriptions.create.medications') }}
            </h3>
            <div class="space-y-3">
              <PrescriptionItemFields
                v-for="(item, index) in items"
                :key="item.key"
                :item="item"
                :number="index + 1"
                :errors="errors.items[item.key]"
                :can-remove="canRemove"
                :disabled="submitting"
                @update="(field, value) => draft.setField(item.key, field, value)"
                @remove="draft.removeItem(item.key)"
              />
            </div>
            <div class="mt-3 flex items-center gap-3 flex-wrap">
              <UButton
                color="neutral"
                variant="outline"
                icon="i-lucide-plus"
                :disabled="!canAdd || submitting"
                data-testid="prescription-create-add"
                @click="addItem"
              >
                {{ t('prescriptions.create.addMedication') }}
              </UButton>
              <span
                v-if="!canAdd"
                class="text-caption text-subtle"
                data-testid="prescription-create-max"
              >
                {{ t('prescriptions.create.maxItems', { max: MAX_ITEMS }) }}
              </span>
            </div>
          </section>

          <p
            v-if="errors.any"
            class="text-sm text-error"
            role="alert"
            data-testid="prescription-create-summary"
          >
            {{ t('prescriptions.create.summary') }}
          </p>
        </div>

        <!-- 2. the confirmation: nothing has been sent yet -->
        <div
          v-if="step === 'confirm'"
          class="space-y-3"
          role="group"
          aria-labelledby="rx-create-confirm-title"
          data-testid="prescription-create-confirm"
        >
          <h3
            id="rx-create-confirm-title"
            class="text-base font-semibold text-default"
          >
            {{ t('prescriptions.create.confirm.title') }}
          </h3>
          <UAlert
            color="warning"
            variant="subtle"
            icon="i-lucide-lock"
            :description="t('prescriptions.create.confirm.text')"
            data-testid="prescription-create-confirm-text"
          />
        </div>

        <!-- 3. closing with text typed -->
        <div
          v-if="step === 'discard'"
          class="space-y-3"
          role="group"
          aria-labelledby="rx-create-discard-title"
          data-testid="prescription-create-discard"
        >
          <h3
            id="rx-create-discard-title"
            class="text-base font-semibold text-default"
          >
            {{ t('prescriptions.create.discard.title') }}
          </h3>
          <p class="text-sm">
            {{ t('prescriptions.create.discard.text') }}
          </p>
        </div>
      </div>
    </template>

    <template #footer>
      <div class="flex flex-wrap justify-end gap-2 w-full">
        <template v-if="step === 'form'">
          <UButton
            color="neutral"
            variant="ghost"
            :disabled="submitting"
            data-testid="prescription-create-cancel"
            @click="requestClose"
          >
            {{ t('prescriptions.actions.cancel') }}
          </UButton>
          <UButton
            icon="i-lucide-file-check"
            :disabled="submitting"
            data-testid="prescription-create-review"
            @click="review"
          >
            {{ t('prescriptions.create.issue') }}
          </UButton>
        </template>

        <template v-else-if="step === 'confirm'">
          <UButton
            color="neutral"
            variant="ghost"
            :disabled="submitting"
            data-testid="prescription-create-back"
            @click="step = 'form'"
          >
            {{ t('prescriptions.create.confirm.back') }}
          </UButton>
          <UButton
            icon="i-lucide-file-check"
            :loading="submitting"
            :disabled="submitting"
            data-testid="prescription-create-submit"
            @click="issue"
          >
            {{ t('prescriptions.create.issue') }}
          </UButton>
        </template>

        <template v-else>
          <UButton
            color="neutral"
            variant="ghost"
            data-testid="prescription-create-keep"
            @click="step = 'form'"
          >
            {{ t('prescriptions.create.discard.keep') }}
          </UButton>
          <UButton
            color="error"
            data-testid="prescription-create-discard-confirm"
            @click="emit('close')"
          >
            {{ t('prescriptions.create.discard.confirm') }}
          </UButton>
        </template>
      </div>
    </template>
  </UModal>
</template>
