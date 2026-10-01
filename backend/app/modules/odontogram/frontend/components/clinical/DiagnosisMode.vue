<script setup lang="ts">
/**
 * DiagnosisMode - Record current patient conditions
 *
 * Features:
 * - Odontogram in diagnosis mode (only diagnostic categories)
 * - List of recorded conditions with hover linking
 * - Contextual CTA to create/continue treatment plan
 *
 * The chart takes the full width: the clinical-notes rail that used to sit
 * beside it moved to the Evolución tab. "Añadir nota" is the way across, and
 * carries the tooth the clinician was last on so a diagnosis note can still be
 * bound to it.
 *
 * This host deliberately no longer renders the ``odontogram.diagnosis.sidebar``
 * slot. The slot name stays a registered contract (clinical_notes still
 * registers into it); it is simply not drawn here.
 */

const props = withDefaults(defineProps<{
  patientId: string
  readonly?: boolean
  /** Whether "Añadir nota" is offered (the host decides: it needs notes access). */
  canAddNote?: boolean
}>(), { canAddNote: true })

const emit = defineEmits<{
  'create-plan': []
  'continue-plan': [planId: string]
  /** Go write a note. The tooth is the last one the clinician was on, if any. */
  'add-note': [toothNumber: number | null]
}>()

const { t } = useI18n()

// ============================================================================
// Composables
// ============================================================================

const { treatments, fetchTreatments, loading: odontogramLoading } = useOdontogram()
const { plans, fetchPatientPlans, loading: plansLoading } = useTreatmentPlans()
const { profile } = useOdontogramProfile()

// The two panels below the chart are Original-shaped: `conditions` are
// `Treatment` rows with `status = 'existing'`, and the CTA turns them into a
// treatment plan. Under the MINSA profile that would present a Treatment as
// if it were an NTS finding — the one thing the norm separates (§5.8:
// findings are not procedures). So they are hidden there, not removed:
// Original keeps them exactly as before, and the NTS equivalent arrives with
// the finding editor.
const isNtsProfile = computed(() => profile.value === 'pe_nts_188_2022')

// ============================================================================
// State
// ============================================================================

// Hover linking between odontogram and conditions list
const hoveredTeeth = ref<number[]>([])
// Last tooth the clinician was on. "Añadir nota" hands it to Evolución so a
// diagnosis note can be bound to it; with none, no tooth is sent.
const selectedTooth = ref<number | null>(null)

// ============================================================================
// Computed
// ============================================================================

// Filter only diagnostic conditions (status = 'existing'). Migrated
// historical treatments are hidden from this panel — bulk-importing a
// patient's entire chart history floods the diagnosis tab and makes
// the active workflow ("what am I diagnosing today?") unusable.
// The artefacts they leave (missing tooth, crown, implant…) are still
// reflected in the odontogram via ``ToothRecord.general_condition``,
// and the full historical record stays accessible from the History
// tab and the treatment plans created by the importer.
const conditions = computed(() =>
  treatments.value.filter(
    t => t.status === 'existing' && t.source_module !== 'migration_import'
  )
)

// Draft plans for contextual CTA
const draftPlans = computed(() =>
  plans.value.filter(p => p.status === 'draft')
)

// Combined loading state
const loading = computed(() => odontogramLoading.value || plansLoading.value)

// Collapsible state for conditions block
const conditionsCollapsed = ref(false)

// ============================================================================
// Lifecycle
// ============================================================================

onMounted(async () => {
  await Promise.all([
    fetchTreatments(props.patientId),
    fetchPatientPlans(props.patientId)
  ])
})

// ============================================================================
// Handlers
// ============================================================================

function handleToothHover(toothNumber: number | null) {
  hoveredTeeth.value = toothNumber ? [toothNumber] : []
  if (toothNumber) selectedTooth.value = toothNumber
}

function handleConditionHover(toothNumber: number | null) {
  hoveredTeeth.value = toothNumber ? [toothNumber] : []
}

async function handleTreatmentsChanged() {
  await fetchTreatments(props.patientId)
}
</script>

<template>
  <!-- The chart and its panels take the full width. The clinical-notes rail,
       its mobile button and its slideover used to live here; the notes now
       live in the Evolución tab, and this host no longer renders that slot
       (see the header comment). -->
  <div class="space-y-4">
    <!-- Loading state -->
    <div
      v-if="loading"
      class="flex items-center justify-center py-8"
    >
      <UIcon
        name="i-lucide-loader-2"
        class="w-8 h-8 animate-spin text-primary-accent"
      />
    </div>

    <template v-else>
      <!-- Odontogram with diagnosis mode -->
      <UCard>
        <template #header>
          <div class="flex items-center justify-between gap-3 flex-wrap">
            <div class="flex items-center gap-2">
              <UIcon
                name="i-lucide-stethoscope"
                class="w-5 h-5 text-primary-accent"
              />
              <span class="font-medium">{{ t('clinical.diagnosis.registerConditions') }}</span>
            </div>
            <div class="flex items-center gap-2">
              <UButton
                v-if="canAddNote"
                size="xs"
                variant="soft"
                color="neutral"
                icon="i-lucide-notebook-pen"
                data-testid="diagnosis-add-note"
                @click="emit('add-note', selectedTooth)"
              >
                {{ t('clinical.diagnosis.addNote') }}
              </UButton>
              <OdontogramProfileSelector />
            </div>
          </div>
        </template>

        <!-- Profile-aware mount point: renders the original chart or the
             MINSA placeholder. `OdontogramChart` itself stays untouched
             and profile-unaware. -->
        <OdontogramProfileView
          :patient-id="patientId"
          mode="diagnosis"
          :highlighted-teeth-prop="hoveredTeeth"
          @tooth-hover="handleToothHover"
          @treatments-changed="handleTreatmentsChanged"
        />
      </UCard>

      <!-- Registered conditions list (Original semantics: Treatment rows) -->
      <UCard v-if="!isNtsProfile">
        <template #header>
          <button
            type="button"
            class="w-full flex items-center justify-between gap-2 text-left"
            :aria-expanded="!conditionsCollapsed"
            @click="conditionsCollapsed = !conditionsCollapsed"
          >
            <div class="flex items-center gap-2">
              <UIcon
                :name="conditionsCollapsed ? 'i-lucide-chevron-right' : 'i-lucide-chevron-down'"
                class="w-4 h-4 text-subtle transition-transform"
              />
              <UIcon
                name="i-lucide-clipboard-list"
                class="w-5 h-5"
              />
              <span class="font-medium">{{ t('clinical.diagnosis.registeredConditions') }}</span>
            </div>
            <UBadge
              v-if="conditions.length > 0"
              color="neutral"
              variant="subtle"
            >
              {{ conditions.length }}
            </UBadge>
          </button>
        </template>

        <ConditionsList
          v-if="!conditionsCollapsed"
          :conditions="conditions"
          :patient-id="patientId"
          :highlighted-teeth="hoveredTeeth"
          @tooth-hover="handleConditionHover"
        />
      </UCard>

      <!-- Contextual CTA -->
      <DiagnosisCTA
        v-if="!isNtsProfile && !readonly && conditions.length > 0"
        :draft-plans="draftPlans"
        @create="emit('create-plan')"
        @continue="emit('continue-plan', $event)"
      />
    </template>
  </div>
</template>
