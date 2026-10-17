# Proposal: authoritative guard against deleting Plan-linked treatments

Status: **proposal, not implemented** — needs approval (DP-08.B1 audit, B1-01).

## Problem

`DELETE /api/v1/odontogram/treatments/{id}` (`TreatmentService.delete`) is a
soft delete (`deleted_at`). It has no knowledge of `PlannedTreatmentItem`:

- the FK `planned_treatment_items.treatment_id → treatments.id ON DELETE CASCADE`
  never fires for a soft delete, so the database does not protect the link;
- `odontogram` does not depend on `treatment_plan`, so importing the model or
  querying `planned_treatment_items` from the odontogram service would break
  ADR 0003 / the `manifest.depends` contract;
- the frontend (DP-08.B1) now avoids the call for Plan-linked treatments, but
  any other client, or a stale view, can still issue it and leave a Plan item
  pointing at a deleted treatment.

## Options (none needs a new endpoint)

1. **Event-bus veto (new mechanism).** Publish a *pre*-delete request that
   subscribers may refuse; `treatment_plan` refuses when an item exists.
   Cleanest boundary, but the bus is notify-only today: a veto semantic is a
   new core mechanism. Requires an ADR.
2. **`treatment_plan` owns the guard via a route-level dependency.** The
   module registers a dependency/middleware for `DELETE /odontogram/treatments/{id}`
   at mount time (it already depends on `odontogram`, so the import direction
   is legal). No new core concept, but couples route behaviour across modules
   and is easy to bypass if the router is mounted elsewhere.
3. **Database guard.** A trigger on `treatments` that rejects setting
   `deleted_at` while a `planned_treatment_items` row references the row.
   Authoritative for every client, but needs a migration (excluded from this
   PR) and encodes a cross-module rule in SQL.
4. **Reactive reconciliation (weaker).** `treatment_plan` subscribes to
   `odontogram.treatment.deleted` and removes/flags the dangling item. Keeps
   data consistent but does *not* prevent the deletion, and the event is
   published without `db=db` today (not transactional).

## Recommendation

Option 3 for authority (returns 409 `treatment_linked_to_plan` through the
existing integrity-error mapping), optionally combined with option 4 as
defence in depth. Option 1 if the team prefers no cross-module SQL.

## Known limitation until approved

The frontend in this PR never calls the odontogram DELETE in Plan context and
refuses when the association cannot be confirmed, but the server still accepts
the direct call.
