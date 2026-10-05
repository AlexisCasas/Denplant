---
module: prescriptions
last_verified_commit: 588f47b
---

# Prescriptions — permissions

Returned by `PrescriptionsModule.get_permissions()` (relative names; the registry
namespaces them as `prescriptions.<name>`).

| Permission | Allows | Required by |
|------------|--------|-------------|
| `prescriptions.read` | Read a patient's history, one prescription and its PDF | `GET /api/v1/prescriptions`, `GET /api/v1/prescriptions/{prescription_id}`, `GET /api/v1/prescriptions/{prescription_id}/pdf` |
| `prescriptions.prescribe` | Issue a prescription | `POST /api/v1/prescriptions` |
| `prescriptions.void` | Void an issued prescription | `POST /api/v1/prescriptions/{prescription_id}/void` |

## Role assignment

`manifest.role_permissions` grants `read`, `prescribe` and `void` to `dentist`
and nothing to `hygienist`, `assistant` or `receptionist`.

`admin` matches every permission through the core `*` wildcard (the core role
table, not this manifest). The permission is therefore **not** what decides who
may issue or void:

| Operation | Permission | Rule on top |
|---|---|---|
| Read (including the PDF) | `prescriptions.read` | `PatientAccessPolicy` on the patient; out of scope or other clinic is 404. Printing a voided prescription is allowed. |
| Issue | `prescriptions.prescribe` | Role `dentist` **and** a non-blank `User.professional_id`. An admin is refused (403 `prescriber_not_eligible`) even holding the wildcard and even when flagged `is_professional`. |
| Void | `prescriptions.void` | Role `admin`, **or** the `dentist` who issued the prescription. Another dentist is refused (403 `void_not_allowed`), whatever permission they hold. Only an `issued` prescription can be voided (409 `prescription_state_conflict` otherwise). |

The backend decides on every request. The rules above are the service's
(`PrescriptionService.require_eligible_prescriber` and `PrescriptionService.void`).

## What the frontend does with them

`frontend/app/config/permissions.ts` exposes `PERMISSIONS.prescriptions.read`,
`.prescribe` and `.void`. The UI mirrors the service so that it does not offer
what the backend would refuse:

| UI | Shown when |
|---|---|
| "Recetas" mode of the Clinical tab | `prescriptions.read` |
| "Nueva receta" | `prescriptions.prescribe` **and** `currentRole === 'dentist'` **and** a non-blank `user.professional_id`. A dentist without a registration number sees it disabled, with a notice; every other role sees nothing. |
| "Anular receta" (inside the detail only) | `prescriptions.void` **and** the prescription is `issued` **and** (`currentRole === 'admin'` **or** (`currentRole === 'dentist'` **and** `user.id === prescriber_user_id`)) |

Notes:

- **`currentRole` comes from `useAuth().currentRole`**, which is
  `clinics[0].role` of `GET /api/v1/auth/me`: the role of the clinic membership,
  and the membership the backend itself acts on when no `clinic_id` is sent.
  `User.role` is **not** the source: the API does not send a role on the user.
- **The role is never inferred** from the permission list, from the `*`
  wildcard, from `professional_id` or from `is_professional`. An admin holds the
  wildcard and still cannot issue.
- **The Clinical tab's `readonly` flag does not govern prescriptions.** It
  belongs to the clinical record; whether someone may issue or void is decided
  only by the rules above.

## Adding a permission

1. Add the relative name to `get_permissions()` in
   `backend/app/modules/prescriptions/__init__.py`.
2. List it in `manifest.role_permissions` for the roles that hold it.
3. Add a row to the table above.
4. Annotate the endpoint with `Depends(require_permission("prescriptions.<name>"))`.
5. If it is user-facing, add it to `frontend/app/config/permissions.ts` and
   decide whether the UI also needs a role rule (see above) rather than the
   permission alone.
