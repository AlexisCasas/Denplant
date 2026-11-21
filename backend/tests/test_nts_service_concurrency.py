"""Two-session concurrency and hash reproducibility for NTS records.

These need real, separate ``AsyncSession`` objects against
``dental_clinic_test`` — a single session could not demonstrate that the
parent row lock serialises writers, nor that a stored digest depends on
persisted content rather than on whatever the ORM happened to hold.
"""

import asyncio
from types import SimpleNamespace
from uuid import uuid4

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool

from app.core.auth.models import Clinic, ClinicMembership, User
from app.modules.odontogram.nts.canonical import (
    build_canonical_snapshot_v1,
    serialize_canonical_v1,
    sha256_canonical_v1,
)
from app.modules.odontogram.nts.exceptions import NtsVersionConflictError
from app.modules.odontogram.nts.models import NtsOdontogramRecord
from app.modules.odontogram.nts.service import (
    FindingSpec,
    NtsRecordService,
    TargetSpec,
)
from app.modules.patients.models import Patient
from tests import db_isolation

NORM = "pe_nts_188_2022"

CARIES = FindingSpec(
    rule_id="6.1.16",
    attributes={"caries_type": "CDP", "surfaces": ["O"]},
    targets=[TargetSpec(participation="subject", target_kind="fdi_tooth", tooth_number=46)],
)


@pytest.fixture
async def seeded(db_session: AsyncSession, test_clinic: Clinic, test_patient: Patient):
    """Clinic, patient and actor, committed so other sessions can see them."""
    user = User(
        id=uuid4(),
        email=f"nts-{uuid4().hex[:8]}@example.com",
        password_hash="x",
        first_name="Ana",
        last_name="Pérez",
        professional_id="COP-1",
    )
    db_session.add(user)
    await db_session.flush()
    db_session.add(
        ClinicMembership(id=uuid4(), user_id=user.id, clinic_id=test_clinic.id, role="dentist")
    )
    await db_session.commit()
    ids = SimpleNamespace(clinic=test_clinic.id, patient=test_patient.id, actor=user.id)
    # Release every lock this session holds before other writers appear.
    await db_session.rollback()
    return ids


@pytest.fixture
async def make_session(seeded):
    """Independent sessions on the same test database."""
    engine = create_async_engine(db_isolation.TEST_DATABASE_URL, echo=False, poolclass=NullPool)
    maker = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    created: list[AsyncSession] = []

    def factory() -> AsyncSession:
        session = maker()
        created.append(session)
        return session

    yield factory

    for session in created:
        await session.close()
    await engine.dispose()


async def _new_draft(session: AsyncSession, ids) -> NtsOdontogramRecord:
    record = await NtsRecordService.create_draft(
        session,
        ids.clinic,
        patient_id=ids.patient,
        norm_version=NORM,
        stage="diagnosis",
        actor_id=ids.actor,
    )
    await session.commit()
    return record


# --- concurrency -----------------------------------------------------------


@pytest.mark.asyncio
async def test_the_second_writer_conflicts_instead_of_overwriting(make_session, seeded):
    setup = make_session()
    record = await _new_draft(setup, seeded)
    record_id = record.id
    await setup.close()

    session_a, session_b = make_session(), make_session()

    # Both read the same version.
    a = await NtsRecordService.get_record(session_a, seeded.clinic, record_id)
    b = await NtsRecordService.get_record(session_b, seeded.clinic, record_id)
    assert a.version == b.version == 1

    await NtsRecordService.update_metadata(
        session_a,
        seeded.clinic,
        record_id,
        expected_version=1,
        actor_id=seeded.actor,
        observations="A llegó primero",
    )
    await session_a.commit()

    with pytest.raises(NtsVersionConflictError):
        await NtsRecordService.update_metadata(
            session_b,
            seeded.clinic,
            record_id,
            expected_version=1,
            actor_id=seeded.actor,
            observations="B llega tarde",
        )
    await session_b.rollback()

    # No last-write-wins: A's value stands and the version moved exactly once.
    verifier = make_session()
    stored = await NtsRecordService.get_record(verifier, seeded.clinic, record_id)
    assert stored.observations == "A llegó primero"
    assert stored.version == 2


@pytest.mark.asyncio
async def test_the_parent_lock_serialises_concurrent_child_writers(make_session, seeded):
    """Two sessions adding findings at once: one wins, the other conflicts.

    The second writer blocks on the parent row lock rather than racing, and
    when it is released the version has moved, so its expected_version no
    longer matches.
    """
    setup = make_session()
    record = await _new_draft(setup, seeded)
    record_id = record.id
    await setup.close()

    session_a, session_b = make_session(), make_session()

    await NtsRecordService.create_finding(
        session_a,
        seeded.clinic,
        record_id,
        expected_version=1,
        actor_id=seeded.actor,
        spec=CARIES,
    )
    # A holds the parent row lock; it has not committed yet.

    async def writer_b():
        return await NtsRecordService.create_finding(
            session_b,
            seeded.clinic,
            record_id,
            expected_version=1,
            actor_id=seeded.actor,
            spec=FindingSpec(
                rule_id="6.1.16",
                attributes={"caries_type": "CE", "surfaces": ["M"]},
                targets=[
                    TargetSpec(
                        participation="subject",
                        target_kind="fdi_tooth",
                        tooth_number=36,
                    )
                ],
            ),
        )

    task = asyncio.create_task(writer_b())
    await asyncio.sleep(0.25)
    assert not task.done(), "B should be waiting on the parent row lock"

    await session_a.commit()

    with pytest.raises(NtsVersionConflictError):
        await asyncio.wait_for(task, timeout=10)
    await session_b.rollback()

    verifier = make_session()
    stored = await NtsRecordService.get_record(verifier, seeded.clinic, record_id)
    assert stored.version == 2
    assert len(stored.findings) == 1
    assert stored.findings[0].attributes["caries_type"] == "CDP"


@pytest.mark.asyncio
async def test_a_conflict_leaves_no_partial_child_behind(make_session, seeded):
    setup = make_session()
    record = await _new_draft(setup, seeded)
    record_id = record.id
    await setup.close()

    winner, loser = make_session(), make_session()
    await NtsRecordService.create_finding(
        winner,
        seeded.clinic,
        record_id,
        expected_version=1,
        actor_id=seeded.actor,
        spec=CARIES,
    )
    await winner.commit()

    with pytest.raises(NtsVersionConflictError):
        await NtsRecordService.create_finding(
            loser,
            seeded.clinic,
            record_id,
            expected_version=1,
            actor_id=seeded.actor,
            spec=CARIES,
        )
    await loser.rollback()

    verifier = make_session()
    stored = await NtsRecordService.get_record(verifier, seeded.clinic, record_id)
    assert len(stored.findings) == 1


# --- hash reproducibility --------------------------------------------------


@pytest.mark.asyncio
async def test_the_stored_digest_is_reproducible_from_a_fresh_session(make_session, seeded):
    """Close the session, open another, rebuild the snapshot, rehash.

    If the digest depended on anything the ORM happened to hold rather than
    on persisted content, this is where it would show.
    """
    writer = make_session()
    record = await _new_draft(writer, seeded)
    record_id = record.id

    await NtsRecordService.create_finding(
        writer,
        seeded.clinic,
        record_id,
        expected_version=1,
        actor_id=seeded.actor,
        spec=CARIES,
    )
    await writer.commit()
    await NtsRecordService.set_specification(
        writer,
        seeded.clinic,
        record_id,
        expected_version=2,
        actor_id=seeded.actor,
        text="Especificación general",
    )
    await writer.commit()
    await NtsRecordService.update_metadata(
        writer,
        seeded.clinic,
        record_id,
        expected_version=3,
        actor_id=seeded.actor,
        observations="Línea alba marcada.\nRefiere bruxismo.",
    )
    await writer.commit()

    finalized = await NtsRecordService.finalize(
        writer, seeded.clinic, record_id, expected_version=4, actor_id=seeded.actor
    )
    await writer.commit()
    stored_hash = finalized.content_hash
    assert stored_hash is not None
    await writer.close()

    reader = make_session()
    reloaded = await NtsRecordService.get_record(reader, seeded.clinic, record_id)

    assert sha256_canonical_v1(reloaded) == stored_hash
    assert reloaded.hash_algorithm == "sha256"
    assert reloaded.canonicalization_version == 1

    # ...and a third session produces byte-identical canonical output.
    third = make_session()
    again = await NtsRecordService.get_record(third, seeded.clinic, record_id)
    assert serialize_canonical_v1(build_canonical_snapshot_v1(again)) == serialize_canonical_v1(
        build_canonical_snapshot_v1(reloaded)
    )


@pytest.mark.asyncio
async def test_the_digest_covers_the_content_not_the_bookkeeping(make_session, seeded):
    """Two records with identical clinical content still differ.

    `id`, `patient_id` and the timestamps are part of the attestation, so a
    digest cannot be transplanted between records.
    """
    session = make_session()
    first = await _new_draft(session, seeded)
    await NtsRecordService.finalize(
        session, seeded.clinic, first.id, expected_version=1, actor_id=seeded.actor
    )
    await session.commit()

    second = await _new_draft(session, seeded)
    await NtsRecordService.finalize(
        session, seeded.clinic, second.id, expected_version=1, actor_id=seeded.actor
    )
    await session.commit()

    assert first.content_hash != second.content_hash


# --- transaction ownership -------------------------------------------------


@pytest.mark.asyncio
async def test_the_service_never_commits_on_its_own(make_session, seeded):
    """Everything the service did must vanish if the caller rolls back."""
    session = make_session()
    record = await _new_draft(session, seeded)
    record_id = record.id

    await NtsRecordService.create_finding(
        session,
        seeded.clinic,
        record_id,
        expected_version=1,
        actor_id=seeded.actor,
        spec=CARIES,
    )
    await NtsRecordService.set_specification(
        session,
        seeded.clinic,
        record_id,
        expected_version=2,
        actor_id=seeded.actor,
        text="se perderá",
    )
    await session.rollback()

    verifier = make_session()
    stored = await NtsRecordService.get_record(verifier, seeded.clinic, record_id)
    assert stored.version == 1
    assert stored.findings == []
    assert stored.specifications == []
    events = (
        (
            await verifier.execute(
                select(NtsOdontogramRecord.id).where(NtsOdontogramRecord.id == record_id)
            )
        )
        .scalars()
        .all()
    )
    assert events == [record_id]
