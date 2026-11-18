"""Contract tests for additive reusable prescription medication shortcuts."""

import pytest

pytest_plugins = ("tests.prescriptions_fixtures",)


BASE = "/api/v1/prescriptions"
MEDICATION = {
    "active_ingredient": "Paracetamol",
    "commercial_name": "Panadol",
    "strength": "500 mg",
    "pharmaceutical_form": "Tableta",
    "presentation": "Caja x 20",
    "default_route": "Oral",
}


@pytest.mark.asyncio
async def test_favorites_are_idempotent_private_and_searchable(api, env):
    assert (await api.get(f"{BASE}/medication-favorites", headers=env.dentist)).json()["data"] == []

    first = await api.post(f"{BASE}/medication-favorites", headers=env.dentist, json=MEDICATION)
    assert first.status_code == 200
    saved = first.json()["data"]
    assert saved["favorite_id"]

    duplicate = await api.post(f"{BASE}/medication-favorites", headers=env.dentist, json=MEDICATION)
    assert duplicate.status_code == 200
    assert duplicate.json()["data"]["favorite_id"] == saved["favorite_id"]

    mine = await api.get(f"{BASE}/medication-favorites", headers=env.dentist)
    assert len(mine.json()["data"]) == 1
    assert (await api.get(f"{BASE}/medication-favorites", headers=env.dentist2)).json()[
        "data"
    ] == []

    search = await api.get(f"{BASE}/medications/search?q=panadol", headers=env.dentist)
    assert search.status_code == 200
    assert search.json()["data"][0]["active_ingredient"] == "Paracetamol"
    assert search.json()["data"][0]["favorite_id"] == saved["favorite_id"]

    assert (await api.get(f"{BASE}/medications/search?q=p", headers=env.dentist)).status_code == 422

    removed = await api.delete(
        f"{BASE}/medication-favorites/{saved['favorite_id']}", headers=env.dentist
    )
    assert removed.status_code == 204
    assert (await api.get(f"{BASE}/medication-favorites", headers=env.dentist)).json()["data"] == []
