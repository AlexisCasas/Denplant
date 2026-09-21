<script setup lang="ts">
/**
 * NtsOdontogramPrintView — the odontogram as a document (NTS-05F.1).
 *
 * The screen surface is a place to *work on* a record: it has buttons,
 * editors, banners and a history. A printed odontogram is none of those. It
 * is one record, arranged the way the norm's **Anexo: Gráfico del
 * odontograma** arranges it, and nothing else.
 *
 * ## What it is, and what it is not
 *
 * The normative part of this page is the middle of it: the chart, then
 * *Especificaciones*, then *Observaciones*, in that order, which is the order
 * of the annex and of §5.14 / §5.15. Everything around that — the patient
 * line, the professional line, the technical footer — is DenPlant
 * information, placed outside the annex's own content because the annex does
 * not have it. §5.2 puts the graphic *inside* the Ficha Odonto-Estomatológica,
 * and that is where the identification and the firma y sello live (§5.3). So
 * there is **no signature line here**, deliberately.
 *
 * ## One drawing
 *
 * The chart is `NtsOdontogramChart`, the same component the screen shows,
 * reading the same catalog. There is no print renderer. A second way of
 * drawing a tooth is a second clinical opinion about that tooth, and two of
 * those can disagree.
 *
 * ## Read-only in the strong sense
 *
 * Not "the buttons are disabled" — there are no buttons, no inputs, no
 * textareas. Text comes from the record as persisted, never from an editor's
 * buffer: a clinician who typed an observation and did not save it has not
 * recorded it, and a document that printed it would be claiming otherwise.
 *
 * ## Where the page itself is defined
 *
 * Not here. This component owns the document's *content and order*; its
 * physical form — A4, margins, the chart's 171 mm, the isolation that hides
 * the rest of the application while printing — lives in one block of
 * `main.css` labelled "NTS print layout", and the arithmetic that keeps it
 * inside §5.17 lives in `ntsPrintLayout.ts`. The split is deliberate: every
 * assertion here is a DOM tree with no media query involved.
 *
 * ## Whether it may be printed at all (05F.3)
 *
 * Not this component's decision either. The shell resolves it once, for both
 * the print button and this root, and hands it down as `availability` — which
 * matters because the root is always mounted and the browser's own Ctrl+P
 * reaches it without passing the button. When the answer is no, the clinical
 * document is not rendered and a notice takes its place.
 *
 * What it *does* own is the qualification: a draft, a discarded record or a
 * superseded one still prints, and says which it is before the chart.
 */

import type { NtsCatalog, NtsRecord } from '../../types/nts'
import type { NtsPrintAvailability, NtsPrintPatient } from '../../utils/ntsPrintModel'
import {
  canRenderPrintRecord,
  formatPrintDate,
  pendingCarriedForwardCount,
  printDateSource,
  printDeclarations,
  toPrintFooter,
  toPrintProfessional,
  toPrintStatus
} from '../../utils/ntsPrintModel'
import { formatTargetSummary } from '../../utils/ntsFindingModel'
import NtsOdontogramChart from './NtsOdontogramChart.vue'

const props = withDefaults(
  defineProps<{
    /**
     * The record this sheet is. Current, draft or historical — the view does
     * not care which it was given, only what it says about itself.
     */
    record: NtsRecord | null
    /**
     * The catalog for **this record's** norm.
     *
     * The caller resolves it; 05E already pairs a record with the catalog of
     * its own `norm_version`. Passed in rather than looked up here so there is
     * no path by which this view could reach for the active profile's catalog
     * and draw one norm's findings under another's rules.
     */
    catalog: NtsCatalog | null
    /** Name and document, or `null` when they were not available. */
    patient?: NtsPrintPatient | null
    /** Known only from a history row, so it is told rather than inferred. */
    isSuperseded?: boolean
    /**
     * The shell's single print decision, shared with the print button.
     *
     * The root is always mounted so the browser's own Ctrl+P reaches it
     * without passing the button — which means disabling the button is not a
     * gate, it is a suggestion. This prop is the gate: when the shell says
     * printing is unsafe, the clinical document is not rendered at all and a
     * notice takes its place, so a stale or half-saved snapshot cannot be
     * printed behind the application's back.
     *
     * `null` means no caller supplied one (the component mounted directly in
     * a test). The record/catalog coherence gate still applies — it is the
     * same condition `resolvePrintAvailability` starts from.
     */
    availability?: NtsPrintAvailability | null
  }>(),
  { patient: null, isSuperseded: false, availability: null }
)

const { t, locale } = useI18n()

/**
 * Whether there is a document at all.
 *
 * A record without the catalog of its own norm is not a document with a
 * missing picture — it is a document nobody can read, because what its
 * findings *mean* is the norm's business. Nothing is drawn and nothing is
 * claimed. There is deliberately no fallback to another catalog.
 *
 * "Its own norm" is the whole of the test, not just "a catalog is present":
 * a catalog for a *different* norm would draw the wrong marks rather than
 * none, which is the failure worth guarding against. The condition lives in
 * `canRenderPrintRecord` so the view and the pure model cannot come to
 * different conclusions about the same pair.
 */
const isReadable = computed(() => canRenderPrintRecord(props.record, props.catalog))

/**
 * Blocked by a passing state rather than by a missing record.
 *
 * This is the Ctrl+P gate, and the only place the shell's decision acts on
 * what gets rendered — `isReadable` answers a different question and the two
 * are kept apart so neither can quietly stand in for the other.
 *
 * Worth distinguishing on the page too: "this record cannot be read under its
 * own norm" and "save your work first" are different problems with different
 * remedies, and the sheet should not offer the wrong one.
 *
 * With no availability supplied (the component mounted directly in a test)
 * there is nothing transient to report, and `isReadable` is the whole test —
 * which is exactly what `resolvePrintAvailability` reduces to when nothing is
 * in flight, so the two paths agree by construction rather than by luck.
 */
const isUnsafe = computed(
  () => isReadable.value && props.availability !== null && !props.availability.printable
)

/** The clinical document renders only when it is both readable and safe. */
const isPrintable = computed(() => isReadable.value && !isUnsafe.value)

const date = computed(() => formatPrintDate(printDateSource(props.record), locale.value))

const professional = computed(() => toPrintProfessional(props.record))
const footer = computed(() => toPrintFooter(props.record))
const status = computed(() => toPrintStatus(props.record, { isSuperseded: props.isSuperseded }))

/** Carried-forward findings nobody has confirmed. Counted, never confirmed. */
const carriedForward = computed(() => pendingCarriedForwardCount(props.record))

/** Specifications in the record's own sequence. Never reordered, never edited. */
const specifications = computed(() =>
  [...(props.record?.specifications ?? [])].sort((a, b) => a.sequence - b.sequence)
)

/** The persisted text. There is no buffer to read here, by construction. */
const observations = computed(() => props.record?.observations?.trim() ?? '')

/**
 * Findings the drawing does not carry in full.
 *
 * Computed from the renderer, so this list is exactly as long as the drawing
 * is short. It is a statement about the record, not a change to it: nothing
 * in this path writes.
 */
const declarations = computed(() => printDeclarations(props.record, props.catalog))

function statusText(value: string): string {
  return t(`odontogram.nts.status.${value}`)
}

function declarationText(declaration: (typeof declarations.value)[number]): string {
  const key = declaration.completeness === 'unsupported'
    ? 'odontogram.nts.print.unsupportedCopy'
    : 'odontogram.nts.print.partialCopy'
  // The rule id stays out of the sentence: the clinical name says more.
  return t(key, {
    target: formatTargetSummary(declaration.targets, t),
    label: declaration.label
  })
}
</script>

<template>
  <article
    class="space-y-5 text-default"
    data-testid="nts-print-document"
  >
    <!--
      Blocked by a passing state, not by a missing record.

      This is the Ctrl+P path: the browser can reach this document without
      ever touching the print button, so refusing here is the only refusal
      that actually holds. What it refuses is printing a snapshot that may be
      behind the server or missing text the clinician has typed — never the
      record itself, which is untouched.
    -->
    <p
      v-if="isUnsafe"
      class="text-sm"
      data-testid="nts-print-unsafe"
      :data-blocker="availability?.blocker ?? undefined"
    >
      {{ t('odontogram.nts.print.unsafePrint') }}
    </p>

    <!-- A record whose norm cannot be served is not printed as a blank form:
         a blank odontogram is a clinical statement of its own. -->
    <p
      v-else-if="!isPrintable"
      class="text-sm"
      data-testid="nts-print-unavailable"
    >
      {{ t('odontogram.nts.print.unavailable') }}
    </p>

    <template v-else>
      <!-- 1 + 2. DenPlant identification and the annex's one date.
           Outside the normative block: the annex has no patient header. -->
      <header
        class="space-y-2"
        data-testid="nts-print-header"
      >
        <h1
          class="text-h2 text-default"
          data-testid="nts-print-title"
        >
          {{ t('odontogram.nts.print.title') }}
        </h1>

        <dl class="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
          <!-- Absent fields are omitted, never rendered as a dash: an empty
               row reads as "this patient has none", which is a different
               claim from "this page did not have it". -->
          <template v-if="patient?.fullName">
            <dt class="text-subtle">
              {{ t('odontogram.nts.print.patient') }}
            </dt>
            <dd data-testid="nts-print-patient-name">
              {{ patient.fullName }}
            </dd>
          </template>

          <template v-if="patient?.documentNumber">
            <dt class="text-subtle">
              {{ t('odontogram.nts.print.document') }}
            </dt>
            <dd data-testid="nts-print-patient-document">
              <template v-if="patient.documentType">
                {{ patient.documentType.toUpperCase() }}
              </template>
              {{ patient.documentNumber }}
            </dd>
          </template>

          <template v-if="date">
            <dt class="text-subtle">
              {{ t('odontogram.nts.print.date') }}
            </dt>
            <dd data-testid="nts-print-date">
              {{ date }}
            </dd>
          </template>
        </dl>
      </header>

      <!--
        2b. What kind of document this is — before the chart, so it cannot be
        read after the fact.

        Only shown when the sheet is something other than the finalized record
        in force. It is a statement of the record's own status, not a verdict:
        a discarded record is not "invalid" and a superseded one is not
        "annulled" — DenPlant has no standing to say either, and the norm
        defines neither term. Both remain legible clinical history.

        Stated in words, with a border and weight rather than a fill: a
        printer with background graphics turned off must still show it, and a
        qualification carried only by colour is a qualification that can be
        switched off in a print dialog.
      -->
      <section
        v-if="status?.isQualified"
        class="border-2 border-current px-3 py-2 space-y-1"
        data-testid="nts-print-qualification"
        :data-status="status.status"
        :data-superseded="status.isSuperseded ? 'true' : 'false'"
      >
        <p
          v-if="status.status === 'draft'"
          class="text-sm font-bold tracking-wide"
          data-testid="nts-print-qualification-draft"
        >
          {{ t('odontogram.nts.print.draftQualification') }}
          — {{ t('odontogram.nts.print.draftNotFinal') }}
        </p>

        <p
          v-else-if="status.status === 'discarded'"
          class="text-sm font-bold tracking-wide"
          data-testid="nts-print-qualification-discarded"
        >
          {{ t('odontogram.nts.print.discardedQualification') }}
          — {{ t('odontogram.nts.print.discardedHint') }}
        </p>

        <!-- Finalized, but a later record exists. Said plainly, and without
             implying this one was wrong. -->
        <p
          v-if="status.isSuperseded"
          class="text-sm font-bold tracking-wide"
          data-testid="nts-print-qualification-superseded"
        >
          {{ t('odontogram.nts.print.supersededQualification') }}
          — {{ t('odontogram.nts.print.supersededHint') }}
        </p>

        <!-- Carried forward from an earlier record and never reviewed. The
             count is what stops this sheet reading as a reviewed document;
             nothing here confirms anything on the clinician's behalf. -->
        <p
          v-if="status.status === 'draft' && carriedForward > 0"
          class="text-sm"
          data-testid="nts-print-qualification-carried-forward"
        >
          {{ t('odontogram.nts.print.pendingCarriedForward', { count: carriedForward }) }}
        </p>

        <p
          v-if="status.status === 'discarded' && record?.discard_reason"
          class="text-sm"
          data-testid="nts-print-qualification-discard-reason"
        >
          {{ t('odontogram.nts.print.discardReason') }}: {{ record.discard_reason }}
        </p>
      </section>

      <!--
        3. The graphic. The same component, the same catalog, the same
        geometry — with the editing advisories turned off, because a printed
        sheet cannot act on advice.
      -->
      <!-- No `data-testid` here: it would fall through onto the chart's own
           root and rename it. The chart is identified by its own id. -->
      <NtsOdontogramChart
        :record="record"
        :catalog="catalog"
        readonly
        :advisories="false"
      />

      <!-- 4. Especificaciones (§5.14). The block is always here: a missing
           block cannot be told apart from one nobody filled in. -->
      <section data-testid="nts-print-specifications">
        <h2 class="text-sm font-medium text-default">
          {{ t('odontogram.nts.print.specifications') }}
        </h2>

        <ol
          v-if="specifications.length > 0"
          class="mt-2 space-y-1 text-sm list-decimal list-inside"
          data-testid="nts-print-spec-list"
        >
          <li
            v-for="(specification, index) in specifications"
            :key="specification.id"
            class="whitespace-pre-wrap break-words"
            :data-testid="`nts-print-spec-item-${index}`"
          >
            {{ specification.text }}
          </li>
        </ol>

        <p
          v-else
          class="mt-2 text-sm text-subtle"
          data-testid="nts-print-spec-empty"
        >
          {{ t('odontogram.nts.print.emptySpecifications') }}
        </p>
      </section>

      <!-- 5. Observaciones (§5.15), as persisted. Line breaks preserved. -->
      <section data-testid="nts-print-observations">
        <h2 class="text-sm font-medium text-default">
          {{ t('odontogram.nts.print.observations') }}
        </h2>

        <p
          v-if="observations.length > 0"
          class="mt-2 text-sm whitespace-pre-wrap break-words"
          data-testid="nts-print-observations-text"
        >
          {{ observations }}
        </p>

        <p
          v-else
          class="mt-2 text-sm text-subtle"
          data-testid="nts-print-observations-empty"
        >
          {{ t('odontogram.nts.print.emptyObservations') }}
        </p>
      </section>

      <!--
        6. What the drawing could not carry.

        After Observaciones, not before it, so that no DenPlant content is
        inserted between the annex's three blocks. Labelled as a system note
        precisely because it is not part of the normative graphic — and
        present at all because a tooth whose finding was not drawn must not
        read as a tooth with nothing found.
      -->
      <section
        v-if="declarations.length > 0"
        class="border-t border-default pt-3"
        data-testid="nts-print-declarations"
      >
        <h2 class="text-sm font-medium text-default">
          {{ t('odontogram.nts.print.incompleteFindings') }}
        </h2>
        <p class="mt-1 text-caption text-subtle">
          {{ t('odontogram.nts.print.systemNote') }}
        </p>

        <ul class="mt-2 space-y-1 text-sm">
          <li
            v-for="declaration in declarations"
            :key="declaration.findingId"
            :data-testid="`nts-print-declaration-${declaration.findingId}`"
            :data-completeness="declaration.completeness"
          >
            {{ declarationText(declaration) }}
          </li>
        </ul>
      </section>

      <!-- 7. Who recorded it (§5.3). Identification, not a signature; no
           firma y sello line, which belongs to the Ficha. -->
      <section
        v-if="professional"
        data-testid="nts-print-professional"
      >
        <h2 class="text-sm font-medium text-default">
          {{ t('odontogram.nts.print.professional') }}
        </h2>

        <dl class="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
          <template v-if="professional.name">
            <dt class="text-subtle">
              {{ t('odontogram.nts.print.registeredBy') }}
            </dt>
            <dd data-testid="nts-print-professional-name">
              {{ professional.name }}
            </dd>
          </template>

          <template v-if="professional.role">
            <dt class="text-subtle">
              {{ t('odontogram.nts.print.role') }}
            </dt>
            <dd data-testid="nts-print-professional-role">
              {{ professional.role }}
            </dd>
          </template>

          <template v-if="professional.professionalId">
            <dt class="text-subtle">
              {{ t('odontogram.nts.print.professionalId') }}
            </dt>
            <dd data-testid="nts-print-professional-id">
              {{ professional.professionalId }}
            </dd>
          </template>
        </dl>
      </section>

      <!-- 8. Technical footer: what ties this sheet to a stored record. -->
      <section
        v-if="footer"
        class="border-t border-default pt-3"
        data-testid="nts-print-footer"
      >
        <h2 class="text-caption font-medium text-subtle">
          {{ t('odontogram.nts.print.technical') }}
        </h2>

        <dl class="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-caption text-subtle">
          <dt>{{ t('odontogram.nts.print.recordId') }}</dt>
          <dd
            class="break-all"
            data-testid="nts-print-record-id"
          >
            {{ footer.recordId }}
          </dd>

          <dt>{{ t('odontogram.nts.print.normVersion') }}</dt>
          <dd data-testid="nts-print-norm-version">
            {{ footer.normVersion }}
          </dd>

          <dt>{{ t('odontogram.nts.print.status') }}</dt>
          <dd data-testid="nts-print-status">
            {{ statusText(footer.status) }}
            <template v-if="status?.isSuperseded">
              · {{ statusText('superseded') }}
            </template>
          </dd>

          <dt>{{ t('odontogram.nts.print.contentFingerprint') }}</dt>
          <!--
            Whole or absent. `break-all` lets a 64-character digest wrap
            across lines rather than be clipped: a truncated fingerprint
            attests nothing, so it is never shortened to fit.
          -->
          <dd
            v-if="footer.contentHash"
            class="break-all font-mono"
            data-testid="nts-print-content-hash"
          >
            {{ footer.contentHash }}
            <span class="font-sans">({{ footer.hashAlgorithm }})</span>
          </dd>
          <dd
            v-else
            data-testid="nts-print-content-hash-unavailable"
          >
            {{ t('odontogram.nts.print.fingerprintUnavailable') }}
          </dd>
        </dl>
      </section>
    </template>
  </article>
</template>
