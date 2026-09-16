<script setup lang="ts">
/**
 * OdontogramProfileSelector - personal chart-format switch (NTS-02).
 *
 * This is a *personal* preference for the current clinic, not a clinical
 * setting: switching it never touches patient data. Deliberately separate
 * from the dentition toggle and from the Diagnóstico/Histórico mode switch,
 * which live inside the chart itself.
 *
 * The local value follows the backend: `setProfile` only resolves the new
 * profile when the PUT succeeds, so a failed write leaves both the selector
 * and the rendered chart on the previous format.
 */

import { ODONTOGRAM_PROFILES } from '~~/app/config/odontogramConstants'
import type { OdontogramProfile } from '~~/app/config/odontogramConstants'
// Explicit relative import — see the note in `OdontogramProfileView.vue`.
import { useOdontogramProfile } from '../../composables/useOdontogramProfile'

const { t } = useI18n()
const { profile, isLoaded, loading, ensureLoaded, setProfile } = useOdontogramProfile()

onMounted(() => {
  void ensureLoaded()
})

const options = computed(() =>
  ODONTOGRAM_PROFILES.map(value => ({
    value,
    label: t(`odontogram.profile.options.${value}`)
  }))
)

async function select(next: OdontogramProfile) {
  if (next === profile.value || loading.value) return
  await setProfile(next)
}
</script>

<template>
  <div
    class="flex items-center gap-2 flex-wrap"
    data-testid="odontogram-profile-selector"
  >
    <span class="text-caption text-subtle">
      {{ t('odontogram.profile.label') }}
    </span>

    <div
      class="flex items-center gap-1"
      role="group"
      :aria-label="t('odontogram.profile.label')"
    >
      <button
        v-for="option in options"
        :key="option.value"
        type="button"
        class="px-2.5 py-1 rounded-token-md text-sm font-medium transition-colors border
               disabled:opacity-60 disabled:cursor-not-allowed"
        :class="profile === option.value
          ? 'border-primary bg-primary/10 text-primary-accent'
          : 'border-default bg-default text-default hover:bg-elevated'"
        :aria-pressed="profile === option.value"
        :disabled="loading || !isLoaded"
        :data-testid="`odontogram-profile-option-${option.value}`"
        @click="select(option.value)"
      >
        {{ option.label }}
      </button>
    </div>

    <UIcon
      v-if="loading"
      name="i-lucide-loader-2"
      class="w-4 h-4 animate-spin text-subtle"
      :aria-label="t('common.loading')"
    />
  </div>
</template>
