# Budget module

Dental treatment quotes, versioning, signatures, PDF.

## Public API

Routes mounted at `/api/v1/budget/`. Authenticated subset:

- CRUD + version + signature workflow (legacy).
- `POST /budgets/{id}/{renegotiate,accept-in-clinic,resend,
  send-reminder,set-public-code,unlock-public}` (workflow rework).
  `/resend` only accepts terminal budgets (rejected/expired/cancelled)
  and republishes the plan link via `budget.superseded`.
- `GET  /budgets/{id}/pdf` — unsigned PDF.
- `GET  /budgets/{id}/pdf/signed` — signed PDF (404 if not signed).
- `GET  /budgets/{id}/signature` — signature metadata (no raw PNG).

Public subset (no staff auth, 2-factor verification — ADR 0006) under
`/api/v1/public/budgets/{token}/`:

- `GET    /meta`
- `POST   /verify`           (rate-limited; sets HttpOnly cookie)
- `GET    /`                 (cookie-protected; idempotent viewed_at)
- `POST   /accept`           (cookie-protected)
- `POST   /reject`           (cookie-protected)
- `GET    /pdf/signed`       (cookie-protected; 404 until accepted;
                              10/min per token; audit via
                              `BudgetAccessLog`)

## Dependencies

`manifest.depends = ["patients", "catalog", "odontogram"]`.

## Permissions

`budget.read`, `budget.write`, `budget.admin`,
`budget.renegotiate`, `budget.accept_in_clinic`.

## Tools exposed

Agent tools in `tools.py` (wrap `BudgetService` / `BudgetWorkflowService`).

| Tool | Category | Wraps | Permission |
|---|---|---|---|
| `list_budgets` | READ | `BudgetService.list_budgets` | `budget.read` |
| `get_budget` | READ | `BudgetService.get_budget` | `budget.read` |
| `send_budget` | DESTRUCTIVE | `BudgetWorkflowService.send_budget` | `budget.write` |

`send_budget` is DESTRUCTIVE because emailing the patient is an
irreversible external side effect. Amounts here are the budget axis
only — never combined with payments data.

## Events emitted

- `budget.sent`
- `budget.accepted` (snapshot payload includes `accepted_via`,
  `plan_id`, and `items[]` with per-line `net_amount` — ex-tax, after
  line + prorated global discount — so `treatment_plan` can reprice
  sessions without reading budget rows; issue #167).
- `budget.rejected` (snapshot payload with `rejection_reason`,
  `plan_id`).
- `budget.expired` (snapshot payload with `days_overdue`, `plan_id`).
- `budget.renegotiated` (snapshot payload with `plan_id`).
- `budget.cancelled` (direct staff cancel; payload with `plan_id`,
  `reason`. Suppressed with `publish_event=False` when the cancel is
  initiated by `treatment_plan.reopen()` — see gotchas).
- `budget.superseded` (resend cloned a terminal budget to a new draft
  version; payload with old `budget_id`, `new_budget_id`, `plan_id`.
  Published **after** commit — see gotchas).
- `budget.viewed` (idempotent first-open, snapshot payload).
- `budget.reminder_sent` (snapshot payload with `milestone_days`).

## Events consumed

- `treatment_plan.treatment_added` / `treatment_plan.treatment_removed`
  / `treatment_plan.budget_sync_requested` — sync with treatment_plan
  via **snapshot payloads only** (no cross-module ORM imports).
- `odontogram.treatment.performed` — mark line items done when the
  underlying tooth treatment is performed.

## Frontend slots exposed

| Slot | Ctx | Consumer |
|---|---|---|
| `budget.detail.sidebar` | `{ budget }` | `payments` registers `BudgetPaymentsCard` (cobrado vs pendiente, "Cobrar" action). Other modules may add follow-up reminders, signature blocks, etc. |

Budget never imports its slot consumers — the registry is the only
contract.

## Lifecycle

- `removable=False`. Billing depends on accepted budgets.

## Gotchas

- **Budget → treatment_plan is event-driven, never direct.** Don't
  import treatment_plan services or models from here. The reverse
  direction (treatment_plan → budget) is allowed because budget is in
  treatment_plan's depends. See ADR 0003.
- **Snapshot-only event handlers.** `_on_treatment_added_to_plan` and
  friends consume the data carried in the payload (catalog_item_id,
  tooth, surfaces, unit_price, budget_id) — no fetches against the
  publisher's tables. They are transactional (ADR 0019, issue #183): the
  quote mirrors the plan inside the publisher's transaction, so a failed
  mirror fails the request instead of silently dropping a line.
- **Plan reverse-lookup uses raw SQL** (`_lookup_plan` /
  `_lookup_plan_id`) instead of importing the `TreatmentPlan` model, so
  event payloads can carry `plan_id` without violating ADR 0003. It
  deliberately does NOT walk the `parent_budget_id` chain — a stale old
  version must resolve to no plan once the link moved on.
- **`budget.superseded` publishes before commit**, like every other
  event. It used to be the sole deviation: the treatment_plan handler
  points `treatment_plans.budget_id` (an FK) at the new budget row, which
  from its own session was invisible → FK violation the bus swallowed →
  relink silently lost. The handler is transactional now (ADR 0019,
  issue #183), so the row is visible and the workaround is gone.
- **`cancel_budget(publish_event=False)` is for plan-initiated
  cancels.** `treatment_plan.reopen()` cancels the budget inside its own
  transaction; an echoed `budget.cancelled` would send the plan through a
  reopen it is already performing. Direct staff cancels keep the default
  and publish. (Pre-#183 this was also a deadlock guard — the handler ran
  on its own session; it shares the publisher's now.)
- **`pricing.allocate_global_discount` is the only proration formula.**
  The global discount is applied to the VAT-inclusive items total in
  `_recalculate_totals`; every per-line consumer (the `budget.accepted`
  payload, `BudgetDetailResponse.items[].global_discount_share`,
  `billing.create_from_budget`) goes through that helper. Don't
  re-derive it — the invoice wizard and the plan sessions must land on
  the same cents.
- **Budget versioning** keeps every prior version — never overwrite.
- **Public-link sessions are per-token** (cookie path scoped to
  `/api/v1/public/budgets/{token}`) so a stolen cookie from one
  budget cannot unlock another.
- **`BUDGET_PUBLIC_SECRET_KEY`** signs the public session cookies and
  is independent from the global `SECRET_KEY`. Falls back in dev only.
- **The signed PDF is a stored file.** On accept, the workflow renders
  it ONCE (`BudgetWorkflowService._store_signed_document`), writes the
  bytes to storage (`signed_pdf.py`, path
  `budget-signed/{clinic}/{budget}/{signature}.pdf`), records the SHA-256
  in ``BudgetSignature.document_hash`` and the location in
  ``signature_data["signed_pdf"]`` (JSONB, no migration). Every
  download returns those bytes and verifies them against the hash
  (`SignedPdfIntegrityError` → 500, never a substitute document).
  Changing the clinic's logo/name/address or the template cannot alter a
  signed document. Don't bypass this on new acceptance paths.
  The hash is evidence kept OUTSIDE the file: never print it inside the
  PDF. A client-supplied ``signed_pdf`` key in ``signature_data`` is
  stripped on accept, and a reference is honoured only if its path is
  exactly the one generated for that signature.
- **Legacy signatures** (made before the stored PDF: no ``signed_pdf``,
  no hash) are never modified or backfilled. Their download renders on
  the fly and answers ``X-Document-Source: regenerated``. A render
  failure at acceptance is logged (``logger.exception``) and leaves the
  new signature in the same legacy state; it does not undo the acceptance.
- **The PDF takes a ``Clinic`` entity, always.** A raw SQL row or any
  column subset lacks ``currency`` (and tomorrow, something else);
  `build_pdf_context` raises ``TypeError`` for it. Fetch ``db.get(Clinic, id)``.
- **PDF = context + template.** `build_pdf_context` owns every figure and
  string (the rules); `render_html` is presentation only and escapes all
  database text. The totals block is derived for display from the
  persisted fields; the global discount is spread ONLY by
  `pricing.allocate_global_discount`, VAT is the remainder to
  ``budget.total`` so the printed total is exactly ``budget.total``.
- **Known gap (out of scope):** `treatment_plan` publishes only
  ``teeth[0]`` and its surfaces, so a multi-tooth treatment reaches the
  budget (and the PDF) with one tooth.
- **Public signed-PDF download** uses the same per-token cookie as
  the rest of the public flow — never expose the signed PDF on a
  cookie-less route. Audit rows go to ``BudgetAccessLog`` with
  ``success=True`` so they don't contribute to the lockout
  counter.
- ``budget.completed`` no longer exists. The transition
  ``accepted → completed`` and the manual "Mark completed" button
  were removed in 2026-04: ``completed`` was a bookkeeping flag
  with no auto-trigger and no real consumer. Use invoice paid /
  fully invoiced as the financial-closure signal instead.

## Related ADRs

- `docs/adr/0001-modular-plugin-architecture.md`
- `docs/adr/0003-event-bus-over-direct-imports.md`
- `docs/adr/0006-budget-public-link-2-factor-auth.md`

## CHANGELOG

See `./CHANGELOG.md`.
