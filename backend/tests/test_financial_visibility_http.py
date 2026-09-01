"""HTTP integration coverage for the dentist financial visibility boundary.

Exercises the real FastAPI stack: JWT authentication, clinic membership RBAC,
router dependencies, Pydantic serialization and the response middleware.
"""

from __future__ import annotations

import json
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from uuid import uuid4

import pytest

from app.core.auth.models import ClinicMembership, User
from app.core.auth.service import create_access_token, hash_password
from app.modules.catalog.models import TreatmentCatalogItem, TreatmentCategory, VatType
from app.modules.agenda.models import Appointment, AppointmentTreatment
from app.modules.odontogram.models import Treatment
from app.modules.patients.models import Patient
from app.modules.treatment_plan.models import (
    PlannedTreatmentItem,
    PlannedTreatmentItemSession,
    TreatmentPlan,
)


FINANCIAL_KEYS = {
    "price",
    "default_price",
    "price_snapshot",
    "unit_price",
    "cost",
    "cost_price",
    "amount",
    "subtotal",
    "discount",
    "discount_amount",
    "tax",
    "vat",
    "total",
    "balance",
    "paid",
    "amount_paid",
    "outstanding",
    "debt",
    "revenue",
    "income",
}


def _assert_no_financial_fields(value: object, *, root: bool = True) -> None:
    if isinstance(value, dict):
        paginated_wrapper = root and {"data", "total", "page", "page_size"}.issubset(value)
        for key, item in value.items():
            assert paginated_wrapper and key == "total" or key not in FINANCIAL_KEYS
            assert not key.endswith(("_amount", "_price", "_subtotal", "_discount", "_tax"))
            _assert_no_financial_fields(item, root=False)
    elif isinstance(value, list):
        for item in value:
            _assert_no_financial_fields(item, root=False)


@pytest.fixture
async def financial_http_world(db_session, test_clinic):
    dentist = User(
        id=uuid4(),
        email="dentist-financial-http@test.clinic",
        password_hash=hash_password("TestPass1234"),
        first_name="Dental",
        last_name="Scope",
        is_active=True,
    )
    db_session.add(dentist)
    dentist_b = User(
        id=uuid4(),
        email="dentist-financial-http-b@test.clinic",
        password_hash=hash_password("TestPass1234"),
        first_name="Dental",
        last_name="Other",
        is_active=True,
    )
    db_session.add(dentist_b)
    db_session.add(
        ClinicMembership(
            id=uuid4(), user_id=dentist.id, clinic_id=test_clinic.id, role="dentist"
        )
    )
    db_session.add(
        ClinicMembership(
            id=uuid4(), user_id=dentist_b.id, clinic_id=test_clinic.id, role="dentist"
        )
    )
    category = TreatmentCategory(
        id=uuid4(),
        clinic_id=test_clinic.id,
        key="financial-http",
        names={"es": "Clínica"},
        descriptions={},
    )
    vat_type = VatType(
        id=uuid4(),
        clinic_id=test_clinic.id,
        names={"es": "IVA"},
        rate=21.0,
        is_default=True,
    )
    item = TreatmentCatalogItem(
        id=uuid4(),
        clinic_id=test_clinic.id,
        category_id=category.id,
        internal_code="FIN-HTTP-001",
        names={"es": "Tratamiento de prueba"},
        descriptions={},
        default_price=Decimal("137.45"),
        cost_price=Decimal("872.30"),
        vat_type_id=vat_type.id,
        pricing_config={"base": 1549.99},
        surface_prices={"1": 137.45},
        default_duration_minutes=30,
    )
    db_session.add_all([category, vat_type, item])
    await db_session.commit()
    return {
        "dentist_headers": {
            "Authorization": f"Bearer {create_access_token(dentist.id, token_version=dentist.token_version)}"
        },
        "dentist_b_headers": {
            "Authorization": f"Bearer {create_access_token(dentist_b.id, token_version=dentist_b.token_version)}"
        },
        "dentist_id": dentist.id,
        "item_id": item.id,
    }


@pytest.fixture
async def plan_and_agenda_world(db_session, test_clinic, financial_http_world):
    item = await db_session.get(TreatmentCatalogItem, financial_http_world["item_id"])
    assert item is not None
    # The clinic fixture's admin is the creator; fetch it by clinic instead
    # of relying on the token fixture implementation.
    from sqlalchemy import select

    admin_membership = await db_session.scalar(
        select(ClinicMembership).where(
            ClinicMembership.clinic_id == test_clinic.id,
            ClinicMembership.role == "admin",
        )
    )
    assert admin_membership is not None
    patient = Patient(
        id=uuid4(),
        clinic_id=test_clinic.id,
        first_name="Plan",
        last_name="Paciente",
        email="plan-paciente@test.clinic",
        phone="600000001",
        created_by_user_id=financial_http_world["dentist_id"],
    )
    treatment = Treatment(
        id=uuid4(),
        clinic_id=test_clinic.id,
        patient_id=patient.id,
        clinical_type="crown",
        scope="global_mouth",
        catalog_item_id=item.id,
        status="planned",
        recorded_at=datetime.now(UTC),
        price_snapshot=Decimal("872.30"),
        duration_snapshot=30,
        vat_rate_snapshot=Decimal("21.00"),
        notes="clinical evidence",
    )
    plan = TreatmentPlan(
        id=uuid4(),
        clinic_id=test_clinic.id,
        patient_id=patient.id,
        plan_number="FIN-HTTP-PLAN-1",
        title="Plan clínico",
        status="draft",
        created_by=admin_membership.user_id,
    )
    planned_item = PlannedTreatmentItem(
        id=uuid4(),
        clinic_id=test_clinic.id,
        treatment_plan_id=plan.id,
        treatment_id=treatment.id,
        sequence_order=1,
        status="pending",
    )
    session = PlannedTreatmentItemSession(
        id=uuid4(),
        plan_item_id=planned_item.id,
        sequence=1,
        label="Sesión clínica",
        amount=Decimal("1549.99"),
        status="pending",
    )
    appointment = Appointment(
        id=uuid4(),
        clinic_id=test_clinic.id,
        patient_id=patient.id,
        professional_id=financial_http_world["dentist_id"],
        cabinet="Gabinete 1",
        start_time=datetime.now(UTC) + timedelta(days=1),
        end_time=datetime.now(UTC) + timedelta(days=1, minutes=30),
        status="scheduled",
    )
    appointment_treatment = AppointmentTreatment(
        id=uuid4(),
        appointment_id=appointment.id,
        planned_treatment_item_id=planned_item.id,
        catalog_item_id=item.id,
        display_order=1,
    )
    db_session.add_all([patient, treatment, plan, planned_item, session, appointment, appointment_treatment])
    await db_session.commit()
    return {"plan_id": plan.id, "appointment_id": appointment.id, **financial_http_world}


@pytest.mark.asyncio
async def test_dentist_financial_routers_are_forbidden_but_scheduling_report_is_available(
    client, auth_headers, financial_http_world
):
    dentist_headers = financial_http_world["dentist_headers"]
    protected = [
        "/api/v1/budget/budgets",
        f"/api/v1/budget/budgets/{uuid4()}",
        f"/api/v1/budget/budgets/{uuid4()}/pdf",
        "/api/v1/billing/invoices",
        f"/api/v1/billing/invoices/{uuid4()}",
        f"/api/v1/billing/invoices/{uuid4()}/pdf",
        "/api/v1/payments",
        f"/api/v1/payments/{uuid4()}",
        "/api/v1/reports/billing/summary?date_from=2026-01-01&date_to=2026-12-31",
        "/api/v1/reports/budgets/summary?date_from=2026-01-01&date_to=2026-12-31",
    ]
    for path in protected:
        response = await client.get(path, headers=dentist_headers)
        assert response.status_code == 403, path

    scheduling = await client.get(
        "/api/v1/reports/scheduling/summary?date_from=2026-01-01&date_to=2026-12-31",
        headers=dentist_headers,
    )
    assert scheduling.status_code == 200

    # The same pure-financial routes remain available to the admin.
    assert (await client.get("/api/v1/budget/budgets", headers=auth_headers)).status_code == 200
    assert (await client.get("/api/v1/billing/invoices", headers=auth_headers)).status_code == 200
    assert (await client.get("/api/v1/payments", headers=auth_headers)).status_code == 200


@pytest.mark.asyncio
async def test_catalog_http_response_is_sanitized_for_dentist_but_not_admin(
    client, auth_headers, financial_http_world
):
    item_id = financial_http_world["item_id"]
    dentist = await client.get(f"/api/v1/catalog/items/{item_id}", headers=financial_http_world["dentist_headers"])
    admin = await client.get(f"/api/v1/catalog/items/{item_id}", headers=auth_headers)

    assert dentist.status_code == 200, dentist.text
    assert admin.status_code == 200, admin.text
    assert dentist.headers["content-type"].startswith("application/json")
    assert int(dentist.headers["content-length"]) == len(dentist.content)
    dentist_payload = dentist.json()
    _assert_no_financial_fields(dentist_payload)
    dentist_text = dentist.text
    for amount in ("137.45", "872.30", "1549.99"):
        assert amount not in dentist_text

    admin_payload = admin.json()
    assert admin_payload["data"]["default_price"] == "137.45"
    assert admin_payload["data"]["cost_price"] == "872.30"
    assert admin_payload["data"]["pricing_config"] == {"base": 1549.99}
    assert json.loads(admin.content) == admin_payload


@pytest.mark.asyncio
async def test_treatment_plan_http_is_sanitized_for_dentist_but_complete_for_admin(
    client, auth_headers, plan_and_agenda_world
):
    world = plan_and_agenda_world
    dentist_headers = world["dentist_headers"]
    paths = [
        "/api/v1/treatment_plan/treatment-plans",
        f"/api/v1/treatment_plan/treatment-plans/{world['plan_id']}",
    ]
    for path in paths:
        dentist = await client.get(path, headers=dentist_headers)
        admin = await client.get(path, headers=auth_headers)
        assert dentist.status_code == admin.status_code == 200
        assert dentist.headers["content-type"].startswith("application/json")
        assert int(dentist.headers["content-length"]) == len(dentist.content)
        _assert_no_financial_fields(dentist.json())
        for amount in ("137.45", "872.30", "1549.99"):
            assert amount not in dentist.text
    denied = await client.get(paths[1], headers=world["dentist_b_headers"])
    assert denied.status_code == 404
    admin_detail = (await client.get(paths[1], headers=auth_headers)).json()["data"]
    assert admin_detail["items"][0]["treatment"]["price_snapshot"] == "872.30"
    assert admin_detail["items"][0]["sessions"][0]["amount"] == "1549.99"


@pytest.mark.asyncio
async def test_agenda_http_treatments_are_sanitized_for_dentist_but_complete_for_admin(
    client, auth_headers, plan_and_agenda_world
):
    world = plan_and_agenda_world
    paths = [
        "/api/v1/agenda/appointments",
        f"/api/v1/agenda/appointments/{world['appointment_id']}",
    ]
    for path in paths:
        dentist = await client.get(path, headers=world["dentist_headers"])
        admin = await client.get(path, headers=auth_headers)
        assert dentist.status_code == admin.status_code == 200
        _assert_no_financial_fields(dentist.json())
        assert "137.45" not in dentist.text
    admin_detail = (await client.get(paths[1], headers=auth_headers)).json()["data"]
    assert admin_detail["treatments"][0]["default_price"] == 872.3
