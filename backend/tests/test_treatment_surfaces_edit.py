"""DP-08.B2 — safe editing of a treatment's surfaces (F5).

Policy under test (ADR 0023, "Surfaces edit"): ``TreatmentService.update``
changes surfaces only for a planned, single-tooth, surface-capable treatment
that nothing else points at. It locks the Treatment row, checks its own rules,
then publishes ``odontogram.treatment.surfaces_update_requested`` with the
request's session; ``treatment_plan`` (items, any plan/status) and ``budget``
(lines, any budget/status) must both acknowledge it. Everything is decided
BEFORE any write, so a refusal (HTTP 409 ``treatment_surfaces_locked``) leaves
notes, status, surfaces and prices untouched.

Concurrency uses independent sessions on the disposable test database.
"""

import asyncio
from collections.abc import AsyncGenerator, Callable
from decimal import Decimal
from typing import Any
from uuid import UUID, uuid4

import pytest
import pytest_asyncio
from httpx import AsyncClient
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool

from app.core.events import event_bus
from app.core.events.types import EventType
from app.modules.budget.models import BudgetItem
from app.modules.catalog.models import (
    TreatmentCatalogItem,
    TreatmentCategory,
    TreatmentOdontogramMapping,
    VatType,
)
from app.modules.odontogram.service import (
    TreatmentService,
    TreatmentSurfacesEditBlockedError,
    TreatmentSurfacesGuardUnavailableError,
)
from app.modules.treatment_plan.events import on_treatment_surfaces_update_requested
from app.modules.treatment_plan.models import PlannedTreatmentItem
from app.modules.treatment_plan.service import TreatmentPlanService
from tests import db_isolation

from .test_plan_budget_lifecycle import _accept_budget
from .test_treatment_plan import (  # noqa: F401
    _create_treatment,
    _ensure_clinic_and_patient,
    _seed_catalog_crown,
    _send_plan_budget,
)

PLANS = "/api/v1/treatment_plan/treatment-plans"
TREATMENTS = "/api/v1/odontogram/treatments"
REQUESTED = EventType.ODONTOGRAM_TREATMENT_SURFACES_UPDATE_REQUESTED
STATUS_CHANGED = EventType.ODONTOGRAM_TREATMENT_STATUS_CHANGED
LOCKED_PREFIX = "surfaces_locked_"


async def _seed_filling(
    db: AsyncSession, clinic_id: Any, *, strategy: str = "per_surface", code: str = "FILL"
) -> str:
    """Catalog filling: 1 surface = 50, 2 = 80, 3 = 100 (per_surface)."""
    vat = VatType(clinic_id=clinic_id, names={"es": "Exento"}, rate=0.0, is_default=False)
    db.add(vat)
    await db.flush()
    cat = TreatmentCategory(
        clinic_id=clinic_id, key=code.lower(), names={"es": "O"}, is_system=True
    )
    db.add(cat)
    await db.flush()
    item = TreatmentCatalogItem(
        clinic_id=clinic_id,
        category_id=cat.id,
        internal_code=code,
        names={"es": "Obturación"},
        default_price=Decimal("50.00"),
        default_duration_minutes=30,
        pricing_strategy=strategy,
        surface_prices={"1": "50.00", "2": "80.00", "3": "100.00"}
        if strategy == "per_surface"
        else None,
        treatment_scope="tooth",
        vat_type_id=vat.id,
    )
    db.add(item)
    await db.flush()
    db.add(
        TreatmentOdontogramMapping(
            clinic_id=clinic_id,
            catalog_item_id=item.id,
            odontogram_treatment_type="filling_composite",
            clinical_category="restauradora",
            visualization_rules=[],
            visualization_config={},
        )
    )
    await db.commit()
    return str(item.id)


@pytest.fixture
async def setup(
    db_session: AsyncSession, auth_headers: dict[str, str], client: AsyncClient
) -> dict:
    ctx = await _ensure_clinic_and_patient(db_session, client, auth_headers)
    ctx["crown_id"] = await _seed_catalog_crown(db_session, ctx["clinic_id"])
    ctx["filling_id"] = await _seed_filling(db_session, ctx["clinic_id"])
    ctx["flat_filling_id"] = await _seed_filling(
        db_session, ctx["clinic_id"], strategy="flat", code="FLATFILL"
    )
    return ctx


class _Spy:
    def __init__(self, monkeypatch: pytest.MonkeyPatch) -> None:
        self.counts: dict[str, int] = {}
        original = event_bus.publish

        async def spy(event_type: str, data: dict, **kw: Any) -> None:
            self.counts[str(event_type)] = self.counts.get(str(event_type), 0) + 1
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


async def _filling(
    client: AsyncClient,
    headers: dict,
    setup: dict,
    *,
    surfaces: list[str] | None = None,
    teeth: list[int] | None = None,
    catalog: str = "filling_id",
) -> str:
    r = await client.post(
        f"/api/v1/odontogram/patients/{setup['patient_id']}/treatments",
        headers=headers,
        json={
            "catalog_item_id": setup[catalog],
            "tooth_numbers": teeth or [16],
            "surfaces": surfaces if surfaces is not None else ["O"],
            "status": "planned",
        },
    )
    assert r.status_code == 201, r.text
    return r.json()["data"]["id"]


async def _state(db: AsyncSession, tid: str) -> dict:
    """Everything an edit could touch, read straight from the database."""
    db.expire_all()
    row = (
        await db.execute(
            text(
                "select status, notes, performed_at, price_snapshot, duration_snapshot, "
                "vat_rate_snapshot, visualization_snapshot::text as vis, budget_item_id, updated_at "
                "from treatments where id = :i"
            ),
            {"i": tid},
        )
    ).one()
    teeth = (
        await db.execute(
            text(
                "select tooth_number, surfaces::text from treatment_teeth where treatment_id = :i order by 1"
            ),
            {"i": tid},
        )
    ).all()
    return {**row._asdict(), "teeth": [tuple(t) for t in teeth]}


def _surfaces(state: dict) -> set[str]:
    import json  # noqa: PLC0415

    return set(json.loads(state["teeth"][0][1] or "[]"))


async def _put(client: AsyncClient, headers: dict, tid: str, **body: Any):
    return await client.put(f"{TREATMENTS}/{tid}", headers=headers, json=body)


async def _plan(client: AsyncClient, headers: dict, setup: dict) -> str:
    r = await client.post(
        PLANS, headers=headers, json={"patient_id": setup["patient_id"], "title": "P"}
    )
    assert r.status_code == 201, r.text
    return r.json()["data"]["id"]


async def _linked(client: AsyncClient, headers: dict, setup: dict) -> tuple[str, str]:
    plan_id = await _plan(client, headers, setup)
    tid = await _filling(client, headers, setup)
    r = await client.post(f"{PLANS}/{plan_id}/items", headers=headers, json={"treatment_id": tid})
    assert r.status_code == 201, r.text
    return plan_id, tid


async def _assert_refused(client, headers, db, tid, reason, **body) -> dict:
    before = await _state(db, tid)
    r = await _put(client, headers, tid, **body)
    assert r.status_code == 409, r.text
    reasons = (reason,) if isinstance(reason, str) else reason
    assert r.json()["code"] in {LOCKED_PREFIX + x for x in reasons}, r.text
    assert await _state(db, tid) == before, "a refused edit must not change anything"
    return r.json()


# ---------------------------------------------------------------------------
# Allowed
# ---------------------------------------------------------------------------


async def test_independent_single_tooth_treatment_can_change_surfaces(
    client: AsyncClient, auth_headers: dict, setup: dict, db_session: AsyncSession, spy
) -> None:
    tid = await _filling(client, auth_headers, setup, surfaces=["O"])
    before = await _state(db_session, tid)
    assert before["price_snapshot"] == Decimal("50.00")

    r = await _put(client, auth_headers, tid, surfaces=["M", "O"])

    assert r.status_code == 200, r.text
    assert set(r.json()["data"]["teeth"][0]["surfaces"]) == {"M", "O"}
    after = await _state(db_session, tid)
    assert _surfaces(after) == {"M", "O"}
    assert after["price_snapshot"] == Decimal("80.00")  # per_surface tier, catalog unchanged
    assert after["duration_snapshot"] == before["duration_snapshot"]
    assert after["vat_rate_snapshot"] == before["vat_rate_snapshot"]
    assert after["vis"] == before["vis"]  # visualization_snapshot is never rewritten
    assert spy.n(REQUESTED) == 1


async def test_equivalent_surfaces_in_another_order_do_nothing(
    client: AsyncClient, auth_headers: dict, setup: dict, db_session: AsyncSession, spy
) -> None:
    tid = await _filling(client, auth_headers, setup, surfaces=["O", "M"])
    # A sentinel price: a recompute would overwrite it with the catalog tier.
    await db_session.execute(
        text("update treatments set price_snapshot = 999.99 where id = :i"), {"i": tid}
    )
    await db_session.commit()
    before = await _state(db_session, tid)

    r = await _put(client, auth_headers, tid, surfaces=["M", "O", "M"])

    assert r.status_code == 200, r.text
    after = await _state(db_session, tid)
    assert after["price_snapshot"] == Decimal("999.99")
    assert after["teeth"] == before["teeth"]  # stored order untouched too
    assert spy.n(REQUESTED) == 0  # not even a clearance round: nothing changes


async def test_notes_only_update_is_unchanged(
    client: AsyncClient, auth_headers: dict, setup: dict, db_session: AsyncSession, spy
) -> None:
    tid = await _filling(client, auth_headers, setup)
    before = await _state(db_session, tid)

    r = await _put(client, auth_headers, tid, notes="revisar en 6 meses")

    assert r.status_code == 200, r.text
    after = await _state(db_session, tid)
    assert after["notes"] == "revisar en 6 meses"
    assert after["teeth"] == before["teeth"] and after["price_snapshot"] == before["price_snapshot"]
    assert spy.n(REQUESTED) == 0


async def test_linked_treatment_may_still_change_notes(
    client: AsyncClient, auth_headers: dict, setup: dict, db_session: AsyncSession
) -> None:
    _, tid = await _linked(client, auth_headers, setup)
    r = await _put(client, auth_headers, tid, notes="nota", surfaces=["O"])  # same surfaces
    assert r.status_code == 200, r.text
    assert (await _state(db_session, tid))["notes"] == "nota"


async def test_non_per_surface_price_stays_frozen_even_if_catalog_moved(
    client: AsyncClient, auth_headers: dict, setup: dict, db_session: AsyncSession
) -> None:
    """Surfaces do not move a flat price; the live catalog must not leak in."""
    tid = await _filling(client, auth_headers, setup, catalog="flat_filling_id")
    await db_session.execute(
        text(
            "update treatment_catalog_items set default_price = 777, default_duration_minutes = 90 "
            "where id = :c"
        ),
        {"c": setup["flat_filling_id"]},
    )
    await db_session.commit()
    before = await _state(db_session, tid)

    r = await _put(client, auth_headers, tid, surfaces=["M", "O", "D"])

    assert r.status_code == 200, r.text
    after = await _state(db_session, tid)
    assert _surfaces(after) == {"M", "O", "D"}
    assert after["price_snapshot"] == before["price_snapshot"] == Decimal("50.00")
    assert after["duration_snapshot"] == before["duration_snapshot"] == 30


async def test_per_surface_catalog_drift_refuses_instead_of_repricing(
    client: AsyncClient, auth_headers: dict, setup: dict, db_session: AsyncSession
) -> None:
    tid = await _filling(client, auth_headers, setup, surfaces=["O"])
    await db_session.execute(
        text(
            'update treatment_catalog_items set surface_prices = \'{"1": "60.00", "2": "90.00"}\' '
            "where id = :c"
        ),
        {"c": setup["filling_id"]},
    )
    await db_session.commit()

    await _assert_refused(
        client, auth_headers, db_session, tid, "price_snapshot_drift", surfaces=["M", "O"]
    )


# ---------------------------------------------------------------------------
# Refused: links
# ---------------------------------------------------------------------------


async def test_linked_to_plan_without_budget_is_refused(
    client: AsyncClient, auth_headers: dict, setup: dict, db_session: AsyncSession, spy
) -> None:
    _, tid = await _linked(client, auth_headers, setup)
    await _assert_refused(
        client, auth_headers, db_session, tid, "linked_to_plan", surfaces=["M", "O"]
    )


@pytest.mark.parametrize("stage", ["draft", "sent", "accepted"])
async def test_plan_with_budget_is_refused(
    client: AsyncClient, auth_headers: dict, setup: dict, db_session: AsyncSession, stage: str
) -> None:
    plan_id, tid = await _linked(client, auth_headers, setup)
    assert (
        await client.post(f"{PLANS}/{plan_id}/confirm", headers=auth_headers)
    ).status_code == 200
    if stage != "draft":
        budget_id = await _send_plan_budget(client, auth_headers, plan_id)
    if stage == "accepted":
        await _accept_budget(client, auth_headers, budget_id)

    body = await _assert_refused(
        client,
        auth_headers,
        db_session,
        tid,
        ("linked_to_plan", "linked_to_budget"),
        surfaces=["M", "O"],
    )
    assert body["errors"]


@pytest.mark.parametrize("how", ["close", "archive"])
async def test_closed_or_archived_plan_keeps_protecting_the_treatment(
    client: AsyncClient, auth_headers: dict, setup: dict, db_session: AsyncSession, how: str
) -> None:
    plan_id = await _plan(client, auth_headers, setup)
    tid = await _filling(client, auth_headers, setup)
    # Performed treatments survive close/archive and keep their item as history.
    r = await client.post(
        f"{PLANS}/{plan_id}/items", headers=auth_headers, json={"treatment_id": tid}
    )
    assert r.status_code == 201, r.text
    assert (
        await client.patch(f"{TREATMENTS}/{tid}/perform", headers=auth_headers, json={})
    ).status_code == 200
    if how == "close":
        r = await client.post(
            f"{PLANS}/{plan_id}/close", headers=auth_headers, json={"closure_reason": "other"}
        )
        assert r.status_code == 200, r.text
    else:
        assert (await client.delete(f"{PLANS}/{plan_id}", headers=auth_headers)).status_code == 204

    # performed → refused by the status rule first; the item row is the remaining link
    await _assert_refused(client, auth_headers, db_session, tid, "not_planned", surfaces=["M", "O"])
    assert (
        await db_session.execute(
            select(PlannedTreatmentItem.id).where(PlannedTreatmentItem.treatment_id == UUID(tid))
        )
    ).first() is not None


async def test_closed_plan_validator_blocks_planned_treatment_with_history_item(
    client: AsyncClient, auth_headers: dict, setup: dict, db_session: AsyncSession
) -> None:
    """The plan validator alone (status rule satisfied) blocks on a history item."""
    plan_id, tid = await _linked(client, auth_headers, setup)
    await db_session.execute(
        text("update treatment_plans set status = 'closed' where id = :p"), {"p": plan_id}
    )
    await db_session.commit()
    await _assert_refused(client, auth_headers, db_session, tid, "linked_to_plan", surfaces=["D"])


async def test_direct_budget_item_id_on_the_treatment_is_refused(
    client: AsyncClient, auth_headers: dict, setup: dict, db_session: AsyncSession
) -> None:
    tid = await _filling(client, auth_headers, setup)
    await db_session.execute(
        text("update treatments set budget_item_id = :b where id = :i"),
        {"b": str(uuid4()), "i": tid},
    )
    await db_session.commit()
    await _assert_refused(
        client, auth_headers, db_session, tid, "linked_to_budget", surfaces=["M", "O"]
    )


async def _budget_with_line(
    client: AsyncClient, headers: dict, setup: dict, tid: str | None
) -> tuple[str, str]:
    r = await client.post(
        "/api/v1/budget/budgets", headers=headers, json={"patient_id": setup["patient_id"]}
    )
    assert r.status_code == 201, r.text
    budget_id = r.json()["data"]["id"]
    if tid is None:
        return budget_id, ""
    r = await client.post(
        f"/api/v1/budget/budgets/{budget_id}/items",
        headers=headers,
        json={"catalog_item_id": setup["filling_id"], "treatment_id": tid, "tooth_number": 16},
    )
    assert r.status_code in (200, 201), r.text
    return budget_id, r.json()["data"]["id"]


async def test_budget_line_pointing_at_the_treatment_is_refused(
    client: AsyncClient, auth_headers: dict, setup: dict, db_session: AsyncSession
) -> None:
    """Only BudgetItem.treatment_id links them: Treatment.budget_item_id stays NULL."""
    tid = await _filling(client, auth_headers, setup)
    await _budget_with_line(client, auth_headers, setup, tid)
    assert (await _state(db_session, tid))["budget_item_id"] is None

    await _assert_refused(
        client, auth_headers, db_session, tid, "linked_to_budget", surfaces=["M", "O"]
    )


# ---------------------------------------------------------------------------
# Refused: shape of the treatment
# ---------------------------------------------------------------------------


async def test_performed_treatment_is_refused(
    client: AsyncClient, auth_headers: dict, setup: dict, db_session: AsyncSession
) -> None:
    tid = await _filling(client, auth_headers, setup)
    assert (
        await client.patch(f"{TREATMENTS}/{tid}/perform", headers=auth_headers, json={})
    ).status_code == 200
    await _assert_refused(client, auth_headers, db_session, tid, "not_planned", surfaces=["M", "O"])


async def test_multi_tooth_treatment_is_refused(
    client: AsyncClient, auth_headers: dict, setup: dict, db_session: AsyncSession
) -> None:
    tid = await _filling(client, auth_headers, setup, teeth=[16, 17])
    await _assert_refused(
        client, auth_headers, db_session, tid, "not_single_tooth", surfaces=["M", "O"]
    )


async def test_bridge_is_refused(
    client: AsyncClient, auth_headers: dict, setup: dict, db_session: AsyncSession
) -> None:
    tid = await _filling(client, auth_headers, setup, teeth=[14, 15, 16])
    await db_session.execute(
        text("update treatments set clinical_type = 'bridge' where id = :i"), {"i": tid}
    )
    await db_session.commit()
    await _assert_refused(client, auth_headers, db_session, tid, "not_single_tooth", surfaces=["D"])


async def test_global_scope_is_refused(
    client: AsyncClient, auth_headers: dict, setup: dict, db_session: AsyncSession
) -> None:
    tid = await _filling(client, auth_headers, setup)
    await db_session.execute(
        text("update treatments set scope = 'global_mouth' where id = :i"), {"i": tid}
    )
    await db_session.commit()
    await _assert_refused(client, auth_headers, db_session, tid, "not_single_tooth", surfaces=["D"])


async def test_type_that_does_not_use_surfaces_is_refused(
    client: AsyncClient, auth_headers: dict, setup: dict, db_session: AsyncSession
) -> None:
    tid = await _create_treatment(client, auth_headers, setup)  # crown
    await _assert_refused(
        client, auth_headers, db_session, tid, "type_without_surfaces", surfaces=["O"]
    )


async def test_unknown_treatment_is_404(
    client: AsyncClient, auth_headers: dict, setup: dict
) -> None:
    r = await _put(client, auth_headers, str(uuid4()), surfaces=["O"])
    assert r.status_code == 404


# ---------------------------------------------------------------------------
# No partial writes on a combined request
# ---------------------------------------------------------------------------


async def test_combined_request_with_forbidden_surfaces_changes_nothing(
    client: AsyncClient, auth_headers: dict, setup: dict, db_session: AsyncSession, spy
) -> None:
    _, tid = await _linked(client, auth_headers, setup)
    before = await _state(db_session, tid)

    r = await _put(
        client, auth_headers, tid, notes="nueva", status="performed", surfaces=["M", "O"]
    )

    assert r.status_code == 409 and r.json()["code"].startswith(LOCKED_PREFIX)
    assert await _state(db_session, tid) == before  # notes, status, performed_at, surfaces, price
    assert spy.n(STATUS_CHANGED) == 0


async def test_combined_request_that_would_also_perform_is_refused(
    client: AsyncClient, auth_headers: dict, setup: dict, db_session: AsyncSession
) -> None:
    """Edit + perform in one call must not become a way around the planned-only rule."""
    tid = await _filling(client, auth_headers, setup)
    await _assert_refused(
        client,
        auth_headers,
        db_session,
        tid,
        "not_planned",
        status="performed",
        surfaces=["M", "O"],
    )


# ---------------------------------------------------------------------------
# Fail closed
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("missing", ["treatment_plan", "budget"])
async def test_missing_required_validator_is_a_503_and_changes_nothing(
    client: AsyncClient,
    auth_headers: dict,
    setup: dict,
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
    missing: str,
) -> None:
    tid = await _filling(client, auth_headers, setup)
    before = await _state(db_session, tid)
    kept = [
        h
        for h in event_bus._handlers[REQUESTED]
        if missing not in (getattr(h, "__module__", "") or "")
    ]
    assert len(kept) == 1, "exactly the other validator must remain"
    monkeypatch.setitem(event_bus._handlers, REQUESTED, kept)

    r = await _put(client, auth_headers, tid, surfaces=["M", "O"])

    assert r.status_code == 503, r.text
    assert r.json()["code"] == "surfaces_guard_unavailable"
    assert missing in r.json()["message"]
    assert await _state(db_session, tid) == before


async def test_no_validator_at_all_is_a_503(
    client: AsyncClient,
    auth_headers: dict,
    setup: dict,
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    tid = await _filling(client, auth_headers, setup)
    before = await _state(db_session, tid)
    monkeypatch.setitem(event_bus._handlers, REQUESTED, [])
    r = await _put(client, auth_headers, tid, surfaces=["M", "O"])
    assert r.status_code == 503 and r.json()["code"] == "surfaces_guard_unavailable"
    assert await _state(db_session, tid) == before


async def test_foreign_acknowledgement_cannot_stand_in_for_a_required_one(
    client: AsyncClient,
    auth_headers: dict,
    setup: dict,
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    tid = await _filling(client, auth_headers, setup)

    async def other(data: dict, *, db: AsyncSession) -> None:
        data.setdefault("cleared_by", []).append("something_else")

    monkeypatch.setitem(
        event_bus._handlers, REQUESTED, [on_treatment_surfaces_update_requested, other]
    )
    with pytest.raises(TreatmentSurfacesGuardUnavailableError) as exc:
        await TreatmentService.update(
            db_session, UUID(setup["clinic_id"]), UUID(tid), uuid4(), surfaces=["M", "O"]
        )
    assert "budget" in str(exc.value)
    await db_session.rollback()


def test_both_validators_are_registered_by_their_owners() -> None:
    from app.modules.budget import BudgetModule  # noqa: PLC0415
    from app.modules.treatment_plan import TreatmentPlanModule  # noqa: PLC0415

    assert (
        TreatmentPlanModule().get_event_handlers()[REQUESTED]
        is on_treatment_surfaces_update_requested
    )
    assert REQUESTED in BudgetModule().get_event_handlers()
    assert len(event_bus._handlers[REQUESTED]) >= 2


def test_odontogram_does_not_import_the_owners_models() -> None:
    import pathlib  # noqa: PLC0415

    src = (
        pathlib.Path(__file__).resolve().parents[1] / "app/modules/odontogram/service.py"
    ).read_text()
    assert "modules.treatment_plan" not in src and "modules.budget" not in src


# ---------------------------------------------------------------------------
# Concurrency (two independent PostgreSQL sessions)
# ---------------------------------------------------------------------------


class _Pause:
    """Pause a task right after a given event was published (inside its transaction)."""

    def __init__(self, monkeypatch: pytest.MonkeyPatch, event_type: str) -> None:
        self.reached, self.proceed = asyncio.Event(), asyncio.Event()
        real = event_bus.publish

        async def publish(et: str, data: dict, **kw: Any) -> None:
            await real(et, data, **kw)
            if str(et) == str(event_type):
                self.reached.set()
                await asyncio.wait_for(self.proceed.wait(), timeout=20)

        monkeypatch.setattr(event_bus, "publish", publish)

    async def wait_reached(self) -> None:
        await asyncio.wait_for(self.reached.wait(), timeout=15)


async def _in_request(session: AsyncSession, coro_fn: Callable[[], Any]):
    """Run like one HTTP request: commit on success, roll back on error."""
    try:
        result = await coro_fn()
        await session.commit()
        return result
    except BaseException:
        await session.rollback()
        raise


async def _committed(db: AsyncSession, tid: str) -> dict:
    return await _state(db, tid)


async def test_edit_then_association_is_serialized_by_the_treatment_lock(
    client, auth_headers, setup, db_session, session_factory, monkeypatch
) -> None:
    """U holds the Treatment lock after validating; add_item waits, then sees the new state."""
    plan_id = await _plan(client, auth_headers, setup)
    tid = await _filling(client, auth_headers, setup, surfaces=["O"])
    await db_session.commit()
    clinic_id, plan_uuid = UUID(setup["clinic_id"]), UUID(plan_id)
    pause = _Pause(monkeypatch, REQUESTED)

    async with session_factory() as s_u, session_factory() as s_b:
        t_u = asyncio.create_task(
            _in_request(
                s_u,
                lambda: TreatmentService.update(
                    s_u, clinic_id, UUID(tid), uuid4(), surfaces=["M", "O"]
                ),
            )
        )
        await pause.wait_reached()
        t_b = asyncio.create_task(
            _in_request(
                s_b,
                lambda: TreatmentPlanService.add_item(
                    s_b, clinic_id, plan_uuid, {"treatment_id": tid}
                ),
            )
        )
        await asyncio.sleep(0.8)
        assert not t_b.done(), "add_item must wait for the edit's Treatment lock"
        pause.proceed.set()
        await asyncio.wait_for(t_u, timeout=20)
        item, created = await asyncio.wait_for(t_b, timeout=20)

    assert created is True  # order U → B: associated AFTER the edit
    state = await _committed(db_session, tid)
    assert _surfaces(state) == {"M", "O"} and state["price_snapshot"] == Decimal("80.00")
    assert item.treatment_id == UUID(tid)


async def test_association_then_edit_is_refused_after_the_item_commits(
    client, auth_headers, setup, db_session, session_factory, monkeypatch
) -> None:
    """add_item holds the lock mid-transaction; the edit waits and then sees the item (409)."""
    plan_id = await _plan(client, auth_headers, setup)
    tid = await _filling(client, auth_headers, setup, surfaces=["O"])
    await db_session.commit()
    clinic_id, plan_uuid = UUID(setup["clinic_id"]), UUID(plan_id)
    pause = _Pause(monkeypatch, EventType.TREATMENT_PLAN_TREATMENT_ADDED)

    async with session_factory() as s_b, session_factory() as s_u:
        t_b = asyncio.create_task(
            _in_request(
                s_b,
                lambda: TreatmentPlanService.add_item(
                    s_b, clinic_id, plan_uuid, {"treatment_id": tid}
                ),
            )
        )
        await pause.wait_reached()
        t_u = asyncio.create_task(
            _in_request(
                s_u,
                lambda: TreatmentService.update(
                    s_u, clinic_id, UUID(tid), uuid4(), surfaces=["M", "O"]
                ),
            )
        )
        await asyncio.sleep(0.8)
        assert not t_u.done(), "the edit must wait for add_item's uncommitted association"
        pause.proceed.set()
        await asyncio.wait_for(t_b, timeout=20)
        with pytest.raises(TreatmentSurfacesEditBlockedError) as exc:
            await asyncio.wait_for(t_u, timeout=20)

    assert exc.value.reason == "linked_to_plan"
    state = await _committed(db_session, tid)
    assert _surfaces(state) == {"O"} and state["price_snapshot"] == Decimal("50.00")


async def _make_budget(db: AsyncSession, client, headers, setup) -> UUID:
    budget_id, _ = await _budget_with_line(client, headers, setup, None)
    await db.commit()
    return UUID(budget_id)


def _line(setup: dict, budget_id: UUID, tid: str) -> BudgetItem:
    return BudgetItem(
        clinic_id=UUID(setup["clinic_id"]),
        budget_id=budget_id,
        catalog_item_id=UUID(setup["filling_id"]),
        unit_price=Decimal("50.00"),
        treatment_id=UUID(tid),
    )


async def test_edit_then_budget_line_is_serialized_by_the_foreign_key_lock(
    client, auth_headers, setup, db_session, session_factory, monkeypatch
) -> None:
    """The budget line insert needs KEY SHARE on the treatment: it waits for the edit."""
    tid = await _filling(client, auth_headers, setup, surfaces=["O"])
    budget_id = await _make_budget(db_session, client, auth_headers, setup)
    pause = _Pause(monkeypatch, REQUESTED)
    clinic_id = UUID(setup["clinic_id"])

    async def insert_line(s: AsyncSession) -> None:
        s.add(_line(setup, budget_id, tid))
        await s.flush()

    async with session_factory() as s_u, session_factory() as s_b:
        t_u = asyncio.create_task(
            _in_request(
                s_u,
                lambda: TreatmentService.update(
                    s_u, clinic_id, UUID(tid), uuid4(), surfaces=["M", "O"]
                ),
            )
        )
        await pause.wait_reached()
        t_b = asyncio.create_task(_in_request(s_b, lambda: insert_line(s_b)))
        await asyncio.sleep(0.8)
        assert not t_b.done(), "the budget line must wait for the edit's row lock"
        pause.proceed.set()
        await asyncio.wait_for(t_u, timeout=20)
        await asyncio.wait_for(t_b, timeout=20)  # order U → B

    state = await _committed(db_session, tid)
    assert _surfaces(state) == {"M", "O"}
    lines = (
        await db_session.execute(select(BudgetItem.id).where(BudgetItem.treatment_id == UUID(tid)))
    ).all()
    assert len(lines) == 1


async def test_budget_line_then_edit_is_refused(
    client, auth_headers, setup, db_session, session_factory
) -> None:
    """An uncommitted budget line already holds KEY SHARE: the edit waits, then sees it."""
    tid = await _filling(client, auth_headers, setup, surfaces=["O"])
    budget_id = await _make_budget(db_session, client, auth_headers, setup)
    clinic_id = UUID(setup["clinic_id"])
    inserted, proceed = asyncio.Event(), asyncio.Event()

    async def line_request(s: AsyncSession) -> None:
        s.add(_line(setup, budget_id, tid))
        await s.flush()
        inserted.set()
        await asyncio.wait_for(proceed.wait(), timeout=20)

    async with session_factory() as s_b, session_factory() as s_u:
        t_b = asyncio.create_task(_in_request(s_b, lambda: line_request(s_b)))
        await asyncio.wait_for(inserted.wait(), timeout=15)
        t_u = asyncio.create_task(
            _in_request(
                s_u,
                lambda: TreatmentService.update(
                    s_u, clinic_id, UUID(tid), uuid4(), surfaces=["M", "O"]
                ),
            )
        )
        await asyncio.sleep(0.8)
        assert not t_u.done(), "the edit must wait for the uncommitted budget line"
        proceed.set()
        await asyncio.wait_for(t_b, timeout=20)
        with pytest.raises(TreatmentSurfacesEditBlockedError) as exc:
            await asyncio.wait_for(t_u, timeout=20)

    assert exc.value.reason == "linked_to_budget"
    state = await _committed(db_session, tid)
    assert _surfaces(state) == {"O"} and state["price_snapshot"] == Decimal("50.00")
