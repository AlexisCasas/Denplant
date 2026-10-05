---
module: prescriptions
last_verified_commit: 588f47b
---

# Prescriptions — events

Per-module slice of [`docs/events-catalog.md`](../../events-catalog.md)
(auto-generated). Update both files when adding or removing events.

## Published

This module does not publish any events. Issuing and voiding a prescription
change only the module's own tables.

## Subscribed

This module has no event handlers (`get_event_handlers()` returns `{}`).

It does not write to the patient timeline either. There is no
`prescription.issued` or `prescription.voided` event in this release.

## Adding a new event

Events are added when there is a real consumer (for example the patient
timeline showing issued prescriptions). Then:

1. Add the constant to `backend/app/core/events/types.py` (`EventType`).
2. Publish from the relevant service method, after the DB commit.
3. Add the row to the *Published* table above.
4. Run `python backend/scripts/generate_catalogs.py` to refresh the global
   catalog.
