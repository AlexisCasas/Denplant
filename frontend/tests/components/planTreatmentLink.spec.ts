/**
 * DP-08.B1 (F6) — safe association of a created Treatment to a Plan.
 *
 * Drives the real shared composable against a tiny in-memory fake of the
 * Plan API (GET plan, POST /items, DELETE /items/{id}) so every scenario is
 * decided by the Plan's real state, not by the mocked exception.
 */
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import PlanLinkRecoveryNotice from '../../../backend/app/modules/treatment_plan/frontend/components/clinical/PlanLinkRecoveryNotice.vue'
import { usePlanTreatmentLink } from '../../../backend/app/modules/treatment_plan/frontend/composables/usePlanTreatmentLink'
import {
  classifyAddItemError,
  isPlanLocked,
  planBlockReason
} from '../../../backend/app/modules/treatment_plan/frontend/utils/planTreatmentLink'

const MODULES = resolve(process.cwd(), '../backend/app/modules')
const read = (rel: string) => readFileSync(resolve(MODULES, rel), 'utf8')
const locale = (code: string) =>
  JSON.parse(readFileSync(resolve(process.cwd(), 'i18n/locales', `${code}.json`), 'utf8'))

const fake = vi.hoisted(() => {
  const s = {
    plan: null as null | {
      id: string
      status: string
      budget_id: string | null
      budget: { status: string } | null
      items: Array<{ id: string, treatment_id: string }>
    },
    getFails: false,
    // 'ok' | 'lost' (server commits, response lost) | 409 codes | 'network'
    postMode: 'ok' as string,
    deleteMode: 'ok' as string,
    calls: [] as string[],
    toasts: [] as Array<Record<string, unknown>>
  }
  return s
})

const httpError = (statusCode: number, code?: string) =>
  Object.assign(new Error(`HTTP ${statusCode}`), { statusCode, data: code ? { code } : {} })

mockNuxtImport('useApi', () => () => ({
  get: async (path: string) => {
    fake.calls.push(`GET ${path}`)
    if (fake.getFails) throw Object.assign(new Error('network'), {})
    if (!fake.plan) throw httpError(404)
    return { data: JSON.parse(JSON.stringify(fake.plan)) }
  },
  post: async (path: string, body: { treatment_id: string }) => {
    fake.calls.push(`POST ${path} ${body.treatment_id}`)
    const plan = fake.plan!
    const existing = plan.items.find(i => i.treatment_id === body.treatment_id)
    if (fake.postMode === 'network') throw Object.assign(new Error('network'), {})
    if (fake.postMode === 'plan_locked') throw httpError(409, 'plan_locked')
    if (fake.postMode === 'treatment_already_planned') throw httpError(409, 'treatment_already_planned')
    if (fake.postMode === 'invalid') throw httpError(400)
    const item = existing ?? { id: `item-${plan.items.length + 1}`, treatment_id: body.treatment_id }
    if (!existing) plan.items.push(item)
    if (fake.postMode === 'lost') throw Object.assign(new Error('timeout'), {})
    return { data: item }
  },
  del: async (path: string) => {
    fake.calls.push(`DELETE ${path}`)
    const id = path.split('/').pop()
    if (fake.deleteMode === 'fail') throw httpError(500)
    if (fake.deleteMode === 'lost') {
      fake.plan!.items = fake.plan!.items.filter(i => i.id !== id)
      throw Object.assign(new Error('timeout'), {})
    }
    fake.plan!.items = fake.plan!.items.filter(i => i.id !== id)
  }
}))
mockNuxtImport('useToast', () => () => ({ add: (t: Record<string, unknown>) => fake.toasts.push(t) }))
mockNuxtImport('useI18n', () => () => ({
  t: (key: string) => {
    let node: unknown = locale('es')
    for (const part of key.split('.')) {
      node = node && typeof node === 'object' ? (node as Record<string, unknown>)[part] : undefined
    }
    return typeof node === 'string' ? node : key
  },
  locale: { value: 'es' }
}))

const PLAN = 'plan-1'
const posts = () => fake.calls.filter(c => c.startsWith('POST'))
const dels = () => fake.calls.filter(c => c.startsWith('DELETE'))

beforeEach(() => {
  fake.plan = { id: PLAN, status: 'draft', budget_id: null, budget: null, items: [] }
  fake.getFails = false
  fake.postMode = 'ok'
  fake.deleteMode = 'ok'
  fake.calls = []
  fake.toasts = []
})

describe('DP-08.B1 — reglas puras', () => {
  it('mirrors the backend lock predicate and terminal states', () => {
    expect(isPlanLocked({ budget_id: 'b', budget: { status: 'sent' } })).toBe(true)
    expect(isPlanLocked({ budget_id: 'b', budget: { status: 'accepted' } })).toBe(true)
    expect(isPlanLocked({ budget_id: 'b', budget: { status: 'cancelled' } })).toBe(false)
    expect(isPlanLocked({ budget_id: null })).toBe(false)
    expect(planBlockReason({ status: 'completed' })).toBe('closed')
    expect(planBlockReason({ status: 'closed' })).toBe('closed')
    expect(planBlockReason({ status: 'active', budget_id: 'b', budget: { status: 'accepted' } })).toBe('locked')
    expect(planBlockReason({ status: 'draft' })).toBeNull()
  })

  it('classifies errors by status + structured code, never by message text', () => {
    expect(classifyAddItemError(httpError(409, 'plan_locked'))).toBe('locked')
    expect(classifyAddItemError(httpError(409, 'treatment_already_planned'))).toBe('other_plan')
    expect(classifyAddItemError(httpError(400))).toBe('invalid')
    expect(classifyAddItemError(httpError(404))).toBe('plan_missing')
    expect(classifyAddItemError(new Error('boom'))).toBe('error')
  })
})

describe('DP-08.B1 — asociación segura (createAndLink)', () => {
  it('normal success: preflight, one create, one POST, no pending notice', async () => {
    const link = usePlanTreatmentLink()
    const create = vi.fn(async () => ({ id: 't1' }))
    const r = await link.createAndLink(PLAN, create)
    expect(r).toEqual({ status: 'linked', treatmentId: 't1', recovered: false })
    expect(create).toHaveBeenCalledTimes(1)
    expect(posts()).toHaveLength(1)
    expect(link.pending.value).toBeNull()
  })

  it('association error: keeps treatment_id for recovery, no success, no new treatment', async () => {
    fake.postMode = 'network'
    const link = usePlanTreatmentLink()
    const create = vi.fn(async () => ({ id: 't1' }))
    const r = await link.createAndLink(PLAN, create, 'Corona')
    expect(r).toEqual({ status: 'unlinked', treatmentId: 't1', reason: 'error' })
    expect(link.pending.value).toMatchObject({ planId: PLAN, treatmentId: 't1', label: 'Corona', canRetry: true })
    expect(create).toHaveBeenCalledTimes(1)
    expect(fake.plan!.items).toHaveLength(0)
  })

  it('retry reuses the SAME treatment_id and never creates another treatment', async () => {
    fake.postMode = 'network'
    const link = usePlanTreatmentLink()
    const create = vi.fn(async () => ({ id: 't1' }))
    await link.createAndLink(PLAN, create)
    fake.postMode = 'ok'
    fake.calls = []
    const r = await link.retry()
    expect(r).toMatchObject({ ok: true })
    expect(posts()).toEqual([`POST /api/v1/treatment_plan/treatment-plans/${PLAN}/items t1`])
    expect(create).toHaveBeenCalledTimes(1)
    expect(fake.plan!.items).toHaveLength(1)
    expect(link.pending.value).toBeNull()
  })

  it('lost response with the association already committed: acknowledged without re-inserting', async () => {
    fake.postMode = 'lost'
    const link = usePlanTreatmentLink()
    const r = await link.createAndLink(PLAN, async () => ({ id: 't1' }))
    expect(r).toEqual({ status: 'linked', treatmentId: 't1', recovered: true })
    expect(posts()).toHaveLength(1)
    expect(fake.plan!.items).toHaveLength(1)
    expect(link.pending.value).toBeNull()
  })

  it('retry finds the item already linked (e.g. late commit) and does not POST again', async () => {
    fake.postMode = 'network'
    const link = usePlanTreatmentLink()
    await link.createAndLink(PLAN, async () => ({ id: 't1' }))
    fake.plan!.items.push({ id: 'item-9', treatment_id: 't1' }) // committed meanwhile
    fake.calls = []
    const r = await link.retry()
    expect(r).toMatchObject({ ok: true, recovered: true })
    expect(posts()).toHaveLength(0)
    expect(fake.plan!.items).toHaveLength(1)
  })

  it('Plan locked BEFORE creating: nothing is created', async () => {
    fake.plan!.status = 'active'
    fake.plan!.budget_id = 'b1'
    fake.plan!.budget = { status: 'accepted' }
    const link = usePlanTreatmentLink()
    const create = vi.fn(async () => ({ id: 't1' }))
    const r = await link.createAndLink(PLAN, create)
    expect(r).toEqual({ status: 'blocked', reason: 'locked' })
    expect(create).not.toHaveBeenCalled()
    expect(posts()).toHaveLength(0)
  })

  it('Plan closed BEFORE creating: nothing is created', async () => {
    fake.plan!.status = 'closed'
    const link = usePlanTreatmentLink()
    const create = vi.fn(async () => ({ id: 't1' }))
    expect(await link.createAndLink(PLAN, create)).toEqual({ status: 'blocked', reason: 'closed' })
    expect(create).not.toHaveBeenCalled()
  })

  it('Plan locked AFTER creating: unlinked, explained, not retryable, treatment kept', async () => {
    const link = usePlanTreatmentLink()
    const r = await link.createAndLink(PLAN, async () => {
      // the budget is sent while the user was creating
      fake.plan!.status = 'active'
      fake.plan!.budget_id = 'b1'
      fake.plan!.budget = { status: 'sent' }
      fake.postMode = 'plan_locked'
      return { id: 't1' }
    })
    expect(r).toEqual({ status: 'unlinked', treatmentId: 't1', reason: 'locked' })
    expect(link.pending.value).toMatchObject({ treatmentId: 't1', canRetry: false })
    expect(dels()).toHaveLength(0) // never auto-deleted
  })

  it('retry re-reads the Plan: locked meanwhile → no POST, reason updated, retry disabled', async () => {
    fake.postMode = 'network'
    const link = usePlanTreatmentLink()
    await link.createAndLink(PLAN, async () => ({ id: 't1' }))
    fake.plan!.status = 'active'
    fake.plan!.budget_id = 'b1'
    fake.plan!.budget = { status: 'accepted' }
    fake.calls = []
    const r = await link.retry()
    expect(r).toEqual({ ok: false, reason: 'locked' })
    expect(posts()).toHaveLength(0)
    expect(link.pending.value).toMatchObject({ reason: 'locked', canRetry: false })
  })

  it('treatment linked to ANOTHER plan: explained, never retryable', async () => {
    fake.postMode = 'treatment_already_planned'
    const link = usePlanTreatmentLink()
    const r = await link.createAndLink(PLAN, async () => ({ id: 't1' }))
    expect(r).toEqual({ status: 'unlinked', treatmentId: 't1', reason: 'other_plan' })
    expect(link.pending.value?.canRetry).toBe(false)
  })

  it('create failure: nothing to associate, no pending notice', async () => {
    const link = usePlanTreatmentLink()
    expect(await link.createAndLink(PLAN, async () => null)).toEqual({ status: 'create_failed' })
    expect(posts()).toHaveLength(0)
    expect(link.pending.value).toBeNull()
  })

  it('dismiss closes the notice without deleting the treatment', async () => {
    fake.postMode = 'network'
    const link = usePlanTreatmentLink()
    await link.createAndLink(PLAN, async () => ({ id: 't1' }))
    link.dismiss()
    expect(link.pending.value).toBeNull()
    expect(dels()).toHaveLength(0)
  })

  it('global/arch flow: linkCreated associates an existing treatment once', async () => {
    const link = usePlanTreatmentLink()
    expect(await link.linkCreated(PLAN, 'g1')).toMatchObject({ status: 'linked' })
    expect(posts()).toHaveLength(1)
  })
})

describe('DP-08.B1 — deshacer / eliminar con Plan (removeFromPlan)', () => {
  it('undo of an associated treatment goes through the Plan item DELETE', async () => {
    fake.plan!.items.push({ id: 'item-1', treatment_id: 't1' })
    const link = usePlanTreatmentLink()
    expect(await link.removeFromPlan(PLAN, 't1')).toEqual({ outcome: 'removed' })
    expect(dels()).toEqual([`DELETE /api/v1/treatment_plan/treatment-plans/${PLAN}/items/item-1`])
    expect(dels().some(d => d.includes('/odontogram/'))).toBe(false)
  })

  it('locked Plan blocks the undo and nothing is deleted', async () => {
    fake.plan!.items.push({ id: 'item-1', treatment_id: 't1' })
    fake.plan!.status = 'active'
    fake.plan!.budget_id = 'b'
    fake.plan!.budget = { status: 'sent' }
    const link = usePlanTreatmentLink()
    expect(await link.removeFromPlan(PLAN, 't1')).toEqual({ outcome: 'blocked', reason: 'locked' })
    expect(dels()).toHaveLength(0)
  })

  it('no PlannedTreatmentItem: reports not_linked and issues no DELETE itself', async () => {
    const link = usePlanTreatmentLink()
    expect(await link.removeFromPlan(PLAN, 't1')).toEqual({ outcome: 'not_linked' })
    expect(dels()).toHaveLength(0)
  })

  it('failed delete is not success; a lost response is confirmed against the Plan', async () => {
    fake.plan!.items.push({ id: 'item-1', treatment_id: 't1' })
    fake.deleteMode = 'fail'
    const link = usePlanTreatmentLink()
    expect(await link.removeFromPlan(PLAN, 't1')).toEqual({ outcome: 'failed' })
    fake.deleteMode = 'lost'
    expect(await link.removeFromPlan(PLAN, 't1')).toEqual({ outcome: 'removed' })
  })

  it('explainRemove never uses a success tone', async () => {
    const link = usePlanTreatmentLink()
    link.explainRemove({ outcome: 'blocked', reason: 'locked' })
    link.explainRemove({ outcome: 'failed' })
    link.explainRemove({ outcome: 'not_linked' })
    expect(fake.toasts.map(t => t.color)).not.toContain('success')
  })
})

describe('DP-08.B1 — aviso de recuperación', () => {
  const pending = (over = {}) => ({ planId: PLAN, treatmentId: 't1', reason: 'error' as const, canRetry: true, ...over })

  it('shows the exact message, a retry and a close action, and no "Descartar"', async () => {
    const wrapper = await mountSuspended(PlanLinkRecoveryNotice, { props: { pending: pending() } })
    expect(wrapper.text()).toContain('Tratamiento creado, pero no agregado al Plan.')
    expect(wrapper.find('[data-testid="plan-link-retry"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="plan-link-dismiss"]').exists()).toBe(true)
    expect(wrapper.text()).not.toContain('Descartar')
  })

  it('hides retry when it cannot succeed, and emits retry / dismiss', async () => {
    const blocked = await mountSuspended(PlanLinkRecoveryNotice, { props: { pending: pending({ reason: 'locked', canRetry: false }) } })
    expect(blocked.find('[data-testid="plan-link-retry"]').exists()).toBe(false)
    const ok = await mountSuspended(PlanLinkRecoveryNotice, { props: { pending: pending() } })
    await ok.find('[data-testid="plan-link-retry"]').trigger('click')
    await ok.find('[data-testid="plan-link-dismiss"]').trigger('click')
    expect(ok.emitted('retry')).toHaveLength(1)
    expect(ok.emitted('dismiss')).toHaveLength(1)
  })

  it('has the keys in every supported locale', () => {
    const keys = ['title', 'blockedTitle', 'undoBlockedTitle', 'alreadyRemoved', 'added', 'recovered']
    const reasons = ['locked', 'closed', 'other_plan', 'plan_missing', 'invalid', 'error']
    for (const code of ['en', 'es', 'fr', 'pt', 'ta']) {
      const block = locale(code).treatmentPlans.linkRecovery
      for (const k of keys) expect(block[k], `${code}.${k}`).toBeTruthy()
      for (const r of reasons) expect(block.reason[r], `${code}.reason.${r}`).toBeTruthy()
    }
    expect(locale('es').treatmentPlans.linkRecovery.title).toBe('Tratamiento creado, pero no agregado al Plan.')
  })
})

describe('DP-08.B1 — los tres componentes usan el mecanismo compartido', () => {
  const nts = read('treatment_plan/frontend/components/clinical/NtsPlanOdontogramChart.vue')
  const chart = read('odontogram/frontend/components/odontogram/OdontogramChart.vue')
  const bar = read('odontogram/frontend/components/odontogram/TreatmentBar.vue')

  it('creation goes through createAndLink; no bare addItem remains', () => {
    for (const src of [nts, chart, bar]) {
      expect(src).toContain('createAndLink')
      expect(src).not.toMatch(/treatmentPlansApi\.addItem|\.addItem\(/)
    }
  })

  it('undo / delete use removeFromPlan and never the odontogram DELETE for linked treatments', () => {
    for (const src of [nts, chart]) {
      expect(src).toContain('removeFromPlan')
      expect(src).toContain('planLink.explainRemove')
    }
    // the only direct deleteTreatment calls are the no-Plan and not_linked fallbacks
    for (const src of [nts, chart]) {
      const calls = src.match(/deleteTreatment\(/g) ?? []
      expect(calls.length).toBe(2)
      expect(src).toContain('if (!planId) return deleteTreatment(treatmentId)')
    }
  })

  it('undo entries are pushed only on confirmed association', () => {
    expect(nts).toContain('if (result.status === \'unlinked\')')
    expect(chart).toContain('if (outcome.kind === \'unlinked\')')
    expect(bar).toContain('emit(\'planLinkFailed\'')
    // TreatmentBar emits treatmentApplied after the unlinked early return
    expect(bar.indexOf('emit(\'planLinkFailed\'')).toBeLessThan(bar.lastIndexOf('emit(\'treatmentApplied\', treatment)'))
  })

  it('the recovery notice is rendered and wired to retry/dismiss', () => {
    for (const src of [nts, chart]) {
      expect(src).toContain('<PlanLinkRecoveryNotice')
      expect(src).toContain('@retry="retryPlanLink"')
      expect(src).toContain('@dismiss="planLink.dismiss()"')
      expect(src).not.toContain('Descartar')
    }
  })
})
