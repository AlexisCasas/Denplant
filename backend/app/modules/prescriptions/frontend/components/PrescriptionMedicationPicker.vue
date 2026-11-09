<script setup lang="ts">
import type { PrescriptionMedication } from '../types/prescriptions'

const props = defineProps<{
  disabled?: boolean
  favorites: PrescriptionMedication[]
  results: PrescriptionMedication[]
  loadingFavorites: boolean
  searching: boolean
  favoritesError: boolean
  searchError: boolean
}>()
const emit = defineEmits<{
  select: [medication: PrescriptionMedication]
  search: [query: string]
}>()
const { t } = useI18n()
const query = ref('')

function label(medication: PrescriptionMedication): string {
  return [medication.active_ingredient, medication.strength].filter(Boolean).join(' ')
}

function choose(medication: PrescriptionMedication): void {
  emit('select', medication)
  query.value = ''
  emit('search', '')
}
</script>

<template>
  <div class="space-y-2 rounded-token-md bg-surface-muted p-3" data-testid="prescription-medication-picker">
    <div class="flex items-center justify-between gap-2">
      <h4 class="text-sm font-medium text-default">{{ t('prescriptions.create.favorites.title') }}</h4>
      <span v-if="loadingFavorites" class="text-caption text-subtle">{{ t('prescriptions.create.favorites.loading') }}</span>
    </div>
    <div v-if="favorites.length" class="flex flex-wrap gap-2">
      <UButton
        v-for="medication in favorites"
        :key="medication.favorite_id"
        size="xs"
        color="neutral"
        variant="soft"
        :disabled="disabled"
        @click="choose(medication)"
      >{{ label(medication) }}</UButton>
    </div>
    <p v-else-if="!loadingFavorites && !favoritesError" class="text-caption text-subtle">
      {{ t('prescriptions.create.favorites.empty') }}
    </p>
    <p v-else-if="favoritesError" class="text-caption text-error">{{ t('prescriptions.create.favorites.error') }}</p>

    <UInput
      v-model="query"
      :placeholder="t('prescriptions.create.search.placeholder')"
      :disabled="disabled"
      icon="i-lucide-search"
      autocomplete="off"
      data-testid="prescription-medication-search"
      @update:model-value="emit('search', String($event ?? ''))"
    />
    <p v-if="searching" class="text-caption text-subtle">{{ t('prescriptions.create.search.loading') }}</p>
    <p v-else-if="searchError" class="text-caption text-error">{{ t('prescriptions.create.search.error') }}</p>
    <p v-else-if="query.trim().length >= 2 && !results.length" class="text-caption text-subtle">
      {{ t('prescriptions.create.search.empty') }}
    </p>
    <div v-else-if="results.length" class="flex flex-wrap gap-2" role="listbox">
      <UButton
        v-for="medication in results"
        :key="medication.id"
        size="xs"
        color="neutral"
        variant="outline"
        :disabled="disabled"
        @click="choose(medication)"
      >{{ label(medication) }}</UButton>
    </div>
  </div>
</template>
