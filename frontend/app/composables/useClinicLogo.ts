import type { ApiResponse, Clinic, ClinicLogo } from '~/types'
import { logoErrorKey, logoFileProblem } from '~/utils/clinicLogo'

/**
 * The clinic's logo: preview, upload, replace, remove.
 *
 * The file lives in storage on the server and `clinic.logo` carries only its
 * metadata. The image itself is fetched with the bearer token (a plain `<img>`
 * cannot send it) and shown through an object URL, which is released when it
 * is replaced and when the component goes away.
 */
export function useClinicLogo() {
  const config = useRuntimeConfig()
  const auth = useAuth()
  const { t } = useI18n()
  const toast = useToast()
  const { currentClinic } = useClinicState()

  const previewUrl = ref<string | null>(null)
  const loading = ref(false)
  const saving = ref(false)
  /** An i18n key under `settings.logo.errors`, or `null`. */
  const errorKey = ref<string | null>(null)

  const apiBaseUrl = computed(() =>
    import.meta.server ? config.apiBaseUrlServer : config.public.apiBaseUrl
  )
  const headers = () => ({ Authorization: `Bearer ${auth.accessToken.value}` })

  const logo = computed<ClinicLogo | null>(() => currentClinic.value?.logo ?? null)

  function releasePreview() {
    if (previewUrl.value) URL.revokeObjectURL(previewUrl.value)
    previewUrl.value = null
  }

  async function loadPreview(): Promise<void> {
    releasePreview()
    if (!logo.value) return
    loading.value = true
    try {
      const blob = await $fetch<Blob>('/api/v1/auth/clinic/logo', {
        baseURL: apiBaseUrl.value,
        headers: headers(),
        responseType: 'blob'
      })
      previewUrl.value = URL.createObjectURL(blob)
    } catch {
      // A missing file just means there is nothing to preview.
    } finally {
      loading.value = false
    }
  }

  function setLogo(next: ClinicLogo | null) {
    if (currentClinic.value) {
      currentClinic.value = { ...currentClinic.value, logo: next } as Clinic
    }
  }

  async function upload(file: File): Promise<boolean> {
    errorKey.value = null
    const problem = logoFileProblem(file)
    if (problem) {
      errorKey.value = problem
      return false
    }

    saving.value = true
    try {
      const body = new FormData()
      body.append('file', file)
      const response = await $fetch<ApiResponse<ClinicLogo>>('/api/v1/auth/clinic/logo', {
        baseURL: apiBaseUrl.value,
        method: 'POST',
        body,
        headers: headers()
      })
      setLogo(response.data)
      await loadPreview()
      toast.add({ title: t('common.success'), description: t('settings.logo.saved'), color: 'success' })
      return true
    } catch (error) {
      const code = (error as { data?: { code?: string } })?.data?.code
      errorKey.value = logoErrorKey(code)
      return false
    } finally {
      saving.value = false
    }
  }

  async function remove(): Promise<boolean> {
    errorKey.value = null
    saving.value = true
    try {
      await $fetch('/api/v1/auth/clinic/logo', {
        baseURL: apiBaseUrl.value,
        method: 'DELETE',
        headers: headers()
      })
      releasePreview()
      setLogo(null)
      toast.add({ title: t('common.success'), description: t('settings.logo.removed'), color: 'success' })
      return true
    } catch {
      errorKey.value = 'unreadable'
      return false
    } finally {
      saving.value = false
    }
  }

  return { logo, previewUrl, loading, saving, errorKey, loadPreview, releasePreview, upload, remove }
}
