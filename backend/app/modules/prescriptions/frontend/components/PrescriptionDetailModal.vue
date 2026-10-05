<script setup lang="ts">
/**
 * PrescriptionDetailModal — one prescription, read-only.
 *
 * Everything shown is what the prescription says about itself: the snapshots
 * taken when it was issued, never the patient's, the user's or the clinic's
 * current data. There is no age (it is not in the API, and the rule that
 * computes it lives in the backend); the date of birth is shown instead.
 *
 * Nothing here edits a prescription. Besides closing and printing, the one
 * action is "Anular receta", shown only when the parent says the current user
 * may void this one (``canVoid``: an issued prescription, by its prescriber or
 * an admin). It does not void anything itself: it asks for the reason first.
 *
 * A voided prescription says so, with the reason and the instant it was voided.
 * It does not say *who* voided it: the API sends only a technical identifier,
 * and an identifier is not a person.
 */

import type { PrescriptionDetail } from '../types/prescriptions'
import { formatDateOnly, formatDateTime } from '../utils/prescriptionDates'

const props = defineProps<{
  open: boolean
  detail: PrescriptionDetail | null
  loading: boolean
  error: boolean
  /** A PDF of this prescription is being prepared. */
  printing: boolean
  /** The current user may void this prescription (decided by the parent). */
  canVoid?: boolean
}>()

const emit = defineEmits<{
  close: []
  retry: []
  print: []
  void: []
}>()

const { t, locale } = useI18n()

const items = computed(() =>
  [...(props.detail?.items ?? [])].sort((a, b) => a.position - b.position)
)

const documentLine = computed(() => {
  const detail = props.detail
  if (!detail?.patient_national_id_snapshot) return null
  const kind = detail.patient_national_id_type_snapshot
  return kind
    ? `${kind.toUpperCase()}: ${detail.patient_national_id_snapshot}`
    : detail.patient_national_id_snapshot
})

const title = computed(() =>
  props.detail
    ? t('prescriptions.detail.title', { number: props.detail.number })
    : t('prescriptions.detail.receipt')
)
</script>

<template>
  <UModal
    :open="open"
    :title="title"
    :description="t('prescriptions.detail.description')"
    :ui="{ content: 'sm:max-w-3xl' }"
    @update:open="$event || emit('close')"
  >
    <template #body>
      <div
        class="max-h-[70vh] overflow-y-auto pr-1"
        data-testid="prescription-detail"
      >
        <div
          v-if="loading"
          class="space-y-2"
          aria-busy="true"
          data-testid="prescription-detail-loading"
        >
          <span class="sr-only">{{ t('prescriptions.loading') }}</span>
          <USkeleton class="h-4 w-1/3" />
          <USkeleton class="h-4 w-2/3" />
          <USkeleton class="h-16 w-full" />
        </div>

        <UAlert
          v-else-if="error"
          color="warning"
          variant="subtle"
          icon="i-lucide-triangle-alert"
          role="alert"
          :title="t('prescriptions.error.detail')"
          data-testid="prescription-detail-error"
        >
          <template #actions>
            <UButton
              size="xs"
              color="neutral"
              variant="ghost"
              data-testid="prescription-detail-retry"
              @click="emit('retry')"
            >
              {{ t('prescriptions.actions.retry') }}
            </UButton>
          </template>
        </UAlert>

        <div
          v-else-if="detail"
          class="space-y-5"
        >
          <!-- A voided prescription says so first, and why. -->
          <div
            v-if="detail.status === 'voided'"
            class="rounded-token-md border border-error/40 bg-error/10 p-3 text-sm"
            data-testid="prescription-detail-void"
          >
            <p class="flex items-center gap-2 font-medium text-error">
              <UIcon
                name="i-lucide-ban"
                class="w-4 h-4"
                aria-hidden="true"
              />
              {{ t('prescriptions.detail.voided.title') }}
            </p>
            <dl class="mt-2 space-y-1">
              <div v-if="detail.void_reason">
                <dt class="text-caption text-subtle">
                  {{ t('prescriptions.detail.voided.reason') }}
                </dt>
                <dd
                  class="whitespace-pre-line"
                  data-testid="prescription-detail-void-reason"
                >
                  {{ detail.void_reason }}
                </dd>
              </div>
              <div v-if="detail.voided_at">
                <dt class="text-caption text-subtle">
                  {{ t('prescriptions.detail.voided.at') }}
                </dt>
                <dd data-testid="prescription-detail-void-at">
                  {{ formatDateTime(detail.voided_at, locale) }}
                </dd>
              </div>
            </dl>
          </div>

          <section aria-labelledby="rx-detail-receipt">
            <h3
              id="rx-detail-receipt"
              class="text-sm font-semibold text-default mb-2"
            >
              {{ t('prescriptions.detail.receipt') }}
            </h3>
            <dl class="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-4">
              <div>
                <dt class="text-caption text-subtle">
                  {{ t('prescriptions.detail.number') }}
                </dt>
                <dd
                  class="font-medium tabular-nums"
                  data-testid="prescription-detail-number"
                >
                  {{ detail.number }}
                </dd>
              </div>
              <div>
                <dt class="text-caption text-subtle">
                  {{ t('prescriptions.detail.status') }}
                </dt>
                <dd data-testid="prescription-detail-status">
                  {{ t(`prescriptions.status.${detail.status}`) }}
                </dd>
              </div>
              <div>
                <dt class="text-caption text-subtle">
                  {{ t('prescriptions.detail.issueDate') }}
                </dt>
                <dd data-testid="prescription-detail-issue-date">
                  {{ formatDateOnly(detail.issue_date, locale) }}
                </dd>
              </div>
              <div>
                <dt class="text-caption text-subtle">
                  {{ t('prescriptions.detail.validUntil') }}
                </dt>
                <dd data-testid="prescription-detail-valid-until">
                  {{ formatDateOnly(detail.valid_until, locale) }}
                </dd>
              </div>
            </dl>
          </section>

          <section aria-labelledby="rx-detail-patient">
            <h3
              id="rx-detail-patient"
              class="text-sm font-semibold text-default mb-2"
            >
              {{ t('prescriptions.detail.patient') }}
            </h3>
            <dl class="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-3">
              <div>
                <dt class="text-caption text-subtle">
                  {{ t('prescriptions.detail.name') }}
                </dt>
                <dd data-testid="prescription-detail-patient-name">
                  {{ detail.patient_name_snapshot }}
                </dd>
              </div>
              <div v-if="documentLine">
                <dt class="text-caption text-subtle">
                  {{ t('prescriptions.detail.document') }}
                </dt>
                <dd data-testid="prescription-detail-patient-document">
                  {{ documentLine }}
                </dd>
              </div>
              <div>
                <dt class="text-caption text-subtle">
                  {{ t('prescriptions.detail.birthDate') }}
                </dt>
                <dd data-testid="prescription-detail-patient-birth">
                  {{ formatDateOnly(detail.patient_date_of_birth_snapshot, locale) }}
                </dd>
              </div>
            </dl>
          </section>

          <section aria-labelledby="rx-detail-prescriber">
            <h3
              id="rx-detail-prescriber"
              class="text-sm font-semibold text-default mb-2"
            >
              {{ t('prescriptions.detail.prescriber') }}
            </h3>
            <dl class="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
              <div>
                <dt class="text-caption text-subtle">
                  {{ t('prescriptions.detail.name') }}
                </dt>
                <dd data-testid="prescription-detail-prescriber-name">
                  {{ detail.prescriber_name_snapshot }}
                </dd>
              </div>
              <div>
                <dt class="text-caption text-subtle">
                  {{ t('prescriptions.detail.professionalId') }}
                </dt>
                <dd data-testid="prescription-detail-professional-id">
                  {{ detail.prescriber_professional_id_snapshot }}
                </dd>
              </div>
            </dl>
          </section>

          <section aria-labelledby="rx-detail-medications">
            <h3
              id="rx-detail-medications"
              class="text-sm font-semibold text-default mb-2"
            >
              {{ t('prescriptions.detail.medications') }}
            </h3>
            <ol class="space-y-3">
              <li
                v-for="(item, index) in items"
                :key="item.id"
                class="rounded-token-md border border-default p-3"
                :data-testid="`prescription-detail-item-${index + 1}`"
              >
                <p class="font-medium">
                  <span class="tabular-nums">{{ index + 1 }}.</span>
                  {{ item.active_ingredient }}
                  <span class="text-default">{{ item.strength }}</span>
                  <span class="text-subtle">· {{ item.pharmaceutical_form }}</span>
                </p>
                <p
                  v-if="item.commercial_name"
                  class="text-sm text-subtle"
                  data-testid="prescription-detail-item-commercial"
                >
                  {{ t('prescriptions.detail.commercialName') }}: {{ item.commercial_name }}
                </p>
                <p
                  v-if="item.presentation"
                  class="text-sm text-subtle"
                  data-testid="prescription-detail-item-presentation"
                >
                  {{ t('prescriptions.detail.presentation') }}: {{ item.presentation }}
                </p>
                <dl class="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-5">
                  <div>
                    <dt class="text-caption text-subtle">
                      {{ t('prescriptions.detail.dose') }}
                    </dt>
                    <dd>{{ item.dose }}</dd>
                  </div>
                  <div>
                    <dt class="text-caption text-subtle">
                      {{ t('prescriptions.detail.route') }}
                    </dt>
                    <dd>{{ item.route }}</dd>
                  </div>
                  <div>
                    <dt class="text-caption text-subtle">
                      {{ t('prescriptions.detail.frequency') }}
                    </dt>
                    <dd>{{ item.frequency }}</dd>
                  </div>
                  <div>
                    <dt class="text-caption text-subtle">
                      {{ t('prescriptions.detail.duration') }}
                    </dt>
                    <dd>{{ item.duration }}</dd>
                  </div>
                  <div>
                    <dt class="text-caption text-subtle">
                      {{ t('prescriptions.detail.quantity') }}
                    </dt>
                    <dd>{{ item.total_quantity }}</dd>
                  </div>
                </dl>
                <p
                  v-if="item.instructions"
                  class="mt-2 text-sm whitespace-pre-line"
                  data-testid="prescription-detail-item-instructions"
                >
                  <span class="text-caption text-subtle">{{ t('prescriptions.detail.instructions') }}:</span>
                  {{ item.instructions }}
                </p>
              </li>
            </ol>
          </section>
        </div>
      </div>
    </template>

    <template #footer>
      <div class="flex flex-wrap items-center justify-end gap-2 w-full">
        <UButton
          v-if="detail && canVoid"
          color="error"
          variant="outline"
          icon="i-lucide-ban"
          class="mr-auto"
          :aria-label="t('prescriptions.aria.void', { number: detail.number })"
          data-testid="prescription-detail-void-action"
          @click="emit('void')"
        >
          {{ t('prescriptions.actions.void') }}
        </UButton>
        <UButton
          color="neutral"
          variant="ghost"
          data-testid="prescription-detail-close"
          @click="emit('close')"
        >
          {{ t('prescriptions.actions.close') }}
        </UButton>
        <UButton
          v-if="detail"
          icon="i-lucide-printer"
          :loading="printing"
          :disabled="printing"
          :aria-label="t('prescriptions.aria.print', { number: detail.number })"
          data-testid="prescription-detail-print"
          @click="emit('print')"
        >
          {{ t('prescriptions.actions.print') }}
        </UButton>
      </div>
    </template>
  </UModal>
</template>
