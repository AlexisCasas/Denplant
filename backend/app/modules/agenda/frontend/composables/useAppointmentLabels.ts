import type { ApiResponse, AppointmentLabel } from '~~/app/types'

export function useAppointmentLabels() {
  const api = useApi()
  const labels = useState<AppointmentLabel[]>('agenda:appointment-labels', () => [])

  async function fetchLabels() {
    const response = await api.get<ApiResponse<AppointmentLabel[]>>('/api/v1/agenda/appointment-labels')
    labels.value = response.data
    return response.data
  }

  async function saveLabel(data: Pick<AppointmentLabel, 'name' | 'color'>, id?: string) {
    const response = id
      ? await api.put<ApiResponse<AppointmentLabel>>(`/api/v1/agenda/appointment-labels/${id}`, data)
      : await api.post<ApiResponse<AppointmentLabel>>('/api/v1/agenda/appointment-labels', data)
    labels.value = id
      ? labels.value.map(label => label.id === id ? response.data : label)
      : [...labels.value, response.data].sort((a, b) => a.name.localeCompare(b.name))
    return response.data
  }

  async function deactivateLabel(id: string) {
    const response = await api.put<ApiResponse<AppointmentLabel>>(`/api/v1/agenda/appointment-labels/${id}`, { is_active: false })
    labels.value = labels.value.map(label => label.id === id ? response.data : label)
    return response.data
  }

  return { labels: readonly(labels), fetchLabels, saveLabel, deactivateLabel }
}
