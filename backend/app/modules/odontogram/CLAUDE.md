# Odontogram module

Dental charting: tooth state, surfaces, conditions, clinical
treatments per tooth.

## Public API

Routes mounted at `/api/v1/odontogram/`.

## Dependencies

`manifest.depends = ["patients", "catalog"]`.

## Permissions

`odontogram.read`, `odontogram.write`,
`odontogram.treatments.read`, `odontogram.treatments.write`.

## Events emitted

- `odontogram.treatment.added`
- `odontogram.treatment.status_changed`
- `odontogram.treatment.performed`
- `odontogram.treatment.deleted`

(Surface/tooth update events `odontogram.surface.updated`,
`odontogram.tooth.updated`, `odontogram.condition.changed` are declared
in `EventType` but not yet emitted by code — TODO.)

## Events consumed

None.

## Lifecycle

- `removable=False`. Treatment_plan, budget depend on tooth treatments.

## NTS profiles (`nts/`)

`nts/catalog/` holds versioned, read-only descriptions of national
odontogram norms. Today: `pe_nts_188_2022` (NTS N.° 188-MINSA/DGIESP-2022,
38 rules). Load with `get_nts_catalog(version)` / `get_nts_rule(id, version)`.

It is **data only** — no findings model, no persistence, no endpoints, no
renderer. Full reference:
[`docs/technical/odontogram/nts-188-catalog.md`](../../../../docs/technical/odontogram/nts-188-catalog.md).

`nts/models.py` + migration `odo_0004` are the **persistence foundation**:
five tables (`nts_odontogram_records`, `nts_findings`, `nts_finding_targets`,
`nts_record_specifications`, `nts_record_audit_events`) plus two structural
triggers. `nts/canonical.py` implements CanonicalSnapshotV1 (build →
serialise → SHA-256).

`nts/service.py` is the transactional clinical layer (`NtsRecordService`),
with `nts/validation.py` (catalog-driven), `nts/audit.py` (audit-state
serialization) and `nts/exceptions.py` (domain errors, mapped to HTTP by
B.3). The service **flushes but never commits**: the transaction belongs to
the caller.

`nts/router.py` + `nts/schemas.py` expose it at **`/api/v1/odontogram/nts`**,
gated by the existing `odontogram.read` / `odontogram.write`. The router never
commits or rolls back — `get_db()` owns the transaction — and it re-raises
domain errors as `HTTPException` so a 4xx actually rolls back.

`frontend/composables/useNtsApi.ts` (transport),
`frontend/composables/useNtsOdontogramRecord.ts` (lifecycle state) and
`frontend/components/odontogram/NtsOdontogramShell.vue` are the **data layer
and lifecycle shell** (NTS-05A): catalog, record in force, draft, history,
plus create-empty-draft / finalize / discard. `frontend/types/nts.ts` mirrors
`nts/schemas.py` only — the rules come from the catalog endpoint.

`frontend/utils/ntsDentition.ts` +
`frontend/components/odontogram/Nts{OdontogramChart,DentitionRow,ToothCell}.vue`
are the **dental layout** (NTS-05B): the four rows of the norm's Anexo, all 52
teeth, FDI numbering and per-tooth base geometry. Layout only — no finding is
drawn on it.

Still **not** implemented: the finding renderer and editor, geometry capture,
signature, an audit-trail endpoint, NTS-specific permissions.

See [`nts-record-model.md`](../../../../docs/technical/odontogram/nts-record-model.md),
[ADR 0021](../../../../docs/adr/0021-nts-record-persistence-model.md) and
[ADR 0022](../../../../docs/adr/0022-nts-lifecycle-auditability-concurrency.md).

## Gotchas

- **FDI numbering is strict** (11–48 permanent, 51–85 deciduous).
  Validate at the boundary; don't trust caller-supplied tooth ids.
- **Treatments fired on `performed`** are the trigger for budget +
  treatment_plan sync. Idempotency matters — a re-fire must not
  double-charge.
- **`unit_price: null` on `treatment.performed` is a contract**, not a
  missing field: `perform(publish_price=False)` is how treatment_plan
  finalizes a sessioned item whose amounts were already booked
  per-session by payments. Subscribers must not attribute revenue when
  the price is null.
- **Surface state lives in JSONB** (`constants.py` defines the keys).
  Migrations that change the shape must include data migrations.
- **NTS findings are not all tooth-scoped.** 15 of the 38 rules are
  surface/pair/range/arch. Keying an NTS finding by a single tooth number —
  the shape this module's own `ToothRecord` uses — silently drops them.
- **An NTS rule is identified by `norm_version + rule_id`, never by its
  sigla.** The norm reuses "S" (6.1.26/6.1.35) and "M" (6.1.19/6.1.28); a
  cross-rule sigla collision is normative, not a data defect.
- **`OdontogramChart.vue` stays profile-unaware.** Renderer selection lives
  in `OdontogramProfileView`; do not add `if (profile === ...)` to the chart.
- **The NTS chart always draws 52 teeth.** 32 permanent + 20 deciduous, no
  dentition toggle: the norm's own format prints both, so an adult patient
  still gets the full form. Do not reuse a helper that only admits 11–48.
- **Screen-left is the patient's right.** The Anexo prints 18 at the far left
  and 28 at the far right; `NTS_ROWS` encodes that and is the only place row
  order may be defined.
- **Crown regions are named positionally, not clinically.** `outer-top` is not
  "vestibular": which trapezoid is which depends on the quadrant, and that
  mapping belongs with the surface-scoped rules, not with the layout.
- **Column width follows the tooth class, not a fixed grid.** The annex draws
  molars widest, premolars narrower and the six front teeth narrowest, at a
  constant crown height, and the annotation box and FDI number share that
  width. `cellWidthFor()` is the single source; do not reintroduce a uniform
  column.
- **Anteriors are envelopes, not boxes.** Their diagonals close onto a short
  central segment. Only premolars and molars get a real central rectangle.
- **The annex's pixel measurements are raster readings, not legal
  dimensions.** Use them as ratios; never write "the norm requires 88px".
- **Deciduous teeth are the same size as permanent ones.** The annex scales
  nothing down: its deciduous rows are shorter because they hold ten teeth.
  One chart scale, no per-dentition factor.
- **One premolar width for both arches.** The annex draws upper premolars
  ~7% narrower than upper molars but lower premolars as wide as lower molars;
  that is raster/artwork variation tolerated, not a normative distinction. Do
  not add an arch-dependent rule without normative evidence.
- **Red and blue belong to the findings.** The norm gives those two colours
  meaning; the layout stays neutral so they still read when the finding
  renderer needs them.
- **Never present a `Treatment` as an NTS finding.** The norm separates
  *hallazgo* from *procedimiento*; `DiagnosisMode`'s conditions card and plan
  CTA are `Treatment`-backed and are therefore hidden under the MINSA
  profile, not reused.
- **The frontend never hardcodes the norm.** No rule ids, siglas or scopes in
  TypeScript: `GET /nts/catalogs/{norm_version}` is the only source, and a
  `const NTS_RULES = [...]` would be a second manual copy of a legal norm.
- **NTS clinical state never goes into `localStorage`.** The record lives on
  the server; a browser copy would be a second truth.
- **NTS records are never deleted and finalized ones never updated** — a DB
  trigger refuses both. Corrections are a new record with
  `supersedes_record_id`; abandonment is `status='discarded'`.
- **`nts_record_audit_events` is append-only** (trigger). Never UPDATE or
  DELETE it.
- **Every NTS mutation must compare-and-bump `records.version` first**, in the
  same transaction, and write one audit event. Zero rows updated → 409.
  `NtsRecordService` already does this; go through it rather than writing to
  the tables directly.
- **Never branch on a `rule_id`.** Attributes, scopes, anchors, roles and
  required Especificaciones all come from `get_nts_rule`. A missing piece of
  normative metadata is a catalog ticket, not an `if` in the service.
- **A cardinality the norm does not state is not a constraint.** `min_count` /
  `max_count` of `None` mean silence; do not turn it into a requirement.
- **Never return a 4xx from an NTS handler without raising.** Returning it
  normally would let `get_db()` commit a half-applied mutation. Go through
  the router's `_guard` helper.
- **Every NTS mutation takes `expected_version` in the body**, which is why
  removals are `POST .../remove` and not `DELETE`.
- **Do not store geometry yet.** The column exists but
  `ck_nts_target_geometry_pending` (`geometry IS NULL`) and
  CanonicalSnapshotV1 both refuse a non-null value: GEOMETRY CONTRACT
  PENDING. Enabling it means a migration dropping that CHECK *and*
  canonicalization version 2.
- **`nts_findings` reaches its record through one composite FK**
  (`record_id, norm_version`). Do not add a second FK on `record_id` alone —
  it adds nothing and splits the ORM join into two paths.

## Related ADRs

- `docs/adr/0001-modular-plugin-architecture.md`
- `docs/adr/0003-event-bus-over-direct-imports.md`

## CHANGELOG

See `./CHANGELOG.md`.
