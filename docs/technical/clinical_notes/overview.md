---
module: clinical_notes
last_verified_commit: 0000000
---

# Clinical Notes — technical overview

> _Scaffolded stub — replace with proper documentation when this module is next touched._

Auto-discovered facts about the `clinical_notes` module. See the module's
own notes at `backend/app/modules/clinical_notes/CLAUDE.md` for context
the scaffold could not infer.

## API surface

- `DELETE /api/v1/clinical_notes/notes/{note_id}`
- `GET /api/v1/clinical_notes/attachments`
- `GET /api/v1/clinical_notes/note-templates`
- `GET /api/v1/clinical_notes/notes`
- `GET /api/v1/clinical_notes/patients/{patient_id}/by-plan`
- `GET /api/v1/clinical_notes/patients/{patient_id}/recent`
- `GET /api/v1/clinical_notes/treatment-plans/{plan_id}/merged`
- `PATCH /api/v1/clinical_notes/notes/{note_id}`
- `POST /api/v1/clinical_notes/notes`

## Frontend

_This module ships no Nuxt pages._

## Evolución tab (QW4)

The patient's Clinical tab has a fifth mode, **Evolución**, filled by this module
through the `patient.clinical.evolution` slot (`EvolutionNotesView.vue`).

- **Data:** `GET /patients/{id}/recent` with `types=evolution|diagnosis|treatment|treatment_plan|appointment_clinical`
  (never the administrative types). 20 per page on screen; `limit=100` when printing.
- **Writing:** "+ Nueva evolución" creates `note_type='evolution'`, `owner_type='patient'`,
  no tooth. From Diagnóstico, "Añadir nota" deep-links with
  `?clinicalMode=evolution&newNote=diagnosis&tooth=<FDI>` to open a diagnosis note bound
  to that tooth; the parameters are removed once read.
- **Printing:** "Imprimir evolución" loads every page, de-duplicates by id, stops if the
  cursor does not advance (and says the printout is incomplete), sorts oldest first and
  calls `window.print()`. Attachments print as name + type. CSS: `.evolution-print-root`.
- **Gap:** legacy `AppointmentTreatment.notes` (agenda) are not part of the feed.
- **Migration:** `cn_0005` (CHECK constraints only).

## Permissions

`notes.read`, `notes.write`

See [`./permissions.md`](./permissions.md) for the full role mapping.

## Events

- **Emits:** _(none)_
- **Subscribes:** _(none)_

module participates in the event bus).

## See also

- Module CLAUDE notes: `backend/app/modules/clinical_notes/CLAUDE.md`
- [Documentation portal contract](../../technical/documentation-portal.md)
