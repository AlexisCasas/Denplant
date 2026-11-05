<script setup lang="ts">
type YesNo = '' | 'no' | 'yes'
type PediatricApiResponse = {
  professional_id?: string | null
  consultation_reason?: string | null
  mother_name?: string | null
  father_name?: string | null
  siblings_count?: number | null
  birth_order?: number | null
  disease_type?: string | null
  chronological_narrative?: string | null
  maternal_diseases?: string | null
  pregnancy_complications?: boolean | null
  premature_baby?: boolean | null
  birth_weight_kg?: number | null
  prenatal_comment?: string | null
  birth_problems?: boolean | null
  birth_problems_detail?: string | null
  pacifier_use?: boolean | null
  pacifier_use_detail?: string | null
  bottle_use?: boolean | null
  bottle_use_detail?: string | null
  thumb_sucking?: boolean | null
  thumb_sucking_detail?: string | null
  medication_or_therapy?: boolean | null
  medication_or_therapy_detail?: string | null
  allergies_or_intolerances?: boolean | null
  allergies_or_intolerances_detail?: string | null
  brushes_before_sleep?: boolean | null
  brushes_before_sleep_detail?: string | null
  open_mouth_or_snores?: boolean | null
  open_mouth_or_snores_detail?: string | null
  postnatal_additional_comment?: string | null
  sweets_times_per_day?: number | null
  sweets_days_per_week?: number | null
  milk_type?: string | null
  dental_hygiene?: string | null
  daily_diet?: string | null
  parenting_style?: string | null
  oral_habits?: string | null
  brushing_technique?: string | null
  clinical_exam?: string | null
  observations?: string | null
}

const { t } = useI18n()
const toast = useToast()
const props = defineProps<{ patientId?: string }>()
const patientIdRef = toRef(props, 'patientId')
const { professionals, isLoading: isLoadingProfessionals, fetchProfessionals } = useProfessionals()
const { isLoading, isSaving, loadPediatric, savePediatric } = usePatientAnamneses(patientIdRef)

const yesNoOptions = computed(() => [
  { value: 'no', label: t('patientDetail.pediatricDentalAnamnesis.no') },
  { value: 'yes', label: t('patientDetail.pediatricDentalAnamnesis.yes') }
])

const professionalOptions = computed(() => professionals.value.map(professional => ({
  value: professional.id,
  label: `${professional.first_name} ${professional.last_name}`
})))

function emptyForm() {
  return {
    professionalId: '',
    consultationReason: '',
    motherName: '',
    fatherName: '',
    siblingsCount: '',
    birthOrder: '',
    currentIllness: {
      diseaseType: '',
      chronology: ''
    },
    prenatal: {
      maternalDiseases: '',
      pregnancyComplications: '' as YesNo,
      prematureBaby: '' as YesNo,
      birthWeight: '',
      comment: ''
    },
    postnatal: {
      birthProblems: '' as YesNo,
      birthProblemsDetail: '',
      pacifierUse: '' as YesNo,
      pacifierUseDetail: '',
      bottleUse: '' as YesNo,
      bottleUseDetail: '',
      thumbSucking: '' as YesNo,
      thumbSuckingDetail: '',
      medicationOrTherapy: '' as YesNo,
      medicationOrTherapyDetail: '',
      allergiesOrIntolerances: '' as YesNo,
      allergiesOrIntolerancesDetail: '',
      brushesBeforeSleep: '' as YesNo,
      brushesBeforeSleepDetail: '',
      openMouthOrSnores: '' as YesNo,
      openMouthOrSnoresDetail: '',
      additionalComment: ''
    },
    habits: {
      sweetsTimesPerDay: '',
      sweetsDaysPerWeek: '',
      milkType: '',
      dentalHygiene: '',
      dailyDiet: '',
      parentingStyle: ''
    },
    final: {
      oralHabits: '',
      brushingTechnique: '',
      clinicalExam: '',
      observations: ''
    }
  }
}

const form = reactive(emptyForm())

const postnatalQuestions = computed(() => [
  { key: 'birthProblems', detailKey: 'birthProblemsDetail', label: t('patientDetail.pediatricDentalAnamnesis.birthProblems') },
  { key: 'pacifierUse', detailKey: 'pacifierUseDetail', label: t('patientDetail.pediatricDentalAnamnesis.pacifierUse') },
  { key: 'bottleUse', detailKey: 'bottleUseDetail', label: t('patientDetail.pediatricDentalAnamnesis.bottleUse') },
  { key: 'thumbSucking', detailKey: 'thumbSuckingDetail', label: t('patientDetail.pediatricDentalAnamnesis.thumbSucking') },
  { key: 'medicationOrTherapy', detailKey: 'medicationOrTherapyDetail', label: t('patientDetail.pediatricDentalAnamnesis.medicationOrTherapy') },
  { key: 'allergiesOrIntolerances', detailKey: 'allergiesOrIntolerancesDetail', label: t('patientDetail.pediatricDentalAnamnesis.allergiesOrIntolerances') },
  { key: 'brushesBeforeSleep', detailKey: 'brushesBeforeSleepDetail', label: t('patientDetail.pediatricDentalAnamnesis.brushesBeforeSleep') },
  { key: 'openMouthOrSnores', detailKey: 'openMouthOrSnoresDetail', label: t('patientDetail.pediatricDentalAnamnesis.openMouthOrSnores') }
] as const)

const postnatalQuestionColumns = computed(() => [
  postnatalQuestions.value.slice(0, 4),
  postnatalQuestions.value.slice(4)
])

function toYesNo(value: unknown): YesNo {
  return value === true ? 'yes' : value === false ? 'no' : ''
}

function toNullable(value: string): string | null {
  return value.trim() || null
}

function toNumberOrNull(value: string): number | null {
  const number = Number(value)
  return value.trim() && Number.isFinite(number) ? number : null
}

function yesNoToBoolean(value: YesNo): boolean | null {
  return value === 'yes' ? true : value === 'no' ? false : null
}

function applyPediatric(data: PediatricApiResponse | null) {
  Object.assign(form, emptyForm())
  if (!data) return
  form.professionalId = data.professional_id ?? ''
  form.consultationReason = data.consultation_reason ?? ''
  form.motherName = data.mother_name ?? ''
  form.fatherName = data.father_name ?? ''
  form.siblingsCount = data.siblings_count?.toString() ?? ''
  form.birthOrder = data.birth_order?.toString() ?? ''
  Object.assign(form.currentIllness, { diseaseType: data.disease_type ?? '', chronology: data.chronological_narrative ?? '' })
  Object.assign(form.prenatal, { maternalDiseases: data.maternal_diseases ?? '', pregnancyComplications: toYesNo(data.pregnancy_complications), prematureBaby: toYesNo(data.premature_baby), birthWeight: data.birth_weight_kg?.toString() ?? '', comment: data.prenatal_comment ?? '' })
  Object.assign(form.postnatal, {
    birthProblems: toYesNo(data.birth_problems), birthProblemsDetail: data.birth_problems_detail ?? '', pacifierUse: toYesNo(data.pacifier_use), pacifierUseDetail: data.pacifier_use_detail ?? '', bottleUse: toYesNo(data.bottle_use), bottleUseDetail: data.bottle_use_detail ?? '', thumbSucking: toYesNo(data.thumb_sucking), thumbSuckingDetail: data.thumb_sucking_detail ?? '', medicationOrTherapy: toYesNo(data.medication_or_therapy), medicationOrTherapyDetail: data.medication_or_therapy_detail ?? '', allergiesOrIntolerances: toYesNo(data.allergies_or_intolerances), allergiesOrIntolerancesDetail: data.allergies_or_intolerances_detail ?? '', brushesBeforeSleep: toYesNo(data.brushes_before_sleep), brushesBeforeSleepDetail: data.brushes_before_sleep_detail ?? '', openMouthOrSnores: toYesNo(data.open_mouth_or_snores), openMouthOrSnoresDetail: data.open_mouth_or_snores_detail ?? '', additionalComment: data.postnatal_additional_comment ?? ''
  })
  Object.assign(form.habits, { sweetsTimesPerDay: data.sweets_times_per_day?.toString() ?? '', sweetsDaysPerWeek: data.sweets_days_per_week?.toString() ?? '', milkType: data.milk_type ?? '', dentalHygiene: data.dental_hygiene ?? '', dailyDiet: data.daily_diet ?? '', parentingStyle: data.parenting_style ?? '' })
  Object.assign(form.final, { oralHabits: data.oral_habits ?? '', brushingTechnique: data.brushing_technique ?? '', clinicalExam: data.clinical_exam ?? '', observations: data.observations ?? '' })
}

function pediatricPayload(): Record<string, unknown> {
  return {
    professional_id: toNullable(form.professionalId), consultation_reason: toNullable(form.consultationReason), mother_name: toNullable(form.motherName), father_name: toNullable(form.fatherName), siblings_count: toNumberOrNull(form.siblingsCount), birth_order: toNumberOrNull(form.birthOrder), disease_type: toNullable(form.currentIllness.diseaseType), chronological_narrative: toNullable(form.currentIllness.chronology), maternal_diseases: toNullable(form.prenatal.maternalDiseases), pregnancy_complications: yesNoToBoolean(form.prenatal.pregnancyComplications), premature_baby: yesNoToBoolean(form.prenatal.prematureBaby), birth_weight_kg: toNumberOrNull(form.prenatal.birthWeight), prenatal_comment: toNullable(form.prenatal.comment), birth_problems: yesNoToBoolean(form.postnatal.birthProblems), birth_problems_detail: toNullable(form.postnatal.birthProblemsDetail), pacifier_use: yesNoToBoolean(form.postnatal.pacifierUse), pacifier_use_detail: toNullable(form.postnatal.pacifierUseDetail), bottle_use: yesNoToBoolean(form.postnatal.bottleUse), bottle_use_detail: toNullable(form.postnatal.bottleUseDetail), thumb_sucking: yesNoToBoolean(form.postnatal.thumbSucking), thumb_sucking_detail: toNullable(form.postnatal.thumbSuckingDetail), medication_or_therapy: yesNoToBoolean(form.postnatal.medicationOrTherapy), medication_or_therapy_detail: toNullable(form.postnatal.medicationOrTherapyDetail), allergies_or_intolerances: yesNoToBoolean(form.postnatal.allergiesOrIntolerances), allergies_or_intolerances_detail: toNullable(form.postnatal.allergiesOrIntolerancesDetail), brushes_before_sleep: yesNoToBoolean(form.postnatal.brushesBeforeSleep), brushes_before_sleep_detail: toNullable(form.postnatal.brushesBeforeSleepDetail), open_mouth_or_snores: yesNoToBoolean(form.postnatal.openMouthOrSnores), open_mouth_or_snores_detail: toNullable(form.postnatal.openMouthOrSnoresDetail), postnatal_additional_comment: toNullable(form.postnatal.additionalComment), sweets_times_per_day: toNumberOrNull(form.habits.sweetsTimesPerDay), sweets_days_per_week: toNumberOrNull(form.habits.sweetsDaysPerWeek), milk_type: toNullable(form.habits.milkType), dental_hygiene: toNullable(form.habits.dentalHygiene), daily_diet: toNullable(form.habits.dailyDiet), parenting_style: toNullable(form.habits.parentingStyle), oral_habits: toNullable(form.final.oralHabits), brushing_technique: toNullable(form.final.brushingTechnique), clinical_exam: toNullable(form.final.clinicalExam), observations: toNullable(form.final.observations)
  }
}

async function load() {
  const data = await loadPediatric<PediatricApiResponse | null>()
  if (data !== undefined) applyPediatric(data)
}

async function save() {
  const data = await savePediatric<PediatricApiResponse>(pediatricPayload())
  if (!data) return
  applyPediatric(data)
  toast.add({ title: t('common.success'), description: t('patientDetail.anamneses.pediatricSaved'), color: 'success' })
}

watch(patientIdRef, () => {
  load()
}, { immediate: true })
onMounted(fetchProfessionals)
</script>

<template>
  <div class="mx-auto w-full max-w-6xl space-y-8 py-2 sm:py-4">
    <div class="w-full max-w-xl">
      <UFormField class="w-full" :label="t('patientDetail.pediatricDentalAnamnesis.doctor')">
        <USelect
          v-model="form.professionalId"
          class="w-full"
          :items="professionalOptions"
          value-key="value"
          label-key="label"
          :loading="isLoadingProfessionals"
          :placeholder="t('patientDetail.pediatricDentalAnamnesis.selectDoctor')"
          icon="i-lucide-user-round"
        />
      </UFormField>
    </div>

    <div class="grid grid-cols-1 items-start gap-x-6 gap-y-5 sm:grid-cols-2 xl:grid-cols-4">
      <UFormField class="w-full sm:col-span-2 xl:col-span-4" :label="t('patientDetail.pediatricDentalAnamnesis.consultationReason')">
        <UInput v-model="form.consultationReason" class="w-full" />
      </UFormField>
      <UFormField class="w-full" :label="t('patientDetail.pediatricDentalAnamnesis.motherName')"><UInput v-model="form.motherName" class="w-full" /></UFormField>
      <UFormField class="w-full" :label="t('patientDetail.pediatricDentalAnamnesis.fatherName')"><UInput v-model="form.fatherName" class="w-full" /></UFormField>
      <UFormField class="w-full" :label="t('patientDetail.pediatricDentalAnamnesis.siblingsCount')"><UInput v-model="form.siblingsCount" class="w-full" /></UFormField>
      <UFormField class="w-full" :label="t('patientDetail.pediatricDentalAnamnesis.birthOrder')"><UInput v-model="form.birthOrder" class="w-full" /></UFormField>
    </div>

    <section class="space-y-5">
      <div class="border-b border-primary/20 pb-3"><h2 class="text-ui font-semibold tracking-wide text-primary">{{ t('patientDetail.pediatricDentalAnamnesis.currentIllness') }}</h2></div>
      <div class="grid grid-cols-1 items-start gap-x-6 gap-y-5 md:grid-cols-2">
        <UFormField class="w-full" :label="t('patientDetail.pediatricDentalAnamnesis.diseaseType')"><UTextarea v-model="form.currentIllness.diseaseType" class="w-full" :rows="3" /></UFormField>
        <UFormField class="w-full" :label="t('patientDetail.pediatricDentalAnamnesis.chronologicalNarrative')"><UTextarea v-model="form.currentIllness.chronology" class="w-full" :rows="3" /></UFormField>
      </div>
    </section>

    <section class="space-y-5">
      <div class="border-b border-primary/20 pb-3"><h2 class="text-ui font-semibold tracking-wide text-primary">{{ t('patientDetail.pediatricDentalAnamnesis.prenatalHistory') }}</h2></div>
      <div class="grid grid-cols-1 items-start gap-x-6 gap-y-5 md:grid-cols-2">
        <UFormField class="w-full" :label="t('patientDetail.pediatricDentalAnamnesis.maternalDiseases')"><UInput v-model="form.prenatal.maternalDiseases" class="w-full" /></UFormField>
        <UFormField class="w-full" :label="t('patientDetail.pediatricDentalAnamnesis.pregnancyComplications')"><URadioGroup v-model="form.prenatal.pregnancyComplications" :items="yesNoOptions" value-key="value" label-key="label" orientation="horizontal" /></UFormField>
        <UFormField class="w-full" :label="t('patientDetail.pediatricDentalAnamnesis.prematureBaby')"><URadioGroup v-model="form.prenatal.prematureBaby" :items="yesNoOptions" value-key="value" label-key="label" orientation="horizontal" /></UFormField>
        <UFormField class="w-full" :label="t('patientDetail.pediatricDentalAnamnesis.birthWeight')"><UInput v-model="form.prenatal.birthWeight" class="w-full"><template #trailing><span class="text-muted text-xs">kg</span></template></UInput></UFormField>
        <UFormField class="w-full md:col-span-2" :label="t('patientDetail.pediatricDentalAnamnesis.comment')"><UTextarea v-model="form.prenatal.comment" class="w-full" :rows="3" /></UFormField>
      </div>
    </section>

    <section class="space-y-5">
      <div class="border-b border-primary/20 pb-3"><h2 class="text-ui font-semibold tracking-wide text-primary">{{ t('patientDetail.pediatricDentalAnamnesis.postnatalHistory') }}</h2></div>
      <div class="grid grid-cols-1 items-start gap-x-6 md:grid-cols-2">
        <div v-for="(column, columnIndex) in postnatalQuestionColumns" :key="columnIndex" class="space-y-0">
          <UFormField v-for="question in column" :key="question.key" class="w-full">
            <div class="space-y-3 border-b border-default/70 py-3">
              <div class="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span class="text-sm text-default">{{ question.label }}</span>
                <URadioGroup v-model="form.postnatal[question.key]" :items="yesNoOptions" value-key="value" label-key="label" orientation="horizontal" class="shrink-0" />
              </div>
              <UInput v-if="form.postnatal[question.key] === 'yes'" v-model="form.postnatal[question.detailKey]" class="w-full" :placeholder="t('patientDetail.pediatricDentalAnamnesis.detail')" />
            </div>
          </UFormField>
        </div>
      </div>
      <UFormField class="w-full" :label="t('patientDetail.pediatricDentalAnamnesis.additionalComment')"><UTextarea v-model="form.postnatal.additionalComment" class="w-full" :rows="3" /></UFormField>
    </section>

    <section class="space-y-5">
      <div class="border-b border-primary/20 pb-3"><h2 class="text-ui font-semibold tracking-wide text-primary">{{ t('patientDetail.pediatricDentalAnamnesis.feedingAndHygiene') }}</h2></div>
      <UFormField class="w-full" :label="t('patientDetail.pediatricDentalAnamnesis.sweetsConsumption')">
        <div class="grid w-full max-w-2xl grid-cols-1 gap-3 sm:grid-cols-2">
          <div class="flex items-center gap-2"><UInput v-model="form.habits.sweetsTimesPerDay" class="w-full" /><span class="shrink-0 text-sm text-muted">{{ t('patientDetail.pediatricDentalAnamnesis.timesPerDay') }}</span></div>
          <div class="flex items-center gap-2"><UInput v-model="form.habits.sweetsDaysPerWeek" class="w-full" /><span class="shrink-0 text-sm text-muted">{{ t('patientDetail.pediatricDentalAnamnesis.daysPerWeek') }}</span></div>
        </div>
      </UFormField>
      <div class="grid grid-cols-1 items-start gap-x-6 gap-y-5 md:grid-cols-2">
        <UFormField class="w-full" :label="t('patientDetail.pediatricDentalAnamnesis.milkType')"><UInput v-model="form.habits.milkType" class="w-full" /></UFormField>
        <UFormField class="w-full" :label="t('patientDetail.pediatricDentalAnamnesis.dentalHygiene')"><UInput v-model="form.habits.dentalHygiene" class="w-full" /></UFormField>
      </div>
      <UFormField class="w-full" :label="t('patientDetail.pediatricDentalAnamnesis.dailyDiet')"><UTextarea v-model="form.habits.dailyDiet" class="w-full" :rows="4" /></UFormField>
      <UFormField class="w-full" :label="t('patientDetail.pediatricDentalAnamnesis.parentingStyle')"><UInput v-model="form.habits.parentingStyle" class="w-full" /></UFormField>
    </section>

    <section class="space-y-5">
      <div class="border-b border-primary/20 pb-3"><h2 class="text-ui font-semibold tracking-wide text-primary">{{ t('patientDetail.pediatricDentalAnamnesis.finalSection') }}</h2></div>
      <div class="grid grid-cols-1 items-start gap-x-6 gap-y-5 md:grid-cols-2">
        <UFormField class="w-full" :label="t('patientDetail.pediatricDentalAnamnesis.oralHabits')"><UTextarea v-model="form.final.oralHabits" class="w-full" :rows="3" /></UFormField>
        <UFormField class="w-full" :label="t('patientDetail.pediatricDentalAnamnesis.brushingTechnique')"><UTextarea v-model="form.final.brushingTechnique" class="w-full" :rows="3" /></UFormField>
        <UFormField class="w-full" :label="t('patientDetail.pediatricDentalAnamnesis.clinicalExam')"><UTextarea v-model="form.final.clinicalExam" class="w-full" :rows="3" /></UFormField>
        <UFormField class="w-full" :label="t('patientDetail.pediatricDentalAnamnesis.observations')"><UTextarea v-model="form.final.observations" class="w-full" :rows="3" /></UFormField>
      </div>
    </section>

    <div class="flex flex-col items-start gap-3 border-t border-default/70 pt-6 sm:flex-row sm:items-center sm:justify-end">
      <p class="text-caption text-muted sm:order-first sm:mr-auto">{{ isLoading ? t('common.loading') : t('patientDetail.pediatricDentalAnamnesis.saveUnavailable') }}</p>
      <UButton color="primary" icon="i-lucide-save" :loading="isSaving" :disabled="!props.patientId || isLoading || isSaving" @click="save">{{ t('patientDetail.pediatricDentalAnamnesis.save') }}</UButton>
    </div>
  </div>
</template>
