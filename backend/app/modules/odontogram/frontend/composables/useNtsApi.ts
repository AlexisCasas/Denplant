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
  NtsCatalog,
  NtsCatalogVersions,
  NtsDiscardPayload,
  NtsDraftCreatePayload,
  NtsErrorCode,
  NtsExpectedVersionPayload,
  NtsRecord,
  NtsRecordSummary
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
    }
  }
}
