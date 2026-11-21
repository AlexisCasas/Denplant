"""Professional registration management through the clinic user endpoints."""

from __future__ import annotations

from uuid import uuid4

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth.models import Clinic, ClinicMembership, User
from app.core.auth.service import create_access_token, hash_password

USERS = "/api/v1/auth/users"


def _payload(**overrides: object) -> dict[str, object]:
    return {
        "email": f"dentist-{uuid4().hex[:10]}@example.com",
        "password": "TestPass1234",
        "first_name": "Ada",
        "last_name": "Dentist",
        "role": "dentist",
        **overrides,
    }


async def _create(client: AsyncClient, headers: dict[str, str], **overrides: object) -> dict:
    response = await client.post(USERS, json=_payload(**overrides), headers=headers)
    assert response.status_code == 201, response.text
    return response.json()["data"]


@pytest.mark.asyncio
async def test_create_normalizes_registration_and_exposes_it_in_the_clinic_list(
    client: AsyncClient, auth_headers: dict[str, str], test_clinic: Clinic
) -> None:
    user = await _create(client, auth_headers, professional_id="  COL-123  ")

    assert user["professional_id"] == "COL-123"
    listed = await client.get(USERS, headers=auth_headers)
    assert listed.status_code == 200
    row = next(item for item in listed.json()["data"] if item["id"] == user["id"])
    assert row["professional_id"] == "COL-123"


@pytest.mark.asyncio
async def test_create_without_registration_keeps_it_null(
    client: AsyncClient, auth_headers: dict[str, str], test_clinic: Clinic
) -> None:
    user = await _create(client, auth_headers)

    assert user["professional_id"] is None


@pytest.mark.asyncio
async def test_update_registration_distinguishes_omitted_value_and_explicit_clear(
    client: AsyncClient, auth_headers: dict[str, str], test_clinic: Clinic
) -> None:
    user = await _create(client, auth_headers, professional_id="COL-100")

    omitted = await client.put(
        f"{USERS}/{user['id']}", json={"first_name": "Grace"}, headers=auth_headers
    )
    assert omitted.status_code == 200
    assert omitted.json()["data"]["professional_id"] == "COL-100"

    changed = await client.put(
        f"{USERS}/{user['id']}", json={"professional_id": "  COL-200  "}, headers=auth_headers
    )
    assert changed.status_code == 200
    assert changed.json()["data"]["professional_id"] == "COL-200"

    for clear_value in ("", "   ", None):
        cleared = await client.put(
            f"{USERS}/{user['id']}", json={"professional_id": clear_value}, headers=auth_headers
        )
        assert cleared.status_code == 200
        assert cleared.json()["data"]["professional_id"] is None
        if clear_value is not None:
            restored = await client.put(
                f"{USERS}/{user['id']}", json={"professional_id": "COL-200"}, headers=auth_headers
            )
            assert restored.status_code == 200


@pytest.mark.asyncio
async def test_registration_rejects_values_longer_than_fifty_characters(
    client: AsyncClient, auth_headers: dict[str, str], test_clinic: Clinic
) -> None:
    too_long = "X" * 51
    create = await client.post(USERS, json=_payload(professional_id=too_long), headers=auth_headers)
    assert create.status_code == 422

    user = await _create(client, auth_headers)
    update = await client.put(
        f"{USERS}/{user['id']}", json={"professional_id": too_long}, headers=auth_headers
    )
    assert update.status_code == 422


@pytest.mark.asyncio
async def test_registration_update_requires_admin_permission_and_current_clinic_membership(
    client: AsyncClient,
    auth_headers: dict[str, str],
    test_clinic: Clinic,
    db_session: AsyncSession,
) -> None:
    target = await _create(client, auth_headers)
    staff = User(
        email=f"staff-{uuid4().hex[:10]}@example.com",
        password_hash=hash_password("TestPass1234"),
        first_name="Reception",
        last_name="Staff",
    )
    db_session.add(staff)
    await db_session.flush()
    db_session.add(
        ClinicMembership(user_id=staff.id, clinic_id=test_clinic.id, role="receptionist")
    )
    outsider = User(
        email=f"outside-{uuid4().hex[:10]}@example.com",
        password_hash=hash_password("TestPass1234"),
        first_name="Outside",
        last_name="User",
    )
    db_session.add(outsider)
    await db_session.commit()

    staff_headers = {
        "Authorization": f"Bearer {create_access_token(staff.id, token_version=staff.token_version)}"
    }
    forbidden = await client.put(
        f"{USERS}/{target['id']}", json={"professional_id": "COL-300"}, headers=staff_headers
    )
    assert forbidden.status_code == 403

    not_in_clinic = await client.put(
        f"{USERS}/{outsider.id}", json={"professional_id": "COL-300"}, headers=auth_headers
    )
    assert not_in_clinic.status_code == 404
