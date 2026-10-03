---
module: prescriptions
last_verified_commit: 9e40e4f1
---

# Prescriptions — technical overview

Medication prescriptions written by a dentist, **for printing and handwritten
signature**. Phase A (this document) is the backend: model, migration, security
and API. There is no PDF, no frontend and no event yet.

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

No `PUT`, `PATCH` or `DELETE`.

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

## Known limits

- An admin who is also a dentist cannot issue from an admin account.
- `PatientAccessPolicy` excludes archived patients, so their prescriptions are
  not readable until a cross-cutting policy exists.
- The logo, when a printout exists, will be the clinic's branding at the time of
  printing, not a snapshot.
