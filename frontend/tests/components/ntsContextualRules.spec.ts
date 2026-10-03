/**
 * Which rules the click-a-tooth shortcut may offer: decided by catalog
 * metadata alone. The rules here are synthetic and carry meaningless ids, so
 * the predicate cannot be passing by recognising one.
 */

import { describe, expect, it } from 'vitest'

import { isContextualRuleSupported } from '../../../backend/app/modules/odontogram/frontend/utils/ntsContextualRules'
import type { NtsRule } from '../../../backend/app/modules/odontogram/frontend/types/nts'

function rule(overrides: Partial<NtsRule> = {}): NtsRule {
  return {
    rule_id: 'synthetic-1',
    official_name: 'Synthetic',
    scope: 'tooth',
    target_identity: 'numbered',
    range_grouping: null,
    anchor: null,
    arch_cardinality: null,
    attributes: [],
    target_roles: [],
    ...overrides
  } as unknown as NtsRule
}

describe('isContextualRuleSupported', () => {
  it.each(['tooth', 'surface', 'pair'] as const)('%s-scoped numbered rules qualify', (scope) => {
    expect(isContextualRuleSupported(rule({ scope }))).toBe(true)
  })

  it('a single-segment range qualifies', () => {
    expect(isContextualRuleSupported(rule({ scope: 'range', range_grouping: 'single_segment' }))).toBe(true)
  })

  it('a multi-segment range does not: the editor builds exactly one segment', () => {
    expect(isContextualRuleSupported(rule({ scope: 'range', range_grouping: 'multi_segment' }))).toBe(false)
  })

  it('an arch-scoped rule does not: its subject is not a tooth', () => {
    expect(isContextualRuleSupported(rule({ scope: 'arch', arch_cardinality: 'one' }))).toBe(false)
  })

  it('a rule whose subject has no FDI number does not, even with anchors', () => {
    expect(isContextualRuleSupported(rule({
      target_identity: 'unnumbered',
      anchor: { cardinality: 2 } as NtsRule['anchor']
    }))).toBe(false)
  })

  it('the grouping only matters to ranges', () => {
    expect(isContextualRuleSupported(rule({ scope: 'pair', range_grouping: null }))).toBe(true)
  })

  it('does not look at the id: the same shape qualifies or not whatever it is called', () => {
    for (const id of ['6.1.31', '6.1.1', 'x', '']) {
      expect(isContextualRuleSupported(rule({ rule_id: id, scope: 'range', range_grouping: 'multi_segment' }))).toBe(false)
      expect(isContextualRuleSupported(rule({ rule_id: id, scope: 'range', range_grouping: 'single_segment' }))).toBe(true)
    }
  })
})
