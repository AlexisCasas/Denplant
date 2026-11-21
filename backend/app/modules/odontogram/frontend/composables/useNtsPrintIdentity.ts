/**
 * useNtsPrintIdentity — the patient's name and document, without asking again.
 *
 * The printed odontogram carries a small DenPlant header so a loose sheet can
 * be matched back to a person. The odontogram shell does not have those
 * fields: it is handed a `patientId` and nothing else, five components deep
 * from the page that owns the patient.
 *
 * That page has already fetched them. `patients/[id].vue` runs
 * `useAsyncData('patient:' + patientId, …)` and the result sits in Nuxt's
 * payload cache under that key, so `useNuxtData` reads it back with **no
 * request**. This is the reason the header costs nothing: it is not a second
 * source of patient data, it is the same one.
 *
 * Two things it deliberately does not do:
 *
 * * **It never fetches.** If the cache is empty — the shell mounted outside
 *   the patient page, or a test harness with no payload — the identity is
 *   `null` and the header omits itself. A print view is not a reason to start
 *   loading patient records, and a half-rendered header that fills in a moment
 *   later would be a page that prints differently depending on timing.
 * * **It never widens.** `toPrintPatient` reduces whatever the cache holds to
 *   three fields. The full `PatientExtended` carries sex, date of birth,
 *   address and more; none of it reaches the page.
 *
 * Reading `patients` data here is within the module contract: odontogram
 * declares `depends: ["patients", "catalog"]`.
 */

import type { NtsPrintPatient, NtsPrintPatientSource } from '../utils/ntsPrintModel'
import { toPrintPatient } from '../utils/ntsPrintModel'

/** The cache key `patients/[id].vue` publishes its `useAsyncData` under. */
export function patientCacheKey(patientId: string): string {
  return `patient:${patientId}`
}

export function useNtsPrintIdentity(patientId: () => string) {
  /**
   * Re-read on every change of patient.
   *
   * `useNuxtData` is a lookup into the payload cache, not a request, so
   * calling it per patient id is cheap and keeps the identity honest when the
   * route moves to another patient.
   */
  const identity = computed<NtsPrintPatient | null>(() => {
    const id = patientId()
    if (!id) return null
    const cached = useNuxtData<NtsPrintPatientSource | null>(patientCacheKey(id))
    return toPrintPatient(cached.data.value)
  })

  return { identity }
}
