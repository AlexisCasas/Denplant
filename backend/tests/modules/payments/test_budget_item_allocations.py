"""Coverage for explicit budget-item payment allocations."""

from __future__ import annotations

from datetime import date
from decimal import Decimal
from uuid import uuid4
import asyncio

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.ext.asyncio import async_sessionmaker

from app.core.auth.models import Clinic, User
from app.modules.budget.models import Budget, BudgetItem
from app.modules.catalog.models import TreatmentCatalogItem, TreatmentCategory
from app.modules.patients.models import Patient
from app.modules.payments.workflow import PaymentWorkflowError, record_payment
from app.modules.payments.service import PaymentReadService


async def _budget_with_items(db: AsyncSession, clinic: Clinic, patient: Patient) -> tuple[Budget, list[BudgetItem]]:
    user_id = (await db.execute(select(User.id))).scalar_one()
    category = TreatmentCategory(id=uuid4(), clinic_id=clinic.id, key=f"cat-{uuid4().hex}", names={"es": "General"})
    catalog = TreatmentCatalogItem(
        id=uuid4(), clinic_id=clinic.id, category_id=category.id, internal_code=f"T-{uuid4().hex}",
        names={"es": "Corona"}, default_price=Decimal("100.00"),
    )
    budget = Budget(
        id=uuid4(), clinic_id=clinic.id, patient_id=patient.id, budget_number=f"P-{uuid4().hex[:8]}",
        status="accepted", valid_from=date.today(), created_by=user_id, total=Decimal("180.00"),
    )
    db.add_all([category, catalog, budget])
    await db.flush()
    items = [
        BudgetItem(id=uuid4(), clinic_id=clinic.id, budget_id=budget.id, catalog_item_id=catalog.id, unit_price=Decimal("100"), line_total=Decimal("100"), display_order=1),
        BudgetItem(id=uuid4(), clinic_id=clinic.id, budget_id=budget.id, catalog_item_id=catalog.id, unit_price=Decimal("80"), line_total=Decimal("80"), display_order=2),
    ]
    db.add_all(items)
    await db.commit()
    await db.refresh(budget)
    return budget, items


def _payload(patient: Patient, budget: Budget, allocations: list[dict]) -> dict:
    return {"patient_id": str(patient.id), "amount": str(sum(Decimal(a["amount"]) for a in allocations)), "method": "cash", "payment_date": date.today().isoformat(), "allocations": allocations}


@pytest.mark.asyncio
async def test_item_partial_split_excess_and_refund(
    client: AsyncClient, auth_headers: dict, db_session: AsyncSession, test_clinic: Clinic, test_patient: Patient
) -> None:
    budget, items = await _budget_with_items(db_session, test_clinic, test_patient)
    allocations = [
        {"target_type": "budget_item", "target_id": str(budget.id), "budget_item_id": str(items[0].id), "amount": "70.00"},
        {"target_type": "budget_item", "target_id": str(budget.id), "budget_item_id": str(items[1].id), "amount": "20.00"},
        {"target_type": "on_account", "amount": "10.00"},
    ]
    created = await client.post("/api/v1/payments", headers=auth_headers, json=_payload(test_patient, budget, allocations))
    assert created.status_code == 201, created.text
    payment_id = created.json()["data"]["id"]
    rows = await client.get(f"/api/v1/payments/budgets/{budget.id}/item-summaries", headers=auth_headers)
    assert rows.status_code == 200
    paid = {r["budget_item_id"]: Decimal(r["paid"]) for r in rows.json()["data"]}
    assert paid[str(items[0].id)] == Decimal("70.00")
    assert paid[str(items[1].id)] == Decimal("20.00")
    refund = await client.post(f"/api/v1/payments/{payment_id}/refunds", headers=auth_headers, json={"amount": "50.00", "method": "cash", "reason_code": "other"})
    assert refund.status_code == 201, refund.text
    rows = await client.get(f"/api/v1/payments/budgets/{budget.id}/item-summaries", headers=auth_headers)
    paid = {r["budget_item_id"]: Decimal(r["paid"]) for r in rows.json()["data"]}
    # Refunds have no target in the retained financial model, so they reduce
    # this payment's allocations pro-rata: 70% and 20% of net 50.
    assert paid[str(items[0].id)] == Decimal("35.00")
    assert paid[str(items[1].id)] == Decimal("10.00")


@pytest.mark.asyncio
async def test_item_overpayment_and_wrong_budget_are_rejected(
    client: AsyncClient, auth_headers: dict, db_session: AsyncSession, test_clinic: Clinic, test_patient: Patient
) -> None:
    budget, items = await _budget_with_items(db_session, test_clinic, test_patient)
    item = items[0]
    bad = _payload(test_patient, budget, [{"target_type": "budget_item", "target_id": str(budget.id), "budget_item_id": str(item.id), "amount": "100.01"}])
    response = await client.post("/api/v1/payments", headers=auth_headers, json=bad)
    assert response.status_code == 422


@pytest.mark.asyncio
async def test_split_70_30_partial_refund_is_prorated_exactly(
    client: AsyncClient, auth_headers: dict, db_session: AsyncSession, test_clinic: Clinic, test_patient: Patient
) -> None:
    budget, items = await _budget_with_items(db_session, test_clinic, test_patient)
    allocations = [
        {"target_type": "budget_item", "target_id": str(budget.id), "budget_item_id": str(items[0].id), "amount": "70.00"},
        {"target_type": "budget_item", "target_id": str(budget.id), "budget_item_id": str(items[1].id), "amount": "30.00"},
    ]
    created = await client.post("/api/v1/payments", headers=auth_headers, json=_payload(test_patient, budget, allocations))
    assert created.status_code == 201, created.text
    refunded = await client.post(
        f"/api/v1/payments/{created.json()['data']['id']}/refunds", headers=auth_headers,
        json={"amount": "50.00", "method": "cash", "reason_code": "other"},
    )
    assert refunded.status_code == 201, refunded.text
    rows = await client.get(f"/api/v1/payments/budgets/{budget.id}/item-summaries", headers=auth_headers)
    paid = {r["budget_item_id"]: Decimal(r["paid"]) for r in rows.json()["data"]}
    assert paid[str(items[0].id)] == Decimal("35.00")
    assert paid[str(items[1].id)] == Decimal("15.00")
    _other, other_items = await _budget_with_items(db_session, test_clinic, test_patient)
    wrong = _payload(test_patient, budget, [{"target_type": "budget_item", "target_id": str(budget.id), "budget_item_id": str(other_items[0].id), "amount": "1.00"}])
    response = await client.post("/api/v1/payments", headers=auth_headers, json=wrong)
    assert response.status_code == 422


@pytest.mark.asyncio
async def test_concurrent_item_allocations_are_serialized(
    db_session: AsyncSession, test_clinic: Clinic, test_patient: Patient
) -> None:
    """Two 80 payments for a 100 item cannot leave 160 paid."""
    budget, items = await _budget_with_items(db_session, test_clinic, test_patient)
    user_id = (await db_session.execute(select(User.id))).scalar_one()
    factory = async_sessionmaker(db_session.bind, expire_on_commit=False)

    async def collect() -> str:
        async with factory() as session:
            try:
                await record_payment(
                    session, clinic_id=test_clinic.id, currency="EUR", patient_id=test_patient.id,
                    amount=Decimal("80.00"), method="cash", payment_date=date.today(), recorded_by=user_id,
                    allocations=[{"target_type": "budget_item", "target_id": budget.id, "budget_item_id": items[0].id, "amount": Decimal("80.00")}],
                )
                await session.commit()
                return "accepted"
            except PaymentWorkflowError:
                await session.rollback()
                return "rejected"

    results = await asyncio.gather(collect(), collect())
    assert sorted(results) == ["accepted", "rejected"]
    summaries = await PaymentReadService.item_summaries_for_budget(db_session, test_clinic.id, budget.id)
    assert summaries[items[0].id] == (Decimal("80.00"), Decimal("20.00"))
