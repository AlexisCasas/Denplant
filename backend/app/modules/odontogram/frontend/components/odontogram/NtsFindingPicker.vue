<script setup lang="ts">
/**
 * NtsFindingPicker — choose a rule from the catalog.
 *
 * The list is whatever `GET /nts/catalogs/{norm_version}` served, in the
 * catalog's own order. There is no hardcoded list of findings here and no
 * invented grouping: the norm numbers its rules and offers no clinical
 * categories, so inventing some would be this component asserting a taxonomy
 * the norm does not have.
 */

import type { NtsRule } from '../../types/nts'

const props = defineProps<{
  rules: readonly NtsRule[]
  selected: NtsRule | null
}>()

const emit = defineEmits<{ select: [rule: NtsRule] }>()

const { t } = useI18n()

const query = ref('')

/** Matches the official name or the rule id, so QA can search either. */
const matches = computed(() => {
  const needle = query.value.trim().toLowerCase()
  if (!needle) return props.rules
  return props.rules.filter(
    rule =>
      rule.official_name.toLowerCase().includes(needle)
      || rule.rule_id.toLowerCase().includes(needle)
  )
})
</script>

<template>
  <div
    class="space-y-2"
    data-testid="nts-finding-picker"
  >
    <UInput
      v-model="query"
      icon="i-lucide-search"
      size="sm"
      :placeholder="t('odontogram.nts.editor.searchFindings')"
      :aria-label="t('odontogram.nts.editor.searchFindings')"
      data-testid="nts-finding-search"
    />

    <p
      v-if="matches.length === 0"
      class="text-caption text-subtle"
      data-testid="nts-finding-picker-empty"
    >
      {{ t('odontogram.nts.editor.noMatches') }}
    </p>

    <ul
      v-else
      class="max-h-64 overflow-y-auto divide-y divide-default rounded-token-sm border border-default"
    >
      <li
        v-for="rule in matches"
        :key="rule.rule_id"
      >
        <button
          type="button"
          class="w-full text-left px-3 py-2 flex items-baseline justify-between gap-3
                 hover:bg-surface-muted transition-colors"
          :class="selected?.rule_id === rule.rule_id ? 'bg-primary-accent/10' : ''"
          :aria-pressed="selected?.rule_id === rule.rule_id"
          :data-testid="`nts-rule-${rule.rule_id}`"
          :data-scope="rule.scope"
          @click="emit('select', rule)"
        >
          <span class="text-sm">{{ rule.official_name }}</span>
          <span class="text-caption text-subtle tabular-nums shrink-0">{{ rule.rule_id }}</span>
        </button>
      </li>
    </ul>
  </div>
</template>
