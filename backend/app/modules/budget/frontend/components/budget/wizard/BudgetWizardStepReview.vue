<script setup lang="ts">
import { formatDraftDate, injectBudgetDraft } from '../../../composables/useBudgetDraft'

defineProps<{ creating: boolean }>()
const emit = defineEmits<{ back: [], create: [], cancel: [] }>()

const { t, locale } = useI18n()
const draft = injectBudgetDraft()

const validityLabel = computed(() => {
  const from = formatDraftDate(draft.form.valid_from, locale.value)
  const until = formatDraftDate(draft.form.valid_until, locale.value)
  return until ? `${from} – ${until}` : `${from} · ${t('budget.noExpiry')}`
})
</script>

<template>
  <div class="space-y-6">
    <div class="grid grid-cols-1 lg:grid-cols-[1fr_22rem] gap-6 items-start">
      <div class="space-y-6 min-w-0">
        <BudgetWizardPatientBar />

        <UCard>
          <template #header>
            <div class="flex items-center gap-2">
              <UIcon
                name="i-lucide-stethoscope"
                class="w-5 h-5 text-[var(--color-primary)]"
              />
              <h2 class="text-h2 text-default">
                {{ t('budget.wizard.reviewItemsTitle', { n: draft.items.value.length }) }}
              </h2>
            </div>
          </template>
          <BudgetDraftItemsTable
            v-if="draft.items.value.length"
            :items="draft.items.value"
          />
          <p
            v-else
            class="text-center text-subtle py-6"
          >
            {{ t('budget.wizard.noItemsYet') }}
          </p>
        </UCard>

        <UCard>
          <template #header>
            <div class="flex items-center gap-2">
              <UIcon
                name="i-lucide-file-text"
                class="w-5 h-5 text-[var(--color-primary)]"
              />
              <h2 class="text-h2 text-default">
                {{ t('budget.wizard.notesTitle') }}
              </h2>
            </div>
          </template>
          <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <p class="text-caption text-subtle mb-1">
                {{ t('budget.patientNotes') }}
              </p>
              <p class="rounded-lg border border-default p-3 text-body whitespace-pre-line min-h-16">
                <template v-if="draft.form.patient_notes">
                  {{ draft.form.patient_notes }}
                </template>
                <span
                  v-else
                  class="text-subtle"
                >{{ t('budget.wizard.noNotes') }}</span>
              </p>
            </div>
            <div>
              <p class="text-caption text-subtle mb-1">
                {{ t('budget.internalNotes') }}
              </p>
              <p class="rounded-lg border border-default p-3 text-body whitespace-pre-line min-h-16">
                <template v-if="draft.form.internal_notes">
                  {{ draft.form.internal_notes }}
                </template>
                <span
                  v-else
                  class="text-subtle"
                >{{ t('budget.wizard.noNotes') }}</span>
              </p>
            </div>
          </div>
        </UCard>
      </div>

      <aside class="space-y-4 lg:sticky lg:top-4">
        <UCard>
          <template #header>
            <h2 class="text-h2 text-default">
              {{ t('budget.wizard.summaryTitle') }}
            </h2>
          </template>
          <dl class="space-y-3 mb-4">
            <div class="flex justify-between gap-4">
              <dt class="text-muted">
                {{ t('budget.patient') }}
              </dt>
              <dd class="text-default text-right font-medium">
                {{ draft.patient.value?.first_name }} {{ draft.patient.value?.last_name }}
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
          <hr class="border-default mb-4">
          <BudgetWizardTotals />
          <div class="mt-4 flex gap-2 rounded-lg bg-[color-mix(in_srgb,var(--color-primary-soft)_35%,transparent)] p-3 text-caption text-default">
            <UIcon
              name="i-lucide-info"
              class="w-4 h-4 shrink-0 mt-0.5 text-[var(--color-primary)]"
            />
            <span>{{ t('budget.wizard.reviewHint') }}</span>
          </div>
        </UCard>
      </aside>
    </div>

    <div class="flex flex-wrap items-center justify-between gap-3 pt-4 border-t border-default">
      <UButton
        variant="outline"
        color="neutral"
        icon="i-lucide-arrow-left"
        :disabled="creating"
        @click="emit('back')"
      >
        {{ t('budget.wizard.backToItems') }}
      </UButton>
      <div class="flex gap-3">
        <UButton
          variant="outline"
          color="neutral"
          :disabled="creating"
          @click="emit('cancel')"
        >
          {{ t('common.cancel') }}
        </UButton>
        <UButton
          color="primary"
          variant="solid"
          icon="i-lucide-check"
          :loading="creating"
          @click="emit('create')"
        >
          {{ t('budget.wizard.create') }}
        </UButton>
      </div>
    </div>
  </div>
</template>
