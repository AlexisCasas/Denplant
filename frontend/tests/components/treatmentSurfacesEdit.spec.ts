/**
 * DP-08.B2 (F5) — safe editing of a treatment's surfaces in TreatmentEditModal.
 *
 * Covers the pure helpers, the real modal (payload, plan context), the real
 * `useTreatments().updateTreatment` against a fake API (409 keeps the user's
 * work, one message only) and the order of "close" vs "saved" in both consumers.
 */
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import TreatmentEditModal from '../../../backend/app/modules/odontogram/frontend/components/odontogram/TreatmentEditModal.vue'
import { useTreatments } from '../../../backend/app/modules/odontogram/frontend/composables/useTreatments'
import {
  normalizeSurfaces,
  surfacesChanged,
  surfacesLockedReason
} from '../../app/utils/treatmentSurfaces'

const MODULES = resolve(process.cwd(), '../backend/app/modules')
const read = (rel: string) => readFileSync(resolve(MODULES, rel), 'utf8')
const locale = (code: string) =>
  JSON.parse(readFileSync(resolve(process.cwd(), 'i18n/locales', `${code}.json`), 'utf8'))

const fake = vi.hoisted(() => ({
  putMode: 'ok' as string,
  puts: [] as Array<{ path: string, body: Record<string, unknown> }>,
  toasts: [] as Array<Record<string, unknown>>
}))

const httpError = (statusCode: number, code?: string) =>
  Object.assign(new Error(`HTTP ${statusCode}`), { statusCode, data: code ? { code } : {} })

mockNuxtImport('useApi', () => () => ({
  put: async (path: string, body: Record<string, unknown>) => {
    fake.puts.push({ path, body })
    if (fake.putMode === 'locked') throw httpError(409, 'surfaces_locked_linked_to_plan')
    if (fake.putMode === 'unknown409') throw httpError(409, 'surfaces_locked_something_new')
    if (fake.putMode === 'other409') throw httpError(409, 'plan_locked')
    if (fake.putMode === 'network') throw Object.assign(new Error('network'), {})
    return { data: { id: 't1', status: 'planned', teeth: [], notes: body.notes ?? null } }
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

beforeEach(() => {
  fake.putMode = 'ok'
  fake.puts = []
  fake.toasts = []
})

const view = (over: Record<string, unknown> = {}) => ({
  id: 'tt1',
  treatment_id: 't1',
  tooth_number: 16,
  treatment_type: 'filling_composite',
  status: 'planned',
  surfaces: ['O', 'M'],
  notes: 'nota',
  ...over
}) as never

describe('DP-08.B2 — reglas puras', () => {
  it('compares sets, not order or duplicates', () => {
    expect(surfacesChanged(['O', 'M'], ['M', 'O'])).toBe(false)
    expect(surfacesChanged(['O', 'M'], ['M', 'O', 'M'])).toBe(false)
    expect(surfacesChanged(undefined, [])).toBe(false)
    expect(surfacesChanged(null, ['O'])).toBe(true)
    expect(surfacesChanged(['O'], ['O', 'D'])).toBe(true)
    expect(surfacesChanged(['O', 'D'], ['O'])).toBe(true)
    expect(normalizeSurfaces(['V', 'M', 'V'])).toEqual(['M', 'V'])
  })

  it('reads the lock reason from status + structured code only', () => {
    expect(surfacesLockedReason(httpError(409, 'surfaces_locked_linked_to_plan'))).toBe('linked_to_plan')
    expect(surfacesLockedReason(httpError(409, 'surfaces_locked_price_snapshot_drift'))).toBe('price_snapshot_drift')
    expect(surfacesLockedReason(httpError(409, 'surfaces_locked_brand_new'))).toBe('locked')
    expect(surfacesLockedReason(httpError(409, 'plan_locked'))).toBeNull()
    expect(surfacesLockedReason(httpError(500, 'surfaces_locked_linked_to_plan'))).toBeNull()
    expect(surfacesLockedReason(new Error('surfaces_locked_linked_to_plan'))).toBeNull()
  })

  it('every backend reason has text in all five locales', () => {
    const reasons = ['not_planned', 'not_single_tooth', 'type_without_surfaces', 'linked_to_plan', 'linked_to_budget', 'price_snapshot_drift', 'locked']
    for (const code of ['es', 'en', 'fr', 'pt', 'ta']) {
      const o = locale(code).odontogram
      expect(o.surfacesLockedInPlan, code).toBeTruthy()
      expect(o.surfacesLockedPrefix, code).toBeTruthy()
      for (const r of reasons) expect(o.surfacesLocked[r], `${code}.${r}`).toBeTruthy()
    }
  })
})

const body = () => document.body
const mounted: Array<{ unmount: () => void }> = []
// The modal teleports into <body>: unmount so a previous test's buttons never leak in.
afterEach(() => {
  while (mounted.length) mounted.pop()!.unmount()
  document.body.innerHTML = ''
})

async function mountModal(props: Record<string, unknown> = {}) {
  const wrapper = await mountSuspended(TreatmentEditModal, {
    props: { open: true, treatment: view(), ...props }
  })
  mounted.push(wrapper)
  await new Promise(r => setTimeout(r, 0))
  return wrapper
}

function buttonByText(text: string): HTMLButtonElement {
  const b = [...body().querySelectorAll('button')].find(x => x.textContent?.trim().startsWith(text))
  if (!b) throw new Error(`button "${text}" not found`)
  return b as HTMLButtonElement
}

describe('DP-08.B2 — TreatmentEditModal', () => {
  it('includes surfaces in the payload when the set really changed', async () => {
    const w = await mountModal()
    buttonByText('D - ').click() // add D
    await new Promise(r => setTimeout(r, 0))
    buttonByText('Guardar').click()
    const ev = w.emitted('update')
    expect(ev).toHaveLength(1)
    expect(ev![0][0]).toBe('t1')
    expect(new Set((ev![0][1] as { surfaces: string[] }).surfaces)).toEqual(new Set(['O', 'M', 'D']))
    expect(w.emitted('update:open')).toBeUndefined() // never closes itself before the API answers
  })

  it('omits surfaces when the selection is equivalent (other order, toggled back)', async () => {
    const w = await mountModal({ treatment: view({ surfaces: ['O', 'M'] }) })
    buttonByText('D - ').click()
    await new Promise(r => setTimeout(r, 0))
    buttonByText('D - ').click() // back to the original set
    await new Promise(r => setTimeout(r, 0))
    // notes change so there is something to send
    const ta = body().querySelector('textarea') as HTMLTextAreaElement
    ta.value = 'otra nota'
    ta.dispatchEvent(new Event('input'))
    await new Promise(r => setTimeout(r, 0))
    buttonByText('Guardar').click()
    const sent = w.emitted('update')![0][1] as Record<string, unknown>
    expect(sent).toEqual({ notes: 'otra nota' })
    expect('surfaces' in sent).toBe(false)
  })

  it('notes and status keep working exactly as before', async () => {
    const w = await mountModal({ treatment: view({ status: 'planned' }) })
    buttonByText('Existente').click()
    await new Promise(r => setTimeout(r, 0))
    buttonByText('Guardar').click()
    expect(w.emitted('update')![0][1]).toEqual({ status: 'existing' })
  })

  it('nothing changed: closes (explicit cancel path) and emits no update', async () => {
    const w = await mountModal()
    buttonByText('Guardar').click()
    expect(w.emitted('update')).toBeUndefined()
    expect(w.emitted('update:open')![0]).toEqual([false])
  })

  it('in Plan context the surfaces are disabled, explained and never emitted', async () => {
    const w = await mountModal({ planContext: true })
    const surfaceButtons = ['M - ', 'D - ', 'O - ', 'V - ', 'L - '].map(buttonByText)
    expect(surfaceButtons.every(b => b.disabled)).toBe(true)
    expect(body().querySelector('[data-testid="surfaces-locked-in-plan"]')?.textContent)
      .toContain('contexto del Plan')
    surfaceButtons[1]!.click() // disabled: no effect
    await new Promise(r => setTimeout(r, 0))
    buttonByText('Guardar').click()
    expect(w.emitted('update')).toBeUndefined()
  })

  it('shows the refusal inline and keeps the user selection while open', async () => {
    const w = await mountModal({ errorMessage: 'No se pudo guardar. Las superficies no se pueden cambiar: está vinculado a un presupuesto.' })
    expect(body().querySelector('[data-testid="treatment-edit-error"]')?.textContent).toContain('presupuesto')
    buttonByText('D - ').click()
    await new Promise(r => setTimeout(r, 0))
    await w.setProps({ errorMessage: 'otro motivo' })
    // the selection survives a new message (no prop reset of local state)
    const chosen = [...body().querySelectorAll('button')].filter(b => b.className.includes('bg-primary'))
    expect(chosen.some(b => b.textContent?.trim().startsWith('D - '))).toBe(true)
  })
})

describe('DP-08.B2 — updateTreatment ante un rechazo del servidor', () => {
  it('409 surfaces lock: returns null, one inline reason, NO toast at all', async () => {
    fake.putMode = 'locked'
    const api = useTreatments()
    const r = await api.updateTreatment('t1', { surfaces: ['M'] })
    expect(r).toBeNull()
    expect(api.updateError.value).toContain('Plan de tratamiento')
    expect(fake.toasts).toEqual([]) // no success toast, no error toast: one message only
  })

  it('unknown surfaces_locked_* code still explains (generic reason)', async () => {
    fake.putMode = 'unknown409'
    const api = useTreatments()
    expect(await api.updateTreatment('t1', { surfaces: ['M'] })).toBeNull()
    expect(api.updateError.value).toContain('no es segura')
  })

  it('any other failure keeps its single error toast and no inline duplicate', async () => {
    for (const mode of ['network', 'other409']) {
      fake.putMode = mode
      fake.toasts = []
      const api = useTreatments()
      expect(await api.updateTreatment('t1', { notes: 'x' })).toBeNull()
      expect(api.updateError.value).toBeNull()
      expect(fake.toasts).toHaveLength(1)
      expect(fake.toasts[0]!.color).toBe('error')
    }
  })

  it('success: exactly one success toast, error cleared, body carries surfaces', async () => {
    const api = useTreatments()
    fake.putMode = 'locked'
    await api.updateTreatment('t1', { surfaces: ['M'] })
    fake.putMode = 'ok'
    fake.toasts = []
    const r = await api.updateTreatment('t1', { surfaces: ['M', 'O'] })
    expect(r).not.toBeNull()
    expect(api.updateError.value).toBeNull()
    expect(fake.toasts).toHaveLength(1)
    expect(fake.toasts[0]!.color).toBe('success')
    expect(fake.puts.at(-1)!.body.surfaces).toEqual(['M', 'O'])
  })
})

describe('DP-08.B2 — los consumidores cierran solo tras guardar', () => {
  const chart = read('odontogram/frontend/components/odontogram/OdontogramChart.vue')
  const nts = read('treatment_plan/frontend/components/clinical/NtsPlanOdontogramChart.vue')

  it('both handlers return before closing/emitting when the API did not save', () => {
    for (const src of [chart, nts]) {
      const fn = src.slice(src.indexOf('async function handleTreatmentUpdate'))
      const guard = fn.indexOf('if (!updated) return')
      expect(guard).toBeGreaterThan(-1)
      expect(guard).toBeLessThan(fn.indexOf('showTreatmentEditModal.value = false'))
      expect(guard).toBeLessThan(fn.indexOf('editingTreatment.value = null'))
      expect(guard).toBeLessThan(fn.indexOf('emit(\'treatmentsChanged\')'))
    }
  })

  it('Plan context is explicit where it is known and the error is wired to the modal', () => {
    expect(chart).toContain(':plan-context="isPlanningMode"')
    expect(nts).toContain(':plan-context="!!planId"')
    for (const src of [chart, nts]) {
      expect(src).toContain(':error-message="updateError"')
      expect(src).toContain('updateError.value = null') // cleared when a new edit opens
    }
  })

  it('perform/delete flows are untouched', () => {
    for (const src of [chart, nts]) {
      expect(src).toContain('planLink.releaseTreatment(')
      expect(src).toContain('performTreatment(treatmentId')
    }
  })
})
