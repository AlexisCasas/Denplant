"""Focused coverage for the shared dentist patient-scope policy."""

from uuid import uuid4

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth.models import User
from app.core.auth.service import hash_password
from app.modules.patients.access import PatientAccessPolicy
from app.modules.patients.models import Patient


@pytest.mark.asyncio
async def test_creator_scope_blocks_other_dentist_and_keeps_admin_access(
    db_session: AsyncSession, test_clinic
) -> None:
    dentist_a = User(
        email="scope-dentist-a@example.com",
        password_hash=hash_password("TestPass1234"),
        first_name="Dentist",
        last_name="A",
    )
    dentist_b = User(
        email="scope-dentist-b@example.com",
        password_hash=hash_password("TestPass1234"),
        first_name="Dentist",
        last_name="B",
    )
    db_session.add_all([dentist_a, dentist_b])
    await db_session.flush()
    patient = Patient(
        id=uuid4(),
        clinic_id=test_clinic.id,
        first_name="Scoped",
        last_name="Patient",
        created_by_user_id=dentist_a.id,
    )
    db_session.add(patient)
    await db_session.commit()

    assert await PatientAccessPolicy.can_access_for(
        db_session, "dentist", test_clinic.id, dentist_a.id, patient.id
    )
    assert not await PatientAccessPolicy.can_access_for(
        db_session, "dentist", test_clinic.id, dentist_b.id, patient.id
    )
    assert await PatientAccessPolicy.can_access_for(
        db_session, "admin", test_clinic.id, dentist_b.id, patient.id
    )
