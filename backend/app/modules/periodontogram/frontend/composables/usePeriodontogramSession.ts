/**
 * Session-edit composable for a single periodontogram snapshot.
 *
 * Wraps the PATCH / close / discard endpoints with a tiny debouncer
 * so per-cell edits coalesce into one network call per ~600ms.
 * `dirty` and `saving` flags drive the UI's autosave indicator.
 */

import { ref } from 'vue'
import type { PerioSite, PerioSnapshotDetail, PerioTooth, SiteCode } from '../types'

interface ApiResponse<T> {
  data: T
}

type ToothPatch = Partial<
  Pick<
    PerioTooth,
    | 'is_present'
    | 'is_implant'
    | 'mobility'
    | 'prognosis'
    | 'furcation_buccal'
    | 'furcation_lingual'
    | 'keratinized_gingiva_mm'
  >
>

type SitePatch = Partial<
  Pick<
    PerioSite,
    | 'probing_depth_mm'
    | 'gingival_margin_mm'
    | 'bleeding_on_probing'
    | 'plaque'
    | 'suppuration'
  >
>

const DEBOUNCE_MS = 600

export function usePeriodontogramSession() {
  const api = useApi()
  const saving = ref(false)
  const dirty = ref(false)
  const lastError = ref<string | null>(null)
  const pendingTimers = new Map<string, ReturnType<typeof setTimeout>>()
  const pendingPayloads = new Map<string, Record<string, unknown>>()
  // Multiple sites may save concurrently. An individual completed PATCH
  // must not mark the entire session as saved while others are pending.
  const inFlight = new Set<Promise<unknown>>()

  function syncSaveState(): void {
    saving.value = inFlight.size > 0
    dirty.value = pendingPayloads.size > 0 || inFlight.size > 0
  }

  async function trackedSave(operation: Promise<unknown>): Promise<void> {
    inFlight.add(operation)
    syncSaveState()
    try {
      await operation
    } catch (e) {
      lastError.value = e instanceof Error ? e.message : 'save_failed'
      throw e
    } finally {
      inFlight.delete(operation)
      syncSaveState()
    }
  }

  function _flushKey(key: string, exec: (payload: Record<string, unknown>) => Promise<void>) {
    return async () => {
      const payload = pendingPayloads.get(key)
      if (!payload) return
      pendingPayloads.delete(key)
      pendingTimers.delete(key)
      try {
        await trackedSave(exec(payload))
      } catch {
        // The error is stored by trackedSave and surfaced by the chart.
      }
    }
  }

  function _schedule(
    key: string,
    patch: Record<string, unknown>,
    exec: (payload: Record<string, unknown>) => Promise<void>
  ) {
    lastError.value = null
    dirty.value = true
    const merged = { ...(pendingPayloads.get(key) ?? {}), ...patch }
    pendingPayloads.set(key, merged)
    const prev = pendingTimers.get(key)
    if (prev) clearTimeout(prev)
    pendingTimers.set(key, setTimeout(_flushKey(key, exec), DEBOUNCE_MS))
  }

  function patchTooth(snapshotId: string, toothNumber: number, patch: ToothPatch) {
    _schedule(`tooth:${toothNumber}`, patch as Record<string, unknown>, async (payload) => {
      await api.patch<ApiResponse<PerioTooth>>(
        `/api/v1/periodontogram/snapshots/${snapshotId}/teeth/${toothNumber}`,
        payload
      )
    })
  }

  function patchSite(
    snapshotId: string,
    toothNumber: number,
    siteCode: SiteCode,
    patch: SitePatch
  ) {
    _schedule(
      `site:${toothNumber}:${siteCode}`,
      patch as Record<string, unknown>,
      async (payload) => {
        await api.patch<ApiResponse<PerioSite>>(
          `/api/v1/periodontogram/snapshots/${snapshotId}/teeth/${toothNumber}/sites/${siteCode}`,
          payload
        )
      }
    )
  }

  async function flushPending(snapshotId: string): Promise<void> {
    const timers = Array.from(pendingTimers.entries())
    for (const [key, timer] of timers) {
      clearTimeout(timer)
      pendingTimers.delete(key)
      const payload = pendingPayloads.get(key)
      if (!payload) continue
      pendingPayloads.delete(key)
      try {
        if (key.startsWith('tooth:')) {
          const toothNumber = Number(key.slice('tooth:'.length))
          await trackedSave(api.patch(
            `/api/v1/periodontogram/snapshots/${snapshotId}/teeth/${toothNumber}`,
            payload
          ))
        } else if (key.startsWith('site:')) {
          const [, toothStr, siteCode] = key.split(':')
          await trackedSave(api.patch(
            `/api/v1/periodontogram/snapshots/${snapshotId}/teeth/${toothStr}/sites/${siteCode}`,
            payload
          ))
        }
      } catch {
        // trackedSave captured the error; closing must not lose a failed edit.
      }
    }
    // A previously started debounce timer may already be saving: don't close
    // the snapshot until every in-flight write has settled.
    await Promise.allSettled(Array.from(inFlight))
    syncSaveState()
    if (lastError.value) throw new Error(lastError.value)
  }

  async function closeSession(snapshotId: string, notes?: string): Promise<PerioSnapshotDetail> {
    saving.value = true
    try {
      const response = await api.post<ApiResponse<PerioSnapshotDetail>>(
        `/api/v1/periodontogram/snapshots/${snapshotId}/close`,
        { notes: notes ?? null }
      )
      dirty.value = false
      return response.data
    } finally {
      saving.value = false
    }
  }

  async function discardDraft(snapshotId: string): Promise<void> {
    saving.value = true
    try {
      await api.del(`/api/v1/periodontogram/snapshots/${snapshotId}`)
      dirty.value = false
    } finally {
      saving.value = false
    }
  }

  return {
    saving,
    dirty,
    lastError,
    patchTooth,
    patchSite,
    flushPending,
    closeSession,
    discardDraft
  }
}
