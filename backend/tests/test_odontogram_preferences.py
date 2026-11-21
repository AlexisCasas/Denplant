"""NTS-01 — per-user, per-clinic odontogram profile preference.

Covers the whole contract of ``/api/v1/odontogram/preferences``:

- absence of a row means ``original`` and reading never creates one;
- a user can only ever read/write *their own* preference for the clinic
  they are authenticated against (``user_id`` / ``clinic_id`` come from
  ``ClinicContext``, never from the payload);
- the preference is isolated per user AND per clinic;
- unsupported profiles are rejected by schema validation.
"""

from __future__ import annotations

from uuid import uuid4

import pytest
from httpx import AsyncClient
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth.models import Clinic, ClinicMembership, User
from app.core.auth.service import create_access_token, hash_password
from app.modules.odontogram.models import OdontogramUserPreference

PREFERENCES_URL = "/api/v1/odontogram/preferences"


def _headers(user: User) -> dict[str, str]:
    token = create_access_token(user.id, token_version=user.token_version)
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
async def pref_world(
    db_session: AsyncSession, auth_headers: dict[str, str], client: AsyncClient
) -> dict:
    """Two clinics, three users.

    - ``user1`` (the ``auth_headers`` user): member of clinic A *and* B.
    - ``user2``: member of clinic A only.
    - ``outsider``: member of no clinic at all.
    """
    me = await client.get("/api/v1/auth/me", headers=auth_headers)
    user1_id = me.json()["data"]["user"]["id"]

    clinic_a = Clinic(
        id=uuid4(),
        name="Clinica A",
        tax_id="B11111111",
        address={"street": "A", "city": "Lima"},
        settings={},
    )
    clinic_b = Clinic(
        id=uuid4(),
        name="Clinica B",
        tax_id="B22222222",
        address={"street": "B", "city": "Lima"},
        settings={},
    )
    db_session.add_all([clinic_a, clinic_b])
    await db_session.flush()

    user2 = User(
        id=uuid4(),
        email="odonto-pref-user2@test.clinic",
        password_hash=hash_password("TestPass1234"),
        first_name="Segunda",
        last_name="Usuaria",
        is_active=True,
    )
    outsider = User(
        id=uuid4(),
        email="odonto-pref-outsider@test.clinic",
        password_hash=hash_password("TestPass1234"),
        first_name="Sin",
        last_name="Clinica",
        is_active=True,
    )
    db_session.add_all([user2, outsider])

    db_session.add_all(
        [
            ClinicMembership(
                id=uuid4(), user_id=user1_id, clinic_id=clinic_a.id, role="dentist"
            ),
            ClinicMembership(
                id=uuid4(), user_id=user1_id, clinic_id=clinic_b.id, role="dentist"
            ),
            ClinicMembership(
                id=uuid4(), user_id=user2.id, clinic_id=clinic_a.id, role="dentist"
            ),
        ]
    )
    await db_session.commit()

    return {
        "clinic_a": str(clinic_a.id),
        "clinic_b": str(clinic_b.id),
        "user1_id": user1_id,
        "user1_headers": auth_headers,
        "user2_headers": _headers(user2),
        "outsider_headers": _headers(outsider),
    }


# ---------------------------------------------------------------------------
# A — default is `original`, and reading does not create a row
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_get_without_row_returns_original_and_creates_nothing(
    client: AsyncClient, db_session: AsyncSession, pref_world: dict
):
    world = pref_world

    resp = await client.get(
        f"{PREFERENCES_URL}?clinic_id={world['clinic_a']}",
        headers=world["user1_headers"],
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["data"]["profile"] == "original"

    # The read must be non-destructive: no row materialised.
    count = await db_session.scalar(select(func.count()).select_from(OdontogramUserPreference))
    assert count == 0


# ---------------------------------------------------------------------------
# B — switching to the MINSA profile persists
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_put_sets_nts_profile(client: AsyncClient, pref_world: dict):
    world = pref_world

    put = await client.put(
        f"{PREFERENCES_URL}?clinic_id={world['clinic_a']}",
        headers=world["user1_headers"],
        json={"profile": "pe_nts_188_2022"},
    )
    assert put.status_code == 200, put.text
    assert put.json()["data"]["profile"] == "pe_nts_188_2022"

    get = await client.get(
        f"{PREFERENCES_URL}?clinic_id={world['clinic_a']}",
        headers=world["user1_headers"],
    )
    assert get.status_code == 200
    assert get.json()["data"]["profile"] == "pe_nts_188_2022"


# ---------------------------------------------------------------------------
# C — switching back to `original` persists too (upsert, not insert-only)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_put_back_to_original(
    client: AsyncClient, db_session: AsyncSession, pref_world: dict
):
    world = pref_world
    url = f"{PREFERENCES_URL}?clinic_id={world['clinic_a']}"

    await client.put(url, headers=world["user1_headers"], json={"profile": "pe_nts_188_2022"})
    back = await client.put(url, headers=world["user1_headers"], json={"profile": "original"})
    assert back.status_code == 200, back.text
    assert back.json()["data"]["profile"] == "original"

    get = await client.get(url, headers=world["user1_headers"])
    assert get.json()["data"]["profile"] == "original"

    # Upsert, not a second row.
    count = await db_session.scalar(select(func.count()).select_from(OdontogramUserPreference))
    assert count == 1


# ---------------------------------------------------------------------------
# D — unsupported profile is rejected
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_invalid_profile_is_rejected(
    client: AsyncClient, db_session: AsyncSession, pref_world: dict
):
    world = pref_world

    resp = await client.put(
        f"{PREFERENCES_URL}?clinic_id={world['clinic_a']}",
        headers=world["user1_headers"],
        json={"profile": "pe_nts_999_9999"},
    )
    assert resp.status_code == 422, resp.text

    count = await db_session.scalar(select(func.count()).select_from(OdontogramUserPreference))
    assert count == 0


# ---------------------------------------------------------------------------
# E — isolation per user inside the same clinic
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_preference_is_isolated_per_user(client: AsyncClient, pref_world: dict):
    world = pref_world
    url = f"{PREFERENCES_URL}?clinic_id={world['clinic_a']}"

    u1 = await client.put(
        url, headers=world["user1_headers"], json={"profile": "pe_nts_188_2022"}
    )
    assert u1.status_code == 200, u1.text

    # user2 is in the same clinic and must be unaffected.
    u2_get = await client.get(url, headers=world["user2_headers"])
    assert u2_get.status_code == 200
    assert u2_get.json()["data"]["profile"] == "original"

    u2_put = await client.put(url, headers=world["user2_headers"], json={"profile": "original"})
    assert u2_put.status_code == 200

    u1_again = await client.get(url, headers=world["user1_headers"])
    assert u1_again.json()["data"]["profile"] == "pe_nts_188_2022"


# ---------------------------------------------------------------------------
# F — isolation per clinic for the same user
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_preference_is_isolated_per_clinic(client: AsyncClient, pref_world: dict):
    world = pref_world
    url_a = f"{PREFERENCES_URL}?clinic_id={world['clinic_a']}"
    url_b = f"{PREFERENCES_URL}?clinic_id={world['clinic_b']}"

    set_a = await client.put(
        url_a, headers=world["user1_headers"], json={"profile": "pe_nts_188_2022"}
    )
    assert set_a.status_code == 200, set_a.text

    # Same user, other clinic: still the default.
    get_b = await client.get(url_b, headers=world["user1_headers"])
    assert get_b.status_code == 200
    assert get_b.json()["data"]["profile"] == "original"

    set_b = await client.put(url_b, headers=world["user1_headers"], json={"profile": "original"})
    assert set_b.status_code == 200

    assert (
        (await client.get(url_a, headers=world["user1_headers"])).json()["data"]["profile"]
        == "pe_nts_188_2022"
    )
    assert (
        (await client.get(url_b, headers=world["user1_headers"])).json()["data"]["profile"]
        == "original"
    )


# ---------------------------------------------------------------------------
# G — no membership, no access (existing ClinicContext protections)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_non_member_cannot_read_or_write_that_clinic(
    client: AsyncClient, pref_world: dict
):
    world = pref_world
    url_b = f"{PREFERENCES_URL}?clinic_id={world['clinic_b']}"

    # user2 belongs to clinic A only.
    assert (await client.get(url_b, headers=world["user2_headers"])).status_code == 403
    put = await client.put(
        url_b, headers=world["user2_headers"], json={"profile": "pe_nts_188_2022"}
    )
    assert put.status_code == 403

    # A user with no membership anywhere is rejected as well.
    assert (
        await client.get(PREFERENCES_URL, headers=world["outsider_headers"])
    ).status_code == 403
    assert (
        await client.put(
            PREFERENCES_URL,
            headers=world["outsider_headers"],
            json={"profile": "original"},
        )
    ).status_code == 403


@pytest.mark.asyncio
async def test_payload_cannot_target_another_user_or_clinic(
    client: AsyncClient, db_session: AsyncSession, pref_world: dict
):
    """Extra ids in the body are ignored — context wins."""
    world = pref_world

    resp = await client.put(
        f"{PREFERENCES_URL}?clinic_id={world['clinic_a']}",
        headers=world["user2_headers"],
        json={
            "profile": "pe_nts_188_2022",
            "user_id": world["user1_id"],
            "clinic_id": world["clinic_b"],
        },
    )
    assert resp.status_code == 200, resp.text

    rows = (await db_session.execute(select(OdontogramUserPreference))).scalars().all()
    assert len(rows) == 1
    assert str(rows[0].clinic_id) == world["clinic_a"]
    assert str(rows[0].user_id) != world["user1_id"]
