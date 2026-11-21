<script setup lang="ts">
/**
 * EvolutionPrintView — the patient's whole clinical history as one document.
 *
 * Handed every note already (oldest first): it neither fetches nor sorts, so
 * what prints is exactly what the caller loaded. ``EvolutionNotesView`` mounts
 * it, teleported to <body>, only while a print is under way.
 *
 * ## Isolation, not suppression
 *
 * The print stylesheet below hides every other child of <body> and shows this
 * root alone, the same strategy the odontogram sheet uses — but with its own
 * class, ``evolution-print-root``, and its own rules. The odontogram's print
 * rules are neither reused nor edited. They also hide every body child that is
 * not *their* root, this one included, so the show rule here is written with
 * enough specificity to win over that hide rule.
 *
 * ## Attachments
 *
 * Printed as the file name and its type, never as a thumbnail: thumbnails are
 * authenticated downloads, and a sheet that had to wait for each of them would
 * print with holes in it.
 */

import type { RecentNoteEntry } from '~~/app/types'
import {
  attachmentPrintLine,
  contextLabel
} from '../utils/evolutionNotes'
import type { EvolutionPrintPatient } from '../utils/evolutionNotes'

const props = defineProps<{
  notes: readonly RecentNoteEntry[]
  patient: EvolutionPrintPatient | null
  clinicName: string | null
  printedAt: Date
  /** False when the history could not be loaded in full. */
  complete: boolean
}>()

const { t, locale } = useI18n()
const { metaFor } = useNoteTypeMeta()

function formatDateTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString(locale.value)
  } catch {
    return iso
  }
}

const printedOn = computed(() => {
  try {
    return props.printedAt.toLocaleString(locale.value)
  } catch {
    return props.printedAt.toISOString()
  }
})

function authorOf(note: RecentNoteEntry): string {
  const author = note.author as { full_name?: string | null, email?: string | null }
  return author?.full_name || author?.email || t('clinicalNotes.evolution.print.unknownAuthor')
}

function contextOf(note: RecentNoteEntry): string | null {
  return contextLabel(note.linked, t, { appointment: true })
}
</script>

<template>
  <div
    class="evolution-print-root"
    data-testid="evolution-print-root"
  >
    <header class="evolution-print-header">
      <h1>{{ t('clinicalNotes.evolution.print.documentTitle') }}</h1>
      <dl>
        <div v-if="clinicName">
          <dt>{{ t('clinicalNotes.evolution.print.clinic') }}</dt>
          <dd data-testid="evolution-print-clinic">
            {{ clinicName }}
          </dd>
        </div>
        <div v-if="patient?.fullName">
          <dt>{{ t('clinicalNotes.evolution.print.patient') }}</dt>
          <dd data-testid="evolution-print-patient">
            {{ patient.fullName }}
          </dd>
        </div>
        <div v-if="patient?.documentNumber">
          <dt>{{ t('clinicalNotes.evolution.print.document') }}</dt>
          <dd data-testid="evolution-print-document">
            {{ patient.documentNumber }}
          </dd>
        </div>
        <div>
          <dt>{{ t('clinicalNotes.evolution.print.printedOn') }}</dt>
          <dd data-testid="evolution-print-date">
            {{ printedOn }}
          </dd>
        </div>
      </dl>
      <p class="evolution-print-count">
        {{ t('clinicalNotes.evolution.print.totalNotes', { n: notes.length }) }}
      </p>
      <p
        v-if="!complete"
        class="evolution-print-warning"
        data-testid="evolution-print-incomplete"
      >
        {{ t('clinicalNotes.evolution.printIncomplete') }}
      </p>
    </header>

    <p
      v-if="notes.length === 0"
      data-testid="evolution-print-empty"
    >
      {{ t('clinicalNotes.evolution.print.noNotes') }}
    </p>

    <article
      v-for="note in notes"
      :key="note.id"
      class="evolution-print-note"
      :data-note-id="note.id"
      :data-note-type="note.note_type"
    >
      <header>
        <strong data-testid="evolution-print-note-date">{{ formatDateTime(note.created_at) }}</strong>
        <span>{{ t(metaFor(note.note_type).labelKey) }}</span>
        <span>{{ t('clinicalNotes.evolution.print.author') }}: {{ authorOf(note) }}</span>
        <span v-if="contextOf(note)">{{ contextOf(note) }}</span>
      </header>
      <p class="evolution-print-body">
        {{ note.body }}
      </p>
      <p
        v-if="note.attachments?.length"
        class="evolution-print-attachments"
      >
        <strong>{{ t('clinicalNotes.evolution.print.attachments') }}:</strong>
        <span
          v-for="attachment in note.attachments"
          :key="attachment.id"
          data-testid="evolution-print-attachment"
        >{{ attachmentPrintLine(attachment) }}</span>
      </p>
    </article>
  </div>
</template>

<!--
  Not scoped, on purpose: the root is teleported to <body> and the rule that
  isolates it has to reach <body>'s other children. Every selector is rooted in
  ``.evolution-print-root`` or ``body >``.
-->
<style>
/* On screen the sheet does not exist: no layout, and out of the a11y tree. */
.evolution-print-root {
  display: none;
}

@media print {
  /* One document. The doubled class outranks the odontogram sheet's
     ``body > *:not(.nts-print-root)`` hide rule, which would otherwise hide
     this root too. Both rules are !important; specificity decides. */
  body > .evolution-print-root.evolution-print-root {
    display: block !important;
    width: auto;
    margin: 0;
    padding: 0;
    background: #fff;
    color: #000;
    font-size: 10pt;
    line-height: 1.4;
  }

  body > *:not(.evolution-print-root) {
    display: none !important;
  }

  .evolution-print-root h1 {
    margin: 0 0 4mm;
    font-size: 15pt;
  }

  .evolution-print-root dl {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 1mm 6mm;
    margin: 0 0 3mm;
  }

  .evolution-print-root dt {
    display: inline;
    font-weight: 600;
  }

  .evolution-print-root dt::after {
    content: ': ';
  }

  .evolution-print-root dd {
    display: inline;
    margin: 0;
  }

  .evolution-print-header {
    padding-bottom: 3mm;
    margin-bottom: 4mm;
    border-bottom: 0.4mm solid #000;
  }

  .evolution-print-count {
    margin: 0;
  }

  .evolution-print-warning {
    margin: 2mm 0 0;
    font-weight: 600;
  }

  .evolution-print-note {
    padding: 2mm 0 3mm;
    border-bottom: 0.2mm solid #888;
    /* A short note stays whole on one page; a long one may break. */
    break-inside: avoid-page;
  }

  .evolution-print-note > header {
    display: flex;
    flex-wrap: wrap;
    gap: 0 4mm;
    margin-bottom: 1mm;
  }

  .evolution-print-body {
    margin: 0;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }

  .evolution-print-attachments {
    margin: 1mm 0 0;
    font-size: 9pt;
  }

  .evolution-print-attachments span + span::before {
    content: ' · ';
  }

  .evolution-print-root * {
    outline: none !important;
    box-shadow: none !important;
  }
}
</style>
