"""HTTP/RBAC coverage for the DP-33 patient lifecycle endpoints."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from uuid import uuid4

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth.models import Clinic, ClinicMembership, User
from app.core.auth.service import create_access_token, hash_password
from app.modules.agenda.models import Appointment
from app.modules.billing.models import Invoice
from app.modules.budget.models import Budget
from app.modules.clinical_notes.models import ClinicalNote
from app.modules.media.models import Document, MediaAttachment, MediaPurgeOutbox
from app.modules.notifications.models import CommunicationMessage, NotificationPreference
from app.modules.odontogram.models import OdontogramHistory, ToothRecord, Treatment
from app.modules.patient_timeline.models import PatientTimeline
from app.modules.patients.models import Patient
from app.modules.patients_clinical.models import (
    Allergy,
    EmergencyContact,
    LegalGuardian,
    MedicalContext,
    Medication,
    SurgicalHistory,
    SystemicDisease,
)
from app.modules.payments.models import PatientEarnedEntry, Payment
from app.modules.periodontogram.models import PeriodontogramSnapshot
from app.modules.recalls.models import Recall
from app.modules.treatment_plan.models import TreatmentPlan


async def _headers(db: AsyncSession, clinic: Clinic, role: str) -> dict[str, str]:
    user = User(
        email=f"{role}-{uuid4()}@example.test",
        password_hash=hash_password("TestPass1234"),
        first_name=role,
        last_name="DP33",
    )
    db.add(user)
    await db.flush()
    db.add(ClinicMembership(id=uuid4(), user_id=user.id, clinic_id=clinic.id, role=role))
    await db.commit()
    return {
        "Authorization": f"Bearer {create_access_token(user.id, token_version=user.token_version)}"
    }


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("role", "expected"),
    [
        ("admin", 204),
        ("dentist", 204),
        ("assistant", 403),
        ("receptionist", 403),
        ("hygienist", 403),
    ],
)
async def test_permanent_delete_rbac_http(
    client: AsyncClient,
    db_session: AsyncSession,
    test_clinic: Clinic,
    test_patient: Patient,
    role: str,
    expected: int,
) -> None:
    headers = await _headers(db_session, test_clinic, role)
    response = await client.request(
        "DELETE",
        f"/api/v1/patients/{test_patient.id}/permanent",
        json={"confirmation": "ELIMINAR"},
        headers=headers,
    )
    assert response.status_code == expected
    if expected == 403:
        assert await db_session.get(Patient, test_patient.id) is not None


@pytest.mark.asyncio
@pytest.mark.parametrize("confirmation", ["eliminar", " ELIMINAR", "ELIMINAR ", ""])
async def test_permanent_delete_requires_exact_confirmation_http(
    client: AsyncClient,
    db_session: AsyncSession,
    test_clinic: Clinic,
    test_patient: Patient,
    confirmation: str,
) -> None:
    response = await client.request(
        "DELETE",
        f"/api/v1/patients/{test_patient.id}/permanent",
        json={"confirmation": confirmation},
        headers=await _headers(db_session, test_clinic, "admin"),
    )
    assert response.status_code == 422
    assert await db_session.get(Patient, test_patient.id) is not None


@pytest.mark.asyncio
async def test_restore_http_permissions_state_and_clinic_isolation(
    client: AsyncClient,
    db_session: AsyncSession,
    test_clinic: Clinic,
    test_patient: Patient,
) -> None:
    admin = await _headers(db_session, test_clinic, "admin")
    assert (
        await client.delete(f"/api/v1/patients/{test_patient.id}", headers=admin)
    ).status_code == 204
    assert (
        await client.post(f"/api/v1/patients/{test_patient.id}/restore", headers=admin)
    ).status_code == 200
    assert (
        await client.post(f"/api/v1/patients/{test_patient.id}/restore", headers=admin)
    ).status_code == 409

    test_patient.status = "archived"
    other = Clinic(id=uuid4(), name="Other", tax_id="B87654321", address={})
    db_session.add(other)
    await db_session.commit()
    other_admin = await _headers(db_session, other, "admin")
    assert (
        await client.post(f"/api/v1/patients/{test_patient.id}/restore", headers=other_admin)
    ).status_code == 404
    assert (
        await client.request(
            "DELETE",
            f"/api/v1/patients/{test_patient.id}/permanent",
            json={"confirmation": "ELIMINAR"},
            headers=other_admin,
        )
    ).status_code == 404
    assert (
        await db_session.scalar(select(Patient.id).where(Patient.id == test_patient.id)) is not None
    )


@pytest.mark.asyncio
async def test_restore_without_patients_write_is_forbidden_http(
    client: AsyncClient,
    db_session: AsyncSession,
    test_clinic: Clinic,
    test_patient: Patient,
) -> None:
    test_patient.status = "archived"
    await db_session.commit()
    response = await client.post(
        f"/api/v1/patients/{test_patient.id}/restore",
        headers=await _headers(db_session, test_clinic, "hygienist"),
    )
    assert response.status_code == 403
    assert (
        await db_session.scalar(select(Patient.status).where(Patient.id == test_patient.id))
        == "archived"
    )


@pytest.mark.asyncio
async def test_permanent_delete_http_removes_integral_patient_rows(
    client: AsyncClient,
    db_session: AsyncSession,
    test_clinic: Clinic,
    test_patient: Patient,
) -> None:
    """HTTP path deletes representative owned rows and queues media purge."""
    headers = await _headers(db_session, test_clinic, "admin")
    user_id = await db_session.scalar(select(User.id).limit(1))
    now = datetime.now(UTC)
    appointment = Appointment(
        clinic_id=test_clinic.id,
        patient_id=test_patient.id,
        professional_id=user_id,
        start_time=now,
        end_time=now + timedelta(minutes=30),
        status="scheduled",
    )
    treatment = Treatment(
        clinic_id=test_clinic.id,
        patient_id=test_patient.id,
        clinical_type="caries",
        scope="global_mouth",
        status="planned",
        recorded_at=now,
    )
    document = Document(
        clinic_id=test_clinic.id,
        patient_id=test_patient.id,
        document_type="other",
        title="QA",
        original_filename="qa.pdf",
        storage_path=f"qa/{uuid4()}.pdf",
        mime_type="application/pdf",
        file_size=1,
        uploaded_by=user_id,
    )
    db_session.add_all([appointment, treatment, document])
    await db_session.commit()
    patient_id = test_patient.id
    response = await client.request(
        "DELETE",
        f"/api/v1/patients/{patient_id}/permanent",
        json={"confirmation": "ELIMINAR"},
        headers=headers,
    )
    assert response.status_code == 204
    assert await db_session.scalar(select(Patient.id).where(Patient.id == patient_id)) is None
    assert (
        await db_session.scalar(select(Appointment.id).where(Appointment.id == appointment.id))
        is None
    )
    assert await db_session.scalar(select(Treatment.id).where(Treatment.id == treatment.id)) is None
    assert await db_session.scalar(select(Document.id).where(Document.id == document.id)) is None
    assert (
        await db_session.scalar(
            select(MediaPurgeOutbox.id).where(MediaPurgeOutbox.patient_id == patient_id)
        )
        is not None
    )


@pytest.mark.asyncio
async def test_permanent_delete_http_removes_fk_batch_one(
    client: AsyncClient, db_session: AsyncSession, test_clinic: Clinic, test_patient: Patient
) -> None:
    headers = await _headers(db_session, test_clinic, "admin")
    user_id = await db_session.scalar(select(User.id).limit(1))
    now = datetime.now(UTC)
    rows = [
        Appointment(
            clinic_id=test_clinic.id,
            patient_id=test_patient.id,
            professional_id=user_id,
            start_time=now,
            end_time=now + timedelta(minutes=30),
            status="scheduled",
        ),
        Budget(
            clinic_id=test_clinic.id,
            patient_id=test_patient.id,
            budget_number=f"QA-{uuid4()}",
            version=1,
            status="draft",
            valid_from=now.date(),
            created_by=user_id,
            subtotal=0,
            total_discount=0,
            total_tax=0,
            total=0,
        ),
        CommunicationMessage(
            clinic_id=test_clinic.id,
            patient_id=test_patient.id,
            to_address="qa@example.test",
            template_key="qa",
            status="pending",
        ),
        Document(
            clinic_id=test_clinic.id,
            patient_id=test_patient.id,
            document_type="other",
            title="QA",
            original_filename="qa.pdf",
            storage_path=f"qa/{uuid4()}.pdf",
            mime_type="application/pdf",
            file_size=1,
            uploaded_by=user_id,
        ),
        Invoice(
            clinic_id=test_clinic.id, patient_id=test_patient.id, status="draft", created_by=user_id
        ),
        NotificationPreference(clinic_id=test_clinic.id, patient_id=test_patient.id),
    ]
    db_session.add_all(rows)
    await db_session.commit()
    patient_id = test_patient.id
    models = (Appointment, Budget, CommunicationMessage, Document, Invoice, NotificationPreference)
    for model in models:
        assert await db_session.scalar(select(model.id).where(model.patient_id == patient_id))
    response = await client.request(
        "DELETE",
        f"/api/v1/patients/{patient_id}/permanent",
        json={"confirmation": "ELIMINAR"},
        headers=headers,
    )
    assert response.status_code == 204
    for model in models:
        assert (
            await db_session.scalar(select(model.id).where(model.patient_id == patient_id)) is None
        )


@pytest.mark.asyncio
async def test_permanent_delete_http_removes_fk_batch_two(
    client: AsyncClient, db_session: AsyncSession, test_clinic: Clinic, test_patient: Patient
) -> None:
    headers = await _headers(db_session, test_clinic, "admin")
    user_id = await db_session.scalar(select(User.id).limit(1))
    now = datetime.now(UTC)
    treatment_id = uuid4()
    rows = [
        OdontogramHistory(
            clinic_id=test_clinic.id,
            patient_id=test_patient.id,
            tooth_number=11,
            change_type="qa",
            changed_by=user_id,
            changed_at=now,
        ),
        PatientEarnedEntry(
            clinic_id=test_clinic.id,
            patient_id=test_patient.id,
            treatment_id=treatment_id,
            amount=1,
            performed_at=now,
            source_event="qa",
        ),
        PatientTimeline(
            clinic_id=test_clinic.id,
            patient_id=test_patient.id,
            event_type="qa",
            event_category="qa",
            source_table="qa",
            source_id=uuid4(),
            title="QA",
            occurred_at=now,
        ),
        Allergy(clinic_id=test_clinic.id, patient_id=test_patient.id, name="QA"),
        EmergencyContact(
            clinic_id=test_clinic.id, patient_id=test_patient.id, name="QA", phone="+34000000000"
        ),
        LegalGuardian(
            clinic_id=test_clinic.id,
            patient_id=test_patient.id,
            name="QA",
            relationship="parent",
            phone="+34000000001",
        ),
    ]
    db_session.add_all(rows)
    await db_session.commit()
    patient_id = test_patient.id
    models = (
        OdontogramHistory,
        PatientEarnedEntry,
        PatientTimeline,
        Allergy,
        EmergencyContact,
        LegalGuardian,
    )
    for model in models:
        assert await db_session.scalar(
            select(model.patient_id).where(model.patient_id == patient_id)
        )
    response = await client.request(
        "DELETE",
        f"/api/v1/patients/{patient_id}/permanent",
        json={"confirmation": "ELIMINAR"},
        headers=headers,
    )
    assert response.status_code == 204
    for model in models:
        assert (
            await db_session.scalar(select(model.patient_id).where(model.patient_id == patient_id))
            is None
        )


@pytest.mark.asyncio
async def test_permanent_delete_http_removes_fk_batch_three(
    client: AsyncClient, db_session: AsyncSession, test_clinic: Clinic, test_patient: Patient
) -> None:
    headers = await _headers(db_session, test_clinic, "admin")
    user_id = await db_session.scalar(select(User.id).limit(1))
    now = datetime.now(UTC)
    rows = [
        MedicalContext(clinic_id=test_clinic.id, patient_id=test_patient.id),
        Medication(clinic_id=test_clinic.id, patient_id=test_patient.id, name="QA"),
        SurgicalHistory(clinic_id=test_clinic.id, patient_id=test_patient.id, procedure="QA"),
        SystemicDisease(clinic_id=test_clinic.id, patient_id=test_patient.id, name="QA"),
        Payment(
            clinic_id=test_clinic.id,
            patient_id=test_patient.id,
            amount=1,
            currency="EUR",
            method="cash",
            payment_date=now.date(),
            recorded_by=user_id,
        ),
        PeriodontogramSnapshot(
            clinic_id=test_clinic.id,
            patient_id=test_patient.id,
            status="draft",
            recorded_at=now,
            recorded_by=user_id,
        ),
    ]
    db_session.add_all(rows)
    await db_session.commit()
    patient_id = test_patient.id
    models = (
        MedicalContext,
        Medication,
        SurgicalHistory,
        SystemicDisease,
        Payment,
        PeriodontogramSnapshot,
    )
    for model in models:
        assert await db_session.scalar(
            select(model.patient_id).where(model.patient_id == patient_id)
        )
    response = await client.request(
        "DELETE",
        f"/api/v1/patients/{patient_id}/permanent",
        json={"confirmation": "ELIMINAR"},
        headers=headers,
    )
    assert response.status_code == 204
    for model in models:
        assert (
            await db_session.scalar(select(model.patient_id).where(model.patient_id == patient_id))
            is None
        )


@pytest.mark.asyncio
async def test_permanent_delete_http_removes_fk_batch_four(
    client: AsyncClient, db_session: AsyncSession, test_clinic: Clinic, test_patient: Patient
) -> None:
    headers = await _headers(db_session, test_clinic, "admin")
    user_id = await db_session.scalar(select(User.id).limit(1))
    now = datetime.now(UTC)
    rows = [
        Recall(
            clinic_id=test_clinic.id,
            patient_id=test_patient.id,
            due_month=now.date().replace(day=1),
            reason="checkup",
        ),
        ToothRecord(
            clinic_id=test_clinic.id,
            patient_id=test_patient.id,
            tooth_number=11,
            tooth_type="permanent",
        ),
        TreatmentPlan(
            clinic_id=test_clinic.id,
            patient_id=test_patient.id,
            plan_number=f"QA-{uuid4()}",
            status="draft",
            created_by=user_id,
        ),
        Treatment(
            clinic_id=test_clinic.id,
            patient_id=test_patient.id,
            clinical_type="caries",
            scope="global_mouth",
            status="planned",
            recorded_at=now,
        ),
    ]
    db_session.add_all(rows)
    await db_session.commit()
    patient_id = test_patient.id
    models = (Recall, ToothRecord, TreatmentPlan, Treatment)
    for model in models:
        assert await db_session.scalar(
            select(model.patient_id).where(model.patient_id == patient_id)
        )
    response = await client.request(
        "DELETE",
        f"/api/v1/patients/{patient_id}/permanent",
        json={"confirmation": "ELIMINAR"},
        headers=headers,
    )
    assert response.status_code == 204
    for model in models:
        assert (
            await db_session.scalar(select(model.patient_id).where(model.patient_id == patient_id))
            is None
        )


@pytest.mark.asyncio
async def test_permanent_delete_http_removes_polymorphic_owners(
    client: AsyncClient, db_session: AsyncSession, test_clinic: Clinic, test_patient: Patient
) -> None:
    headers = await _headers(db_session, test_clinic, "admin")
    user_id = await db_session.scalar(select(User.id).limit(1))
    now = datetime.now(UTC)
    appointment = Appointment(
        clinic_id=test_clinic.id,
        patient_id=test_patient.id,
        professional_id=user_id,
        start_time=now,
        end_time=now + timedelta(minutes=30),
        status="scheduled",
    )
    treatment = Treatment(
        clinic_id=test_clinic.id,
        patient_id=test_patient.id,
        clinical_type="caries",
        scope="global_mouth",
        status="planned",
        recorded_at=now,
    )
    plan = TreatmentPlan(
        clinic_id=test_clinic.id,
        patient_id=test_patient.id,
        plan_number=f"QA-{uuid4()}",
        status="draft",
        created_by=user_id,
    )
    document = Document(
        clinic_id=test_clinic.id,
        patient_id=test_patient.id,
        document_type="other",
        title="QA",
        original_filename="qa.pdf",
        storage_path=f"qa/{uuid4()}.pdf",
        mime_type="application/pdf",
        file_size=1,
        uploaded_by=user_id,
    )
    db_session.add_all([appointment, treatment, plan, document])
    await db_session.flush()
    notes = [
        ClinicalNote(
            clinic_id=test_clinic.id,
            note_type="administrative",
            owner_type="patient",
            owner_id=test_patient.id,
            body="qa",
            author_id=user_id,
        ),
        ClinicalNote(
            clinic_id=test_clinic.id,
            note_type="appointment_clinical",
            owner_type="appointment",
            owner_id=appointment.id,
            body="qa",
            author_id=user_id,
        ),
        ClinicalNote(
            clinic_id=test_clinic.id,
            note_type="treatment",
            owner_type="treatment",
            owner_id=treatment.id,
            body="qa",
            author_id=user_id,
        ),
        ClinicalNote(
            clinic_id=test_clinic.id,
            note_type="treatment_plan",
            owner_type="plan",
            owner_id=plan.id,
            body="qa",
            author_id=user_id,
        ),
    ]
    attachment = MediaAttachment(
        clinic_id=test_clinic.id,
        document_id=document.id,
        owner_type="patient",
        owner_id=test_patient.id,
    )
    db_session.add_all([*notes, attachment])
    await db_session.commit()
    owner_ids = (test_patient.id, appointment.id, treatment.id, plan.id)
    assert await db_session.scalar(
        select(ClinicalNote.id).where(ClinicalNote.owner_id.in_(owner_ids))
    )
    assert await db_session.scalar(
        select(MediaAttachment.id).where(MediaAttachment.document_id == document.id)
    )
    response = await client.request(
        "DELETE",
        f"/api/v1/patients/{test_patient.id}/permanent",
        json={"confirmation": "ELIMINAR"},
        headers=headers,
    )
    assert response.status_code == 204
    assert (
        await db_session.scalar(select(ClinicalNote.id).where(ClinicalNote.owner_id.in_(owner_ids)))
        is None
    )
    assert (
        await db_session.scalar(
            select(MediaAttachment.id).where(MediaAttachment.document_id == document.id)
        )
        is None
    )


@pytest.mark.asyncio
async def test_cross_clinic_lifecycle_attempts_leave_related_rows_intact(
    client: AsyncClient, db_session: AsyncSession, test_clinic: Clinic, test_patient: Patient
) -> None:
    other = Clinic(id=uuid4(), name="Other QA", tax_id="B87654321", address={})
    db_session.add(other)
    await db_session.commit()
    headers = await _headers(db_session, test_clinic, "admin")
    user_id = await db_session.scalar(select(User.id).limit(1))
    patient = Patient(clinic_id=other.id, first_name="Other", last_name="Patient")
    db_session.add(patient)
    await db_session.flush()
    now = datetime.now(UTC)
    appointment = Appointment(
        clinic_id=other.id,
        patient_id=patient.id,
        professional_id=user_id,
        start_time=now,
        end_time=now + timedelta(minutes=30),
        status="scheduled",
    )
    treatment = Treatment(
        clinic_id=other.id,
        patient_id=patient.id,
        clinical_type="caries",
        scope="global_mouth",
        status="planned",
        recorded_at=now,
    )
    plan = TreatmentPlan(
        clinic_id=other.id,
        patient_id=patient.id,
        plan_number=f"QA-{uuid4()}",
        status="draft",
        created_by=user_id,
    )
    recall = Recall(
        clinic_id=other.id,
        patient_id=patient.id,
        due_month=now.date().replace(day=1),
        reason="checkup",
    )
    document = Document(
        clinic_id=other.id,
        patient_id=patient.id,
        document_type="other",
        title="QA",
        original_filename="qa.pdf",
        storage_path=f"qa/{uuid4()}.pdf",
        mime_type="application/pdf",
        file_size=1,
        uploaded_by=user_id,
    )
    db_session.add_all([appointment, treatment, plan, recall, document])
    await db_session.flush()
    attachment = MediaAttachment(
        clinic_id=other.id, document_id=document.id, owner_type="patient", owner_id=patient.id
    )
    note = ClinicalNote(
        clinic_id=other.id,
        note_type="administrative",
        owner_type="patient",
        owner_id=patient.id,
        body="qa",
        author_id=user_id,
    )
    db_session.add_all([attachment, note])
    await db_session.commit()
    models = (
        Patient,
        Appointment,
        Treatment,
        TreatmentPlan,
        Recall,
        Document,
        MediaAttachment,
        ClinicalNote,
    )
    before = [
        await db_session.scalar(select(model.id).where(model.id == row_id))
        for model, row_id in zip(
            models,
            (
                patient.id,
                appointment.id,
                treatment.id,
                plan.id,
                recall.id,
                document.id,
                attachment.id,
                note.id,
            ),
            strict=True,
        )
    ]
    assert all(before)
    assert (
        await client.post(f"/api/v1/patients/{patient.id}/restore", headers=headers)
    ).status_code == 404
    assert (
        await client.request(
            "DELETE",
            f"/api/v1/patients/{patient.id}/permanent",
            json={"confirmation": "ELIMINAR"},
            headers=headers,
        )
    ).status_code == 404
    after = [
        await db_session.scalar(select(model.id).where(model.id == row_id))
        for model, row_id in zip(
            models,
            (
                patient.id,
                appointment.id,
                treatment.id,
                plan.id,
                recall.id,
                document.id,
                attachment.id,
                note.id,
            ),
            strict=True,
        )
    ]
    assert before == after
    assert (
        await db_session.scalar(
            select(MediaPurgeOutbox.id).where(MediaPurgeOutbox.patient_id == patient.id)
        )
        is None
    )
