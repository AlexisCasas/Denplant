# Prescriptions module

Issues, stores and lists medication prescriptions written by a dentist, for
printing and handwritten signature. Backend (model, API, A4 PDF) plus a **read-only frontend** (phase C):
history, detail and PDF in the patient's Clinical tab. No create or void UI yet
and no events.

## Public API

Routes mounted at `/api/v1/prescriptions` (no trailing slash).

- `POST /prescriptions`               — issue (prescription + items, atomically); `prescriptions.prescribe`
- `GET  /prescriptions?patient_id=…`  — a patient's history, newest first, paginated; `prescriptions.read`
- `GET  /prescriptions/{id}`          — detail: every snapshot + items by position; `prescriptions.read`
- `POST /prescriptions/{id}/void`     — void with a mandatory `reason`; `prescriptions.void`
- `GET  /prescriptions/{id}/pdf`      — A4 PDF, `?locale=es|en`; `prescriptions.read`

There is **no** `PUT`, `PATCH` or `DELETE`, and there never will be: an issued
prescription is not edited or deleted. A mistake is voided and re-issued.

## Frontend (phase C, read-only)

Layer `frontend/`, no navigation. It fills the slot
`patient.clinical.prescriptions` (gated by `prescriptions.read`) of the patient's
Clinical tab; `patients` renders the slot and never imports the component.
Phase C only **reads**: list (10 per page, newest first), detail modal and PDF.
There is no create form, no void action and no use of `prescribe` / `void`.

- **Prescription write eligibility must never be inferred from the ClinicalTab
  readonly flag.** `ctx.readonly` belongs to the clinical record, says nothing
  about prescriptions, and `PrescriptionsView` deliberately does not read it.
  Who may prescribe or void is decided by the backend (role, professional id,
  permission), never by the UI deducing it.
- **Date-only fields (`issue_date`, `valid_until`, date of birth) are never
  parsed with `new Date('YYYY-MM-DD')`**: that is UTC and shows the previous day
  west of Greenwich (Lima). `utils/prescriptionDates.ts` builds the date in UTC
  and formats it with `timeZone: 'UTC'`. Only instants (`issued_at`, `voided_at`)
  go through `formatDateTime`.
- **PDF**: raw `fetch` with a Bearer token (not `useApi`: it needs a Blob). The
  window is opened with `window.open('', '_blank')` synchronously in the click,
  before any `await`, so popup blockers stay quiet; `opener = null`. On 401 it
  calls `auth.refresh()` and retries **exactly once**. If the popup was blocked
  it downloads through an anchor with a sanitised file name. Blob URLs are kept,
  capped at 10 and revoked on unmount and on patient change; one PDF at a time
  per prescription.
- State is local to the instance, protected by `AbortController` + a generation
  token; a patient change clears everything and aborts what was in flight.
- The detail shows the snapshots, the date of birth (no age, the API does not
  send one) and, for a voided prescription, `ANULADA` + reason + instant. It
  does not show who voided it: the API sends only `voided_by` as a UUID.

## Dependencies

`manifest.depends = ["patients"]`. `clinics` and `users` are core. Do not add a
link to `treatment_plan`, `agenda` or `odontogram`; CI rejects undeclared FKs.

## Permissions

`prescriptions.read`, `prescriptions.prescribe`, `prescriptions.void`. Only
`dentist` is granted them in the manifest. `admin` matches all three through the
core `*` wildcard, which is why **the permission is not the rule** (below).

## Tools exposed

None. Prescriptions exposes no AI tools because an agent must not draft, modify
or issue medication prescriptions. `get_tools()` returns `[]` on purpose; do not
"fill it in" for completeness.

## Events emitted / consumed

None. `prescription.issued` / `prescription.voided` are deferred until a
consumer (for example `patient_timeline`) exists. Do not touch `core/events`.

## Rules the service enforces (not the permission table)

- **Who issues:** `role == "dentist"` **and** a non-blank `User.professional_id`.
  An admin cannot issue, even with `is_professional` and a number: that flag is
  true for hygienists too, and nothing in the model says an admin is a dentist.
  Deliberate limitation; lifting it needs an explicit core field.
- **Who voids:** the original prescriber, or an admin. Another dentist with the
  `void` permission gets 403 `void_not_allowed`.
- **Prescriber, clinic and every snapshot come from the authenticated context
  and the database.** `PrescriptionCreate` is `extra="forbid"` and accepts only
  `patient_id`, `valid_until` and `items`.
- **Patient scope:** every operation uses `PatientAccessPolicy`; whatever the
  caller cannot see is 404.
- **Date of birth is required** to issue (`patient_date_of_birth_required`);
  an age is never accepted from the client.
- **`valid_until` is required with no default** and must be `>= issue_date`.

## Gotchas

- **Immutability lives in the database.** `prescriptions_guard` allows only
  `issued → voided`, and only `status`, `voided_at`, `voided_by`, `void_reason`
  may differ (`to_jsonb(NEW) - … IS DISTINCT FROM to_jsonb(OLD) - …`, so a column
  added later is protected by default). `prescription_items_guard` refuses every
  UPDATE/DELETE, any INSERT into a non-issued prescription and any INSERT
  with `position > item_count`. The same SQL is attached to `create_all` in
  `models.py` (test DB) and frozen in `pres_0001`.
- **The item set is closed by `prescriptions.item_count`.** It is written at
  issue, is as immutable as every other column, and `(prescription_id,
  position)` is unique. A deferred constraint trigger
  (`trg_prescriptions_complete`) checks at COMMIT that exactly `item_count`
  items exist, so once the issuing transaction commits every position
  `1..item_count` is taken and no later INSERT can add an item. No transient
  state, no session setting, no time window; a rollback removes header, items
  and counter together. The service must therefore set `item_count` to the
  number of items it inserts (it does); a mismatch fails the COMMIT.
  Do not give `Prescription` a `TimestampMixin`: its `updated_at` would count as
  a changed column.
- **Void with a conditional `UPDATE … WHERE status='issued'`**, not by mutating
  the ORM object: it is what makes two racing voids produce exactly one winner.
- **Numbers are `RX-{local year}-{sequence:06d}`**, taken by an atomic
  `INSERT … ON CONFLICT DO UPDATE … RETURNING` on `prescription_counters`, inside
  the issuing transaction. Never `MAX()+1`. A rollback gives the number back.
- **The year is the clinic's local year** (`Clinic.timezone`). An invalid zone is
  refused (`clinic_timezone_invalid`), never replaced by a default.
  `agenda.tz.safe_zone` silently falls back to a default, so it is not used here
  (and `agenda` is not a dependency).
- **Snapshots are frozen at issue**: patient name, national id and type, date of
  birth; prescriber name and registration number; clinic name, legal name, tax
  id, address (flattened to one deterministic line) and phone. The logo is not a
  snapshot: a future printout uses the clinic's current branding.
- **`patients_clinical.Medication` is unrelated.** It records what a patient
  *takes*; this module records what a dentist *prescribes*. No FK, no sync.
- **No medication knowledge anywhere**: no catalog, normalisation, dose
  calculation, interaction or contraindication check. Items are free text.
- **The PDF is a rendering of the snapshots, not a stored file** (`pdf.py`).
  `build_pdf_context(prescription, *, logo, locale)` is pure: it receives the
  prescription with its items, the already-resolved logo and a locale, and can
  reach no patient, user or clinic. Every name, number and address comes from
  the `*_snapshot` columns and the age is measured at `issue_date` from the
  frozen date of birth (`age.py`; a 29-feb birthday is 1 March in a common
  year). The one live input is the clinic logo (`logo_data_uri`); if it is
  missing or storage fails the sheet still prints, without it.
- **Printing writes nothing**: no file, no hash, no audit event, no domain
  event, no counter. Nothing is signed and the sheet never says "firma digital"
  or "receta electrónica": it leaves a line for the prescriber's handwritten
  signature and stamp.
- **A voided prescription prints with everything it had**, under an `ANULADA`
  watermark on every page and a banner. The void reason, date and actor are
  internal and are never printed.
- **PDF rendering rules**: all human text goes through `html.escape` (line
  breaks are kept with CSS `white-space: pre-line`, never as markup); the
  renderer may load `data:` resources only (`URLFetcher(allowed_protocols=
  ("data",))`, or `data_only_url_fetcher` on older WeasyPrint); it runs in
  `asyncio.to_thread`. If WeasyPrint cannot be imported the answer is 503
  `pdf_unavailable`, and a render failure is 500 `pdf_render_failed` with a
  generic body. Never return HTML as `application/pdf` (the budget PDF's
  fallback does; this one must not). Logs carry the prescription id and the
  error type, never what is written on it.
- **Layout**: page 1 has the full clinic header; pages 2+ get a short strip
  (number, patient, `Página X de Y`) from a running element, not the whole
  clinic again. Items avoid breaking inside; the signature is in normal flow
  after the last item, never `fixed`/`absolute`.
- **Locale**: `?locale=es|en`, else `clinic.settings.communication_language`,
  else Spanish (anything unsupported is Spanish, not English). Not
  `Accept-Language`, not `Patient.preferred_language`.
- **Known debt:** `PatientAccessPolicy` excludes archived patients, so their
  prescriptions cannot be read. Legal/document access to archived patients needs
  a transversal policy; this module does not special-case it.

## Related

`docs/technical/prescriptions/overview.md`, `docs/technical/prescriptions/permissions.md`.

## CHANGELOG

See `./CHANGELOG.md`.
