/**
 * Local state of the "new budget" wizard.
 *
 * Nothing is sent to the API until the last step: `buildPayload()` produces a
 * single `BudgetCreate` (the endpoint already accepts `items[]` and the global
 * discount), so there is still exactly one creation call and one budget row.
 *
 * The totals below mirror `BudgetItemService._calculate_line_totals` and
 * `BudgetService._recalculate_totals` (budget/service.py). They are a preview;
 * the persisted figures are always the ones the backend computes.
 */
import type {
  BudgetCreate,
  BudgetItemCreate,
  DiscountType,
  Patient,
  TreatmentCatalogItem
} from '~~/app/types'

export interface BudgetDraftItem {
  /** Local key only — the backend assigns the real item id on creation. */
  key: string
  catalog: TreatmentCatalogItem
  quantity: number
  tooth_number?: number
  surfaces: string[]
  discount_type?: DiscountType
  discount_value?: number
  notes: string
}

export interface BudgetDraftLine {
  unitPrice: number
  subtotal: number
  discount: number
  tax: number
  total: number
}

export interface BudgetDraftTotals {
  /** Sum of unit price × quantity, before discounts and VAT. */
  subtotal: number
  /** Line discounts + global discount. */
  discount: number
  tax: number
  /** What the budget will be persisted with (VAT included). */
  total: number
}

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100

export function draftLine(item: BudgetDraftItem): BudgetDraftLine {
  const unitPrice = Number(item.catalog.default_price ?? 0)
  const subtotal = round2(unitPrice * item.quantity)

  let discount = 0
  if (item.discount_type && item.discount_value) {
    discount = item.discount_type === 'percentage'
      ? round2(subtotal * (item.discount_value / 100))
      : Math.min(item.discount_value, subtotal)
  }

  const taxable = subtotal - discount
  const vatRate = Number(item.catalog.vat_type?.rate ?? 0)
  const tax = round2(taxable * (vatRate / 100))
  return { unitPrice, subtotal, discount, tax, total: round2(taxable + tax) }
}

export function draftTotals(
  items: BudgetDraftItem[],
  globalType?: DiscountType,
  globalValue?: number
): BudgetDraftTotals {
  const lines = items.map(draftLine)
  const sum = (pick: (l: BudgetDraftLine) => number) => lines.reduce((acc, l) => acc + pick(l), 0)
  const itemsTotal = sum(l => l.total)

  let globalDiscount = 0
  if (globalType && globalValue) {
    globalDiscount = globalType === 'percentage'
      ? round2(itemsTotal * (globalValue / 100))
      : Math.min(globalValue, itemsTotal)
  }

  return {
    subtotal: round2(sum(l => l.subtotal)),
    discount: round2(sum(l => l.discount) + globalDiscount),
    tax: round2(sum(l => l.tax)),
    total: round2(itemsTotal - globalDiscount)
  }
}

/** `YYYY-MM-DD` → localized `dd/mm/yyyy` without a timezone shift. */
export function formatDraftDate(iso: string | undefined, locale: string): string {
  if (!iso) return ''
  const [y, m, d] = iso.split('-').map(Number)
  if (!y || !m || !d) return iso
  return new Date(y, m - 1, d).toLocaleDateString(locale, {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric'
  })
}

export type BudgetWizardStep = 1 | 2 | 3

export function ageFromBirthDate(iso: string | undefined | null): number | null {
  if (!iso) return null
  const [y, m, d] = iso.split('-').map(Number)
  if (!y || !m || !d) return null
  const now = new Date()
  let age = now.getFullYear() - y
  if (now.getMonth() + 1 < m || (now.getMonth() + 1 === m && now.getDate() < d)) age--
  return age >= 0 ? age : null
}

export function useBudgetDraft() {
  const step = ref<BudgetWizardStep>(1)
  const patient = ref<Patient | null>(null)
  /** DNI / passport — only exposed by the patient "extended" endpoint. */
  const patientDocument = ref<string | null>(null)

  const form = reactive({
    valid_from: new Date().toISOString().split('T')[0] as string,
    valid_until: '',
    patient_notes: '',
    internal_notes: ''
  })

  const items = ref<BudgetDraftItem[]>([])
  const globalDiscount = reactive<{ type?: DiscountType, value?: number }>({})

  let nextKey = 0
  function addItem(
    catalog: TreatmentCatalogItem,
    extra: Partial<Omit<BudgetDraftItem, 'key' | 'catalog'>> = {}
  ): BudgetDraftItem {
    const item: BudgetDraftItem = {
      key: `draft-${++nextKey}`,
      catalog,
      quantity: 1,
      surfaces: [],
      notes: '',
      ...extra
    }
    items.value.push(item)
    return item
  }

  function removeItem(key: string) {
    items.value = items.value.filter(i => i.key !== key)
  }

  const totals = computed(() => draftTotals(items.value, globalDiscount.type, globalDiscount.value))

  /** Validation errors by field; empty object = valid. Backend still validates. */
  const dataErrors = computed(() => {
    const errors: Record<string, string> = {}
    if (!patient.value) errors.patient = 'patient'
    if (!form.valid_from) errors.valid_from = 'valid_from'
    if (form.valid_from && form.valid_until && form.valid_until < form.valid_from) {
      errors.valid_until = 'valid_until'
    }
    return errors
  })

  const itemsValid = computed(() =>
    items.value.every(i =>
      Number.isInteger(i.quantity) && i.quantity >= 1
      && (i.tooth_number === undefined || (i.tooth_number >= 11 && i.tooth_number <= 85))
      && (!i.discount_type || (i.discount_value ?? 0) >= 0)
    )
  )

  function buildPayload(): BudgetCreate | null {
    if (!patient.value || Object.keys(dataErrors.value).length > 0 || !itemsValid.value) return null

    const payloadItems: BudgetItemCreate[] = items.value.map((i, index) => ({
      catalog_item_id: i.catalog.id,
      quantity: i.quantity,
      tooth_number: i.tooth_number || undefined,
      surfaces: i.surfaces.length ? i.surfaces : undefined,
      discount_type: i.discount_type || undefined,
      discount_value: i.discount_value || undefined,
      notes: i.notes || undefined,
      display_order: index
    }))

    return {
      patient_id: patient.value.id,
      valid_from: form.valid_from,
      valid_until: form.valid_until || undefined,
      patient_notes: form.patient_notes || undefined,
      internal_notes: form.internal_notes || undefined,
      global_discount_type: globalDiscount.value ? globalDiscount.type : undefined,
      global_discount_value: globalDiscount.value ? globalDiscount.value : undefined,
      items: payloadItems.length ? payloadItems : undefined
    }
  }

  return {
    step,
    patient,
    patientDocument,
    form,
    items,
    globalDiscount,
    totals,
    dataErrors,
    itemsValid,
    addItem,
    removeItem,
    buildPayload
  }
}

export type BudgetDraft = ReturnType<typeof useBudgetDraft>

const DRAFT_KEY: InjectionKey<BudgetDraft> = Symbol('budgetDraft')

export function provideBudgetDraft(draft: BudgetDraft) {
  provide(DRAFT_KEY, draft)
}

export function injectBudgetDraft(): BudgetDraft {
  const draft = inject(DRAFT_KEY)
  if (!draft) throw new Error('injectBudgetDraft: no wizard provides the draft')
  return draft
}
