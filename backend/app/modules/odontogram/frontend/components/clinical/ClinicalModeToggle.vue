<script setup lang="ts">
/**
 * ClinicalModeToggle — full-width pill-bar over clinical tab modes.
 * Order: Diagnóstico | Planes | Citas | Histórico | Evolución.
 * Evolución is the clinical-notes history: the host passes ``show-evolution``
 * only when the user may read notes, so the option is absent otherwise.
 * Optional badges surface contextual counts (e.g. "Planes 2") so the
 * user sees workload before clicking in.
 */
import type { ClinicalMode } from '~~/app/types'
import { visibleClinicalModes } from '~~/app/utils/clinicalModes'

interface ModeBadges {
  diagnosis?: string | number
  plans?: string | number
  appointments?: string | number
  history?: string | number
  evolution?: string | number
}

const props = withDefaults(defineProps<{
  modelValue: ClinicalMode
  badges?: ModeBadges
  /** Whether the Evolución option exists for this user. */
  showEvolution?: boolean
}>(), { showEvolution: false })

const emit = defineEmits<{
  'update:modelValue': [mode: ClinicalMode]
}>()

const { t } = useI18n()

const MODE_ICONS: Record<ClinicalMode, string> = {
  diagnosis: 'i-lucide-stethoscope',
  plans: 'i-lucide-clipboard-list',
  appointments: 'i-lucide-calendar',
  history: 'i-lucide-history',
  evolution: 'i-lucide-notebook-pen'
}

const options = computed(() =>
  visibleClinicalModes({ evolution: props.showEvolution }).map(mode => ({
    value: mode,
    label: t(`clinical.modes.${mode}`),
    icon: MODE_ICONS[mode],
    badge: props.badges?.[mode]
  }))
)
</script>

<template>
  <SegmentedControl
    :model-value="modelValue"
    :options="options"
    full-width
    @update:model-value="(v) => emit('update:modelValue', v as ClinicalMode)"
  />
</template>
