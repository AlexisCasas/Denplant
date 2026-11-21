"""RBAC coverage for budget draft editing and in-clinic acceptance.

Manual QA (Fase 2) reported admin/receptionist blocked from editing a
draft budget's ``unit_price`` and from registering in-clinic acceptance,
despite the manifest already granting ``budget.write`` /
``budget.accept_in_clinic`` to both roles.

Root cause found for ``accept_in_clinic``: the dedicated endpoint,
permission, i18n strings and even the capture modal
(``AcceptInClinicModal.vue``) already existed, but nothing in the budget
detail page (``budget/frontend/pages/budgets/[id].vue``) ever rendered
the modal or called the composable — the feature was unreachable from
the UI for every role, not just these two. Fixed by wiring the existing
pieces together (``useBudgets.acceptInClinic`` + an action + the modal
mount); no permission, schema, or backend rule changed.

``unit_price`` editing on a draft budget was never actually blocked —
``BudgetItemUpdate``/``update_budget_item`` already gate purely on
``budget.write`` + ``budget.status == 'draft'``, with no role-specific
logic anywhere in the path. Covered here as a regression guard, not a
fix.
"""

from __future__ import annotations

from decimal import Decimal
from uuid import uuid4

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth.models import Clinic, ClinicMembership, User
from app.core.auth.service import create_access_token, hash_password
from app.modules.catalog.models import TreatmentCatalogItem, TreatmentCategory, VatType
from app.modules.patients.models import Patient


@pytest.fixture
async def budget_rbac_world(
    db_session: AsyncSession, auth_headers: dict[str, str], client: AsyncClient
) -> dict:
    """Admin (the default test user) + a receptionist, one catalog item."""
    me = await client.get("/api/v1/auth/me", headers=auth_headers)
    admin_user_id = me.json()["data"]["user"]["id"]

    clinic = Clinic(
        id=uuid4(),
        name="Budget RBAC Clinic",
        tax_id="B33333333",
        address={"street": "a", "city": "b"},
        settings={"slot_duration_min": 15},
    )
    db_session.add(clinic)
    await db_session.flush()
    db_session.add(
        ClinicMembership(id=uuid4(), user_id=admin_user_id, clinic_id=clinic.id, role="admin")
    )

    receptionist = User(
        id=uuid4(),
        email="reception-budget-rbac@test.clinic",
        password_hash=hash_password("TestPass1234"),
        first_name="Rosa",
        last_name="Recepcion",
        is_active=True,
    )
    db_session.add(receptionist)
    db_session.add(
        ClinicMembership(
            id=uuid4(), user_id=receptionist.id, clinic_id=clinic.id, role="receptionist"
        )
    )

    vat_type = VatType(
        id=uuid4(),
        clinic_id=clinic.id,
        names={"es": "Exento"},
        rate=0.0,
        is_default=True,
        is_system=True,
    )
    db_session.add(vat_type)
    await db_session.flush()
    category = TreatmentCategory(
        id=uuid4(),
        clinic_id=clinic.id,
        key="rbac_cat",
        names={"es": "Cat"},
        display_order=1,
        is_active=True,
        is_system=False,
    )
    db_session.add(category)
    await db_session.flush()
    catalog_item = TreatmentCatalogItem(
        id=uuid4(),
        clinic_id=clinic.id,
        category_id=category.id,
        internal_code="RBAC-001",
        names={"es": "Corona"},
        descriptions={"es": "d"},
        default_price=Decimal("500.00"),
        vat_type_id=vat_type.id,
        treatment_scope="whole_tooth",
        is_diagnostic=False,
        is_active=True,
        is_system=False,
    )
    db_session.add(catalog_item)
    patient = Patient(
        id=uuid4(),
        clinic_id=clinic.id,
        first_name="Test",
        last_name="Patient",
        email="rbac-patient@test.com",
        phone="+34600000001",
        status="active",
    )
    db_session.add(patient)
    await db_session.commit()

    return {
        "clinic_id": str(clinic.id),
        "patient_id": str(patient.id),
        "catalog_item_id": str(catalog_item.id),
        "receptionist_headers": {
            "Authorization": (
                f"Bearer {create_access_token(receptionist.id, token_version=receptionist.token_version)}"
            )
        },
    }


async def _create_draft_budget_with_item(
    client: AsyncClient, headers: dict, world: dict
) -> tuple[str, str]:
    budget_resp = await client.post(
        "/api/v1/budget/budgets",
        headers=headers,
        json={"patient_id": world["patient_id"], "valid_from": "2026-01-01"},
    )
    assert budget_resp.status_code == 201, budget_resp.text
    budget_id = budget_resp.json()["data"]["id"]

    item_resp = await client.post(
        f"/api/v1/budget/budgets/{budget_id}/items",
        headers=headers,
        json={"catalog_item_id": world["catalog_item_id"], "quantity": 1, "tooth_number": 16},
    )
    assert item_resp.status_code == 201, item_resp.text
    item_id = item_resp.json()["data"]["id"]
    return budget_id, item_id


@pytest.mark.asyncio
async def test_admin_can_edit_draft_budget_item_unit_price(
    client: AsyncClient, auth_headers: dict, budget_rbac_world: dict
):
    """Fase 2, test B."""
    budget_id, item_id = await _create_draft_budget_with_item(
        client, auth_headers, budget_rbac_world
    )

    r = await client.put(
        f"/api/v1/budget/budgets/{budget_id}/items/{item_id}",
        headers=auth_headers,
        json={"unit_price": 350.00},
    )
    assert r.status_code == 200, r.text
    assert float(r.json()["data"]["unit_price"]) == 350.00


@pytest.mark.asyncio
async def test_receptionist_can_edit_draft_budget_item_unit_price(
    client: AsyncClient, auth_headers: dict, budget_rbac_world: dict
):
    """Fase 2, test C."""
    receptionist_headers = budget_rbac_world["receptionist_headers"]
    budget_id, item_id = await _create_draft_budget_with_item(
        client, auth_headers, budget_rbac_world
    )

    r = await client.put(
        f"/api/v1/budget/budgets/{budget_id}/items/{item_id}",
        headers=receptionist_headers,
        json={"unit_price": 425.50},
    )
    assert r.status_code == 200, r.text
    assert float(r.json()["data"]["unit_price"]) == 425.50


@pytest.mark.asyncio
async def test_admin_can_accept_in_clinic(
    client: AsyncClient, auth_headers: dict, budget_rbac_world: dict
):
    """Fase 2, test D."""
    budget_id, _ = await _create_draft_budget_with_item(client, auth_headers, budget_rbac_world)

    r = await client.post(
        f"/api/v1/budget/budgets/{budget_id}/accept-in-clinic",
        headers=auth_headers,
        json={"signer_name": "Carlos Paciente"},
    )
    assert r.status_code == 200, r.text
    assert r.json()["data"]["status"] == "accepted"


@pytest.mark.asyncio
async def test_receptionist_can_accept_in_clinic(
    client: AsyncClient, auth_headers: dict, budget_rbac_world: dict
):
    """Fase 2, test E."""
    receptionist_headers = budget_rbac_world["receptionist_headers"]
    budget_id, _ = await _create_draft_budget_with_item(client, auth_headers, budget_rbac_world)

    r = await client.post(
        f"/api/v1/budget/budgets/{budget_id}/accept-in-clinic",
        headers=receptionist_headers,
        json={"signer_name": "Carlos Paciente"},
    )
    assert r.status_code == 200, r.text
    assert r.json()["data"]["status"] == "accepted"


@pytest.mark.asyncio
async def test_no_role_can_edit_items_after_accepted(
    client: AsyncClient, auth_headers: dict, budget_rbac_world: dict
):
    """Fase 2, test F. Neither admin nor receptionist can edit items via
    the normal edit endpoint once the budget is accepted — the existing
    renegotiation flow is the only path from there. Backend rule
    (``update_budget_item`` refuses non-draft budgets) left unchanged.
    """
    receptionist_headers = budget_rbac_world["receptionist_headers"]
    budget_id, item_id = await _create_draft_budget_with_item(
        client, auth_headers, budget_rbac_world
    )

    accept_resp = await client.post(
        f"/api/v1/budget/budgets/{budget_id}/accept-in-clinic",
        headers=auth_headers,
        json={"signer_name": "Carlos Paciente"},
    )
    assert accept_resp.status_code == 200, accept_resp.text
    assert accept_resp.json()["data"]["status"] == "accepted"

    admin_edit = await client.put(
        f"/api/v1/budget/budgets/{budget_id}/items/{item_id}",
        headers=auth_headers,
        json={"unit_price": 999.00},
    )
    assert admin_edit.status_code == 400, admin_edit.text

    receptionist_edit = await client.put(
        f"/api/v1/budget/budgets/{budget_id}/items/{item_id}",
        headers=receptionist_headers,
        json={"unit_price": 111.00},
    )
    assert receptionist_edit.status_code == 400, receptionist_edit.text
