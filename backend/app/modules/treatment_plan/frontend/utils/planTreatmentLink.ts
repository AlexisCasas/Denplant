/**
 * DP-08.B1 (F6) — pure rules for linking a freshly created Treatment to a
 * treatment plan. No I/O here so the decisions are unit-testable.
 */

export type PlanLinkFailureReason
  = | 'locked' // plan frozen by a sent/accepted budget
    | 'closed' // plan is completed / closed
    | 'other_plan' // treatment already belongs to a different plan
    | 'plan_missing' // plan no longer exists / not visible
    | 'invalid' // backend rejected the treatment (wrong clinic/patient/...)
    | 'unverified' // the Plan state could not be read (403 / 5xx / timeout / network): fail-closed
    | 'error' // transient: network / 5xx, outcome unknown

/** Reasons for which retrying can never succeed without user action elsewhere. */
export const NON_RETRYABLE_REASONS: readonly PlanLinkFailureReason[] = [
  'locked', 'closed', 'other_plan', 'plan_missing', 'invalid'
]

export const EDITABLE_PLAN_STATUSES = ['draft', 'pending', 'active'] as const

interface PlanLike {
  status?: string | null
  budget_id?: string | null
  budget?: { status?: string | null } | null
  items?: Array<{ id: string, treatment_id?: string | null }> | null
}

/** Mirrors backend `_is_plan_locked`: only a sent/accepted budget freezes a plan. */
export function isPlanLocked(plan: PlanLike): boolean {
  if (!plan.budget_id) return false
  const status = plan.budget?.status
  return status === 'sent' || status === 'accepted'
}

/** Returns why the plan cannot take new items, or null when it is editable. */
export function planBlockReason(plan: PlanLike): 'closed' | 'locked' | null {
  if (!plan.status || !(EDITABLE_PLAN_STATUSES as readonly string[]).includes(plan.status)) {
    return 'closed'
  }
  return isPlanLocked(plan) ? 'locked' : null
}

export function findPlanItemByTreatment(plan: PlanLike, treatmentId: string) {
  return plan.items?.find(i => i.treatment_id === treatmentId) ?? null
}

interface HttpErrorLike {
  statusCode?: number
  status?: number
  data?: { code?: string, message?: string, detail?: unknown } | null
}

export function errorStatus(error: unknown): number | undefined {
  const e = error as HttpErrorLike | null
  return e?.statusCode ?? e?.status
}

export function errorCode(error: unknown): string | undefined {
  const e = error as HttpErrorLike | null
  const code = e?.data?.code
  return typeof code === 'string' ? code : undefined
}

/** Classifies a failed `POST /items` by status + structured code (never by message text). */
export function classifyAddItemError(error: unknown): PlanLinkFailureReason {
  const status = errorStatus(error)
  const code = errorCode(error)
  if (status === 409 && code === 'plan_locked') return 'locked'
  if (status === 409 && code === 'treatment_already_planned') return 'other_plan'
  if (status === 409) return 'locked'
  if (status === 404) return 'plan_missing'
  if (status === 400 || status === 422) return 'invalid'
  return 'error'
}

export function isRetryable(reason: PlanLinkFailureReason): boolean {
  return !NON_RETRYABLE_REASONS.includes(reason)
}
