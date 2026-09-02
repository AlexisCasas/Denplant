<script setup lang="ts">
import type { PlannedTreatmentItem, Professional, TreatmentPlan } from '~/types'

const props = defineProps<{
  modelValue?: PlannedTreatmentItem[]
  patientId?: string
  /** Optional — lets the parent avoid a duplicate GET /auth/professionals. */
  professionals?: readonly Professional[]
}>()

const emit = defineEmits<{
  'update:modelValue': [items: PlannedTreatmentItem[]]
}>()

const { t, locale } = useI18n()
const { plans: fetchedPlans, fetchPlans, fetchPlan } = useTreatmentPlans()
const { formatPrice } = useCatalog()

// Vigente (schedulable) plans for the current patient — mirrors the
// eligibility the backend already enforces in
// AppointmentService.validate_planned_items (plan.status in
// ("active", "draft")). Keeping this filter in sync avoids a picker
// that lets the clinician choose a plan whose items the backend would
// then reject at appointment-creation time.
const SCHEDULABLE_PLAN_STATUSES = ['active', 'draft']

const plans = ref<TreatmentPlan[]>([])
const isLoadingPlans = ref(false)
const selectedPlanId = ref<string>('')

const planItems = ref<PlannedTreatmentItem[]>([])
const isLoadingItems = ref(false)
// Cache plan detail fetches per plan id — switching back and forth
// between plans in the same session shouldn't re-hit the API.
const planItemsCache = new Map<string, PlannedTreatmentItem[]>()

const selectedItems = ref<PlannedTreatmentItem[]>(props.modelValue || [])
const selectedIds = computed(() => new Set(selectedItems.value.map(i => i.id)))

// Guards against the patientId watcher clobbering a plan we just
// derived from an initial `modelValue` (edit mode).
let pendingInitialPlanId: string | null = null

function planLabel(plan: TreatmentPlan): string {
  return plan.title || plan.plan_number
}

async function loadPlans(patientId: string) {
  isLoadingPlans.value = true
  try {
    await fetchPlans({ patient_id: patientId, status: SCHEDULABLE_PLAN_STATUSES, page_size: 100 })
    plans.value = fetchedPlans.value
  } finally {
    isLoadingPlans.value = false
  }
}

async function loadPlanItems(planId: string) {
  const cached = planItemsCache.get(planId)
  if (cached) {
    planItems.value = cached
    return
  }
  isLoadingItems.value = true
  try {
    const detail = await fetchPlan(planId)
    const plan = plans.value.find(p => p.id === planId)
    const items = (detail?.items ?? [])
      .filter(item => item.status === 'pending')
      .map(item => ({
        ...item,
        treatment_plan: {
          id: planId,
          plan_number: detail?.plan_number ?? plan?.plan_number ?? '',
          title: detail?.title ?? plan?.title,
          status: detail?.status ?? plan?.status ?? 'active'
        }
      }))
    planItemsCache.set(planId, items)
    planItems.value = items
  } finally {
    isLoadingItems.value = false
  }
}

function resetSelection() {
  selectedItems.value = []
  emit('update:modelValue', [])
}

// B/C: no patient → no plans. Patient change resets plan + selection.
watch(() => props.patientId, async (newPatientId, oldPatientId) => {
  if (newPatientId === oldPatientId) return
  plans.value = []
  planItems.value = []
  planItemsCache.clear()
  if (!pendingInitialPlanId) {
    selectedPlanId.value = ''
  }
  if (!newPatientId) {
    resetSelection()
    return
  }
  await loadPlans(newPatientId)
  if (pendingInitialPlanId) {
    // Edit mode already pointed `selectedPlanId` at the appointment's
    // plan (see the `modelValue` watcher below). If that plan is no
    // longer vigente (closed/completed since the appointment was
    // booked) it won't be in `plans.value` — leave the selection as-is
    // rather than silently jumping to an unrelated vigente plan.
  } else if (plans.value.length === 1 && plans.value[0]) {
    selectedPlanId.value = plans.value[0].id
  }
  pendingInitialPlanId = null
}, { immediate: true })

// Set right before we programmatically point `selectedPlanId` at the
// edit-mode initial plan, so the watcher below knows not to wipe the
// selection it was just given.
let suppressNextClear = false

// D: plan selected → load its pending items. E: plan changed → clear
// the staged selection (an appointment is built from one plan's items).
watch(selectedPlanId, async (planId, oldPlanId) => {
  if (planId === oldPlanId) return
  planItems.value = []
  if (!planId) return
  // Skip the "clear selection" step the very first time we resolve an
  // initial plan from `modelValue` (edit mode) — those items must survive.
  if (oldPlanId !== undefined && !suppressNextClear) {
    resetSelection()
  }
  suppressNextClear = false
  await loadPlanItems(planId)
})

// Derive the initial plan (edit mode) from the first pre-selected item.
watch(() => props.modelValue, (items) => {
  selectedItems.value = items || []
  const first = items?.[0]
  const planId = first?.treatment_plan?.id || first?.treatment_plan_id
  if (planId && !selectedPlanId.value) {
    pendingInitialPlanId = planId
    suppressNextClear = true
    selectedPlanId.value = planId
  }
}, { immediate: true })

function toggleItem(item: PlannedTreatmentItem) {
  if (selectedIds.value.has(item.id)) {
    selectedItems.value = selectedItems.value.filter(i => i.id !== item.id)
  } else {
    selectedItems.value = [...selectedItems.value, item]
  }
  emit('update:modelValue', selectedItems.value)
}

// Catalog link lives on the Treatment; item.catalog_item is kept for historical
// records and may be absent, so fall back to treatment.catalog_item.
function getCatalog(item: PlannedTreatmentItem) {
  return item.catalog_item || item.treatment?.catalog_item
}

function getItemName(item: PlannedTreatmentItem): string {
  const catalog = getCatalog(item)
  const names = catalog?.names
  if (names) {
    const name = names[locale.value] || names.es
    if (name) return name
    if (catalog?.internal_code) return catalog.internal_code
  }
  const clinicalType = item.treatment?.clinical_type
  if (clinicalType) {
    const key = `odontogram.treatments.types.${clinicalType}`
    const translated = t(key)
    if (translated !== key) return translated
    return clinicalType
  }
  return t('treatmentPlans.unknownTreatment')
}

// Reads the Treatment's frozen price_snapshot when present. Absent for
// dentist sessions — FinancialVisibilityPolicy strips it server-side,
// so this naturally renders nothing rather than needing a frontend check.
function getItemPrice(item: PlannedTreatmentItem): number | undefined {
  const snap = item.treatment?.price_snapshot
  if (snap) {
    const parsed = Number(snap)
    if (Number.isFinite(parsed)) return parsed
  }
  const def = getCatalog(item)?.default_price
  const parsed = typeof def === 'string' ? Number(def) : def
  return typeof parsed === 'number' && Number.isFinite(parsed) ? parsed : undefined
}

function getToothInfo(item: PlannedTreatmentItem): string | null {
  const teeth = item.treatment?.teeth ?? []
  if (teeth.length === 0) return null
  const tooth = teeth[0]
  if (teeth.length === 1 && tooth) {
    const surfaces = (tooth.surfaces as string[] | undefined)?.join(', ')
    return surfaces ? `#${tooth.tooth_number} (${surfaces})` : `#${tooth.tooth_number}`
  }
  return `#${teeth.map(x => x.tooth_number).join(', ')}`
}

function getSessionLabel(item: PlannedTreatmentItem): string | null {
  const sessions = item.sessions ?? []
  if (sessions.length <= 1) return null
  const next = sessions.find(s => s.status === 'pending') ?? sessions[0]
  if (!next) return null
  return next.label || t('appointments.sessionN', { n: next.sequence })
}

function getProfessionalName(item: PlannedTreatmentItem): string | null {
  const id = item.assigned_professional_id
  if (!id || !props.professionals) return null
  const prof = props.professionals.find(p => p.id === id)
  return prof ? `${prof.first_name} ${prof.last_name}` : null
}

const hasPlans = computed(() => plans.value.length > 0)
const currentPlanHasItems = computed(() => planItems.value.length > 0)
</script>

<template>
  <div class="space-y-3">
    <!-- No patient selected -->
    <div
      v-if="!patientId"
      class="text-sm text-muted text-center py-4"
    >
      {{ t('appointments.selectPatientFirst') }}
    </div>

    <!-- Loading plans -->
    <div
      v-else-if="isLoadingPlans"
      class="flex items-center justify-center py-4"
    >
      <UIcon
        name="i-lucide-loader-2"
        class="w-5 h-5 animate-spin text-subtle"
      />
    </div>

    <!-- No vigente plans -->
    <div
      v-else-if="!hasPlans"
      class="text-sm text-muted text-center py-4 bg-surface-muted rounded-lg"
    >
      <UIcon
        name="i-lucide-clipboard-list"
        class="w-8 h-8 mx-auto mb-2 text-subtle"
      />
      <p>{{ t('appointments.noActivePlans') }}</p>
      <p class="text-xs mt-1">
        {{ t('appointments.createPlanFirst') }}
      </p>
    </div>

    <template v-else>
      <UFormField :label="t('appointments.selectPlan')">
        <USelect
          v-model="selectedPlanId"
          :items="plans.map(p => ({ value: p.id, label: planLabel(p) }))"
          value-key="value"
          label-key="label"
          :placeholder="t('appointments.selectPlan')"
          icon="i-lucide-clipboard-list"
        />
      </UFormField>

      <div v-if="selectedPlanId">
        <p class="text-caption text-subtle mb-1.5">
          {{ t('appointments.pendingTreatments') }}
        </p>

        <div
          v-if="isLoadingItems"
          class="flex items-center justify-center py-4"
        >
          <UIcon
            name="i-lucide-loader-2"
            class="w-5 h-5 animate-spin text-subtle"
          />
        </div>

        <div
          v-else-if="!currentPlanHasItems"
          class="text-sm text-muted text-center py-4 bg-surface-muted rounded-lg"
        >
          {{ t('appointments.noPendingTreatmentsInPlan') }}
        </div>

        <div
          v-else
          class="space-y-2"
        >
          <div
            v-for="item in planItems"
            :key="item.id"
            class="flex items-start gap-2.5 p-2.5 rounded-lg border border-default hover:bg-elevated transition-colors cursor-pointer"
            :class="selectedIds.has(item.id) ? 'border-primary bg-[var(--color-primary-soft)]' : ''"
            @click="toggleItem(item)"
          >
            <UCheckbox
              :model-value="selectedIds.has(item.id)"
              class="mt-0.5"
              @click.stop
              @update:model-value="toggleItem(item)"
            />
            <div class="min-w-0 flex-1">
              <p class="text-sm font-medium text-default truncate">
                {{ getItemName(item) }}
              </p>
              <div class="flex items-center gap-2 mt-1 flex-wrap">
                <UBadge
                  v-if="getToothInfo(item)"
                  size="xs"
                  color="neutral"
                  variant="subtle"
                >
                  {{ getToothInfo(item) }}
                </UBadge>
                <UBadge
                  v-if="getSessionLabel(item)"
                  size="xs"
                  color="neutral"
                  variant="subtle"
                >
                  {{ getSessionLabel(item) }}
                </UBadge>
                <UBadge
                  v-if="getProfessionalName(item)"
                  size="xs"
                  color="neutral"
                  variant="subtle"
                  icon="i-lucide-user"
                >
                  {{ getProfessionalName(item) }}
                </UBadge>
              </div>
            </div>
            <span
              v-if="getItemPrice(item)"
              class="text-sm font-semibold text-primary-accent whitespace-nowrap"
            >
              {{ formatPrice(getItemPrice(item)) }}
            </span>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>
