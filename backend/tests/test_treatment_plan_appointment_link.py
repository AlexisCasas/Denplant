"""E2E + isolation coverage for the treatment-plan <-> appointment link.

Diagnosis -> Treatment Plan -> Budget -> Appointment -> Execution ->
Evolution -> Plan update. This exercises the existing wiring end to end:

- ``AppointmentCreate.planned_item_ids`` -> ``AppointmentService.create_appointment``
  persists ``appointment_treatments.planned_treatment_item_id``.
- ``AppointmentService.validate_planned_items`` enforces clinic/patient/
  plan/eligibility on the server, regardless of what the client sends.
- ``treatment_plan.events.on_appointment_completed`` only promotes the
  ``PlannedTreatmentItem``s whose ``AppointmentTreatment.completed_in_appointment``
  flag was set — i.e. selective completion, not "complete the whole plan".

No backend code changes were needed for any of this — see the module
CLAUDE.md files and PR description for the audit trail.
"""

from __future__ import annotations

from decimal import Decimal
from uuid import UUID, uuid4

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth.models import Clinic, ClinicMembership, User
from app.core.auth.service import create_access_token, hash_password
from app.modules.agenda.models import AppointmentTreatment
from app.modules.catalog.models import (
    TreatmentCatalogItem,
    TreatmentCategory,
    TreatmentOdontogramMapping,
    VatType,
)
from app.modules.treatment_plan.models import PlannedTreatmentItem


async def _seed_catalog(db_session: AsyncSession, clinic_id, *, code: str) -> str:
    vat = VatType(clinic_id=clinic_id, names={"es": "Exento"}, rate=0.0, is_default=True)
    db_session.add(vat)
    await db_session.flush()
    cat = TreatmentCategory(
        clinic_id=clinic_id, key=f"cat-{code}", names={"es": "R"}, is_system=True
    )
    db_session.add(cat)
    await db_session.flush()
    item = TreatmentCatalogItem(
        clinic_id=clinic_id,
        category_id=cat.id,
        internal_code=code,
        names={"es": "Restauración"},
        default_price=Decimal("120.00"),
        pricing_strategy="flat",
        treatment_scope="tooth",
        vat_type_id=vat.id,
    )
    db_session.add(item)
    await db_session.flush()
    db_session.add(
        TreatmentOdontogramMapping(
            clinic_id=clinic_id,
            catalog_item_id=item.id,
            odontogram_treatment_type="filling",
            clinical_category="restauradora",
            visualization_rules=[],
            visualization_config={},
        )
    )
    await db_session.commit()
    return str(item.id)


@pytest.fixture
async def flow_world(db_session: AsyncSession, auth_headers: dict[str, str], client: AsyncClient):
    """Carlos + a dentist + one catalog item, in a dedicated clinic."""
    me = await client.get("/api/v1/auth/me", headers=auth_headers)
    admin_user_id = me.json()["data"]["user"]["id"]

    clinic = Clinic(
        id=uuid4(),
        name="Diagnosis Flow Clinic",
        tax_id="B22222222",
        address={"street": "a", "city": "b"},
        settings={"slot_duration_min": 15},
    )
    db_session.add(clinic)
    await db_session.flush()
    db_session.add(
        ClinicMembership(id=uuid4(), user_id=admin_user_id, clinic_id=clinic.id, role="admin")
    )

    dentist = User(
        id=uuid4(),
        email="dentist-plan-flow@test.clinic",
        password_hash=hash_password("TestPass1234"),
        first_name="Doctora",
        last_name="Uno",
        is_active=True,
    )
    other_dentist = User(
        id=uuid4(),
        email="dentist-plan-flow-other@test.clinic",
        password_hash=hash_password("TestPass1234"),
        first_name="Doctor",
        last_name="Otro",
        is_active=True,
    )
    db_session.add_all([dentist, other_dentist])
    db_session.add(
        ClinicMembership(id=uuid4(), user_id=dentist.id, clinic_id=clinic.id, role="dentist")
    )
    db_session.add(
        ClinicMembership(id=uuid4(), user_id=other_dentist.id, clinic_id=clinic.id, role="dentist")
    )
    await db_session.commit()

    catalog_item_id = await _seed_catalog(db_session, clinic.id, code="PLAN-FLOW")

    patient_resp = await client.post(
        "/api/v1/patients",
        headers=auth_headers,
        json={"first_name": "Carlos", "last_name": "Paciente", "phone": "+34600111222"},
    )
    assert patient_resp.status_code == 201, patient_resp.text
    patient_id = patient_resp.json()["data"]["id"]

    return {
        "clinic_id": str(clinic.id),
        "patient_id": patient_id,
        "catalog_item_id": catalog_item_id,
        "dentist_id": str(dentist.id),
        "dentist_headers": {
            "Authorization": f"Bearer {create_access_token(dentist.id, token_version=dentist.token_version)}"
        },
        "other_dentist_id": str(other_dentist.id),
        "other_dentist_headers": {
            "Authorization": f"Bearer {create_access_token(other_dentist.id, token_version=other_dentist.token_version)}"
        },
    }


async def _create_treatment(
    client: AsyncClient, auth_headers: dict, world: dict, tooth_number: int
) -> str:
    r = await client.post(
        f"/api/v1/odontogram/patients/{world['patient_id']}/treatments",
        headers=auth_headers,
        json={
            "catalog_item_id": world["catalog_item_id"],
            "tooth_numbers": [tooth_number],
            "status": "planned",
        },
    )
    assert r.status_code == 201, r.text
    return r.json()["data"]["id"]


async def _add_item(
    client: AsyncClient, auth_headers: dict, plan_id: str, treatment_id: str
) -> str:
    r = await client.post(
        f"/api/v1/treatment_plan/treatment-plans/{plan_id}/items",
        headers=auth_headers,
        json={"treatment_id": treatment_id},
    )
    assert r.status_code == 201, r.text
    return r.json()["data"]["id"]


@pytest.mark.asyncio
async def test_full_diagnosis_plan_appointment_flow(
    client: AsyncClient, auth_headers: dict, db_session: AsyncSession, flow_world: dict
):
    world = flow_world

    # --- Plan "Restauraciones septiembre" with I1..I4 -------------------
    plan_resp = await client.post(
        "/api/v1/treatment_plan/treatment-plans",
        headers=auth_headers,
        json={
            "patient_id": world["patient_id"],
            "title": "Restauraciones septiembre",
            "assigned_professional_id": world["dentist_id"],
        },
    )
    assert plan_resp.status_code == 201, plan_resp.text
    plan_id = plan_resp.json()["data"]["id"]
    assert plan_resp.json()["data"]["status"] == "draft"

    t16 = await _create_treatment(client, auth_headers, world, 16)
    t24 = await _create_treatment(client, auth_headers, world, 24)
    t35 = await _create_treatment(client, auth_headers, world, 35)
    t11 = await _create_treatment(client, auth_headers, world, 11)

    i1 = await _add_item(client, auth_headers, plan_id, t16)
    i2 = await _add_item(client, auth_headers, plan_id, t24)
    i3 = await _add_item(client, auth_headers, plan_id, t35)
    i4 = await _add_item(client, auth_headers, plan_id, t11)

    # I4 is already completed (pre-existing clinical fact), out of band.
    item4 = await db_session.get(PlannedTreatmentItem, i4)
    item4.status = "completed"
    await db_session.commit()

    # --- Fase 3: vigente plans for the patient (draft/active only) ------
    vigente_resp = await client.get(
        "/api/v1/treatment_plan/treatment-plans"
        f"?patient_id={world['patient_id']}&status=active&status=draft",
        headers=auth_headers,
    )
    assert vigente_resp.status_code == 200
    vigente_ids = {p["id"] for p in vigente_resp.json()["data"]}
    assert plan_id in vigente_ids

    # --- Fase 4: pending items of that plan only I1, I2, I3 (not I4) ----
    detail_resp = await client.get(
        f"/api/v1/treatment_plan/treatment-plans/{plan_id}", headers=auth_headers
    )
    assert detail_resp.status_code == 200
    items = detail_resp.json()["data"]["items"]
    pending_ids = {i["id"] for i in items if i["status"] == "pending"}
    assert pending_ids == {i1, i2, i3}

    # --- Create the appointment with I1 + I2 -----------------------------
    appt_resp = await client.post(
        "/api/v1/agenda/appointments",
        headers=auth_headers,
        json={
            "patient_id": world["patient_id"],
            "professional_id": world["dentist_id"],
            "start_time": "2026-09-15T09:00:00",
            "end_time": "2026-09-15T09:30:00",
            "planned_item_ids": [i1, i2],
        },
    )
    assert appt_resp.status_code == 201, appt_resp.text
    appointment = appt_resp.json()["data"]
    appointment_id = appointment["id"]

    # --- Fase 8/9: appointment_treatments FK + clinical display ---------
    linked = {t["planned_item_id"]: t for t in appointment["treatments"]}
    assert set(linked.keys()) == {i1, i2}
    assert i3 not in linked and i4 not in linked
    for t in linked.values():
        assert t["plan_id"] == plan_id
        assert t["plan_number"]
        assert t["tooth_number"] in (16, 24)

    at_rows = (
        (
            await db_session.execute(
                AppointmentTreatment.__table__.select().where(
                    AppointmentTreatment.appointment_id == appointment_id
                )
            )
        )
        .mappings()
        .all()
    )
    assert {r["planned_treatment_item_id"] for r in at_rows} == {UUID(i1), UUID(i2)}

    # --- Fase 12/17: selective completion --------------------------------
    apt_treatment_ids = [t["id"] for t in appointment["treatments"]]
    for at_id in apt_treatment_ids:
        patch = await client.patch(
            f"/api/v1/agenda/appointment-treatments/{at_id}",
            headers=auth_headers,
            json={"completed_in_appointment": True},
        )
        assert patch.status_code == 200, patch.text

    complete_resp = await client.post(
        f"/api/v1/agenda/appointments/{appointment_id}/transitions",
        headers=auth_headers,
        json={"to_status": "confirmed"},
    )
    assert complete_resp.status_code == 200
    for to_status in ("checked_in",):
        r = await client.post(
            f"/api/v1/agenda/appointments/{appointment_id}/transitions",
            headers=auth_headers,
            json={"to_status": to_status},
        )
        assert r.status_code == 200, r.text

    # Moving to `in_treatment` requires a cabinet (pre-existing agenda
    # rule, unrelated to this flow) — assign one first.
    cabinet_resp = await client.post(
        "/api/v1/agenda/cabinets",
        headers=auth_headers,
        json={"name": "Gabinete 1", "color": "#3B82F6"},
    )
    assert cabinet_resp.status_code == 201, cabinet_resp.text
    cabinet_id = cabinet_resp.json()["data"]["id"]
    assign_resp = await client.patch(
        f"/api/v1/agenda/appointments/{appointment_id}/cabinet",
        headers=auth_headers,
        json={"cabinet_id": cabinet_id},
    )
    assert assign_resp.status_code == 200, assign_resp.text

    for to_status in ("in_treatment", "completed"):
        r = await client.post(
            f"/api/v1/agenda/appointments/{appointment_id}/transitions",
            headers=auth_headers,
            json={"to_status": to_status},
        )
        assert r.status_code == 200, r.text

    await db_session.commit()
    db_session.expire_all()

    item1 = await db_session.get(PlannedTreatmentItem, i1)
    item2 = await db_session.get(PlannedTreatmentItem, i2)
    item3 = await db_session.get(PlannedTreatmentItem, i3)
    item4 = await db_session.get(PlannedTreatmentItem, i4)
    assert item1.status == "completed"
    assert item2.status == "completed"
    assert item3.status == "pending"  # NOT touched by the appointment
    assert item4.status == "completed"  # unchanged, not re-processed

    # Plan must NOT auto-complete: I3 is still pending.
    plan_after = await client.get(
        f"/api/v1/treatment_plan/treatment-plans/{plan_id}", headers=auth_headers
    )
    assert plan_after.json()["data"]["status"] == "draft"


@pytest.mark.asyncio
async def test_cross_patient_planned_item_is_rejected(
    client: AsyncClient, auth_headers: dict, flow_world: dict
):
    """Patient A's appointment must not accept Patient B's planned item."""
    world = flow_world

    # Patient B, with its own plan + pending item.
    patient_b_resp = await client.post(
        "/api/v1/patients",
        headers=auth_headers,
        json={"first_name": "Beatriz", "last_name": "Otra", "phone": "+34600333444"},
    )
    patient_b_id = patient_b_resp.json()["data"]["id"]

    treatment_b = await client.post(
        f"/api/v1/odontogram/patients/{patient_b_id}/treatments",
        headers=auth_headers,
        json={
            "catalog_item_id": world["catalog_item_id"],
            "tooth_numbers": [21],
            "status": "planned",
        },
    )
    assert treatment_b.status_code == 201, treatment_b.text

    plan_b_resp = await client.post(
        "/api/v1/treatment_plan/treatment-plans",
        headers=auth_headers,
        json={"patient_id": patient_b_id, "title": "Plan B"},
    )
    plan_b_id = plan_b_resp.json()["data"]["id"]
    item_b_resp = await client.post(
        f"/api/v1/treatment_plan/treatment-plans/{plan_b_id}/items",
        headers=auth_headers,
        json={"treatment_id": treatment_b.json()["data"]["id"]},
    )
    item_b_id = item_b_resp.json()["data"]["id"]

    # Appointment for Patient A (Carlos), but the planned item belongs to B.
    appt_resp = await client.post(
        "/api/v1/agenda/appointments",
        headers=auth_headers,
        json={
            "patient_id": world["patient_id"],
            "professional_id": world["dentist_id"],
            "start_time": "2026-09-16T09:00:00",
            "end_time": "2026-09-16T09:30:00",
            "planned_item_ids": [item_b_id],
        },
    )
    assert appt_resp.status_code == 400, appt_resp.text


@pytest.mark.asyncio
async def test_dentist_without_patient_access_cannot_see_plans(
    client: AsyncClient, auth_headers: dict, flow_world: dict
):
    world = flow_world

    # The plan/patient exist (created by admin); `other_dentist` has never
    # been assigned an appointment with this patient and did not create it.
    plan_resp = await client.post(
        "/api/v1/treatment_plan/treatment-plans",
        headers=auth_headers,
        json={"patient_id": world["patient_id"], "title": "Plan aislado"},
    )
    plan_id = plan_resp.json()["data"]["id"]

    denied_list = await client.get(
        f"/api/v1/treatment_plan/treatment-plans?patient_id={world['patient_id']}",
        headers=world["other_dentist_headers"],
    )
    assert denied_list.status_code == 404

    denied_detail = await client.get(
        f"/api/v1/treatment_plan/treatment-plans/{plan_id}",
        headers=world["other_dentist_headers"],
    )
    assert denied_detail.status_code == 404

    # Once `dentist` is assigned an appointment with this patient (booked
    # by reception/admin, the common path), they gain access via
    # PatientAccessPolicy — sanity check the positive path isn't
    # accidentally broken by the negative assertions above.
    appt_resp = await client.post(
        "/api/v1/agenda/appointments",
        headers=auth_headers,
        json={
            "patient_id": world["patient_id"],
            "professional_id": world["dentist_id"],
            "start_time": "2026-09-17T09:00:00",
            "end_time": "2026-09-17T09:30:00",
        },
    )
    assert appt_resp.status_code == 201, appt_resp.text

    allowed_list = await client.get(
        f"/api/v1/treatment_plan/treatment-plans?patient_id={world['patient_id']}",
        headers=world["dentist_headers"],
    )
    assert allowed_list.status_code == 200
