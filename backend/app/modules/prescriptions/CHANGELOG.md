# Changelog — prescriptions module

## Unreleased

- feat: **new module — immutable, printable medication prescriptions.** A dentist
  writes a prescription for a patient, prints it as an A4 PDF and signs it by
  hand; an issued prescription is never edited or deleted, only voided. This is
  not an electronic prescription and nothing is digitally signed.

  - **Backend: issue, list, read, void.**
    - Tables `prescriptions`, `prescription_items`, `prescription_counters`
      (migration `pres_0001`, branch `prescriptions`).
    - Numbers `RX-{clinic-local year}-{sequence:06d}` from an atomic per-clinic,
      per-year counter; unique per clinic; a rollback gives the number back.
    - Issuing creates the prescription and its items in one transaction. Patient,
      prescriber and clinic identity are snapshotted at issue. The patient's date
      of birth is required and `valid_until` is required with no default.
    - An issued prescription is immutable: database triggers admit only
      `issued → voided`, changing only the four void columns; items admit no
      UPDATE or DELETE. There is no `PUT`/`PATCH`/`DELETE` endpoint.
    - The set of items is closed at issue: the header carries an immutable
      `item_count`, an item INSERT is accepted only at `position <= item_count`
      (and `(prescription_id, position)` is unique), and a deferred constraint
      trigger checks at COMMIT that exactly `item_count` items exist. A late
      `INSERT` of an item, on an issued or a voided prescription, is impossible
      at the database level without any transient state.
    - Only a `dentist` with a registration number may issue (the admin wildcard
      does not suffice); only the original prescriber or an admin may void, with
      a mandatory reason.

  - **A4 PDF** (`GET /prescriptions/{id}/pdf`, `prescriptions.read`,
    `?locale=es|en`), rendered on every request with WeasyPrint from the
    prescription's own snapshots. Nothing is stored, hashed or audited.
    - Every name, number, address, medication and date comes from the `*_snapshot`
      columns; the age is measured at `issue_date` (`age.py`: years from one year
      of age, months below it, a 29-Feb birthday is 1 March in a common year).
      Only the clinic logo is live, and a missing logo or a storage failure never
      blocks the print.
    - A voided prescription prints with all its content under an `ANULADA`
      watermark on every page and a banner; the void reason, date and actor are
      not printed.
    - Page 1 has the full clinic header; pages 2+ a short strip (number, patient,
      page X of Y). The signature line follows the last medication in normal flow.
    - Headers: `Content-Type: application/pdf`, `Content-Disposition: inline` with
      `receta-RX-YYYY-NNNNNN.pdf`, `Cache-Control: no-store`,
      `X-Content-Type-Options: nosniff`.
    - Text is HTML-escaped and the renderer loads `data:` resources only.
      WeasyPrint missing is 503 `pdf_unavailable`, a render failure 500
      `pdf_render_failed`; HTML is never served as `application/pdf`.

  - **Frontend: "Recetas" in the patient's Clinical tab** (between Citas and
    Histórico, visible with `prescriptions.read`).
    - Manifest `frontend: {layer_path: "frontend", navigation: []}`; the layer
      registers the slot `patient.clinical.prescriptions` and `patients` never
      imports it.
    - History (10 per page, newest first, own Anterior / Página X de Y /
      Siguiente paginator), a detail modal with the snapshots and the items, and
      the authenticated PDF (window opened inside the click, one refresh retry on
      401, download fallback if the popup is blocked).
    - Date-only fields are never parsed as UTC instants (no off-by-one day in
      Lima).
    - A patient change clears everything and drops late responses.

  - **Frontend: issue ("Nueva receta").**
    - Eligibility mirrors the backend: `prescriptions.prescribe` + role `dentist`
      + a registered professional id. An admin's `*` wildcard no longer shows the
      button; a dentist without a registration number sees it disabled with a
      notice.
    - Large modal with a read-only header (patient, dentist, registration number,
      clinic), a required `valid_until` with no default and no minimum, and 1 to
      50 medications in stacked cards with the backend's exact limits.
    - A mandatory "cannot be edited once issued" confirmation precedes the only
      request, which carries exactly `patient_id`, `valid_until` and `items`.
    - The draft lives only in memory: closing the form or changing patient
      discards it. On success the response becomes the open detail and the history
      reloads from page 1; on failure the draft is kept and the backend code is
      mapped to a message.

  - **Frontend: void ("Anular receta").** Only inside the detail, for the
    original prescriber or an admin, on an issued prescription. A separate dialog
    asks for a required reason (1 to 2000) and warns that it cannot be undone. A
    conflict, a refusal or a missing prescription reloads what is true now;
    nothing is retried.

  - **Core frontend.** `useAuth` gains `currentRole` (`/auth/me` →
    `clinics[0].role`, the membership the backend acts on); `useApi` gains the
    opt-in `silentForbidden`. No other caller changes.

  - Strings in es, en, fr, pt and ta (the PDF has es and en).
  - Tests share backend fixtures through `tests/prescriptions_fixtures.py`.

- Out of scope, on purpose: editing or deleting a prescription, persistent
  drafts, duplicating a prescription, events and the patient timeline, AI tools,
  any drug knowledge (search, dose calculation, interactions, contraindications),
  electronic prescription, digital signature, e-mail or WhatsApp delivery, and
  any link with `patients_clinical.Medication`.
