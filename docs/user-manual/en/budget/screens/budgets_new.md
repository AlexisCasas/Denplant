---
module: budget
screen: create
route: /budgets/new
related_endpoints:
  - DELETE /api/v1/budget/budgets/{budget_id}
  - DELETE /api/v1/budget/budgets/{budget_id}/items/{item_id}
  - GET /api/v1/budget/budgets
  - GET /api/v1/budget/budgets/{budget_id}
  - GET /api/v1/budget/budgets/{budget_id}/history
  - GET /api/v1/budget/budgets/{budget_id}/pdf
  - GET /api/v1/budget/budgets/{budget_id}/pdf/preview
  - GET /api/v1/budget/budgets/{budget_id}/pdf/signed
  - GET /api/v1/budget/budgets/{budget_id}/signature
  - GET /api/v1/budget/budgets/{budget_id}/versions
  - POST /api/v1/budget/budgets
  - POST /api/v1/budget/budgets/{budget_id}/accept
  - POST /api/v1/budget/budgets/{budget_id}/accept-in-clinic
  - POST /api/v1/budget/budgets/{budget_id}/cancel
  - POST /api/v1/budget/budgets/{budget_id}/duplicate
  - POST /api/v1/budget/budgets/{budget_id}/items
  - POST /api/v1/budget/budgets/{budget_id}/reject
  - POST /api/v1/budget/budgets/{budget_id}/renegotiate
  - POST /api/v1/budget/budgets/{budget_id}/resend
  - POST /api/v1/budget/budgets/{budget_id}/send
  - POST /api/v1/budget/budgets/{budget_id}/send-reminder
  - POST /api/v1/budget/budgets/{budget_id}/set-public-code
  - POST /api/v1/budget/budgets/{budget_id}/unlock-public
  - PUT /api/v1/budget/budgets/{budget_id}
  - PUT /api/v1/budget/budgets/{budget_id}/items/{item_id}
related_permissions:
  - budget.read
  - budget.write
related_paths:
  - backend/app/modules/budget/frontend/pages/budgets/new.vue
  - backend/app/modules/budget/frontend/composables/useBudgetDraft.ts
  - backend/app/modules/budget/frontend/components/budget/wizard
  - backend/app/modules/budget/router.py
last_verified_commit: 50ec879
---

# New budget

Form to create a budget from scratch. The budget is born in `draft`
state on save, and the workflow continues from the
[detail](./budgets_id.md).

## At a glance

- **How you usually get here.**
  - From the patient record → *New budget* (patient pre-selected).
  - From the list → **New budget** (patient picker required).
  - From a treatment plan → generates a budget kept in sync via
    `treatment_plan.treatment_added` /
    `treatment_plan.budget_sync_requested` events.
- **Auto-numbering.** The number (`PRES-YYYY-####`) is assigned on
  save; it is not editable.
- **Default validity** — the form proposes `valid_from = today` and
  `valid_until = today + 30 days`. Adjust if your policy differs.
- **Price snapshot.** Each line records the catalog price effective
  at creation time. Editing the catalog later does not change
  existing budgets.

## Create a budget

> Requires `budget.write`.

The form is a 3-step wizard. Nothing is saved until the last step:
you can move back and forth without losing what you typed.

1. **Budget details.** Pick the patient (document, phone and age are
   shown when on file), the validity and the patient / internal
   notes.
2. **Add treatments.** Search the catalog (the *Frequent* tab lists
   the most used) and click **+** to add a line, or use **Add
   treatment** to set tooth, surfaces, quantity and line discount.
   From the table you can change the quantity, edit or remove each
   line and apply a global discount (percentage or absolute).
3. **Review and confirm.** Check patient, treatments, notes and
   totals, then click **Create budget**. A single `POST /budgets`
   request is sent with the lines and the global discount; the
   budget is created in `draft` and you land on the
   [detail](./budgets_id.md) to send it, sign it, or invoice it
   later.

![1](../../../../screenshots/budget/budgets-new-step1.png)
![2](../../../../screenshots/budget/budgets-new-step2.png)
![3](../../../../screenshots/budget/budgets-new-step3.png)

The totals in steps 2 and 3 are a preview using the same formula as
the server; the final figures are the ones the backend computes on
creation.

## Create from a treatment plan

> Requires `budget.write` and `treatment_plan.write`.

1. On the treatment plan, click **Generate budget**.
2. The plan's treatments arrive in the form as prefilled lines via
   a snapshot event payload.
3. Adjust what you need and save.

## Permissions

| What you see / can do | Permission |
|-----------------------|------------|
| Access the form and see the catalog | `budget.read` |
| Create the budget | `budget.write` |

## Troubleshooting

- **Patient picker is empty.** You lack `patients.read` (without it
  the form cannot list patients).
- **A catalog item is missing.** Make sure it is active under
  *Settings → Catalog* and your role has `catalog.read`.
- **Totals don't match what you expect.** Check line vs global
  discount. Application order: price × quantity → line discount →
  VAT → global discount on the total.
