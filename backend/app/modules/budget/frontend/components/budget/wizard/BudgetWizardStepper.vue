<script setup lang="ts">
import type { BudgetWizardStep } from '../../../composables/useBudgetDraft'

const props = defineProps<{ step: BudgetWizardStep }>()
const emit = defineEmits<{ goto: [step: BudgetWizardStep] }>()

const { t } = useI18n()

const steps = computed(() => ([
  { n: 1, label: t('budget.wizard.steps.data') },
  { n: 2, label: t('budget.wizard.steps.items') },
  { n: 3, label: t('budget.wizard.steps.review') }
] as const))

function stateOf(n: number) {
  if (n < props.step) return 'done'
  if (n === props.step) return 'current'
  return 'future'
}
</script>

<template>
  <ol
    class="flex items-center justify-center gap-2 sm:gap-4"
    :aria-label="t('budget.wizard.stepperLabel')"
  >
    <template
      v-for="(s, i) in steps"
      :key="s.n"
    >
      <li
        class="flex items-center gap-2 min-w-0"
        :aria-current="stateOf(s.n) === 'current' ? 'step' : undefined"
      >
        <button
          type="button"
          class="flex items-center gap-2 min-w-0 rounded-full focus-visible:outline-2 focus-visible:outline-[var(--color-primary)]"
          :disabled="stateOf(s.n) !== 'done'"
          :class="stateOf(s.n) === 'done' ? 'cursor-pointer' : 'cursor-default'"
          @click="emit('goto', s.n)"
        >
          <span
            class="flex items-center justify-center w-8 h-8 rounded-full shrink-0 text-sm font-semibold"
            :class="{
              'bg-[var(--color-primary)] text-white': stateOf(s.n) !== 'future',
              'bg-surface-muted text-muted border border-default': stateOf(s.n) === 'future'
            }"
          >
            <UIcon
              v-if="stateOf(s.n) === 'done'"
              name="i-lucide-check"
              class="w-4 h-4"
            />
            <template v-else>{{ s.n }}</template>
          </span>
          <span
            class="hidden sm:inline text-body truncate"
            :class="stateOf(s.n) === 'current' ? 'text-default font-semibold' : 'text-muted'"
          >
            {{ s.label }}
          </span>
        </button>
      </li>
      <li
        v-if="i < steps.length - 1"
        class="h-px w-6 sm:w-24 shrink-0"
        :class="s.n < step ? 'bg-[var(--color-primary)]' : 'bg-[var(--color-border)]'"
        aria-hidden="true"
      />
    </template>
  </ol>
</template>
