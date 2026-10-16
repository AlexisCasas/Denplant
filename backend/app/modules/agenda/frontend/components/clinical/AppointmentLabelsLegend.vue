<script setup lang="ts">
import type { AppointmentLabel } from '~~/app/types'

const props = defineProps<{
  labels: readonly AppointmentLabel[]
  selectedLabelId: string | null
}>()

const emit = defineEmits<{
  select: [labelId: string | null]
}>()

const { t } = useI18n()

const activeLabels = computed(() => props.labels.filter(label => label.is_active))

function toggle(labelId: string) {
  emit('select', props.selectedLabelId === labelId ? null : labelId)
}
</script>

<template>
  <div
    v-if="activeLabels.length"
    class="flex items-center gap-2 overflow-x-auto no-scrollbar pb-3 min-w-0"
    role="group"
    :aria-label="t('appointments.labels.title')"
  >
    <span class="text-caption text-subtle shrink-0">{{ t('appointments.labels.title') }}</span>
    <button
      v-for="label in activeLabels"
      :key="label.id"
      type="button"
      class="inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-sm transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
      :class="selectedLabelId === label.id ? 'border-default bg-surface-muted font-medium text-default' : 'border-subtle text-muted hover:bg-surface-muted'"
      :aria-pressed="selectedLabelId === label.id"
      @click="toggle(label.id)"
    >
      <span class="size-2.5 rounded-full" :style="{ backgroundColor: label.color }" aria-hidden="true" />
      {{ label.name }}
    </button>
    <UButton
      v-if="selectedLabelId"
      size="xs"
      color="neutral"
      variant="ghost"
      icon="i-lucide-x"
      :aria-label="t('common.clear')"
      @click="emit('select', null)"
    >
      {{ t('common.clear') }}
    </UButton>
  </div>
</template>

<style scoped>
.no-scrollbar::-webkit-scrollbar { display: none; }
.no-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }
</style>
