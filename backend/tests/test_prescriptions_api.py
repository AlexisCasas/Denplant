"""Prescriptions — HTTP behaviour, security, numbering, immutability, snapshots.

These go through a client whose ``get_db`` override behaves exactly like the
real one — commit when the handler returns, rollback when it raises — and
through independent sessions for what actually persisted. The shared ``client``
fixture reuses the test's own session and never commits, which would hide the
properties that depend on a real transaction: a rollback handing a number back,
two requests racing for the next one, a trigger refusing a write.

The fixtures live in ``prescriptions_fixtures`` and are imported explicitly (not
registered in ``conftest.py``); importing a fixture by name makes ruff read every
test argument as a redefinition, hence the file-level F811 exemption below.
"""
# ruff: noqa: F811

import asyncio
from datetime import UTC, date, datetime, timedelta
from uuid import uuid4

import pytest
from sqlalchemy import select, text
from sqlalchemy.exc import DBAPIError

from app.modules.prescriptions.models import PrescriptionCounter
from tests.prescriptions_fixtures import (
    BASE,
    DOB,
    ITEM,
    LIMA,
    REQUIRED_FIELDS,
    _body,
    _get,
    _issue,
    api,  # noqa: F401
    env,  # noqa: F401
    inspect,  # noqa: F401
)

# ===========================================================================
# issuing
# ===========================================================================


@pytest.mark.asyncio
async def test_a_dentist_with_a_registration_number_issues_a_prescription(api, env):
    response = await api.post(BASE, headers=env.dentist, json=_body(env.patient))

    assert response.status_code == 201
    data = response.json()["data"]
    assert data["status"] == "issued"
    assert data["clinic_id"] == str(env.clinic)
    assert data["patient_id"] == str(env.patient)
    assert data["prescriber_user_id"] == str(env.dentist_id)
    assert data["voided_at"] is None and data["void_reason"] is None
    assert len(data["items"]) == 1
    assert data["items"][0]["active_ingredient"] == "Amoxicilina"


@pytest.mark.asyncio
async def test_several_items_are_created_together_in_payload_order(api, env, inspect):
    items = [
        {**ITEM, "active_ingredient": "Amoxicilina"},
        {
            **ITEM,
            "active_ingredient": "Ibuprofeno",
            "strength": "400 mg",
            "commercial_name": "  Advil  ",
            "presentation": "Caja x 20",
            "instructions": "  Con alimentos ",
        },
        {**ITEM, "active_ingredient": "Clorhexidina", "route": "Tópica"},
    ]
    data = await _issue(api, env, items=items)

    assert [i["position"] for i in data["items"]] == [1, 2, 3]
    assert [i["active_ingredient"] for i in data["items"]] == [
        "Amoxicilina",
        "Ibuprofeno",
        "Clorhexidina",
    ]
    # optional text is trimmed; whitespace-only is absent
    assert data["items"][1]["commercial_name"] == "Advil"
    assert data["items"][1]["instructions"] == "Con alimentos"
    assert data["items"][0]["commercial_name"] is None

    session = inspect()
    count = await session.scalar(text("SELECT count(*) FROM prescription_items"))
    assert count == 3


@pytest.mark.asyncio
async def test_the_snapshots_are_taken_from_the_server(api, env):
    data = await _issue(api, env)

    assert data["patient_name_snapshot"] == "Mio Paciente"
    assert data["patient_national_id_snapshot"] == "45678912"
    assert data["patient_national_id_type_snapshot"] == "dni"
    assert data["patient_date_of_birth_snapshot"] == DOB.isoformat()
    assert data["prescriber_name_snapshot"] == "Dentist Tester"
    assert data["prescriber_professional_id_snapshot"] == "COP-111"
    assert data["clinic_name_snapshot"] == "Clínica Sonrisa"
    assert data["clinic_legal_name_snapshot"] == "Sonrisa S.A.C."
    assert data["clinic_tax_id_snapshot"] == "20123456789"
    # one deterministic line: street, postal code + city, country
    assert data["clinic_address_snapshot"] == "Av. Larco 123, 15074 Lima, Perú"
    assert data["clinic_phone_snapshot"] == "+51 1 555 0100"


@pytest.mark.asyncio
async def test_the_issue_date_is_the_clinics_local_date(api, env):
    before = datetime.now(UTC).astimezone(LIMA).date()
    data = await _issue(api, env)
    after = datetime.now(UTC).astimezone(LIMA).date()

    assert date.fromisoformat(data["issue_date"]) in {before, after}
    assert data["year"] == date.fromisoformat(data["issue_date"]).year
    assert datetime.fromisoformat(data["issued_at"]).tzinfo is not None


@pytest.mark.asyncio
async def test_a_patient_without_a_date_of_birth_cannot_be_prescribed_for(api, env):
    response = await api.post(BASE, headers=env.dentist, json=_body(env.no_dob))

    assert response.status_code == 422
    assert response.json()["code"] == "patient_date_of_birth_required"


@pytest.mark.asyncio
async def test_an_age_cannot_be_supplied_instead(api, env):
    body = _body(env.no_dob)
    body["age"] = 30
    body["patient_date_of_birth_snapshot"] = "1995-01-01"

    response = await api.post(BASE, headers=env.dentist, json=body)
    assert response.status_code == 422


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "who, patient", [("unregistered", "unreg_patient"), ("blank", "blank_patient")]
)
async def test_a_dentist_without_a_registration_number_cannot_issue(api, env, who, patient):
    response = await api.post(BASE, headers=getattr(env, who), json=_body(getattr(env, patient)))

    assert response.status_code == 422
    assert response.json()["code"] == "prescriber_professional_id_required"


@pytest.mark.asyncio
async def test_an_admin_cannot_issue_even_when_flagged_professional_with_a_number(api, env):
    response = await api.post(BASE, headers=env.admin, json=_body(env.patient))

    assert response.status_code == 403
    assert response.json()["code"] == "prescriber_not_eligible"


@pytest.mark.asyncio
@pytest.mark.parametrize("role", ["hygienist", "assistant", "receptionist"])
async def test_other_roles_cannot_issue(api, env, role):
    response = await api.post(BASE, headers=getattr(env, role), json=_body(env.patient))
    assert response.status_code == 403


@pytest.mark.asyncio
async def test_nothing_is_created_by_a_refused_issue(api, env, inspect):
    await api.post(BASE, headers=env.admin, json=_body(env.patient))
    await api.post(BASE, headers=env.dentist, json=_body(env.no_dob))

    session = inspect()
    assert await session.scalar(text("SELECT count(*) FROM prescriptions")) == 0
    assert await session.scalar(text("SELECT count(*) FROM prescription_items")) == 0
    assert await session.scalar(text("SELECT count(*) FROM prescription_counters")) == 0


@pytest.mark.asyncio
async def test_a_patient_that_does_not_exist_is_not_found(api, env):
    response = await api.post(BASE, headers=env.dentist, json=_body(uuid4()))
    assert response.status_code == 404
    assert response.json()["code"] == "patient_not_found"


@pytest.mark.asyncio
async def test_a_patient_of_another_clinic_is_not_found(api, env):
    response = await api.post(BASE, headers=env.dentist, json=_body(env.other_patient))
    assert response.status_code == 404
    assert response.json()["code"] == "patient_not_found"


@pytest.mark.asyncio
async def test_a_dentist_cannot_prescribe_for_a_patient_out_of_their_scope(api, env):
    # dentist2 neither created env.patient nor has an appointment with them.
    response = await api.post(BASE, headers=env.dentist2, json=_body(env.patient))
    assert response.status_code == 404


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "field, value",
    [
        ("clinic_id", str(uuid4())),
        ("prescriber_user_id", str(uuid4())),
        ("prescriber_name_snapshot", "Dr. Falso"),
        ("prescriber_professional_id_snapshot", "COP-FAKE"),
        ("patient_name_snapshot", "Otro Nombre"),
        ("clinic_name_snapshot", "Otra Clínica"),
        ("clinic_address_snapshot", "Otra calle"),
        ("number", "RX-2026-000999"),
        ("sequence", 999),
        ("year", 1999),
        ("status", "voided"),
        ("issue_date", "2020-01-01"),
        ("issued_at", "2020-01-01T00:00:00Z"),
        ("voided_at", "2020-01-01T00:00:00Z"),
        ("void_reason", "x"),
        ("age", 40),
    ],
)
async def test_the_client_cannot_name_anything_the_server_decides(api, env, inspect, field, value):
    body = _body(env.patient)
    body[field] = value

    response = await api.post(BASE, headers=env.dentist, json=body)

    assert response.status_code == 422
    session = inspect()
    assert await session.scalar(text("SELECT count(*) FROM prescriptions")) == 0


@pytest.mark.asyncio
async def test_an_item_cannot_carry_unknown_keys(api, env):
    response = await api.post(
        BASE, headers=env.dentist, json=_body(env.patient, items=[{**ITEM, "price": 10}])
    )
    assert response.status_code == 422


@pytest.mark.asyncio
async def test_a_prescription_needs_at_least_one_item(api, env):
    response = await api.post(BASE, headers=env.dentist, json=_body(env.patient, items=[]))
    assert response.status_code == 422


@pytest.mark.asyncio
@pytest.mark.parametrize("field", REQUIRED_FIELDS)
@pytest.mark.parametrize("blank", ["", "   ", "\t \n"])
async def test_every_required_item_field_rejects_blank_text(api, env, field, blank):
    response = await api.post(
        BASE, headers=env.dentist, json=_body(env.patient, items=[{**ITEM, field: blank}])
    )
    assert response.status_code == 422


@pytest.mark.asyncio
@pytest.mark.parametrize("field", REQUIRED_FIELDS)
async def test_every_required_item_field_must_be_present(api, env, field):
    item = {k: v for k, v in ITEM.items() if k != field}
    response = await api.post(BASE, headers=env.dentist, json=_body(env.patient, items=[item]))
    assert response.status_code == 422


@pytest.mark.asyncio
async def test_required_text_is_trimmed(api, env):
    data = await _issue(api, env, items=[{**ITEM, "dose": "   1 cápsula  "}])
    assert data["items"][0]["dose"] == "1 cápsula"


@pytest.mark.asyncio
async def test_a_validity_is_required(api, env):
    body = _body(env.patient)
    del body["valid_until"]
    response = await api.post(BASE, headers=env.dentist, json=body)
    assert response.status_code == 422


@pytest.mark.asyncio
async def test_a_validity_before_the_issue_date_is_refused(api, env):
    yesterday = (datetime.now(UTC).astimezone(LIMA).date() - timedelta(days=1)).isoformat()
    response = await api.post(
        BASE, headers=env.dentist, json=_body(env.patient, valid_until=yesterday)
    )

    assert response.status_code == 422
    assert response.json()["code"] == "valid_until_before_issue_date"


@pytest.mark.asyncio
async def test_a_validity_on_the_issue_date_itself_is_accepted(api, env):
    today = datetime.now(UTC).astimezone(LIMA).date().isoformat()
    await _issue(api, env, valid_until=today)


@pytest.mark.asyncio
async def test_an_invalid_clinic_timezone_is_refused_not_guessed(api, env, inspect):
    session = inspect()
    await session.execute(
        text("UPDATE clinics SET timezone = 'Not/AZone' WHERE id = :c"), {"c": env.clinic}
    )
    await session.commit()

    response = await api.post(BASE, headers=env.dentist, json=_body(env.patient))

    assert response.status_code == 422
    assert response.json()["code"] == "clinic_timezone_invalid"


# ===========================================================================
# numbering
# ===========================================================================


@pytest.mark.asyncio
async def test_numbers_follow_rx_year_six_digits(api, env):
    first = await _issue(api, env)
    second = await _issue(api, env)

    year = date.fromisoformat(first["issue_date"]).year
    assert first["number"] == f"RX-{year}-000001"
    assert second["number"] == f"RX-{year}-000002"
    assert (first["sequence"], second["sequence"]) == (1, 2)


@pytest.mark.asyncio
async def test_each_clinic_has_its_own_sequence(api, env):
    a = await _issue(api, env)
    other = await api.post(BASE, headers=env.other_dentist, json=_body(env.other_patient))
    assert other.status_code == 201, other.text

    assert a["number"].endswith("000001")
    assert other.json()["data"]["number"].endswith("000001")
    assert other.json()["data"]["clinic_id"] == str(env.other_clinic)


@pytest.mark.asyncio
async def test_each_local_year_has_its_own_sequence(api, env, monkeypatch):
    import app.modules.prescriptions.service as service

    real = datetime

    def frozen(moment: datetime):
        class Frozen(real):
            @classmethod
            def now(cls, tz=None):
                return moment.astimezone(tz) if tz else moment

        return Frozen

    # 23:30 on 31 Dec in Lima is already 1 Jan in UTC: the clinic's year decides.
    monkeypatch.setattr(service, "datetime", frozen(datetime(2025, 12, 31, 23, 30, tzinfo=LIMA)))
    old = await _issue(api, env, valid_until="2026-03-01")
    monkeypatch.setattr(service, "datetime", frozen(datetime(2026, 1, 1, 0, 30, tzinfo=LIMA)))
    new = await _issue(api, env, valid_until="2026-03-01")
    monkeypatch.setattr(service, "datetime", frozen(datetime(2026, 1, 1, 9, 0, tzinfo=LIMA)))
    again = await _issue(api, env, valid_until="2026-03-01")

    assert old["number"] == "RX-2025-000001"
    assert old["issue_date"] == "2025-12-31"
    assert new["number"] == "RX-2026-000001"
    assert again["number"] == "RX-2026-000002"


@pytest.mark.asyncio
async def test_a_rolled_back_issue_does_not_consume_a_number(api, env, monkeypatch, inspect):
    import app.modules.prescriptions.service as service

    def boom(_address):
        raise RuntimeError("fails after the number was taken")

    monkeypatch.setattr(service, "format_clinic_address", boom)
    with pytest.raises(RuntimeError):
        await api.post(BASE, headers=env.dentist, json=_body(env.patient))
    monkeypatch.undo()

    session = inspect()
    assert await session.scalar(text("SELECT count(*) FROM prescription_counters")) == 0

    first = await _issue(api, env)
    assert first["number"].endswith("000001")


@pytest.mark.asyncio
async def test_concurrent_issues_never_share_a_number(api, env, inspect):
    results = await asyncio.gather(
        *(api.post(BASE, headers=env.dentist, json=_body(env.patient)) for _ in range(8))
    )

    assert [r.status_code for r in results] == [201] * 8
    numbers = sorted(r.json()["data"]["number"] for r in results)
    year = date.fromisoformat(results[0].json()["data"]["issue_date"]).year
    assert numbers == [f"RX-{year}-{n:06d}" for n in range(1, 9)]

    session = inspect()
    counter = (await session.execute(select(PrescriptionCounter))).scalar_one()
    assert counter.last_number == 8


@pytest.mark.asyncio
async def test_the_database_refuses_a_duplicate_number(api, env, inspect):
    first = await _issue(api, env)
    session = inspect()
    with pytest.raises(DBAPIError):
        await session.execute(
            text(
                "INSERT INTO prescription_counters (clinic_id, year, last_number) "
                "VALUES (:c, :y, 0)"
            ),
            {"c": env.clinic, "y": first["year"]},
        )
    await session.rollback()

    with pytest.raises(DBAPIError):
        await session.execute(
            text(
                "INSERT INTO prescriptions (id, clinic_id, patient_id, prescriber_user_id, "
                "number, sequence, year, issued_at, issue_date, valid_until, item_count, status, "
                "patient_name_snapshot, patient_date_of_birth_snapshot, prescriber_name_snapshot, "
                "prescriber_professional_id_snapshot, clinic_name_snapshot, clinic_tax_id_snapshot) "
                "SELECT gen_random_uuid(), clinic_id, patient_id, prescriber_user_id, number, "
                "sequence + 100, year, issued_at, issue_date, valid_until, item_count, status, "
                "patient_name_snapshot, patient_date_of_birth_snapshot, prescriber_name_snapshot, "
                "prescriber_professional_id_snapshot, clinic_name_snapshot, clinic_tax_id_snapshot "
                "FROM prescriptions WHERE id = :id"
            ),
            {"id": first["id"]},
        )
    await session.rollback()


# ===========================================================================
# reading
# ===========================================================================


@pytest.mark.asyncio
async def test_the_history_is_newest_first_with_item_counts(api, env):
    one = await _issue(api, env)
    three = await _issue(api, env, items=[dict(ITEM), dict(ITEM), dict(ITEM)])
    two = await _issue(api, env, items=[dict(ITEM), dict(ITEM)])

    response = await api.get(BASE, headers=env.dentist, params={"patient_id": str(env.patient)})

    assert response.status_code == 200
    body = response.json()
    assert body["total"] == 3
    assert [row["id"] for row in body["data"]] == [two["id"], three["id"], one["id"]]
    assert [row["item_count"] for row in body["data"]] == [2, 3, 1]
    row = body["data"][0]
    assert set(row) == {
        "id",
        "number",
        "issued_at",
        "issue_date",
        "valid_until",
        "prescriber_name_snapshot",
        "item_count",
        "status",
        "voided_at",
    }
    assert row["prescriber_name_snapshot"] == "Dentist Tester"
    assert row["status"] == "issued"
    assert "items" not in row


@pytest.mark.asyncio
async def test_the_history_is_paginated(api, env):
    for _ in range(3):
        await _issue(api, env)

    page = await api.get(
        BASE,
        headers=env.dentist,
        params={"patient_id": str(env.patient), "page": 2, "page_size": 2},
    )
    body = page.json()
    assert body["total"] == 3 and body["page"] == 2 and len(body["data"]) == 1


@pytest.mark.asyncio
async def test_the_history_needs_a_patient(api, env):
    response = await api.get(BASE, headers=env.dentist)
    assert response.status_code == 422


@pytest.mark.asyncio
async def test_the_history_only_lists_that_patients_prescriptions(api, env):
    await _issue(api, env)
    await _issue(api, env, patient=env.shared)

    response = await api.get(BASE, headers=env.dentist, params={"patient_id": str(env.shared)})
    assert response.json()["total"] == 1


@pytest.mark.asyncio
async def test_the_detail_has_every_snapshot_and_items_by_position(api, env):
    items = [{**ITEM, "active_ingredient": name} for name in ("C", "A", "B")]
    issued = await _issue(api, env, items=items)

    response = await _get(api, env.dentist, issued["id"])

    assert response.status_code == 200
    assert response.json()["data"] == issued
    assert [i["active_ingredient"] for i in response.json()["data"]["items"]] == ["C", "A", "B"]
    assert [i["position"] for i in response.json()["data"]["items"]] == [1, 2, 3]


@pytest.mark.asyncio
async def test_an_admin_can_read(api, env):
    issued = await _issue(api, env)

    detail = await _get(api, env.admin, issued["id"])
    history = await api.get(BASE, headers=env.admin, params={"patient_id": str(env.patient)})

    assert detail.status_code == 200
    assert history.status_code == 200 and history.json()["total"] == 1


@pytest.mark.asyncio
@pytest.mark.parametrize("role", ["hygienist", "assistant", "receptionist"])
async def test_other_roles_cannot_read(api, env, role):
    issued = await _issue(api, env)
    headers = getattr(env, role)

    assert (await _get(api, headers, issued["id"])).status_code == 403
    listing = await api.get(BASE, headers=headers, params={"patient_id": str(env.patient)})
    assert listing.status_code == 403


@pytest.mark.asyncio
async def test_another_clinic_cannot_read_it(api, env):
    issued = await _issue(api, env)

    assert (await _get(api, env.outsider, issued["id"])).status_code == 404
    assert (await _get(api, env.other_dentist, issued["id"])).status_code == 404
    listing = await api.get(BASE, headers=env.outsider, params={"patient_id": str(env.patient)})
    assert listing.status_code == 404


@pytest.mark.asyncio
async def test_patient_scope_applies_to_reading(api, env):
    issued = await _issue(api, env)

    # dentist2 has no access to env.patient: the prescription is "not found".
    assert (await _get(api, env.dentist2, issued["id"])).status_code == 404
    listing = await api.get(BASE, headers=env.dentist2, params={"patient_id": str(env.patient)})
    assert listing.status_code == 404


@pytest.mark.asyncio
async def test_a_colleague_with_access_to_the_patient_can_read(api, env):
    issued = await _issue(api, env, patient=env.shared)
    assert (await _get(api, env.dentist2, issued["id"])).status_code == 200


@pytest.mark.asyncio
async def test_an_unknown_prescription_is_not_found(api, env):
    response = await _get(api, env.dentist, uuid4())
    assert response.status_code == 404
    assert response.json()["code"] == "prescription_not_found"


# ===========================================================================
# immutability
# ===========================================================================


@pytest.mark.asyncio
@pytest.mark.parametrize("method", ["put", "patch", "delete"])
async def test_the_api_has_no_edit_or_delete(api, env, method):
    issued = await _issue(api, env)

    item = await getattr(api, method)(f"{BASE}/{issued['id']}", headers=env.admin)
    collection = await getattr(api, method)(BASE, headers=env.admin)

    assert item.status_code == 405
    assert collection.status_code == 405


@pytest.mark.asyncio
async def test_the_database_refuses_an_ordinary_update(api, env, inspect):
    issued = await _issue(api, env)
    session = inspect()

    for column, value in (
        ("valid_until", "valid_until + 1"),
        ("patient_name_snapshot", "'Reescrito'"),
        ("number", "'RX-1999-000001'"),
        ("item_count", "item_count + 1"),
        ("prescriber_professional_id_snapshot", "'COP-X'"),
    ):
        with pytest.raises(DBAPIError, match="immutable|only change"):
            await session.execute(
                text(f"UPDATE prescriptions SET {column} = {value} WHERE id = :id"),
                {"id": issued["id"]},
            )
        await session.rollback()


@pytest.mark.asyncio
async def test_the_database_refuses_to_delete_a_prescription(api, env, inspect):
    issued = await _issue(api, env)
    session = inspect()
    with pytest.raises(DBAPIError, match="cannot be deleted"):
        await session.execute(
            text("DELETE FROM prescriptions WHERE id = :id"), {"id": issued["id"]}
        )
    await session.rollback()
    assert await session.scalar(text("SELECT count(*) FROM prescriptions")) == 1


@pytest.mark.asyncio
async def test_the_database_refuses_to_update_or_delete_an_item(api, env, inspect):
    issued = await _issue(api, env)
    session = inspect()

    with pytest.raises(DBAPIError, match="immutable"):
        await session.execute(
            text("UPDATE prescription_items SET dose = 'otra' WHERE prescription_id = :id"),
            {"id": issued["id"]},
        )
    await session.rollback()
    with pytest.raises(DBAPIError, match="immutable"):
        await session.execute(
            text("DELETE FROM prescription_items WHERE prescription_id = :id"), {"id": issued["id"]}
        )
    await session.rollback()
    assert await session.scalar(text("SELECT count(*) FROM prescription_items")) == 1


@pytest.mark.asyncio
async def test_the_database_allows_the_void_transition_and_nothing_else_alongside_it(
    api, env, inspect
):
    issued = await _issue(api, env)
    session = inspect()

    # The void fields plus another column: refused.
    with pytest.raises(DBAPIError, match="apart from its void fields"):
        await session.execute(
            text(
                "UPDATE prescriptions SET status = 'voided', voided_at = now(), "
                "voided_by = :u, void_reason = 'x', patient_name_snapshot = 'Otro' WHERE id = :id"
            ),
            {"id": issued["id"], "u": env.dentist_id},
        )
    await session.rollback()

    # Only the void fields: accepted.
    await session.execute(
        text(
            "UPDATE prescriptions SET status = 'voided', voided_at = now(), "
            "voided_by = :u, void_reason = 'x' WHERE id = :id"
        ),
        {"id": issued["id"], "u": env.dentist_id},
    )
    await session.commit()


@pytest.mark.asyncio
async def test_a_voided_prescription_is_terminal_in_the_database(api, env, inspect):
    issued = await _issue(api, env)
    voided = await api.post(
        f"{BASE}/{issued['id']}/void", headers=env.dentist, json={"reason": "error"}
    )
    assert voided.status_code == 200
    session = inspect()

    for statement in (
        "UPDATE prescriptions SET status = 'issued', voided_at = NULL, voided_by = NULL, "
        "void_reason = NULL WHERE id = :id",
        "UPDATE prescriptions SET void_reason = 'otro' WHERE id = :id",
    ):
        with pytest.raises(DBAPIError, match="immutable"):
            await session.execute(text(statement), {"id": issued["id"]})
        await session.rollback()


# The set of items is closed by the header's own ``item_count``: positions
# 1..item_count are unique, nothing outside them is accepted, and the deferred
# trigger checks at COMMIT that all of them exist. These attack that from plain
# SQL, the way any other writer could.

_COPY_COLUMNS = (
    "clinic_id, patient_id, prescriber_user_id, issued_at, issue_date, valid_until, "
    "patient_name_snapshot, patient_national_id_snapshot, patient_national_id_type_snapshot, "
    "patient_date_of_birth_snapshot, prescriber_name_snapshot, "
    "prescriber_professional_id_snapshot, clinic_name_snapshot, clinic_legal_name_snapshot, "
    "clinic_tax_id_snapshot, clinic_address_snapshot, clinic_phone_snapshot"
)


async def _raw_prescription(session, source_id, *, item_count: int) -> str:
    """Insert a second prescription by plain SQL, copying an issued one's header."""
    new_id = str(uuid4())
    await session.execute(
        text(
            f"INSERT INTO prescriptions (id, number, sequence, year, item_count, status, "
            f"{_COPY_COLUMNS}) SELECT :new, 'RX-9999-000001', 1, 9999, :n, 'issued', "
            f"{_COPY_COLUMNS} FROM prescriptions WHERE id = :src"
        ),
        {"new": new_id, "src": source_id, "n": item_count},
    )
    return new_id


async def _raw_item(session, *, clinic, prescription, position, ingredient="Amoxicilina"):
    await session.execute(
        text(
            "INSERT INTO prescription_items (id, clinic_id, prescription_id, position, "
            "active_ingredient, strength, pharmaceutical_form, dose, route, frequency, "
            "duration, total_quantity) VALUES (gen_random_uuid(), :c, :p, :pos, :ai, 'b', "
            "'c', 'd', 'e', 'f', 'g', 'h')"
        ),
        {"c": clinic, "p": prescription, "pos": position, "ai": ingredient},
    )


async def _item_count(session, prescription_id) -> int:
    return await session.scalar(
        text("SELECT count(*) FROM prescription_items WHERE prescription_id = :p"),
        {"p": prescription_id},
    )


@pytest.mark.asyncio
@pytest.mark.parametrize("declared", [1, 2, 3])
async def test_a_late_insert_on_an_issued_prescription_fails(api, env, inspect, declared):
    issued = await _issue(api, env, items=[dict(ITEM) for _ in range(declared)])
    session = inspect()

    # Past the last position: refused by the item guard.
    for position in (declared + 1, declared + 5, 99):
        with pytest.raises(DBAPIError, match="outside them"):
            await _raw_item(
                session, clinic=env.clinic, prescription=issued["id"], position=position
            )
        await session.rollback()

    # Inside the set every position is already taken: refused by uniqueness.
    for position in range(1, declared + 1):
        with pytest.raises(DBAPIError, match="uq_prescription_item_position"):
            await _raw_item(
                session, clinic=env.clinic, prescription=issued["id"], position=position
            )
        await session.rollback()

    assert await _item_count(session, issued["id"]) == declared


@pytest.mark.asyncio
async def test_a_late_insert_on_a_voided_prescription_fails(api, env, inspect):
    issued = await _issue(api, env, items=[dict(ITEM), dict(ITEM)])
    await api.post(f"{BASE}/{issued['id']}/void", headers=env.dentist, json={"reason": "error"})
    session = inspect()

    for position in (1, 2, 3, 9):
        with pytest.raises(DBAPIError, match="issued prescription"):
            await _raw_item(
                session, clinic=env.clinic, prescription=issued["id"], position=position
            )
        await session.rollback()

    assert await _item_count(session, issued["id"]) == 2


@pytest.mark.asyncio
async def test_a_late_insert_still_fails_after_the_set_was_committed_in_plain_sql(
    api, env, inspect
):
    # Positive control: the same SQL path that is allowed to build a prescription
    # inside one transaction is not allowed to extend it afterwards.
    issued = await _issue(api, env)
    session = inspect()
    new_id = await _raw_prescription(session, issued["id"], item_count=2)
    await _raw_item(session, clinic=env.clinic, prescription=new_id, position=1)
    await _raw_item(session, clinic=env.clinic, prescription=new_id, position=2)
    await session.commit()

    assert await _item_count(session, new_id) == 2
    with pytest.raises(DBAPIError, match="outside them"):
        await _raw_item(session, clinic=env.clinic, prescription=new_id, position=3)
    await session.rollback()


@pytest.mark.asyncio
async def test_the_database_requires_every_declared_item_at_commit(api, env, inspect):
    issued = await _issue(api, env)
    session = inspect()

    new_id = await _raw_prescription(session, issued["id"], item_count=2)
    await _raw_item(session, clinic=env.clinic, prescription=new_id, position=1)
    with pytest.raises(DBAPIError, match="declares 2 items but has 1"):
        await session.commit()
    await session.rollback()

    # Nothing of the incomplete prescription survived.
    assert await session.scalar(text("SELECT count(*) FROM prescriptions")) == 1
    assert await _item_count(session, new_id) == 0


@pytest.mark.asyncio
async def test_a_prescription_with_no_items_cannot_be_committed(api, env, inspect):
    issued = await _issue(api, env)
    session = inspect()

    await _raw_prescription(session, issued["id"], item_count=1)
    with pytest.raises(DBAPIError, match="declares 1 items but has 0"):
        await session.commit()
    await session.rollback()
    assert await session.scalar(text("SELECT count(*) FROM prescriptions")) == 1


@pytest.mark.asyncio
async def test_a_prescription_cannot_declare_zero_items(api, env, inspect):
    issued = await _issue(api, env)
    session = inspect()

    with pytest.raises(DBAPIError, match="ck_prescription_item_count_positive"):
        await _raw_prescription(session, issued["id"], item_count=0)
    await session.rollback()


@pytest.mark.asyncio
async def test_an_item_cannot_point_at_another_clinics_prescription(api, env, inspect):
    issued = await _issue(api, env)
    session = inspect()

    new_id = await _raw_prescription(session, issued["id"], item_count=1)
    with pytest.raises(DBAPIError, match="fk_prescription_item_prescription_clinic"):
        await _raw_item(session, clinic=env.other_clinic, prescription=new_id, position=1)
    await session.rollback()


@pytest.mark.asyncio
async def test_the_database_refuses_blank_required_item_text(api, env, inspect):
    issued = await _issue(api, env)
    session = inspect()

    new_id = await _raw_prescription(session, issued["id"], item_count=1)
    with pytest.raises(DBAPIError, match="ck_prescription_item_required_not_blank"):
        await _raw_item(
            session, clinic=env.clinic, prescription=new_id, position=1, ingredient="   "
        )
    await session.rollback()


# ===========================================================================
# voiding
# ===========================================================================


@pytest.mark.asyncio
async def test_the_original_prescriber_can_void_with_a_trimmed_reason(api, env):
    issued = await _issue(api, env)

    response = await api.post(
        f"{BASE}/{issued['id']}/void", headers=env.dentist, json={"reason": "  error de dosis  "}
    )

    assert response.status_code == 200
    data = response.json()["data"]
    assert data["status"] == "voided"
    assert data["void_reason"] == "error de dosis"
    assert data["voided_by"] == str(env.dentist_id)
    assert datetime.fromisoformat(data["voided_at"]).tzinfo is not None


@pytest.mark.asyncio
async def test_an_admin_can_void(api, env):
    issued = await _issue(api, env)

    response = await api.post(
        f"{BASE}/{issued['id']}/void", headers=env.admin, json={"reason": "revisión"}
    )

    assert response.status_code == 200
    assert response.json()["data"]["voided_by"] == str(env.admin_id)


@pytest.mark.asyncio
async def test_another_dentist_cannot_void_even_with_the_permission(api, env):
    issued = await _issue(api, env, patient=env.shared)

    # dentist2 can read it (patient in scope) and holds prescriptions.void.
    assert (await _get(api, env.dentist2, issued["id"])).status_code == 200
    response = await api.post(
        f"{BASE}/{issued['id']}/void", headers=env.dentist2, json={"reason": "no es mía"}
    )

    assert response.status_code == 403
    assert response.json()["code"] == "void_not_allowed"
    assert (await _get(api, env.dentist, issued["id"])).json()["data"]["status"] == "issued"


@pytest.mark.asyncio
@pytest.mark.parametrize("role", ["hygienist", "assistant", "receptionist"])
async def test_other_roles_cannot_void(api, env, role):
    issued = await _issue(api, env)
    response = await api.post(
        f"{BASE}/{issued['id']}/void", headers=getattr(env, role), json={"reason": "x"}
    )
    assert response.status_code == 403


@pytest.mark.asyncio
async def test_voiding_is_not_found_across_clinics_or_scope(api, env):
    issued = await _issue(api, env)

    other_clinic = await api.post(
        f"{BASE}/{issued['id']}/void", headers=env.outsider, json={"reason": "x"}
    )
    out_of_scope = await api.post(
        f"{BASE}/{issued['id']}/void", headers=env.dentist2, json={"reason": "x"}
    )
    assert other_clinic.status_code == 404
    assert out_of_scope.status_code == 404


@pytest.mark.asyncio
@pytest.mark.parametrize("body", [{}, {"reason": ""}, {"reason": "   "}, {"reason": None}])
async def test_a_reason_is_required(api, env, body):
    issued = await _issue(api, env)

    response = await api.post(f"{BASE}/{issued['id']}/void", headers=env.dentist, json=body)

    assert response.status_code == 422
    assert (await _get(api, env.dentist, issued["id"])).json()["data"]["status"] == "issued"


@pytest.mark.asyncio
async def test_void_accepts_nothing_but_a_reason(api, env):
    issued = await _issue(api, env)
    response = await api.post(
        f"{BASE}/{issued['id']}/void",
        headers=env.dentist,
        json={"reason": "x", "voided_by": str(uuid4()), "status": "issued"},
    )
    assert response.status_code == 422


@pytest.mark.asyncio
async def test_a_second_void_is_refused(api, env):
    issued = await _issue(api, env)
    first = await api.post(
        f"{BASE}/{issued['id']}/void", headers=env.dentist, json={"reason": "primero"}
    )
    second = await api.post(
        f"{BASE}/{issued['id']}/void", headers=env.admin, json={"reason": "segundo"}
    )

    assert first.status_code == 200
    assert second.status_code == 409
    assert second.json()["code"] == "prescription_state_conflict"
    detail = (await _get(api, env.admin, issued["id"])).json()["data"]
    assert detail["void_reason"] == "primero"
    assert detail["voided_by"] == str(env.dentist_id)


@pytest.mark.asyncio
async def test_two_simultaneous_voids_leave_exactly_one_winner(api, env):
    issued = await _issue(api, env)

    results = await asyncio.gather(
        api.post(f"{BASE}/{issued['id']}/void", headers=env.dentist, json={"reason": "a"}),
        api.post(f"{BASE}/{issued['id']}/void", headers=env.admin, json={"reason": "b"}),
    )

    assert sorted(r.status_code for r in results) == [200, 409]


@pytest.mark.asyncio
async def test_voiding_changes_only_the_void_fields_and_leaves_the_items(api, env):
    issued = await _issue(api, env, items=[dict(ITEM), {**ITEM, "active_ingredient": "Ibuprofeno"}])

    voided = await api.post(
        f"{BASE}/{issued['id']}/void", headers=env.dentist, json={"reason": "error"}
    )
    after = voided.json()["data"]

    changed = {key for key in issued if issued[key] != after[key]}
    assert changed == {"status", "voided_at", "voided_by", "void_reason"}
    assert after["items"] == issued["items"]


@pytest.mark.asyncio
async def test_a_voided_prescription_stays_in_the_history_and_cannot_be_voided_by_the_list(
    api, env
):
    issued = await _issue(api, env)
    await api.post(f"{BASE}/{issued['id']}/void", headers=env.dentist, json={"reason": "error"})

    listing = await api.get(BASE, headers=env.dentist, params={"patient_id": str(env.patient)})
    row = listing.json()["data"][0]

    assert row["status"] == "voided"
    assert row["voided_at"] is not None


# ===========================================================================
# snapshots
# ===========================================================================


@pytest.mark.asyncio
async def test_a_prescription_does_not_rewrite_itself_when_its_sources_change(api, env, inspect):
    issued = await _issue(api, env)
    before = (await _get(api, env.dentist, issued["id"])).json()["data"]

    session = inspect()
    await session.execute(
        text(
            "UPDATE patients SET first_name = 'Cambiado', last_name = 'Distinto', "
            "national_id = '00000000', national_id_type = 'passport', "
            "date_of_birth = '2001-02-03' WHERE id = :id"
        ),
        {"id": env.patient},
    )
    await session.execute(
        text(
            "UPDATE users SET first_name = 'Renombrado', last_name = 'Otro', "
            "professional_id = 'COP-NUEVO' WHERE id = :id"
        ),
        {"id": env.dentist_id},
    )
    await session.execute(
        text(
            "UPDATE clinics SET name = 'Otro Nombre', legal_name = 'Otra S.A.', tax_id = 'X9', "
            "address = CAST(:addr AS jsonb), phone = '999' WHERE id = :id"
        ),
        {"id": env.clinic, "addr": '{"street": "Calle Nueva 1", "city": "Cusco"}'},
    )
    await session.commit()

    after = (await _get(api, env.admin, issued["id"])).json()["data"]
    assert after == before
    assert after["patient_name_snapshot"] == "Mio Paciente"
    assert after["prescriber_professional_id_snapshot"] == "COP-111"
    assert after["clinic_name_snapshot"] == "Clínica Sonrisa"
    assert after["clinic_address_snapshot"] == "Av. Larco 123, 15074 Lima, Perú"
    assert after["patient_date_of_birth_snapshot"] == DOB.isoformat()


@pytest.mark.asyncio
async def test_a_new_prescription_after_the_change_uses_the_new_values(api, env, inspect):
    await _issue(api, env)
    session = inspect()
    await session.execute(
        text("UPDATE clinics SET name = 'Otro Nombre' WHERE id = :id"), {"id": env.clinic}
    )
    await session.commit()

    later = await _issue(api, env)
    assert later["clinic_name_snapshot"] == "Otro Nombre"


@pytest.mark.asyncio
async def test_the_address_is_flattened_deterministically(api, env, inspect):
    session = inspect()
    # Keys in a different order, a blank one, and an unknown one.
    await session.execute(
        text("UPDATE clinics SET address = CAST(:a AS jsonb) WHERE id = :id"),
        {
            "id": env.clinic,
            "a": '{"country": "Perú", "extra": "ignorado", "city": " Lima ", "street": "  Jr. Uno 5 ",'
            ' "postal_code": ""}',
        },
    )
    await session.commit()

    data = await _issue(api, env)
    assert data["clinic_address_snapshot"] == "Jr. Uno 5, Lima, Perú"


@pytest.mark.asyncio
async def test_a_clinic_without_an_address_has_no_address_snapshot(api, env, inspect):
    session = inspect()
    await session.execute(
        text("UPDATE clinics SET address = NULL, phone = NULL, legal_name = NULL WHERE id = :id"),
        {"id": env.clinic},
    )
    await session.commit()

    data = await _issue(api, env)
    assert data["clinic_address_snapshot"] is None
    assert data["clinic_phone_snapshot"] is None
    assert data["clinic_legal_name_snapshot"] is None


# ===========================================================================
# isolation from the patient's own medication list
# ===========================================================================


@pytest.mark.asyncio
async def test_issuing_never_touches_the_patients_medication_list(api, env, inspect):
    session = inspect()
    before = await session.scalar(text("SELECT count(*) FROM patients_clinical_medication"))

    await _issue(api, env)

    assert await session.scalar(text("SELECT count(*) FROM patients_clinical_medication")) == before
