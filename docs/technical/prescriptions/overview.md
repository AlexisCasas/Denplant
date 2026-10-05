---
module: prescriptions
last_verified_commit: 9e40e4f1
---

# Prescriptions — technical overview

Medication prescriptions written by a dentist, **for printing and handwritten
signature**. So far this is the backend: model, migration, security, API and an
A4 PDF rendered on demand. There is no frontend and no event yet.

It is **not** an electronic prescription: nothing is digitally signed, and the
module has no pharmacy or DIGEMID integration and no drug knowledge (no
catalog, dose calculation or interaction checks). It is also unrelated to
`patients_clinical.Medication`, which records what a patient *takes*.

## Lifecycle

```
POST  → issued ──void (reason)──► voided
```

No draft is persisted: the client sends the whole prescription once and the
server creates the prescription and its items in a single transaction. An issued
prescription is never edited or deleted. To correct one, void it and issue a new
one.

## API surface

- `POST /api/v1/prescriptions` — issue
- `GET /api/v1/prescriptions?patient_id=…` — history, newest first
- `GET /api/v1/prescriptions/{prescription_id}` — detail
- `POST /api/v1/prescriptions/{prescription_id}/void` — void
- `GET /api/v1/prescriptions/{prescription_id}/pdf` — A4 PDF, optional `?locale=es|en`

No `PUT`, `PATCH` or `DELETE`.

## Frontend (read-only)

Layer at `backend/app/modules/prescriptions/frontend/`, no navigation. The
"Recetas" mode of the Clinical tab renders the slot
`patient.clinical.prescriptions` (permission `prescriptions.read`).

- `PrescriptionsView` — paginated history (10 per page), two actions per row:
  view and print.
- `PrescriptionDetailModal` — snapshots, items by position, date of birth (no
  age); a voided prescription shows `ANULADA`, the reason and the instant.
- `usePrescriptions` — local state, `AbortController` + generation token, PDF flow.

Rules: the Clinical tab's `readonly` flag is never used to decide anything about
prescriptions; date-only values are formatted without UTC parsing; the PDF is
fetched with the user's token, refreshed at most once on 401, opened in a window
created inside the click (download fallback when blocked).

## Data

| Table | Holds |
|---|---|
| `prescriptions` | header, `item_count`, status, void fields, numbering and the identity snapshots |
| `prescription_items` | medications, free text; composite FK `(prescription_id, clinic_id)` |
| `prescription_counters` | last number per `(clinic_id, year)` |

Snapshots are taken at issue so a prescription never rewrites itself: patient
(name, national id and type, date of birth), prescriber (name, registration
number) and clinic (name, legal name, tax id, address as one flattened line,
phone). The age is not stored; it is derived later from the date of birth and
`issue_date`.

## Numbering

`RX-{year}-{sequence:06d}`, unique per clinic, where the year is the clinic's
**local** year (`Clinic.timezone`). The sequence comes from one atomic
`INSERT … ON CONFLICT DO UPDATE … RETURNING` on `prescription_counters`, inside
the issuing transaction, so concurrent issues take turns and a rollback gives the
number back.

## Immutability

Enforced by two database triggers (frozen in migration `pres_0001`, attached to
`create_all` for the test database):

- `prescriptions_guard` — no DELETE; only `issued → voided`; only `status`,
  `voided_at`, `voided_by`, `void_reason` may differ.
- `prescription_items_guard` — no UPDATE or DELETE; INSERT only into an issued
  prescription and only at a `position <= item_count`.
- `trg_prescriptions_complete` — a deferred constraint trigger: at COMMIT a
  prescription must hold exactly the `item_count` items it declared.

Together with the unique `(prescription_id, position)`, the header's own
immutable `item_count` **closes the set of items**: after the issuing
transaction commits every position is taken, so a later `INSERT INTO
prescription_items` is impossible. There is no draft state, no session
setting and no time window, and a rollback removes the header, the items and
the counter together.

## Rules in the service

Who may issue (`dentist` with a registration number), who may void (original
prescriber or admin), patient scope (`PatientAccessPolicy`), the required date of
birth and the required `valid_until` live in `PrescriptionService`, because the
permission table cannot express them. See the module `CLAUDE.md`.

## The PDF

An A4 sheet for printing and **handwritten** signature. It is not an electronic
prescription and nothing is digitally signed; it says so and leaves a line for
the prescriber's signature and stamp.

- **Rendered on every request**, never stored: no file, hash, audit event or
  domain event, and nothing is written.
- **Frozen content**: every name, number, address, medication and date comes from
  the prescription's snapshots; the age is measured at `issue_date`
  (`< 1 year` is written in months). Only the **logo** is live: a reprint carries
  the clinic's current branding, and a missing logo never blocks the print.
- **Voided** prescriptions print with all their content under an `ANULADA`
  watermark on every page and a banner; the void reason, date and actor are not
  printed.
- **Pages**: full header on page 1, then a short strip (number, patient,
  `Página X de Y`); medications do not split when they fit; the signature follows
  the last medication in normal flow.
- **Response**: `Content-Type: application/pdf`, `Content-Disposition: inline;
  filename="receta-RX-YYYY-NNNNNN.pdf"` (from the number alone), `Cache-Control:
  no-store`, `X-Content-Type-Options: nosniff`.
- **Locale**: `?locale=es|en`, else the clinic's `communication_language`, else Spanish.
- **Errors**: 503 `pdf_unavailable` when WeasyPrint cannot be loaded, 500
  `pdf_render_failed` when rendering fails; never HTML served as a PDF.
- **Security**: all human text is HTML-escaped; the renderer loads `data:`
  resources only.

## Known limits

- An admin who is also a dentist cannot issue from an admin account.
- `PatientAccessPolicy` excludes archived patients, so their prescriptions are
  not readable until a cross-cutting policy exists.
- The logo, when a printout exists, will be the clinic's branding at the time of
  printing, not a snapshot.
