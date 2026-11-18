"""The `patient.archived` → document soft-archive cascade (audit #95, #183).

Two regressions are covered:

* the publisher must include ``clinic_id`` in the payload (it didn't);
* the cascade must actually run and be atomic with the archive.

The handler used to open its own ``async_session_maker`` session, which made
the end-to-end path untestable (the session is bound to the import-time event
loop) *and* non-atomic: it committed the archived documents even when the
request that archived the patient rolled back. It is transactional now
(ADR 0019), so both are covered here.
"""

from __future__ import annotations

from datetime import UTC, date, datetime, timedelta
from uuid import uuid4

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth.models import Clinic, User
from app.core.events import EventType, event_bus
from app.modules.agenda.models import Appointment
from app.modules.media.models import Document, MediaPurgeOutbox
from app.modules.media.service import DocumentService
from app.modules.odontogram.models import OdontogramHistory, ToothRecord, Treatment
from app.modules.patients.models import Patient, PatientPermanentDeletionAudit
from app.modules.patients.service import PatientService
from app.modules.recalls.models import Recall


async def _document(db: AsyncSession, clinic: Clinic, patient: Patient) -> Document:
    user_id = (await db.execute(select(User))).scalars().first().id
    doc = Document(
        clinic_id=clinic.id,
        patient_id=patient.id,
        document_type="other",
        title="Consentimiento",
        original_filename="consent.pdf",
        storage_path=f"/tmp/{uuid4()}.pdf",
        mime_type="application/pdf",
        file_size=1024,
        uploaded_by=user_id,
    )
    db.add(doc)
    await db.flush()
    return doc


@pytest.mark.asyncio
async def test_archive_patient_payload_includes_clinic_id(
    test_clinic: Clinic,
    test_patient: Patient,
    db_session: AsyncSession,
) -> None:
    captured: list[dict] = []

    async def _spy(data: dict) -> None:
        captured.append(data)

    event_bus.subscribe(EventType.PATIENT_ARCHIVED, _spy)
    try:
        await PatientService.archive_patient(db_session, test_patient)
    finally:
        event_bus.unsubscribe(EventType.PATIENT_ARCHIVED, _spy)

    assert captured, "patient.archived was not published"
    assert captured[0]["patient_id"] == str(test_patient.id)
    assert captured[0]["clinic_id"] == str(test_clinic.id)


@pytest.mark.asyncio
async def test_archiving_a_patient_archives_their_documents(
    test_clinic: Clinic,
    test_patient: Patient,
    db_session: AsyncSession,
) -> None:
    doc = await _document(db_session, test_clinic, test_patient)

    await PatientService.archive_patient(db_session, test_patient)

    await db_session.refresh(doc)
    assert doc.status == "archived"


@pytest.mark.asyncio
async def test_cascade_rolls_back_with_the_archive(
    test_clinic: Clinic,
    test_patient: Patient,
    db_session: AsyncSession,
) -> None:
    """The cascade runs on the publisher's session, so an archive that never
    commits leaves the documents alone. On its own session the handler
    committed them regardless (issue #183)."""
    doc = await _document(db_session, test_clinic, test_patient)
    await db_session.commit()
    # A rollback expires every mapped instance, so reading an attribute off
    # one afterwards would lazy-load outside the async context. Keep the ids.
    doc_id, patient_id = doc.id, test_patient.id

    await PatientService.archive_patient(db_session, test_patient)
    await db_session.rollback()

    doc_status = await db_session.scalar(select(Document.status).where(Document.id == doc_id))
    patient_status = await db_session.scalar(select(Patient.status).where(Patient.id == patient_id))
    assert doc_status == "active"
    assert patient_status != "archived"


@pytest.mark.asyncio
async def test_restoring_patient_restores_lifecycle_archived_documents(
    test_clinic: Clinic,
    test_patient: Patient,
    db_session: AsyncSession,
) -> None:
    doc = await _document(db_session, test_clinic, test_patient)
    actor = (await db_session.execute(select(User))).scalars().first()
    await PatientService.archive_patient(db_session, test_patient, archived_by=actor.id)
    await PatientService.restore_patient(db_session, test_patient, restored_by=actor.id)
    await db_session.refresh(doc)
    assert test_patient.status == "active"
    assert doc.status == "active"
    assert doc.archived_by_patient is False


@pytest.mark.asyncio
async def test_restore_uses_legacy_document_fallback_when_no_marker_exists(
    test_clinic: Clinic,
    test_patient: Patient,
    db_session: AsyncSession,
) -> None:
    doc = await _document(db_session, test_clinic, test_patient)
    doc.status = "archived"
    doc.archived_by_patient = False

    restored = await DocumentService.restore_patient_documents(
        db_session, test_clinic.id, test_patient.id
    )

    assert restored == 1
    assert doc.status == "active"


@pytest.mark.asyncio
async def test_permanent_delete_queues_original_and_derivatives_and_keeps_audit(
    test_clinic: Clinic,
    test_patient: Patient,
    db_session: AsyncSession,
) -> None:
    doc = await _document(db_session, test_clinic, test_patient)
    actor = (await db_session.execute(select(User))).scalars().first()
    patient_id = test_patient.id
    storage_path = doc.storage_path

    await PatientService.permanently_delete_patient(db_session, test_patient, deleted_by=actor.id)
    await db_session.commit()

    assert await db_session.get(Patient, patient_id) is None
    audit = await db_session.scalar(
        select(PatientPermanentDeletionAudit).where(
            PatientPermanentDeletionAudit.old_patient_id == patient_id
        )
    )
    assert audit is not None
    rows = list((await db_session.execute(select(MediaPurgeOutbox))).scalars())
    assert {row.storage_path for row in rows} == {
        storage_path,
        f"{storage_path}.thumb.jpg",
        f"{storage_path}.medium.jpg",
    }
    assert {row.status for row in rows} == {"pending"}


@pytest.mark.asyncio
async def test_purge_outbox_retries_failed_storage_deletes(
    test_clinic: Clinic,
    test_patient: Patient,
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    class FailingStorage:
        async def delete(self, path: str) -> None:
            raise OSError(f"unavailable: {path}")

    row = MediaPurgeOutbox(
        storage_path=f"test/{uuid4()}.pdf",
        clinic_id=test_clinic.id,
        patient_id=test_patient.id,
    )
    db_session.add(row)
    await db_session.flush()
    monkeypatch.setattr("app.modules.media.service.get_storage_backend", lambda: FailingStorage())

    assert await DocumentService.process_purge_outbox(db_session) == 0
    assert row.status == "failed"
    assert row.attempts == 1
    assert row.last_error is not None

    deleted: list[str] = []

    class WorkingStorage:
        async def delete(self, path: str) -> None:
            deleted.append(path)

    monkeypatch.setattr("app.modules.media.service.get_storage_backend", lambda: WorkingStorage())
    assert await DocumentService.process_purge_outbox(db_session) == 1
    assert deleted == [row.storage_path]
    assert row.status == "processed"
    assert row.attempts == 2
    assert row.processed_at is not None


@pytest.mark.asyncio
async def test_permanent_delete_rolls_back_when_a_transactional_handler_fails(
    test_clinic: Clinic,
    test_patient: Patient,
    db_session: AsyncSession,
) -> None:
    actor = (await db_session.execute(select(User))).scalars().first()
    patient_id = test_patient.id

    async def failing_handler(data: dict, *, db: AsyncSession) -> None:
        raise RuntimeError("injected deletion failure")

    event_bus.subscribe(EventType.PATIENT_PERMANENT_DELETE_REQUESTED, failing_handler)
    try:
        with pytest.raises(RuntimeError, match="injected deletion failure"):
            await PatientService.permanently_delete_patient(
                db_session, test_patient, deleted_by=actor.id
            )
    finally:
        event_bus.unsubscribe(EventType.PATIENT_PERMANENT_DELETE_REQUESTED, failing_handler)

    await db_session.rollback()
    assert await db_session.get(Patient, patient_id) is not None
    assert (
        await db_session.scalar(
            select(PatientPermanentDeletionAudit.id).where(
                PatientPermanentDeletionAudit.old_patient_id == patient_id
            )
        )
        is None
    )


@pytest.mark.asyncio
async def test_permanent_delete_removes_patient_owned_and_polymorphic_rows(
    test_clinic: Clinic,
    test_patient: Patient,
    db_session: AsyncSession,
) -> None:
    """Exercise representative FK and owner-id cleanup in one transaction."""
    actor = (await db_session.execute(select(User))).scalars().first()
    now = datetime.now(UTC)
    appointment = Appointment(
        clinic_id=test_clinic.id,
        patient_id=test_patient.id,
        professional_id=actor.id,
        start_time=now,
        end_time=now + timedelta(minutes=30),
        status="scheduled",
    )
    tooth = ToothRecord(
        clinic_id=test_clinic.id,
        patient_id=test_patient.id,
        tooth_number=11,
        tooth_type="permanent",
    )
    treatment = Treatment(
        clinic_id=test_clinic.id,
        patient_id=test_patient.id,
        clinical_type="caries",
        scope="global_mouth",
        status="planned",
        recorded_at=now,
    )
    history = OdontogramHistory(
        clinic_id=test_clinic.id,
        patient_id=test_patient.id,
        tooth_number=11,
        change_type="created",
        changed_by=actor.id,
        changed_at=now,
    )
    recall = Recall(
        clinic_id=test_clinic.id,
        patient_id=test_patient.id,
        due_month=date.today().replace(day=1),
        reason="checkup",
    )
    db_session.add_all([appointment, tooth, treatment, history, recall])
    document = await _document(db_session, test_clinic, test_patient)
    await db_session.commit()
    patient_id = test_patient.id
    ids = (appointment.id, tooth.id, treatment.id, history.id, recall.id, document.id)

    await PatientService.permanently_delete_patient(db_session, test_patient, deleted_by=actor.id)
    await db_session.commit()

    assert await db_session.get(Patient, patient_id) is None
    for model, row_id in zip(
        (Appointment, ToothRecord, Treatment, OdontogramHistory, Recall, Document), ids, strict=True
    ):
        assert await db_session.scalar(select(model.id).where(model.id == row_id)) is None
    assert (
        await db_session.scalar(
            select(PatientPermanentDeletionAudit.id).where(
                PatientPermanentDeletionAudit.old_patient_id == patient_id
            )
        )
        is not None
    )


@pytest.mark.asyncio
async def test_permanent_delete_deep_rollback_restores_prior_handler_deletes(
    test_clinic: Clinic,
    test_patient: Patient,
    db_session: AsyncSession,
) -> None:
    """A late transactional failure restores rows deleted by earlier phases."""
    actor = (await db_session.execute(select(User))).scalars().first()
    now = datetime.now(UTC)
    appointment = Appointment(
        clinic_id=test_clinic.id,
        patient_id=test_patient.id,
        professional_id=actor.id,
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
    db_session.add_all([appointment, treatment])
    document = await _document(db_session, test_clinic, test_patient)
    await db_session.commit()
    patient_id, appointment_id, treatment_id, document_id = (
        test_patient.id,
        appointment.id,
        treatment.id,
        document.id,
    )

    async def fail_late(data: dict, *, db: AsyncSession) -> None:
        if data.get("phase") == "clinical":
            raise RuntimeError("late DP-33 rollback probe")

    event_bus.subscribe(EventType.PATIENT_PERMANENT_DELETE_REQUESTED, fail_late)
    try:
        with pytest.raises(RuntimeError, match="late DP-33 rollback probe"):
            await PatientService.permanently_delete_patient(
                db_session, test_patient, deleted_by=actor.id
            )
    finally:
        event_bus.unsubscribe(EventType.PATIENT_PERMANENT_DELETE_REQUESTED, fail_late)
    await db_session.rollback()

    for model, row_id in zip(
        (Patient, Appointment, Treatment, Document),
        (patient_id, appointment_id, treatment_id, document_id),
        strict=True,
    ):
        assert await db_session.scalar(select(model.id).where(model.id == row_id)) == row_id
    assert (
        await db_session.scalar(
            select(PatientPermanentDeletionAudit.id).where(
                PatientPermanentDeletionAudit.old_patient_id == patient_id
            )
        )
        is None
    )
    assert (
        await db_session.scalar(
            select(MediaPurgeOutbox.id).where(MediaPurgeOutbox.patient_id == patient_id)
        )
        is None
    )
