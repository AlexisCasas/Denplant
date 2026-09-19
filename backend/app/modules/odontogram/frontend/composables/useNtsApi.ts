/**
 * useNtsApi — the HTTP boundary for the NTS clinical record API (NTS-05A).
 *
 * Endpoint mapping only: no reactive state, no lifecycle rules, no clinical
 * decisions. `useNtsOdontogramRecord` owns the state; components own the
 * rendering. Keeping the three apart is what lets the lifecycle be tested
 * without a server and the transport be tested without a component.
 *
 * `clinic_id` and the acting user are never sent: the backend derives both
 * from the authenticated context, and the request schemas are
 * `extra="forbid"`, so sending them would be a 422.
 */

import type { ApiResponse, PaginatedResponse } from '~~/app/types'

import type {
  NtsApiError,
  NtsAttributesReplacePayload,
  NtsCatalog,
  NtsCatalogVersions,
  NtsDiscardPayload,
  NtsDraftCreatePayload,
  NtsErrorCode,
  NtsExpectedVersionPayload,
  NtsFindingCreatePayload,
  NtsFindingMutationResult,
  NtsRecord,
  NtsRecordMetadataPayload,
  NtsRecordSummary,
  NtsSpecificationCreatePayload,
  NtsSpecificationMutationResult,
  NtsSpecificationReplacePayload,
  NtsTargetsReplacePayload,
  NtsVersionMutationResult
} from '../types/nts'

const BASE = '/api/v1/odontogram/nts'

/**
 * Normalise whatever `$fetch` threw into the API's own error contract.
 *
 * The backend answers with `{ message, errors[], code }`; a network failure
 * or a proxy error answers with none of it. Callers should never have to
 * care which happened.
 */
export function toNtsApiError(error: unknown): NtsApiError {
  const raw = error as {
    statusCode?: number
    status?: number
    data?: { message?: string, errors?: string[], code?: string }
    message?: string
  }
  const data = raw?.data
  const errors = Array.isArray(data?.errors) ? data.errors.filter(Boolean) : []
  const message = data?.message || raw?.message || 'Unexpected error'

  return {
    status: raw?.statusCode ?? raw?.status ?? null,
    code: (data?.code as NtsErrorCode | undefined) ?? null,
    message,
    errors: errors.length > 0 ? errors : [message]
  }
}

export function useNtsApi() {
  const api = useApi()

  return {
    // --- catalog (read-only, no patient involved) --------------------------

    async listCatalogs(signal?: AbortSignal): Promise<NtsCatalogVersions> {
      const response = await api.get<ApiResponse<NtsCatalogVersions>>(
        `${BASE}/catalogs`,
        { signal }
      )
      return response.data
    },

    async getCatalog(normVersion: string, signal?: AbortSignal): Promise<NtsCatalog> {
      const response = await api.get<ApiResponse<NtsCatalog>>(
        `${BASE}/catalogs/${encodeURIComponent(normVersion)}`,
        { signal }
      )
      return response.data
    },

    // --- patient-scoped reads ---------------------------------------------

    /**
     * The clinically current finalized record, or `null`.
     *
     * `null` is an ordinary state, not an error: the endpoint answers 200
     * with a null payload when the patient has no record yet.
     */
    async getCurrentRecord(
      patientId: string,
      normVersion: string,
      signal?: AbortSignal
    ): Promise<NtsRecord | null> {
      const response = await api.get<ApiResponse<NtsRecord | null>>(
        `${BASE}/patients/${patientId}/records/current`,
        { query: { norm_version: normVersion }, signal }
      )
      return response.data ?? null
    },

    /** The open draft, or `null`. At most one can exist. */
    async getDraft(
      patientId: string,
      normVersion: string,
      signal?: AbortSignal
    ): Promise<NtsRecord | null> {
      const response = await api.get<ApiResponse<NtsRecord | null>>(
        `${BASE}/patients/${patientId}/records/draft`,
        { query: { norm_version: normVersion }, signal }
      )
      return response.data ?? null
    },

    async listRecords(
      patientId: string,
      normVersion: string,
      options: { page?: number, pageSize?: number, status?: string } = {},
      signal?: AbortSignal
    ): Promise<PaginatedResponse<NtsRecordSummary>> {
      return await api.get<PaginatedResponse<NtsRecordSummary>>(
        `${BASE}/patients/${patientId}/records`,
        {
          query: {
            norm_version: normVersion,
            page: options.page ?? 1,
            page_size: options.pageSize ?? 20,
            status: options.status
          },
          signal
        }
      )
    },

    async getRecord(recordId: string, signal?: AbortSignal): Promise<NtsRecord> {
      const response = await api.get<ApiResponse<NtsRecord>>(
        `${BASE}/records/${recordId}`,
        { signal }
      )
      return response.data
    },

    // --- mutations ---------------------------------------------------------

    async createDraft(
      patientId: string,
      payload: NtsDraftCreatePayload
    ): Promise<NtsRecord> {
      const response = await api.post<ApiResponse<NtsRecord>>(
        `${BASE}/patients/${patientId}/records`,
        payload
      )
      return response.data
    },

    async finalize(
      recordId: string,
      payload: NtsExpectedVersionPayload
    ): Promise<NtsRecord> {
      const response = await api.post<ApiResponse<NtsRecord>>(
        `${BASE}/records/${recordId}/finalize`,
        payload
      )
      return response.data
    },

    /**
     * Abandon a draft. Nothing is deleted — the record stays queryable with
     * `status = 'discarded'` — so the UI must not call this "delete".
     */
    async discard(
      recordId: string,
      payload: NtsDiscardPayload
    ): Promise<NtsRecord> {
      const response = await api.post<ApiResponse<NtsRecord>>(
        `${BASE}/records/${recordId}/discard`,
        payload
      )
      return response.data
    },

    // --- findings ----------------------------------------------------------

    /**
     * Create a finding **and its targets in one request**.
     *
     * The API takes them as a single aggregate, so there is no window in
     * which a finding exists without the targets that give it meaning, and
     * no client-side pretence of atomicity to maintain.
     */
    async createFinding(
      recordId: string,
      payload: NtsFindingCreatePayload
    ): Promise<NtsFindingMutationResult> {
      const response = await api.post<ApiResponse<NtsFindingMutationResult>>(
        `${BASE}/records/${recordId}/findings`,
        payload
      )
      return response.data
    },

    /** Full replacement of a finding's attributes. Its rule never changes. */
    async replaceFindingAttributes(
      recordId: string,
      findingId: string,
      payload: NtsAttributesReplacePayload
    ): Promise<NtsFindingMutationResult> {
      const response = await api.put<ApiResponse<NtsFindingMutationResult>>(
        `${BASE}/records/${recordId}/findings/${findingId}`,
        payload
      )
      return response.data
    },

    /**
     * Full replacement of the target set. The list sent **replaces** the
     * previous one; there is deliberately no target-by-target endpoint.
     */
    async replaceFindingTargets(
      recordId: string,
      findingId: string,
      payload: NtsTargetsReplacePayload
    ): Promise<NtsFindingMutationResult> {
      const response = await api.put<ApiResponse<NtsFindingMutationResult>>(
        `${BASE}/records/${recordId}/findings/${findingId}/targets`,
        payload
      )
      return response.data
    },

    /** Confirm one carried-forward finding. There is no bulk endpoint. */
    async confirmFinding(
      recordId: string,
      findingId: string,
      payload: NtsExpectedVersionPayload
    ): Promise<NtsFindingMutationResult> {
      const response = await api.post<ApiResponse<NtsFindingMutationResult>>(
        `${BASE}/records/${recordId}/findings/${findingId}/confirm`,
        payload
      )
      return response.data
    },

    /**
     * Withdraw a finding from a draft. `POST .../remove`, not `DELETE`:
     * `expected_version` belongs in the body. The API takes no reason.
     */
    async removeFinding(
      recordId: string,
      findingId: string,
      payload: NtsExpectedVersionPayload
    ): Promise<NtsVersionMutationResult> {
      const response = await api.post<ApiResponse<NtsVersionMutationResult>>(
        `${BASE}/records/${recordId}/findings/${findingId}/remove`,
        payload
      )
      return response.data
    },

    // --- the record's own text ----------------------------------------------

    /**
     * Change stage, stage label or *Observaciones* (§5.15).
     *
     * A PATCH, and the only mutation in this client where the difference
     * between "absent" and "null" carries meaning: the API reads an absent key
     * as *leave it alone* and an explicit null as *clear it*. The payload is
     * passed through untouched so that distinction survives — building the
     * body here from optional arguments would turn every unspecified field
     * into a null and quietly wipe two fields on every save.
     */
    async updateMetadata(
      recordId: string,
      payload: NtsRecordMetadataPayload
    ): Promise<NtsRecord> {
      const response = await api.patch<ApiResponse<NtsRecord>>(
        `${BASE}/records/${recordId}`,
        payload
      )
      return response.data
    },

    // --- specifications ------------------------------------------------------

    /**
     * Add an *Especificaciones* entry (§5.14).
     *
     * The server owns `sequence` and answers with it; nothing here proposes
     * one.
     */
    async createSpecification(
      recordId: string,
      payload: NtsSpecificationCreatePayload
    ): Promise<NtsSpecificationMutationResult> {
      const response = await api.post<ApiResponse<NtsSpecificationMutationResult>>(
        `${BASE}/records/${recordId}/specifications`,
        payload
      )
      return response.data
    },

    /** Full replacement of one entry, `finding_id` included even when null. */
    async updateSpecification(
      recordId: string,
      specificationId: string,
      payload: NtsSpecificationReplacePayload
    ): Promise<NtsSpecificationMutationResult> {
      const response = await api.put<ApiResponse<NtsSpecificationMutationResult>>(
        `${BASE}/records/${recordId}/specifications/${specificationId}`,
        payload
      )
      return response.data
    },

    /** `POST .../remove`, for the same reason `removeFinding` is. */
    async removeSpecification(
      recordId: string,
      specificationId: string,
      payload: NtsExpectedVersionPayload
    ): Promise<NtsVersionMutationResult> {
      const response = await api.post<ApiResponse<NtsVersionMutationResult>>(
        `${BASE}/records/${recordId}/specifications/${specificationId}/remove`,
        payload
      )
      return response.data
    }
  }
}
