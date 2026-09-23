---
module: catalog
screen: catalog
route: /settings/catalog
related_endpoints:
  - DELETE /api/v1/catalog/categories/{category_id}
  - DELETE /api/v1/catalog/items/{item_id}
  - DELETE /api/v1/catalog/vat-types/{vat_type_id}
  - GET /api/v1/catalog/categories
  - GET /api/v1/catalog/categories/{category_id}
  - GET /api/v1/catalog/items
  - GET /api/v1/catalog/items/popular
  - GET /api/v1/catalog/items/search
  - GET /api/v1/catalog/items/{item_id}
  - GET /api/v1/catalog/odontogram-treatments
  - GET /api/v1/catalog/odontogram-treatments/by-category
  - GET /api/v1/catalog/vat-types
  - GET /api/v1/catalog/vat-types/default
  - GET /api/v1/catalog/vat-types/{vat_type_id}
  - POST /api/v1/catalog/categories
  - POST /api/v1/catalog/items
  - POST /api/v1/catalog/seed
  - POST /api/v1/catalog/vat-types
  - PUT /api/v1/catalog/categories/{category_id}
  - PUT /api/v1/catalog/items/{item_id}
  - PUT /api/v1/catalog/vat-types/{vat_type_id}
related_permissions:
  - catalog.read
  - catalog.write
  - catalog.admin
related_paths:
  - backend/app/modules/catalog/frontend/pages/settings/catalog/index.vue
  - backend/app/modules/catalog/frontend/components/catalog/CatalogCategoriesModal.vue
  - backend/app/modules/catalog/frontend/components/catalog/CatalogItemModal.vue
last_verified_commit: b2d359a8
---

# /settings/catalog

Treatment catalog: codes, prices, VAT, duration and grouping by category.
It is the price source for budgets, plans and invoices.

## Permissions

- `catalog.read` — browse the catalog (every role).
- `catalog.write` — create, edit and deactivate treatments.
- `catalog.admin` — manage categories and load the default catalog.

## What this screen does

- **Search and filter** treatments by text or category; the grouped view
  collapses/expands per category.
- **New treatment** — the modal requires code, name and **category**;
  without categories nothing can be saved.
- **Categories** (header button, `catalog.admin` only) — create, rename,
  reorder and deactivate/reactivate categories. System (seeded) categories
  are locked: shown with a padlock, and the server rejects edits/deletes.
- **Load default catalog** — shown in the empty state (no treatments, no
  filters) to `catalog.admin`. Adds VAT types for the clinic country, the
  categories and the reference treatments (prices at 0 when the currency is
  not EUR). Idempotent: only missing rows are created. This is the repair
  path for installs created before automatic seeding existed or where it
  failed; the dashboard "Getting started" card links here when it detects an
  empty catalog.

## Clinical tab: odontogram visualization

When creating or editing a treatment, the **Clinical** tab has an
**Odontogram Visualization** section that links the treatment to how it is
drawn on the patient's odontogram.

- **Treatment type** — choose how the treatment appears on the odontogram, or
  **No association** if it should not appear there. The list only offers
  types supported by the current clinical model.
- **Clinical category** — required whenever a treatment type is selected.
  Until one is chosen, the field is marked as required, the **Clinical** tab
  shows an error indicator and **Save** stays disabled. Some types (for
  example bridges and splints) do not fill in the category automatically, so
  pick it manually.
- **Older treatments** — if a treatment was linked to an older type that has a
  direct modern equivalent, the form loads it with the equivalent type already
  selected, and saving stores the modern type.
- **Unsupported older types** — if the stored type no longer has a safe
  equivalent, the form shows a warning naming it and **Save** stays disabled
  until you select a valid type manually.
- **Editing without changing the type** keeps the treatment's own visual
  configuration (for example, a specific colour or pattern). Choosing a
  different type applies that type's default appearance.
