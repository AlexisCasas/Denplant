<script setup lang="ts">
type YesNo = '' | 'no' | 'yes'

type ClinicalRow = {
  id: string
  canal: string
  workingLength: string
  referencePoint: string
  initialFile: string
  finalApicalFile: string
  cementType: string
  masterGuttaPerchaCone: string
}

type EndodonticChannel = {
  channel_code?: string | null
  conduct?: string | null
  working_length_mm?: number | null
  reference_point?: string | null
  initial_file?: string | null
  final_apical_file?: string | null
  cement_type?: string | null
  master_gutta_percha_cone?: string | null
}

type EndodonticApiResponse = {
  id?: string | null
  professional_id?: string | null
  prior_endodontic_treatment?: string | null
  pain_history?: string | null
  initial_note?: string | null
  tooth_number?: number | null
  anatomical_crown?: string[] | null
  inflammation?: boolean | null
  fistulas?: boolean | null
  gingivitis?: boolean | null
  pockets?: boolean | null
  calculus?: boolean | null
  inflammation_detail?: string | null
  fistulas_detail?: string | null
  gingivitis_detail?: string | null
  pockets_detail?: string | null
  pain_characteristics?: string[] | null
  percussion_pain?: string[] | null
  palpation_pain?: string[] | null
  clinical_exam_note?: string | null
  heat_response?: boolean | null
  heat_duration?: string | null
  heat_intensity?: string | null
  cold_response?: boolean | null
  cold_duration?: string | null
  cold_intensity?: string | null
  pulp_chamber?: string[] | null
  canals_count?: string[] | null
  canals_characteristics?: string[] | null
  furcation_lesion?: boolean | null
  apical_lesion?: boolean | null
  lateral_lesion?: boolean | null
  endo_perio_lesion?: boolean | null
  dwarf_roots?: boolean | null
  root_fracture?: boolean | null
  calcification?: boolean | null
  periodontal_ligament?: boolean | null
  resorption?: boolean | null
  root_fracture_detail?: string | null
  calcification_detail?: string | null
  periodontal_ligament_detail?: string | null
  resorption_detail?: string | null
  radiographic_note?: string | null
  presumptive_pulpal_diagnosis?: string[] | null
  presumptive_pulpal_note?: string | null
  periapical_diagnosis?: string[] | null
  periapical_note?: string | null
  definitive_diagnosis?: string[] | null
  definitive_note?: string | null
  indicated_treatment?: string[] | null
  indicated_treatment_note?: string | null
  clinical_data_note?: string | null
  operative_accidents?: string | null
  post_endodontic_restoration?: string[] | null
  prognosis?: string | null
  final_note?: string | null
  channels?: EndodonticChannel[] | null
}

const { t } = useI18n()
const toast = useToast()
const props = defineProps<{ patientId?: string }>()
const patientIdRef = toRef(props, 'patientId')
const { professionals, isLoading: isLoadingProfessionals, fetchProfessionals } = useProfessionals()
const { isLoading, isSaving, loadEndodonticRecords, createEndodontic, updateEndodontic } = usePatientAnamneses(patientIdRef)
const recordId = ref<string | null>(null)

const yesNoOptions = computed(() => [
  { value: 'yes', label: t('patientDetail.endodonticForm.yes') },
  { value: 'no', label: t('patientDetail.endodonticForm.no') }
])

const professionalOptions = computed(() => professionals.value.map(professional => ({
  value: professional.id,
  label: `${professional.first_name} ${professional.last_name}`
})))

// The existing codebase has no catalog for these selectors. Keeping their
// items intentionally empty preserves the visual workflow without inventing
// clinical values before the catalog is defined.
const emptySelectOptions: Array<{ value: string, label: string }> = []

function emptyForm() {
  return {
    professionalId: '',
    priorEndodonticTreatment: '',
    painHistory: '',
    initialNote: '',
    toothNumber: '',
    anatomicalCrown: [] as string[],
    clinicalStatus: {
      inflammation: '' as YesNo,
      fistulas: '' as YesNo,
      gingivitis: '' as YesNo,
      pockets: '' as YesNo,
      calculus: '' as YesNo
    } as Record<string, YesNo>,
    clinicalStatusDetails: {
      inflammation: '',
      fistulas: '',
      gingivitis: '',
      pockets: ''
    } as Record<string, string>,
    painCharacteristics: [] as string[],
    percussionPain: [] as string[],
    palpationPain: [] as string[],
    clinicalExamNote: '',
    vitality: {
      heat: '' as YesNo,
      heatDuration: '',
      heatIntensity: '',
      cold: '' as YesNo,
      coldDuration: '',
      coldIntensity: ''
    } as Record<string, string>,
    pulpChamber: [] as string[],
    canalsCount: [] as string[],
    canalsCharacteristics: [] as string[],
    radiographicFindings: {
      furcationLesion: '' as YesNo,
      apicalLesion: '' as YesNo,
      lateralLesion: '' as YesNo,
      endoPerioLesion: '' as YesNo,
      dwarfRoots: '' as YesNo,
      rootFracture: '' as YesNo,
      calcification: '' as YesNo,
      periodontalLigament: '' as YesNo,
      resorption: '' as YesNo
    } as Record<string, YesNo>,
    radiographicDetails: {
      rootFracture: '',
      calcification: '',
      periodontalLigament: '',
      resorption: ''
    } as Record<string, string>,
    radiographicNote: '',
    presumptivePulpalDiagnosis: [] as string[],
    presumptivePulpalNote: '',
    periapicalDiagnosis: [] as string[],
    periapicalNote: '',
    definitiveDiagnosis: [] as string[],
    definitiveNote: '',
    indicatedTreatment: [] as string[],
    indicatedTreatmentNote: '',
    clinicalDataNote: '',
    operativeAccidents: '',
    postEndodonticRestoration: [] as string[],
    prognosis: '',
    finalNote: ''
  }
}

const form = reactive(emptyForm())

const anatomicalCrownOptions = computed(() => [
  { value: 'caries', label: t('patientDetail.endodonticForm.caries') },
  { value: 'restoration', label: t('patientDetail.endodonticForm.restoration') },
  { value: 'bruxism', label: t('patientDetail.endodonticForm.bruxism') },
  { value: 'fracture', label: t('patientDetail.endodonticForm.fracture') },
  { value: 'fractureWithPulpExposure', label: t('patientDetail.endodonticForm.fractureWithPulpExposure') }
])

const clinicalStatusQuestions = computed(() => [
  { key: 'inflammation', label: t('patientDetail.endodonticForm.inflammationPresent'), associated: 'select', detailLabel: 'specify' },
  { key: 'fistulas', label: t('patientDetail.endodonticForm.fistulas'), associated: 'select', detailLabel: 'specify' },
  { key: 'gingivitis', label: t('patientDetail.endodonticForm.gingivitis'), associated: 'select', detailLabel: 'mobility' },
  { key: 'pockets', label: t('patientDetail.endodonticForm.pockets'), associated: 'input', detailLabel: 'probing' },
  { key: 'calculus', label: t('patientDetail.endodonticForm.calculus'), associated: null, detailLabel: null }
] as const)

const painCharacteristicOptions = computed(() => [
  'spontaneous', 'provoked', 'cold', 'heat', 'chewing', 'nocturnal', 'air', 'sweet', 'acidic', 'radiated', 'diffuse', 'stabbing', 'continuous', 'intermittent', 'sporadic'
].map(value => ({ value, label: t(`patientDetail.endodonticForm.${value}`) })))

const percussionOptions = computed(() => [
  { value: 'horizontal', label: t('patientDetail.endodonticForm.horizontal') },
  { value: 'vertical', label: t('patientDetail.endodonticForm.vertical') }
])

const palpationOptions = computed(() => [
  { value: 'vestibular', label: t('patientDetail.endodonticForm.vestibular') },
  { value: 'lingualPalatal', label: t('patientDetail.endodonticForm.lingualPalatal') }
])

const pulpChamberOptions = computed(() => [
  'open', 'closed', 'wide', 'narrow', 'pulpStones'
].map(value => ({ value, label: t(`patientDetail.endodonticForm.${value}`) })))

const canalsCountOptions = computed(() => [
  'singleCanal', 'twoCanals', 'threeCanals', 'fourCanals'
].map(value => ({ value, label: t(`patientDetail.endodonticForm.${value}`) })))

const canalsCharacteristicsOptions = computed(() => [
  'straight', 'curved', 'wide', 'narrow', 'previouslyTreated', 'openApex'
].map(value => ({ value, label: t(`patientDetail.endodonticForm.${value}`) })))

const radiographicQuestions = computed(() => [
  { key: 'furcationLesion', label: t('patientDetail.endodonticForm.furcationLesion'), associated: false },
  { key: 'apicalLesion', label: t('patientDetail.endodonticForm.apicalLesion'), associated: false },
  { key: 'lateralLesion', label: t('patientDetail.endodonticForm.lateralLesion'), associated: false },
  { key: 'endoPerioLesion', label: t('patientDetail.endodonticForm.endoPerioLesion'), associated: false },
  { key: 'dwarfRoots', label: t('patientDetail.endodonticForm.dwarfRoots'), associated: false },
  { key: 'rootFracture', label: t('patientDetail.endodonticForm.rootFracture'), associated: true },
  { key: 'calcification', label: t('patientDetail.endodonticForm.calcification'), associated: true },
  { key: 'periodontalLigament', label: t('patientDetail.endodonticForm.periodontalLigament'), associated: true },
  { key: 'resorption', label: t('patientDetail.endodonticForm.resorption'), associated: true }
] as const)

const presumptivePulpalOptions = computed(() => [
  'normalPulp', 'reversiblePulpitis', 'symptomaticIrreversiblePulpitis', 'asymptomaticIrreversiblePulpitis', 'pulpNecrosis', 'diagnosisPreviouslyTreated', 'previouslyInitiated'
].map(value => ({ value, label: t(`patientDetail.endodonticForm.${value}`) })))

const periapicalOptions = computed(() => [
  'healthyApicalTissues', 'acuteApicalPeriodontitis', 'chronicApicalPeriodontitis', 'acuteApicalAbscess', 'chronicApicalAbscess', 'condensingOsteitis'
].map(value => ({ value, label: t(`patientDetail.endodonticForm.${value}`) })))

const definitiveDiagnosisOptions = computed(() => [
  { value: 'irreversiblePulpitis', label: t('patientDetail.endodonticForm.irreversiblePulpitis') },
  { value: 'necroticPulp', label: t('patientDetail.endodonticForm.necroticPulp') }
])

const indicatedTreatmentOptions = computed(() => [
  'biopulpectomy', 'apicoectomy', 'necropulpectomy', 'hemisection', 'retreatment', 'radicectomy', 'whitening', 'extraction'
].map(value => ({ value, label: t(`patientDetail.endodonticForm.${value}`) })))

const restorationOptions = computed(() => [
  'post', 'amalgamResin', 'crown', 'other'
].map(value => ({ value, label: t(`patientDetail.endodonticForm.${value}`) })))

const prognosisOptions = computed(() => [
  { value: 'favorable', label: t('patientDetail.endodonticForm.favorable') },
  { value: 'unfavorable', label: t('patientDetail.endodonticForm.unfavorable') },
  { value: 'reserved', label: t('patientDetail.endodonticForm.reserved') }
])

const channelUiToApi: Record<string, string> = {
  single: 'single', vestibular: 'vestibular', palatalLingual: 'palatal_lingual', mesiolingual: 'mesiolingual', mesiobuccal: 'mesiobuccal', distal: 'distal', distobuccal: 'distobuccal', distolingual: 'distolingual'
}
const channelApiToUi = Object.fromEntries(Object.entries(channelUiToApi).map(([ui, api]) => [api, ui])) as Record<string, string>

function emptyClinicalRows(): ClinicalRow[] {
  return [
    'single', 'vestibular', 'palatalLingual', 'mesiolingual', 'mesiobuccal', 'distal', 'distobuccal', 'distolingual'
  ].map(id => ({ id, canal: '', workingLength: '', referencePoint: '', initialFile: '', finalApicalFile: '', cementType: '', masterGuttaPerchaCone: '' }))
}

const clinicalRows = reactive<ClinicalRow[]>(emptyClinicalRows())

function toYesNo(value: unknown): YesNo {
  return value === true ? 'yes' : value === false ? 'no' : ''
}

function yesNoToBoolean(value: string | undefined): boolean | null {
  return value === 'yes' ? true : value === 'no' ? false : null
}

function toNullable(value: string | undefined): string | null {
  return value?.trim() || null
}

function toNumberOrNull(value: string): number | null {
  const number = Number(value)
  return value.trim() && Number.isFinite(number) ? number : null
}

function resetForm() {
  Object.assign(form, emptyForm())
  clinicalRows.splice(0, clinicalRows.length, ...emptyClinicalRows())
  recordId.value = null
}

function applyRecord(data: EndodonticApiResponse | null) {
  resetForm()
  if (!data) return
  recordId.value = data.id ?? null
  form.professionalId = data.professional_id ?? ''
  form.priorEndodonticTreatment = data.prior_endodontic_treatment ?? ''
  form.painHistory = data.pain_history ?? ''
  form.initialNote = data.initial_note ?? ''
  form.toothNumber = data.tooth_number?.toString() ?? ''
  form.anatomicalCrown = data.anatomical_crown ?? []
  Object.assign(form.clinicalStatus, { inflammation: toYesNo(data.inflammation), fistulas: toYesNo(data.fistulas), gingivitis: toYesNo(data.gingivitis), pockets: toYesNo(data.pockets), calculus: toYesNo(data.calculus) })
  Object.assign(form.clinicalStatusDetails, { inflammation: data.inflammation_detail ?? '', fistulas: data.fistulas_detail ?? '', gingivitis: data.gingivitis_detail ?? '', pockets: data.pockets_detail ?? '' })
  form.painCharacteristics = data.pain_characteristics ?? []
  form.percussionPain = data.percussion_pain ?? []
  form.palpationPain = data.palpation_pain ?? []
  form.clinicalExamNote = data.clinical_exam_note ?? ''
  Object.assign(form.vitality, { heat: toYesNo(data.heat_response), heatDuration: data.heat_duration ?? '', heatIntensity: data.heat_intensity ?? '', cold: toYesNo(data.cold_response), coldDuration: data.cold_duration ?? '', coldIntensity: data.cold_intensity ?? '' })
  form.pulpChamber = data.pulp_chamber ?? []
  form.canalsCount = data.canals_count ?? []
  form.canalsCharacteristics = data.canals_characteristics ?? []
  Object.assign(form.radiographicFindings, { furcationLesion: toYesNo(data.furcation_lesion), apicalLesion: toYesNo(data.apical_lesion), lateralLesion: toYesNo(data.lateral_lesion), endoPerioLesion: toYesNo(data.endo_perio_lesion), dwarfRoots: toYesNo(data.dwarf_roots), rootFracture: toYesNo(data.root_fracture), calcification: toYesNo(data.calcification), periodontalLigament: toYesNo(data.periodontal_ligament), resorption: toYesNo(data.resorption) })
  Object.assign(form.radiographicDetails, { rootFracture: data.root_fracture_detail ?? '', calcification: data.calcification_detail ?? '', periodontalLigament: data.periodontal_ligament_detail ?? '', resorption: data.resorption_detail ?? '' })
  form.radiographicNote = data.radiographic_note ?? ''
  form.presumptivePulpalDiagnosis = data.presumptive_pulpal_diagnosis ?? []
  form.presumptivePulpalNote = data.presumptive_pulpal_note ?? ''
  form.periapicalDiagnosis = data.periapical_diagnosis ?? []
  form.periapicalNote = data.periapical_note ?? ''
  form.definitiveDiagnosis = data.definitive_diagnosis ?? []
  form.definitiveNote = data.definitive_note ?? ''
  form.indicatedTreatment = data.indicated_treatment ?? []
  form.indicatedTreatmentNote = data.indicated_treatment_note ?? ''
  form.clinicalDataNote = data.clinical_data_note ?? ''
  form.operativeAccidents = data.operative_accidents ?? ''
  form.postEndodonticRestoration = data.post_endodontic_restoration ?? []
  form.prognosis = data.prognosis ?? ''
  form.finalNote = data.final_note ?? ''
  for (const channel of data.channels ?? []) {
    const channelCode = channel.channel_code
    if (!channelCode) continue
    const row = clinicalRows.find(item => item.id === channelApiToUi[channelCode])
    if (!row) continue
    row.canal = channel.conduct ?? ''
    row.workingLength = channel.working_length_mm?.toString() ?? ''
    row.referencePoint = channel.reference_point ?? ''
    row.initialFile = channel.initial_file ?? ''
    row.finalApicalFile = channel.final_apical_file ?? ''
    row.cementType = channel.cement_type ?? ''
    row.masterGuttaPerchaCone = channel.master_gutta_percha_cone ?? ''
  }
}

function endodonticPayload(): Record<string, unknown> {
  const channels = clinicalRows.filter(row => [row.canal, row.workingLength, row.referencePoint, row.initialFile, row.finalApicalFile, row.cementType, row.masterGuttaPerchaCone].some(value => value.trim())).map(row => ({ channel_code: channelUiToApi[row.id], conduct: toNullable(row.canal), working_length_mm: toNumberOrNull(row.workingLength), reference_point: toNullable(row.referencePoint), initial_file: toNullable(row.initialFile), final_apical_file: toNullable(row.finalApicalFile), cement_type: toNullable(row.cementType), master_gutta_percha_cone: toNullable(row.masterGuttaPerchaCone) }))
  return {
    professional_id: toNullable(form.professionalId), tooth_number: toNumberOrNull(form.toothNumber), prior_endodontic_treatment: toNullable(form.priorEndodonticTreatment), pain_history: toNullable(form.painHistory), initial_note: toNullable(form.initialNote), anatomical_crown: form.anatomicalCrown, inflammation: yesNoToBoolean(form.clinicalStatus.inflammation), inflammation_detail: toNullable(form.clinicalStatusDetails.inflammation), fistulas: yesNoToBoolean(form.clinicalStatus.fistulas), fistulas_detail: toNullable(form.clinicalStatusDetails.fistulas), gingivitis: yesNoToBoolean(form.clinicalStatus.gingivitis), gingivitis_detail: toNullable(form.clinicalStatusDetails.gingivitis), pockets: yesNoToBoolean(form.clinicalStatus.pockets), pockets_detail: toNullable(form.clinicalStatusDetails.pockets), calculus: yesNoToBoolean(form.clinicalStatus.calculus), pain_characteristics: form.painCharacteristics, percussion_pain: form.percussionPain, palpation_pain: form.palpationPain, clinical_exam_note: toNullable(form.clinicalExamNote), heat_response: yesNoToBoolean(form.vitality.heat), heat_duration: toNullable(form.vitality.heatDuration), heat_intensity: toNullable(form.vitality.heatIntensity), cold_response: yesNoToBoolean(form.vitality.cold), cold_duration: toNullable(form.vitality.coldDuration), cold_intensity: toNullable(form.vitality.coldIntensity), pulp_chamber: form.pulpChamber, canals_count: form.canalsCount, canals_characteristics: form.canalsCharacteristics, furcation_lesion: yesNoToBoolean(form.radiographicFindings.furcationLesion), apical_lesion: yesNoToBoolean(form.radiographicFindings.apicalLesion), lateral_lesion: yesNoToBoolean(form.radiographicFindings.lateralLesion), endo_perio_lesion: yesNoToBoolean(form.radiographicFindings.endoPerioLesion), dwarf_roots: yesNoToBoolean(form.radiographicFindings.dwarfRoots), root_fracture: yesNoToBoolean(form.radiographicFindings.rootFracture), root_fracture_detail: toNullable(form.radiographicDetails.rootFracture), calcification: yesNoToBoolean(form.radiographicFindings.calcification), calcification_detail: toNullable(form.radiographicDetails.calcification), periodontal_ligament: yesNoToBoolean(form.radiographicFindings.periodontalLigament), periodontal_ligament_detail: toNullable(form.radiographicDetails.periodontalLigament), resorption: yesNoToBoolean(form.radiographicFindings.resorption), resorption_detail: toNullable(form.radiographicDetails.resorption), radiographic_note: toNullable(form.radiographicNote), presumptive_pulpal_diagnosis: form.presumptivePulpalDiagnosis, presumptive_pulpal_note: toNullable(form.presumptivePulpalNote), periapical_diagnosis: form.periapicalDiagnosis, periapical_note: toNullable(form.periapicalNote), definitive_diagnosis: form.definitiveDiagnosis, definitive_note: toNullable(form.definitiveNote), indicated_treatment: form.indicatedTreatment, indicated_treatment_note: toNullable(form.indicatedTreatmentNote), clinical_data_note: toNullable(form.clinicalDataNote), operative_accidents: toNullable(form.operativeAccidents), post_endodontic_restoration: form.postEndodonticRestoration, prognosis: toNullable(form.prognosis), final_note: toNullable(form.finalNote), channels
  }
}

async function load() {
  const records = await loadEndodonticRecords<EndodonticApiResponse>()
  if (records !== undefined) applyRecord(records[0] ?? null)
}

async function save() {
  const payload = endodonticPayload()
  const data = recordId.value
    ? await updateEndodontic<EndodonticApiResponse>(recordId.value, payload)
    : await createEndodontic<EndodonticApiResponse>(payload)
  if (!data) return
  applyRecord(data)
  toast.add({ title: t('common.success'), description: t('patientDetail.anamneses.endodonticSaved'), color: 'success' })
}

watch(patientIdRef, () => {
  load()
}, { immediate: true })

onMounted(fetchProfessionals)
</script>

<template>
  <div class="mx-auto w-full max-w-6xl space-y-8 py-2 sm:py-4">
    <div class="grid grid-cols-1 items-start gap-x-6 gap-y-5 md:grid-cols-[minmax(0,1fr)_minmax(0,2fr)_minmax(9rem,.45fr)]">
      <UFormField
        class="w-full"
        :label="t('patientDetail.endodonticForm.doctor')"
      >
        <USelect
          v-model="form.professionalId"
          class="w-full"
          :items="professionalOptions"
          value-key="value"
          label-key="label"
          :loading="isLoadingProfessionals"
          :placeholder="t('patientDetail.endodonticForm.selectDoctor')"
          icon="i-lucide-user-round"
        />
      </UFormField>
      <UFormField
        class="w-full"
        :label="t('patientDetail.endodonticForm.priorEndodonticTreatment')"
      >
        <UInput
          v-model="form.priorEndodonticTreatment"
          class="w-full"
        />
      </UFormField>
      <UFormField
        class="w-full"
        :label="t('patientDetail.endodonticForm.toothNumber')"
      >
        <UInput
          v-model="form.toothNumber"
          class="w-full"
        />
      </UFormField>
      <UFormField
        class="w-full md:col-span-2"
        :label="t('patientDetail.endodonticForm.painHistory')"
      >
        <UTextarea
          v-model="form.painHistory"
          class="w-full"
          :rows="3"
        />
      </UFormField>
      <UFormField
        class="w-full"
        :label="t('patientDetail.endodonticForm.additionalNote')"
      >
        <UTextarea
          v-model="form.initialNote"
          class="w-full"
          :rows="3"
        />
      </UFormField>
    </div>

    <section class="space-y-5">
      <div class="border-b border-primary/20 pb-3">
        <h2 class="text-ui font-semibold tracking-wide text-primary">
          {{ t('patientDetail.endodonticForm.clinicalExam') }}
        </h2>
      </div>
      <UFormField
        class="w-full"
        :label="t('patientDetail.endodonticForm.anatomicalCrown')"
      >
        <div class="grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2 lg:grid-cols-3">
          <UCheckbox
            v-for="option in anatomicalCrownOptions"
            :key="option.value"
            v-model="form.anatomicalCrown"
            :value="option.value"
            :label="option.label"
          />
        </div>
      </UFormField>
      <div class="grid grid-cols-1 items-start gap-x-6 gap-y-3 lg:grid-cols-2">
        <div
          v-for="question in clinicalStatusQuestions"
          :key="question.key"
          class="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-default/70 py-3"
        >
          <span class="text-sm text-default">{{ question.label }}</span>
          <URadioGroup
            v-model="form.clinicalStatus[question.key]"
            :items="yesNoOptions"
            value-key="value"
            label-key="label"
            orientation="horizontal"
            class="shrink-0"
          />
          <USelect
            v-if="question.associated === 'select'"
            v-model="form.clinicalStatusDetails[question.key]"
            class="min-w-44 flex-1"
            :items="emptySelectOptions"
            :placeholder="t(`patientDetail.endodonticForm.${question.detailLabel}`)"
          />
          <UInput
            v-else-if="question.associated === 'input'"
            v-model="form.clinicalStatusDetails[question.key]"
            class="min-w-44 flex-1"
            :placeholder="t('patientDetail.endodonticForm.probing')"
          />
        </div>
      </div>
      <UFormField
        class="w-full"
        :label="t('patientDetail.endodonticForm.painCharacteristics')"
      >
        <div class="grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-3 lg:grid-cols-5">
          <UCheckbox
            v-for="option in painCharacteristicOptions"
            :key="option.value"
            v-model="form.painCharacteristics"
            :value="option.value"
            :label="option.label"
          />
        </div>
      </UFormField>
      <div class="grid grid-cols-1 items-start gap-x-6 gap-y-5 md:grid-cols-2">
        <UFormField
          class="w-full"
          :label="t('patientDetail.endodonticForm.percussionPain')"
        >
          <div class="flex flex-wrap gap-x-5 gap-y-2">
            <UCheckbox
              v-for="option in percussionOptions"
              :key="option.value"
              v-model="form.percussionPain"
              :value="option.value"
              :label="option.label"
            />
          </div>
        </UFormField>
        <UFormField
          class="w-full"
          :label="t('patientDetail.endodonticForm.palpationPain')"
        >
          <div class="flex flex-wrap gap-x-5 gap-y-2">
            <UCheckbox
              v-for="option in palpationOptions"
              :key="option.value"
              v-model="form.palpationPain"
              :value="option.value"
              :label="option.label"
            />
          </div>
        </UFormField>
      </div>
      <UFormField
        class="w-full"
        :label="t('patientDetail.endodonticForm.additionalClinicalNote')"
      >
        <UTextarea
          v-model="form.clinicalExamNote"
          class="w-full"
          :rows="3"
        />
      </UFormField>
    </section>

    <section class="space-y-5">
      <div class="border-b border-primary/20 pb-3">
        <h2 class="text-ui font-semibold tracking-wide text-primary">
          {{ t('patientDetail.endodonticForm.vitalityTest') }}
        </h2>
      </div>
      <div class="hidden grid-cols-[minmax(9rem,.8fr)_minmax(12rem,1fr)_minmax(0,1fr)_minmax(0,1fr)] gap-x-6 text-sm font-medium text-muted lg:grid">
        <span>{{ t('patientDetail.endodonticForm.test') }}</span><span>{{ t('patientDetail.endodonticForm.result') }}</span><span>{{ t('patientDetail.endodonticForm.duration') }}</span><span>{{ t('patientDetail.endodonticForm.intensity') }}</span>
      </div>
      <div
        v-for="test in ['heat', 'cold'] as const"
        :key="test"
        class="grid grid-cols-1 items-start gap-x-6 gap-y-3 border-b border-default/70 py-3 lg:grid-cols-[minmax(9rem,.8fr)_minmax(12rem,1fr)_minmax(0,1fr)_minmax(0,1fr)]"
      >
        <span class="pt-1 text-sm font-medium text-default">{{ t(`patientDetail.endodonticForm.${test}`) }}</span>
        <URadioGroup
          v-model="form.vitality[test]"
          :items="yesNoOptions"
          value-key="value"
          label-key="label"
          orientation="horizontal"
        />
        <UFormField
          class="w-full lg:hidden"
          :label="t('patientDetail.endodonticForm.duration')"
        /><USelect
          v-model="form.vitality[`${test}Duration`]"
          class="w-full"
          :items="emptySelectOptions"
          :placeholder="t('patientDetail.endodonticForm.selectUnavailable')"
        />
        <UFormField
          class="w-full lg:hidden"
          :label="t('patientDetail.endodonticForm.intensity')"
        /><USelect
          v-model="form.vitality[`${test}Intensity`]"
          class="w-full"
          :items="emptySelectOptions"
          :placeholder="t('patientDetail.endodonticForm.selectUnavailable')"
        />
      </div>
    </section>

    <section class="space-y-5">
      <div class="border-b border-primary/20 pb-3">
        <h2 class="text-ui font-semibold tracking-wide text-primary">
          {{ t('patientDetail.endodonticForm.radiographicExam') }}
        </h2>
      </div>
      <UFormField
        class="w-full"
        :label="t('patientDetail.endodonticForm.pulpChamber')"
      >
        <div class="grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-3 lg:grid-cols-5">
          <UCheckbox
            v-for="option in pulpChamberOptions"
            :key="option.value"
            v-model="form.pulpChamber"
            :value="option.value"
            :label="option.label"
          />
        </div>
      </UFormField>
      <UFormField
        class="w-full"
        :label="t('patientDetail.endodonticForm.canals')"
      >
        <div class="space-y-3">
          <div class="grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-4">
            <UCheckbox
              v-for="option in canalsCountOptions"
              :key="option.value"
              v-model="form.canalsCount"
              :value="option.value"
              :label="option.label"
            />
          </div><div class="grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-3 lg:grid-cols-6">
            <UCheckbox
              v-for="option in canalsCharacteristicsOptions"
              :key="option.value"
              v-model="form.canalsCharacteristics"
              :value="option.value"
              :label="option.label"
            />
          </div>
        </div>
      </UFormField>
      <div class="grid grid-cols-1 items-start gap-x-6 gap-y-3 lg:grid-cols-2">
        <div
          v-for="question in radiographicQuestions"
          :key="question.key"
          class="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-default/70 py-3"
        >
          <span class="text-sm text-default">{{ question.label }}</span>
          <URadioGroup
            v-model="form.radiographicFindings[question.key]"
            :items="yesNoOptions"
            value-key="value"
            label-key="label"
            orientation="horizontal"
            class="shrink-0"
          />
          <USelect
            v-if="question.associated"
            v-model="form.radiographicDetails[question.key]"
            class="min-w-44 flex-1"
            :items="emptySelectOptions"
            :placeholder="t('patientDetail.endodonticForm.selectUnavailable')"
          />
        </div>
      </div>
      <UFormField
        class="w-full"
        :label="t('patientDetail.endodonticForm.additionalRadiographicNote')"
      >
        <UTextarea
          v-model="form.radiographicNote"
          class="w-full"
          :rows="3"
        />
      </UFormField>
    </section>

    <section class="space-y-5">
      <div class="border-b border-primary/20 pb-3">
        <h2 class="text-ui font-semibold tracking-wide text-primary">
          {{ t('patientDetail.endodonticForm.presumptivePulpalDiagnosis') }}
        </h2>
      </div>
      <div class="grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2 lg:grid-cols-3">
        <UCheckbox
          v-for="option in presumptivePulpalOptions"
          :key="option.value"
          v-model="form.presumptivePulpalDiagnosis"
          :value="option.value"
          :label="option.label"
        />
      </div>
      <UFormField
        class="w-full"
        :label="t('patientDetail.endodonticForm.additionalNote')"
      >
        <UTextarea
          v-model="form.presumptivePulpalNote"
          class="w-full"
          :rows="3"
        />
      </UFormField>
    </section>

    <section class="space-y-5">
      <div class="border-b border-primary/20 pb-3">
        <h2 class="text-ui font-semibold tracking-wide text-primary">
          {{ t('patientDetail.endodonticForm.periapicalDiagnosis') }}
        </h2>
      </div>
      <div class="grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2 lg:grid-cols-3">
        <UCheckbox
          v-for="option in periapicalOptions"
          :key="option.value"
          v-model="form.periapicalDiagnosis"
          :value="option.value"
          :label="option.label"
        />
      </div>
      <UFormField
        class="w-full"
        :label="t('patientDetail.endodonticForm.additionalNote')"
      >
        <UTextarea
          v-model="form.periapicalNote"
          class="w-full"
          :rows="3"
        />
      </UFormField>
    </section>

    <section class="space-y-5">
      <div class="border-b border-primary/20 pb-3">
        <h2 class="text-ui font-semibold tracking-wide text-primary">
          {{ t('patientDetail.endodonticForm.definitiveDiagnosis') }}
        </h2>
      </div>
      <div class="flex flex-wrap gap-x-6 gap-y-2">
        <UCheckbox
          v-for="option in definitiveDiagnosisOptions"
          :key="option.value"
          v-model="form.definitiveDiagnosis"
          :value="option.value"
          :label="option.label"
        />
      </div>
      <UFormField
        class="w-full"
        :label="t('patientDetail.endodonticForm.additionalNote')"
      >
        <UTextarea
          v-model="form.definitiveNote"
          class="w-full"
          :rows="3"
        />
      </UFormField>
    </section>

    <section class="space-y-5">
      <div class="border-b border-primary/20 pb-3">
        <h2 class="text-ui font-semibold tracking-wide text-primary">
          {{ t('patientDetail.endodonticForm.indicatedTreatment') }}
        </h2>
      </div>
      <div class="grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-3 lg:grid-cols-4">
        <UCheckbox
          v-for="option in indicatedTreatmentOptions"
          :key="option.value"
          v-model="form.indicatedTreatment"
          :value="option.value"
          :label="option.label"
        />
      </div>
      <UFormField
        class="w-full"
        :label="t('patientDetail.endodonticForm.additionalNote')"
      >
        <UTextarea
          v-model="form.indicatedTreatmentNote"
          class="w-full"
          :rows="3"
        />
      </UFormField>
    </section>

    <section class="space-y-5">
      <div class="border-b border-primary/20 pb-3">
        <h2 class="text-ui font-semibold tracking-wide text-primary">
          {{ t('patientDetail.endodonticForm.clinicalData') }}
        </h2>
      </div>
      <div class="overflow-x-auto rounded-token-lg border border-default">
        <table class="min-w-[1100px] w-full text-sm">
          <thead class="bg-surface-muted/50 text-left text-muted">
            <tr>
              <th class="px-3 py-2">
                {{ t('patientDetail.endodonticForm.identification') }}
              </th><th class="px-3 py-2">
                {{ t('patientDetail.endodonticForm.canal') }}
              </th><th class="px-3 py-2">
                {{ t('patientDetail.endodonticForm.workingLength') }}
              </th><th class="px-3 py-2">
                {{ t('patientDetail.endodonticForm.referencePoint') }}
              </th><th class="px-3 py-2">
                {{ t('patientDetail.endodonticForm.initialFile') }}
              </th><th class="px-3 py-2">
                {{ t('patientDetail.endodonticForm.finalApicalFile') }}
              </th><th class="px-3 py-2">
                {{ t('patientDetail.endodonticForm.cementType') }}
              </th><th class="px-3 py-2">
                {{ t('patientDetail.endodonticForm.masterGuttaPerchaCone') }}
              </th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="row in clinicalRows"
              :key="row.id"
              class="border-t border-default/70"
            >
              <th class="whitespace-nowrap px-3 py-2 text-left font-medium text-default">
                {{ t(`patientDetail.endodonticForm.${row.id}`) }}
              </th><td class="p-2">
                <UInput
                  v-model="row.canal"
                  class="w-full"
                />
              </td><td class="p-2">
                <UInput
                  v-model="row.workingLength"
                  class="w-full"
                />
              </td><td class="p-2">
                <UInput
                  v-model="row.referencePoint"
                  class="w-full"
                />
              </td><td class="p-2">
                <UInput
                  v-model="row.initialFile"
                  class="w-full"
                />
              </td><td class="p-2">
                <UInput
                  v-model="row.finalApicalFile"
                  class="w-full"
                />
              </td><td class="p-2">
                <UInput
                  v-model="row.cementType"
                  class="w-full"
                />
              </td><td class="p-2">
                <UInput
                  v-model="row.masterGuttaPerchaCone"
                  class="w-full"
                />
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <UFormField
        class="w-full"
        :label="t('patientDetail.endodonticForm.additionalNote')"
      >
        <UTextarea
          v-model="form.clinicalDataNote"
          class="w-full"
          :rows="3"
        />
      </UFormField>
    </section>

    <section class="space-y-5">
      <div class="border-b border-primary/20 pb-3">
        <h2 class="text-ui font-semibold tracking-wide text-primary">
          {{ t('patientDetail.endodonticForm.finalSection') }}
        </h2>
      </div>
      <UFormField
        class="w-full"
        :label="t('patientDetail.endodonticForm.operativeAccidents')"
      >
        <UTextarea
          v-model="form.operativeAccidents"
          class="w-full"
          :rows="3"
        />
      </UFormField>
      <UFormField
        class="w-full"
        :label="t('patientDetail.endodonticForm.postEndodonticRestoration')"
      >
        <div class="flex flex-wrap gap-x-6 gap-y-2">
          <UCheckbox
            v-for="option in restorationOptions"
            :key="option.value"
            v-model="form.postEndodonticRestoration"
            :value="option.value"
            :label="option.label"
          />
        </div>
      </UFormField>
      <UFormField
        class="w-full"
        :label="t('patientDetail.endodonticForm.prognosis')"
      >
        <URadioGroup
          v-model="form.prognosis"
          :items="prognosisOptions"
          value-key="value"
          label-key="label"
          orientation="horizontal"
        />
      </UFormField>
      <UFormField
        class="w-full"
        :label="t('patientDetail.endodonticForm.additionalNote')"
      >
        <UTextarea
          v-model="form.finalNote"
          class="w-full"
          :rows="3"
        />
      </UFormField>
    </section>

    <div class="flex flex-col items-start gap-3 border-t border-default/70 pt-6 sm:flex-row sm:items-center sm:justify-end">
      <p class="text-caption text-muted sm:order-first sm:mr-auto">
        {{ isLoading ? t('common.loading') : t('patientDetail.endodonticForm.saveUnavailable') }}
      </p>
      <UButton
        color="primary"
        icon="i-lucide-save"
        :loading="isSaving"
        :disabled="!props.patientId || isLoading || isSaving"
        @click="save"
      >
        {{ t('patientDetail.endodonticForm.save') }}
      </UButton>
    </div>
  </div>
</template>
