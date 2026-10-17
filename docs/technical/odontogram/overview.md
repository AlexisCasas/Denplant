---
module: odontogram
last_verified_commit: 0000000
---

# Odontogram — technical overview

Auto-discovered facts about the `odontogram` module. See the module's
own notes at `backend/app/modules/odontogram/CLAUDE.md` for context
the scaffold could not infer.

## API surface

- `DELETE /api/v1/odontogram/treatments/{treatment_id}`
- `GET /api/v1/odontogram/patients/{patient_id}/history`
- `GET /api/v1/odontogram/patients/{patient_id}/odontogram`
- `GET /api/v1/odontogram/patients/{patient_id}/odontogram/at`
- `GET /api/v1/odontogram/patients/{patient_id}/odontogram/timeline`
- `GET /api/v1/odontogram/patients/{patient_id}/teeth/{tooth_number}`
- `GET /api/v1/odontogram/patients/{patient_id}/teeth/{tooth_number}/full`
- `GET /api/v1/odontogram/patients/{patient_id}/teeth/{tooth_number}/history`
- `GET /api/v1/odontogram/patients/{patient_id}/treatments`
- `GET /api/v1/odontogram/treatments/{treatment_id}`
- `PATCH /api/v1/odontogram/patients/{patient_id}/teeth/bulk`
- `PATCH /api/v1/odontogram/patients/{patient_id}/teeth/{tooth_number}`
- `PATCH /api/v1/odontogram/treatments/{treatment_id}/perform`
- `POST /api/v1/odontogram/patients/{patient_id}/treatments`
- `PUT /api/v1/odontogram/patients/{patient_id}/teeth/{tooth_number}`
- `PUT /api/v1/odontogram/treatments/{treatment_id}`

## Therapeutic visualization snapshots

`TreatmentOdontogramMapping` remains clinic-local catalog configuration. When
the odontogram creates a treatment from a mapped catalog item, it copies the
effective therapeutic representation into `treatments.visualization_snapshot`:

```json
{
  "schema_version": 1,
  "odontogram_treatment_type": "crown",
  "visualization_rules": [{"layer": "cenital_pattern", "pattern": "diagonal_stripes", "color": "#F59E0B"}],
  "visualization_config": {"color": "#F59E0B"},
  "clinical_category": "restauradora"
}
```

The value is immutable after creation. Catalog price, mapping, status and
session changes must not alter it. `TreatmentResponse` and the nested
`treatment_plan.TreatmentBrief` expose it as `visualization_snapshot`.
Treatments created before migration `odo_0005`, and valid treatments without a
catalog mapping, expose `null`; clients must preserve their existing fallback
instead of interpreting current catalog configuration as historical truth.

The Plan consumes this field through the pure
`frontend/utils/therapeuticVisualization.ts` adapter and renders its output in
`NtsTherapeuticLayer.vue`. Only the version-1 layers `pulp_fill`,
`occlusal_surface`, `lateral_icon` and `cenital_pattern` are supported. A
missing, partial or unsupported snapshot emits no therapeutic instructions, so
the existing generic Plan marker remains visible. Cancelled plan items emit no
therapeutic layer; pending is translucent and completed/performed is opaque.
The base NTS geometry, MINSA findings, and clinical selection flows are not
owned by this renderer. H2.3 composes overlays independently of API arrival:
surfaces, pulp, coverage, lateral icons, bridge connectors, state decorators,
then an accessible active-treatment counter. `cancelled` plan items remain in
detail/history but are excluded from the active counter. The contextual Plan
legend is derived from the layers, bridges, global treatments and states that
are actually visible; it never uses the diagnostic MINSA legend.

DP-08.A keeps the Plan overlay aligned with the diagnostic geometry:

- `frontend/utils/ntsTherapeuticGeometry.ts` is the only place the overlay
  resolves anchors. Surfaces come from `resolveSurfaceRegions` (the same
  side/arch mapping as the diagnosis, so M/D/V/L are right in all four arches
  of both dentitions), icons from `apexPoint`/`toothPlacement`, and the pulp
  fill grows from the crown side of the root box in either arch. For
  `lateral_icon` a positive `offsetY` pulls the icon from its anchor towards
  the crown and a negative one pushes it past the apex.
- `cenital_pattern` honours the catalog values (`diagonal_stripes`,
  `horizontal_stripes`, `dots`, `grid`, `solid`, `outline`); a rule without a
  pattern keeps diagonal stripes and an unknown value draws a plain outline.
  `occlusal_surface` draws the real surface polygons, filled or `outline`.
- An icon with no symbol in `LateralViewIcons.ts` (for example `splint`) is
  drawn as a dashed diamond on the crown and listed in the legend as an icon
  without a defined symbol. A specific symbol needs clinical validation first.
- Cancelled plan items are removed from the chart altogether (layers, outline,
  dots, roles, bridge connectors, global strip, counter, legend); they stay in
  the Plan list and history. Counts are also published as a screen-reader list
  next to the chart because the SVG is `aria-hidden`.
- Stored snapshots are never modified; `null`, old and future snapshots keep
  the generic outline-and-dot fallback.

## Frontend

_This module ships no Nuxt pages._

## Permissions

`read`, `write`, `treatments.read`, `treatments.write`

See [`./permissions.md`](./permissions.md) for the full role mapping.

## Events

- **Emits:** _(none)_
- **Subscribes:** _(none)_

module participates in the event bus).

## See also

- Module CLAUDE notes: `backend/app/modules/odontogram/CLAUDE.md`
- [Documentation portal contract](../../technical/documentation-portal.md)
