"""DP-08.B1 — ``POST /treatment-plans/{id}/items`` is idempotent per plan.

Contract under test (see ``TreatmentPlanService.add_item``):

* first link                       → 201, one item, one session set, one event
* repeat, same treatment + plan    → 200, *the same item*, no side effects
* treatment linked to another plan → 409
* locked plan                      → 409 (a repeat is NOT an idempotent success)
* closed/terminal plan             → 400 (a repeat is NOT an idempotent success)
* other patient / other clinic     → 400 (existing access controls kept)

The concurrency tests use *independent* sessions on the disposable test
database: the shared ``client`` fixture serves every request from one
session, which cannot reproduce two transactions racing.
"""

import asyncio
from collections.abc import AsyncGenerator, Callable
from datetime import UTC, datetime
from typing import Any
from uuid import UUID, uuid4

import pytest
import pytest_asyncio
from httpx import AsyncClient
from sqlalchemy import func, select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool

from app.core.auth.models import Clinic
from app.core.events import event_bus
from app.modules.budget.models import BudgetItem
from app.modules.odontogram.models import Treatment
from app.modules.patients.models import Patient
from app.modules.treatment_plan import service as plan_service
from app.modules.treatment_plan.models import PlannedTreatmentItem, PlannedTreatmentItemSession
from app.modules.treatment_plan.service import (
    TreatmentAlreadyPlannedError,
    TreatmentPlanService,
)
from tests import db_isolation

from .test_treatment_plan import (  # noqa: F401
    _create_treatment,
    _ensure_clinic_and_patient,
    _seed_catalog_crown,
    _send_plan_budget,
)

PLANS = "/api/v1/treatment_plan/treatment-plans"


# ---------------------------------------------------------------------------
# Fixtures / helpers
# ---------------------------------------------------------------------------


@pytest.fixture
async def setup(
    db_session: AsyncSession, auth_headers: dict[str, str], client: AsyncClient
) -> dict:
    ctx = await _ensure_clinic_and_patient(db_session, client, auth_headers)
    ctx["crown_id"] = await _seed_catalog_crown(db_session, ctx["clinic_id"])
    return ctx


async def _create_plan(client: AsyncClient, headers: dict, setup: dict, title: str = "P") -> str:
    r = await client.post(
        PLANS, headers=headers, json={"patient_id": setup["patient_id"], "title": title}
    )
    assert r.status_code == 201, r.text
    return r.json()["data"]["id"]


async def _add(client: AsyncClient, headers: dict, plan_id: str, treatment_id: str, **extra: Any):
    return await client.post(
        f"{PLANS}/{plan_id}/items",
        headers=headers,
        json={"treatment_id": treatment_id, **extra},
    )


class _EventSpy:
    """Counts ``treatment_plan.treatment_added`` publishes, delegating to the real bus."""

    def __init__(self, monkeypatch: pytest.MonkeyPatch) -> None:
        self.added = 0
        original = event_bus.publish

        async def spy(event_type: str, data: dict, **kw: Any) -> None:
            if event_type == "treatment_plan.treatment_added":
                self.added += 1
            await original(event_type, data, **kw)

        monkeypatch.setattr(event_bus, "publish", spy)


@pytest.fixture
def event_spy(monkeypatch: pytest.MonkeyPatch) -> _EventSpy:
    return _EventSpy(monkeypatch)


async def _count(db: AsyncSession, model: type, *where: Any) -> int:
    result = await db.execute(select(func.count()).select_from(model).where(*where))
    return result.scalar_one()


# ---------------------------------------------------------------------------
# 1. First link / repeat on the same plan
# ---------------------------------------------------------------------------


async def test_first_association_returns_201_with_one_item_and_sessions(
    client: AsyncClient, auth_headers: dict, setup: dict, db_session: AsyncSession, event_spy
) -> None:
    plan_id = await _create_plan(client, auth_headers, setup)
    treatment_id = await _create_treatment(client, auth_headers, setup)

    r = await _add(client, auth_headers, plan_id, treatment_id)

    assert r.status_code == 201, r.text
    data = r.json()["data"]
    assert data["treatment_id"] == treatment_id
    assert data["treatment_plan_id"] == plan_id
    assert len(data["sessions"]) == 1
    assert event_spy.added == 1
    assert await _count(db_session, PlannedTreatmentItem) == 1


async def test_repeat_same_treatment_same_plan_returns_200_same_item_without_side_effects(
    client: AsyncClient, auth_headers: dict, setup: dict, db_session: AsyncSession, event_spy
) -> None:
    """Repeat = same item back; no new item/sessions/event/budget line; nothing mutated."""
    plan_id, first_id = await _plan_with_draft_budget(client, auth_headers, setup)
    budget_id = UUID(
        (await client.get(f"{PLANS}/{plan_id}", headers=auth_headers)).json()["data"]["budget_id"]
    )
    treatment_id = await _create_treatment(client, auth_headers, setup, tooth_number=15)

    r1 = await _add(client, auth_headers, plan_id, treatment_id, notes="original", sequence_order=7)
    assert r1.status_code == 201, r1.text
    item1 = r1.json()["data"]

    items_before = await _count(db_session, PlannedTreatmentItem)
    sessions_before = await _count(db_session, PlannedTreatmentItemSession)
    lines_before = await _count(db_session, BudgetItem, BudgetItem.budget_id == budget_id)
    events_before = event_spy.added

    # Repeat with *different* payload: it must not rewrite order/notes/doctor.
    r2 = await _add(
        client,
        auth_headers,
        plan_id,
        treatment_id,
        notes="changed",
        sequence_order=1,
        assigned_professional_id=str(uuid4()),
    )

    assert r2.status_code == 200, r2.text
    item2 = r2.json()["data"]
    assert item2["id"] == item1["id"]
    assert item2["notes"] == "original"
    assert item2["sequence_order"] == 7
    assert item2["assigned_professional_id"] == item1["assigned_professional_id"]
    assert [s["id"] for s in item2["sessions"]] == [s["id"] for s in item1["sessions"]]

    assert await _count(db_session, PlannedTreatmentItem) == items_before
    assert await _count(db_session, PlannedTreatmentItemSession) == sessions_before
    assert await _count(db_session, BudgetItem, BudgetItem.budget_id == budget_id) == lines_before
    assert event_spy.added == events_before


async def _plan_with_draft_budget(
    client: AsyncClient, headers: dict, setup: dict
) -> tuple[str, str]:
    """A confirmed plan (draft budget, still editable) holding one item."""
    plan_id = await _create_plan(client, headers, setup)
    first_treatment = await _create_treatment(client, headers, setup, tooth_number=16)
    first = await _add(client, headers, plan_id, first_treatment)
    assert first.status_code == 201, first.text
    r = await client.post(f"{PLANS}/{plan_id}/confirm", headers=headers)
    assert r.status_code == 200, r.text
    return plan_id, first.json()["data"]["id"]


# ---------------------------------------------------------------------------
# 2. Conflicts and preserved rejections
# ---------------------------------------------------------------------------


async def test_treatment_linked_to_another_plan_returns_409(
    client: AsyncClient, auth_headers: dict, setup: dict, db_session: AsyncSession, event_spy
) -> None:
    plan_a = await _create_plan(client, auth_headers, setup, "A")
    plan_b = await _create_plan(client, auth_headers, setup, "B")
    treatment_id = await _create_treatment(client, auth_headers, setup)
    assert (await _add(client, auth_headers, plan_a, treatment_id)).status_code == 201
    events_before = event_spy.added

    r = await _add(client, auth_headers, plan_b, treatment_id)

    assert r.status_code == 409, r.text
    assert r.json()["code"] == "treatment_already_planned"
    assert "another plan" in r.json()["message"]
    # Still exactly one item, owned by plan A; no extra event.
    assert await _count(db_session, PlannedTreatmentItem) == 1
    owner = (await db_session.execute(select(PlannedTreatmentItem.treatment_plan_id))).scalar_one()
    assert str(owner) == plan_a
    assert event_spy.added == events_before


async def test_locked_plan_rejects_new_and_repeat_with_409(
    client: AsyncClient, auth_headers: dict, setup: dict, db_session: AsyncSession
) -> None:
    """A sent budget locks the plan: even a repeat is a 409, never a 200."""
    plan_id, item_id = await _plan_with_draft_budget(client, auth_headers, setup)
    treatment_id = await _create_treatment(client, auth_headers, setup, tooth_number=15)
    assert (await _add(client, auth_headers, plan_id, treatment_id)).status_code == 201
    await _send_plan_budget(client, auth_headers, plan_id)

    existing = (
        await db_session.execute(
            select(PlannedTreatmentItem.treatment_id).where(
                PlannedTreatmentItem.id == UUID(item_id)
            )
        )
    ).scalar_one()
    repeat = await _add(client, auth_headers, plan_id, str(existing))
    fresh = await _add(
        client, auth_headers, plan_id, await _create_treatment(client, auth_headers, setup, 14)
    )

    assert repeat.status_code == 409, repeat.text
    assert fresh.status_code == 409, fresh.text
    assert repeat.json()["code"] == "plan_locked"
    assert fresh.json()["code"] == "plan_locked"


async def test_closed_plan_repeat_keeps_rejection_instead_of_idempotent_success(
    client: AsyncClient, auth_headers: dict, setup: dict
) -> None:
    plan_id = await _create_plan(client, auth_headers, setup)
    treatment_id = await _create_treatment(client, auth_headers, setup)
    assert (await _add(client, auth_headers, plan_id, treatment_id)).status_code == 201
    closed = await client.post(
        f"{PLANS}/{plan_id}/close",
        headers=auth_headers,
        json={"closure_reason": "cancelled_by_clinic"},
    )
    assert closed.status_code == 200, closed.text

    r = await _add(client, auth_headers, plan_id, treatment_id)

    assert r.status_code == 400, r.text
    assert "completed/closed" in r.json()["message"]


async def test_treatment_of_another_patient_is_rejected_and_not_linked(
    client: AsyncClient, auth_headers: dict, setup: dict, db_session: AsyncSession
) -> None:
    plan_id = await _create_plan(client, auth_headers, setup)
    other = await client.post(
        "/api/v1/patients",
        headers=auth_headers,
        json={"first_name": "Otro", "last_name": "Paciente", "phone": "+34666000111"},
    )
    assert other.status_code == 201, other.text
    foreign = await _create_treatment(
        client, auth_headers, {**setup, "patient_id": other.json()["data"]["id"]}
    )

    r = await _add(client, auth_headers, plan_id, foreign)

    assert r.status_code == 400, r.text
    assert await _count(db_session, PlannedTreatmentItem) == 0


async def test_treatment_of_another_clinic_is_rejected_and_not_linked(
    client: AsyncClient, auth_headers: dict, setup: dict, db_session: AsyncSession
) -> None:
    plan_id = await _create_plan(client, auth_headers, setup)
    other_clinic = Clinic(
        id=uuid4(),
        name="Otra",
        tax_id="B22222222",
        address={"street": "x", "city": "y"},
        settings={},
    )
    db_session.add(other_clinic)
    await db_session.flush()
    other_patient = Patient(
        id=uuid4(), clinic_id=other_clinic.id, first_name="Z", last_name="Z", phone="+34666999888"
    )
    db_session.add(other_patient)
    await db_session.flush()
    foreign = Treatment(
        id=uuid4(),
        clinic_id=other_clinic.id,
        patient_id=other_patient.id,
        clinical_type="crown",
        scope="tooth",
        status="planned",
        recorded_at=datetime.now(UTC),
    )
    db_session.add(foreign)
    await db_session.flush()

    r = await _add(client, auth_headers, plan_id, str(foreign.id))

    assert r.status_code == 400, r.text
    assert await _count(db_session, PlannedTreatmentItem) == 0


# ---------------------------------------------------------------------------
# 3. Concurrency (independent sessions on the disposable test DB)
# ---------------------------------------------------------------------------


@pytest_asyncio.fixture
async def session_factory() -> AsyncGenerator[Callable[[], AsyncSession], None]:
    db_isolation.assert_safe_to_destroy(
        db_isolation.TEST_DATABASE_URL, db_isolation.DEV_DATABASE_URL
    )
    engine = create_async_engine(db_isolation.TEST_DATABASE_URL, poolclass=NullPool)
    maker = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    yield maker
    await engine.dispose()


async def _committed_plan_and_treatment(
    client: AsyncClient, headers: dict, setup: dict, db_session: AsyncSession
) -> tuple[UUID, UUID, UUID]:
    plan_id = await _create_plan(client, headers, setup)
    treatment_id = await _create_treatment(client, headers, setup)
    await db_session.commit()  # other sessions must see the fixtures
    return UUID(setup["clinic_id"]), UUID(plan_id), UUID(treatment_id)


async def test_concurrent_requests_serialize_on_the_treatment_row_lock(
    client: AsyncClient,
    auth_headers: dict,
    setup: dict,
    db_session: AsyncSession,
    session_factory,
    event_spy,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Request B blocks (at the DB) until A commits, then answers idempotently."""
    clinic_id, plan_id, treatment_id = await _committed_plan_and_treatment(
        client, auth_headers, setup, db_session
    )
    data = {"treatment_id": treatment_id}

    real_find = plan_service._find_item_by_treatment
    find_calls = {"n": 0}

    async def counting_find(db: AsyncSession, cid: UUID, tid: UUID):
        find_calls["n"] += 1
        return await real_find(db, cid, tid)

    monkeypatch.setattr(plan_service, "_find_item_by_treatment", counting_find)

    async with session_factory() as s1, session_factory() as s2, session_factory() as probe:
        item1, created1 = await TreatmentPlanService.add_item(s1, clinic_id, plan_id, data)
        assert created1 is True  # s1 holds the row lock, transaction still open

        task = asyncio.create_task(TreatmentPlanService.add_item(s2, clinic_id, plan_id, data))
        try:
            await asyncio.sleep(0.7)
            assert not task.done(), "second request must be blocked"
            # *What* it is blocked on matters: the Treatment row lock, not the
            # later INSERT into the UNIQUE index (which would mean the lock is
            # missing and only the last barrier is holding).
            waiting_queries = (
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
            assert waiting_queries, "no backend is waiting on a lock"
            assert all("for update" in q.lower() for q in waiting_queries), waiting_queries

            await s1.commit()
            item2, created2 = await asyncio.wait_for(task, timeout=10)
            await s2.commit()
        finally:
            # On a failed assertion s1 still holds its locks and ``task`` is
            # parked behind them: release and drain so the test fails cleanly
            # instead of deadlocking on session teardown.
            await s1.rollback()
            await asyncio.gather(task, return_exceptions=True)

    assert created2 is False
    # s1: check (none) · s2: check after the lock (found). A third call would
    # mean s2 went through INSERT → IntegrityError → recovery instead.
    assert find_calls["n"] == 2
    assert item2.id == item1.id
    assert event_spy.added == 1
    async with session_factory() as check:
        assert await _count(check, PlannedTreatmentItem) == 1
        assert await _count(check, PlannedTreatmentItemSession) == 1


async def test_simultaneous_requests_create_one_item_one_session_set_one_event(
    client: AsyncClient,
    auth_headers: dict,
    setup: dict,
    db_session: AsyncSession,
    session_factory,
    event_spy,
) -> None:
    clinic_id, plan_id, treatment_id = await _committed_plan_and_treatment(
        client, auth_headers, setup, db_session
    )

    async def attempt() -> tuple[UUID, bool]:
        async with session_factory() as s:
            item, created = await TreatmentPlanService.add_item(
                s, clinic_id, plan_id, {"treatment_id": treatment_id}
            )
            await s.commit()
            return item.id, created

    results = await asyncio.wait_for(asyncio.gather(*(attempt() for _ in range(5))), timeout=30)

    assert sum(1 for _, created in results if created) == 1
    assert len({item_id for item_id, _ in results}) == 1
    assert event_spy.added == 1
    async with session_factory() as check:
        assert await _count(check, PlannedTreatmentItem) == 1
        assert await _count(check, PlannedTreatmentItemSession) == 1


async def test_unique_violation_is_recovered_inside_a_savepoint(
    client: AsyncClient,
    auth_headers: dict,
    setup: dict,
    db_session: AsyncSession,
    session_factory,
    event_spy,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """If the existence check is blind (lock bypassed), UNIQUE still protects.

    The IntegrityError must be absorbed by the SAVEPOINT: the follow-up
    query runs on a *healthy* transaction (PostgreSQL would otherwise answer
    "current transaction is aborted"), and the repeat stays side-effect free.
    """
    clinic_id, plan_id, treatment_id = await _committed_plan_and_treatment(
        client, auth_headers, setup, db_session
    )
    data = {"treatment_id": treatment_id}
    async with session_factory() as s1:
        _, created = await TreatmentPlanService.add_item(s1, clinic_id, plan_id, data)
        assert created
        await s1.commit()
    assert event_spy.added == 1

    real_find = plan_service._find_item_by_treatment
    calls = {"n": 0}

    async def blind_first_call(db: AsyncSession, cid: UUID, tid: UUID):
        calls["n"] += 1
        return None if calls["n"] == 1 else await real_find(db, cid, tid)

    monkeypatch.setattr(plan_service, "_find_item_by_treatment", blind_first_call)

    async with session_factory() as s2:
        item, created = await TreatmentPlanService.add_item(s2, clinic_id, plan_id, data)
        assert created is False
        assert calls["n"] == 2  # existence check was blind; recovery re-queried
        # The outer transaction is still usable after the absorbed violation.
        assert (await s2.execute(text("select 1"))).scalar_one() == 1
        await s2.commit()

    assert event_spy.added == 1  # no second treatment_added
    async with session_factory() as check:
        assert await _count(check, PlannedTreatmentItem) == 1
        assert await _count(check, PlannedTreatmentItemSession) == 1


async def test_unique_violation_against_another_plan_surfaces_as_conflict(
    client: AsyncClient,
    auth_headers: dict,
    setup: dict,
    db_session: AsyncSession,
    session_factory,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    clinic_id, plan_a, treatment_id = await _committed_plan_and_treatment(
        client, auth_headers, setup, db_session
    )
    plan_b = UUID(await _create_plan(client, auth_headers, setup, "B"))
    await db_session.commit()
    data = {"treatment_id": treatment_id}
    async with session_factory() as s1:
        await TreatmentPlanService.add_item(s1, clinic_id, plan_a, data)
        await s1.commit()

    real_find = plan_service._find_item_by_treatment
    calls = {"n": 0}

    async def blind_first_call(db: AsyncSession, cid: UUID, tid: UUID):
        calls["n"] += 1
        return None if calls["n"] == 1 else await real_find(db, cid, tid)

    monkeypatch.setattr(plan_service, "_find_item_by_treatment", blind_first_call)

    async with session_factory() as s2:
        with pytest.raises(TreatmentAlreadyPlannedError):
            await TreatmentPlanService.add_item(s2, clinic_id, plan_b, data)
        assert (await s2.execute(text("select 1"))).scalar_one() == 1
        await s2.rollback()

    async with session_factory() as check:
        assert await _count(check, PlannedTreatmentItem) == 1


async def test_other_integrity_errors_are_not_swallowed(
    client: AsyncClient,
    auth_headers: dict,
    setup: dict,
    db_session: AsyncSession,
    session_factory,
) -> None:
    """Only ``uq_planned_item_treatment`` is recovered; any other violation propagates."""
    clinic_id, plan_id, treatment_id = await _committed_plan_and_treatment(
        client, auth_headers, setup, db_session
    )
    async with session_factory() as s:
        with pytest.raises((IntegrityError, ValueError)):
            # Unknown user id → professional validation (ValueError) or FK (IntegrityError).
            await TreatmentPlanService.add_item(
                s,
                clinic_id,
                plan_id,
                {"treatment_id": treatment_id, "assigned_professional_id": uuid4()},
            )
        await s.rollback()
    async with session_factory() as check:
        assert await _count(check, PlannedTreatmentItem) == 0


async def test_failure_after_insert_rolls_back_item_sessions_and_lock(
    client: AsyncClient,
    auth_headers: dict,
    setup: dict,
    db_session: AsyncSession,
    session_factory,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A failing subscriber aborts the whole link; the treatment stays retryable."""
    clinic_id, plan_id, treatment_id = await _committed_plan_and_treatment(
        client, auth_headers, setup, db_session
    )
    data = {"treatment_id": treatment_id}
    original = event_bus.publish

    async def exploding(event_type: str, payload: dict, **kw: Any) -> None:
        if event_type == "treatment_plan.treatment_added":
            raise RuntimeError("subscriber exploded")
        await original(event_type, payload, **kw)

    monkeypatch.setattr(event_bus, "publish", exploding)
    async with session_factory() as s1:
        with pytest.raises(RuntimeError):
            await TreatmentPlanService.add_item(s1, clinic_id, plan_id, data)
        await s1.rollback()

    async with session_factory() as check:
        assert await _count(check, PlannedTreatmentItem) == 0
        assert await _count(check, PlannedTreatmentItemSession) == 0

    monkeypatch.setattr(event_bus, "publish", original)
    async with session_factory() as s2:  # lock was released; retry succeeds
        _, created = await asyncio.wait_for(
            TreatmentPlanService.add_item(s2, clinic_id, plan_id, data), timeout=10
        )
        assert created is True
        await s2.commit()
