"""Smoke tests for the clinical_notes module (issue #60).

Covers the four note_type pairings, the recent feed for the patient summary
tab, the type/owner matrix CHECK rejection and the per-treatment endpoint.
"""

from datetime import UTC, datetime, timedelta
from uuid import UUID, uuid4

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth.models import Clinic, ClinicMembership
from app.modules.agenda.models import Appointment
from app.modules.agenda.service import AppointmentService
from app.modules.odontogram.models import Treatment


async def _seed_clinic_and_patient(
    db_session: AsyncSession, client: AsyncClient, auth_headers: dict[str, str]
) -> dict:
    me = await client.get("/api/v1/auth/me", headers=auth_headers)
    user_id = me.json()["data"]["user"]["id"]

    clinic = Clinic(
        id=uuid4(),
        name="Notes Clinic",
        tax_id="B22222222",
        address={"street": "x", "city": "y"},
        settings={"slot_duration_min": 15},
    )
    db_session.add(clinic)
    await db_session.flush()
    db_session.add(
        ClinicMembership(id=uuid4(), user_id=user_id, clinic_id=clinic.id, role="dentist")
    )
    await db_session.commit()

    patient_resp = await client.post(
        "/api/v1/patients",
        headers=auth_headers,
        json={"first_name": "Ana", "last_name": "García", "phone": "+34699111222"},
    )
    return {"clinic_id": str(clinic.id), "patient_id": patient_resp.json()["data"]["id"]}


async def _seed_treatment(db_session: AsyncSession, clinic_id, patient_id) -> str:
    """Seed a minimal Treatment row tied to a patient — represents a tooth
    finding diagnosed in the odontogram. Notes attach to its id."""
    treatment = Treatment(
        id=uuid4(),
        clinic_id=clinic_id,
        patient_id=patient_id,
        clinical_type="caries",
        scope="tooth",
        status="existing",
        recorded_at=datetime.now(UTC),
        source_module="odontogram",
    )
    db_session.add(treatment)
    await db_session.commit()
    return str(treatment.id)


@pytest.mark.asyncio
async def test_create_administrative_note(
    client: AsyncClient, auth_headers: dict[str, str], db_session: AsyncSession
):
    ctx = await _seed_clinic_and_patient(db_session, client, auth_headers)

    resp = await client.post(
        "/api/v1/clinical_notes/notes",
        headers=auth_headers,
        json={
            "note_type": "administrative",
            "owner_type": "patient",
            "owner_id": ctx["patient_id"],
            "body": "Patient called complaining of tooth pain",
        },
    )
    assert resp.status_code == 201, resp.text
    note = resp.json()["data"]
    assert note["note_type"] == "administrative"
    assert note["owner_type"] == "patient"
    assert note["tooth_number"] is None


@pytest.mark.asyncio
async def test_create_diagnosis_note_with_tooth(
    client: AsyncClient, auth_headers: dict[str, str], db_session: AsyncSession
):
    ctx = await _seed_clinic_and_patient(db_session, client, auth_headers)
    resp = await client.post(
        "/api/v1/clinical_notes/notes",
        headers=auth_headers,
        json={
            "note_type": "diagnosis",
            "owner_type": "patient",
            "owner_id": ctx["patient_id"],
            "tooth_number": 47,
            "body": "Deep caries on 47",
        },
    )
    assert resp.status_code == 201, resp.text
    assert resp.json()["data"]["tooth_number"] == 47


@pytest.mark.asyncio
async def test_create_treatment_note_attaches_to_treatment_id(
    client: AsyncClient, auth_headers: dict[str, str], db_session: AsyncSession
):
    ctx = await _seed_clinic_and_patient(db_session, client, auth_headers)
    treatment_id = await _seed_treatment(db_session, ctx["clinic_id"], ctx["patient_id"])

    resp = await client.post(
        "/api/v1/clinical_notes/notes",
        headers=auth_headers,
        json={
            "note_type": "treatment",
            "owner_type": "treatment",
            "owner_id": treatment_id,
            "body": "Filling was deep — may need endodontics",
        },
    )
    assert resp.status_code == 201, resp.text
    note = resp.json()["data"]
    assert note["owner_type"] == "treatment"
    assert note["owner_id"] == treatment_id

    # Same note shows up via the per-owner list and the patient recent feed.
    list_resp = await client.get(
        f"/api/v1/clinical_notes/notes?owner_type=treatment&owner_id={treatment_id}",
        headers=auth_headers,
    )
    assert list_resp.status_code == 200
    assert any(n["id"] == note["id"] for n in list_resp.json()["data"])

    recent = await client.get(
        f"/api/v1/clinical_notes/patients/{ctx['patient_id']}/recent",
        headers=auth_headers,
    )
    assert recent.status_code == 200
    bodies = [e["body"] for e in recent.json()["data"]]
    assert any("endodontics" in b for b in bodies)


@pytest.mark.asyncio
async def test_matrix_rejects_tooth_on_admin(
    client: AsyncClient, auth_headers: dict[str, str], db_session: AsyncSession
):
    ctx = await _seed_clinic_and_patient(db_session, client, auth_headers)
    resp = await client.post(
        "/api/v1/clinical_notes/notes",
        headers=auth_headers,
        json={
            "note_type": "administrative",
            "owner_type": "patient",
            "owner_id": ctx["patient_id"],
            "tooth_number": 47,
            "body": "should fail",
        },
    )
    # The schema-level validator catches the bad pairing as 422.
    assert resp.status_code == 422, resp.text


@pytest.mark.asyncio
async def test_matrix_rejects_diagnosis_on_treatment(
    client: AsyncClient, auth_headers: dict[str, str], db_session: AsyncSession
):
    ctx = await _seed_clinic_and_patient(db_session, client, auth_headers)
    treatment_id = await _seed_treatment(db_session, ctx["clinic_id"], ctx["patient_id"])
    resp = await client.post(
        "/api/v1/clinical_notes/notes",
        headers=auth_headers,
        json={
            "note_type": "diagnosis",
            "owner_type": "treatment",
            "owner_id": treatment_id,
            "body": "should fail",
        },
    )
    assert resp.status_code == 422, resp.text


@pytest.mark.asyncio
async def test_recent_feed_filters_by_type(
    client: AsyncClient, auth_headers: dict[str, str], db_session: AsyncSession
):
    ctx = await _seed_clinic_and_patient(db_session, client, auth_headers)

    # Two notes of different types
    await client.post(
        "/api/v1/clinical_notes/notes",
        headers=auth_headers,
        json={
            "note_type": "administrative",
            "owner_type": "patient",
            "owner_id": ctx["patient_id"],
            "body": "Admin",
        },
    )
    await client.post(
        "/api/v1/clinical_notes/notes",
        headers=auth_headers,
        json={
            "note_type": "diagnosis",
            "owner_type": "patient",
            "owner_id": ctx["patient_id"],
            "body": "Diag",
        },
    )

    only_admin = await client.get(
        f"/api/v1/clinical_notes/patients/{ctx['patient_id']}/recent?types=administrative",
        headers=auth_headers,
    )
    assert only_admin.status_code == 200
    rows = only_admin.json()["data"]
    assert all(r["note_type"] == "administrative" for r in rows)
    assert any(r["body"] == "Admin" for r in rows)


# ---------------------------------------------------------------------------
# Appointment-owner notes (clinical_notes cn_0003 + agenda ag_0005)
# ---------------------------------------------------------------------------


async def _seed_appointment(
    db_session: AsyncSession,
    clinic_id: UUID,
    patient_id: UUID,
    actor_id: UUID,
) -> Appointment:
    start = datetime(2026, 7, 1, 10, 0, tzinfo=UTC)
    apt = await AppointmentService.create_appointment(
        db_session,
        clinic_id,
        {
            "patient_id": patient_id,
            "professional_id": actor_id,
            "start_time": start,
            "end_time": start + timedelta(minutes=30),
        },
        created_by=actor_id,
    )
    await db_session.commit()
    return apt


@pytest.mark.asyncio
async def test_create_appointment_clinical_note(
    client: AsyncClient, auth_headers: dict[str, str], db_session: AsyncSession
):
    ctx = await _seed_clinic_and_patient(db_session, client, auth_headers)
    me = await client.get("/api/v1/auth/me", headers=auth_headers)
    user_id = UUID(me.json()["data"]["user"]["id"])
    apt = await _seed_appointment(
        db_session, UUID(ctx["clinic_id"]), UUID(ctx["patient_id"]), user_id
    )

    resp = await client.post(
        "/api/v1/clinical_notes/notes",
        headers=auth_headers,
        json={
            "note_type": "appointment_clinical",
            "owner_type": "appointment",
            "owner_id": str(apt.id),
            "body": "Patient reported pain in lower right molar",
        },
    )
    assert resp.status_code == 201, resp.text
    note = resp.json()["data"]
    assert note["note_type"] == "appointment_clinical"
    assert note["owner_type"] == "appointment"
    assert note["owner_id"] == str(apt.id)
    assert note["tooth_number"] is None


@pytest.mark.asyncio
async def test_create_appointment_administrative_note(
    client: AsyncClient, auth_headers: dict[str, str], db_session: AsyncSession
):
    ctx = await _seed_clinic_and_patient(db_session, client, auth_headers)
    me = await client.get("/api/v1/auth/me", headers=auth_headers)
    user_id = UUID(me.json()["data"]["user"]["id"])
    apt = await _seed_appointment(
        db_session, UUID(ctx["clinic_id"]), UUID(ctx["patient_id"]), user_id
    )

    resp = await client.post(
        "/api/v1/clinical_notes/notes",
        headers=auth_headers,
        json={
            "note_type": "appointment_administrative",
            "owner_type": "appointment",
            "owner_id": str(apt.id),
            "body": "Patient arrived 10 minutes late",
        },
    )
    assert resp.status_code == 201, resp.text


@pytest.mark.asyncio
async def test_appointment_note_resolves_to_patient_in_feed(
    client: AsyncClient, auth_headers: dict[str, str], db_session: AsyncSession
):
    ctx = await _seed_clinic_and_patient(db_session, client, auth_headers)
    me = await client.get("/api/v1/auth/me", headers=auth_headers)
    user_id = UUID(me.json()["data"]["user"]["id"])
    apt = await _seed_appointment(
        db_session, UUID(ctx["clinic_id"]), UUID(ctx["patient_id"]), user_id
    )

    await client.post(
        "/api/v1/clinical_notes/notes",
        headers=auth_headers,
        json={
            "note_type": "appointment_clinical",
            "owner_type": "appointment",
            "owner_id": str(apt.id),
            "body": "Visible in patient feed via appointment owner",
        },
    )

    recent = await client.get(
        f"/api/v1/clinical_notes/patients/{ctx['patient_id']}/recent",
        headers=auth_headers,
    )
    assert recent.status_code == 200
    bodies = [e["body"] for e in recent.json()["data"]]
    assert any("Visible in patient feed" in b for b in bodies)


@pytest.mark.asyncio
async def test_matrix_rejects_appointment_clinical_on_patient(
    client: AsyncClient, auth_headers: dict[str, str], db_session: AsyncSession
):
    ctx = await _seed_clinic_and_patient(db_session, client, auth_headers)
    resp = await client.post(
        "/api/v1/clinical_notes/notes",
        headers=auth_headers,
        json={
            "note_type": "appointment_clinical",
            "owner_type": "patient",
            "owner_id": ctx["patient_id"],
            "body": "should fail",
        },
    )
    assert resp.status_code == 422, resp.text


@pytest.mark.asyncio
async def test_appointment_owner_404_when_not_found(
    client: AsyncClient, auth_headers: dict[str, str], db_session: AsyncSession
):
    await _seed_clinic_and_patient(db_session, client, auth_headers)
    fake_id = str(uuid4())
    resp = await client.post(
        "/api/v1/clinical_notes/notes",
        headers=auth_headers,
        json={
            "note_type": "appointment_clinical",
            "owner_type": "appointment",
            "owner_id": fake_id,
            "body": "no appointment",
        },
    )
    assert resp.status_code == 404, resp.text


@pytest.mark.asyncio
async def test_appointment_response_no_legacy_notes_field(
    client: AsyncClient, auth_headers: dict[str, str], db_session: AsyncSession
):
    """ag_0005 dropped the column — the API must not expose ``notes`` anymore."""
    ctx = await _seed_clinic_and_patient(db_session, client, auth_headers)
    me = await client.get("/api/v1/auth/me", headers=auth_headers)
    user_id = UUID(me.json()["data"]["user"]["id"])
    apt = await _seed_appointment(
        db_session, UUID(ctx["clinic_id"]), UUID(ctx["patient_id"]), user_id
    )

    resp = await client.get(f"/api/v1/agenda/appointments/{apt.id}", headers=auth_headers)
    assert resp.status_code == 200, resp.text
    assert "notes" not in resp.json()["data"]


# ---------------------------------------------------------------------------
# Evolution notes (clinical_notes cn_0005) — patient-owned, tooth-less
# ---------------------------------------------------------------------------


def _evolution_payload(patient_id: str, **overrides) -> dict:
    return {
        "note_type": "evolution",
        "owner_type": "patient",
        "owner_id": patient_id,
        "body": "Paciente refiere mejoría tras la última sesión",
        **overrides,
    }


@pytest.mark.asyncio
async def test_create_evolution_note_is_patient_owned_without_tooth(
    client: AsyncClient, auth_headers: dict[str, str], db_session: AsyncSession
):
    ctx = await _seed_clinic_and_patient(db_session, client, auth_headers)
    resp = await client.post(
        "/api/v1/clinical_notes/notes",
        headers=auth_headers,
        json=_evolution_payload(ctx["patient_id"]),
    )
    assert resp.status_code == 201, resp.text
    note = resp.json()["data"]
    assert note["note_type"] == "evolution"
    assert note["owner_type"] == "patient"
    assert note["owner_id"] == ctx["patient_id"]
    assert note["tooth_number"] is None


@pytest.mark.asyncio
async def test_evolution_rejects_a_tooth(
    client: AsyncClient, auth_headers: dict[str, str], db_session: AsyncSession
):
    ctx = await _seed_clinic_and_patient(db_session, client, auth_headers)
    resp = await client.post(
        "/api/v1/clinical_notes/notes",
        headers=auth_headers,
        json=_evolution_payload(ctx["patient_id"], tooth_number=47),
    )
    assert resp.status_code == 422, resp.text


@pytest.mark.asyncio
@pytest.mark.parametrize("owner_type", ["treatment", "plan", "appointment"])
async def test_evolution_rejects_any_other_owner(
    client: AsyncClient,
    auth_headers: dict[str, str],
    db_session: AsyncSession,
    owner_type: str,
):
    ctx = await _seed_clinic_and_patient(db_session, client, auth_headers)
    resp = await client.post(
        "/api/v1/clinical_notes/notes",
        headers=auth_headers,
        json=_evolution_payload(ctx["patient_id"], owner_type=owner_type, owner_id=str(uuid4())),
    )
    assert resp.status_code == 422, resp.text


@pytest.mark.asyncio
async def test_database_matrix_rejects_evolution_outside_the_contract(
    client: AsyncClient, auth_headers: dict[str, str], db_session: AsyncSession
):
    """The CHECK is the backstop behind the schema validator."""
    from sqlalchemy.exc import IntegrityError

    from app.modules.clinical_notes.models import ClinicalNote

    ctx = await _seed_clinic_and_patient(db_session, client, auth_headers)
    me = await client.get("/api/v1/auth/me", headers=auth_headers)
    user_id = UUID(me.json()["data"]["user"]["id"])
    clinic_id = UUID(ctx["clinic_id"])
    patient_id = UUID(ctx["patient_id"])

    bad_rows = [
        {"owner_type": "plan", "owner_id": uuid4(), "tooth_number": None},
        {"owner_type": "patient", "owner_id": patient_id, "tooth_number": 11},
    ]
    for bad in bad_rows:
        db_session.add(
            ClinicalNote(
                clinic_id=clinic_id,
                note_type="evolution",
                body="x",
                author_id=user_id,
                **bad,
            )
        )
        with pytest.raises(IntegrityError):
            await db_session.flush()
        await db_session.rollback()


@pytest.mark.asyncio
async def test_recent_feed_lists_evolution_and_filters_by_it(
    client: AsyncClient, auth_headers: dict[str, str], db_session: AsyncSession
):
    ctx = await _seed_clinic_and_patient(db_session, client, auth_headers)
    for note_type, body in (
        ("administrative", "Admin"),
        ("diagnosis", "Diag"),
        ("evolution", "Evo"),
    ):
        resp = await client.post(
            "/api/v1/clinical_notes/notes",
            headers=auth_headers,
            json={
                "note_type": note_type,
                "owner_type": "patient",
                "owner_id": ctx["patient_id"],
                "body": body,
            },
        )
        assert resp.status_code == 201, resp.text

    everything = await client.get(
        f"/api/v1/clinical_notes/patients/{ctx['patient_id']}/recent", headers=auth_headers
    )
    assert {r["body"] for r in everything.json()["data"]} == {"Admin", "Diag", "Evo"}

    only_evolution = await client.get(
        f"/api/v1/clinical_notes/patients/{ctx['patient_id']}/recent?types=evolution",
        headers=auth_headers,
    )
    assert only_evolution.status_code == 200, only_evolution.text
    rows = only_evolution.json()["data"]
    assert [r["body"] for r in rows] == ["Evo"]
    assert rows[0]["linked"]["kind"] == "patient"
    assert rows[0]["linked"]["tooth_number"] is None

    # The Evolución tab's default: every clinical type, no administrative ones.
    clinical = await client.get(
        f"/api/v1/clinical_notes/patients/{ctx['patient_id']}/recent"
        "?types=evolution&types=diagnosis&types=treatment&types=treatment_plan"
        "&types=appointment_clinical",
        headers=auth_headers,
    )
    assert {r["body"] for r in clinical.json()["data"]} == {"Diag", "Evo"}


@pytest.mark.asyncio
async def test_creating_an_evolution_note_publishes_its_own_event(
    client: AsyncClient, auth_headers: dict[str, str], db_session: AsyncSession
):
    from app.core.events import EventType, event_bus

    captured: list[dict] = []

    async def _spy(data: dict) -> None:
        captured.append(data)

    ctx = await _seed_clinic_and_patient(db_session, client, auth_headers)
    event_bus.subscribe(EventType.CLINICAL_NOTE_EVOLUTION_CREATED, _spy)
    try:
        resp = await client.post(
            "/api/v1/clinical_notes/notes",
            headers=auth_headers,
            json=_evolution_payload(ctx["patient_id"]),
        )
    finally:
        event_bus.unsubscribe(EventType.CLINICAL_NOTE_EVOLUTION_CREATED, _spy)

    assert resp.status_code == 201, resp.text
    assert EventType.CLINICAL_NOTE_EVOLUTION_CREATED == "clinical_notes.evolution_created"
    assert len(captured) == 1
    assert captured[0]["note_type"] == "evolution"
    assert captured[0]["owner_type"] == "patient"
    assert captured[0]["patient_id"] == ctx["patient_id"]
    assert captured[0]["tooth_number"] is None


@pytest.mark.asyncio
async def test_existing_note_types_are_still_valid(
    client: AsyncClient, auth_headers: dict[str, str], db_session: AsyncSession
):
    """cn_0005 widened the constraints; nothing that was legal before broke."""
    ctx = await _seed_clinic_and_patient(db_session, client, auth_headers)
    treatment_id = await _seed_treatment(db_session, ctx["clinic_id"], ctx["patient_id"])
    cases = [
        ("administrative", "patient", ctx["patient_id"], None),
        ("diagnosis", "patient", ctx["patient_id"], 36),
        ("treatment", "treatment", treatment_id, None),
    ]
    for note_type, owner_type, owner_id, tooth in cases:
        resp = await client.post(
            "/api/v1/clinical_notes/notes",
            headers=auth_headers,
            json={
                "note_type": note_type,
                "owner_type": owner_type,
                "owner_id": owner_id,
                "tooth_number": tooth,
                "body": f"legacy {note_type}",
            },
        )
        assert resp.status_code == 201, (note_type, resp.text)
