# Changelog — prescriptions module

## Unreleased

- feat: **A4 PDF of a prescription** (`GET /prescriptions/{id}/pdf`, `prescriptions.read`, `?locale=es|en`). Rendered on every request with WeasyPrint from the prescription's own snapshots, for printing and handwritten signature - not an electronic prescription, nothing is digitally signed, and nothing is stored, hashed or audited.
  - Every name, number, address, medication and date comes from the `*_snapshot` columns; the age is measured at `issue_date` (`age.py`: years from one year of age, months below it, a 29-Feb birthday is 1 March in a common year). Only the clinic logo is live, and a missing logo or a storage failure never blocks the print.
  - A voided prescription prints with all its content under an `ANULADA` watermark on every page and a banner; the void reason, date and actor are not printed.
  - Page 1 has the full clinic header; pages 2+ a short strip (number, patient, page X of Y). The signature follows the last medication in normal flow.
  - Headers: `Content-Type: application/pdf`, `Content-Disposition: inline` with `receta-RX-YYYY-NNNNNN.pdf`, `Cache-Control: no-store`, `X-Content-Type-Options: nosniff`.
  - Text is HTML-escaped and the renderer loads `data:` resources only. WeasyPrint missing is 503 `pdf_unavailable`, a render failure 500 `pdf_render_failed`; HTML is never served as `application/pdf`.
  - Tests share fixtures through `tests/prescriptions_fixtures.py`.

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
- Out of scope, on purpose: frontend, events, AI tools,
  any drug knowledge, and any link with `patients_clinical.Medication`.
