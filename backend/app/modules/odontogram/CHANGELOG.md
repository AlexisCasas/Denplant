# Changelog — odontogram module

## Unreleased

- feat(nts-05d.1): **global chart geometry foundation; no clinical findings
  rendered yet**. 05B gave every tooth its own `<svg>` and its own viewBox,
  which is all a row of independent drawings needs — and not enough for
  anything that spans teeth. A span from 13 to 23, an arch-wide appliance, a
  mark between two crowns or between two apices had nowhere to be drawn,
  because there was no shared origin.

  `ntsChartGeometry.ts` supplies one. It is pure — no Vue, no DOM, no
  `getBoundingClientRect` — and answers, for any FDI number, where that tooth's
  column, crown, annotation box, number strip, roots and apices land on a
  single chart-wide canvas, plus the bands and spans marks are anchored to
  (`apexBand`, `occlusalBand`, `rangeSpan`, `archSpan`, `interproximalPoint`).
  Spans follow row order rather than FDI arithmetic, so 11 → 21 is contiguous;
  an interproximal point between teeth that are not neighbours returns `null`
  instead of a midpoint that means nothing.

  `ntsDentition.ts` gained `rootShapes`: the base, apex and flanks that
  `rootPaths` used to compute and discard. The emitted `d` strings are derived
  from exactly those points, so nothing drawn changed.

  The chart now takes its scale and width from the geometry module instead of
  keeping a second copy, and carries an **empty** overlay `<svg>` with the
  deterministic viewBox, `pointer-events-none` and `aria-hidden`. It draws
  nothing: it exists so the coordinate space is real and testable, and so a
  later ticket has somewhere to put marks that scrolls with the teeth.

  Visually inert, and checked rather than asserted: the rendered chart markup
  was diffed against the previous commit and is byte-identical apart from the
  overlay element and a `relative` class on its positioning context.

- feat(nts-05d.0b): **render metadata is now declarative end to end**. The
  05D.0 audit found that a renderer could not build a single one of the 38
  findings from metadata alone — it would have had to know that 6.1.29's
  `at: "pillars"` meant the `pilar` role, that 6.1.19's degree came from
  `mobility_degree`, that 6.1.26's sigla belongs in a circle and not in the
  box, and that 6.1.23 draws its arrow on the tooth while 6.1.24 draws one
  outside it. Each of those would have become an `if (rule_id === …)`.

  Marks now separate **how it looks** (`params`, drawn from closed enums) from
  **what data it reads** (`text_from`, `suffix_from`, `role` — references the
  validator resolves). Every `box_siglas` names its text source (19 of them),
  no `is_sigla` attribute may be left unread, every arrow declares its
  placement as well as its direction, and every param key and value must be
  declared vocabulary for its kind.

  Three token pairs collapsed to one spelling each — `apex_height`/`apex_level`,
  `vertical`/`straight_vertical`, and `square_bordering_crown`/
  `square_enclosing_crown` (§6.1.3 says "bordeando la corona", §6.1.4 "que
  encierre la corona", and pp. 6-7 draw the same rectangle). 6.1.5 dropped
  `geometry_input.mode: surface_regions`: the norm asks which surfaces are
  affected and then only writes the siglas in the box, so the mode promised a
  drawing that does not exist. The `surfaces` attribute stays — it is clinical
  data the norm requests, not a drawing instruction.

  Catalog metadata only. No record, no hash and no migration is touched:
  `canonical.py` never reads the catalog, so no finalized record can move.
  CLINICAL-01 to CLINICAL-05 all stay open; in particular no pilar cardinality,
  no mobility scale and no rotation vocabulary was invented.

- feat(nts-05c): **structured finding editor**. The chart becomes a capture
  surface: pick a rule from the catalog, fill the attributes it declares,
  select the targets its scope needs, and create the finding. Existing
  findings can be edited, have their target set replaced, be confirmed one at
  a time when carried forward, and be withdrawn.

  Everything is **catalog-driven**. There is no `switch (rule.rule_id)`, no
  list of the 38 findings in TypeScript and no clinical knowledge in a Vue
  component: `scope` decides what must be picked, `attributes` generates the
  controls, `target_roles` offers the roles, `anchor` asks for the spatial
  references, and `required` decides what blocks saving. The tests use
  **synthetic rules** with invented ids precisely so a pass cannot be
  explained by the code recognising a real one.

  Two consequences worth stating, because the visual reference gets them
  wrong. A removable orthodontic appliance is **arch**-scoped, so the editor
  shows an arch selector rather than a range picker — it reads `scope`, and
  the catalog and the norm both say arch. And a supernumerary tooth has no FDI
  cell, so its subject target is sent with `target_kind: unnumbered_tooth` and
  no tooth number, located by the two interproximal anchors the rule declares.
  Neither behaviour is coded per rule.

  **Surfaces are an attribute, not a target.** The API has no surface target
  kind, and the norm's own `surfaces` vocabulary (M/D/O/V/L) is carried by a
  catalog-declared `enum_multi`. Nothing geometric is ever sent: no SVG region
  id reaches the backend, and no region→surface mapping was invented, because
  the norm labels no side of the drawn crown. The free-form shape §6.1.16 and
  §6.1.33 describe is the pending geometry channel, not this.

  A finding and its targets are created in **one request** — the API takes
  them as one aggregate — so there is no half-created finding to reconcile and
  no client-side pretence of atomicity. Editing attributes and targets are two
  endpoints, and the second uses the version the first reported rather than the
  version the editor opened with. A 409 closes the editor, refetches through
  the same recovery 05A already had, and is never retried; a 422 stays open
  with every problem the server listed.

  The chart is interactive **only while a rule needs teeth**: outside that it
  has no tab stops and no pressed state, so a reader never meets 52 controls
  that lead nowhere. Selection styling uses interaction tokens — red and blue
  stay reserved for what a finding means.

  Still pending: the normative finding renderer (05D) and the Especificaciones
  editor (05E). 05C surfaces a requirement when a rule activates one and never
  marks it satisfied; only `required = true` is described as blocking, and the
  backend remains the authority on finalizing.

- feat(nts-05b): **the official dental layout**. `NtsOdontogramChart` replaces
  the shell's "renderer pending" region with the structure of the norm's own
  *Anexo: Gráfico del odontograma* (NTS N.° 188-MINSA/DGIESP-2022, p. 22):
  four rows stacked permanent upper → deciduous upper → deciduous lower →
  permanent lower, all 52 teeth, each with its FDI number and the annotation
  box the annex reserves beside it.

  Findings are still **not** drawn. A record that already carries some says so
  in words instead — an invented symbol on an odontogram is a false clinical
  statement, while an absent one at least reads as absent.

  Orientation comes from the annex, which prints 18 at the far left and 28 at
  the far right: screen-left is the patient's right, in all four rows. The FDI
  numbers are generated from the quadrants rather than listed by hand, and
  `dentition`, `arch`, `side`, `quadrant` and tooth class are derived from the
  number, never stored. There is no dentition toggle: the official format
  prints both dentitions, so an adult patient still gets all 52 cells.

  The tooth cell reproduces the annex's own geometry — a crown cut by its four
  corner diagonals, with the centre halved on premolars and quartered on
  molars, plus roots pointing away from the midline. Its regions are
  addressable but named **positionally** (`outer-top`, `center-1`…): which
  trapezoid is mesial depends on the quadrant, and that mapping belongs with
  the surface-scoped rules.

  Proportions are read off the annex and expressed as ratios, never as
  dimensions the norm states — it is a 300dpi scan, so its pixels are raster
  readings. Crown height is the same for every class while the width is not
  (molar ≈ 88, premolar ≈ 82, front teeth ≈ 61 against a height of ≈ 68), and
  the annex varies the whole column with it: the annotation box, the number
  and the tooth share one class-dependent width, which is what keeps a box
  over the tooth it belongs to. Roots run a little longer than the crown is
  tall (≈ 1.2×). The six front teeth do not get the posterior's central
  rectangle: the annex closes their diagonals onto a short segment, so their
  centre is a sliver and they read as envelopes rather than boxes.

  The deciduous arches are drawn at **the same size as the permanent ones**.
  The annex measures a deciduous molar at the width of a permanent molar and a
  deciduous incisor at the width of a permanent incisor; its deciduous rows
  are shorter only because they hold ten teeth instead of sixteen. One scale
  serves the whole chart, and the dentitions are told apart by position and by
  their FDI numbers rather than by being miniaturised.

  Upper premolars measure ~7% narrower than upper molars in the annex while
  lower premolars measure the same as lower molars. One width per tooth class
  is kept regardless: that difference is **raster/artwork variation tolerated,
  not a normative distinction**, and nothing in the norm's text supports an
  arch-dependent premolar.

  Chromatically neutral on purpose — the norm gives red and blue meaning, and
  spending them on decoration now would make them unreadable later. Stroke and
  fill are SVG presentation attributes rather than a stylesheet rule, so the
  outline cannot come back as a solid block if a CSS chunk fails to load.

  One scroll container holds all four rows: rows that scrolled independently
  would drift and put a deciduous tooth under the wrong permanent one. The
  canvas keeps a deterministic minimum width, derived from the widest row
  instead of shrinking teeth, so a narrow screen scrolls without the page
  itself overflowing and without the clinical order ever reflowing.

  No HTTP and no lifecycle state in the chart: the shell passes down the draft
  if there is one, otherwise the record in force as read-only, otherwise the
  blank form marked as standing for no clinical record.

- feat(nts-05a): **frontend data layer + lifecycle shell** for the MINSA
  odontogram. The NTS-02 placeholder is replaced by
  `NtsOdontogramShell.vue`, which talks to the B.3 API through
  `useNtsApi` (transport only) and `useNtsOdontogramRecord` (state only).
  This is **not** the clinical renderer: the chart region is explicitly
  marked pending, and the finding editor, geometry capture and signature
  are all still absent.

  What the shell does: load the catalog, the record in force, the open
  draft and the history; open an empty draft (`seed: 'empty'` always —
  carry-forward is not offered until findings can be reviewed one by one);
  finalize; discard with a reason. What it deliberately does not do:
  retry a 409 (it refetches the authoritative state and says what
  happened), infer `expected_version + 1` (every version comes from the
  server), or keep clinical data in `localStorage`.

  A load is guarded by a generation token and an `AbortController`, so a
  response for the previous patient can never land on the new one, and
  state is cleared before the first byte of the new patient arrives. The
  composable takes its patient and norm version as reactive sources rather
  than snapshots, so reusing the shell across patients reloads the right
  one.

  `types/nts.ts` mirrors `nts/schemas.py` and nothing else: the 38 rules
  arrive from `GET /nts/catalogs/{norm_version}`, never from a second
  hand-maintained copy in TypeScript.

  `DiagnosisMode` hides its two Original-shaped panels under the MINSA
  profile — the "registered conditions" card and the plan CTA are backed by
  `Treatment` rows with `status = 'existing'`, and presenting those as NTS
  findings would erase the distinction the norm draws between a *hallazgo*
  and a *procedimiento*. Under the Original profile they are unchanged; the
  data is untouched either way.

  Stage (`diagnosis` / `evolution` / `discharge` / `other` + free label) is
  product metadata, not a normative requirement.

- feat(nts-04b.3): **HTTP API** for NTS clinical records, mounted at
  `/api/v1/odontogram/nts` as its own subrouter — 16 endpoints across catalog,
  patient records, findings, targets, specifications and lifecycle. The
  Original profile's routes are untouched. No schema change, no migration.

  Permissions reuse `odontogram.read` / `odontogram.write`; no NTS-specific
  permission is introduced. `get_db()` keeps owning the transaction: the
  router never commits or rolls back, and a domain failure is re-raised as an
  `HTTPException` so the dependency actually rolls back — returning a 4xx
  normally would commit a half-applied mutation, and a test proves it does
  not. Domain errors map centrally to 404 / 409 / 422 with machine-readable
  codes (`nts_version_conflict`, `nts_state_conflict`, `nts_draft_conflict`,
  `nts_clinical_validation`, `nts_record_not_found`), and a clinical
  validation failure keeps its full list of problems instead of one string.

  Every mutation carries `expected_version` in the body — which is why
  removals are `POST .../remove` rather than `DELETE` with a body — and every
  mutation response reports the version the server actually reached, so no
  client infers `expected_version + 1`. Request schemas are `extra="forbid"`,
  so `clinic_id`, `actor_id`, `status`, `version` and the hash fields cannot
  be smuggled in. `PATCH` on a record distinguishes an absent key (leave
  alone) from an explicit `null` (clear), and `PUT` on a specification
  requires `finding_id` even when null so omitting it can never read as
  "unlink". `GET current` / `GET draft` answer `200` with `data: null` when
  there is none — only a named record that does not exist is a 404, and an
  unknown `norm_version` is distinguishable from an empty history.

  The catalog is served read-only (`GET /nts/catalogs`,
  `GET /nts/catalogs/{norm_version}`) so no client re-types the 38 rules in
  TypeScript; the catalog's own Pydantic models are the response schema.
  Record history is paginated and never loads findings or targets.

  Two read-only service additions this required: `list_records(...)` and a
  `clear_observations` flag on `update_metadata` (`None` already meant "leave
  unchanged", so clearing needed its own signal). The audit trail is **not**
  exposed: its access model and volume need their own design. Nothing here
  claims a digital signature, compliance or SIHCE accreditation.

- feat(nts-04b.2): **transactional service** for NTS clinical records —
  `nts/service.py`, `nts/validation.py`, `nts/audit.py`, `nts/exceptions.py`.
  No router, no endpoints, no schema change: `odo_0004` is untouched.

  Every mutation is compare-and-bump → validate → mutate → one audit event →
  flush, and the transaction belongs to the caller: the service flushes but
  never commits and never rolls back globally, so a caller's rollback loses
  the mutation, the version bump and the audit event together. One user
  operation is exactly one version bump, however many targets it moves. The
  bump is a single `UPDATE ... WHERE version = :expected AND status='draft'
  RETURNING version`, which also takes the parent row lock that serialises
  concurrent child writers; the identity map is resynchronised with
  `set_committed_value` so a stale ORM version can never be written back.

  Validation is entirely catalog-driven — attributes, scopes, anchors, arch
  cardinality, range grouping, target roles and required Especificaciones all
  derive from `get_nts_rule`. There is **no `rule_id` branch** in the service
  or the validators, and `notes` are never executable. A role cardinality the
  norm does not state is not invented: `pilar` stays optional. A
  `required=false` specification requirement (`crown_metal_colour`) is
  surfaced but never blocks finalize.

  Carry-forward copies findings, attributes, targets and finding-linked
  specifications for individual review, and deliberately does **not** copy
  observations or general specifications. Finalize is blocked while any
  carried-forward finding remains, and there is no bulk confirm. Finalize
  resolves the authorship snapshot of the *recorder*, sets the lifecycle
  fields and the SHA-256 of CanonicalSnapshotV1 without an intervening flush,
  and writes `supersession_recorded` against the **new** record — the
  predecessor is never touched. `finalized` means DenPlant locked the record;
  it does not mean the document is digitally signed and claims no compliance
  or accreditation.

- feat(nts-03.1): the catalog now expresses **target roles** and **required
  Especificaciones** structurally, so a consumer never branches on a `rule_id`.
  New `RoleDef` + `NtsRule.target_roles` replaces the `target_roles` *attribute*
  on 6.1.29 — a pilar is a property of one tooth inside the span, and having it
  in both places gave a target's role two sources; the validator now refuses an
  attribute by that name. New `SpecificationRequirement`, declarable on a rule
  or on a single `VariantValue`, plus
  `NtsRule.active_specification_requirements(attributes)`.

  Mapped from a fresh reading of the PDF: 6.1.4 rule-level and required
  (§6.1.4 p.7); 6.1.5 `dde_type=FLUOROSIS` variant-level and required (§6.1.5
  p.8); 6.1.3 rule-level but **`required=false` and flagged
  `needs_clinical_review`** — §6.1.3 (p.6-7) states it for the rule and names
  no crown_type condition, and `CLM` is metal-free, so no per-variant
  obligation was inferred. `pilar` is likewise flagged: §6.1.29 (p.16) mandates
  "líneas verticales sobre los pilares" but states no cardinality, so
  `min_count`/`max_count` stay unset — `None` means the norm is silent, never
  `0`. Rule-level and variant-level requirements are mutually exclusive because
  `nts_record_specifications` stores no requirement code. 38/38 rules intact;
  no schema, migration or persistence change.

- feat(nts-04b.1): NTS clinical record **persistence foundation**. Migration
  `odo_0004` creates the five tables of ADR 0021 — `nts_odontogram_records`,
  `nts_findings`, `nts_finding_targets`, `nts_record_specifications`,
  `nts_record_audit_events` — with their structural constraints and the first
  two triggers in the repo: `trg_nts_records_guard` (a finalized or discarded
  record is terminal; no NTS record is ever physically deleted) and
  `trg_nts_audit_append_only` (the audit trail takes INSERT only). Nothing in
  the Original profile is touched and no data is backfilled.

  Structure only: the DB enforces the lifecycle triples, `version >= 1`, the
  one-draft and linear-supersession-chain partial indexes, FDI validity
  (permanent *and* deciduous), target-kind column coherence with no sentinel
  tooth numbers, and — via composite foreign keys — that a finding cannot
  diverge from its record's `norm_version` and a specification cannot point at
  a finding of another record. A finding reaches its record through that one
  composite FK only: both its columns are NOT NULL, so it already guarantees
  parent existence, version equality and the cascade. Normative meaning stays
  in the catalog and the service, never in DDL.

  Geometry is refused at write time too: `ck_nts_target_geometry_pending`
  (`geometry IS NULL`) makes a stored shape structurally impossible while
  canonicalization version 1 is the only one implemented, so a draft can never
  accumulate a shape that would later block finalizing it. The future migration
  that introduces version 2 drops the CHECK. The three nullable JSONB columns
  use `none_as_null` so Python `None` becomes SQL NULL rather than the JSON
  value `null`.

  New `nts/canonical.py` implements **CanonicalSnapshotV1**: build → serialise
  → SHA-256, with a hand-written JSON emitter so a library upgrade can never
  change a stored record's digest. Version 1 refuses floats and any non-null
  `geometry` (GEOMETRY CONTRACT PENDING) rather than dropping them silently.
  Pinned by two golden vectors with literal expected bytes and digests.

  **Not implemented here:** router, endpoints, API schemas, the clinical
  service, operative compare-and-bump, carry-forward, finalize, discard,
  supersede, automatic audit-event generation, geometry capture, digital
  signature and NTS permissions. `finalized` means DenPlant locked the
  snapshot — **not** that the document is digitally signed, and no compliance
  or SIHCE accreditation is claimed.

- docs(nts-04a.2): design/ADR for the NTS clinical record model. **No code,
  no tables, no migrations** — `docs/technical/odontogram/nts-record-model.md`
  plus ADR 0021 (five-table hybrid relational + JSONB persistence model) and
  ADR 0022 (draft/discarded/finalized lifecycle, no hard delete, supersession
  instead of mutation, append-only audit trail, optimistic locking,
  carry-forward with individual review, `content_hash` over
  CanonicalSnapshotV1). ADR 0022 is written to be reviewable on its own by a
  legal/clinical reader. Records the explicit non-claims: `finalized` is not a
  digitally signed document and no compliance or SIHCE accreditation is
  asserted; the signature workstream is separate. Geometry storage stays
  **GEOMETRY CONTRACT PENDING** until the anatomical coordinate space is
  versioned. Implementation lands in NTS-04B.

- feat(nts-03): versioned normative catalog for NTS N.° 188-MINSA/DGIESP-2022
  under `nts/catalog/` — typed schema, structural validator, cached loader and
  the 38 rules of §6.1 as data (`pe_nts_188_2022.json`). Each rule records its
  scope, structured attributes, colour semantics, render marks, geometry source
  and the page/section it came from; the two misprinted headings in the PDF
  (6.1.15 as "6.115", 6.1.23 as "5.2.23") are preserved in `document_label`
  rather than normalised away. 15 of the 38 rules are **not** tooth-scoped
  (6 surface, 3 pair, 3 range, 3 arch), which is the constraint NTS-04 has to
  design around. Identity is `norm_version + rule_id`, never the sigla — the
  norm reuses "S" (6.1.26/6.1.35) and "M" (6.1.19/6.1.28), so cross-rule sigla
  collisions are explicitly not validation errors. Three items the norm leaves
  genuinely open (`rotation_sense`, `mobility_degree`, `dde_type=FLUOROSIS`)
  are flagged `needs_clinical_review` instead of being filled in from general
  dental knowledge. The catalog is cached (`functools.cache`) and therefore
  shared process-wide, so it is immutable *all the way down*: every collection
  is a tuple and `RenderMark.params` is a read-only mapping — without that, one
  `mark.params[...] = ...` poisoned the cache for every later caller (found by
  probe, fixed, regression-tested). Data only: no findings model, no persistence, no
  migrations, no endpoints and no renderer — §5.6 digital immutability is
  documented as an open NTS-04 gate, not implemented. Docs:
  `docs/technical/odontogram/nts-188-catalog.md` (includes the `preview.html`
  coverage matrix — 34/38, the 4 missing are the non-tooth-scoped prosthetic
  rules — and the legacy-vocabulary matrix).

- feat(nts-02): profile selector + profile-aware mount point. New
  `useOdontogramProfile` composable reads/persists the NTS-01 preference
  (`GET/PUT /api/v1/odontogram/preferences`); the local value changes only
  after a successful PUT, so selector and backend cannot drift, and a failed
  read falls back to `original`. `OdontogramProfileView` picks the renderer
  (`OdontogramChart` for `original`, `NtsOdontogramPlaceholder` for
  `pe_nts_188_2022`) and forwards props/listeners verbatim through `$attrs`;
  `OdontogramChart` itself stays untouched and profile-unaware — no
  `if (profile === ...)` inside it. `OdontogramProfileSelector` is wired into
  the `DiagnosisMode` card header only; `HistoryMode` and the treatment-plan
  chart keep rendering the original chart on purpose (swapping a working
  chart for a placeholder there would remove function without adding any).
  The backend remains the single source of truth — no localStorage mirror.
  Placeholder only: no teeth, findings, snapshots, NTS catalog or graphic
  rules yet.

- feat(nts-01): per-user, per-clinic odontogram profile preference
  (`original` | `pe_nts_188_2022`). New module-owned table
  `odontogram_user_preferences` (migration `odo_0003`) mirroring
  `notification_preferences` — core `User` / `ClinicMembership` are left
  untouched and `Clinic.settings` is deliberately not used, since that
  would impose one format on every member of the clinic. Endpoints
  `GET/PUT /api/v1/odontogram/preferences` derive `user_id` / `clinic_id`
  from the authenticated clinic context, so a caller can only read or
  write their own preference. Absence of a row means `original`; reads
  never create one and existing users are not backfilled. Gated by clinic
  membership only — picking a chart format is a personal UI choice, not a
  clinical operation, so no new `nts.*` permission is introduced yet.
  No renderer, snapshots, findings or NTS catalog in this change.

- security: enforce the central patient access policy for odontogram roots and treatment-ID routes.

- fix(#184): the layer type-checks clean under `nuxt typecheck`. Real bugs behind the errors: treatment colour dots read `TREATMENT_COLORS` (a `{light,dark}` config) as a hex string — they now go through `getTreatmentColor()`; the toast undo action used the v3 `click` key (v4: `onClick`), `UPopover :ui.width` is `content`; `TreatmentBar` emitted a possibly-undefined fallback status; touch drags on the timeline guard an empty `touches` list. Tooth-position lookups are typed by `ToothPosition` (1–8) instead of `|| MAP[1]` fallbacks.
- fix(#183): `TreatmentService.perform` publishes with `db=` so the payments earned ledger and the plan-item completion run in its transaction (ADR 0019).
- feat(events): `TreatmentService.perform` accepts `publish_price=False`
  to emit `odontogram.treatment.performed` with `unit_price: null` —
  the caller declares the revenue already attributed elsewhere
  (treatment_plan per-session billing). Default behaviour unchanged.

- style(lint): first ESLint pass over this module's frontend layer —
  module layers were outside the linter's base path until now, so
  CI had never checked them. Mostly auto-fixed formatting; see the
  PR for the handful of manual fixes.

- fix(frontend): render an error state with retry when the odontogram
  fetch fails, instead of falling through to a fabricated all-healthy
  32-tooth chart (audit S5, #95). Adds `odontogram.messages.loadError`.

- feat(ux): ``DiagnosisMode`` now publishes a ``treatmentsToothById`` map
  and an ``onTeethHover`` callback through the
  ``odontogram.diagnosis.sidebar`` slot ctx, so the clinical-notes
  sidebar can pulse the matching tooth on the chart when the user
  hovers/focuses a note. Reuses the existing ``hoveredTeeth`` →
  ``highlightedTeethProp`` plumbing on ``OdontogramChart``.
- feat(treatments): add ``crown_on_implant`` and
  ``provisional_crown_on_implant`` clinical types. Both render on the
  lateral view as a solid prosthetic fill on the crown path (same code
  path as ``bridge``) — the diagonal-stripes pattern used by regular
  ``crown`` looked too sparse / artificial for implant-supported
  restorations. The two new types appear in ``TreatmentPicker`` under
  the Restauradora category, and count as ``hasReplacementTreatment``
  so the underlying ``missing`` / ``extraction`` state stops fading
  the tooth.
- fix(ToothDualView): when a tooth carrying ``missing`` /
  ``extraction_indicated`` / ``extraction`` state receives a
  prosthetic replacement (implant, bridge, crown, pontic,
  bridge_abutment, overlay, inlay, unerupted), render the tooth at
  full opacity — the restoration supersedes the extracted state.
  Also suppress the dashed/solid X overlays (occlusal + lateral) on
  those teeth, so the X no longer paints over the implant/crown.
  Previously, SVG-level opacity (and the wrapper ``.transparent``
  0.4 dim) faded both the natural anatomy and every overlay, so a
  newly placed implant on an extracted tooth rendered almost
  invisible. Opacity now applies only to natural-anatomy paths and
  only when no replacement is present.
- fix(DiagnosisMode): hide treatments whose
  ``source_module === 'migration_import'`` from the Diagnóstico panel.
  Migrated patients arrived with their entire chart history (often
  decades of crowns, fillings and extractions) flooding the active
  diagnosis workflow. The artefacts remain visible on the odontogram
  via ``ToothRecord.general_condition``, and the historical record
  stays in the History tab + the auto-generated treatment plans.
- refactor(types): drop the ``as unknown as Record<string, unknown>`` cast in ``useTreatments`` now that ``useApi`` accepts ``object`` payloads.
- Added per-module `CLAUDE.md` for AI-agent context (2026-04-27).
- Issue #60: `DiagnosisMode.vue` exposes a right-rail
  `odontogram.diagnosis.sidebar` slot (with mobile slideover) and
  `ConditionsList.vue` exposes a per-treatment
  `odontogram.condition.actions` slot. The clinical_notes module fills
  both — odontogram itself does not depend on it.

## 0.3.0 — initial documented version

- Per-tooth state with surface granularity, JSONB-backed.
- Tooth treatment workflow with `added` / `status_changed` /
  `performed` / `deleted` events.
- Drives budget + treatment_plan sync via `odontogram.treatment.performed`.
