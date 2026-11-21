/**
 * useOdontogramProfile - user + clinic odontogram format preference (NTS-02)
 *
 * Reads and persists the preference created in NTS-01
 * (`GET/PUT /api/v1/odontogram/preferences`). The backend derives
 * `user_id` / `clinic_id` from the authenticated context, so nothing is
 * sent in the payload beyond the profile itself.
 *
 * The backend is the single source of truth: state here is an in-memory
 * reactive cache only — deliberately NOT mirrored into localStorage, which
 * would become a competing source of truth across clinics and devices.
 */

import type { ApiResponse } from '~~/app/types'
import type { OdontogramProfile } from '~~/app/config/odontogramConstants'
import { DEFAULT_ODONTOGRAM_PROFILE } from '~~/app/config/odontogramConstants'

interface OdontogramPreferencePayload {
  profile: OdontogramProfile
}

export function useOdontogramProfile() {
  const api = useApi()
  const toast = useToast()
  const { t } = useI18n()
  const { currentClinic } = useClinicState()

  // ============================================================================
  // State — shared app-wide so the selector and the mount point agree without
  // each one issuing its own GET.
  // ============================================================================

  const profile = useState<OdontogramProfile>(
    'odontogram:profile',
    () => DEFAULT_ODONTOGRAM_PROFILE
  )
  /** False until the first fetch settles — used to avoid flashing the wrong renderer. */
  const isLoaded = useState<boolean>('odontogram:profile:loaded', () => false)
  const loading = useState<boolean>('odontogram:profile:loading', () => false)
  const error = useState<string | null>('odontogram:profile:error', () => null)
  /** Clinic the cached value belongs to; guards against reusing another clinic's choice. */
  const loadedForClinicId = useState<string | null>('odontogram:profile:clinic', () => null)

  // ============================================================================
  // Actions
  // ============================================================================

  /** Fetch the stored preference. Falls back to the default on failure. */
  async function fetchProfile(): Promise<OdontogramProfile> {
    loading.value = true
    error.value = null
    try {
      const response = await api.get<ApiResponse<OdontogramPreferencePayload>>(
        '/api/v1/odontogram/preferences'
      )
      profile.value = response.data.profile
      loadedForClinicId.value = currentClinic.value?.id ?? null
      return profile.value
    } catch (e) {
      console.error('Error fetching odontogram profile:', e)
      error.value = 'loadFailed'
      // A failed read must not strand the clinician: fall back to the
      // original chart, which is what an absent preference means anyway.
      profile.value = DEFAULT_ODONTOGRAM_PROFILE
      return profile.value
    } finally {
      loading.value = false
      isLoaded.value = true
    }
  }

  /** Fetch once per clinic; re-fetches when the clinic context changes. */
  async function ensureLoaded(): Promise<void> {
    const clinicId = currentClinic.value?.id ?? null
    if (isLoaded.value && loadedForClinicId.value === clinicId) return
    await fetchProfile()
  }

  /**
   * Persist a new profile. The local value changes only after the PUT
   * succeeds, so the selector can never drift from the backend.
   */
  async function setProfile(next: OdontogramProfile): Promise<boolean> {
    if (next === profile.value) return true
    loading.value = true
    error.value = null
    try {
      const response = await api.put<ApiResponse<OdontogramPreferencePayload>>(
        '/api/v1/odontogram/preferences',
        { profile: next }
      )
      profile.value = response.data.profile
      loadedForClinicId.value = currentClinic.value?.id ?? null
      return true
    } catch (e) {
      console.error('Error updating odontogram profile:', e)
      error.value = 'updateFailed'
      toast.add({
        title: t('common.error'),
        description: t('odontogram.profile.updateError'),
        color: 'error'
      })
      // Previous value is intentionally left untouched — renderer and
      // backend stay in sync.
      return false
    } finally {
      loading.value = false
    }
  }

  // ============================================================================
  // Clinic-switch invalidation
  //
  // The app is single-clinic per session today (`useClinic.fetchClinic` takes
  // the first membership and there is no switcher), so this is a
  // forward-looking guard that reuses the existing clinic state instead of
  // introducing a second context mechanism. Wired exactly once app-wide —
  // same `useState` flag pattern as `useAppointments`' notes indicator — so
  // N mounted consumers don't trigger N refetches on a switch.
  // ============================================================================

  if (import.meta.client) {
    const wired = useState<boolean>('odontogram:profile:clinic-watch-wired', () => false)
    if (!wired.value) {
      wired.value = true
      watch(
        () => currentClinic.value?.id ?? null,
        (clinicId, previous) => {
          if (clinicId === previous) return
          isLoaded.value = false
          loadedForClinicId.value = null
          profile.value = DEFAULT_ODONTOGRAM_PROFILE
          if (clinicId) void fetchProfile()
        }
      )
    }
  }

  function reset(): void {
    profile.value = DEFAULT_ODONTOGRAM_PROFILE
    isLoaded.value = false
    loading.value = false
    error.value = null
    loadedForClinicId.value = null
  }

  return {
    // State
    profile,
    isLoaded,
    loading,
    error,

    // Actions
    fetchProfile,
    ensureLoaded,
    setProfile,
    reset
  }
}
