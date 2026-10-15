import type { ApiResponse, Appointment, AppointmentLabel } from '~~/app/types'
import { missingSuggestedLabels, SUGGESTED_APPOINTMENT_LABELS } from '../utils/appointmentLabels'

export function useAppointmentLabels() {
  const api = useApi()
  const labels = useState<AppointmentLabel[]>('agenda:appointment-labels', () => [])
  const appointments = useState<Appointment[]>('appointments:list', () => [])
  const { currentClinic } = useClinicState()
  const loadedClinicId = useState<string | null>('agenda:appointment-labels:clinic', () => null)

  async function fetchLabels() {
    const response = await api.get<ApiResponse<AppointmentLabel[]>>('/api/v1/agenda/appointment-labels')
    labels.value = response.data
    loadedClinicId.value = currentClinic.value?.id ?? null
    return response.data
  }

  // Do not expose a previous clinic's cached labels while the next clinic
  // session is loading. Backend tenancy remains authoritative.
  watch(currentClinic, (clinic) => {
    if (loadedClinicId.value !== null && loadedClinicId.value !== clinic?.id) {
      labels.value = []
      loadedClinicId.value = null
    }
  })

  async function saveLabel(data: Pick<AppointmentLabel, 'name' | 'color'>, id?: string) {
    const response = id
      ? await api.put<ApiResponse<AppointmentLabel>>(`/api/v1/agenda/appointment-labels/${id}`, data)
      : await api.post<ApiResponse<AppointmentLabel>>('/api/v1/agenda/appointment-labels', data)
    labels.value = id
      ? labels.value.map(label => label.id === id ? response.data : label)
      : [...labels.value, response.data].sort((a, b) => a.name.localeCompare(b.name))
    // List responses embed label snapshots. Keep currently visible cards in
    // sync immediately after catalog edits without a duplicate source of
    // truth or requiring a session refresh.
    appointments.value = appointments.value.map(appointment =>
      appointment.appointment_label_id === response.data.id
        ? { ...appointment, appointment_label: response.data }
        : appointment
    )
    return response.data
  }

  async function deactivateLabel(id: string) {
    const response = await api.put<ApiResponse<AppointmentLabel>>(`/api/v1/agenda/appointment-labels/${id}`, { is_active: false })
    labels.value = labels.value.map(label => label.id === id ? response.data : label)
    appointments.value = appointments.value.map(appointment =>
      appointment.appointment_label_id === id
        ? { ...appointment, appointment_label: response.data }
        : appointment
    )
    return response.data
  }

  async function loadSuggestedLabels(): Promise<{ created: number, existing: number, errors: number }> {
    if (!labels.value.length) await fetchLabels()
    const missing = missingSuggestedLabels(labels.value.map(label => label.name))
    let created = 0
    let existing = 0
    let errors = 0
    existing = SUGGESTED_APPOINTMENT_LABELS.length - missing.length
    for (const suggestion of missing) {
      try {
        await saveLabel(suggestion)
        created++
      } catch {
        // A parallel creation can race the pre-check. Treat it as an error
        // in the summary rather than altering pre-existing clinic data.
        errors++
      }
    }
    return { created, existing, errors }
  }

  return { labels: readonly(labels), fetchLabels, saveLabel, deactivateLabel, loadSuggestedLabels }
}
