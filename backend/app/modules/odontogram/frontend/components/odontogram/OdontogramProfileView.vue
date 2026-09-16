<script setup lang="ts">
/**
 * OdontogramProfileView - profile-aware mount point for the odontogram.
 *
 * Decides *which* chart to render from the user's per-clinic preference and
 * nothing else. The original renderer stays untouched and profile-unaware:
 * there is deliberately no `if (profile === ...)` inside `OdontogramChart`.
 *
 *   profile = original         -> <OdontogramChart>          (existing behaviour)
 *   profile = pe_nts_188_2022  -> <NtsOdontogramPlaceholder> (NTS-02 stand-in)
 *
 * Props/listeners are forwarded verbatim through `$attrs`, so this wrapper
 * can be dropped in front of any existing `OdontogramChart` usage without
 * re-declaring its API.
 */

// Explicit relative imports (same idiom as e.g. `AppointmentModal.vue` for the
// agenda layer's date utils). The layer auto-imports resolve at runtime
// anyway; spelling them out also makes this mount point's two branches an
// explicit dependency and lets the component be mounted in the frontend test
// suite, where the `module_layers` symlink does not resolve.
import OdontogramChart from './OdontogramChart.vue'
import NtsOdontogramPlaceholder from './NtsOdontogramPlaceholder.vue'
import { useOdontogramProfile } from '../../composables/useOdontogramProfile'

defineOptions({ inheritAttrs: false })

const { t } = useI18n()
const { profile, isLoaded, ensureLoaded } = useOdontogramProfile()

// `isLoaded` starts false and the template renders a neutral loader until
// the preference settles, so the wrong chart never flashes on screen. No
// top-level await here on purpose: that would suspend the whole subtree and
// make this wrapper depend on a Suspense boundary it doesn't own.
onMounted(() => {
  void ensureLoaded()
})
</script>

<template>
  <!-- Preference still resolving: neutral placeholder, never a chart. -->
  <div
    v-if="!isLoaded"
    class="flex items-center justify-center py-12"
    data-testid="odontogram-profile-loading"
  >
    <UIcon
      name="i-lucide-loader-2"
      class="w-8 h-8 animate-spin text-primary-accent"
      :aria-label="t('common.loading')"
    />
  </div>

  <NtsOdontogramPlaceholder v-else-if="profile === 'pe_nts_188_2022'" />

  <OdontogramChart
    v-else
    v-bind="$attrs"
  />
</template>
