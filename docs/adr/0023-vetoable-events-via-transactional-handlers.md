# 0023 — Vetoable events via transactional handlers

- **Status:** accepted
- **Date:** 2026-10-17
- **Tags:** modules, events, integrity (DP-08.B1)

## Context

`DELETE /odontogram/treatments/{id}` soft-deletes a treatment. A treatment may
be owned by a Plan (`planned_treatment_items`, UNIQUE on `treatment_id`), but
`odontogram` does not depend on `treatment_plan` and the link is invisible to
the database for a soft delete (no FK action fires). Frontend guards cannot
protect against other clients or stale views, so the server needs an
authoritative guard without an import from `odontogram` into `treatment_plan`
(ADR 0003), a new hook registry, or a SQL trigger.

## Decision

Use the existing bus (ADR 0003) with transactional handlers (ADR 0019), whose
exceptions already propagate to the publisher:

1. `TreatmentService.delete` locks the Treatment row (`FOR UPDATE`).
2. It publishes `odontogram.treatment.delete_requested` **with `db`**, before
   `deleted_at` is written. Payload: `{clinic_id, treatment_id, requested_by,
   cleared_by: []}`.
3. A subscriber that owns a link raises `TreatmentDeletionBlockedError`
   (defined by `odontogram`; `treatment_plan` may import it because
   `odontogram ∈ depends`). The router maps it to **409
   `treatment_linked_to_plan`**; the request rolls back with nothing written
   and `odontogram.treatment.deleted` is never published.
4. A subscriber that ran and agrees appends its module name to `cleared_by`.
   `odontogram` requires the acknowledgement of every module in
   `REQUIRED_DELETE_GUARDS` (today `{"treatment_plan"}`, a string, not an
   import). **If a required guard is missing from `cleared_by` the delete is
   refused** (`503 delete_guard_unavailable`) even if other subscribers
   acknowledged: an absent or silent `treatment_plan` guard never causes a
   silent delete, while additional guards remain possible. `treatment_plan` is `auto_install` and `removable=False`, so the
   guard is always mounted; `tests/test_treatment_delete_guard.py` asserts the
   registration and the fail-closed path.

Internal lifecycle: closing or archiving a Plan keeps its items as history and
soft-deletes `planned` treatments that no live plan holds. That is the Plan
releasing its own hold, so it calls `TreatmentService.delete_after_plan_release`
(Python-only; no router, no client input) which skips step 2–4.
`remove_item` deletes the item first and flushes, so the guard finds no link
and the normal path passes. `performed` treatments are never deleted by the
lifecycle and, while linked, are refused by the guard.

### Lock order

`Treatment` row first, in every path (`add_item`, guarded delete,
`delete_after_plan_release`). The guard only *reads* `planned_treatment_items`.
`remove_item` takes the item row then the Treatment row (pre-existing); an
`add_item` holding the Treatment lock only reads the item, so no cycle exists.
#### `remove_item` vs `add_item` (B1-06, verified, no code change)

`tests/test_treatment_delete_guard.py::test_remove_item_vs_add_item_is_serializable_and_deadlock_free`
holds `remove_item` (session A) uncommitted at two points and runs `add_item`
(session B) on the same treatment from an independent PostgreSQL session:

| A paused at | B | Final state | Serial order |
|-------------|---|-------------|--------------|
| after item delete, before orphan delete (A holds only the item row) | answers **200, `created=False`** immediately (reads the *committed* item) | item gone, treatment soft-deleted | B → R |
| after orphan delete (A holds the Treatment lock) | blocks until A commits, then `ValueError` ("Invalid treatment") | item gone, treatment soft-deleted | R → B |
| performed treatment (A never takes the Treatment lock) | answers 200, `created=False` | item gone, treatment alive | B → R |

B's idempotent 200 is never based on an *unconfirmed removal*: under READ
COMMITTED B only sees committed rows, so the item it returns existed when B ran
and R is ordered after it. There are never duplicate items or sessions, no
second `treatment_added`, and no deadlock: B holds the Treatment lock only
while reading, and A never waits on anything B holds while B waits on A. A's
`FOR UPDATE` waits for B's short commit, then proceeds. Locking the Treatment
first in `remove_item` would only turn B → R into R → B; it is not needed for
correctness, so `remove_item` is unchanged.

Result of the race: associate wins → delete is refused (409); delete wins →
associate sees `deleted_at` and answers 400 "Invalid treatment".

## Consequences

- Good: no new mechanism, no migration, no cross-module import; authoritative
  for every HTTP client; atomic with the request.
- Good: reusable for other "owner may veto" cases.
- Cost: a veto is a convention (raise from a `db` handler + `cleared_by`
  acknowledgement), not a bus feature. Any module that links to treatments and
  wants protection must subscribe.
- Cost: with no guard mounted deletes fail closed (503) instead of succeeding.
