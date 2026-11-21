/**
 * usePrescriptionDraft — the new-prescription form, in memory.
 *
 * Local to the instance: not `useState`, not `localStorage`, not a server
 * draft. A medical document half-written in storage would be a second source
 * of truth, and a draft that outlived a patient switch could reach the wrong
 * patient. Closing the form, or changing patient, discards it.
 *
 * The form always has between 1 and 50 medications and starts with one empty.
 */

import {
  createBody,
  emptyItem,
  MAX_ITEMS,
  validateForm,
  type FormErrors,
  type ItemDraft,
  type ItemField
} from '../utils/prescriptionForm'

export function usePrescriptionDraft() {
  const validUntil = ref('')
  const items = ref<ItemDraft[]>([emptyItem()])
  const errors = ref<FormErrors>({ items: {}, any: false })
  /** Set once the user has tried to continue: errors then follow their edits. */
  const attempted = ref(false)

  const canAdd = computed(() => items.value.length < MAX_ITEMS)
  const canRemove = computed(() => items.value.length > 1)

  /** Whether anything was typed: an untouched form needs no confirmation to close. */
  const dirty = computed(() =>
    validUntil.value !== ''
    || items.value.length > 1
    || items.value.some(item =>
      (Object.keys(item) as Array<keyof ItemDraft>).some(
        field => field !== 'key' && String(item[field]) !== ''
      )
    )
  )

  function revalidate(): void {
    if (attempted.value) errors.value = validateForm(validUntil.value, items.value)
  }

  function setValidUntil(value: string): void {
    validUntil.value = value
    revalidate()
  }

  function setField(key: number, field: ItemField, value: string): void {
    const item = items.value.find(candidate => candidate.key === key)
    if (!item) return
    item[field] = value
    revalidate()
  }

  /** Adds an empty medication and returns its key, or `null` at the maximum. */
  function addItem(): number | null {
    if (!canAdd.value) return null
    const item = emptyItem()
    items.value.push(item)
    return item.key
  }

  function removeItem(key: number): void {
    if (!canRemove.value) return
    items.value = items.value.filter(item => item.key !== key)
    revalidate()
  }

  /** Check everything; `true` when it may go on to the confirmation. */
  function validate(): boolean {
    attempted.value = true
    errors.value = validateForm(validUntil.value, items.value)
    return !errors.value.any
  }

  /** A server-side complaint about the validity date, shown on that field. */
  function rejectValidUntil(): void {
    errors.value = { ...errors.value, validUntil: 'beforeIssue', any: true }
  }

  /** The part of the request the form decides: `valid_until` and `items`. */
  function body() {
    return createBody(validUntil.value, items.value)
  }

  function reset(): void {
    validUntil.value = ''
    items.value = [emptyItem()]
    errors.value = { items: {}, any: false }
    attempted.value = false
  }

  return {
    validUntil,
    items,
    errors,
    dirty,
    canAdd,
    canRemove,
    setValidUntil,
    setField,
    addItem,
    removeItem,
    validate,
    rejectValidUntil,
    body,
    reset
  }
}
