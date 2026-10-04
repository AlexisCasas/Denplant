---
module: prescriptions
last_verified_commit: 9e40e4f1
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

| Operation | Permission | Service rule on top |
|---|---|---|
| Issue | `prescriptions.prescribe` | `role == "dentist"` and a non-blank `User.professional_id`. An admin is refused (403 `prescriber_not_eligible`) even when flagged `is_professional`. |
| Void | `prescriptions.void` | The original prescriber, or an admin. Another dentist is refused (403 `void_not_allowed`). |
| Read (including the PDF) | `prescriptions.read` | `PatientAccessPolicy` on the patient; out of scope or other clinic is 404. Printing a voided prescription is allowed. |

## Adding a permission

1. Add the relative name to `get_permissions()` in
   `backend/app/modules/prescriptions/__init__.py`.
2. List it in `manifest.role_permissions` for the roles that hold it.
3. Add a row to the table above.
4. Annotate the endpoint with `Depends(require_permission("prescriptions.<name>"))`.
5. If it is user-facing, add it to `frontend/app/config/permissions.ts` (not in
   phase A: there is no frontend yet).
