import { computed, ref } from 'vue'
import { describe, expect, it } from 'vitest'
import type { Appointment } from '../../app/types'
import { useFreeSlots } from '../../../backend/app/modules/agenda/frontend/composables/useFreeSlots'

const hiddenAppointment = {
  id: 'hidden-appointment',
  professional_id: 'professional-a',
  cabinet: 'Cabinet A',
  status: 'scheduled',
  start_time: '2030-01-02T10:00:00',
  end_time: '2030-01-02T10:30:00'
} as Appointment

describe('label filter operational availability', () => {
  it('keeps a hidden appointment busy and preserves available minutes', () => {
    const allAppointments = ref<readonly Appointment[]>([hiddenAppointment])
    // This mirrors an active label filter: the card list no longer contains
    // the reservation, but useFreeSlots receives the complete data source.
    const visibleAppointments = computed<readonly Appointment[]>(() => [])
    const resource = ref({ kind: 'professional' as const, id: 'professional-a' })
    const date = ref(new Date(2030, 0, 2))
    const minDurationMin = ref(1)
    const bounds = ref({ startHour: 8, endHour: 12 })

    const operational = useFreeSlots({
      appointments: allAppointments,
      availability: ref(null),
      resource,
      date,
      minDurationMin,
      bounds
    })
    const visibleOnly = useFreeSlots({
      appointments: visibleAppointments,
      availability: ref(null),
      resource,
      date,
      minDurationMin,
      bounds
    })

    expect(operational.entries.value.some(entry => entry.type === 'busy')).toBe(true)
    expect(operational.freeIntervals.value.some(slot =>
      slot.start.getHours() === 10 && slot.start.getMinutes() === 0
    )).toBe(false)
    expect(operational.summary.value.totalFreeMin).toBe(210)
    // A visible-only source would incorrectly fabricate the half hour.
    expect(visibleOnly.summary.value.totalFreeMin).toBe(240)
  })
})
