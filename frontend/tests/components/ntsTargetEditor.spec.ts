/**
 * NTS-05C — the role control of the target editor.
 *
 * Manual QA hit a runtime error opening a role dropdown:
 *
 *   A <ComboboxItem /> must have a value prop that is not an empty string.
 *   This is because the Combobox value can be set to an empty string to
 *   clear the selection and show the placeholder.
 *
 * "No role" had been modelled as `value: ''`, which the combobox underneath
 * reserves for clearing. These tests mount the real component and pin both
 * halves of the fix: no option may carry an empty value, and the UI sentinel
 * that replaces it must never reach the model or the payload.
 *
 * The rule is synthetic, with a role code the norm does not use, so nothing
 * here can pass because the production code recognised a real one.
 */

import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { nextTick } from 'vue'

import type { NtsRule } from '../../../backend/app/modules/odontogram/frontend/types/nts'
import NtsTargetEditor from '../../../backend/app/modules/odontogram/frontend/components/odontogram/NtsTargetEditor.vue'
import {
  buildTargets,
  emptySelection
} from '../../../backend/app/modules/odontogram/frontend/utils/ntsFindingModel'
import type { NtsTargetSelection } from '../../../backend/app/modules/odontogram/frontend/utils/ntsFindingModel'

mockNuxtImport('useApi', () => () => ({ get: vi.fn(), post: vi.fn(), put: vi.fn() }))
mockNuxtImport('useClinicState', () => () => ({
  currentClinic: { get value() { return { id: 'clinic-a' } } }
}))

/** A range rule carrying one optional role, named nothing like the norm's. */
const ROLE_RULE = {
  rule_id: 'X.29',
  ordinal: 29,
  official_name: 'Synthetic bridge rule',
  scope: 'range',
  target_identity: 'numbered',
  anchor: null,
  arch_cardinality: null,
  range_grouping: 'single_segment',
  attributes: [],
  target_roles: [{
    code: 'bridge_support',
    name: 'Support',
    applies_to: 'subject',
    min_count: null,
    max_count: null,
    status: 'verified',
    notes: null
  }],
  specification_requirement: null,
  status: 'verified'
} as unknown as NtsRule

function selectionWith(teeth: number[], roles: Record<number, string> = {}): NtsTargetSelection {
  return { ...emptySelection(), teeth, roles }
}

async function mountEditor(selection: NtsTargetSelection) {
  const wrapper = await mountSuspended(NtsTargetEditor, {
    props: { rule: ROLE_RULE, selection, pickMode: 'none', problems: [] }
  })
  await nextTick()
  return wrapper
}

type Wrapper = Awaited<ReturnType<typeof mountEditor>>

/** The select of role row `index`, in `selection.teeth` order. */
function roleSelect(wrapper: Wrapper, index: number) {
  return wrapper.findAllComponents({ name: 'USelectMenu' })[index]!
}

function roleItems(wrapper: Wrapper, index = 0) {
  return roleSelect(wrapper, index).props('items') as Array<{ label: string, value: string }>
}

describe('the role control offers the catalog roles', () => {
  it('lists "no role" plus every role the rule declares', async () => {
    const wrapper = await mountEditor(selectionWith([46, 45]))
    const items = roleItems(wrapper)

    expect(items.map(i => i.label)).toEqual(['No role', 'Support'])
    expect(items[1]!.value).toBe('bridge_support')
    expect(wrapper.findAll('[data-role-row]')).toHaveLength(2)
  })

  it('no option carries an empty value — the combobox refuses those', async () => {
    const wrapper = await mountEditor(selectionWith([46, 45, 44]))

    for (let row = 0; row < 3; row++) {
      for (const item of roleItems(wrapper, row)) {
        expect(item.value).not.toBe('')
        expect(item.value.length).toBeGreaterThan(0)
      }
    }
  })

  it('the "no role" sentinel is not a clinical word', async () => {
    const wrapper = await mountEditor(selectionWith([46]))
    const sentinel = roleItems(wrapper)[0]!.value

    // Distinct from the catalog vocabulary, and obviously internal.
    expect(sentinel).not.toBe('')
    expect(sentinel).not.toBe('none')
    expect(sentinel).not.toBe('bridge_support')
    expect(sentinel).toMatch(/^__/)
  })

  it('a tooth with no role shows the sentinel, not an empty model value', async () => {
    const wrapper = await mountEditor(selectionWith([46]))
    const value = roleSelect(wrapper, 0).props('modelValue')

    expect(value).not.toBe('')
    expect(value).toBe(roleItems(wrapper)[0]!.value)
  })

  it('a tooth with a role shows that role', async () => {
    const wrapper = await mountEditor(selectionWith([46, 45], { 45: 'bridge_support' }))

    expect(roleSelect(wrapper, 1).props('modelValue')).toBe('bridge_support')
  })
})

describe('selecting and clearing a role', () => {
  it('selecting the catalog role emits its code', async () => {
    const wrapper = await mountEditor(selectionWith([46]))

    roleSelect(wrapper, 0).vm.$emit('update:modelValue', 'bridge_support')
    await nextTick()

    expect(wrapper.emitted('setRole')).toEqual([[46, 'bridge_support']])
  })

  it('selecting "no role" emits null, never the sentinel', async () => {
    const wrapper = await mountEditor(selectionWith([46], { 46: 'bridge_support' }))
    const sentinel = roleItems(wrapper)[0]!.value

    roleSelect(wrapper, 0).vm.$emit('update:modelValue', sentinel)
    await nextTick()

    expect(wrapper.emitted('setRole')).toEqual([[46, null]])
  })

  it('a select that returns the whole option is normalised the same way', async () => {
    const wrapper = await mountEditor(selectionWith([46]))
    const sentinel = roleItems(wrapper)[0]!.value

    roleSelect(wrapper, 0).vm.$emit('update:modelValue', { label: 'Support', value: 'bridge_support' })
    roleSelect(wrapper, 0).vm.$emit('update:modelValue', { label: 'No role', value: sentinel })
    await nextTick()

    expect(wrapper.emitted('setRole')).toEqual([[46, 'bridge_support'], [46, null]])
  })
})

describe('what reaches the payload', () => {
  it('an assigned role rides on its own target and nothing else', () => {
    const targets = buildTargets(ROLE_RULE, selectionWith([46, 45, 44], { 45: 'bridge_support' }))

    expect(targets.map(t => [t.tooth_number, t.role]))
      .toEqual([[46, null], [45, 'bridge_support'], [44, null]])
  })

  it('clearing a role leaves null, and the sentinel never appears', () => {
    // `setRole(tooth, null)` is what the component emits; the model deletes
    // the entry, so the payload carries null.
    const cleared = selectionWith([46, 45])
    const targets = buildTargets(ROLE_RULE, cleared)

    expect(targets.every(t => t.role === null)).toBe(true)
    expect(JSON.stringify(targets)).not.toContain('__nts_no_role__')
    expect(JSON.stringify(targets)).not.toContain('"role":""')
  })
})

describe('the real catalog still drives this generically', () => {
  const catalog = JSON.parse(
    readFileSync(
      resolve(process.cwd(), '../backend/app/modules/odontogram/nts/catalog/pe_nts_188_2022.json'),
      'utf8'
    )
  ) as { rules: Array<{ rule_id: string, target_roles?: Array<{ code: string, name: string }> }> }

  it('every declared role code and name is a non-empty string', () => {
    const roles = catalog.rules.flatMap(rule => rule.target_roles ?? [])
    expect(roles.length).toBeGreaterThan(0)
    for (const role of roles) {
      expect(role.code).not.toBe('')
      expect(role.name).not.toBe('')
    }
  })

  it('the fixed-bridge rule still declares its role, and the code never names it', () => {
    const rule = catalog.rules.find(r => r.rule_id === '6.1.29')!
    expect(rule.target_roles).toHaveLength(1)
    expect(rule.target_roles![0]).toMatchObject({ code: 'pilar', name: 'Pilar' })

    // The component renders it because the catalog declares it, not because
    // anything in the frontend knows the word.
    const source = readFileSync(
      resolve(process.cwd(), '../backend/app/modules/odontogram/frontend/components/odontogram/NtsTargetEditor.vue'),
      'utf8'
    )
    expect(source).not.toMatch(/pilar/i)
    expect(source).not.toMatch(/6\.1\.\d/)
  })
})
