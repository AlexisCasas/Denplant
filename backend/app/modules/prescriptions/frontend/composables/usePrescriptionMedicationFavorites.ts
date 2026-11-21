/** Remote search and private favorite shortcuts for the create-prescription form. */

import type {
  PrescriptionMedication,
  PrescriptionMedicationFavoriteResponse,
  PrescriptionMedicationInput,
  PrescriptionMedicationResponse
} from '../types/prescriptions'

export function usePrescriptionMedicationFavorites() {
  const api = useApi()
  const favorites = ref<PrescriptionMedication[]>([])
  const results = ref<PrescriptionMedication[]>([])
  const loadingFavorites = ref(false)
  const searching = ref(false)
  const favoritesError = ref(false)
  const searchError = ref(false)
  const savingKeys = ref<string[]>([])
  let searchTimer: ReturnType<typeof setTimeout> | null = null
  let searchController: AbortController | null = null

  function inputFor(item: PrescriptionMedicationInput | PrescriptionMedication): PrescriptionMedicationInput {
    return {
      active_ingredient: item.active_ingredient.trim(),
      commercial_name: item.commercial_name?.trim() || undefined,
      strength: item.strength.trim(),
      pharmaceutical_form: item.pharmaceutical_form.trim(),
      presentation: item.presentation?.trim() || undefined,
      default_route: item.default_route.trim()
    }
  }

  function keyFor(item: PrescriptionMedicationInput): string {
    return JSON.stringify(inputFor(item))
  }

  async function loadFavorites(): Promise<void> {
    loadingFavorites.value = true
    favoritesError.value = false
    try {
      const response = await api.get<PrescriptionMedicationResponse>('/api/v1/prescriptions/medication-favorites')
      favorites.value = response.data
    } catch {
      favoritesError.value = true
    } finally {
      loadingFavorites.value = false
    }
  }

  async function search(query: string): Promise<void> {
    const value = query.trim()
    searchController?.abort()
    searchController = null
    if (value.length < 2) {
      results.value = []
      searchError.value = false
      searching.value = false
      return
    }
    const controller = new AbortController()
    searchController = controller
    searching.value = true
    searchError.value = false
    try {
      const response = await api.get<PrescriptionMedicationResponse>(
        `/api/v1/prescriptions/medications/search?q=${encodeURIComponent(value)}`,
        { signal: controller.signal }
      )
      if (searchController === controller) results.value = response.data
    } catch {
      if (searchController === controller && !controller.signal.aborted) searchError.value = true
    } finally {
      if (searchController === controller) searching.value = false
    }
  }

  function scheduleSearch(query: string): void {
    if (searchTimer) clearTimeout(searchTimer)
    searchTimer = setTimeout(() => void search(query), 300)
  }

  async function saveFavorite(input: PrescriptionMedicationInput): Promise<PrescriptionMedication | null> {
    const key = keyFor(input)
    if (savingKeys.value.includes(key)) return null
    savingKeys.value.push(key)
    try {
      const response = await api.post<PrescriptionMedicationFavoriteResponse>(
        '/api/v1/prescriptions/medication-favorites', inputFor(input)
      )
      const saved = response.data
      favorites.value = [saved, ...favorites.value.filter(item => item.favorite_id !== saved.favorite_id)]
      results.value = results.value.map(item => item.id === saved.id ? saved : item)
      return saved
    } finally {
      savingKeys.value = savingKeys.value.filter(value => value !== key)
    }
  }

  async function removeFavorite(favoriteId: string): Promise<boolean> {
    try {
      await api.del(`/api/v1/prescriptions/medication-favorites/${encodeURIComponent(favoriteId)}`)
      favorites.value = favorites.value.filter(item => item.favorite_id !== favoriteId)
      results.value = results.value.map(item => item.favorite_id === favoriteId
        ? { ...item, favorite_id: null }
        : item)
      return true
    } catch {
      return false
    }
  }

  onBeforeUnmount(() => {
    if (searchTimer) clearTimeout(searchTimer)
    searchController?.abort()
  })

  return {
    favorites, results, loadingFavorites, searching, favoritesError, searchError, savingKeys,
    loadFavorites, scheduleSearch, saveFavorite, removeFavorite, keyFor
  }
}
