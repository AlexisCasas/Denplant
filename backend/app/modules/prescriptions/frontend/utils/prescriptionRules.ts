/**
 * Who may write prescriptions, as the backend decides it.
 *
 * The permission is not the rule. `admin` carries the wildcard `*`, which
 * matches `prescriptions.prescribe` and `prescriptions.void`, so the UI also
 * needs the **role of the current clinic membership** (`useAuth().currentRole`,
 * from `/auth/me` -> `clinics[0].role`). It is never inferred from permissions,
 * a wildcard, a professional id or the ClinicalTab's `readonly` flag.
 *
 * These mirror `PrescriptionService.require_eligible_prescriber` and
 * `PrescriptionService.void`. The backend still decides on every request.
 */

export type IssueAccess = 'hidden' | 'missing-professional-id' | 'allowed'

export interface IssueFacts {
  hasPrescribePermission: boolean
  role: string | null
  professionalId: string | null | undefined
}

/**
 * `hidden`                   not a dentist, or no permission: show nothing.
 * `missing-professional-id`  a dentist with no registration number: show the
 *                            action disabled, with the reason.
 * `allowed`                  may issue.
 */
export function issueAccess(facts: IssueFacts): IssueAccess {
  if (!facts.hasPrescribePermission || facts.role !== 'dentist') return 'hidden'
  return (facts.professionalId ?? '').trim() ? 'allowed' : 'missing-professional-id'
}

export interface VoidFacts {
  hasVoidPermission: boolean
  role: string | null
  userId: string | null | undefined
  prescriberUserId: string
  status: string
}

/** Only an issued prescription, by an admin or by the dentist who wrote it. */
export function canVoid(facts: VoidFacts): boolean {
  if (!facts.hasVoidPermission || facts.status !== 'issued') return false
  if (facts.role === 'admin') return true
  return facts.role === 'dentist' && !!facts.userId && facts.userId === facts.prescriberUserId
}

/**
 * Whether the patient's cached record (the one the patient page already holds)
 * says there is no date of birth. `false` when the cache is not available: that
 * is uncertainty, not a "no", and the backend decides.
 */
export function dateOfBirthMissing(cached: { date_of_birth?: string | null } | null | undefined): boolean {
  if (!cached || typeof cached !== 'object') return false
  return !cached.date_of_birth
}
