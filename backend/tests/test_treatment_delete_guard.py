"""DP-08.B1 — a Plan-linked treatment cannot be deleted through the odontogram.

Mechanism under test (ADR 0023): ``TreatmentService.delete`` locks the
Treatment row, publishes ``odontogram.treatment.delete_requested`` with the
request's session, and a transactional subscriber owned by ``treatment_plan``
raises when a ``PlannedTreatmentItem`` references the treatment. The request is
refused (HTTP 409 ``treatment_linked_to_plan``) before ``deleted_at`` is
written. The plan lifecycle (close / archive / remove_item) keeps working.

Concurrency uses independent sessions on the disposable test database.
"""

import asyncio
from collections.abc import AsyncGenerator, Callable
from typing import Any
from uuid import UUID, uuid4

import pytest
import pytest_asyncio
from httpx import AsyncClient
from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool

from app.core.events import event_bus
from app.core.events.types import EventType
from app.modules.budget.models import Budget, BudgetItem
from app.modules.odontogram.models import Treatment
from app.modules.odontogram.service import (
    TreatmentDeleteGuardUnavailableError,
    TreatmentDeletionBlockedError,
    TreatmentService,
)
from app.modules.treatment_plan.events import on_treatment_delete_requested
from app.modules.treatment_plan.models import PlannedTreatmentItem, PlannedTreatmentItemSession
from app.modules.treatment_plan.service import TreatmentPlanService
from tests import db_isolation

from .test_treatment_plan import (  # noqa: F401
    _create_treatment,
    _ensure_clinic_and_patient,
    _seed_catalog_crown,
    _send_plan_budget,
)

PLANS = "/api/v1/treatment_plan/treatment-plans"
TREATMENTS = "/api/v1/odontogram/treatments"
REQUESTED = EventType.ODONTOGRAM_TREATMENT_DELETE_REQUESTED
DELETED = EventType.ODONTOGRAM_TREATMENT_DELETED


@pytest.fixture
async def setup(
    db_session: AsyncSession, auth_headers: dict[str, str], client: AsyncClient
) -> dict:
    ctx = await _ensure_clinic_and_patient(db_session, client, auth_headers)
    ctx["crown_id"] = await _seed_catalog_crown(db_session, ctx["clinic_id"])
    return ctx


class _Spy:
    """Counts published events while delegating to the real bus."""

    def __init__(self, monkeypatch: pytest.MonkeyPatch) -> None:
        self.counts: dict[str, int] = {}
        original = event_bus.publish

        async def spy(event_type: str, data: dict, **kw: Any) -> None:
            self.counts[event_type] = self.counts.get(event_type, 0) + 1
            await original(event_type, data, **kw)

        monkeypatch.setattr(event_bus, "publish", spy)

    def n(self, event_type: str) -> int:
        return self.counts.get(str(event_type), 0)


@pytest.fixture
def spy(monkeypatch: pytest.MonkeyPatch) -> _Spy:
    return _Spy(monkeypatch)


@pytest_asyncio.fixture
async def session_factory() -> AsyncGenerator[Callable[[], AsyncSession], None]:
    db_isolation.assert_safe_to_destroy(
        db_isolation.TEST_DATABASE_URL, db_isolation.DEV_DATABASE_URL
    )
    engine = create_async_engine(db_isolation.TEST_DATABASE_URL, poolclass=NullPool)
    yield async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    await engine.dispose()


async def _count(db: AsyncSession, model: type, *where: Any) -> int:
    return (await db.execute(select(func.count()).select_from(model).where(*where))).scalar_one()


async def _plan(client: AsyncClient, headers: dict, setup: dict) -> str:
    r = await client.post(
        PLANS, headers=headers, json={"patient_id": setup["patient_id"], "title": "P"}
    )
    assert r.status_code == 201, r.text
    return r.json()["data"]["id"]


async def _linked(client: AsyncClient, headers: dict, setup: dict, tooth: int = 16):
    """(plan_id, treatment_id) with the treatment linked to an editable plan."""
    plan_id = await _plan(client, headers, setup)
    treatment_id = await _create_treatment(client, headers, setup, tooth_number=tooth)
    r = await client.post(
        f"{PLANS}/{plan_id}/items", headers=headers, json={"treatment_id": treatment_id}
    )
    assert r.status_code == 201, r.text
    return plan_id, treatment_id, r.json()["data"]["id"]


async def _alive(db: AsyncSession, treatment_id: str) -> bool:
    db.expire_all()
    t = (
        await db.execute(
            select(Treatment.deleted_at)
            .where(Treatment.id == UUID(treatment_id))
            .execution_options(populate_existing=True)
        )
    ).one()
    return t.deleted_at is None


async def _snapshot(db: AsyncSession) -> tuple[int, int, int, int]:
    return (
        await _count(db, PlannedTreatmentItem),
        await _count(db, PlannedTreatmentItemSession),
        await _count(db, Budget),
        await _count(db, BudgetItem),
    )


# ---------------------------------------------------------------------------
# Allowed / refused through the HTTP endpoint
# ---------------------------------------------------------------------------


async def test_independent_treatment_can_still_be_deleted(
    client: AsyncClient, auth_headers: dict, setup: dict, db_session: AsyncSession, spy
) -> None:
    tid = await _create_treatment(client, auth_headers, setup)
    r = await client.delete(f"{TREATMENTS}/{tid}", headers=auth_headers)
    assert r.status_code == 204, r.text
    assert not await _alive(db_session, tid)
    assert spy.n(REQUESTED) == 1 and spy.n(DELETED) == 1


async def test_treatment_linked_to_editable_plan_is_refused_untouched(
    client: AsyncClient, auth_headers: dict, setup: dict, db_session: AsyncSession, spy
) -> None:
    _, tid, _ = await _linked(client, auth_headers, setup)
    before = await _snapshot(db_session)

    r = await client.delete(f"{TREATMENTS}/{tid}", headers=auth_headers)

    assert r.status_code == 409, r.text
    assert r.json()["code"] == "treatment_linked_to_plan"
    assert await _alive(db_session, tid)
    assert await _snapshot(db_session) == before
    assert spy.n(REQUESTED) == 1
    assert spy.n(DELETED) == 0  # no treatment.deleted event on refusal


async def test_treatment_in_plan_with_draft_budget_is_refused(
    client: AsyncClient, auth_headers: dict, setup: dict, db_session: AsyncSession, spy
) -> None:
    plan_id, tid, _ = await _linked(client, auth_headers, setup)
    assert (
        await client.post(f"{PLANS}/{plan_id}/confirm", headers=auth_headers)
    ).status_code == 200
    before = await _snapshot(db_session)

    r = await client.delete(f"{TREATMENTS}/{tid}", headers=auth_headers)

    assert r.status_code == 409 and r.json()["code"] == "treatment_linked_to_plan"
    assert await _alive(db_session, tid)
    assert await _snapshot(db_session) == before
    assert spy.n(DELETED) == 0


async def test_treatment_in_plan_with_sent_budget_is_refused(
    client: AsyncClient, auth_headers: dict, setup: dict, db_session: AsyncSession, spy
) -> None:
    plan_id, tid, _ = await _linked(client, auth_headers, setup)
    assert (
        await client.post(f"{PLANS}/{plan_id}/confirm", headers=auth_headers)
    ).status_code == 200
    await _send_plan_budget(client, auth_headers, plan_id)
    before = await _snapshot(db_session)
    statuses = (await db_session.execute(select(Budget.status))).scalars().all()

    r = await client.delete(f"{TREATMENTS}/{tid}", headers=auth_headers)

    assert r.status_code == 409 and r.json()["code"] == "treatment_linked_to_plan"
    assert await _alive(db_session, tid)
    assert await _snapshot(db_session) == before
    assert (await db_session.execute(select(Budget.status))).scalars().all() == statuses
    assert spy.n(DELETED) == 0


async def test_performed_linked_treatment_is_refused(
    client: AsyncClient, auth_headers: dict, setup: dict, db_session: AsyncSession
) -> None:
    _, tid, _ = await _linked(client, auth_headers, setup)
    r = await client.patch(f"{TREATMENTS}/{tid}/perform", headers=auth_headers, json={})
    assert r.status_code == 200, r.text

    r = await client.delete(f"{TREATMENTS}/{tid}", headers=auth_headers)

    assert r.status_code == 409 and r.json()["code"] == "treatment_linked_to_plan"
    assert await _alive(db_session, tid)


async def test_unknown_treatment_still_404(client: AsyncClient, auth_headers: dict, setup: dict):
    r = await client.delete(f"{TREATMENTS}/{uuid4()}", headers=auth_headers)
    assert r.status_code == 404


# ---------------------------------------------------------------------------
# Plan lifecycle is not regressed
# ---------------------------------------------------------------------------


async def test_remove_item_still_removes_item_and_orphan_treatment(
    client: AsyncClient, auth_headers: dict, setup: dict, db_session: AsyncSession, spy
) -> None:
    plan_id, tid, item_id = await _linked(client, auth_headers, setup)

    r = await client.delete(f"{PLANS}/{plan_id}/items/{item_id}", headers=auth_headers)

    assert r.status_code == 204, r.text
    assert await _count(db_session, PlannedTreatmentItem) == 0
    assert not await _alive(db_session, tid)  # orphan rule still fires
    assert spy.n(DELETED) == 1
    # and the odontogram DELETE of the now-gone treatment is a plain 404
    assert (await client.delete(f"{TREATMENTS}/{tid}", headers=auth_headers)).status_code == 404


async def test_closing_a_plan_still_cleans_planned_and_keeps_history(
    client: AsyncClient, auth_headers: dict, setup: dict, db_session: AsyncSession, spy
) -> None:
    plan_id, planned_tid, _ = await _linked(client, auth_headers, setup, tooth=16)
    r = await client.post(
        f"{PLANS}/{plan_id}/items",
        headers=auth_headers,
        json={
            "treatment_id": (
                performed_tid := await _create_treatment(
                    client, auth_headers, setup, tooth_number=15
                )
            )
        },
    )
    assert r.status_code == 201, r.text
    assert (
        await client.patch(f"{TREATMENTS}/{performed_tid}/perform", headers=auth_headers, json={})
    ).status_code == 200

    r = await client.post(
        f"{PLANS}/{plan_id}/close", headers=auth_headers, json={"closure_reason": "other"}
    )
    assert r.status_code == 200, r.text

    assert not await _alive(db_session, planned_tid)  # legitimate cleanup not blocked
    assert await _alive(db_session, performed_tid)  # performed preserved
    assert await _count(db_session, PlannedTreatmentItem) == 2  # items kept as history
    assert spy.n(DELETED) == 1
    # history stays protected from a direct delete
    r = await client.delete(f"{TREATMENTS}/{performed_tid}", headers=auth_headers)
    assert r.status_code == 409 and r.json()["code"] == "treatment_linked_to_plan"


async def test_archiving_a_plan_still_cleans_planned_treatments(
    client: AsyncClient, auth_headers: dict, setup: dict, db_session: AsyncSession
) -> None:
    plan_id, tid, _ = await _linked(client, auth_headers, setup)
    assert (await client.delete(f"{PLANS}/{plan_id}", headers=auth_headers)).status_code == 204
    assert not await _alive(db_session, tid)


# ---------------------------------------------------------------------------
# Registration / fail-closed
# ---------------------------------------------------------------------------


def test_guard_is_registered_by_the_plan_module() -> None:
    from app.modules.treatment_plan import TreatmentPlanModule  # noqa: PLC0415

    assert TreatmentPlanModule().get_event_handlers()[REQUESTED] is on_treatment_delete_requested
    assert on_treatment_delete_requested in event_bus._handlers[REQUESTED]


async def test_missing_guard_fails_closed_instead_of_deleting(
    client: AsyncClient,
    auth_headers: dict,
    setup: dict,
    db_session: AsyncSession,
    spy,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    tid = await _create_treatment(client, auth_headers, setup)
    monkeypatch.setitem(event_bus._handlers, REQUESTED, [])  # nobody subscribed

    r = await client.delete(f"{TREATMENTS}/{tid}", headers=auth_headers)

    assert r.status_code == 503, r.text
    assert r.json()["code"] == "delete_guard_unavailable"
    assert await _alive(db_session, tid)
    assert spy.n(DELETED) == 0


async def test_guard_that_does_not_acknowledge_fails_closed(
    db_session: AsyncSession, setup: dict, monkeypatch: pytest.MonkeyPatch, client, auth_headers
) -> None:
    tid = await _create_treatment(client, auth_headers, setup)

    async def silent(data: dict, *, db: AsyncSession) -> None:  # runs but never clears
        return None

    monkeypatch.setitem(event_bus._handlers, REQUESTED, [silent])
    with pytest.raises(TreatmentDeleteGuardUnavailableError):
        await TreatmentService.delete(db_session, UUID(setup["clinic_id"]), UUID(tid), uuid4())


def test_no_router_exposes_the_unguarded_delete() -> None:
    import pathlib  # noqa: PLC0415

    root = pathlib.Path(__file__).resolve().parents[1] / "app" / "modules"
    for router in root.glob("*/router.py"):
        assert "delete_after_plan_release" not in router.read_text(), router


# ---------------------------------------------------------------------------
# Concurrency: add_item vs delete (lock order: Treatment row first, in both)
# ---------------------------------------------------------------------------


async def _committed(client, headers, setup, db_session):
    plan_id = await _plan(client, headers, setup)
    tid = await _create_treatment(client, headers, setup)
    await db_session.commit()
    return UUID(setup["clinic_id"]), UUID(plan_id), UUID(tid)


async def _waiting_on_for_update(probe: AsyncSession) -> list[str]:
    rows = (
        (
            await probe.execute(
                text(
                    "select query from pg_stat_activity "
                    "where wait_event_type = 'Lock' and pid <> pg_backend_pid()"
                )
            )
        )
        .scalars()
        .all()
    )
    return list(rows)


async def test_associate_first_then_delete_is_refused(
    client, auth_headers, setup, db_session, session_factory
) -> None:
    """A associates (uncommitted, holds the row lock); B's delete waits, then is refused."""
    clinic_id, plan_id, tid = await _committed(client, auth_headers, setup, db_session)
    async with session_factory() as s_add, session_factory() as s_del, session_factory() as probe:
        _, created = await TreatmentPlanService.add_item(
            s_add, clinic_id, plan_id, {"treatment_id": tid}
        )
        assert created is True
        task = asyncio.create_task(TreatmentService.delete(s_del, clinic_id, tid, uuid4()))
        try:
            await asyncio.sleep(0.7)
            assert not task.done(), "delete must wait for the associate transaction"
            waiting = await _waiting_on_for_update(probe)
            assert waiting and all("for update" in q.lower() for q in waiting), waiting
            await s_add.commit()
            with pytest.raises(TreatmentDeletionBlockedError):
                await asyncio.wait_for(task, timeout=10)
            await s_del.rollback()
        finally:
            await s_add.rollback()
            await asyncio.gather(task, return_exceptions=True)
    async with session_factory() as check:
        assert await _count(check, PlannedTreatmentItem) == 1
        assert (await check.get(Treatment, tid)).deleted_at is None


async def test_delete_first_then_associate_is_refused(
    client, auth_headers, setup, db_session, session_factory
) -> None:
    """B's delete holds the row lock; A's associate waits, then sees a deleted treatment."""
    clinic_id, plan_id, tid = await _committed(client, auth_headers, setup, db_session)
    async with session_factory() as s_del, session_factory() as s_add, session_factory() as probe:
        assert await TreatmentService._lock_for_delete(s_del, clinic_id, tid)  # lock held
        task = asyncio.create_task(
            TreatmentPlanService.add_item(s_add, clinic_id, plan_id, {"treatment_id": tid})
        )
        try:
            await asyncio.sleep(0.7)
            assert not task.done(), "associate must wait for the delete transaction"
            waiting = await _waiting_on_for_update(probe)
            assert waiting and all("for update" in q.lower() for q in waiting), waiting
            assert await TreatmentService.delete(s_del, clinic_id, tid, uuid4()) is True
            await s_del.commit()
            with pytest.raises(ValueError, match="Invalid treatment"):
                await asyncio.wait_for(task, timeout=10)
            await s_add.rollback()
        finally:
            await s_del.rollback()
            await asyncio.gather(task, return_exceptions=True)
    async with session_factory() as check:
        assert await _count(check, PlannedTreatmentItem) == 0
        assert (await check.get(Treatment, tid)).deleted_at is not None


# ---------------------------------------------------------------------------
# B1-05: the treatment_plan acknowledgement is REQUIRED, not "any" acknowledgement
# ---------------------------------------------------------------------------


async def test_other_subscriber_cannot_stand_in_for_missing_plan_guard(
    client: AsyncClient,
    auth_headers: dict,
    setup: dict,
    db_session: AsyncSession,
    spy,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    tid = await _create_treatment(client, auth_headers, setup)
    before = await _snapshot(db_session)

    async def other_guard(data: dict, *, db: AsyncSession) -> None:
        data["cleared_by"].append("some_other_module")  # acknowledges, but is not treatment_plan

    # treatment_plan's validator absent; a different subscriber acknowledges.
    monkeypatch.setitem(event_bus._handlers, REQUESTED, [other_guard])

    r = await client.delete(f"{TREATMENTS}/{tid}", headers=auth_headers)

    assert r.status_code == 503, r.text
    assert r.json()["code"] == "delete_guard_unavailable"
    assert await _alive(db_session, tid)
    assert await _snapshot(db_session) == before
    assert spy.n(DELETED) == 0


async def test_additional_guards_are_still_allowed_next_to_the_plan_guard(
    client: AsyncClient,
    auth_headers: dict,
    setup: dict,
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    tid = await _create_treatment(client, auth_headers, setup)

    async def extra_guard(data: dict, *, db: AsyncSession) -> None:
        data["cleared_by"].append("future_module")

    monkeypatch.setitem(
        event_bus._handlers, REQUESTED, [on_treatment_delete_requested, extra_guard]
    )

    r = await client.delete(f"{TREATMENTS}/{tid}", headers=auth_headers)

    assert r.status_code == 204, r.text
    assert not await _alive(db_session, tid)


# ---------------------------------------------------------------------------
# B1-06: remove_item (A) racing add_item (B) on the same treatment
# ---------------------------------------------------------------------------
#
# A deletes the item and flushes, then (orphan rule) locks the Treatment; B
# locks the Treatment first and then looks for the item. Question: can B answer
# "already linked" (200) from an item whose removal A has not committed, and is
# that outcome consistent? A is paused at a deterministic point inside its
# transaction, B runs meanwhile, then both finish.


async def _race_remove_vs_add(
    client, auth_headers, setup, db_session, session_factory, monkeypatch, *, pause_at, performed
):
    plan_id = await _plan(client, auth_headers, setup)
    tid = await _create_treatment(client, auth_headers, setup)
    r = await client.post(
        f"{PLANS}/{plan_id}/items", headers=auth_headers, json={"treatment_id": tid}
    )
    assert r.status_code == 201, r.text
    item_id = UUID(r.json()["data"]["id"])
    if performed:
        # perform() would book prices through sessions; flip the status directly so the
        # orphan rule (planned-only) is skipped without touching any financial flow.
        await db_session.execute(
            text("update treatments set status = 'performed' where id = :i"), {"i": tid}
        )
    await db_session.commit()
    clinic_id, plan_uuid, treatment_id = UUID(setup["clinic_id"]), UUID(plan_id), UUID(tid)

    window, proceed = asyncio.Event(), asyncio.Event()

    async def pause() -> None:
        window.set()
        await asyncio.wait_for(proceed.wait(), timeout=20)

    if pause_at == "before_orphan_delete":
        real_delete = TreatmentService.delete

        async def paused_delete(*a: Any, **kw: Any):
            await pause()
            return await real_delete(*a, **kw)

        monkeypatch.setattr(TreatmentService, "delete", staticmethod(paused_delete))
    else:  # "after_item_removed": between the removal work and the commit
        real_publish = event_bus.publish

        async def paused_publish(event_type: str, data: dict, **kw: Any) -> None:
            if event_type == "treatment_plan.treatment_removed":
                await pause()
            await real_publish(event_type, data, **kw)

        monkeypatch.setattr(event_bus, "publish", paused_publish)

    async with session_factory() as s_rm, session_factory() as s_add:
        t_rm = asyncio.create_task(
            TreatmentPlanService.remove_item(s_rm, clinic_id, plan_uuid, item_id, uuid4())
        )

        async def request_b():
            # B behaves like a whole HTTP request: it commits (or rolls back) by itself,
            # releasing the Treatment lock exactly as `get_db` would.
            try:
                result = await TreatmentPlanService.add_item(
                    s_add, clinic_id, plan_uuid, {"treatment_id": tid}
                )
                await s_add.commit()
                return result
            except BaseException:
                await s_add.rollback()
                raise

        t_add = None
        try:
            await asyncio.wait(
                {asyncio.ensure_future(window.wait()), t_rm},
                timeout=15,
                return_when=asyncio.FIRST_COMPLETED,
            )
            if not window.is_set():
                raise AssertionError(f"A never reached the pause point: {t_rm!r}")
            t_add = asyncio.create_task(request_b())
            await asyncio.sleep(0.8)
            b_finished_while_a_open = t_add.done()
            proceed.set()
            removed = await asyncio.wait_for(t_rm, timeout=20)
            await s_rm.commit()
            b = (await asyncio.wait_for(asyncio.gather(t_add, return_exceptions=True), timeout=20))[
                0
            ]
        finally:
            proceed.set()
            await s_rm.rollback()
            await asyncio.gather(*(t for t in (t_rm, t_add) if t), return_exceptions=True)
    async with session_factory() as check:
        items = await _count(
            check, PlannedTreatmentItem, PlannedTreatmentItem.treatment_id == treatment_id
        )
        sessions = await _count(check, PlannedTreatmentItemSession)
        alive = (await check.get(Treatment, treatment_id)).deleted_at is None
    return removed, b, b_finished_while_a_open, items, sessions, alive


@pytest.mark.parametrize(
    ("pause_at", "performed"),
    [
        ("before_orphan_delete", False),
        ("after_item_removed", False),
        ("after_item_removed", True),
    ],
)
async def test_remove_item_vs_add_item_is_serializable_and_deadlock_free(
    client, auth_headers, setup, db_session, session_factory, monkeypatch, spy, pause_at, performed
) -> None:
    removed, b, b_early, items, sessions, alive = await _race_remove_vs_add(
        client,
        auth_headers,
        setup,
        db_session,
        session_factory,
        monkeypatch,
        pause_at=pause_at,
        performed=performed,
    )
    assert removed is True
    # Never a deadlock / driver error: B either answers or is refused cleanly.
    assert not isinstance(b, BaseException) or isinstance(b, ValueError), repr(b)
    # No duplicates and no orphan sessions, whatever the order.
    assert items in (0, 1)
    assert sessions == items
    if isinstance(b, BaseException):
        # R → B: B saw the removal (and, for a planned treatment, its deletion).
        assert items == 0 and (performed or not alive)
    else:
        item, created = b
        if created:
            # R → B: the item was gone when B looked, so B created a fresh one.
            assert items == 1 and alive
        else:
            # B → R: B read the committed state (item still there) and A then
            # removed it. A valid serial order; B's 200 reflects what existed
            # when it ran and created nothing.
            assert items == 0
    # Observed serial orders (documented in ADR 0023, "Lock order"):
    if pause_at == "before_orphan_delete" or performed:
        # A holds no Treatment lock yet: B reads the committed state (item present),
        # answers 200 without creating anything -> order B -> R.
        assert b_early and not isinstance(b, BaseException) and b[1] is False
    else:
        # A already holds the Treatment lock: B waits for A's commit -> order R -> B.
        assert not b_early and isinstance(b, ValueError)
    # B never produced a second `treatment_added` for the original link.
    assert spy.n("treatment_plan.treatment_added") <= 1
