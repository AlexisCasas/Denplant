<script setup lang="ts">
/**
 * NtsCurrentFindingsPanel — the findings of the clinically current MINSA
 * diagnosis, as a read-only reference for other screens.
 *
 * Built for the treatment-plan screen, where the clinician decides *what to
 * do* and needs to see *what was found and where*. It is a reference and
 * nothing more: no action is offered, no finding is linked to a treatment,
 * and nothing is written — a finding is not a procedure (NTS §5.8).
 *
 * **Which record.** The current *finalized* one (`GET .../records/current`).
 * A draft — including a continuation of that record — is never read, so it can
 * never be presented as the diagnosis in force, and carried-forward findings
 * nobody has reviewed never appear here. When the draft is finalized, the next
 * load shows it.
 *
 * **Which norm.** The profile only decides whether this panel exists and which
 * norm the current record is asked for. The catalog that *interprets* the
 * findings is always the one the record names: a finding read under another
 * norm's rules would be a fabricated statement, so a catalog that cannot be
 * served is an error, never a fallback.
 *
 * Every word comes from the existing `ntsFindingModel` helpers; nothing about
 * a rule, a tooth or a surface is known here. Failure stays inside the panel.
 *
 * Explicit relative imports for the same reason as the rest of this folder:
 * the `module_layers` symlink does not resolve in the frontend test suite.
 */

import { PERMISSIONS } from '~~/app/config/permissions'
import type { NtsCatalog, NtsFinding, NtsFindingTarget, NtsRecord, NtsRule } from '../../types/nts'
import { useNtsApi } from '../../composables/useNtsApi'
import { useOdontogramProfile } from '../../composables/useOdontogramProfile'
import {
  describeAttributes,
  describeTargets,
  formatTargetSummary,
  ruleFor
} from '../../utils/ntsFindingModel'

const props = defineProps<{
  patientId: string
}>()

const { t, locale } = useI18n()
const { can } = usePermissions()
const nts = useNtsApi()
const { profile, isLoaded, ensureLoaded } = useOdontogramProfile()

/** The profile value doubles as the norm version (see NTS-04A §3). */
const NTS_PROFILE = 'pe_nts_188_2022'

const record = ref<NtsRecord | null>(null)
const catalog = ref<NtsCatalog | null>(null)
const isLoading = ref(false)
const failed = ref(false)

/**
 * Whether this panel exists at all. Anything else renders nothing and asks
 * for nothing: the Original profile has its own context on the plan's chart,
 * and without `odontogram.read` the reads would only be refused.
 */
const active = computed(
  () => isLoaded.value
    && profile.value === NTS_PROFILE
    && can(PERMISSIONS.odontogram.read)
    && props.patientId.length > 0
)

/**
 * Monotonic generation token. A response whose token is stale is dropped, so a
 * patient switched mid-flight can never receive the previous patient's data.
 */
let generation = 0
let inFlight: AbortController | null = null

function clear(): void {
  record.value = null
  catalog.value = null
  failed.value = false
  isLoading.value = false
}

async function load(): Promise<void> {
  const token = ++generation
  inFlight?.abort()
  inFlight = null
  // Before awaiting anything: the previous patient must not stay on screen.
  clear()
  if (!active.value) return

  const controller = new AbortController()
  inFlight = controller
  isLoading.value = true
  try {
    const current = await nts.getCurrentRecord(props.patientId, NTS_PROFILE, controller.signal)
    if (token !== generation) return
    // Interpreted under the norm the record was written in, not the profile's.
    const loaded = current ? await nts.getCatalog(current.norm_version, controller.signal) : null
    if (token !== generation) return
    record.value = current
    catalog.value = loaded
  } catch {
    // Whatever went wrong, it stays in the panel: the plan keeps working.
    if (token !== generation) return
    failed.value = true
  } finally {
    if (token === generation) isLoading.value = false
  }
}

onMounted(() => {
  void ensureLoaded()
})

watch([active, () => props.patientId], () => void load(), { immediate: true })

onBeforeUnmount(() => {
  generation += 1
  inFlight?.abort()
})

interface Row {
  id: string
  rule: NtsRule | null
  label: string
  location: string
  attributes: Array<{ name: string, label: string, value: string }>
}

/** Same total order everywhere in the row, whatever order the API used. */
function byGroupThenPosition(a: NtsFindingTarget, b: NtsFindingTarget): number {
  return a.group_index - b.group_index || a.position - b.position
}

function toRow(finding: NtsFinding, rules: readonly NtsRule[]): Row {
  const rule = ruleFor(rules, finding)
  // Sorted copies: the arrays the API handed us are never mutated.
  const targets = [...finding.targets].sort(byGroupThenPosition)
  return {
    id: finding.id,
    rule,
    label: rule?.official_name ?? finding.rule_id,
    location: formatTargetSummary(describeTargets(rule, targets), t),
    attributes: describeAttributes(rule, finding.attributes)
  }
}

const rows = computed<Row[]>(() => {
  if (!record.value || !catalog.value) return []
  const rules = catalog.value.rules
  return [...record.value.findings]
    .sort((a, b) => a.sequence - b.sequence)
    .map(finding => toRow(finding, rules))
})

const lastDiagnosis = computed(() => {
  const at = record.value?.finalized_at
  if (!at) return null
  return new Date(at).toLocaleDateString(locale.value, { dateStyle: 'medium' })
})
</script>

<template>
  <UCard
    v-if="active"
    data-testid="nts-findings-panel"
  >
    <template #header>
      <div class="flex items-start justify-between gap-2">
        <div class="min-w-0">
          <div class="flex items-center gap-2">
            <UIcon
              name="i-lucide-clipboard-list"
              class="w-5 h-5 text-primary-accent"
            />
            <span class="font-medium">{{ t('odontogram.nts.planReference.title') }}</span>
            <UBadge
              v-if="record && catalog"
              color="neutral"
              variant="subtle"
              size="sm"
              data-testid="nts-findings-panel-count"
            >
              {{ rows.length }}
            </UBadge>
          </div>
          <p
            v-if="lastDiagnosis && catalog"
            class="text-caption text-subtle mt-1"
            data-testid="nts-findings-panel-date"
          >
            {{ t('odontogram.nts.planReference.lastDiagnosis', { date: lastDiagnosis }) }}
          </p>
        </div>
      </div>
    </template>

    <div
      v-if="isLoading"
      class="space-y-2"
      data-testid="nts-findings-panel-loading"
    >
      <USkeleton class="h-4 w-1/3" />
      <USkeleton class="h-4 w-2/3" />
      <USkeleton class="h-4 w-1/2" />
    </div>

    <UAlert
      v-else-if="failed"
      color="warning"
      variant="subtle"
      icon="i-lucide-triangle-alert"
      :title="t('odontogram.nts.planReference.errorTitle')"
      :description="t('odontogram.nts.planReference.error')"
      data-testid="nts-findings-panel-error"
    >
      <template #actions>
        <UButton
          size="xs"
          color="neutral"
          variant="ghost"
          data-testid="nts-findings-panel-retry"
          @click="load()"
        >
          {{ t('common.retry') }}
        </UButton>
      </template>
    </UAlert>

    <p
      v-else-if="!record"
      class="text-sm text-subtle"
      data-testid="nts-findings-panel-none"
    >
      {{ t('odontogram.nts.planReference.noDiagnosis') }}
    </p>

    <p
      v-else-if="rows.length === 0"
      class="text-sm text-subtle"
      data-testid="nts-findings-panel-empty"
    >
      {{ t('odontogram.nts.planReference.noFindings') }}
    </p>

    <ul
      v-else
      class="divide-y divide-default max-h-72 overflow-y-auto"
      data-testid="nts-findings-panel-list"
    >
      <li
        v-for="row in rows"
        :key="row.id"
        class="py-2 first:pt-0 last:pb-0"
        :data-testid="`nts-findings-panel-row-${row.id}`"
      >
        <p class="text-sm">
          <span class="text-caption text-subtle">{{ t('odontogram.nts.planReference.location') }}:</span>
          <span
            class="font-medium"
            data-testid="nts-findings-panel-location"
          > {{ row.location }}</span>
        </p>
        <div class="flex items-center gap-2 flex-wrap">
          <span
            class="text-sm"
            data-testid="nts-findings-panel-name"
          >{{ row.label }}</span>
          <UBadge
            v-if="!row.rule"
            color="warning"
            variant="subtle"
            size="sm"
            data-testid="nts-findings-panel-unknown-rule"
          >
            {{ t('odontogram.nts.editor.unknownRuleShort') }}
          </UBadge>
        </div>
        <p
          v-if="row.attributes.length > 0"
          class="text-caption text-subtle"
          data-testid="nts-findings-panel-attributes"
        >
          <span
            v-for="(attribute, index) in row.attributes"
            :key="attribute.name"
          >
            <template v-if="index > 0"> · </template>{{ attribute.label }}: {{ attribute.value }}
          </span>
        </p>
      </li>
    </ul>
  </UCard>
</template>
