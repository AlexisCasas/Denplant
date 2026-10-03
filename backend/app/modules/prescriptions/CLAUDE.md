# Prescriptions module

Issues, stores and lists medication prescriptions written by a dentist, for
printing and handwritten signature. **Phase A is backend only**: no PDF, no UI,
no events.

## Public API

Routes mounted at `/api/v1/prescriptions` (no trailing slash).

- `POST /prescriptions`               — issue (prescription + items, atomically); `prescriptions.prescribe`
- `GET  /prescriptions?patient_id=…`  — a patient's history, newest first, paginated; `prescriptions.read`
- `GET  /prescriptions/{id}`          — detail: every snapshot + items by position; `prescriptions.read`
- `POST /prescriptions/{id}/void`     — void with a mandatory `reason`; `prescriptions.void`

There is **no** `PUT`, `PATCH` or `DELETE`, and there never will be: an issued
prescription is not edited or deleted. A mistake is voided and re-issued.

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
- **Known debt:** `PatientAccessPolicy` excludes archived patients, so their
  prescriptions cannot be read. Legal/document access to archived patients needs
  a transversal policy; this module does not special-case it.

## Related

`docs/technical/prescriptions/overview.md`, `docs/technical/prescriptions/permissions.md`.

## CHANGELOG

See `./CHANGELOG.md`.
