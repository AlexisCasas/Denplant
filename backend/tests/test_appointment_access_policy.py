"""PostgreSQL coverage for dentist appointment ownership."""

from datetime import UTC, datetime, timedelta
from uuid import uuid4

import pytest

from app.core.auth.models import User
from app.core.auth.service import hash_password
from app.modules.agenda.access import AppointmentAccessPolicy
from app.modules.agenda.models import Appointment


@pytest.mark.asyncio
async def test_dentist_only_sees_their_assigned_appointments(db_session, test_clinic) -> None:
    dentist_a = User(
        email="appointment-scope-a@example.com",
        password_hash=hash_password("TestPass1234"),
        first_name="Dentist",
        last_name="A",
    )
    dentist_b = User(
        email="appointment-scope-b@example.com",
        password_hash=hash_password("TestPass1234"),
        first_name="Dentist",
        last_name="B",
    )
    db_session.add_all([dentist_a, dentist_b])
    await db_session.flush()
    start = datetime.now(UTC) + timedelta(days=1)
    appointment_a = Appointment(
        id=uuid4(),
        clinic_id=test_clinic.id,
        professional_id=dentist_a.id,
        start_time=start,
        end_time=start + timedelta(minutes=30),
        status="scheduled",
    )
    appointment_b = Appointment(
        id=uuid4(),
        clinic_id=test_clinic.id,
        professional_id=dentist_b.id,
        start_time=start + timedelta(hours=1),
        end_time=start + timedelta(hours=1, minutes=30),
        status="completed",
    )
    db_session.add_all([appointment_a, appointment_b])
    await db_session.commit()

    assert await AppointmentAccessPolicy.can_access_for(
        db_session, "dentist", test_clinic.id, dentist_a.id, appointment_a.id
    )
    assert not await AppointmentAccessPolicy.can_access_for(
        db_session, "dentist", test_clinic.id, dentist_a.id, appointment_b.id
    )
    assert await AppointmentAccessPolicy.can_access_for(
        db_session, "admin", test_clinic.id, dentist_a.id, appointment_b.id
    )
