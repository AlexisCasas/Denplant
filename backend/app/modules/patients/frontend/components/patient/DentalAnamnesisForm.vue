<script setup lang="ts">
type YesNo = '' | 'no' | 'yes'
type DentalApiResponse = {
  professional_id?: string | null
  consultation_reason?: string | null
  illness_duration?: string | null
  main_symptoms?: string | null
  chronological_narrative?: string | null
  biological_functions?: string | null
  family_history?: string | null
  personal_history?: string | null
  high_blood_pressure?: boolean | null
  low_blood_pressure?: boolean | null
  hepatitis?: boolean | null
  gastritis?: boolean | null
  ulcers?: boolean | null
  hiv?: boolean | null
  diabetes?: boolean | null
  asthma?: boolean | null
  smoker?: boolean | null
  additional_comment?: string | null
  blood_diseases?: boolean | null
  blood_diseases_detail?: string | null
  heart_problems?: boolean | null
  heart_problems_detail?: string | null
  other_disease?: boolean | null
  other_disease_detail?: string | null
  brushing_frequency?: string | null
  bleeding_gums?: boolean | null
  abnormal_extraction_bleeding?: boolean | null
  abnormal_extraction_bleeding_detail?: string | null
  bruxism?: boolean | null
  mouth_discomfort?: string | null
  allergies?: boolean | null
  allergies_detail?: string | null
  recent_major_surgery?: boolean | null
  recent_major_surgery_detail?: string | null
  permanent_medication?: boolean | null
  permanent_medication_detail?: string | null
  blood_pressure?: string | null
  pulse?: number | null
  heart_rate?: number | null
  respiratory_rate?: number | null
  temperature_c?: number | null
  extraoral_exam?: string | null
  intraoral_exam?: string | null
  auxiliary_exam_results?: string | null
  observations?: string | null
}

const { t } = useI18n()
const toast = useToast()
const props = defineProps<{ patientId?: string }>()
const patientIdRef = toRef(props, 'patientId')
const { professionals, isLoading: isLoadingProfessionals, fetchProfessionals } = useProfessionals()
const { isLoading, isSaving, loadDental, saveDental } = usePatientAnamneses(patientIdRef)

const yesNoOptions = computed(() => [
  { value: 'no', label: t('patientDetail.dentalAnamnesis.no') },
  { value: 'yes', label: t('patientDetail.dentalAnamnesis.yes') }
])

const professionalOptions = computed(() => professionals.value.map(professional => ({
  value: professional.id,
  label: `${professional.first_name} ${professional.last_name}`
})))

function emptyForm() {
  return {
    professionalId: '',
    consultationReason: '',
    currentIllness: {
      duration: '',
      symptoms: '',
      chronology: '',
      biologicalFunctions: ''
    },
    history: {
      family: '',
      personal: '',
      highBloodPressure: '' as YesNo,
      lowBloodPressure: '' as YesNo,
      hepatitis: '' as YesNo,
      gastritis: '' as YesNo,
      ulcers: '' as YesNo,
      hiv: '' as YesNo,
      diabetes: '' as YesNo,
      asthma: '' as YesNo,
      smoker: '' as YesNo,
      additionalComment: ''
    },
    dentalHistory: {
      bloodDiseases: '' as YesNo,
      bloodDiseasesDetail: '',
      heartProblems: '' as YesNo,
      heartProblemsDetail: '',
      otherDisease: '' as YesNo,
      otherDiseaseDetail: '',
      brushingFrequency: '',
      bleedingGums: '' as YesNo,
      abnormalExtractionBleeding: '' as YesNo,
      abnormalExtractionBleedingDetail: '',
      bruxism: '' as YesNo,
      mouthDiscomfort: '',
      allergies: '' as YesNo,
      allergiesDetail: '',
      recentMajorSurgery: '' as YesNo,
      recentMajorSurgeryDetail: '',
      permanentMedication: '' as YesNo,
      permanentMedicationDetail: ''
    },
    clinicalExam: {
      bloodPressure: '',
      pulse: '',
      heartRate: '',
      respiratoryRate: '',
      temperature: '',
      extraoralExam: '',
      intraoralExam: '',
      auxiliaryExamResults: '',
      observations: ''
    }
  }
}

const form = reactive(emptyForm())

const binaryHistoryQuestions = computed(() => [
  { key: 'highBloodPressure', label: t('patientDetail.dentalAnamnesis.highBloodPressure') },
  { key: 'lowBloodPressure', label: t('patientDetail.dentalAnamnesis.lowBloodPressure') },
  { key: 'hepatitis', label: t('patientDetail.dentalAnamnesis.hepatitis') },
  { key: 'gastritis', label: t('patientDetail.dentalAnamnesis.gastritis') },
  { key: 'ulcers', label: t('patientDetail.dentalAnamnesis.ulcers') },
  { key: 'hiv', label: t('patientDetail.dentalAnamnesis.hiv') },
  { key: 'diabetes', label: t('patientDetail.dentalAnamnesis.diabetes') },
  { key: 'asthma', label: t('patientDetail.dentalAnamnesis.asthma') },
  { key: 'smoker', label: t('patientDetail.dentalAnamnesis.smoker') }
] as const)

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

function textValue(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function numberTextValue(value: unknown): string {
  return typeof value === 'number' || typeof value === 'string' ? String(value) : ''
}

function applyDental(data: DentalApiResponse | null) {
  Object.assign(form, emptyForm())
  if (!data) return
  form.professionalId = textValue(data.professional_id)
  form.consultationReason = textValue(data.consultation_reason)
  Object.assign(form.currentIllness, { duration: data.illness_duration ?? '', symptoms: data.main_symptoms ?? '', chronology: data.chronological_narrative ?? '', biologicalFunctions: data.biological_functions ?? '' })
  Object.assign(form.history, {
    family: data.family_history ?? '', personal: data.personal_history ?? '', highBloodPressure: toYesNo(data.high_blood_pressure), lowBloodPressure: toYesNo(data.low_blood_pressure), hepatitis: toYesNo(data.hepatitis), gastritis: toYesNo(data.gastritis), ulcers: toYesNo(data.ulcers), hiv: toYesNo(data.hiv), diabetes: toYesNo(data.diabetes), asthma: toYesNo(data.asthma), smoker: toYesNo(data.smoker), additionalComment: data.additional_comment ?? ''
  })
  Object.assign(form.dentalHistory, {
    bloodDiseases: toYesNo(data.blood_diseases), bloodDiseasesDetail: data.blood_diseases_detail ?? '', heartProblems: toYesNo(data.heart_problems), heartProblemsDetail: data.heart_problems_detail ?? '', otherDisease: toYesNo(data.other_disease), otherDiseaseDetail: data.other_disease_detail ?? '', brushingFrequency: data.brushing_frequency ?? '', bleedingGums: toYesNo(data.bleeding_gums), abnormalExtractionBleeding: toYesNo(data.abnormal_extraction_bleeding), abnormalExtractionBleedingDetail: data.abnormal_extraction_bleeding_detail ?? '', bruxism: toYesNo(data.bruxism), mouthDiscomfort: data.mouth_discomfort ?? '', allergies: toYesNo(data.allergies), allergiesDetail: data.allergies_detail ?? '', recentMajorSurgery: toYesNo(data.recent_major_surgery), recentMajorSurgeryDetail: data.recent_major_surgery_detail ?? '', permanentMedication: toYesNo(data.permanent_medication), permanentMedicationDetail: data.permanent_medication_detail ?? ''
  })
  Object.assign(form.clinicalExam, {
    bloodPressure: textValue(data.blood_pressure), pulse: numberTextValue(data.pulse), heartRate: numberTextValue(data.heart_rate), respiratoryRate: numberTextValue(data.respiratory_rate), temperature: numberTextValue(data.temperature_c), extraoralExam: textValue(data.extraoral_exam), intraoralExam: textValue(data.intraoral_exam), auxiliaryExamResults: textValue(data.auxiliary_exam_results), observations: textValue(data.observations)
  })
}

function dentalPayload(): Record<string, unknown> {
  return {
    professional_id: toNullable(form.professionalId), consultation_reason: toNullable(form.consultationReason), illness_duration: toNullable(form.currentIllness.duration), main_symptoms: toNullable(form.currentIllness.symptoms), chronological_narrative: toNullable(form.currentIllness.chronology), biological_functions: toNullable(form.currentIllness.biologicalFunctions), family_history: toNullable(form.history.family), personal_history: toNullable(form.history.personal), high_blood_pressure: yesNoToBoolean(form.history.highBloodPressure), low_blood_pressure: yesNoToBoolean(form.history.lowBloodPressure), hepatitis: yesNoToBoolean(form.history.hepatitis), gastritis: yesNoToBoolean(form.history.gastritis), ulcers: yesNoToBoolean(form.history.ulcers), hiv: yesNoToBoolean(form.history.hiv), diabetes: yesNoToBoolean(form.history.diabetes), asthma: yesNoToBoolean(form.history.asthma), smoker: yesNoToBoolean(form.history.smoker), additional_comment: toNullable(form.history.additionalComment), blood_diseases: yesNoToBoolean(form.dentalHistory.bloodDiseases), blood_diseases_detail: toNullable(form.dentalHistory.bloodDiseasesDetail), heart_problems: yesNoToBoolean(form.dentalHistory.heartProblems), heart_problems_detail: toNullable(form.dentalHistory.heartProblemsDetail), other_disease: yesNoToBoolean(form.dentalHistory.otherDisease), other_disease_detail: toNullable(form.dentalHistory.otherDiseaseDetail), brushing_frequency: toNullable(form.dentalHistory.brushingFrequency), bleeding_gums: yesNoToBoolean(form.dentalHistory.bleedingGums), abnormal_extraction_bleeding: yesNoToBoolean(form.dentalHistory.abnormalExtractionBleeding), abnormal_extraction_bleeding_detail: toNullable(form.dentalHistory.abnormalExtractionBleedingDetail), bruxism: yesNoToBoolean(form.dentalHistory.bruxism), mouth_discomfort: toNullable(form.dentalHistory.mouthDiscomfort), allergies: yesNoToBoolean(form.dentalHistory.allergies), allergies_detail: toNullable(form.dentalHistory.allergiesDetail), recent_major_surgery: yesNoToBoolean(form.dentalHistory.recentMajorSurgery), recent_major_surgery_detail: toNullable(form.dentalHistory.recentMajorSurgeryDetail), permanent_medication: yesNoToBoolean(form.dentalHistory.permanentMedication), permanent_medication_detail: toNullable(form.dentalHistory.permanentMedicationDetail), blood_pressure: toNullable(form.clinicalExam.bloodPressure), pulse: toNumberOrNull(form.clinicalExam.pulse), heart_rate: toNumberOrNull(form.clinicalExam.heartRate), respiratory_rate: toNumberOrNull(form.clinicalExam.respiratoryRate), temperature_c: toNumberOrNull(form.clinicalExam.temperature), extraoral_exam: toNullable(form.clinicalExam.extraoralExam), intraoral_exam: toNullable(form.clinicalExam.intraoralExam), auxiliary_exam_results: toNullable(form.clinicalExam.auxiliaryExamResults), observations: toNullable(form.clinicalExam.observations)
  }
}

function yesNoToBoolean(value: YesNo): boolean | null {
  return value === 'yes' ? true : value === 'no' ? false : null
}

async function load() {
  const data = await loadDental<DentalApiResponse | null>()
  if (data !== undefined) applyDental(data)
}

async function save() {
  const data = await saveDental<DentalApiResponse>(dentalPayload())
  if (!data) return
  applyDental(data)
  toast.add({ title: t('common.success'), description: t('patientDetail.anamneses.dentalSaved'), color: 'success' })
}

watch(patientIdRef, () => {
  load()
}, { immediate: true })
onMounted(fetchProfessionals)
</script>

<template>
  <div class="mx-auto w-full max-w-6xl space-y-8 py-2 sm:py-4">
    <div class="grid grid-cols-1 items-start gap-x-6 gap-y-5 md:grid-cols-2">
      <UFormField class="w-full" :label="t('patientDetail.dentalAnamnesis.doctor')">
        <USelect
          v-model="form.professionalId"
          :items="professionalOptions"
          value-key="value"
          label-key="label"
          :loading="isLoadingProfessionals"
          :placeholder="t('patientDetail.dentalAnamnesis.selectDoctor')"
          icon="i-lucide-user-round"
          class="w-full"
        />
      </UFormField>

      <UFormField class="w-full" :label="t('patientDetail.dentalAnamnesis.consultationReason')">
        <UInput
          v-model="form.consultationReason"
          :placeholder="t('patientDetail.dentalAnamnesis.placeholders.consultationReason')"
          class="w-full"
        />
      </UFormField>
    </div>

    <section class="space-y-5">
      <div class="border-b border-primary/20 pb-3">
        <h2 class="text-ui font-semibold tracking-wide text-primary">
          {{ t('patientDetail.dentalAnamnesis.currentIllness') }}
        </h2>
      </div>
      <div class="grid grid-cols-1 items-start gap-x-6 gap-y-5 md:grid-cols-2">
        <UFormField class="w-full" :label="t('patientDetail.dentalAnamnesis.illnessDuration')">
          <UInput class="w-full" v-model="form.currentIllness.duration" :placeholder="t('patientDetail.dentalAnamnesis.placeholders.illnessDuration')" />
        </UFormField>
        <UFormField class="w-full" :label="t('patientDetail.dentalAnamnesis.mainSymptoms')">
          <UInput class="w-full" v-model="form.currentIllness.symptoms" :placeholder="t('patientDetail.dentalAnamnesis.placeholders.mainSymptoms')" />
        </UFormField>
        <UFormField class="w-full" :label="t('patientDetail.dentalAnamnesis.chronologicalNarrative')">
          <UTextarea class="w-full" v-model="form.currentIllness.chronology" :rows="3" :placeholder="t('patientDetail.dentalAnamnesis.placeholders.chronologicalNarrative')" />
        </UFormField>
        <UFormField class="w-full" :label="t('patientDetail.dentalAnamnesis.biologicalFunctions')">
          <UTextarea class="w-full" v-model="form.currentIllness.biologicalFunctions" :rows="3" :placeholder="t('patientDetail.dentalAnamnesis.placeholders.biologicalFunctions')" />
        </UFormField>
      </div>
    </section>

    <section class="space-y-5">
      <div class="border-b border-primary/20 pb-3">
        <h2 class="text-ui font-semibold tracking-wide text-primary">
          {{ t('patientDetail.dentalAnamnesis.history') }}
        </h2>
      </div>
      <div class="grid grid-cols-1 items-start gap-x-6 gap-y-5 md:grid-cols-2">
        <UFormField class="w-full" :label="t('patientDetail.dentalAnamnesis.familyHistory')">
          <UTextarea class="w-full" v-model="form.history.family" :rows="3" :placeholder="t('patientDetail.dentalAnamnesis.placeholders.familyHistory')" />
        </UFormField>
        <UFormField class="w-full" :label="t('patientDetail.dentalAnamnesis.personalHistory')">
          <UTextarea class="w-full" v-model="form.history.personal" :rows="3" :placeholder="t('patientDetail.dentalAnamnesis.placeholders.personalHistory')" />
        </UFormField>
      </div>

      <div class="space-y-3">
        <h3 class="text-ui font-semibold text-default">
          {{ t('patientDetail.dentalAnamnesis.haveYouHad') }}
        </h3>
        <div class="grid grid-cols-1 items-start gap-x-6 md:grid-cols-2 xl:grid-cols-3">
          <div
            v-for="question in binaryHistoryQuestions"
            :key="question.key"
            class="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-default/70 py-2.5"
          >
            <span class="text-sm text-default">{{ question.label }}</span>
            <URadioGroup
              v-model="form.history[question.key]"
              :items="yesNoOptions"
              value-key="value"
              label-key="label"
              orientation="horizontal"
              class="shrink-0"
            />
          </div>
        </div>
      </div>

      <UFormField class="w-full" :label="t('patientDetail.dentalAnamnesis.additionalComment')">
        <UTextarea class="w-full" v-model="form.history.additionalComment" :rows="3" :placeholder="t('patientDetail.dentalAnamnesis.placeholders.additionalComment')" />
      </UFormField>
    </section>

    <section class="space-y-5">
      <div class="border-b border-primary/20 pb-3">
        <h2 class="text-ui font-semibold tracking-wide text-primary">
          {{ t('patientDetail.dentalAnamnesis.dentalHistory') }}
        </h2>
      </div>
      <div class="grid grid-cols-1 items-start gap-x-6 md:grid-cols-2">
        <div class="space-y-0">
        <UFormField class="w-full" :label="t('patientDetail.dentalAnamnesis.bloodDiseases')">
          <div class="space-y-3 border-b border-default/70 py-3">
            <URadioGroup v-model="form.dentalHistory.bloodDiseases" :items="yesNoOptions" value-key="value" label-key="label" orientation="horizontal" />
            <UInput v-if="form.dentalHistory.bloodDiseases === 'yes'" class="w-full" v-model="form.dentalHistory.bloodDiseasesDetail" :placeholder="t('patientDetail.dentalAnamnesis.placeholders.bloodDiseases')" />
          </div>
        </UFormField>
        <UFormField class="w-full" :label="t('patientDetail.dentalAnamnesis.otherDisease')">
          <div class="space-y-3 border-b border-default/70 py-3">
            <URadioGroup v-model="form.dentalHistory.otherDisease" :items="yesNoOptions" value-key="value" label-key="label" orientation="horizontal" />
            <UInput v-if="form.dentalHistory.otherDisease === 'yes'" class="w-full" v-model="form.dentalHistory.otherDiseaseDetail" :placeholder="t('patientDetail.dentalAnamnesis.placeholders.otherDisease')" />
          </div>
        </UFormField>
        <UFormField class="w-full" :label="t('patientDetail.dentalAnamnesis.bleedingGums')">
          <div class="border-b border-default/70 py-3"><URadioGroup v-model="form.dentalHistory.bleedingGums" :items="yesNoOptions" value-key="value" label-key="label" orientation="horizontal" /></div>
        </UFormField>
        <UFormField class="w-full" :label="t('patientDetail.dentalAnamnesis.bruxism')">
          <div class="border-b border-default/70 py-3"><URadioGroup v-model="form.dentalHistory.bruxism" :items="yesNoOptions" value-key="value" label-key="label" orientation="horizontal" /></div>
        </UFormField>
        <UFormField class="w-full" :label="t('patientDetail.dentalAnamnesis.allergies')">
          <div class="space-y-3 border-b border-default/70 py-3">
            <URadioGroup v-model="form.dentalHistory.allergies" :items="yesNoOptions" value-key="value" label-key="label" orientation="horizontal" />
            <UInput v-if="form.dentalHistory.allergies === 'yes'" class="w-full" v-model="form.dentalHistory.allergiesDetail" :placeholder="t('patientDetail.dentalAnamnesis.placeholders.allergies')" />
          </div>
        </UFormField>
        <UFormField class="w-full" :label="t('patientDetail.dentalAnamnesis.permanentMedication')">
          <div class="space-y-3 border-b border-default/70 py-3">
            <URadioGroup v-model="form.dentalHistory.permanentMedication" :items="yesNoOptions" value-key="value" label-key="label" orientation="horizontal" />
            <UInput v-if="form.dentalHistory.permanentMedication === 'yes'" class="w-full" v-model="form.dentalHistory.permanentMedicationDetail" :placeholder="t('patientDetail.dentalAnamnesis.placeholders.permanentMedication')" />
          </div>
        </UFormField>
        </div>
        <div class="space-y-0">
        <UFormField class="w-full" :label="t('patientDetail.dentalAnamnesis.heartProblems')">
          <div class="space-y-3 border-b border-default/70 py-3">
            <URadioGroup v-model="form.dentalHistory.heartProblems" :items="yesNoOptions" value-key="value" label-key="label" orientation="horizontal" />
            <UInput v-if="form.dentalHistory.heartProblems === 'yes'" class="w-full" v-model="form.dentalHistory.heartProblemsDetail" :placeholder="t('patientDetail.dentalAnamnesis.placeholders.heartProblems')" />
          </div>
        </UFormField>
        <UFormField class="w-full" :label="t('patientDetail.dentalAnamnesis.brushingFrequency')">
          <div class="border-b border-default/70 py-3"><UInput class="w-full" v-model="form.dentalHistory.brushingFrequency" :placeholder="t('patientDetail.dentalAnamnesis.placeholders.brushingFrequency')" /></div>
        </UFormField>
        <UFormField class="w-full" :label="t('patientDetail.dentalAnamnesis.abnormalExtractionBleeding')">
          <div class="space-y-3 border-b border-default/70 py-3">
            <URadioGroup v-model="form.dentalHistory.abnormalExtractionBleeding" :items="yesNoOptions" value-key="value" label-key="label" orientation="horizontal" />
            <UInput v-if="form.dentalHistory.abnormalExtractionBleeding === 'yes'" class="w-full" v-model="form.dentalHistory.abnormalExtractionBleedingDetail" :placeholder="t('patientDetail.dentalAnamnesis.detail')" />
          </div>
        </UFormField>
        <UFormField class="w-full" :label="t('patientDetail.dentalAnamnesis.mouthDiscomfort')">
          <div class="border-b border-default/70 py-3"><UInput class="w-full" v-model="form.dentalHistory.mouthDiscomfort" :placeholder="t('patientDetail.dentalAnamnesis.placeholders.mouthDiscomfort')" /></div>
        </UFormField>
        <UFormField class="w-full" :label="t('patientDetail.dentalAnamnesis.recentMajorSurgery')">
          <div class="space-y-3 border-b border-default/70 py-3">
            <URadioGroup v-model="form.dentalHistory.recentMajorSurgery" :items="yesNoOptions" value-key="value" label-key="label" orientation="horizontal" />
            <UInput v-if="form.dentalHistory.recentMajorSurgery === 'yes'" class="w-full" v-model="form.dentalHistory.recentMajorSurgeryDetail" :placeholder="t('patientDetail.dentalAnamnesis.placeholders.recentMajorSurgery')" />
          </div>
        </UFormField>
        </div>
      </div>
    </section>

    <section class="space-y-5">
      <div class="border-b border-primary/20 pb-3">
        <h2 class="text-ui font-semibold tracking-wide text-primary">
          {{ t('patientDetail.dentalAnamnesis.clinicalExam') }}
        </h2>
      </div>
      <div>
        <h3 class="text-ui font-semibold text-default">
          {{ t('patientDetail.dentalAnamnesis.vitalSigns') }}
        </h3>
        <div class="mt-4 grid grid-cols-1 items-start gap-4 sm:grid-cols-2 lg:grid-cols-5">
          <UFormField class="w-full" :label="t('patientDetail.dentalAnamnesis.bloodPressure')"><UInput class="w-full" v-model="form.clinicalExam.bloodPressure"><template #trailing><span class="text-muted text-xs">mmHg</span></template></UInput></UFormField>
          <UFormField class="w-full" :label="t('patientDetail.dentalAnamnesis.pulse')"><UInput class="w-full" v-model="form.clinicalExam.pulse" /></UFormField>
          <UFormField class="w-full" :label="t('patientDetail.dentalAnamnesis.heartRate')"><UInput class="w-full" v-model="form.clinicalExam.heartRate" /></UFormField>
          <UFormField class="w-full" :label="t('patientDetail.dentalAnamnesis.respiratoryRate')"><UInput class="w-full" v-model="form.clinicalExam.respiratoryRate" /></UFormField>
          <UFormField class="w-full" :label="t('patientDetail.dentalAnamnesis.temperature')"><UInput class="w-full" v-model="form.clinicalExam.temperature"><template #trailing><span class="text-muted text-xs">°C</span></template></UInput></UFormField>
        </div>
      </div>

      <div class="grid grid-cols-1 items-start gap-x-6 gap-y-5 md:grid-cols-2">
        <UFormField class="w-full" :label="t('patientDetail.dentalAnamnesis.extraoralExam')"><UTextarea class="w-full" v-model="form.clinicalExam.extraoralExam" :rows="4" :placeholder="t('patientDetail.dentalAnamnesis.placeholders.extraoralExam')" /></UFormField>
        <UFormField class="w-full" :label="t('patientDetail.dentalAnamnesis.intraoralExam')"><UTextarea class="w-full" v-model="form.clinicalExam.intraoralExam" :rows="4" :placeholder="t('patientDetail.dentalAnamnesis.placeholders.intraoralExam')" /></UFormField>
        <UFormField class="w-full" :label="t('patientDetail.dentalAnamnesis.auxiliaryExamResults')"><UTextarea class="w-full" v-model="form.clinicalExam.auxiliaryExamResults" :rows="4" :placeholder="t('patientDetail.dentalAnamnesis.placeholders.auxiliaryExamResults')" /></UFormField>
        <UFormField class="w-full" :label="t('patientDetail.dentalAnamnesis.observations')"><UTextarea class="w-full" v-model="form.clinicalExam.observations" :rows="4" :placeholder="t('patientDetail.dentalAnamnesis.placeholders.observations')" /></UFormField>
      </div>
    </section>

    <div class="flex flex-col items-start gap-3 border-t border-default/70 pt-6 sm:flex-row sm:items-center sm:justify-end">
      <p v-if="isLoading" class="text-caption text-muted sm:order-first sm:mr-auto">
        {{ t('common.loading') }}
      </p>
      <UButton color="primary" icon="i-lucide-save" :loading="isSaving" :disabled="!props.patientId || isLoading || isSaving" @click="save">
        {{ t('patientDetail.dentalAnamnesis.save') }}
      </UButton>
    </div>
  </div>
</template>
