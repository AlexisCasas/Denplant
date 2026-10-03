# Changelog — prescriptions module

## Unreleased

- feat: **new module — backend base (phase A).** Issue, list, read and void
  medication prescriptions written by a dentist, for printing and handwritten
  signature. This is not an electronic prescription and nothing is digitally
  signed.
  - Tables `prescriptions`, `prescription_items`, `prescription_counters`
    (migration `pres_0001`, branch `prescriptions`).
  - Numbers `RX-{clinic-local year}-{sequence:06d}` from an atomic per-clinic,
    per-year counter; unique per clinic; a rollback gives the number back.
  - Issuing creates the prescription and its items in one transaction. Patient,
    prescriber and clinic identity are snapshotted at issue.
  - An issued prescription is immutable: database triggers admit only
    `issued → voided`, changing only the four void columns; items admit no
    UPDATE or DELETE. There is no `PUT`/`PATCH`/`DELETE` endpoint.
  - The set of items is closed at issue: the header carries an immutable
    `item_count`, an item INSERT is accepted only at `position <= item_count`
    (and `(prescription_id, position)` is unique), and a deferred constraint
    trigger checks at COMMIT that exactly `item_count` items exist. A late
    `INSERT` of an item, on an issued or a voided prescription, is impossible
    at the database level without any transient state.
  - Only a `dentist` with a registration number may issue; only the original
    prescriber or an admin may void, with a mandatory reason.
  - The patient's date of birth is required; `valid_until` is required with no
    default.
- Out of scope in this phase, on purpose: PDF, frontend, events, AI tools,
  any drug knowledge, and any link with `patients_clinical.Medication`.
