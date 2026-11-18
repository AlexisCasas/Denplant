import type { Ref } from 'vue'

type ApiResponse<T> = { data: T }

/** API boundary for the three specialty patient forms. Form-specific mapping
 * remains in each component so Vue state is never posted as an API payload. */
export function usePatientAnamneses(patientId: Ref<string | undefined>) {
  const api = useApi()
  const { t } = useI18n()
  const toast = useToast()
  const isLoading = ref(false)
  const isSaving = ref(false)
  const error = ref<string | null>(null)

  function path(suffix: string) {
    return `/api/v1/patients_clinical/patients/${patientId.value}${suffix}`
  }

  async function load<T>(suffix: string): Promise<T | undefined> {
    if (!patientId.value) return undefined
    isLoading.value = true
    error.value = null
    try {
      return (await api.get<ApiResponse<T>>(path(suffix))).data
    } catch (cause) {
      error.value = t('patientDetail.anamneses.loadError')
      toast.add({ title: t('common.error'), description: error.value, color: 'error' })
      console.error('Failed to load patient anamnesis:', cause)
      return undefined
    } finally {
      isLoading.value = false
    }
  }

  async function save<T>(method: 'post' | 'put', suffix: string, payload: Record<string, unknown>): Promise<T | undefined> {
    if (!patientId.value || isSaving.value) return undefined
    isSaving.value = true
    error.value = null
    try {
      const response = method === 'post'
        ? await api.post<ApiResponse<T>>(path(suffix), payload)
        : await api.put<ApiResponse<T>>(path(suffix), payload)
      return response.data
    } catch (cause) {
      error.value = t('patientDetail.anamneses.saveError')
      toast.add({ title: t('common.error'), description: error.value, color: 'error' })
      console.error('Failed to save patient anamnesis:', cause)
      return undefined
    } finally {
      isSaving.value = false
    }
  }

  return {
    isLoading: readonly(isLoading),
    isSaving: readonly(isSaving),
    error: readonly(error),
    loadDental: <T>() => load<T>('/dental-anamnesis'),
    saveDental: <T>(payload: Record<string, unknown>) => save<T>('put', '/dental-anamnesis', payload),
    loadPediatric: <T>() => load<T>('/pediatric-dental-anamnesis'),
    savePediatric: <T>(payload: Record<string, unknown>) => save<T>('put', '/pediatric-dental-anamnesis', payload),
    loadEndodonticRecords: <T>() => load<T[]>('/endodontic-records'),
    createEndodontic: <T>(payload: Record<string, unknown>) => save<T>('post', '/endodontic-records', payload),
    updateEndodontic: <T>(recordId: string, payload: Record<string, unknown>) => save<T>('put', `/endodontic-records/${recordId}`, payload)
  }
}
