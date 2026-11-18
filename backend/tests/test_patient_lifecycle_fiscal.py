"""DP-33 fiscal preflight must reject permanent deletion before cleanup."""

from __future__ import annotations

from uuid import uuid4

import pytest
from httpx import AsyncClient
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth.models import Clinic, ClinicMembership, User
from app.core.auth.service import create_access_token, hash_password
from app.modules.billing.models import Invoice
from app.modules.patients.models import Patient, PatientPermanentDeletionAudit


async def _admin_headers(db: AsyncSession, clinic: Clinic) -> dict[str, str]:
    user = User(
        email=f"fiscal-{uuid4()}@example.test",
        password_hash=hash_password("TestPass1234"),
        first_name="Fiscal",
        last_name="Admin",
    )
    db.add(user)
    await db.flush()
    db.add(ClinicMembership(id=uuid4(), user_id=user.id, clinic_id=clinic.id, role="admin"))
    await db.commit()
    return {
        "Authorization": f"Bearer {create_access_token(user.id, token_version=user.token_version)}"
    }


@pytest.mark.asyncio
async def test_issued_invoice_blocks_permanent_delete_before_any_cleanup(
    client: AsyncClient,
    db_session: AsyncSession,
    test_clinic: Clinic,
    test_patient: Patient,
) -> None:
    user_id = await db_session.scalar(select(User.id).limit(1))
    invoice = Invoice(
        clinic_id=test_clinic.id,
        patient_id=test_patient.id,
        status="issued",
        invoice_number=f"FAC-{uuid4()}",
        created_by=user_id,
    )
    db_session.add(invoice)
    await db_session.commit()

    response = await client.request(
        "DELETE",
        f"/api/v1/patients/{test_patient.id}/permanent",
        json={"confirmation": "ELIMINAR"},
        headers=await _admin_headers(db_session, test_clinic),
    )

    assert response.status_code == 409
    assert await db_session.get(Patient, test_patient.id) is not None
    assert await db_session.get(Invoice, invoice.id) is not None
    assert (
        await db_session.scalar(
            select(func.count(PatientPermanentDeletionAudit.id)).where(
                PatientPermanentDeletionAudit.old_patient_id == test_patient.id
            )
        )
        == 0
    )
