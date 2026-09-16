<script setup lang="ts">
/**
 * NtsOdontogramPlaceholder - temporary stand-in for the MINSA Perú chart.
 *
 * NTS-02 only wires the profile switch; the normative renderer (teeth,
 * findings, snapshots, the 38 graphic rules) lands in later tickets. This
 * component must read as clearly provisional so nobody mistakes it for a
 * finished feature.
 */

const { t } = useI18n()
</script>

<template>
  <div
    class="flex flex-col items-center justify-center text-center gap-3 py-12 px-6
           rounded-token-md border border-dashed border-default bg-surface-muted"
    data-testid="nts-odontogram-placeholder"
  >
    <UIcon
      name="i-lucide-hard-hat"
      class="w-10 h-10 text-subtle"
      aria-hidden="true"
    />

    <div class="space-y-1">
      <p class="text-h2 text-default">
        {{ t('odontogram.profile.nts.title') }}
      </p>
      <p class="text-caption text-subtle">
        {{ t('odontogram.profile.nts.norm') }}
      </p>
    </div>

    <UBadge
      color="warning"
      variant="subtle"
      size="sm"
    >
      {{ t('odontogram.profile.nts.inPreparation') }}
    </UBadge>

    <p class="text-sm text-muted max-w-md">
      {{ t('odontogram.profile.nts.hint') }}
    </p>
  </div>
</template>
