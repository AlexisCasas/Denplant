/**
 * usePrescriptions — a patient's prescriptions, read-only (Phase C).
 *
 * Three independent things, each with its own state, its own request and its
 * own failure: the paginated **list**, the **detail** of one prescription, and
 * the authenticated **PDF**. A failure in one never touches the others.
 *
 * Three properties this file exists to guarantee:
 *
 * 1. **State is local to the instance.** Nothing here is `useState`: a global
 *    would let one patient's rows show up under another.
 * 2. **A late response can never win.** Every request takes a generation token
 *    and an `AbortController`; a patient change (or unmounting) bumps the
 *    generation, aborts what is in flight and clears everything *before* the
 *    new patient's first byte arrives.
 * 3. **The PDF is fetched with the user's token, never linked.** An `<a href>`
 *    carries no `Authorization`. The window is opened inside the click, before
 *    any `await`, because a popup opened after the response is blocked.
 *
 * Phase D adds the two writes, each with its own state (`submitting` /
 * `voiding`) and its own error, apart from the reads above:
 *
 * - **create** issues a prescription. The POST carries exactly `patient_id`,
 *   `valid_until` and `items`. On success the response (the whole document) is
 *   shown as the detail, so there is one source of truth, and the history is
 *   reloaded from page 1.
 * - **void** voids an issued prescription with a reason. The response replaces
 *   the open detail.
 *
 * A write that was already sent is not aborted by a patient change, but its
 * answer is dropped: the write generation moved, so it can never be applied to
 * another patient.
 */

import type { MaybeRefOrGetter } from 'vue'

import type {
  PdfOutcome,
  PrescriptionCreatePayload,
  PrescriptionDetail,
  PrescriptionDetailResponse,
  PrescriptionListItem,
  PrescriptionListResponse,
  WriteError,
  WriteOutcome
} from '../types/prescriptions'
import { writeErrorOf } from '../utils/prescriptionForm'

export const PAGE_SIZE = 10

/** The PDF has labels in these languages only; any other locale is left out. */
const PDF_LOCALES = ['es', 'en']

/** More than this many blob URLs alive at once and the oldest is released. */
const MAX_BLOB_URLS = 10

/** A safe file name from `Content-Disposition`, or `null`. */
export function filenameFromDisposition(header: string | null): string | null {
  if (!header) return null
  const match = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(header)
  if (!match?.[1]) return null
  const cleaned = match[1].trim().replace(/[^A-Za-z0-9._-]/g, '-').slice(0, 100)
  return /\.pdf$/i.test(cleaned) ? cleaned : null
}

export function usePrescriptions(patientId: MaybeRefOrGetter<string>) {
  const api = useApi()
  const auth = useAuth()
  const config = useRuntimeConfig()
  const { locale } = useI18n()

  // --- list ----------------------------------------------------------------
  const rows = ref<PrescriptionListItem[]>([])
  const total = ref(0)
  const page = ref(1)
  const listLoading = ref(false)
  const listError = ref(false)

  let listGeneration = 0
  let listController: AbortController | null = null

  // --- detail --------------------------------------------------------------
  const detailId = ref<string | null>(null)
  const detail = ref<PrescriptionDetail | null>(null)
  const detailLoading = ref(false)
  const detailError = ref(false)

  let detailGeneration = 0
  let detailController: AbortController | null = null

  // --- pdf -----------------------------------------------------------------
  const pdfBusyIds = ref<string[]>([])
  const pdfFailedId = ref<string | null>(null)

  let pdfGeneration = 0
  const pdfControllers = new Set<AbortController>()
  const blobUrls: string[] = []

  // --- writes --------------------------------------------------------------
  const submitting = ref(false)
  const createError = ref<WriteError | null>(null)
  const voiding = ref(false)
  const voidError = ref<WriteError | null>(null)

  let writeGeneration = 0

  const pageCount = computed(() => Math.max(1, Math.ceil(total.value / PAGE_SIZE)))

  function isPdfBusy(id: string): boolean {
    return pdfBusyIds.value.includes(id)
  }

  // ------------------------------------------------------------------------
  // list
  // ------------------------------------------------------------------------

  async function fetchList(target = 1): Promise<boolean> {
    const id = toValue(patientId)
    const token = ++listGeneration
    listController?.abort()
    listController = null
    if (!id) return true

    const controller = new AbortController()
    listController = controller
    page.value = target
    listLoading.value = true
    listError.value = false

    try {
      const response = await api.get<PrescriptionListResponse>('/api/v1/prescriptions', {
        query: { patient_id: id, page: target, page_size: PAGE_SIZE },
        signal: controller.signal
      })
      if (token !== listGeneration) return false
      rows.value = response.data
      total.value = response.total
      page.value = response.page
      return true
    } catch {
      // A superseded request is not a failure: a newer one owns the outcome.
      if (token !== listGeneration) return false
      listError.value = true
      return false
    } finally {
      if (token === listGeneration) listLoading.value = false
    }
  }

  /** Retry the page the user asked for. */
  async function retryList(): Promise<boolean> {
    return await fetchList(page.value)
  }

  // ------------------------------------------------------------------------
  // detail
  // ------------------------------------------------------------------------

  function clearDetail(): void {
    detailGeneration += 1
    detailController?.abort()
    detailController = null
    detailId.value = null
    detail.value = null
    detailLoading.value = false
    detailError.value = false
  }

  async function fetchDetail(id: string): Promise<boolean> {
    const token = ++detailGeneration
    detailController?.abort()
    const controller = new AbortController()
    detailController = controller

    detailId.value = id
    detail.value = null
    detailLoading.value = true
    detailError.value = false

    try {
      const response = await api.get<PrescriptionDetailResponse>(
        `/api/v1/prescriptions/${encodeURIComponent(id)}`,
        { signal: controller.signal }
      )
      if (token !== detailGeneration) return false
      detail.value = response.data
      return true
    } catch {
      if (token !== detailGeneration) return false
      detailError.value = true
      return false
    } finally {
      if (token === detailGeneration) detailLoading.value = false
    }
  }

  async function retryDetail(): Promise<boolean> {
    return detailId.value ? await fetchDetail(detailId.value) : false
  }

  /** Show a document we already hold (the answer to a write) as the detail. */
  function showDetail(document: PrescriptionDetail): void {
    detailGeneration += 1
    detailController?.abort()
    detailController = null
    detailId.value = document.id
    detail.value = document
    detailLoading.value = false
    detailError.value = false
  }

  /**
   * Fetch the open detail again without blanking it: used after a write came
   * back with news (it was already voided, the actor changed, ...).
   */
  async function refreshDetail(id: string): Promise<void> {
    const token = ++detailGeneration
    detailController?.abort()
    const controller = new AbortController()
    detailController = controller
    try {
      const response = await api.get<PrescriptionDetailResponse>(
        `/api/v1/prescriptions/${encodeURIComponent(id)}`,
        { signal: controller.signal }
      )
      if (token === detailGeneration) detail.value = response.data
    } catch {
      // The detail on screen stays as it was; the caller already explained why.
    }
  }

  // ------------------------------------------------------------------------
  // writes
  // ------------------------------------------------------------------------

  /**
   * Issue a prescription for the current patient.
   *
   * The body is built here from the patient this instance is bound to, so a
   * draft can never name another one. `silentForbidden`: a 403 is explained by
   * the form itself, not by the generic toast as well.
   */
  async function createPrescription(
    input: Omit<PrescriptionCreatePayload, 'patient_id'>
  ): Promise<WriteOutcome> {
    if (submitting.value) return 'busy'
    const id = toValue(patientId)
    if (!id) return 'failed'

    const generation = writeGeneration
    submitting.value = true
    createError.value = null
    try {
      const response = await api.post<PrescriptionDetailResponse>(
        '/api/v1/prescriptions',
        { patient_id: id, valid_until: input.valid_until, items: input.items },
        { silentForbidden: true }
      )
      if (generation !== writeGeneration) return 'stale'
      showDetail(response.data)
      void fetchList(1)
      return 'done'
    } catch (error) {
      if (generation !== writeGeneration) return 'stale'
      createError.value = writeErrorOf(error)
      return 'failed'
    } finally {
      if (generation === writeGeneration) submitting.value = false
    }
  }

  /**
   * Void an issued prescription. Never retried: if somebody else got there
   * first, the answer is a conflict, and the detail and the history are
   * reloaded to show what is true now.
   */
  async function voidPrescription(id: string, reason: string): Promise<WriteOutcome> {
    if (voiding.value) return 'busy'

    const generation = writeGeneration
    voiding.value = true
    voidError.value = null
    try {
      const response = await api.post<PrescriptionDetailResponse>(
        `/api/v1/prescriptions/${encodeURIComponent(id)}/void`,
        { reason },
        { silentForbidden: true }
      )
      if (generation !== writeGeneration) return 'stale'
      if (detailId.value === id) showDetail(response.data)
      void fetchList(page.value)
      return 'done'
    } catch (error) {
      if (generation !== writeGeneration) return 'stale'
      const failure = writeErrorOf(error)
      voidError.value = failure
      if (failure.code === 'prescription_not_found') {
        if (detailId.value === id) clearDetail()
        void fetchList(page.value)
      } else if (failure.code === 'prescription_state_conflict' || failure.code === 'void_not_allowed') {
        if (detailId.value === id) void refreshDetail(id)
        void fetchList(page.value)
      }
      return 'failed'
    } finally {
      if (generation === writeGeneration) voiding.value = false
    }
  }

  function clearCreateError(): void {
    createError.value = null
  }

  function clearVoidError(): void {
    voidError.value = null
  }

  // ------------------------------------------------------------------------
  // pdf
  // ------------------------------------------------------------------------

  function trackBlobUrl(url: string): string {
    blobUrls.push(url)
    while (blobUrls.length > MAX_BLOB_URLS) {
      const oldest = blobUrls.shift()
      if (oldest) URL.revokeObjectURL(oldest)
    }
    return url
  }

  function revokeBlobUrls(): void {
    for (const url of blobUrls.splice(0)) URL.revokeObjectURL(url)
  }

  /**
   * The PDF as a blob, with the user's token.
   *
   * A 401 means the access token expired: refresh it and ask again **once**.
   * A second failure of any kind is final; there is no loop.
   */
  async function requestPdf(
    id: string,
    signal: AbortSignal
  ): Promise<{ blob: Blob, filename: string | null }> {
    const current = String(locale.value)
    const query = PDF_LOCALES.includes(current) ? `?locale=${current}` : ''
    const url = `${config.public.apiBaseUrl}/api/v1/prescriptions/${encodeURIComponent(id)}/pdf${query}`
    const send = () =>
      fetch(url, { headers: { Authorization: `Bearer ${auth.accessToken.value}` }, signal })

    let response = await send()
    if (response.status === 401) {
      if (!(await auth.refresh())) throw new Error('unauthorized')
      response = await send()
    }
    if (!response.ok) throw new Error(`HTTP ${response.status}`)

    // Never show something that is not a PDF as if it were one.
    const type = response.headers.get('Content-Type') ?? ''
    if (!type.toLowerCase().startsWith('application/pdf')) throw new Error('not a pdf')

    return {
      blob: await response.blob(),
      filename: filenameFromDisposition(response.headers.get('Content-Disposition'))
    }
  }

  function download(url: string, filename: string): void {
    const link = document.createElement('a')
    link.href = url
    link.download = filename
    link.rel = 'noopener'
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  }

  /**
   * Show the PDF of one prescription.
   *
   * Call it straight from the click handler: the window is opened here, before
   * the first `await`, which is the only moment a browser lets a page open one.
   */
  async function openPdf(id: string, number?: string): Promise<PdfOutcome> {
    if (isPdfBusy(id)) return 'busy'

    const generation = pdfGeneration
    pdfBusyIds.value = [...pdfBusyIds.value, id]
    pdfFailedId.value = null

    const preview = typeof window === 'undefined' ? null : window.open('', '_blank')
    if (preview) {
      try {
        preview.opener = null
      } catch {
        // Cross-origin placeholder: nothing to detach.
      }
    }

    const controller = new AbortController()
    pdfControllers.add(controller)
    try {
      const result = await requestPdf(id, controller.signal)
      if (generation !== pdfGeneration) {
        preview?.close()
        return 'cancelled'
      }

      const url = trackBlobUrl(URL.createObjectURL(result.blob))
      if (preview) {
        if (preview.closed) return 'cancelled'
        // Not revoked here: the viewer may still be reading it. It is released
        // with the view, or when the oldest of the last few is pushed out.
        preview.location.href = url
        return 'opened'
      }
      download(url, result.filename ?? `receta-${number ?? id}.pdf`)
      return 'downloaded'
    } catch {
      preview?.close()
      if (generation !== pdfGeneration) return 'cancelled'
      pdfFailedId.value = id
      return 'failed'
    } finally {
      pdfControllers.delete(controller)
      pdfBusyIds.value = pdfBusyIds.value.filter(busy => busy !== id)
    }
  }

  // ------------------------------------------------------------------------
  // another patient, or the view going away
  // ------------------------------------------------------------------------

  /** Forget everything, now: abort what is in flight and clear what is shown. */
  function reset(): void {
    listGeneration += 1
    listController?.abort()
    listController = null
    rows.value = []
    total.value = 0
    page.value = 1
    listLoading.value = false
    listError.value = false

    clearDetail()

    writeGeneration += 1
    submitting.value = false
    createError.value = null
    voiding.value = false
    voidError.value = null

    pdfGeneration += 1
    for (const controller of pdfControllers) controller.abort()
    pdfControllers.clear()
    pdfBusyIds.value = []
    pdfFailedId.value = null
    revokeBlobUrls()
  }

  watch(
    () => toValue(patientId),
    (id) => {
      reset()
      if (id) void fetchList(1)
    },
    { immediate: true }
  )

  onScopeDispose(reset)

  return {
    // list
    rows,
    total,
    page,
    pageCount,
    pageSize: PAGE_SIZE,
    listLoading,
    listError,
    fetchList,
    retryList,
    // detail
    detailId,
    detail,
    detailLoading,
    detailError,
    fetchDetail,
    retryDetail,
    closeDetail: clearDetail,
    // writes
    submitting,
    createError,
    createPrescription,
    clearCreateError,
    voiding,
    voidError,
    voidPrescription,
    clearVoidError,
    // pdf
    pdfFailedId,
    isPdfBusy,
    openPdf
  }
}
