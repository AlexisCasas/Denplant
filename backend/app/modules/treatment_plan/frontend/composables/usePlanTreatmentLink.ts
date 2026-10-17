/**
 * DP-08.B1 (F6) — safe association of a created Treatment to a Plan.
 *
 * The caller has already created the Treatment (that call is NOT repeated
 * here). This composable only ever (re)tries the association with the SAME
 * `treatment_id`; the backend `POST /items` is idempotent (201 first time,
 * 200 for a repeat in the same Plan, 409 for another Plan / locked Plan).
 *
 * Rules enforced here:
 *  - never report success unless the item is confirmed (POST ok, or a GET of
 *    the real Plan state shows the item — covers lost HTTP responses);
 *  - never create a second treatment to "fix" the first;
 *  - never delete an orphan treatment automatically;
 *  - undo of a Plan-linked treatment goes through the Plan's item DELETE
 *    (orphan / session / budget rules), never `DELETE /odontogram/treatments`.
 */
import type { ApiResponse, PlannedTreatmentItem, TreatmentPlanDetail } from '~~/app/types'
import {
  classifyAddItemError,
  findPlanItemByTreatment,
  isRetryable,
  planBlockReason,
  type PlanLinkFailureReason
} from '../utils/planTreatmentLink'

export interface PlanLinkPending {
  planId: string
  treatmentId: string
  label?: string
  reason: PlanLinkFailureReason
  canRetry: boolean
}

export type PlanLinkResult
  = | { ok: true, recovered: boolean, item: PlannedTreatmentItem | null }
    | { ok: false, reason: PlanLinkFailureReason }

export type PlanRemoveResult
  = | { outcome: 'removed' }
    | { outcome: 'not_linked' } // no PlannedTreatmentItem: caller may use the standalone flow
    | { outcome: 'blocked', reason: 'locked' | 'closed' | 'plan_missing' }
    | { outcome: 'failed' }

export type PlanCreateLinkResult
  = | { status: 'linked', treatmentId: string, recovered: boolean }
    | { status: 'blocked', reason: 'locked' | 'closed' | 'plan_missing' } // nothing was created
    | { status: 'create_failed' } // createTreatment already reported its own error
    | { status: 'unlinked', treatmentId: string, reason: PlanLinkFailureReason } // created, NOT in the Plan

const base = (planId: string) => `/api/v1/treatment_plan/treatment-plans/${planId}`

export function usePlanTreatmentLink() {
  const api = useApi()
  const toast = useToast()
  const { t } = useI18n()
  const pending = ref<PlanLinkPending | null>(null)
  const busy = ref(false)

  async function fetchPlan(planId: string): Promise<TreatmentPlanDetail | 'missing' | null> {
    try {
      const res = await api.get<ApiResponse<TreatmentPlanDetail>>(base(planId))
      return res.data
    } catch (error) {
      const status = (error as { statusCode?: number })?.statusCode
      return status === 404 ? 'missing' : null
    }
  }

  /** Preflight before creating a Treatment. Backend stays the authority. */
  async function checkPlanEditable(planId: string): Promise<{ ok: true } | { ok: false, reason: 'locked' | 'closed' | 'plan_missing' }> {
    const plan = await fetchPlan(planId)
    if (plan === 'missing') return { ok: false, reason: 'plan_missing' }
    if (plan === null) return { ok: true } // unknown: let the server decide
    const block = planBlockReason(plan)
    return block ? { ok: false, reason: block } : { ok: true }
  }

  /** Reads the real Plan state to settle an association whose outcome is unclear. */
  async function reconcile(planId: string, treatmentId: string): Promise<PlanLinkResult | null> {
    const plan = await fetchPlan(planId)
    if (plan === 'missing') return { ok: false, reason: 'plan_missing' }
    if (plan === null) return null
    const item = findPlanItemByTreatment(plan, treatmentId) as PlannedTreatmentItem | null
    if (item) return { ok: true, recovered: true, item }
    const block = planBlockReason(plan)
    if (block) return { ok: false, reason: block }
    return null
  }

  async function post(planId: string, treatmentId: string): Promise<PlanLinkResult> {
    try {
      const res = await api.post<ApiResponse<PlannedTreatmentItem>>(
        `${base(planId)}/items`,
        { treatment_id: treatmentId }
      )
      return { ok: true, recovered: false, item: res.data }
    } catch (error) {
      // The response may have been lost after the server committed: the Plan
      // is the source of truth, not the exception.
      const settled = await reconcile(planId, treatmentId)
      if (settled) return settled
      return { ok: false, reason: classifyAddItemError(error) }
    }
  }

  /** Associates `treatmentId` with the Plan; records a pending notice on failure. */
  async function attach(planId: string, treatmentId: string, label?: string): Promise<PlanLinkResult> {
    busy.value = true
    try {
      const result = await post(planId, treatmentId)
      if (result.ok) {
        if (pending.value?.treatmentId === treatmentId) pending.value = null
      } else {
        setPending({ planId, treatmentId, label, reason: result.reason })
      }
      return result
    } finally {
      busy.value = false
    }
  }

  function setPending(p: { planId: string, treatmentId: string, label?: string, reason: PlanLinkFailureReason }) {
    pending.value = { ...p, canRetry: isRetryable(p.reason) }
  }

  /** Retry with the same treatment_id, after re-reading the real Plan state. */
  async function retry(): Promise<PlanLinkResult | null> {
    const p = pending.value
    if (!p || busy.value) return null
    busy.value = true
    try {
      const plan = await fetchPlan(p.planId)
      if (plan === 'missing') {
        setPending({ ...p, reason: 'plan_missing' })
        return { ok: false, reason: 'plan_missing' }
      }
      if (plan) {
        const existing = findPlanItemByTreatment(plan, p.treatmentId) as PlannedTreatmentItem | null
        if (existing) {
          pending.value = null
          return { ok: true, recovered: true, item: existing }
        }
        const block = planBlockReason(plan)
        if (block) {
          setPending({ ...p, reason: block })
          return { ok: false, reason: block }
        }
      }
      const result = await post(p.planId, p.treatmentId)
      if (result.ok) pending.value = null
      else setPending({ ...p, reason: result.reason })
      return result
    } finally {
      busy.value = false
    }
  }

  /**
   * Shared create→associate flow for single, multi-tooth, whole-mouth and
   * per-arch creation: (1) preflight the Plan, (2) create the Treatment once,
   * (3) associate it. A failure at (3) keeps `treatmentId` in `pending` for
   * recovery; the Treatment is never recreated nor deleted automatically.
   */
  async function createAndLink(
    planId: string,
    create: () => Promise<{ id: string } | null>,
    label?: string
  ): Promise<PlanCreateLinkResult> {
    const gate = await checkPlanEditable(planId)
    if (!gate.ok) return { status: 'blocked', reason: gate.reason }
    const created = await create()
    if (!created) return { status: 'create_failed' }
    return linkCreated(planId, created.id, label)
  }

  /** Association step only, for flows where the Treatment already exists (global bar). */
  async function linkCreated(planId: string, treatmentId: string, label?: string): Promise<PlanCreateLinkResult> {
    const result = await attach(planId, treatmentId, label)
    return result.ok
      ? { status: 'linked', treatmentId, recovered: result.recovered }
      : { status: 'unlinked', treatmentId, reason: result.reason }
  }

  /** Closes the notice. The treatment is left untouched (never deleted here). */
  function dismiss() {
    pending.value = null
  }

  /**
   * Removes the Plan item that wraps `treatmentId`, via the Plan's own item
   * DELETE so orphan / session / budget rules apply. The caller must NOT call
   * the odontogram DELETE when the outcome is `blocked` or `failed`.
   */
  async function removeFromPlan(planId: string, treatmentId: string): Promise<PlanRemoveResult> {
    const plan = await fetchPlan(planId)
    if (plan === 'missing') return { outcome: 'blocked', reason: 'plan_missing' }
    if (plan === null) return { outcome: 'failed' }
    const item = findPlanItemByTreatment(plan, treatmentId)
    if (!item) return { outcome: 'not_linked' }
    const block = planBlockReason(plan)
    if (block) return { outcome: 'blocked', reason: block }
    try {
      await api.del(`${base(planId)}/items/${item.id}`)
      return { outcome: 'removed' }
    } catch {
      // Ambiguous failure: confirm against the Plan before claiming anything.
      const after = await fetchPlan(planId)
      if (after && after !== 'missing' && !findPlanItemByTreatment(after, treatmentId)) {
        return { outcome: 'removed' }
      }
      return { outcome: 'failed' }
    }
  }

  /** Explains why the Plan cannot take / release a treatment (never a success tone). */
  function explain(reason: PlanLinkFailureReason | 'plan_missing') {
    toast.add({
      title: t('treatmentPlans.linkRecovery.blockedTitle'),
      description: t(`treatmentPlans.linkRecovery.reason.${reason}`),
      color: 'warning'
    })
  }

  function notifyLinked(recovered = false) {
    toast.add({
      title: t(recovered ? 'treatmentPlans.linkRecovery.recovered' : 'treatmentPlans.linkRecovery.added'),
      color: 'success'
    })
  }

  /** Undo/delete messages for the non-removed outcomes. */
  function explainRemove(result: PlanRemoveResult) {
    if (result.outcome === 'blocked') {
      toast.add({
        title: t('treatmentPlans.linkRecovery.undoBlockedTitle'),
        description: t(`treatmentPlans.linkRecovery.reason.${result.reason}`),
        color: 'warning'
      })
    } else if (result.outcome === 'not_linked') {
      toast.add({ title: t('treatmentPlans.linkRecovery.alreadyRemoved'), color: 'neutral' })
    } else if (result.outcome === 'failed') {
      toast.add({ title: t('errors.deleteFailed'), color: 'error' })
    }
  }

  return { pending, busy, explain, notifyLinked, explainRemove, checkPlanEditable, attach, createAndLink, linkCreated, retry, dismiss, setPending, removeFromPlan }
}
