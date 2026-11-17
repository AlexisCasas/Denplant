<script setup lang="ts">
import type { ApiResponse } from '~~/app/types'
import { ageFromBirthDate, formatDraftDate, injectBudgetDraft } from '../../../composables/useBudgetDraft'

const emit = defineEmits<{ next: [], cancel: [] }>()

const { t, locale } = useI18n()
const api = useApi()
const draft = injectBudgetDraft()

const submitted = ref(false)

// DNI/passport only exists on the "extended" patient endpoint (patients.read).
// A failure just hides the field — it never blocks the budget.
watch(() => draft.patient.value?.id, async (id) => {
  draft.patientDocument.value = null
  if (!id) return
  try {
    const res = await api.get<ApiResponse<{ national_id?: string | null }>>(`/api/v1/patients/${id}/extended`)
    if (draft.patient.value?.id === id) draft.patientDocument.value = res.data.national_id || null
  } catch {
    draft.patientDocument.value = null
  }
}, { immediate: true })

const age = computed(() => ageFromBirthDate(draft.patient.value?.date_of_birth))
const errors = computed(() => (submitted.value ? draft.dataErrors.value : {}))

function next() {
  submitted.value = true
  if (Object.keys(draft.dataErrors.value).length === 0) emit('next')
}

const validityLabel = computed(() => {
  const from = formatDraftDate(draft.form.valid_from, locale.value)
  const until = formatDraftDate(draft.form.valid_until, locale.value)
  if (!from) return '—'
  return until ? `${from} – ${until}` : `${from} · ${t('budget.noExpiry')}`
})
</script>

<template>
  <form
    class="space-y-6"
    novalidate
    @submit.prevent="next"
  >
    <div class="grid grid-cols-1 lg:grid-cols-[1fr_20rem] gap-6 items-start">
      <div class="space-y-6 min-w-0">
        <!-- Patient -->
        <UCard>
          <template #header>
            <div class="flex items-center gap-2">
              <UIcon
                name="i-lucide-user-round"
                class="w-5 h-5 text-[var(--color-primary)]"
              />
              <h2 class="text-h2 text-default">
                {{ t('budget.patient') }}
              </h2>
            </div>
          </template>
          <div class="grid grid-cols-1 md:grid-cols-[1fr_auto] gap-4 items-start">
            <UFormField
              :error="errors.patient ? t('budget.wizard.errors.patient') : undefined"
              required
            >
              <PatientVisualSelector
                v-model="draft.patient.value"
                class="[&_[data-slot=root]:has([data-testid=visual-selector-input])]:w-full"
                :placeholder="t('budget.selectPatient')"
              />
              <p class="text-caption text-subtle mt-1">
                {{ t('budget.selectPatientHint') }}
              </p>
            </UFormField>
            <dl
              v-if="draft.patient.value"
              class="flex flex-wrap gap-x-6 gap-y-2"
            >
              <div v-if="draft.patientDocument.value">
                <dt class="text-caption text-subtle">
                  {{ t('budget.wizard.document') }}
                </dt>
                <dd class="text-default">
                  {{ draft.patientDocument.value }}
                </dd>
              </div>
              <div v-if="draft.patient.value.phone">
                <dt class="text-caption text-subtle">
                  {{ t('budget.wizard.phone') }}
                </dt>
                <dd class="text-default">
                  {{ draft.patient.value.phone }}
                </dd>
              </div>
              <div v-if="age !== null">
                <dt class="text-caption text-subtle">
                  {{ t('budget.wizard.age') }}
                </dt>
                <dd class="text-default">
                  {{ t('budget.wizard.ageYears', { n: age }) }}
                </dd>
              </div>
            </dl>
          </div>
        </UCard>

        <!-- Validity -->
        <UCard>
          <template #header>
            <div class="flex items-center gap-2">
              <UIcon
                name="i-lucide-calendar"
                class="w-5 h-5 text-[var(--color-primary)]"
              />
              <h2 class="text-h2 text-default">
                {{ t('budget.wizard.validityTitle') }}
              </h2>
            </div>
          </template>
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <UFormField
              :label="t('budget.validFrom')"
              :error="errors.valid_from ? t('budget.wizard.errors.validFrom') : undefined"
              required
            >
              <UInput
                v-model="draft.form.valid_from"
                type="date"
                class="w-full"
              />
            </UFormField>
            <UFormField
              :label="t('budget.validUntil')"
              :error="errors.valid_until ? t('budget.wizard.errors.validUntil') : undefined"
            >
              <UInput
                v-model="draft.form.valid_until"
                type="date"
                class="w-full"
              />
              <p class="text-caption text-subtle mt-1">
                {{ t('budget.validUntilHint') }}
              </p>
            </UFormField>
          </div>
        </UCard>

        <!-- Notes -->
        <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
          <UCard>
            <template #header>
              <div class="flex items-center gap-2">
                <UIcon
                  name="i-lucide-file-text"
                  class="w-5 h-5 text-[var(--color-primary)]"
                />
                <h2 class="text-h3 text-default">
                  {{ t('budget.patientNotes') }}
                </h2>
              </div>
            </template>
            <UTextarea
              v-model="draft.form.patient_notes"
              :placeholder="t('budget.wizard.patientNotesPlaceholder')"
              :rows="4"
              class="w-full"
            />
          </UCard>
          <UCard>
            <template #header>
              <div class="flex items-center gap-2">
                <UIcon
                  name="i-lucide-lock"
                  class="w-5 h-5 text-[var(--color-primary)]"
                />
                <h2 class="text-h3 text-default">
                  {{ t('budget.internalNotes') }}
                </h2>
              </div>
            </template>
            <UTextarea
              v-model="draft.form.internal_notes"
              :placeholder="t('budget.wizard.internalNotesPlaceholder')"
              :rows="4"
              class="w-full"
            />
          </UCard>
        </div>
      </div>

      <!-- Summary -->
      <aside class="lg:sticky lg:top-4">
        <UCard>
          <template #header>
            <h2 class="text-h2 text-default">
              {{ t('budget.wizard.summaryTitle') }}
            </h2>
          </template>
          <dl class="space-y-3">
            <div class="flex justify-between gap-4">
              <dt class="text-muted">
                {{ t('budget.patient') }}
              </dt>
              <dd class="text-default text-right font-medium">
                {{ draft.patient.value ? `${draft.patient.value.first_name} ${draft.patient.value.last_name}` : '—' }}
              </dd>
            </div>
            <div class="flex justify-between gap-4">
              <dt class="text-muted">
                {{ t('budget.wizard.validity') }}
              </dt>
              <dd class="text-default text-right">
                {{ validityLabel }}
              </dd>
            </div>
            <div class="flex justify-between gap-4">
              <dt class="text-muted">
                {{ t('budget.status.title') }}
              </dt>
              <dd>
                <UBadge
                  color="neutral"
                  variant="subtle"
                >
                  {{ t('budget.status.draft') }}
                </UBadge>
              </dd>
            </div>
          </dl>
          <div class="mt-4 flex gap-2 rounded-lg bg-[color-mix(in_srgb,var(--color-primary-soft)_35%,transparent)] p-3 text-caption text-default">
            <UIcon
              name="i-lucide-info"
              class="w-4 h-4 shrink-0 mt-0.5 text-[var(--color-primary)]"
            />
            <span>{{ t('budget.wizard.nextStepHint') }}</span>
          </div>
        </UCard>
      </aside>
    </div>

    <div class="flex justify-end gap-3 pt-4 border-t border-default">
      <UButton
        variant="outline"
        color="neutral"
        @click="emit('cancel')"
      >
        {{ t('common.cancel') }}
      </UButton>
      <UButton
        type="submit"
        color="primary"
        variant="solid"
        trailing-icon="i-lucide-arrow-right"
      >
        {{ t('budget.wizard.continueToItems') }}
      </UButton>
    </div>
  </form>
</template>
