<script setup lang="ts">
import { ageFromBirthDate, formatDraftDate, injectBudgetDraft } from '../../../composables/useBudgetDraft'

const { t, locale } = useI18n()
const draft = injectBudgetDraft()

const age = computed(() => ageFromBirthDate(draft.patient.value?.date_of_birth))
const validity = computed(() => {
  const from = formatDraftDate(draft.form.valid_from, locale.value)
  const until = formatDraftDate(draft.form.valid_until, locale.value)
  return until ? `${from} – ${until}` : `${from} · ${t('budget.noExpiry')}`
})
</script>

<template>
  <UCard v-if="draft.patient.value">
    <div class="flex flex-wrap items-center gap-x-8 gap-y-3">
      <div class="flex items-center gap-3 min-w-0">
        <UIcon
          name="i-lucide-user-round"
          class="w-6 h-6 shrink-0 text-[var(--color-primary)]"
        />
        <div class="min-w-0">
          <p class="text-caption text-subtle">
            {{ t('budget.patient') }}
          </p>
          <p class="font-semibold text-default truncate">
            {{ draft.patient.value.first_name }} {{ draft.patient.value.last_name }}
          </p>
        </div>
      </div>
      <div v-if="draft.patientDocument.value">
        <p class="text-caption text-subtle">
          {{ t('budget.wizard.document') }}
        </p>
        <p class="text-default">
          {{ draft.patientDocument.value }}
        </p>
      </div>
      <div v-if="age !== null">
        <p class="text-caption text-subtle">
          {{ t('budget.wizard.age') }}
        </p>
        <p class="text-default">
          {{ t('budget.wizard.ageYears', { n: age }) }}
        </p>
      </div>
      <div>
        <p class="text-caption text-subtle">
          {{ t('budget.wizard.validity') }}
        </p>
        <p class="text-default">
          <UIcon
            name="i-lucide-calendar"
            class="w-4 h-4 align-text-bottom"
          />
          {{ validity }}
        </p>
      </div>
      <UBadge
        color="neutral"
        variant="subtle"
        class="sm:ml-auto"
      >
        {{ t('budget.status.draft') }}
      </UBadge>
    </div>
  </UCard>
</template>
