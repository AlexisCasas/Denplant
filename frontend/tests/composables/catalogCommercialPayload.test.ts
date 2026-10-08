import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { buildSystemCommercialPayload } from '../../../backend/app/modules/catalog/frontend/composables/useCatalog'

describe('system catalog commercial payload', () => {
  it('sends only fields that a system item is allowed to change', () => {
    const payload = buildSystemCommercialPayload({
      internal_code: 'MUST-NOT-LEAVE-THE-MODAL',
      category_id: 'protected-category',
      names: { es: 'Protegido' },
      is_active: false,
      pricing_strategy: 'per_surface',
      treatment_scope: 'global_mouth',
      is_diagnostic: true,
      requires_surfaces: true,
      default_price: 120,
      cost_price: 40,
      vat_type_id: 'clinic-vat',
      surface_prices: { 1: 120 },
      sessions: [],
      default_duration_minutes: 45,
      requires_appointment: false
    })

    expect(payload).toEqual({
      default_price: 120,
      cost_price: 40,
      vat_type_id: 'clinic-vat',
      surface_prices: { 1: 120 },
      pricing_config: undefined,
      sessions: [],
      default_duration_minutes: 45,
      requires_appointment: false
    })
    expect(payload).not.toHaveProperty('internal_code')
    expect(payload).not.toHaveProperty('category_id')
    expect(payload).not.toHaveProperty('pricing_strategy')
    expect(payload).not.toHaveProperty('treatment_scope')
  })

  it('uses the shared currency composable and has no hardcoded euro symbol in the modal', () => {
    const modal = readFileSync(
      resolve(process.cwd(), '../backend/app/modules/catalog/frontend/components/catalog/CatalogItemModal.vue'),
      'utf8'
    )
    expect(modal).toContain('useCurrency()')
    expect(modal).toContain('currencySymbol()')
    expect(modal).not.toContain('>€<')
  })

  it('suppresses only the generic forbidden toast because the catalog handles it locally', () => {
    const composable = readFileSync(
      resolve(process.cwd(), '../backend/app/modules/catalog/frontend/composables/useCatalog.ts'),
      'utf8'
    )
    expect(composable).toContain('{ silentForbidden: true }')
  })
})
