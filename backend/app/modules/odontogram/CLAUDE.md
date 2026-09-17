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

## Related ADRs

- `docs/adr/0001-modular-plugin-architecture.md`
- `docs/adr/0003-event-bus-over-direct-imports.md`

## CHANGELOG

See `./CHANGELOG.md`.
