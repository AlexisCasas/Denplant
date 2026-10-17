<script setup lang="ts">
// DP-08.B1 (F6): visible recovery when a Treatment was created but could not
// be associated to the Plan. Closing it never deletes the treatment; there is
// deliberately no "discard" action here — removal is a separate, explicit flow.
import type { PlanLinkPending } from '../../composables/usePlanTreatmentLink'

const props = defineProps<{
  pending: PlanLinkPending
  busy?: boolean
}>()
const emit = defineEmits<{ retry: [], dismiss: [] }>()
const { t } = useI18n()

const detail = computed(() => t(`treatmentPlans.linkRecovery.reason.${props.pending.reason}`))
</script>

<template>
  <UAlert
    color="warning"
    variant="subtle"
    icon="i-lucide-triangle-alert"
    data-testid="plan-link-recovery"
    role="alert"
    :title="t('treatmentPlans.linkRecovery.title')"
    :description="detail"
  >
    <template #actions>
      <UButton
        v-if="pending.canRetry"
        size="xs"
        color="warning"
        variant="solid"
        data-testid="plan-link-retry"
        :loading="busy"
        :disabled="busy"
        @click="emit('retry')"
      >
        {{ t('common.retry') }}
      </UButton>
      <UButton
        size="xs"
        color="neutral"
        variant="ghost"
        data-testid="plan-link-dismiss"
        :disabled="busy"
        @click="emit('dismiss')"
      >
        {{ t('common.close') }}
      </UButton>
    </template>
  </UAlert>
</template>
