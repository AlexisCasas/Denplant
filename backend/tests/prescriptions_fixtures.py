"""Shared fixtures and helpers for the prescriptions tests.

Imported explicitly by ``test_prescriptions_api.py`` and
``test_prescriptions_pdf.py`` (not registered in ``conftest.py`` on purpose).

``env`` builds two clinics, every role and a handful of patients; ``api`` is a
client whose ``get_db`` override behaves like the real one (commit when the
handler returns, rollback when it raises); ``inspect`` hands out independent
sessions for asserting - and attacking - what actually persisted.
"""

from datetime import UTC, date, datetime, timedelta
from types import SimpleNamespace
from uuid import uuid4
from zoneinfo import ZoneInfo

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool

from app.core.auth.models import Clinic, ClinicMembership, User
from app.core.auth.service import create_access_token, hash_password
from app.database import get_db
from app.main import app
from app.modules.agenda.models import Appointment
from app.modules.patients.models import Patient
from tests import db_isolation

BASE = "/api/v1/prescriptions"
LIMA = ZoneInfo("America/Lima")
DOB = date(1990, 5, 17)

ITEM = {
    "active_ingredient": "Amoxicilina",
    "strength": "500 mg",
    "pharmaceutical_form": "Cápsula",
    "dose": "1 cápsula",
    "route": "Oral",
    "frequency": "Cada 8 horas",
    "duration": "7 días",
    "total_quantity": "21 cápsulas",
}
REQUIRED_FIELDS = tuple(ITEM)


def _headers(user: User) -> dict[str, str]:
    token = create_access_token(user.id, token_version=user.token_version)
    return {"Authorization": f"Bearer {token}"}


def _valid_until() -> str:
    return (datetime.now(UTC) + timedelta(days=30)).date().isoformat()


def _body(patient, items=None, **overrides) -> dict:
    body = {
        "patient_id": str(patient),
        "valid_until": _valid_until(),
        "items": items if items is not None else [dict(ITEM)],
    }
    body.update(overrides)
    return body


async def _user(db: AsyncSession, name: str, professional_id: str | None) -> User:
    user = User(
        id=uuid4(),
        email=f"rx-{name}-{uuid4().hex[:6]}@example.com",
        password_hash=hash_password("TestPass1234"),
        first_name=name.capitalize(),
        last_name="Tester",
        professional_id=professional_id,
    )
    db.add(user)
    await db.flush()
    return user


def _patient(clinic_id, name: str, created_by=None, dob: date | None = DOB, **extra) -> Patient:
    return Patient(
        id=uuid4(),
        clinic_id=clinic_id,
        first_name=name,
        last_name="Paciente",
        status="active",
        preferred_language="es",
        do_not_contact=False,
        date_of_birth=dob,
        created_by_user_id=created_by,
        **extra,
    )


@pytest.fixture
async def env(db_session: AsyncSession):
    """Two clinics; in the first, every role and a handful of patients."""
    clinic = Clinic(
        id=uuid4(),
        name="Clínica Sonrisa",
        legal_name="Sonrisa S.A.C.",
        tax_id="20123456789",
        address={
            "street": "Av. Larco 123",
            "city": "Lima",
            "postal_code": "15074",
            "country": "Perú",
        },
        phone="+51 1 555 0100",
        timezone="America/Lima",
        settings={},
    )
    other_clinic = Clinic(
        id=uuid4(), name="Otra", tax_id="B2", settings={}, timezone="America/Lima"
    )
    db_session.add_all([clinic, other_clinic])
    await db_session.flush()

    dentist = await _user(db_session, "dentist", "COP-111")
    dentist2 = await _user(db_session, "dentist2", "COP-222")
    dentist_unregistered = await _user(db_session, "unreg", None)
    dentist_blank = await _user(db_session, "blank", "   ")
    admin = await _user(db_session, "admin", "COP-ADM")
    hygienist = await _user(db_session, "hygienist", "COP-HYG")
    assistant = await _user(db_session, "assistant", "COP-AST")
    receptionist = await _user(db_session, "receptionist", None)
    outsider = await _user(db_session, "outsider", "COP-OUT")
    other_dentist = await _user(db_session, "otherdentist", "COP-OTH")

    def member(user, role, clinic_id=clinic.id, **kw):
        return ClinicMembership(id=uuid4(), user_id=user.id, clinic_id=clinic_id, role=role, **kw)

    db_session.add_all(
        [
            member(dentist, "dentist"),
            member(dentist2, "dentist"),
            member(dentist_unregistered, "dentist"),
            member(dentist_blank, "dentist"),
            # An admin who is also flagged a professional and holds a number:
            # still not allowed to issue.
            member(admin, "admin", is_professional=True),
            member(hygienist, "hygienist"),
            member(assistant, "assistant"),
            member(receptionist, "receptionist"),
            member(outsider, "admin", other_clinic.id),
            member(other_dentist, "dentist", other_clinic.id),
        ]
    )

    patient = _patient(
        clinic.id, "Mio", created_by=dentist.id, national_id="45678912", national_id_type="dni"
    )
    # Reachable by both dentists: one created it, the other has an appointment.
    shared = _patient(clinic.id, "Compartido", created_by=dentist.id)
    no_dob = _patient(clinic.id, "SinFecha", created_by=dentist.id, dob=None)
    other_patient = _patient(other_clinic.id, "Ajeno", created_by=other_dentist.id)
    # Created by the unregistered dentists, so the registration check is what fails.
    unreg_patient = _patient(clinic.id, "DeSinColegiatura", created_by=dentist_unregistered.id)
    blank_patient = _patient(clinic.id, "DeBlanco", created_by=dentist_blank.id)
    db_session.add_all([patient, shared, no_dob, other_patient, unreg_patient, blank_patient])
    await db_session.flush()

    start = datetime.now(UTC) + timedelta(days=1)
    db_session.add(
        Appointment(
            id=uuid4(),
            clinic_id=clinic.id,
            patient_id=shared.id,
            professional_id=dentist2.id,
            start_time=start,
            end_time=start + timedelta(minutes=30),
            status="scheduled",
        )
    )
    await db_session.commit()

    return SimpleNamespace(
        clinic=clinic.id,
        other_clinic=other_clinic.id,
        patient=patient.id,
        shared=shared.id,
        no_dob=no_dob.id,
        other_patient=other_patient.id,
        unreg_patient=unreg_patient.id,
        blank_patient=blank_patient.id,
        dentist_id=dentist.id,
        dentist2_id=dentist2.id,
        admin_id=admin.id,
        dentist=_headers(dentist),
        dentist2=_headers(dentist2),
        unregistered=_headers(dentist_unregistered),
        blank=_headers(dentist_blank),
        admin=_headers(admin),
        hygienist=_headers(hygienist),
        assistant=_headers(assistant),
        receptionist=_headers(receptionist),
        outsider=_headers(outsider),
        other_dentist=_headers(other_dentist),
    )


@pytest.fixture
async def api(env):
    """A client whose get_db mirrors the production dependency."""
    engine = create_async_engine(db_isolation.TEST_DATABASE_URL, echo=False, poolclass=NullPool)
    maker = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

    async def override_get_db():
        async with maker() as session:
            try:
                yield session
                await session.commit()
            except Exception:
                await session.rollback()
                raise
            finally:
                await session.close()

    app.dependency_overrides[get_db] = override_get_db
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac
    app.dependency_overrides.clear()
    await engine.dispose()


@pytest.fixture
async def inspect():
    """An independent session for asserting (and attacking) what persisted."""
    engine = create_async_engine(db_isolation.TEST_DATABASE_URL, echo=False, poolclass=NullPool)
    maker = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    sessions: list[AsyncSession] = []

    def factory() -> AsyncSession:
        session = maker()
        sessions.append(session)
        return session

    yield factory
    for session in sessions:
        await session.close()
    await engine.dispose()


async def _issue(api, env, headers=None, patient=None, **overrides) -> dict:
    response = await api.post(
        BASE,
        headers=headers or env.dentist,
        json=_body(patient or env.patient, **overrides),
    )
    assert response.status_code == 201, response.text
    return response.json()["data"]


async def _get(api, headers, prescription_id):
    return await api.get(f"{BASE}/{prescription_id}", headers=headers)
