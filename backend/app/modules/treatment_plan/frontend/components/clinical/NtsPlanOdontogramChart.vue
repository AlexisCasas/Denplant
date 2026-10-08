<script setup lang="ts">
/* eslint-disable @stylistic/max-statements-per-line */
/** NTS geometry for the Plan, wired to the established clinical treatment flows. */
import type { ClinicalType, MultiToothTreatmentConfig, PlannedTreatmentItem, Surface, ToothTreatmentView, Treatment, TreatmentCreate, TreatmentStatus } from '~~/app/types'
import { calculateToothRange, getMultiToothConfig, isSameArch } from '~~/app/config/odontogramConstants'
import { viewForTooth } from '~~/app/utils/treatmentView'
import { isSurfaceTreatment } from '../../../../odontogram/frontend/components/odontogram/TreatmentIcons'
import GlobalTreatmentsStrip from '../../../../odontogram/frontend/components/odontogram/GlobalTreatmentsStrip.vue'
import MultiToothConfirmPopup from '../../../../odontogram/frontend/components/odontogram/MultiToothConfirmPopup.vue'
import SurfaceSelectorPopup from '../../../../odontogram/frontend/components/odontogram/SurfaceSelectorPopup.vue'
import TreatmentBar from '../../../../odontogram/frontend/components/odontogram/TreatmentBar.vue'
import TreatmentEditModal from '../../../../odontogram/frontend/components/odontogram/TreatmentEditModal.vue'
import { useTreatments } from '../../../../odontogram/frontend/composables/useTreatments'
import { useTreatmentPlans } from '../../composables/useTreatmentPlans'
import { NTS_ROWS } from '../../../../odontogram/frontend/utils/ntsDentition'
import { NTS_CHART_HEIGHT, NTS_CHART_SCALE, NTS_CHART_VIEWBOX, NTS_CHART_WIDTH, toothPlacement } from '../../../../odontogram/frontend/utils/ntsChartGeometry'
import NtsDentitionRow from '../../../../odontogram/frontend/components/odontogram/NtsDentitionRow.vue'

const props = withDefaults(defineProps<{
  items: PlannedTreatmentItem[]
  patientId?: string
  planId?: string
  planTitle?: string
  readonly?: boolean
  highlightedTeeth?: number[]
  highlightedGlobalIds?: string[]
}>(), { patientId: '', planId: '', planTitle: '', readonly: false, highlightedTeeth: () => [], highlightedGlobalIds: () => [] })
const emit = defineEmits<{
  toothSelect: [fdi: number]
  toothHover: [fdi: number | null]
  globalHover: [treatmentId: string | null]
  archHover: [arch: 'upper' | 'lower' | null]
  treatmentsChanged: []
}>()

const { t, locale } = useI18n()
const toast = useToast()
const { treatments, fetchTreatments, createTreatment, updateTreatment, deleteTreatment, performTreatment } = useTreatments()
const treatmentPlansApi = useTreatmentPlans()
const selectedTooth = ref<number | null>(null)
const selectedTreatmentType = ref<string | null>(null)
const selectedCatalogItemId = ref<string | null>(null)
const selectedTreatmentStatus = ref<TreatmentStatus>('planned')
const showSurfaceSelector = ref(false)
const multiToothSelection = ref<{ teeth: number[], anchor: number | null }>({ teeth: [], anchor: null })
const showMultiToothConfirm = ref(false)
const editingTreatment = ref<ToothTreatmentView | null>(null)
const showTreatmentEditModal = ref(false)
const undoStack = ref<string[]>([])

type MarkerSurface = 'M' | 'D' | 'O' | 'V' | 'L'
interface ToothMarker { itemId: string, treatmentId: string, fdi: number, type: string, status: PlannedTreatmentItem['status'], surfaces: MarkerSurface[], role: 'pillar' | 'pontic' | null }
const markers = computed<ToothMarker[]>(() => props.items.flatMap(item => (item.treatment?.teeth ?? []).map(tooth => ({ itemId: item.id, treatmentId: item.treatment?.id ?? item.treatment_id, fdi: tooth.tooth_number, type: item.treatment?.clinical_type ?? 'migrated', status: item.status, surfaces: (tooth.surfaces ?? []) as MarkerSurface[], role: tooth.role ?? null }))))
const markersByTooth = computed(() => markers.value.reduce<Record<number, ToothMarker[]>>((byTooth, marker) => { ;(byTooth[marker.fdi] ??= []).push(marker); return byTooth }, {}))
const bridges = computed(() => props.items.filter(item => item.treatment?.clinical_type === 'bridge').map(item => (item.treatment?.teeth ?? []).map(tooth => tooth.tooth_number).map(toothPlacement).filter((placement): placement is NonNullable<typeof placement> => placement !== null)).filter(placements => placements.length > 1))
const planTreatmentIds = computed(() => new Set(props.items.map(item => item.treatment_id)))
const planTreatments = computed(() => treatments.value.filter(treatment => planTreatmentIds.value.has(treatment.id)))
const selectedToothTreatments = computed(() => !selectedTooth.value ? [] : planTreatments.value.map(treatment => viewForTooth(treatment, selectedTooth.value!)).filter((treatment): treatment is ToothTreatmentView => treatment !== null))
const selectedTeeth = computed(() => [...new Set([...props.highlightedTeeth, ...multiToothSelection.value.teeth, ...(selectedTooth.value ? [selectedTooth.value] : [])])])
const isClickToApplyMode = computed(() => selectedTreatmentType.value !== null || selectedCatalogItemId.value !== null)
const multiToothConfig = computed<MultiToothTreatmentConfig | null>(() => selectedTreatmentType.value ? getMultiToothConfig(selectedTreatmentType.value) : null)

function surfacePoint(marker: ToothMarker, surface: MarkerSurface) {
  const crown = toothPlacement(marker.fdi)?.crown
  if (!crown) return null
  const { x, y, width: w, height: h } = crown
  return { M: { x: x + w * 0.22, y: y + h * 0.5 }, D: { x: x + w * 0.78, y: y + h * 0.5 }, O: { x: x + w * 0.5, y: y + h * 0.5 }, V: { x: x + w * 0.5, y: y + h * 0.22 }, L: { x: x + w * 0.5, y: y + h * 0.78 } }[surface]
}
function markerTone(marker: ToothMarker) { return marker.status === 'completed' ? 'var(--color-success-500)' : marker.status === 'cancelled' ? 'var(--color-text-dimmed)' : 'var(--color-primary-500)' }
function markerTitle(marker: ToothMarker) { return `${marker.type}${marker.role ? ` (${marker.role})` : ''}` }
function treatmentLabel(treatment: ToothTreatmentView) { return treatment.catalog_item?.names?.[locale.value] || treatment.catalog_item?.names?.es || t(`odontogram.treatments.types.${treatment.clinical_type}`, treatment.clinical_type) }
function resetMultiToothSelection() { multiToothSelection.value = { teeth: [], anchor: null }; showMultiToothConfirm.value = false }
function cancelClickToApplyMode() { selectedTreatmentType.value = null; selectedCatalogItemId.value = null; selectedTooth.value = null; resetMultiToothSelection() }
function handleToothSelect(toothNumber: number) {
  emit('toothSelect', toothNumber); selectedTooth.value = toothNumber
  if (props.readonly || !isClickToApplyMode.value) return
  if (multiToothConfig.value) handleMultiToothClick(toothNumber)
  else if (selectedTreatmentType.value && isSurfaceTreatment(selectedTreatmentType.value)) showSurfaceSelector.value = true
  else void applyTreatment(toothNumber)
}
function handleMultiToothClick(toothNumber: number) {
  const cfg = multiToothConfig.value
  if (!cfg) return
  if (cfg.selectionMode === 'range') {
    if (multiToothSelection.value.anchor === null) { multiToothSelection.value = { teeth: [toothNumber], anchor: toothNumber }; return }
    try {
      const range = calculateToothRange(multiToothSelection.value.anchor, toothNumber)
      if (range.length < cfg.minTeeth || range.length > cfg.maxTeeth) { toast.add({ title: t(range.length < cfg.minTeeth ? 'odontogram.multiTooth.errors.tooFew' : 'odontogram.multiTooth.errors.tooMany', { n: range.length < cfg.minTeeth ? cfg.minTeeth : cfg.maxTeeth }), color: 'warning' }); return }
      multiToothSelection.value = { teeth: range, anchor: multiToothSelection.value.anchor }; showMultiToothConfirm.value = true
    } catch { toast.add({ title: t('odontogram.multiTooth.errors.sameArchRequired'), color: 'warning' }) }
    return
  }
  const selected = multiToothSelection.value.teeth
  if (selected.includes(toothNumber)) { multiToothSelection.value = { ...multiToothSelection.value, teeth: selected.filter(t => t !== toothNumber) }; return }
  const candidate = [...selected, toothNumber]
  if ((cfg.requiresSameArch && !isSameArch(candidate)) || candidate.length > cfg.maxTeeth) { toast.add({ title: t(cfg.requiresSameArch && !isSameArch(candidate) ? 'odontogram.multiTooth.errors.sameArchRequired' : 'odontogram.multiTooth.errors.tooMany', { n: cfg.maxTeeth }), color: 'warning' }); return }
  multiToothSelection.value = { ...multiToothSelection.value, teeth: candidate }
}
function canConfirmFreeSelection() { return multiToothConfig.value?.selectionMode === 'free' && multiToothSelection.value.teeth.length >= multiToothConfig.value.minTeeth }
async function attachToPlan(treatment: Treatment) { if (props.planId) await treatmentPlansApi.addItem(props.planId, { treatment_id: treatment.id }) }
async function applyTreatment(toothNumber: number, surfaces?: Surface[]) {
  if (!props.patientId || !isClickToApplyMode.value) return
  const payload: TreatmentCreate = { tooth_numbers: [toothNumber], status: 'planned', scope: 'tooth' }
  if (selectedCatalogItemId.value) payload.catalog_item_id = selectedCatalogItemId.value
  if (selectedTreatmentType.value) payload.clinical_type = selectedTreatmentType.value as ClinicalType
  if (surfaces?.length) payload.surfaces = surfaces
  const created = await createTreatment(props.patientId, payload)
  if (!created) return
  await attachToPlan(created); undoStack.value.push(created.id); emit('treatmentsChanged'); cancelClickToApplyMode()
}
function handleSurfaceConfirm(surfaces: Surface[]) { if (selectedTooth.value && surfaces.length) void applyTreatment(selectedTooth.value, surfaces); selectedTooth.value = null }
async function confirmMultiToothSelection(roles: Array<{ tooth_number: number, role: 'pillar' | 'pontic' }> | null) {
  const cfg = multiToothConfig.value
  if (!cfg || !props.patientId) return
  const payload: TreatmentCreate = { scope: 'multi_tooth', status: 'planned', clinical_type: (cfg.mode === 'bridge' ? 'bridge' : cfg.key) as ClinicalType }
  if (cfg.mode === 'bridge' && roles?.length) payload.teeth = roles
  else payload.tooth_numbers = [...multiToothSelection.value.teeth].sort((a, b) => a - b)
  if (selectedCatalogItemId.value) payload.catalog_item_id = selectedCatalogItemId.value
  const created = await createTreatment(props.patientId, payload)
  if (!created) return
  await attachToPlan(created); undoStack.value.push(created.id); emit('treatmentsChanged'); cancelClickToApplyMode()
}
async function handleUndo() { const treatmentId = undoStack.value.pop(); if (!treatmentId) return; await deleteTreatment(treatmentId); emit('treatmentsChanged') }
async function refetchTreatments() { if (props.patientId) await fetchTreatments(props.patientId) }
async function handleGlobalTreatmentApplied(_treatment: Treatment) { await refetchTreatments(); emit('treatmentsChanged') }
function editTreatment(treatment: ToothTreatmentView) { editingTreatment.value = treatment; showTreatmentEditModal.value = true }
async function handleTreatmentUpdate(treatmentId: string, data: { status?: TreatmentStatus, notes?: string }) { await updateTreatment(treatmentId, data); await refetchTreatments(); showTreatmentEditModal.value = false; editingTreatment.value = null; emit('treatmentsChanged') }
async function handleTreatmentDelete(treatmentId: string) { await deleteTreatment(treatmentId); await refetchTreatments(); showTreatmentEditModal.value = false; editingTreatment.value = null; emit('treatmentsChanged') }
async function handleTreatmentPerform(treatmentId: string) { await performTreatment(treatmentId); await refetchTreatments(); showTreatmentEditModal.value = false; editingTreatment.value = null; emit('treatmentsChanged') }
onMounted(() => refetchTreatments())
watch(() => props.patientId, () => refetchTreatments())
defineExpose({ refetchTreatments })
</script>

<template>
  <section
    class="space-y-3"
    data-testid="nts-plan-odontogram-chart"
    aria-label="Odontograma del plan de tratamiento"
  >
    <p
      class="text-caption text-subtle"
      data-testid="nts-plan-odontogram-description"
    >
      Tratamientos del plan sobre la geometría del odontograma clínico. Los indicadores no son hallazgos MINSA.
    </p>
    <div
      class="overflow-x-auto"
      data-testid="nts-plan-chart-scroll"
    >
      <div
        class="relative mx-auto py-2 space-y-1"
        :class="{ 'cursor-crosshair': isClickToApplyMode && !readonly }"
        :style="{ minWidth: `${NTS_CHART_WIDTH}px` }"
        data-testid="nts-plan-chart-canvas"
      >
        <NtsDentitionRow
          v-for="row in NTS_ROWS"
          :key="row.id"
          :row="row"
          :scale="NTS_CHART_SCALE"
          selectable
          purpose="pick"
          :selected-teeth="selectedTeeth"
          :class="row.id === 'deciduousUpper' ? 'pt-3' : row.id === 'permanentLower' ? 'pt-3' : ''"
          @select="handleToothSelect"
        />
        <svg
          class="pointer-events-none absolute top-0 left-1/2 -translate-x-1/2"
          :viewBox="NTS_CHART_VIEWBOX"
          :width="NTS_CHART_WIDTH"
          :height="NTS_CHART_HEIGHT"
          aria-hidden="true"
          focusable="false"
          data-testid="nts-plan-chart-overlay"
        ><template
          v-for="(bridge, index) in bridges"
          :key="index"
        ><line
          v-for="(placement, placementIndex) in bridge.slice(1)"
          :key="`${placement.fdi}-${placementIndex}`"
          :x1="bridge[placementIndex]?.center.x"
          :y1="bridge[placementIndex]?.center.y"
          :x2="placement.center.x"
          :y2="placement.center.y"
          stroke="var(--color-primary-500)"
          stroke-width="2"
          stroke-dasharray="3 2"
        /></template><template
          v-for="(toothMarkers, fdi) in markersByTooth"
          :key="fdi"
        ><template v-if="toothPlacement(Number(fdi))"><rect
          :x="toothPlacement(Number(fdi))!.crown.x"
          :y="toothPlacement(Number(fdi))!.crown.y"
          :width="toothPlacement(Number(fdi))!.crown.width"
          :height="toothPlacement(Number(fdi))!.crown.height"
          rx="2"
          fill="none"
          :stroke="markerTone(toothMarkers[0]!)"
          stroke-width="1.5"
        /><circle
          v-for="(marker, markerIndex) in toothMarkers"
          :key="marker.itemId"
          :cx="toothPlacement(Number(fdi))!.annotation.x + toothPlacement(Number(fdi))!.annotation.width - 5 - markerIndex * 6"
          :cy="toothPlacement(Number(fdi))!.annotation.y + 6"
          r="2.5"
          :fill="markerTone(marker)"
        ><title>{{ markerTitle(marker) }}</title></circle><template
          v-for="marker in toothMarkers"
          :key="`${marker.itemId}-surfaces`"
        ><circle
          v-for="surface in marker.surfaces"
          :key="surface"
          :cx="surfacePoint(marker, surface)?.x"
          :cy="surfacePoint(marker, surface)?.y"
          r="1.8"
          :fill="markerTone(marker)"
        /></template></template></template></svg>
      </div>
    </div>
    <GlobalTreatmentsStrip
      v-if="patientId"
      :treatments="planTreatments"
      :highlighted-ids="highlightedGlobalIds"
      @treatment-hover="emit('globalHover', $event)"
      @arch-hover="emit('archHover', $event)"
    />
    <div
      v-if="selectedTooth && !isClickToApplyMode"
      class="flex flex-wrap items-center gap-2 rounded-md border border-default p-2"
      data-testid="nts-plan-tooth-selection"
    >
      <span class="text-sm font-medium">{{ t('odontogram.tooth') }} {{ selectedTooth }}</span><span
        v-if="selectedToothTreatments.length === 0"
        class="text-caption text-subtle"
      >Sin tratamientos del plan.</span><UButton
        v-for="treatment in selectedToothTreatments"
        :key="treatment.id"
        size="xs"
        variant="soft"
        :disabled="readonly"
        @click="editTreatment(treatment)"
      >
        {{ treatmentLabel(treatment) }}
      </UButton>
    </div>
    <TreatmentBar
      v-if="!readonly && patientId"
      v-model:selected-treatment="selectedTreatmentType"
      v-model:selected-catalog-item-id="selectedCatalogItemId"
      :selected-status="selectedTreatmentStatus"
      :selected-plan-id="planId"
      :plan-context-title="planTitle"
      :patient-id="patientId"
      mode="planning"
      @update:selected-status="selectedTreatmentStatus = $event"
      @treatment-select="selectedTreatmentType = $event"
      @treatment-applied="handleGlobalTreatmentApplied"
      @cancel="cancelClickToApplyMode"
    />
    <p
      v-if="items.some(item => !item.treatment?.teeth?.length)"
      class="text-caption text-subtle"
    >
      Los tratamientos por arco, boca completa o sin una representación dental se mantienen en la lista del plan.
    </p>
    <SurfaceSelectorPopup
      v-if="patientId"
      v-model:open="showSurfaceSelector"
      :tooth-number="selectedTooth || 0"
      :treatment-type="(selectedTreatmentType as ClinicalType) || 'filling_composite'"
      status="planned"
      @confirm="handleSurfaceConfirm"
      @cancel="selectedTooth = null"
    />
    <TreatmentEditModal
      v-if="patientId"
      v-model:open="showTreatmentEditModal"
      :treatment="editingTreatment"
      @update="handleTreatmentUpdate"
      @delete="handleTreatmentDelete"
      @perform="handleTreatmentPerform"
    />
    <MultiToothConfirmPopup
      v-if="patientId && multiToothConfig"
      v-model:open="showMultiToothConfirm"
      :config="multiToothConfig"
      :teeth="multiToothSelection.teeth"
      status="planned"
      @confirm="confirmMultiToothSelection"
      @cancel="resetMultiToothSelection"
    />
    <div
      v-if="multiToothConfig?.selectionMode === 'free' && multiToothSelection.teeth.length > 0 && !showMultiToothConfirm"
      class="flex items-center gap-2 rounded-md border border-default bg-surface p-2"
      data-testid="nts-plan-multi-selection"
    >
      <span class="text-sm">{{ multiToothSelection.teeth.join(', ') }}</span><UButton
        size="xs"
        variant="ghost"
        @click="resetMultiToothSelection"
      >
        {{ t('common.cancel') }}
      </UButton><UButton
        size="xs"
        :disabled="!canConfirmFreeSelection()"
        @click="showMultiToothConfirm = true"
      >
        {{ t('common.confirm') }}
      </UButton>
    </div>
    <UButton
      v-if="undoStack.length && !readonly"
      size="xs"
      variant="ghost"
      @click="handleUndo"
    >
      {{ t('common.undo') }}
    </UButton>
  </section>
</template>
