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
import { useNtsUnsavedChanges } from '../../composables/useNtsUnsavedChanges'

const { t } = useI18n()
const { profile, isLoaded, loading, ensureLoaded, setProfile } = useOdontogramProfile()

/**
 * Switching format unmounts whichever chart is showing, so it is a context
 * change like any other — and this is the control that causes it, which is
 * why the guard lives here rather than being reverted after the fact.
 */
const unsaved = useNtsUnsavedChanges()

/** The format the user asked for while something was still unsaved. */
const pending = ref<OdontogramProfile | null>(null)

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

  // A mutation already sent is not the browser's to discard, and its result
  // needs somewhere to land. Nothing to offer here but waiting.
  if (unsaved.writing.value) return

  if (unsaved.dirty.value) {
    pending.value = next
    return
  }
  await setProfile(next)
}

/** The clinician chose to lose the text. Nothing is saved on the way out. */
async function confirmDiscard() {
  const next = pending.value
  pending.value = null
  if (next) await setProfile(next)
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
        :disabled="loading || !isLoaded || unsaved.writing.value"
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

    <!--
      The same question, and deliberately the same words, as the one the
      odontogram asks before opening a historical record: one policy for
      abandoning unsaved clinical text, not three dialogs that disagree.
    -->
    <UModal
      :open="pending !== null"
      :title="t('odontogram.nts.unsaved.title')"
      data-testid="odontogram-profile-unsaved"
      @update:open="$event || (pending = null)"
    >
      <template #body>
        <p class="text-sm">
          {{ t('odontogram.nts.unsaved.body') }}
        </p>
      </template>
      <template #footer>
        <div class="flex justify-end gap-2 w-full flex-wrap">
          <UButton
            color="neutral"
            variant="ghost"
            data-testid="odontogram-profile-unsaved-stay"
            @click="pending = null"
          >
            {{ t('odontogram.nts.unsaved.stay') }}
          </UButton>
          <UButton
            color="warning"
            data-testid="odontogram-profile-unsaved-discard"
            @click="confirmDiscard()"
          >
            {{ t('odontogram.nts.unsaved.discard') }}
          </UButton>
        </div>
      </template>
    </UModal>
  </div>
</template>
