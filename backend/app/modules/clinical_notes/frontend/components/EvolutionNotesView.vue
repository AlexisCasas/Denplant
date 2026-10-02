<script setup lang="ts">
/**
 * EvolutionNotesView — the "Evolución" tab of the patient's Clinical record.
 *
 * Mounted through the ``patient.clinical.evolution`` slot; ``patients`` renders
 * the slot and never imports this component.
 *
 * It is the consolidated clinical-notes history of one patient: evolution,
 * diagnosis, treatment, plan and appointment notes, newest first, each with its
 * date, author, type, context, tooth and attachments (``NoteCard``). It is also
 * where new notes are written and where the whole history is printed.
 *
 * Reception notes (``administrative``, ``appointment_administrative``) are not
 * part of the clinical history and are never requested here.
 */

import type { ClinicalNoteLinked, NoteType, RecentNoteEntry } from '~~/app/types'
import { PERMISSIONS } from '~~/app/config/permissions'
import {
  EVOLUTION_CLINICAL_TYPES,
  NEW_EVOLUTION,
  buildCreatePayload,
  composerIntentFromQuery,
  fetchAllClinicalNotes,
  sortForPrint,
  toPrintPatient,
  withoutComposerIntent
} from '../utils/evolutionNotes'
import type { ComposerIntent, ComposerSubmission } from '../utils/evolutionNotes'

const props = defineProps<{
  ctx: { patientId: string, readonly?: boolean }
}>()

const route = useRoute()
const router = useRouter()
const { t } = useI18n()
const { can } = usePermissions()
const { metaFor } = useNoteTypeMeta()
const { listRecentForPatient, createNote, updateNote, deleteNote } = useClinicalNotes()
const { user } = useAuth()
const { currentClinic } = useClinicState()

const PAGE_SIZE = 20

const patientId = computed(() => props.ctx.patientId)
const canRead = computed(() => can(PERMISSIONS.clinicalNotes.read))
const canWrite = computed(() => can(PERMISSIONS.clinicalNotes.write))

// ---------------------------------------------------------------------------
// the list
// ---------------------------------------------------------------------------

const entries = ref<RecentNoteEntry[]>([])
const loading = ref(false)
const loadingMore = ref(false)
const hasMore = ref(false)
const activeTypes = ref<Set<NoteType>>(new Set(EVOLUTION_CLINICAL_TYPES))

const allSelected = computed(() => activeTypes.value.size === EVOLUTION_CLINICAL_TYPES.length)

/** Filter chips narrow the list; "all" is every clinical type, never administrative. */
const requestedTypes = computed(() =>
  EVOLUTION_CLINICAL_TYPES.filter(type => activeTypes.value.has(type))
)

async function refresh() {
  if (!patientId.value || !canRead.value) return
  loading.value = true
  try {
    const rows = await listRecentForPatient(patientId.value, {
      types: [...requestedTypes.value],
      limit: PAGE_SIZE
    })
    entries.value = rows
    hasMore.value = rows.length === PAGE_SIZE
  } finally {
    loading.value = false
  }
}

async function loadMore() {
  if (!patientId.value || !canRead.value || entries.value.length === 0) return
  loadingMore.value = true
  try {
    const before = entries.value[entries.value.length - 1]?.created_at
    const rows = await listRecentForPatient(patientId.value, {
      types: [...requestedTypes.value],
      limit: PAGE_SIZE,
      before
    })
    const known = new Set(entries.value.map(entry => entry.id))
    entries.value.push(...rows.filter(row => !known.has(row.id)))
    hasMore.value = rows.length === PAGE_SIZE
  } finally {
    loadingMore.value = false
  }
}

function selectAll() {
  if (allSelected.value) return
  activeTypes.value = new Set(EVOLUTION_CLINICAL_TYPES)
  refresh()
}

function toggleType(type: NoteType) {
  // From "all", a click isolates that type: the usual intent is "only these".
  if (allSelected.value) {
    activeTypes.value = new Set([type])
  } else if (activeTypes.value.has(type)) {
    activeTypes.value.delete(type)
    if (activeTypes.value.size === 0) activeTypes.value = new Set(EVOLUTION_CLINICAL_TYPES)
  } else {
    activeTypes.value.add(type)
  }
  activeTypes.value = new Set(activeTypes.value)
  refresh()
}

function isActive(type: NoteType): boolean {
  return !allSelected.value && activeTypes.value.has(type)
}

// ---------------------------------------------------------------------------
// writing
// ---------------------------------------------------------------------------

const composerOpen = ref(false)
const composerIntent = ref<ComposerIntent>({ ...NEW_EVOLUTION })
const editingEntry = ref<RecentNoteEntry | null>(null)
const composerBody = ref('')
const saving = ref(false)

/** Edits keep the type the note already has; new notes take the intent's. */
const composerNoteType = computed<NoteType>(
  () => editingEntry.value?.note_type ?? composerIntent.value.noteType
)

const composerTitle = computed(() => {
  if (editingEntry.value) return t('actions.edit')
  const { noteType, toothNumber } = composerIntent.value
  if (noteType === 'evolution') return t('clinicalNotes.evolution.newEvolution')
  return toothNumber
    ? t('clinicalNotes.evolution.newDiagnosisNoteTooth', { n: toothNumber })
    : t('clinicalNotes.evolution.newDiagnosisNote')
})

function openComposer(intent: ComposerIntent) {
  if (!canWrite.value) return
  editingEntry.value = null
  composerIntent.value = intent
  composerBody.value = ''
  composerOpen.value = true
}

function startEdit(entry: RecentNoteEntry) {
  editingEntry.value = entry
  composerBody.value = entry.body
  composerOpen.value = true
}

function closeComposer() {
  composerOpen.value = false
  editingEntry.value = null
  composerBody.value = ''
}

async function handleSubmit(submission: ComposerSubmission) {
  if (!patientId.value) return
  saving.value = true
  try {
    const saved = editingEntry.value
      ? await updateNote(editingEntry.value.id, submission.body)
      : await createNote(buildCreatePayload(composerIntent.value, patientId.value, submission))
    // A failed save keeps the composer open with what was typed.
    if (!saved) return
    closeComposer()
    await refresh()
  } finally {
    saving.value = false
  }
}

async function handleDelete(entry: RecentNoteEntry) {
  if (!window.confirm(t('clinicalNotes.confirms.delete'))) return
  if (await deleteNote(entry.id)) await refresh()
}

function canEditEntry(entry: RecentNoteEntry): boolean {
  return canWrite.value && !!entry.author?.id && entry.author.id === user.value?.id
}

// ---------------------------------------------------------------------------
// the deep link from Diagnóstico ("Añadir nota")
// ---------------------------------------------------------------------------

/**
 * ``?newNote=diagnosis&tooth=<FDI>`` opens a diagnosis composer bound to that
 * tooth. The parameters are removed as soon as they are read, so a refresh or a
 * shared URL does not reopen the composer.
 */
function consumeDeepLink() {
  const intent = composerIntentFromQuery(route.query)
  if (!intent) return
  openComposer(intent)
  router.replace({ query: withoutComposerIntent(route.query) })
}

watch(() => [route.query.newNote, route.query.tooth], consumeDeepLink)

// ---------------------------------------------------------------------------
// opening what a note belongs to
// ---------------------------------------------------------------------------

function openLinked(linked: ClinicalNoteLinked) {
  if (!linked.id) return
  if (linked.kind === 'plan') {
    router.push(`/treatment-plans/${linked.id}`)
    return
  }
  const mode = linked.kind === 'appointment' ? 'appointments' : 'diagnosis'
  router.push({
    path: `/patients/${patientId.value}`,
    query: {
      tab: 'clinical',
      clinicalMode: mode,
      tooth: mode === 'diagnosis' ? (linked.tooth_number ?? undefined) : undefined
    }
  })
}

// ---------------------------------------------------------------------------
// printing the whole history
// ---------------------------------------------------------------------------

const printing = ref(false)
const printNotes = ref<RecentNoteEntry[] | null>(null)
const printComplete = ref(true)
const printedAt = ref<Date>(new Date())
const printError = ref(false)

/** The patient page's own cached record: never fetched again for a header. */
const printPatient = computed(() => {
  const cached = useNuxtData<Parameters<typeof toPrintPatient>[0]>(`patient:${patientId.value}`)
  return toPrintPatient(cached.data.value)
})

function clearPrint() {
  printNotes.value = null
}

async function printEvolution() {
  if (printing.value || !patientId.value) return
  printing.value = true
  printError.value = false
  try {
    // Every clinical note, not the 20 on screen, whatever the filter says.
    const history = await fetchAllClinicalNotes(request =>
      listRecentForPatient(patientId.value, request)
    )
    printNotes.value = sortForPrint(history.notes)
    printComplete.value = history.complete
    printedAt.value = new Date()

    // The sheet exists only while it is printing; drop it afterwards so it can
    // never meet another document's print stylesheet.
    window.addEventListener('afterprint', clearPrint, { once: true })
    await nextTick()
    window.print()
  } catch (error) {
    console.error('Error preparing the evolution printout:', error)
    printError.value = true
    clearPrint()
  } finally {
    printing.value = false
  }
}

onBeforeUnmount(() => {
  window.removeEventListener('afterprint', clearPrint)
})

watch(patientId, () => {
  closeComposer()
  clearPrint()
  refresh()
}, { immediate: true })

onMounted(consumeDeepLink)
</script>

<template>
  <section
    v-if="canRead"
    class="space-y-4"
    data-testid="evolution-notes-view"
  >
    <header class="flex flex-wrap items-center justify-between gap-2">
      <div class="flex items-center gap-2">
        <UIcon
          name="i-lucide-notebook-pen"
          class="w-5 h-5 text-primary-accent"
        />
        <h2 class="font-medium">
          {{ t('clinicalNotes.evolution.title') }}
        </h2>
      </div>
      <div class="flex flex-wrap items-center gap-2">
        <UButton
          icon="i-lucide-printer"
          size="sm"
          variant="outline"
          color="neutral"
          :loading="printing"
          :disabled="printing"
          data-testid="evolution-print"
          @click="printEvolution"
        >
          {{ printing ? t('clinicalNotes.evolution.printPreparing') : t('clinicalNotes.evolution.print.label') }}
        </UButton>
        <UButton
          v-if="canWrite"
          icon="i-lucide-plus"
          size="sm"
          color="primary"
          data-testid="evolution-new"
          @click="openComposer({ ...NEW_EVOLUTION })"
        >
          {{ t('clinicalNotes.evolution.newEvolution') }}
        </UButton>
      </div>
    </header>

    <p
      v-if="printError"
      class="text-sm text-error"
      role="alert"
    >
      {{ t('clinicalNotes.evolution.printFailed') }}
    </p>

    <div
      class="flex flex-wrap items-center gap-1"
      role="group"
      :aria-label="t('clinicalNotes.evolution.filtersLabel')"
    >
      <UButton
        size="xs"
        :variant="allSelected ? 'solid' : 'soft'"
        color="neutral"
        icon="i-lucide-list"
        :aria-pressed="allSelected"
        data-testid="evolution-filter-all"
        @click="selectAll"
      >
        {{ t('clinicalNotes.evolution.filterAll') }}
      </UButton>
      <span
        class="mx-1 h-4 w-px bg-default/60"
        aria-hidden="true"
      />
      <UButton
        v-for="type in EVOLUTION_CLINICAL_TYPES"
        :key="type"
        size="xs"
        :variant="isActive(type) ? 'soft' : 'ghost'"
        :color="metaFor(type).color"
        :icon="metaFor(type).icon"
        :aria-pressed="isActive(type)"
        :data-testid="`evolution-filter-${type}`"
        @click="toggleType(type)"
      >
        {{ t(metaFor(type).labelKey) }}
      </UButton>
    </div>

    <div v-if="composerOpen">
      <p class="mb-1 text-sm font-medium">
        {{ composerTitle }}
      </p>
      <NoteComposer
        :note-type="composerNoteType"
        :initial-body="composerBody"
        :tooth-number="editingEntry ? null : composerIntent.toothNumber"
        :patient-id="patientId"
        :busy="saving"
        autofocus
        @submit="handleSubmit"
        @cancel="closeComposer"
      />
    </div>

    <div
      v-if="loading"
      class="space-y-2"
    >
      <USkeleton
        v-for="i in 3"
        :key="i"
        class="h-24 w-full"
      />
    </div>

    <div
      v-else-if="entries.length === 0"
      class="text-center py-10 text-muted"
    >
      <UIcon
        name="i-lucide-notebook-pen"
        class="w-10 h-10 mx-auto mb-2 opacity-50"
      />
      <p class="font-medium">
        {{ t('clinicalNotes.evolution.empty.title') }}
      </p>
      <p class="text-sm">
        {{ t('clinicalNotes.evolution.empty.help') }}
      </p>
    </div>

    <ul
      v-else
      class="space-y-2"
    >
      <li
        v-for="entry in entries"
        :key="entry.id"
      >
        <NoteCard
          :note-id="entry.id"
          :note-type="entry.note_type"
          :body="entry.body"
          :created-at="entry.created_at"
          :author="entry.author"
          :linked="entry.linked"
          :attachments="entry.attachments"
          :can-edit="canEditEntry(entry)"
          absolute-date
          always-expanded
          show-appointment-context
          @edit="startEdit(entry)"
          @delete="handleDelete(entry)"
          @open-linked="openLinked"
        />
      </li>
    </ul>

    <div
      v-if="hasMore && !loading"
      class="flex justify-center"
    >
      <UButton
        variant="ghost"
        size="sm"
        :loading="loadingMore"
        @click="loadMore"
      >
        {{ t('clinicalNotes.feed.loadMore') }}
      </UButton>
    </div>

    <!--
      The printed document. Teleported to <body> so the print stylesheet can
      hide every other child of the page; client-only because a teleport during
      SSR lands outside the server-rendered tree. Mounted only while printing.
    -->
    <ClientOnly>
      <Teleport to="body">
        <EvolutionPrintView
          v-if="printNotes"
          :notes="printNotes"
          :patient="printPatient"
          :clinic-name="currentClinic?.name ?? null"
          :printed-at="printedAt"
          :complete="printComplete"
        />
      </Teleport>
    </ClientOnly>
  </section>
</template>
