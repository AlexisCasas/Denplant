import { describe, expect, it } from 'vitest'

import {
  draftLine,
  draftTotals,
  formatDraftDate,
  type BudgetDraftItem
} from '../../../backend/app/modules/budget/frontend/composables/useBudgetDraft'

function item(price: number, vat: number, extra: Partial<BudgetDraftItem> = {}): BudgetDraftItem {
  return {
    key: `k-${price}-${vat}`,
    catalog: { default_price: price, vat_type: { rate: vat } } as BudgetDraftItem['catalog'],
    quantity: 1,
    surfaces: [],
    notes: '',
    ...extra
  }
}

// Mirrors BudgetItemService._calculate_line_totals / BudgetService._recalculate_totals.
describe('budget wizard totals preview', () => {
  it('applies line discount before VAT', () => {
    const line = draftLine(item(100, 21, { quantity: 2, discount_type: 'percentage', discount_value: 10 }))
    expect(line).toEqual({ unitPrice: 100, subtotal: 200, discount: 20, tax: 37.8, total: 217.8 })
  })

  it('caps an absolute line discount at the line subtotal', () => {
    const line = draftLine(item(50, 0, { discount_type: 'absolute', discount_value: 80 }))
    expect(line.discount).toBe(50)
    expect(line.total).toBe(0)
  })

  it('applies the global discount to the VAT-inclusive items total', () => {
    const totals = draftTotals(
      [item(100, 21, { quantity: 2, discount_type: 'percentage', discount_value: 10 })],
      'percentage',
      10
    )
    expect(totals).toEqual({ subtotal: 200, discount: 41.78, tax: 37.8, total: 196.02 })
  })

  it('caps an absolute global discount at the items total', () => {
    const totals = draftTotals([item(100, 0)], 'absolute', 500)
    expect(totals.total).toBe(0)
    expect(totals.discount).toBe(100)
  })

  it('is zero for an empty budget', () => {
    expect(draftTotals([])).toEqual({ subtotal: 0, discount: 0, tax: 0, total: 0 })
  })

  it('formats dates without a timezone shift', () => {
    expect(formatDraftDate('2026-11-16', 'es')).toBe('16/11/2026')
    expect(formatDraftDate('', 'es')).toBe('')
  })
})
