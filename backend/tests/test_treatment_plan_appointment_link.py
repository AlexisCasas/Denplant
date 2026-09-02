"""E2E + isolation coverage for the treatment-plan <-> appointment link.

Diagnosis -> Treatment Plan -> Budget -> Appointment -> Execution ->
Evolution -> Plan update. This exercises the existing wiring end to end:

- ``AppointmentCreate.planned_item_ids`` -> ``AppointmentService.create_appointment``
  persists ``appointment_treatments.planned_treatment_item_id``.
- ``AppointmentService.validate_planned_items`` enforces clinic/patient/
  plan/eligibility on the server, regardless of what the client sends.
- ``treatment_plan.events.on_appointment_completed`` routes through
  ``TreatmentPlanService.complete_item`` (``require_active_plan=False``)
  instead of a direct status flip — selective completion (not "complete
  the whole plan"), session-aware (advances one pending session per
  visit, finalizing the item and booking the earned-ledger entry only
  once every session is terminal), and it marks the underlying
  odontogram Treatment as performed.
- Evolución clínica at completion time reuses the existing
  ``clinical_notes`` mechanism (``note_type='appointment_clinical'``,
  ``owner_type='appointment'``) via a plain HTTP call from the
  agenda-owned completion-gate modal — agenda does not import
  clinical_notes (docs/technical/appointment-notes.md).

No backend code changes were needed for the first round. This file also
covers the two follow-up gaps that round left open:
``on_appointment_completed``'s direct status flip (fixed — see
``TreatmentPlanService.complete_session``/``complete_item``'s new
``require_active_plan`` parameter) and the evolución-clínica capture
(closed entirely in the frontend gate + existing clinical_notes API,
no schema change).
"""

from __future__ import annotations

from decimal import Decimal
from uuid import UUID, uuid4

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth.models import Clinic, ClinicMembership, User
from app.core.auth.service import create_access_token, hash_password
from app.modules.agenda.models import AppointmentTreatment
from app.modules.catalog.models import (
    CatalogItemSession,
    TreatmentCatalogItem,
    TreatmentCategory,
    TreatmentOdontogramMapping,
    VatType,
)
from app.modules.odontogram.models import Treatment
from app.modules.payments.models import PatientEarnedEntry
from app.modules.treatment_plan.models import PlannedTreatmentItem, PlannedTreatmentItemSession


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


# ---------------------------------------------------------------------------
# Follow-up round: evolución clínica, multi-session completion, budget chain
# ---------------------------------------------------------------------------


async def _complete_appointment(
    client: AsyncClient, auth_headers: dict, appointment_id: str, cabinet_id: str
) -> None:
    """Walk an appointment through the full transition chain to ``completed``.

    Mirrors what the frontend gate does after its own PATCH/POST writes:
    the state machine requires confirmed -> checked_in -> in_treatment
    (cabinet required) -> completed.
    """
    for status_value in ("confirmed", "checked_in"):
        r = await client.post(
            f"/api/v1/agenda/appointments/{appointment_id}/transitions",
            headers=auth_headers,
            json={"to_status": status_value},
        )
        assert r.status_code == 200, r.text
    assign = await client.patch(
        f"/api/v1/agenda/appointments/{appointment_id}/cabinet",
        headers=auth_headers,
        json={"cabinet_id": cabinet_id},
    )
    assert assign.status_code == 200, assign.text
    for status_value in ("in_treatment", "completed"):
        r = await client.post(
            f"/api/v1/agenda/appointments/{appointment_id}/transitions",
            headers=auth_headers,
            json={"to_status": status_value},
        )
        assert r.status_code == 200, r.text


async def _create_cabinet(client: AsyncClient, auth_headers: dict, name: str) -> str:
    r = await client.post(
        "/api/v1/agenda/cabinets",
        headers=auth_headers,
        json={"name": name, "color": "#3B82F6"},
    )
    assert r.status_code == 201, r.text
    return r.json()["data"]["id"]


@pytest.mark.asyncio
async def test_evolution_note_captured_on_appointment_completion(
    client: AsyncClient, auth_headers: dict, db_session: AsyncSession, flow_world: dict
):
    """Fase 12: Carlos, I1+I2 realizados, evolución escrita, I3 sigue pendiente.

    Mirrors exactly what ``AppointmentCompletionGateModal.vue`` does, in
    order: PATCH completed_in_appointment on the checked treatments, POST
    the evolución clínica note (clinical_notes, owner_type='appointment'),
    then walk the appointment to ``completed``.
    """
    world = flow_world

    plan_resp = await client.post(
        "/api/v1/treatment_plan/treatment-plans",
        headers=auth_headers,
        json={"patient_id": world["patient_id"], "title": "Restauraciones septiembre"},
    )
    plan_id = plan_resp.json()["data"]["id"]
    t16 = await _create_treatment(client, auth_headers, world, 16)
    t24 = await _create_treatment(client, auth_headers, world, 24)
    t35 = await _create_treatment(client, auth_headers, world, 35)
    i1 = await _add_item(client, auth_headers, plan_id, t16)
    i2 = await _add_item(client, auth_headers, plan_id, t24)
    i3 = await _add_item(client, auth_headers, plan_id, t35)

    appt_resp = await client.post(
        "/api/v1/agenda/appointments",
        headers=auth_headers,
        json={
            "patient_id": world["patient_id"],
            "professional_id": world["dentist_id"],
            "start_time": "2026-09-21T10:00:00",
            "end_time": "2026-09-21T10:30:00",
            "planned_item_ids": [i1, i2],
        },
    )
    assert appt_resp.status_code == 201, appt_resp.text
    appointment = appt_resp.json()["data"]
    appointment_id = appointment["id"]

    for at in appointment["treatments"]:
        r = await client.patch(
            f"/api/v1/agenda/appointment-treatments/{at['id']}",
            headers=auth_headers,
            json={"completed_in_appointment": True},
        )
        assert r.status_code == 200, r.text

    evolution_text = "Se realizan restauraciones 16 y 24 sin complicaciones."
    note_resp = await client.post(
        "/api/v1/clinical_notes/notes",
        headers=auth_headers,
        json={
            "note_type": "appointment_clinical",
            "owner_type": "appointment",
            "owner_id": appointment_id,
            "body": evolution_text,
        },
    )
    assert note_resp.status_code == 201, note_resp.text
    note_id = note_resp.json()["data"]["id"]

    cabinet_id = await _create_cabinet(client, auth_headers, "Gabinete Evo")
    await _complete_appointment(client, auth_headers, appointment_id, cabinet_id)

    # --- Evolution persisted exactly once, correctly linked ---------------
    me = await client.get("/api/v1/auth/me", headers=auth_headers)
    admin_user_id = me.json()["data"]["user"]["id"]

    notes_list = (
        await client.get(
            f"/api/v1/clinical_notes/notes?owner_type=appointment&owner_id={appointment_id}",
            headers=auth_headers,
        )
    ).json()["data"]
    assert len(notes_list) == 1
    assert notes_list[0]["id"] == note_id
    assert notes_list[0]["body"] == evolution_text
    assert notes_list[0]["owner_id"] == appointment_id
    assert notes_list[0]["author_id"] == admin_user_id

    # Resolves to Carlos through the appointment -> patient link.
    recent = (
        await client.get(
            f"/api/v1/clinical_notes/patients/{world['patient_id']}/recent",
            headers=auth_headers,
        )
    ).json()["data"]
    assert any(n["id"] == note_id for n in recent)

    # --- I1, I2 completed; I3 untouched ------------------------------------
    await db_session.commit()
    db_session.expire_all()
    item1 = await db_session.get(PlannedTreatmentItem, i1)
    item2 = await db_session.get(PlannedTreatmentItem, i2)
    item3 = await db_session.get(PlannedTreatmentItem, i3)
    assert item1.status == "completed"
    assert item2.status == "completed"
    assert item3.status == "pending"


async def _seed_multi_session_catalog(db_session: AsyncSession, clinic_id, *, code: str) -> str:
    """Catalog item with 2 session templates — mirrors test_treatment_plan.py's crown fixture."""
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
        names={"es": "Tratamiento multi-sesión"},
        default_price=Decimal("800.00"),
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
    db_session.add_all(
        [
            CatalogItemSession(
                catalog_item_id=item.id,
                sequence=1,
                labels={"es": "Sesión 1"},
                default_price=Decimal("300.00"),
            ),
            CatalogItemSession(
                catalog_item_id=item.id,
                sequence=2,
                labels={"es": "Sesión 2"},
                default_price=Decimal("500.00"),
            ),
        ]
    )
    await db_session.commit()
    return str(item.id)


@pytest.mark.asyncio
async def test_multi_session_item_completes_across_two_appointments(
    client: AsyncClient, auth_headers: dict, db_session: AsyncSession, flow_world: dict
):
    """Fase 13: a visit executes at most one session — item finalizes only
    once every session is terminal, mirroring ``complete_session``'s own
    (already-tested) semantics. No migration: ``on_appointment_completed``
    now routes through ``TreatmentPlanService.complete_item`` — the
    existing "advance the next pending session" shim — instead of a
    direct status flip.
    """
    world = flow_world
    ms_catalog_item_id = await _seed_multi_session_catalog(
        db_session, world["clinic_id"], code="MULTI-SESSION"
    )

    plan_resp = await client.post(
        "/api/v1/treatment_plan/treatment-plans",
        headers=auth_headers,
        json={"patient_id": world["patient_id"], "title": "Endodoncia"},
    )
    plan_id = plan_resp.json()["data"]["id"]
    treatment_resp = await client.post(
        f"/api/v1/odontogram/patients/{world['patient_id']}/treatments",
        headers=auth_headers,
        json={"catalog_item_id": ms_catalog_item_id, "tooth_numbers": [36], "status": "planned"},
    )
    assert treatment_resp.status_code == 201, treatment_resp.text
    treatment_id = treatment_resp.json()["data"]["id"]
    add = await client.post(
        f"/api/v1/treatment_plan/treatment-plans/{plan_id}/items",
        headers=auth_headers,
        json={"treatment_id": treatment_id},
    )
    assert add.status_code == 201, add.text
    item_id = add.json()["data"]["id"]
    sessions = add.json()["data"]["sessions"]
    assert len(sessions) == 2
    session1_id, session2_id = sessions[0]["id"], sessions[1]["id"]

    cabinet_id = await _create_cabinet(client, auth_headers, "Gabinete MS")

    # --- Appointment 1: executes session 1 only ----------------------------
    appt1 = await client.post(
        "/api/v1/agenda/appointments",
        headers=auth_headers,
        json={
            "patient_id": world["patient_id"],
            "professional_id": world["dentist_id"],
            "start_time": "2026-09-20T09:00:00",
            "end_time": "2026-09-20T09:30:00",
            "planned_item_ids": [item_id],
        },
    )
    assert appt1.status_code == 201, appt1.text
    apt1 = appt1.json()["data"]
    at1_id = apt1["treatments"][0]["id"]
    r = await client.patch(
        f"/api/v1/agenda/appointment-treatments/{at1_id}",
        headers=auth_headers,
        json={"completed_in_appointment": True},
    )
    assert r.status_code == 200, r.text
    await _complete_appointment(client, auth_headers, apt1["id"], cabinet_id)

    await db_session.commit()
    db_session.expire_all()

    item_after_1 = await db_session.get(PlannedTreatmentItem, item_id)
    assert item_after_1.status == "pending"  # not finalized — session 2 still pending

    sessions_after_1 = (
        (
            await db_session.execute(
                select(PlannedTreatmentItemSession)
                .where(PlannedTreatmentItemSession.plan_item_id == item_id)
                .order_by(PlannedTreatmentItemSession.sequence)
            )
        )
        .scalars()
        .all()
    )
    assert sessions_after_1[0].status == "completed"
    assert sessions_after_1[1].status == "pending"

    treatment_after_1 = await db_session.get(Treatment, UUID(treatment_id))
    assert treatment_after_1.status == "planned"  # item not finalized yet -> not performed

    earned_after_1 = (
        (
            await db_session.execute(
                select(PatientEarnedEntry).where(
                    PatientEarnedEntry.treatment_id == UUID(treatment_id)
                )
            )
        )
        .scalars()
        .all()
    )
    assert len(earned_after_1) == 1
    assert earned_after_1[0].source_session_id == UUID(session1_id)

    # --- Appointment 2: executes session 2, finalizes the item -------------
    appt2 = await client.post(
        "/api/v1/agenda/appointments",
        headers=auth_headers,
        json={
            "patient_id": world["patient_id"],
            "professional_id": world["dentist_id"],
            "start_time": "2026-09-27T09:00:00",
            "end_time": "2026-09-27T09:30:00",
            "planned_item_ids": [item_id],
        },
    )
    assert appt2.status_code == 201, appt2.text
    apt2 = appt2.json()["data"]
    at2_id = apt2["treatments"][0]["id"]
    r = await client.patch(
        f"/api/v1/agenda/appointment-treatments/{at2_id}",
        headers=auth_headers,
        json={"completed_in_appointment": True},
    )
    assert r.status_code == 200, r.text
    await _complete_appointment(client, auth_headers, apt2["id"], cabinet_id)

    await db_session.commit()
    db_session.expire_all()

    item_after_2 = await db_session.get(PlannedTreatmentItem, item_id)
    assert item_after_2.status == "completed"

    sessions_after_2 = (
        (
            await db_session.execute(
                select(PlannedTreatmentItemSession)
                .where(PlannedTreatmentItemSession.plan_item_id == item_id)
                .order_by(PlannedTreatmentItemSession.sequence)
            )
        )
        .scalars()
        .all()
    )
    assert sessions_after_2[1].status == "completed"

    treatment_after_2 = await db_session.get(Treatment, UUID(treatment_id))
    assert treatment_after_2.status == "performed"

    earned_after_2 = (
        (
            await db_session.execute(
                select(PatientEarnedEntry).where(
                    PatientEarnedEntry.treatment_id == UUID(treatment_id)
                )
            )
        )
        .scalars()
        .all()
    )
    assert len(earned_after_2) == 2
    assert {e.source_session_id for e in earned_after_2} == {UUID(session1_id), UUID(session2_id)}


@pytest.mark.asyncio
async def test_budget_acceptance_reopens_scheduling_window(
    client: AsyncClient, auth_headers: dict, db_session: AsyncSession, flow_world: dict
):
    """Fase 10/11: demonstrates the REAL draft/pending/active scheduling chain.

    ``AppointmentService.validate_planned_items`` accepts plan.status in
    ("active", "draft") — not "pending". So an item is schedulable before
    any budget exists (draft) and again once the patient accepts
    (active), but not while a budget is out for the patient's decision
    (pending). Documented behavior, not changed.
    """
    world = flow_world
    plan_resp = await client.post(
        "/api/v1/treatment_plan/treatment-plans",
        headers=auth_headers,
        json={"patient_id": world["patient_id"], "title": "Budget chain"},
    )
    plan_id = plan_resp.json()["data"]["id"]
    t1 = await _create_treatment(client, auth_headers, world, 17)
    i1 = await _add_item(client, auth_headers, plan_id, t1)

    # A. draft plan: schedulable, no budget exists yet.
    appt_draft = await client.post(
        "/api/v1/agenda/appointments",
        headers=auth_headers,
        json={
            "patient_id": world["patient_id"],
            "professional_id": world["dentist_id"],
            "start_time": "2026-10-01T09:00:00",
            "end_time": "2026-10-01T09:30:00",
            "planned_item_ids": [i1],
        },
    )
    assert appt_draft.status_code == 201, appt_draft.text

    t2 = await _create_treatment(client, auth_headers, world, 18)
    i2 = await _add_item(client, auth_headers, plan_id, t2)

    # B. confirm -> pending: NOT schedulable while awaiting the patient.
    confirm_resp = await client.post(
        f"/api/v1/treatment_plan/treatment-plans/{plan_id}/confirm",
        headers=auth_headers,
        json={},
    )
    assert confirm_resp.status_code == 200, confirm_resp.text
    assert confirm_resp.json()["data"]["status"] == "pending"
    budget_id = confirm_resp.json()["data"]["budget_id"]
    assert budget_id

    appt_pending = await client.post(
        "/api/v1/agenda/appointments",
        headers=auth_headers,
        json={
            "patient_id": world["patient_id"],
            "professional_id": world["dentist_id"],
            "start_time": "2026-10-02T09:00:00",
            "end_time": "2026-10-02T09:30:00",
            "planned_item_ids": [i2],
        },
    )
    assert appt_pending.status_code == 400, appt_pending.text
    assert "pending" in appt_pending.text

    # C. budget accepted -> plan active: schedulable again.
    await db_session.commit()
    db_session.expire_all()
    accept_resp = await client.post(
        f"/api/v1/budget/budgets/{budget_id}/accept",
        headers=auth_headers,
        json={
            "signature": {"signed_by_name": "Carlos Paciente", "relationship_to_patient": "patient"}
        },
    )
    assert accept_resp.status_code == 200, accept_resp.text
    await db_session.commit()
    db_session.expire_all()

    plan_after = await client.get(
        f"/api/v1/treatment_plan/treatment-plans/{plan_id}", headers=auth_headers
    )
    assert plan_after.json()["data"]["status"] == "active"

    appt_active = await client.post(
        "/api/v1/agenda/appointments",
        headers=auth_headers,
        json={
            "patient_id": world["patient_id"],
            "professional_id": world["dentist_id"],
            "start_time": "2026-10-03T09:00:00",
            "end_time": "2026-10-03T09:30:00",
            "planned_item_ids": [i2],
        },
    )
    assert appt_active.status_code == 201, appt_active.text


# ---------------------------------------------------------------------------
# Second follow-up round: note idempotency + exact session-mapping proof
# ---------------------------------------------------------------------------


async def _find_or_create_evolution_note(
    client: AsyncClient, auth_headers: dict, appointment_id: str, body: str
) -> str:
    """Mirrors AppointmentCompletionGateModal.vue's ``findOrCreateEvolutionNote``.

    Deliberately standalone — no shared Python variable/session between
    calls beyond the HTTP API — so two calls to this function simulate two
    genuinely independent attempts (retry after timeout, page refresh, a
    second frontend instance), not just "the same composable called
    twice".
    """
    existing = await client.get(
        f"/api/v1/clinical_notes/notes?owner_type=appointment&owner_id={appointment_id}",
        headers=auth_headers,
    )
    assert existing.status_code == 200, existing.text
    match = next(
        (
            n
            for n in existing.json()["data"]
            if n["note_type"] == "appointment_clinical" and n["body"] == body
        ),
        None,
    )
    if match:
        return match["id"]
    created = await client.post(
        "/api/v1/clinical_notes/notes",
        headers=auth_headers,
        json={
            "note_type": "appointment_clinical",
            "owner_type": "appointment",
            "owner_id": appointment_id,
            "body": body,
        },
    )
    assert created.status_code == 201, created.text
    return created.json()["data"]["id"]


@pytest.mark.asyncio
async def test_evolution_note_retry_from_independent_request_does_not_duplicate(
    client: AsyncClient, auth_headers: dict, flow_world: dict
):
    """Server-side idempotency, not frontend state.

    Two independent find-or-create calls with the same body persist
    exactly one note (retry-after-timeout / refresh / a second frontend
    instance resubmitting the same text). A genuinely different body is —
    correctly, per the existing multi-note-per-appointment feed semantics
    (docs/technical/appointment-notes.md) — a second, legitimate entry,
    not a duplicate to collapse.
    """
    world = flow_world
    plan_resp = await client.post(
        "/api/v1/treatment_plan/treatment-plans",
        headers=auth_headers,
        json={"patient_id": world["patient_id"], "title": "Retry note"},
    )
    plan_id = plan_resp.json()["data"]["id"]
    t1 = await _create_treatment(client, auth_headers, world, 16)
    i1 = await _add_item(client, auth_headers, plan_id, t1)

    appt_resp = await client.post(
        "/api/v1/agenda/appointments",
        headers=auth_headers,
        json={
            "patient_id": world["patient_id"],
            "professional_id": world["dentist_id"],
            "start_time": "2026-11-01T09:00:00",
            "end_time": "2026-11-01T09:30:00",
            "planned_item_ids": [i1],
        },
    )
    assert appt_resp.status_code == 201, appt_resp.text
    appointment_id = appt_resp.json()["data"]["id"]

    evolution_text = "Restauracion 16 sin complicaciones."

    note_id_1 = await _find_or_create_evolution_note(
        client, auth_headers, appointment_id, evolution_text
    )
    note_id_2 = await _find_or_create_evolution_note(
        client, auth_headers, appointment_id, evolution_text
    )
    assert note_id_1 == note_id_2

    notes = (
        await client.get(
            f"/api/v1/clinical_notes/notes?owner_type=appointment&owner_id={appointment_id}",
            headers=auth_headers,
        )
    ).json()["data"]
    matching = [
        n for n in notes if n["note_type"] == "appointment_clinical" and n["body"] == evolution_text
    ]
    assert len(matching) == 1

    different_text = "Nota de seguimiento distinta."
    note_id_3 = await _find_or_create_evolution_note(
        client, auth_headers, appointment_id, different_text
    )
    assert note_id_3 != note_id_1
    notes_after = (
        await client.get(
            f"/api/v1/clinical_notes/notes?owner_type=appointment&owner_id={appointment_id}",
            headers=auth_headers,
        )
    ).json()["data"]
    assert len([n for n in notes_after if n["note_type"] == "appointment_clinical"]) == 2


async def _seed_three_session_catalog(db_session: AsyncSession, clinic_id, *, code: str) -> str:
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
        names={"es": "Tratamiento 3 sesiones"},
        default_price=Decimal("900.00"),
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
    db_session.add_all(
        [
            CatalogItemSession(
                catalog_item_id=item.id,
                sequence=1,
                labels={"es": "Sesion 1"},
                default_price=Decimal("300.00"),
            ),
            CatalogItemSession(
                catalog_item_id=item.id,
                sequence=2,
                labels={"es": "Sesion 2"},
                default_price=Decimal("300.00"),
            ),
            CatalogItemSession(
                catalog_item_id=item.id,
                sequence=3,
                labels={"es": "Sesion 3"},
                default_price=Decimal("300.00"),
            ),
        ]
    )
    await db_session.commit()
    return str(item.id)


async def _next_pending_session_id(
    client: AsyncClient, auth_headers: dict, plan_id: str, item_id: str
) -> str:
    """What PlannedTreatmentSelector's ``getSessionLabel`` would display:
    the earliest-sequence pending session. Mirrors
    frontend/app/components/shared/PlannedTreatmentSelector.vue's
    ``sessions.find(s => s.status === 'pending')`` over the
    sequence-ordered list.
    """
    detail = (
        await client.get(f"/api/v1/treatment_plan/treatment-plans/{plan_id}", headers=auth_headers)
    ).json()["data"]
    item = next(i for i in detail["items"] if i["id"] == item_id)
    sessions = sorted(item["sessions"], key=lambda s: s["sequence"])
    return next(s["id"] for s in sessions if s["status"] == "pending")


@pytest.mark.asyncio
async def test_multi_session_sequential_mapping_is_unambiguous(
    client: AsyncClient, auth_headers: dict, db_session: AsyncSession, flow_world: dict
):
    """Session mapping: three consecutive appointments must each advance
    exactly the session PlannedTreatmentSelector would have displayed at
    scheduling time — S1, then S2, then S3, never out of order and never
    a session other than the one shown.
    """
    world = flow_world
    catalog_item_id = await _seed_three_session_catalog(
        db_session, world["clinic_id"], code="THREE-SESSION"
    )

    plan_resp = await client.post(
        "/api/v1/treatment_plan/treatment-plans",
        headers=auth_headers,
        json={"patient_id": world["patient_id"], "title": "Tres sesiones"},
    )
    plan_id = plan_resp.json()["data"]["id"]
    treatment_resp = await client.post(
        f"/api/v1/odontogram/patients/{world['patient_id']}/treatments",
        headers=auth_headers,
        json={"catalog_item_id": catalog_item_id, "tooth_numbers": [37], "status": "planned"},
    )
    assert treatment_resp.status_code == 201, treatment_resp.text
    treatment_id = treatment_resp.json()["data"]["id"]
    add = await client.post(
        f"/api/v1/treatment_plan/treatment-plans/{plan_id}/items",
        headers=auth_headers,
        json={"treatment_id": treatment_id},
    )
    assert add.status_code == 201, add.text
    item_id = add.json()["data"]["id"]
    sessions_at_add = sorted(add.json()["data"]["sessions"], key=lambda s: s["sequence"])
    s1_id, s2_id, s3_id = (s["id"] for s in sessions_at_add)

    cabinet_id = await _create_cabinet(client, auth_headers, "Gabinete 3S")

    slots = [
        ("2026-11-10T09:00:00", "2026-11-10T09:30:00"),
        ("2026-11-17T09:00:00", "2026-11-17T09:30:00"),
        ("2026-11-24T09:00:00", "2026-11-24T09:30:00"),
    ]
    for expected_session_id, (start, end) in zip((s1_id, s2_id, s3_id), slots, strict=True):
        # What the selector WOULD show right now, before scheduling — must
        # match the session this appointment is expected to advance.
        shown = await _next_pending_session_id(client, auth_headers, plan_id, item_id)
        assert shown == expected_session_id

        appt = await client.post(
            "/api/v1/agenda/appointments",
            headers=auth_headers,
            json={
                "patient_id": world["patient_id"],
                "professional_id": world["dentist_id"],
                "start_time": start,
                "end_time": end,
                "planned_item_ids": [item_id],
            },
        )
        assert appt.status_code == 201, appt.text
        apt = appt.json()["data"]
        at_id = apt["treatments"][0]["id"]
        r = await client.patch(
            f"/api/v1/agenda/appointment-treatments/{at_id}",
            headers=auth_headers,
            json={"completed_in_appointment": True},
        )
        assert r.status_code == 200, r.text
        await _complete_appointment(client, auth_headers, apt["id"], cabinet_id)

        await db_session.commit()
        db_session.expire_all()

        session_after = await db_session.get(PlannedTreatmentItemSession, UUID(expected_session_id))
        assert session_after.status == "completed"

    item_final = await db_session.get(PlannedTreatmentItem, item_id)
    assert item_final.status == "completed"
    treatment_final = await db_session.get(Treatment, UUID(treatment_id))
    assert treatment_final.status == "performed"
