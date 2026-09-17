# Changelog — odontogram module

## Unreleased

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
