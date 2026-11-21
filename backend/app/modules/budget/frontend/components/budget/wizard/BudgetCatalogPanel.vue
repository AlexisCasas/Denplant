<script setup lang="ts">
import type { ApiResponse, PaginatedResponse, TreatmentCatalogItem } from '~~/app/types'

const emit = defineEmits<{ add: [item: TreatmentCatalogItem] }>()

const { t } = useI18n()
const api = useApi()
const { format } = useCurrency()
const { getItemName } = useCatalog()
const { getCategoryName } = useTreatmentCatalogSearch()

const tab = ref<'all' | 'frequent'>('all')
const query = ref('')
const items = ref<TreatmentCatalogItem[]>([])
const popularIds = ref<string[]>([])
const loading = ref(false)
const failed = ref(false)
const justAdded = ref<string | null>(null)

let timer: ReturnType<typeof setTimeout> | null = null
let requestId = 0

async function load() {
  const id = ++requestId
  loading.value = true
  failed.value = false
  try {
    const params = new URLSearchParams({ page: '1', page_size: '100', is_active: 'true' })
    if (query.value.trim()) params.set('search', query.value.trim())
    const res = await api.get<PaginatedResponse<TreatmentCatalogItem>>(`/api/v1/catalog/items?${params}`)
    if (id === requestId) items.value = res.data
  } catch {
    if (id === requestId) {
      items.value = []
      failed.value = true
    }
  } finally {
    if (id === requestId) loading.value = false
  }
}

async function loadPopular() {
  try {
    const res = await api.get<ApiResponse<Array<{ id: string }>>>('/api/v1/catalog/items/popular?limit=20')
    popularIds.value = res.data.map(i => i.id)
  } catch {
    popularIds.value = []
  }
}

onMounted(() => {
  load()
  loadPopular()
})
onBeforeUnmount(() => {
  if (timer) clearTimeout(timer)
})

watch(query, () => {
  if (timer) clearTimeout(timer)
  timer = setTimeout(load, 250)
})

const visible = computed(() => {
  if (tab.value === 'all') return items.value
  const order = new Map(popularIds.value.map((id, i) => [id, i]))
  return items.value
    .filter(i => order.has(i.id))
    .sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0))
})

function add(item: TreatmentCatalogItem) {
  emit('add', item)
  justAdded.value = item.id
  setTimeout(() => {
    if (justAdded.value === item.id) justAdded.value = null
  }, 900)
}
</script>

<template>
  <UCard class="h-full">
    <template #header>
      <h2 class="text-h2 text-default">
        {{ t('budget.wizard.catalogTitle') }}
      </h2>
    </template>

    <div class="space-y-3">
      <div
        v-if="popularIds.length"
        class="flex gap-2"
        role="tablist"
      >
        <UButton
          v-for="opt in (['all', 'frequent'] as const)"
          :key="opt"
          size="sm"
          role="tab"
          :aria-selected="tab === opt"
          :variant="tab === opt ? 'soft' : 'ghost'"
          :color="tab === opt ? 'primary' : 'neutral'"
          :icon="opt === 'frequent' ? 'i-lucide-star' : undefined"
          @click="tab = opt"
        >
          {{ t(opt === 'all' ? 'budget.wizard.tabAll' : 'budget.wizard.tabFrequent') }}
        </UButton>
      </div>

      <UInput
        v-model="query"
        icon="i-lucide-search"
        class="w-full"
        :placeholder="t('budget.wizard.searchTreatment')"
      />

      <ul class="space-y-1 max-h-[26rem] overflow-y-auto -mx-1 px-1">
        <li
          v-for="item in visible"
          :key="item.id"
        >
          <button
            type="button"
            class="w-full flex items-center gap-3 rounded-lg p-2 text-left hover:bg-surface-muted focus-visible:outline-2 focus-visible:outline-[var(--color-primary)]"
            @click="add(item)"
          >
            <span class="flex items-center justify-center w-9 h-9 rounded-lg bg-[color-mix(in_srgb,var(--color-primary-soft)_35%,transparent)] text-[var(--color-primary)] shrink-0">
              <UIcon
                name="i-lucide-activity"
                class="w-5 h-5"
              />
            </span>
            <span class="min-w-0 flex-1">
              <span class="block font-medium text-default truncate">{{ getItemName(item) }}</span>
              <span
                v-if="getCategoryName(item)"
                class="block text-caption text-subtle truncate"
              >{{ getCategoryName(item) }}</span>
            </span>
            <span class="tnum text-default shrink-0">{{ format(item.default_price ?? 0) }}</span>
            <span
              class="flex items-center justify-center w-7 h-7 rounded-full border shrink-0"
              :class="justAdded === item.id
                ? 'bg-[var(--color-primary)] border-[var(--color-primary)] text-white'
                : 'border-default text-muted'"
            >
              <UIcon
                :name="justAdded === item.id ? 'i-lucide-check' : 'i-lucide-plus'"
                class="w-4 h-4"
              />
            </span>
          </button>
        </li>
      </ul>

      <p
        v-if="loading && !visible.length"
        class="text-caption text-subtle text-center py-4"
      >
        {{ t('common.loading') }}
      </p>
      <p
        v-else-if="failed"
        class="text-caption text-danger-accent text-center py-4"
      >
        {{ t('budget.wizard.catalogError') }}
      </p>
      <p
        v-else-if="!visible.length"
        class="text-caption text-subtle text-center py-4"
      >
        {{ t('budget.wizard.catalogEmpty') }}
      </p>
    </div>
  </UCard>
</template>
