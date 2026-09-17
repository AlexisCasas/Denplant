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

Still **not** implemented: frontend/renderer, geometry capture, signature,
an audit-trail endpoint, NTS-specific permissions.

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
