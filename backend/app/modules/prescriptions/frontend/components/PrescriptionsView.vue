<script setup lang="ts">
/**
 * PrescriptionsView — the "Recetas" tab of the patient's Clinical record.
 *
 * Mounted through the ``patient.clinical.prescriptions`` slot; ``patients``
 * renders the slot and never imports this component.
 *
 * A patient's prescriptions, newest first, with two actions per row: see it and
 * print it. From here a dentist writes a new one ("Nueva receta") and, from the
 * detail, an issued one is voided. Nothing is ever edited or deleted.
 *
 * ``ctx.readonly`` is the Clinical tab's flag and belongs to another domain. It
 * says nothing about prescriptions, so it is deliberately not read: who may
 * prescribe or void must never be inferred from it.
 *
 * Who may write is the backend's rule, mirrored here (``utils/prescriptionRules``):
 * the permission **and** the role of the current membership
 * (``useAuth().currentRole``, never inferred from permissions: ``admin`` holds
 * the ``*`` wildcard) **and**, to issue, a registered professional id. The slot
 * decides who sees the tab (``prescriptions.read``). The backend decides again
 * on every request.
 */

import { PERMISSIONS } from '~~/app/config/permissions'

import { usePrescriptions } from '../composables/usePrescriptions'
import type { PrescriptionCreatePayload } from '../types/prescriptions'
import { formatDateOnly } from '../utils/prescriptionDates'
import { voidErrorKey } from '../utils/prescriptionForm'
import { canVoid, dateOfBirthMissing, issueAccess } from '../utils/prescriptionRules'
import PrescriptionCreateModal from './PrescriptionCreateModal.vue'
import PrescriptionDetailModal from './PrescriptionDetailModal.vue'
import PrescriptionVoidModal from './PrescriptionVoidModal.vue'

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
  openPdf,
  submitting,
  createError,
  createPrescription,
  clearCreateError,
  voiding,
  voidError,
  voidPrescription,
  clearVoidError
} = usePrescriptions(() => props.ctx.patientId)

// --- who may write ---------------------------------------------------------

const auth = useAuth()
const { can } = usePermissions()
const { currentClinic } = useClinicState()

interface CachedPatient { first_name?: string, last_name?: string, date_of_birth?: string | null }

/** The patient page's own record, if it holds one: never fetched again here. */
const cachedPatient = computed(() =>
  useNuxtData<CachedPatient | null>(`patient:${props.ctx.patientId}`).data.value ?? null
)

const access = computed(() => issueAccess({
  hasPrescribePermission: can(PERMISSIONS.prescriptions.prescribe),
  role: auth.currentRole.value,
  professionalId: auth.user.value?.professional_id
}))

/** True only when the cached record is there and has no date of birth. */
const dobMissing = computed(() => dateOfBirthMissing(cachedPatient.value))

const canIssue = computed(() => access.value === 'allowed' && !dobMissing.value)

const issueNotice = computed(() => {
  if (access.value === 'missing-professional-id') return t('prescriptions.create.notices.noProfessionalId')
  if (access.value === 'allowed' && dobMissing.value) return t('prescriptions.create.notices.dobRequired')
  return null
})

const patientName = computed(() => {
  const patient = cachedPatient.value
  const name = `${patient?.first_name ?? ''} ${patient?.last_name ?? ''}`.trim()
  return name || null
})

const prescriberName = computed(() =>
  `${auth.user.value?.first_name ?? ''} ${auth.user.value?.last_name ?? ''}`.trim()
)

const mayVoidDetail = computed(() => !!detail.value && canVoid({
  hasVoidPermission: can(PERMISSIONS.prescriptions.void),
  role: auth.currentRole.value,
  userId: auth.user.value?.id,
  prescriberUserId: detail.value.prescriber_user_id,
  status: detail.value.status
}))

// --- the two dialogs --------------------------------------------------------

const createOpen = ref(false)
const voidOpen = ref(false)

// A draft never outlives its patient: the dialogs are mounted with `v-if`, so
// closing them here destroys what was typed.
watch(() => props.ctx.patientId, () => {
  createOpen.value = false
  voidOpen.value = false
})

// No open detail, nothing to void (it was closed, or it no longer exists).
watch(detailId, (id) => {
  if (id === null) voidOpen.value = false
})

function openCreate(): void {
  if (!canIssue.value) return
  clearCreateError()
  createOpen.value = true
}

function closeCreate(): void {
  createOpen.value = false
  clearCreateError()
}

async function submitCreate(body: Omit<PrescriptionCreatePayload, 'patient_id'>): Promise<void> {
  const outcome = await createPrescription(body)
  if (outcome !== 'done') return
  createOpen.value = false
  toast.add({
    description: t('prescriptions.create.success', { number: detail.value?.number ?? '' }),
    color: 'success',
    icon: 'i-lucide-check'
  })
}

function openVoid(): void {
  if (!mayVoidDetail.value) return
  clearVoidError()
  voidOpen.value = true
}

function closeVoid(): void {
  voidOpen.value = false
  clearVoidError()
}

/** Outcomes that mean "this void no longer applies": say so and close. */
const VOID_FINAL = ['void_not_allowed', 'prescription_state_conflict', 'prescription_not_found']

async function submitVoid(reason: string): Promise<void> {
  const target = detail.value
  if (!target) return
  const outcome = await voidPrescription(target.id, reason)
  if (outcome === 'done') {
    voidOpen.value = false
    toast.add({
      description: t('prescriptions.void.success', { number: target.number }),
      color: 'success',
      icon: 'i-lucide-check'
    })
  } else if (outcome === 'failed' && voidError.value?.code && VOID_FINAL.includes(voidError.value.code)) {
    voidOpen.value = false
    toast.add({
      description: t(`prescriptions.void.errors.${voidErrorKey(voidError.value)}`),
      color: 'warning',
      icon: 'i-lucide-info'
    })
  }
}

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
      <div class="flex items-center gap-2 flex-wrap">
        <UBadge
          v-if="rows.length > 0 || !listLoading"
          color="neutral"
          variant="subtle"
          data-testid="prescriptions-total"
        >
          {{ t('prescriptions.total', { count: total }) }}
        </UBadge>
        <!-- Not for an admin (the wildcard is not a dentist), nor for anyone but a dentist. -->
        <UButton
          v-if="access !== 'hidden'"
          icon="i-lucide-plus"
          size="sm"
          :disabled="!canIssue"
          :aria-describedby="issueNotice ? 'rx-issue-notice' : undefined"
          data-testid="prescription-new"
          @click="openCreate"
        >
          {{ t('prescriptions.actions.new') }}
        </UButton>
      </div>
    </header>

    <p
      v-if="access !== 'hidden' && issueNotice"
      id="rx-issue-notice"
      class="flex items-start gap-2 rounded-token-md bg-warning/10 px-3 py-2 text-sm"
      role="status"
      data-testid="prescription-new-notice"
    >
      <UIcon
        name="i-lucide-info"
        class="w-4 h-4 mt-0.5 shrink-0"
        aria-hidden="true"
      />
      {{ issueNotice }}
    </p>

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
      :can-void="mayVoidDetail"
      @close="closeDetail()"
      @retry="retryDetail()"
      @print="detail && print(detail.id, detail.number)"
      @void="openVoid()"
    />

    <PrescriptionCreateModal
      v-if="createOpen"
      :patient-name="patientName"
      :prescriber-name="prescriberName"
      :professional-id="(auth.user.value?.professional_id ?? '').trim()"
      :clinic-name="currentClinic?.name ?? null"
      :submitting="submitting"
      :error="createError"
      @close="closeCreate()"
      @submit="submitCreate"
    />

    <PrescriptionVoidModal
      v-if="voidOpen && detail"
      :number="detail.number"
      :voiding="voiding"
      :error="voidError"
      @close="closeVoid()"
      @submit="submitVoid"
    />
  </section>
</template>
