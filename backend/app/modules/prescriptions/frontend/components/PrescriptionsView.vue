<script setup lang="ts">
/**
 * PrescriptionsView — the "Recetas" tab of the patient's Clinical record.
 *
 * Mounted through the ``patient.clinical.prescriptions`` slot; ``patients``
 * renders the slot and never imports this component.
 *
 * A patient's prescriptions, newest first, with two actions per row: see it and
 * print it. It is read-only: nothing is created, edited or voided here (that
 * is a later phase, with its own permissions).
 *
 * ``ctx.readonly`` is the Clinical tab's flag and belongs to another domain. It
 * says nothing about prescriptions, so it is deliberately not read: who may
 * prescribe or void must never be inferred from it.
 *
 * Visibility is decided by the slot (``prescriptions.read``). The backend
 * decides again on every request.
 */

import { usePrescriptions } from '../composables/usePrescriptions'
import { formatDateOnly } from '../utils/prescriptionDates'
import PrescriptionDetailModal from './PrescriptionDetailModal.vue'

const props = defineProps<{
  ctx: { patientId: string, readonly?: boolean }
}>()

const { t, locale } = useI18n()
const toast = useToast()

const {
  rows,
  total,
  page,
  pageCount,
  listLoading,
  listError,
  fetchList,
  retryList,
  detailId,
  detail,
  detailLoading,
  detailError,
  fetchDetail,
  retryDetail,
  closeDetail,
  isPdfBusy,
  openPdf
} = usePrescriptions(() => props.ctx.patientId)

/**
 * Print. Called straight from the click: the composable opens the window
 * before its first ``await``, which is what keeps a popup blocker quiet.
 */
async function print(id: string, number: string): Promise<void> {
  const outcome = await openPdf(id, number)
  if (outcome === 'failed') {
    toast.add({
      title: t('common.error'),
      description: t('prescriptions.error.pdf'),
      color: 'error',
      icon: 'i-lucide-triangle-alert'
    })
  } else if (outcome === 'downloaded') {
    toast.add({
      description: t('prescriptions.pdf.downloaded'),
      color: 'info',
      icon: 'i-lucide-download'
    })
  }
}
</script>

<template>
  <section
    class="space-y-3"
    data-testid="prescriptions-view"
    aria-labelledby="rx-history-title"
  >
    <header class="flex items-center justify-between gap-3 flex-wrap">
      <h2
        id="rx-history-title"
        class="text-h2 text-default"
      >
        {{ t('prescriptions.title') }}
      </h2>
      <UBadge
        v-if="rows.length > 0 || !listLoading"
        color="neutral"
        variant="subtle"
        data-testid="prescriptions-total"
      >
        {{ t('prescriptions.total', { count: total }) }}
      </UBadge>
    </header>

    <!-- A failure here is a notice, not a collapse: the rest of the record stays. -->
    <UAlert
      v-if="listError"
      color="warning"
      variant="subtle"
      icon="i-lucide-triangle-alert"
      role="alert"
      :title="t('prescriptions.error.list')"
      data-testid="prescriptions-error"
    >
      <template #actions>
        <UButton
          size="xs"
          color="neutral"
          variant="ghost"
          data-testid="prescriptions-retry"
          @click="retryList()"
        >
          {{ t('prescriptions.actions.retry') }}
        </UButton>
      </template>
    </UAlert>

    <div
      v-if="listLoading && rows.length === 0"
      class="space-y-2"
      aria-busy="true"
      data-testid="prescriptions-loading"
    >
      <span class="sr-only">{{ t('prescriptions.loading') }}</span>
      <USkeleton
        v-for="n in 3"
        :key="n"
        class="h-12 w-full"
      />
    </div>

    <p
      v-else-if="!listLoading && !listError && rows.length === 0"
      class="text-sm text-subtle py-6 text-center"
      data-testid="prescriptions-empty"
    >
      {{ t('prescriptions.empty') }}
    </p>

    <div
      v-else-if="rows.length > 0"
      role="table"
      class="rounded-token-md border border-default divide-y divide-default"
      :aria-busy="listLoading"
      :aria-label="t('prescriptions.title')"
      data-testid="prescriptions-list"
    >
      <!-- Column titles: a table header from md up; on a phone every cell names itself. -->
      <div
        role="row"
        class="hidden md:grid md:grid-cols-[7rem_9.5rem_minmax(0,1fr)_6.5rem_7.5rem_auto] gap-x-3 px-3 py-2
               text-caption text-subtle bg-surface-muted"
      >
        <span role="columnheader">{{ t('prescriptions.columns.date') }}</span>
        <span role="columnheader">{{ t('prescriptions.columns.number') }}</span>
        <span role="columnheader">{{ t('prescriptions.columns.prescriber') }}</span>
        <span role="columnheader">{{ t('prescriptions.columns.items') }}</span>
        <span role="columnheader">{{ t('prescriptions.columns.status') }}</span>
        <span
          role="columnheader"
          class="text-right"
        >{{ t('prescriptions.columns.actions') }}</span>
      </div>

      <div
        v-for="row in rows"
        :key="row.id"
        role="row"
        class="grid grid-cols-2 gap-x-3 gap-y-1 px-3 py-3 text-sm items-center
               md:grid-cols-[7rem_9.5rem_minmax(0,1fr)_6.5rem_7.5rem_auto] md:py-2"
        :data-testid="`prescription-row-${row.id}`"
        :data-status="row.status"
      >
        <div role="cell">
          <span class="md:hidden text-caption text-subtle block">{{ t('prescriptions.columns.date') }}</span>
          <span data-testid="prescription-row-date">{{ formatDateOnly(row.issue_date, locale) }}</span>
        </div>
        <div role="cell">
          <span class="md:hidden text-caption text-subtle block">{{ t('prescriptions.columns.number') }}</span>
          <span
            class="font-medium tabular-nums"
            data-testid="prescription-row-number"
          >{{ row.number }}</span>
        </div>
        <div
          role="cell"
          class="col-span-2 md:col-span-1 min-w-0"
        >
          <span class="md:hidden text-caption text-subtle block">{{ t('prescriptions.columns.prescriber') }}</span>
          <span
            class="block truncate"
            data-testid="prescription-row-prescriber"
          >{{ row.prescriber_name_snapshot }}</span>
        </div>
        <div role="cell">
          <span class="md:hidden text-caption text-subtle block">{{ t('prescriptions.columns.items') }}</span>
          <span
            class="tabular-nums"
            data-testid="prescription-row-items"
          >{{ row.item_count }}</span>
        </div>
        <div role="cell">
          <span class="md:hidden text-caption text-subtle block">{{ t('prescriptions.columns.status') }}</span>
          <!-- The word carries the state; the colour only agrees with it. -->
          <UBadge
            :color="row.status === 'voided' ? 'neutral' : 'success'"
            variant="subtle"
            size="sm"
            data-testid="prescription-row-status"
          >
            <UIcon
              :name="row.status === 'voided' ? 'i-lucide-ban' : 'i-lucide-check'"
              class="w-3 h-3"
              aria-hidden="true"
            />
            {{ t(`prescriptions.status.${row.status}`) }}
          </UBadge>
        </div>
        <div
          role="cell"
          class="col-span-2 md:col-span-1 flex items-center gap-2 md:justify-end"
        >
          <UButton
            size="xs"
            color="neutral"
            variant="outline"
            icon="i-lucide-eye"
            :aria-label="t('prescriptions.aria.view', { number: row.number })"
            data-testid="prescription-row-view"
            @click="fetchDetail(row.id)"
          >
            {{ t('prescriptions.actions.view') }}
          </UButton>
          <UButton
            size="xs"
            color="neutral"
            variant="outline"
            icon="i-lucide-printer"
            :loading="isPdfBusy(row.id)"
            :disabled="isPdfBusy(row.id)"
            :aria-label="t('prescriptions.aria.print', { number: row.number })"
            data-testid="prescription-row-print"
            @click="print(row.id, row.number)"
          >
            {{ t('prescriptions.actions.print') }}
          </UButton>
        </div>
      </div>
    </div>

    <nav
      v-if="pageCount > 1"
      class="flex items-center justify-center gap-3"
      :aria-label="t('prescriptions.pagination.label')"
      data-testid="prescriptions-pagination"
    >
      <UButton
        size="sm"
        color="neutral"
        variant="outline"
        icon="i-lucide-chevron-left"
        :disabled="page <= 1 || listLoading"
        data-testid="prescriptions-prev"
        @click="fetchList(page - 1)"
      >
        {{ t('prescriptions.actions.previous') }}
      </UButton>
      <span
        class="text-sm text-subtle tabular-nums"
        aria-live="polite"
        data-testid="prescriptions-page"
      >{{ t('prescriptions.pagination.pageOf', { page, pages: pageCount }) }}</span>
      <UButton
        size="sm"
        color="neutral"
        variant="outline"
        trailing-icon="i-lucide-chevron-right"
        :disabled="page >= pageCount || listLoading"
        data-testid="prescriptions-next"
        @click="fetchList(page + 1)"
      >
        {{ t('prescriptions.actions.next') }}
      </UButton>
    </nav>

    <!-- Closed by the patient changing too: the composable clears the detail. -->
    <PrescriptionDetailModal
      :open="detailId !== null"
      :detail="detail"
      :loading="detailLoading"
      :error="detailError"
      :printing="detail ? isPdfBusy(detail.id) : false"
      @close="closeDetail()"
      @retry="retryDetail()"
      @print="detail && print(detail.id, detail.number)"
    />
  </section>
</template>
