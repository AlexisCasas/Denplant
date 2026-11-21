---
module: media
last_verified_commit: 0000000
---

# Media — events

> _Scaffolded stub — replace with proper documentation when this module is next touched._

Per-module slice of [`docs/events-catalog.md`](../../events-catalog.md)
(auto-generated). Update both files when adding or removing events.

## Published

_This module does not publish any events._

## Subscribed

| Event | Handler | Mode | Effect |
|-------|---------|------|--------|
| `patient.archived` | `__init__.py::MediaModule._on_patient_archived` | transactional (ADR 0019) | Soft-archive the patient's documents, atomically with the archive itself. |
| `patient.restored` | `__init__.py::MediaModule._on_patient_restored` | transactional | Restore lifecycle-archived documents; historic rows follow the documented fallback. |
| `patient.permanent_delete_requested` | `__init__.py::MediaModule._on_patient_permanent_delete` | transactional | Queue storage purges and remove document rows before the patient row is deleted. |

## Adding a new event

1. Add the constant to `backend/app/core/events/types.py` (`EventType`).
2. Publish from a service method after `flush()` — the bus runs handlers
   inline, *before* the request commits. Pass `db=db` so transactional
   subscribers can join the transaction (ADR 0019, issue #183).
3. Add the row to the table(s) above.
4. Run `python backend/scripts/generate_catalogs.py` to refresh the
   global catalog.
