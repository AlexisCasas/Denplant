"""HTTP tests for the NTS clinical record API.

These go through a client whose ``get_db`` override behaves exactly like the
real one — commit when the handler returns, rollback when it raises. The
shared ``client`` fixture reuses the test's own session and never commits,
which would hide the very property this API depends on: that a domain
failure converted to an ``HTTPException`` rolls the transaction back.
"""

from uuid import uuid4

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool

from app.core.auth.models import Clinic, ClinicMembership, User
from app.core.auth.service import create_access_token, hash_password
from app.database import get_db
from app.main import app
from app.modules.odontogram.nts.models import NtsOdontogramRecord, NtsRecordAuditEvent
from app.modules.patients.models import Patient
from tests import db_isolation

NORM = "pe_nts_188_2022"
BASE = "/api/v1/odontogram/nts"

CARIES = {
    "rule_id": "6.1.16",
    "attributes": {"caries_type": "CDP", "surfaces": ["O"]},
    "targets": [{"participation": "subject", "target_kind": "fdi_tooth", "tooth_number": 46}],
}
TEMP_CROWN = {
    "rule_id": "6.1.4",
    "attributes": {"sigla": "CT"},
    "targets": [{"participation": "subject", "target_kind": "fdi_tooth", "tooth_number": 21}],
}


def _headers(user: User) -> dict[str, str]:
    token = create_access_token(user.id, token_version=user.token_version)
    return {"Authorization": f"Bearer {token}"}


async def _user(db: AsyncSession, **kw) -> User:
    user = User(
        id=uuid4(),
        email=f"nts-{uuid4().hex[:8]}@example.com",
        password_hash=hash_password("TestPass1234"),
        first_name=kw.pop("first_name", "Ana"),
        last_name=kw.pop("last_name", "Pérez"),
        professional_id=kw.pop("professional_id", "COP-1"),
    )
    db.add(user)
    await db.flush()
    return user


@pytest.fixture
async def env(db_session: AsyncSession):
    """A clinic, a dentist, an assistant, an outsider and two patients."""
    clinic = Clinic(id=uuid4(), name="NTS Clinic", tax_id="B1", settings={})
    other_clinic = Clinic(id=uuid4(), name="Otra", tax_id="B2", settings={})
    db_session.add_all([clinic, other_clinic])
    await db_session.flush()

    dentist = await _user(db_session)
    assistant = await _user(db_session, first_name="Aux")
    outsider = await _user(db_session, first_name="Fuera")
    db_session.add_all(
        [
            ClinicMembership(id=uuid4(), user_id=dentist.id, clinic_id=clinic.id, role="admin"),
            ClinicMembership(
                id=uuid4(), user_id=assistant.id, clinic_id=clinic.id, role="assistant"
            ),
            ClinicMembership(
                id=uuid4(),
                user_id=outsider.id,
                clinic_id=other_clinic.id,
                role="admin",
            ),
        ]
    )

    def _patient(clinic_id, name):
        return Patient(
            id=uuid4(),
            clinic_id=clinic_id,
            first_name=name,
            last_name="Paciente",
            status="active",
            preferred_language="es",
            do_not_contact=False,
        )

    patient = _patient(clinic.id, "Mio")
    foreign_patient = _patient(other_clinic.id, "Ajeno")
    db_session.add_all([patient, foreign_patient])
    await db_session.commit()

    from types import SimpleNamespace

    return SimpleNamespace(
        clinic=clinic.id,
        patient=patient.id,
        foreign_patient=foreign_patient.id,
        dentist=_headers(dentist),
        assistant=_headers(assistant),
        outsider=_headers(outsider),
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
    """An independent session for asserting what actually persisted."""
    engine = create_async_engine(db_isolation.TEST_DATABASE_URL, echo=False, poolclass=NullPool)
    maker = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    sessions = []

    def factory() -> AsyncSession:
        session = maker()
        sessions.append(session)
        return session

    yield factory
    for session in sessions:
        await session.close()
    await engine.dispose()


async def _create_draft(api, env, **body) -> dict:
    response = await api.post(
        f"{BASE}/patients/{env.patient}/records",
        headers=env.dentist,
        json={"norm_version": NORM, "stage": "diagnosis", **body},
    )
    assert response.status_code == 201, response.text
    return response.json()["data"]


# ===========================================================================
# catalog
# ===========================================================================


@pytest.mark.asyncio
async def test_the_catalog_is_served_so_no_client_retypes_the_norm(api, env):
    versions = await api.get(f"{BASE}/catalogs", headers=env.dentist)
    assert versions.status_code == 200
    assert NORM in versions.json()["data"]["norm_versions"]

    response = await api.get(f"{BASE}/catalogs/{NORM}", headers=env.dentist)
    assert response.status_code == 200
    catalog = response.json()["data"]
    assert len(catalog["rules"]) == 38

    rules = {r["rule_id"]: r for r in catalog["rules"]}
    # NTS-03.1 metadata survives serialization...
    assert [r["code"] for r in rules["6.1.29"]["target_roles"]] == ["pilar"]
    assert rules["6.1.4"]["specification_requirement"]["code"] == ("temporary_crown_material")
    fluorosis = next(
        v
        for a in rules["6.1.5"]["attributes"]
        if a["name"] == "dde_type"
        for v in a["values"]
        if v["code"] == "FLUOROSIS"
    )
    assert fluorosis["specification_requirement"]["required"] is True
    # ...and so does the FrozenStrMap behind render marks.
    assert rules["6.1.16"]["render"]["marks"][0]["params"] == {"fill": "solid"}


@pytest.mark.asyncio
async def test_an_unknown_norm_version_is_a_404(api, env):
    response = await api.get(f"{BASE}/catalogs/pe_nts_999_2099", headers=env.dentist)
    assert response.status_code == 404
    assert response.json()["code"] == "nts_norm_version_unknown"


# ===========================================================================
# transaction boundary
# ===========================================================================


@pytest.mark.asyncio
async def test_a_successful_request_is_committed_by_get_db(api, env, inspect):
    """The service never commits, so a later request must still see this."""
    draft = await _create_draft(api, env)
    assert draft["version"] == 1
    assert draft["status"] == "draft"
    assert draft["content_hash"] is None

    found = await api.get(
        f"{BASE}/patients/{env.patient}/records/draft",
        headers=env.dentist,
        params={"norm_version": NORM},
    )
    assert found.status_code == 200
    assert found.json()["data"]["id"] == draft["id"]

    session = inspect()
    stored = await session.get(NtsOdontogramRecord, uuid4().__class__(draft["id"]))
    assert stored is not None and stored.version == 1


@pytest.mark.asyncio
async def test_a_failed_mutation_rolls_the_whole_request_back(api, env, inspect):
    """Bump, then fail validation: the 422 must undo the bump and the audit.

    This is the property the shared `client` fixture cannot show, because it
    never commits or rolls back.
    """
    draft = await _create_draft(api, env)
    record_id = draft["id"]

    session = inspect()
    before_events = len(
        (
            await session.execute(
                select(NtsRecordAuditEvent).where(
                    NtsRecordAuditEvent.record_id == uuid4().__class__(record_id)
                )
            )
        )
        .scalars()
        .all()
    )
    await session.close()

    response = await api.post(
        f"{BASE}/records/{record_id}/findings",
        headers=env.dentist,
        json={
            "expected_version": 1,
            "rule_id": "6.1.16",
            "attributes": {"caries_type": "NO_EXISTE", "surfaces": ["O"]},
            "targets": CARIES["targets"],
        },
    )
    assert response.status_code == 422
    body = response.json()
    assert len(body["errors"]) >= 1
    assert any("NO_EXISTE" in e for e in body["errors"])

    verify = inspect()
    stored = await verify.get(NtsOdontogramRecord, uuid4().__class__(record_id))
    await verify.refresh(stored)
    assert stored.version == 1, "the version bump must not survive a 4xx"
    after_events = len(
        (
            await verify.execute(
                select(NtsRecordAuditEvent).where(
                    NtsRecordAuditEvent.record_id == uuid4().__class__(record_id)
                )
            )
        )
        .scalars()
        .all()
    )
    assert after_events == before_events, "no audit event may survive a rollback"


@pytest.mark.asyncio
async def test_a_stale_expected_version_conflicts_without_overwriting(api, env):
    draft = await _create_draft(api, env)
    record_id = draft["id"]

    first = await api.patch(
        f"{BASE}/records/{record_id}",
        headers=env.dentist,
        json={"expected_version": 1, "observations": "A llegó primero"},
    )
    assert first.status_code == 200
    assert first.json()["data"]["version"] == 2

    second = await api.patch(
        f"{BASE}/records/{record_id}",
        headers=env.dentist,
        json={"expected_version": 1, "observations": "B llega tarde"},
    )
    assert second.status_code == 409
    assert second.json()["code"] == "nts_version_conflict"

    current = await api.get(f"{BASE}/records/{record_id}", headers=env.dentist)
    assert current.json()["data"]["observations"] == "A llegó primero"
    assert current.json()["data"]["version"] == 2


# ===========================================================================
# access and permissions
# ===========================================================================


@pytest.mark.asyncio
async def test_anonymous_requests_are_rejected(api, env):
    response = await api.get(f"{BASE}/catalogs")
    assert response.status_code in (401, 403)


@pytest.mark.asyncio
async def test_a_role_without_write_cannot_mutate(api, env):
    """`assistant` holds odontogram.read but not odontogram.write."""
    readable = await api.get(f"{BASE}/catalogs", headers=env.assistant)
    assert readable.status_code == 200

    response = await api.post(
        f"{BASE}/patients/{env.patient}/records",
        headers=env.assistant,
        json={"norm_version": NORM, "stage": "diagnosis"},
    )
    assert response.status_code == 403


@pytest.mark.asyncio
async def test_a_patient_of_another_clinic_is_invisible(api, env):
    response = await api.get(
        f"{BASE}/patients/{env.foreign_patient}/records",
        headers=env.dentist,
        params={"norm_version": NORM},
    )
    assert response.status_code == 404


@pytest.mark.asyncio
async def test_a_record_of_another_clinic_answers_404_not_403(api, env):
    """404, so a caller cannot confirm that someone else's record exists."""
    draft = await _create_draft(api, env)
    response = await api.get(f"{BASE}/records/{draft['id']}", headers=env.outsider)
    assert response.status_code == 404


@pytest.mark.asyncio
async def test_an_unknown_record_is_a_404(api, env):
    response = await api.get(f"{BASE}/records/{uuid4()}", headers=env.dentist)
    assert response.status_code == 404
    assert response.json()["code"] == "nts_record_not_found"


# ===========================================================================
# current / draft semantics
# ===========================================================================


@pytest.mark.asyncio
async def test_absent_current_and_draft_are_200_with_null(api, env):
    """Having no record yet is an ordinary state, not an error."""
    for suffix in ("current", "draft"):
        response = await api.get(
            f"{BASE}/patients/{env.patient}/records/{suffix}",
            headers=env.dentist,
            params={"norm_version": NORM},
        )
        assert response.status_code == 200, suffix
        assert response.json()["data"] is None, suffix


@pytest.mark.asyncio
async def test_an_unknown_norm_is_distinguishable_from_an_empty_history(api, env):
    response = await api.get(
        f"{BASE}/patients/{env.patient}/records/current",
        headers=env.dentist,
        params={"norm_version": "pe_nts_999_2099"},
    )
    assert response.status_code == 404
    assert response.json()["code"] == "nts_norm_version_unknown"


@pytest.mark.asyncio
async def test_a_second_draft_is_a_409(api, env):
    await _create_draft(api, env)
    response = await api.post(
        f"{BASE}/patients/{env.patient}/records",
        headers=env.dentist,
        json={"norm_version": NORM, "stage": "diagnosis"},
    )
    assert response.status_code == 409
    assert response.json()["code"] == "nts_draft_conflict"


# ===========================================================================
# metadata tri-state
# ===========================================================================


@pytest.mark.asyncio
async def test_metadata_distinguishes_absent_from_explicit_null(api, env):
    draft = await _create_draft(
        api, env, stage="other", stage_label="Interconsulta", observations="inicial"
    )
    record_id = draft["id"]

    # key absent -> untouched
    untouched = await api.patch(
        f"{BASE}/records/{record_id}",
        headers=env.dentist,
        json={"expected_version": 1, "stage": "evolution"},
    )
    assert untouched.status_code == 200
    data = untouched.json()["data"]
    assert data["stage"] == "evolution"
    assert data["stage_label"] == "Interconsulta"
    assert data["observations"] == "inicial"

    # explicit null -> cleared
    cleared = await api.patch(
        f"{BASE}/records/{record_id}",
        headers=env.dentist,
        json={"expected_version": 2, "observations": None, "stage_label": None},
    )
    assert cleared.status_code == 200
    data = cleared.json()["data"]
    assert data["observations"] is None
    assert data["stage_label"] is None
    assert data["version"] == 3


@pytest.mark.asyncio
async def test_an_empty_observations_string_is_stored_literally(api, env):
    """Not folded into NULL: "" and null are different answers."""
    draft = await _create_draft(api, env)
    response = await api.patch(
        f"{BASE}/records/{draft['id']}",
        headers=env.dentist,
        json={"expected_version": 1, "observations": ""},
    )
    assert response.status_code == 200
    assert response.json()["data"]["observations"] == ""


@pytest.mark.asyncio
async def test_unknown_body_fields_are_rejected(api, env):
    """extra="forbid" stops a client smuggling server-owned fields in."""
    response = await api.post(
        f"{BASE}/patients/{env.patient}/records",
        headers=env.dentist,
        json={
            "norm_version": NORM,
            "stage": "diagnosis",
            "clinic_id": str(uuid4()),
            "status": "finalized",
        },
    )
    assert response.status_code == 422


# ===========================================================================
# findings, targets, specifications
# ===========================================================================


@pytest.mark.asyncio
async def test_mutations_report_the_real_version_never_arithmetic(api, env):
    draft = await _create_draft(api, env)
    record_id = draft["id"]

    created = await api.post(
        f"{BASE}/records/{record_id}/findings",
        headers=env.dentist,
        json={"expected_version": 1, **CARIES},
    )
    assert created.status_code == 201
    body = created.json()["data"]
    assert body["record_version"] == 2
    finding_id = body["finding"]["id"]
    assert body["finding"]["provenance"] == "observed"
    assert [t["tooth_number"] for t in body["finding"]["targets"]] == [46]
    assert body["finding"]["targets"][0]["geometry"] is None

    replaced = await api.put(
        f"{BASE}/records/{record_id}/findings/{finding_id}",
        headers=env.dentist,
        json={
            "expected_version": 2,
            "attributes": {"caries_type": "CE", "surfaces": ["O", "M"]},
        },
    )
    assert replaced.status_code == 200
    assert replaced.json()["data"]["record_version"] == 3
    assert replaced.json()["data"]["finding"]["attributes"]["caries_type"] == "CE"

    # replacing several targets is still one bump
    targets = await api.put(
        f"{BASE}/records/{record_id}/findings/{finding_id}/targets",
        headers=env.dentist,
        json={
            "expected_version": 3,
            "targets": [
                {
                    "participation": "subject",
                    "target_kind": "fdi_tooth",
                    "tooth_number": 47,
                }
            ],
        },
    )
    assert targets.status_code == 200
    assert targets.json()["data"]["record_version"] == 4

    removed = await api.post(
        f"{BASE}/records/{record_id}/findings/{finding_id}/remove",
        headers=env.dentist,
        json={"expected_version": 4},
    )
    assert removed.status_code == 200
    assert removed.json()["data"]["record_version"] == 5

    final = await api.get(f"{BASE}/records/{record_id}", headers=env.dentist)
    assert final.json()["data"]["findings"] == []


@pytest.mark.asyncio
async def test_a_mutation_is_visible_to_the_next_read(api, env):
    """populate_existing keeps a reused identity map from serving stale rows."""
    draft = await _create_draft(api, env)
    record_id = draft["id"]
    await api.post(
        f"{BASE}/records/{record_id}/findings",
        headers=env.dentist,
        json={"expected_version": 1, **CARIES},
    )
    response = await api.get(f"{BASE}/records/{record_id}", headers=env.dentist)
    data = response.json()["data"]
    assert len(data["findings"]) == 1
    assert data["version"] == 2


@pytest.mark.asyncio
async def test_specification_put_is_a_full_replacement(api, env):
    draft = await _create_draft(api, env)
    record_id = draft["id"]
    finding = (
        await api.post(
            f"{BASE}/records/{record_id}/findings",
            headers=env.dentist,
            json={"expected_version": 1, **TEMP_CROWN},
        )
    ).json()["data"]["finding"]

    created = await api.post(
        f"{BASE}/records/{record_id}/specifications",
        headers=env.dentist,
        json={"expected_version": 2, "text": "Acrílico", "finding_id": finding["id"]},
    )
    assert created.status_code == 201
    specification_id = created.json()["data"]["specification"]["id"]

    # finding_id is required even when null, so omitting it is a 422 rather
    # than a silent unlink.
    ambiguous = await api.put(
        f"{BASE}/records/{record_id}/specifications/{specification_id}",
        headers=env.dentist,
        json={"expected_version": 3, "text": "Sin finding"},
    )
    assert ambiguous.status_code == 422

    unlinked = await api.put(
        f"{BASE}/records/{record_id}/specifications/{specification_id}",
        headers=env.dentist,
        json={"expected_version": 3, "text": "Ahora general", "finding_id": None},
    )
    assert unlinked.status_code == 200
    assert unlinked.json()["data"]["specification"]["finding_id"] is None

    removed = await api.post(
        f"{BASE}/records/{record_id}/specifications/{specification_id}/remove",
        headers=env.dentist,
        json={"expected_version": 4},
    )
    assert removed.status_code == 200
    assert removed.json()["data"]["record_version"] == 5


# ===========================================================================
# finalize
# ===========================================================================


@pytest.mark.asyncio
async def test_finalize_locks_the_record_and_stamps_its_digest(api, env):
    draft = await _create_draft(api, env)
    record_id = draft["id"]
    await api.post(
        f"{BASE}/records/{record_id}/findings",
        headers=env.dentist,
        json={"expected_version": 1, **CARIES},
    )

    response = await api.post(
        f"{BASE}/records/{record_id}/finalize",
        headers=env.dentist,
        json={"expected_version": 2},
    )
    assert response.status_code == 200
    data = response.json()["data"]
    assert data["status"] == "finalized"
    assert len(data["content_hash"]) == 64
    assert data["hash_algorithm"] == "sha256"
    assert data["canonicalization_version"] == 1
    assert data["recorded_by_name"] == "Ana Pérez"
    assert data["recorded_by_role"] == "admin"

    # terminal: every further mutation is a 409
    for method, path, body in (
        ("patch", f"{BASE}/records/{record_id}", {"expected_version": 3, "stage": "alta"}),
        (
            "post",
            f"{BASE}/records/{record_id}/findings",
            {"expected_version": 3, **CARIES},
        ),
        (
            "post",
            f"{BASE}/records/{record_id}/discard",
            {"expected_version": 3, "reason": "tarde"},
        ),
    ):
        blocked = await getattr(api, method)(path, headers=env.dentist, json=body)
        assert blocked.status_code == 409, path
        assert blocked.json()["code"] == "nts_state_conflict", path


@pytest.mark.asyncio
async def test_a_missing_required_specification_blocks_finalize(api, env):
    draft = await _create_draft(api, env)
    record_id = draft["id"]
    finding = (
        await api.post(
            f"{BASE}/records/{record_id}/findings",
            headers=env.dentist,
            json={"expected_version": 1, **TEMP_CROWN},
        )
    ).json()["data"]["finding"]

    blocked = await api.post(
        f"{BASE}/records/{record_id}/finalize",
        headers=env.dentist,
        json={"expected_version": 2},
    )
    assert blocked.status_code == 422
    assert any("temporary_crown_material" in e for e in blocked.json()["errors"])

    await api.post(
        f"{BASE}/records/{record_id}/specifications",
        headers=env.dentist,
        json={
            "expected_version": 2,
            "text": "Acrílico autocurable",
            "finding_id": finding["id"],
        },
    )
    allowed = await api.post(
        f"{BASE}/records/{record_id}/finalize",
        headers=env.dentist,
        json={"expected_version": 3},
    )
    assert allowed.status_code == 200


@pytest.mark.asyncio
async def test_a_non_blocking_requirement_does_not_stop_finalize(api, env):
    """6.1.3 carries required=false; it is surfaced, never enforced."""
    draft = await _create_draft(api, env)
    record_id = draft["id"]
    await api.post(
        f"{BASE}/records/{record_id}/findings",
        headers=env.dentist,
        json={
            "expected_version": 1,
            "rule_id": "6.1.3",
            "attributes": {"crown_type": "CM", "condition_state": "good"},
            "targets": [
                {
                    "participation": "subject",
                    "target_kind": "fdi_tooth",
                    "tooth_number": 26,
                }
            ],
        },
    )
    response = await api.post(
        f"{BASE}/records/{record_id}/finalize",
        headers=env.dentist,
        json={"expected_version": 2},
    )
    assert response.status_code == 200


@pytest.mark.asyncio
async def test_an_empty_record_can_be_finalized(api, env):
    draft = await _create_draft(api, env)
    response = await api.post(
        f"{BASE}/records/{draft['id']}/finalize",
        headers=env.dentist,
        json={"expected_version": 1},
    )
    assert response.status_code == 200
    assert response.json()["data"]["content_hash"] is not None


# ===========================================================================
# carry-forward
# ===========================================================================


@pytest.mark.asyncio
async def test_carry_forward_seeds_findings_for_individual_review(api, env):
    source = await _create_draft(api, env)
    await api.post(
        f"{BASE}/records/{source['id']}/findings",
        headers=env.dentist,
        json={"expected_version": 1, **CARIES},
    )
    await api.post(
        f"{BASE}/records/{source['id']}/finalize",
        headers=env.dentist,
        json={"expected_version": 2},
    )

    draft = await _create_draft(api, env, seed="carry_forward")
    assert len(draft["findings"]) == 1
    carried = draft["findings"][0]
    assert carried["provenance"] == "carried_forward"
    assert carried["source_finding_id"] is not None

    blocked = await api.post(
        f"{BASE}/records/{draft['id']}/finalize",
        headers=env.dentist,
        json={"expected_version": 1},
    )
    assert blocked.status_code == 422
    assert any("carried-forward" in e for e in blocked.json()["errors"])

    confirmed = await api.post(
        f"{BASE}/records/{draft['id']}/findings/{carried['id']}/confirm",
        headers=env.dentist,
        json={"expected_version": 1},
    )
    assert confirmed.status_code == 200
    assert confirmed.json()["data"]["finding"]["provenance"] == "observed"
    assert confirmed.json()["data"]["finding"]["source_finding_id"] is not None

    allowed = await api.post(
        f"{BASE}/records/{draft['id']}/finalize",
        headers=env.dentist,
        json={"expected_version": 2},
    )
    assert allowed.status_code == 200


@pytest.mark.asyncio
async def test_carry_forward_without_a_source_is_refused(api, env):
    response = await api.post(
        f"{BASE}/patients/{env.patient}/records",
        headers=env.dentist,
        json={"norm_version": NORM, "stage": "diagnosis", "seed": "carry_forward"},
    )
    assert response.status_code == 409


# ===========================================================================
# supersession and history
# ===========================================================================


@pytest.mark.asyncio
async def test_a_correction_never_modifies_its_predecessor(api, env):
    first = await _create_draft(api, env)
    await api.post(
        f"{BASE}/records/{first['id']}/finalize",
        headers=env.dentist,
        json={"expected_version": 1},
    )
    before = (await api.get(f"{BASE}/records/{first['id']}", headers=env.dentist)).json()["data"]

    correction = await _create_draft(
        api,
        env,
        supersedes_record_id=first["id"],
        supersession_reason="error material",
    )
    await api.post(
        f"{BASE}/records/{correction['id']}/finalize",
        headers=env.dentist,
        json={"expected_version": 1},
    )

    after = (await api.get(f"{BASE}/records/{first['id']}", headers=env.dentist)).json()["data"]
    for field in ("status", "content_hash", "version", "updated_at"):
        assert after[field] == before[field], field

    current = await api.get(
        f"{BASE}/patients/{env.patient}/records/current",
        headers=env.dentist,
        params={"norm_version": NORM},
    )
    assert current.json()["data"]["id"] == correction["id"]


@pytest.mark.asyncio
async def test_the_history_lists_records_without_their_aggregates(api, env):
    first = await _create_draft(api, env)
    await api.post(
        f"{BASE}/records/{first['id']}/finalize",
        headers=env.dentist,
        json={"expected_version": 1},
    )
    correction = await _create_draft(
        api, env, supersedes_record_id=first["id"], supersession_reason="corrige"
    )
    await api.post(
        f"{BASE}/records/{correction['id']}/finalize",
        headers=env.dentist,
        json={"expected_version": 1},
    )

    response = await api.get(f"{BASE}/patients/{env.patient}/records", headers=env.dentist)
    assert response.status_code == 200
    body = response.json()
    assert body["total"] == 2
    rows = {r["id"]: r for r in body["data"]}
    assert rows[first["id"]]["is_superseded"] is True
    assert rows[correction["id"]]["is_superseded"] is False
    assert "findings" not in body["data"][0]

    filtered = await api.get(
        f"{BASE}/patients/{env.patient}/records",
        headers=env.dentist,
        params={"status": "draft"},
    )
    assert filtered.json()["total"] == 0


@pytest.mark.asyncio
async def test_discard_keeps_the_record_and_leaves_the_hash_null(api, env):
    draft = await _create_draft(api, env)
    response = await api.post(
        f"{BASE}/records/{draft['id']}/discard",
        headers=env.dentist,
        json={"expected_version": 1, "reason": "paciente no regresó"},
    )
    assert response.status_code == 200
    data = response.json()["data"]
    assert data["status"] == "discarded"
    assert data["discard_reason"] == "paciente no regresó"
    assert data["content_hash"] is None

    # still retrievable, and not the current record
    assert (await api.get(f"{BASE}/records/{draft['id']}", headers=env.dentist)).status_code == 200
    current = await api.get(
        f"{BASE}/patients/{env.patient}/records/current",
        headers=env.dentist,
        params={"norm_version": NORM},
    )
    assert current.json()["data"] is None


# ===========================================================================
# NTS-05E.1 — a finalized record refuses its own text, server-side
# ===========================================================================
#
# The guard is one statement — the version bump also requires
# ``status = 'draft'`` — so these do not re-test the service. They pin it at
# the edge a client actually meets, because 05E.2 will put an editor in front
# of exactly these four routes and a UI check is not a defence.


async def _finalized_record(api, env) -> dict:
    draft = await _create_draft(api, env)
    response = await api.post(
        f"{BASE}/records/{draft['id']}/finalize",
        headers=env.dentist,
        json={"expected_version": 1},
    )
    assert response.status_code == 200
    return response.json()["data"]


@pytest.mark.asyncio
async def test_a_finalized_record_refuses_new_observations(api, env):
    record = await _finalized_record(api, env)

    response = await api.patch(
        f"{BASE}/records/{record['id']}",
        headers=env.dentist,
        json={"expected_version": record["version"], "observations": "tarde"},
    )

    assert response.status_code == 409
    assert response.json()["code"] == "nts_state_conflict"


@pytest.mark.asyncio
async def test_a_finalized_record_refuses_a_new_specification(api, env):
    record = await _finalized_record(api, env)

    response = await api.post(
        f"{BASE}/records/{record['id']}/specifications",
        headers=env.dentist,
        json={"expected_version": record["version"], "text": "tarde"},
    )

    assert response.status_code == 409
    assert response.json()["code"] == "nts_state_conflict"


@pytest.mark.asyncio
async def test_a_finalized_record_refuses_to_change_or_drop_a_specification(api, env):
    """The entry is written while the record is still a draft, then frozen."""
    draft = await _create_draft(api, env)
    created = await api.post(
        f"{BASE}/records/{draft['id']}/specifications",
        headers=env.dentist,
        json={"expected_version": 1, "text": "mancha blanca en 12"},
    )
    assert created.status_code == 201
    specification_id = created.json()["data"]["specification"]["id"]

    finalized = await api.post(
        f"{BASE}/records/{draft['id']}/finalize",
        headers=env.dentist,
        json={"expected_version": 2},
    )
    assert finalized.status_code == 200
    version = finalized.json()["data"]["version"]

    replaced = await api.put(
        f"{BASE}/records/{draft['id']}/specifications/{specification_id}",
        headers=env.dentist,
        json={"expected_version": version, "text": "corregido", "finding_id": None},
    )
    assert replaced.status_code == 409
    assert replaced.json()["code"] == "nts_state_conflict"

    removed = await api.post(
        f"{BASE}/records/{draft['id']}/specifications/{specification_id}/remove",
        headers=env.dentist,
        json={"expected_version": version},
    )
    assert removed.status_code == 409
    assert removed.json()["code"] == "nts_state_conflict"

    # And it is still there, unchanged: a refused write changed nothing.
    read = await api.get(f"{BASE}/records/{draft['id']}", headers=env.dentist)
    entries = read.json()["data"]["specifications"]
    assert [e["text"] for e in entries] == ["mancha blanca en 12"]
