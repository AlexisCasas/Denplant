"""NTS record persistence — database invariants (NTS-04B.1).

Structural guarantees only: the lifecycle, the coherence triples, the
partial unique indexes, the composite foreign keys and the two triggers.
Normative validation (does ``rule_id`` exist, do ``attributes`` match the
rule) belongs to the service against the catalog and is deliberately not
tested here, because it is deliberately not in the DDL.
"""

from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from uuid import uuid4

import pytest
from sqlalchemy import select, text
from sqlalchemy.exc import DBAPIError, IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth.models import Clinic, User
from app.modules.odontogram.nts.models import (
    NtsFinding,
    NtsFindingTarget,
    NtsOdontogramRecord,
    NtsRecordAuditEvent,
    NtsRecordSpecification,
)
from app.modules.patients.models import Patient

NORM = "pe_nts_188_2022"
HASH_A = "a" * 64


@pytest.fixture
async def actor(db_session: AsyncSession) -> User:
    user = User(
        id=uuid4(),
        email=f"nts-{uuid4().hex[:8]}@example.com",
        password_hash="x",
        first_name="Ana",
        last_name="Pérez",
        professional_id="COP-12345",
    )
    db_session.add(user)
    await db_session.commit()
    return user


@pytest.fixture
async def ids(test_clinic: Clinic, test_patient: Patient, actor: User):
    """Plain UUIDs.

    A rejected flush must be rolled back, and a rollback expires every ORM
    instance in the session — including the fixtures. Reading a stale
    instance would then attempt lazy IO inside the async session and raise
    MissingGreenlet, so the tests hold plain values instead.
    """
    return SimpleNamespace(clinic=test_clinic.id, patient=test_patient.id, actor=actor.id)


def _record(ids, **kwargs):
    base = {
        "id": uuid4(),
        "clinic_id": ids.clinic,
        "patient_id": ids.patient,
        "norm_version": NORM,
        "stage": "diagnosis",
        "status": "draft",
        "version": 1,
        "recorded_at": datetime.now(UTC),
        "recorded_by": ids.actor,
    }
    return NtsOdontogramRecord(**{**base, **kwargs})


def _finalized(ids, **kwargs):
    return _record(
        ids,
        status="finalized",
        finalized_at=kwargs.pop("finalized_at", datetime.now(UTC)),
        finalized_by=ids.actor,
        content_hash=kwargs.pop("content_hash", HASH_A),
        hash_algorithm="sha256",
        canonicalization_version=1,
        **kwargs,
    )


def _finding(record: NtsOdontogramRecord, ids, **kwargs):
    base = {
        "id": uuid4(),
        "record_id": record.id,
        "norm_version": record.norm_version,
        "rule_id": "6.1.16",
        "attributes": {"caries_type": "CDP"},
        "provenance": "observed",
        "sequence": 0,
        "created_at": datetime.now(UTC),
        "created_by": ids.actor,
    }
    return NtsFinding(**{**base, **kwargs})


def _target(finding: NtsFinding, **kwargs):
    base = {
        "id": uuid4(),
        "finding_id": finding.id,
        "group_index": 0,
        "position": 0,
        "participation": "subject",
        "target_kind": "fdi_tooth",
        "tooth_number": 46,
    }
    return NtsFindingTarget(**{**base, **kwargs})


async def _expect_rejection(db_session: AsyncSession, *rows):
    """Flush and require the database to refuse it, then leave a clean session."""
    for row in rows:
        db_session.add(row)
    with pytest.raises((IntegrityError, DBAPIError)):
        await db_session.flush()
    await db_session.rollback()


# --- A / B / C / D / E — lifecycle, one draft, supersession chain ----------


@pytest.mark.asyncio
async def test_only_one_draft_per_clinic_patient_norm(db_session: AsyncSession, ids):
    db_session.add(_record(ids))
    await db_session.commit()

    await _expect_rejection(db_session, _record(ids))


@pytest.mark.asyncio
async def test_a_second_draft_is_allowed_under_a_different_norm_version(
    db_session: AsyncSession, ids
):
    db_session.add(_record(ids))
    db_session.add(_record(ids, norm_version="other_norm"))
    await db_session.commit()

    count = len(
        (
            await db_session.execute(
                select(NtsOdontogramRecord).where(NtsOdontogramRecord.patient_id == ids.patient)
            )
        )
        .scalars()
        .all()
    )
    assert count == 2


@pytest.mark.asyncio
async def test_two_unrelated_finalized_records_are_allowed(db_session: AsyncSession, ids):
    """Ordinary clinical succession: neither supersedes the other."""
    db_session.add(_finalized(ids))
    db_session.add(_finalized(ids))
    await db_session.commit()


@pytest.mark.asyncio
async def test_supersession_chain_is_linear_and_forking_is_rejected(db_session: AsyncSession, ids):
    a = _finalized(ids)
    db_session.add(a)
    await db_session.flush()

    # A <- B <- C is allowed.
    b = _finalized(
        ids,
        supersedes_record_id=a.id,
        supersession_reason="corrige A",
    )
    db_session.add(b)
    await db_session.flush()
    c = _finalized(
        ids,
        supersedes_record_id=b.id,
        supersession_reason="corrige B",
    )
    db_session.add(c)
    await db_session.commit()

    # A <- B and A <- C at once would make "which record is current?"
    # ambiguous, so the partial unique index refuses it.
    await _expect_rejection(
        db_session,
        _finalized(
            ids,
            supersedes_record_id=a.id,
            supersession_reason="segunda corrección de A",
        ),
    )


@pytest.mark.asyncio
async def test_self_supersession_is_rejected(db_session: AsyncSession, ids):
    record = _finalized(ids)
    record.supersedes_record_id = record.id
    record.supersession_reason = "imposible"
    await _expect_rejection(db_session, record)


@pytest.mark.asyncio
async def test_supersession_id_and_reason_move_together(db_session: AsyncSession, ids):
    predecessor = _finalized(ids)
    db_session.add(predecessor)
    await db_session.commit()

    await _expect_rejection(
        db_session,
        _finalized(ids, supersedes_record_id=predecessor.id),
    )


# --- L / M / N — status coherence triples ---------------------------------


@pytest.mark.asyncio
async def test_finalized_requires_its_full_metadata(db_session: AsyncSession, ids):
    # finalized without finalized_at/by
    await _expect_rejection(
        db_session,
        _record(
            ids,
            status="finalized",
            content_hash=HASH_A,
            hash_algorithm="sha256",
            canonicalization_version=1,
        ),
    )
    # finalized without the hash triple
    await _expect_rejection(
        db_session,
        _record(
            ids,
            status="finalized",
            finalized_at=datetime.now(UTC),
            finalized_by=ids.actor,
        ),
    )


@pytest.mark.asyncio
async def test_a_draft_may_not_carry_a_content_hash(db_session: AsyncSession, ids):
    await _expect_rejection(
        db_session,
        _record(
            ids,
            content_hash=HASH_A,
            hash_algorithm="sha256",
            canonicalization_version=1,
        ),
    )


@pytest.mark.asyncio
async def test_content_hash_must_be_64_lowercase_hex(db_session: AsyncSession, ids):
    await _expect_rejection(db_session, _finalized(ids, content_hash="A" * 64))
    await _expect_rejection(db_session, _finalized(ids, content_hash="abc"))


@pytest.mark.asyncio
async def test_discarded_requires_at_by_and_reason(db_session: AsyncSession, ids):
    await _expect_rejection(
        db_session,
        _record(
            ids,
            status="discarded",
            discarded_at=datetime.now(UTC),
            discarded_by=ids.actor,
        ),
    )


@pytest.mark.asyncio
async def test_stage_other_requires_a_label(db_session: AsyncSession, ids):
    await _expect_rejection(db_session, _record(ids, stage="other"))
    db_session.add(
        _record(
            ids,
            stage="other",
            stage_label="Interconsulta",
        )
    )
    await db_session.commit()


@pytest.mark.asyncio
async def test_version_must_be_positive(db_session: AsyncSession, ids):
    await _expect_rejection(db_session, _record(ids, version=0))


# --- F / G — findings ------------------------------------------------------


@pytest.mark.asyncio
async def test_finding_norm_version_cannot_diverge_from_its_record(db_session: AsyncSession, ids):
    """The composite FK makes divergence structurally impossible."""
    record = _record(ids)
    db_session.add(record)
    await db_session.flush()

    await _expect_rejection(db_session, _finding(record, ids, norm_version="some_other_norm"))


@pytest.mark.asyncio
async def test_finding_sequence_is_unique_per_record(db_session: AsyncSession, ids):
    record = _record(ids)
    db_session.add(record)
    await db_session.flush()
    db_session.add(_finding(record, ids, sequence=1))
    await db_session.commit()

    await _expect_rejection(db_session, _finding(record, ids, sequence=1))


@pytest.mark.asyncio
async def test_finding_attributes_must_be_a_json_object(db_session: AsyncSession, ids):
    record = _record(ids)
    db_session.add(record)
    await db_session.flush()

    await _expect_rejection(db_session, _finding(record, ids, attributes=["nope"]))


# --- H / I / J / K — targets ----------------------------------------------


@pytest.mark.asyncio
async def test_every_valid_fdi_number_is_accepted(db_session: AsyncSession, ids):
    """Permanent 11-48 and deciduous 51-85 — the norm charts both."""
    from app.modules.odontogram.constants import ALL_TEETH

    record = _record(ids)
    db_session.add(record)
    await db_session.flush()
    finding = _finding(record, ids)
    db_session.add(finding)
    await db_session.flush()

    for position, tooth in enumerate(ALL_TEETH):
        db_session.add(_target(finding, position=position, tooth_number=tooth))
    await db_session.commit()

    stored = (
        (
            await db_session.execute(
                select(NtsFindingTarget).where(NtsFindingTarget.finding_id == finding.id)
            )
        )
        .scalars()
        .all()
    )
    assert len(stored) == len(ALL_TEETH)


@pytest.mark.asyncio
@pytest.mark.parametrize("tooth", [0, 9, 19, 20, 49, 50, 56, 86, 99, -11])
async def test_fake_fdi_numbers_are_rejected(
    db_session: AsyncSession,
    ids,
    tooth: int,
):
    record = _record(ids)
    db_session.add(record)
    await db_session.flush()
    finding = _finding(record, ids)
    db_session.add(finding)
    await db_session.flush()

    await _expect_rejection(db_session, _target(finding, tooth_number=tooth))


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "overrides",
    [
        # fdi_tooth without a number
        {"target_kind": "fdi_tooth", "tooth_number": None},
        # fdi_tooth carrying an arch
        {"target_kind": "fdi_tooth", "tooth_number": 11, "arch": "upper"},
        # unnumbered_tooth carrying a number — the sentinel this forbids
        {"target_kind": "unnumbered_tooth", "tooth_number": 11},
        # arch without an arch value
        {"target_kind": "arch", "tooth_number": None, "arch": None},
        # arch carrying a tooth
        {"target_kind": "arch", "tooth_number": 11, "arch": "upper"},
        # unknown arch value
        {"target_kind": "arch", "tooth_number": None, "arch": "middle"},
        # unknown participation
        {"participation": "member"},
        # unknown kind
        {"target_kind": "quadrant", "tooth_number": None},
        # negative slot coordinates
        {"group_index": -1},
        {"position": -1},
        # local_ordinal only belongs to an unnumbered subject
        {"local_ordinal": 1},
    ],
)
async def test_target_column_coherence_is_enforced(
    db_session: AsyncSession,
    ids,
    overrides: dict,
):
    record = _record(ids)
    db_session.add(record)
    await db_session.flush()
    finding = _finding(record, ids)
    db_session.add(finding)
    await db_session.flush()

    await _expect_rejection(db_session, _target(finding, **overrides))


@pytest.mark.asyncio
async def test_geometry_cannot_be_persisted_yet(db_session: AsyncSession, ids):
    """GEOMETRY CONTRACT PENDING is enforced by the database, not only by
    CanonicalSnapshotV1.

    Refusing at write time rather than at finalize means a draft can never
    accumulate a shape that would later block finalizing it.
    """
    record = _record(ids)
    db_session.add(record)
    await db_session.flush()
    finding = _finding(record, ids)
    db_session.add(finding)
    await db_session.flush()

    await _expect_rejection(db_session, _target(finding, geometry={"points": []}))


@pytest.mark.asyncio
async def test_an_explicit_none_geometry_lands_as_sql_null(db_session: AsyncSession, ids):
    """`geometry=None` must be SQL NULL, not the JSON value `null`.

    Without ``none_as_null`` SQLAlchemy stores Python None as JSON `null`,
    which `IS NULL` does not match — so the CHECK would reject any caller
    that set the field explicitly, and `IS NULL` queries would miss rows.
    """
    record = _record(ids)
    db_session.add(record)
    await db_session.flush()
    finding = _finding(record, ids)
    db_session.add(finding)
    await db_session.flush()
    target = _target(finding, geometry=None)
    db_session.add(target)
    await db_session.commit()

    is_sql_null = await db_session.scalar(
        text("SELECT geometry IS NULL FROM nts_finding_targets WHERE id = :i"),
        {"i": target.id},
    )
    assert is_sql_null is True


@pytest.mark.asyncio
async def test_a_finding_needs_an_existing_parent_record(db_session: AsyncSession, ids):
    """Parent existence is guaranteed by the composite FK alone.

    There is no separate FK on record_id; this is what proves the single
    constraint still covers the case the removed one used to.
    """
    orphan = NtsFinding(
        id=uuid4(),
        record_id=uuid4(),
        norm_version=NORM,
        rule_id="6.1.16",
        attributes={},
        provenance="observed",
        sequence=0,
        created_at=datetime.now(UTC),
        created_by=ids.actor,
    )
    await _expect_rejection(db_session, orphan)


@pytest.mark.asyncio
async def test_deleting_a_record_cascades_to_its_findings(db_session: AsyncSession, ids):
    """The composite FK carries the cascade the removed simple FK used to.

    Records cannot be deleted through the API — the guard trigger refuses
    it — so the cascade is exercised here by dropping the trigger inside
    this transaction only.
    """
    record = _record(ids)
    db_session.add(record)
    await db_session.flush()
    finding = _finding(record, ids)
    db_session.add(finding)
    await db_session.flush()
    db_session.add(_target(finding))
    await db_session.commit()
    record_id = record.id

    await db_session.execute(
        text("ALTER TABLE nts_odontogram_records DISABLE TRIGGER trg_nts_records_guard")
    )
    await db_session.execute(
        text("DELETE FROM nts_odontogram_records WHERE id = :i"), {"i": record_id}
    )
    await db_session.execute(
        text("ALTER TABLE nts_odontogram_records ENABLE TRIGGER trg_nts_records_guard")
    )
    await db_session.commit()

    assert (await db_session.execute(select(NtsFinding))).scalars().all() == []
    assert (await db_session.execute(select(NtsFindingTarget))).scalars().all() == []


@pytest.mark.asyncio
async def test_a_supernumerary_shape_is_accepted(db_session: AsyncSession, ids):
    """6.1.26: one unnumbered subject plus two spatial anchors."""
    record = _record(ids)
    db_session.add(record)
    await db_session.flush()
    finding = _finding(record, ids, rule_id="6.1.26", attributes={"sigla": "S"})
    db_session.add(finding)
    await db_session.flush()

    db_session.add(
        _target(
            finding,
            position=0,
            target_kind="unnumbered_tooth",
            tooth_number=None,
            local_ordinal=1,
        )
    )
    db_session.add(_target(finding, position=1, participation="anchor", tooth_number=11))
    db_session.add(_target(finding, position=2, participation="anchor", tooth_number=21))
    await db_session.commit()


@pytest.mark.asyncio
async def test_target_slot_is_unique_within_a_finding(db_session: AsyncSession, ids):
    record = _record(ids)
    db_session.add(record)
    await db_session.flush()
    finding = _finding(record, ids)
    db_session.add(finding)
    await db_session.flush()
    db_session.add(_target(finding, group_index=0, position=0))
    await db_session.commit()

    await _expect_rejection(
        db_session, _target(finding, group_index=0, position=0, tooth_number=47)
    )


@pytest.mark.asyncio
async def test_disjoint_segments_of_one_finding_are_accepted(db_session: AsyncSession, ids):
    """6.1.31: one removable prosthesis spanning two non-contiguous stretches."""
    record = _record(ids)
    db_session.add(record)
    await db_session.flush()
    finding = _finding(record, ids, rule_id="6.1.31", attributes={})
    db_session.add(finding)
    await db_session.flush()

    for group_index, teeth in ((0, (14, 15)), (1, (24, 25))):
        for position, tooth in enumerate(teeth):
            db_session.add(
                _target(
                    finding,
                    group_index=group_index,
                    position=position,
                    tooth_number=tooth,
                )
            )
    await db_session.commit()


# --- specifications --------------------------------------------------------


@pytest.mark.asyncio
async def test_specification_cannot_point_at_a_finding_of_another_record(
    db_session: AsyncSession, ids
):
    own = _record(ids)
    other = _finalized(ids)
    db_session.add_all([own, other])
    await db_session.flush()
    foreign_finding = _finding(other, ids)
    db_session.add(foreign_finding)
    await db_session.commit()
    own_id, foreign_finding_id = own.id, foreign_finding.id

    await _expect_rejection(
        db_session,
        NtsRecordSpecification(
            id=uuid4(),
            record_id=own_id,
            finding_id=foreign_finding_id,
            text="pertenece a otro record",
            sequence=0,
        ),
    )


@pytest.mark.asyncio
async def test_a_general_specification_needs_no_finding(db_session: AsyncSession, ids):
    record = _record(ids)
    db_session.add(record)
    await db_session.flush()
    db_session.add(
        NtsRecordSpecification(
            id=uuid4(), record_id=record.id, text="observación general", sequence=0
        )
    )
    await db_session.commit()


# --- O / P / Q — the record guard trigger ----------------------------------


@pytest.mark.asyncio
async def test_a_finalized_record_cannot_be_updated(db_session: AsyncSession, ids):
    record = _finalized(ids)
    db_session.add(record)
    await db_session.commit()

    with pytest.raises(DBAPIError, match="immutable"):
        await db_session.execute(
            text("UPDATE nts_odontogram_records SET observations = 'x' WHERE id = :i"),
            {"i": record.id},
        )
    await db_session.rollback()


@pytest.mark.asyncio
async def test_a_discarded_record_cannot_be_updated(db_session: AsyncSession, ids):
    record = _record(
        ids,
        status="discarded",
        discarded_at=datetime.now(UTC),
        discarded_by=ids.actor,
        discard_reason="abandonado",
    )
    db_session.add(record)
    await db_session.commit()

    with pytest.raises(DBAPIError, match="immutable"):
        await db_session.execute(
            text("UPDATE nts_odontogram_records SET observations = 'x' WHERE id = :i"),
            {"i": record.id},
        )
    await db_session.rollback()


@pytest.mark.asyncio
async def test_a_draft_may_still_be_updated_and_may_transition(db_session: AsyncSession, ids):
    """The guard must not block the transitions it exists to protect."""
    record = _record(ids)
    db_session.add(record)
    await db_session.commit()

    # draft -> draft
    await db_session.execute(
        text("UPDATE nts_odontogram_records SET version = version + 1 WHERE id = :i"),
        {"i": record.id},
    )
    # draft -> finalized
    await db_session.execute(
        text(
            "UPDATE nts_odontogram_records SET status = 'finalized', "
            "finalized_at = now(), finalized_by = :u, content_hash = :h, "
            "hash_algorithm = 'sha256', canonicalization_version = 1 WHERE id = :i"
        ),
        {"i": record.id, "u": ids.actor, "h": HASH_A},
    )
    await db_session.commit()

    stored = await db_session.get(NtsOdontogramRecord, record.id)
    await db_session.refresh(stored)
    assert stored.status == "finalized"


@pytest.mark.asyncio
async def test_a_draft_may_transition_to_discarded(db_session: AsyncSession, ids):
    record = _record(ids)
    db_session.add(record)
    await db_session.commit()

    await db_session.execute(
        text(
            "UPDATE nts_odontogram_records SET status = 'discarded', "
            "discarded_at = now(), discarded_by = :u, discard_reason = 'abandonado' "
            "WHERE id = :i"
        ),
        {"i": record.id, "u": ids.actor},
    )
    await db_session.commit()


@pytest.mark.asyncio
@pytest.mark.parametrize("status", ["draft", "finalized"])
async def test_no_nts_record_can_ever_be_deleted(
    db_session: AsyncSession,
    ids,
    status: str,
):
    record = _finalized(ids) if status == "finalized" else _record(ids)
    db_session.add(record)
    await db_session.commit()

    with pytest.raises(DBAPIError, match="cannot be deleted"):
        await db_session.execute(
            text("DELETE FROM nts_odontogram_records WHERE id = :i"), {"i": record.id}
        )
    await db_session.rollback()


# --- R / S / T — the audit trail -------------------------------------------


def _audit(record: NtsOdontogramRecord, ids, **kwargs):
    base = {
        "id": uuid4(),
        "clinic_id": record.clinic_id,
        "record_id": record.id,
        "record_version": 1,
        "entity_type": "record",
        "action": "record_created",
        "changed_by": ids.actor,
        "changed_at": datetime.now(UTC),
    }
    return NtsRecordAuditEvent(**{**base, **kwargs})


@pytest.mark.asyncio
async def test_audit_events_can_be_inserted(db_session: AsyncSession, ids):
    record = _record(ids)
    db_session.add(record)
    await db_session.flush()
    db_session.add(_audit(record, ids, new_state={"status": "draft"}, notes="creado"))
    db_session.add(
        _audit(
            record,
            ids,
            record_version=2,
            entity_type="finding",
            entity_id=uuid4(),
            action="finding_created",
            changed_at=datetime.now(UTC) + timedelta(seconds=1),
        )
    )
    await db_session.commit()

    rows = (
        (
            await db_session.execute(
                select(NtsRecordAuditEvent).where(NtsRecordAuditEvent.record_id == record.id)
            )
        )
        .scalars()
        .all()
    )
    assert len(rows) == 2


@pytest.mark.asyncio
async def test_audit_events_cannot_be_updated_or_deleted(db_session: AsyncSession, ids):
    record = _record(ids)
    db_session.add(record)
    await db_session.flush()
    event = _audit(record, ids)
    event_id = event.id
    db_session.add(event)
    await db_session.commit()

    with pytest.raises(DBAPIError, match="append-only"):
        await db_session.execute(
            text("UPDATE nts_record_audit_events SET notes = 'tampered' WHERE id = :i"),
            {"i": event_id},
        )
    await db_session.rollback()

    with pytest.raises(DBAPIError, match="append-only"):
        await db_session.execute(
            text("DELETE FROM nts_record_audit_events WHERE id = :i"), {"i": event_id}
        )
    await db_session.rollback()


@pytest.mark.asyncio
async def test_audit_action_and_entity_type_vocabularies_are_closed(db_session: AsyncSession, ids):
    record = _record(ids)
    db_session.add(record)
    await db_session.commit()
    frozen = SimpleNamespace(id=record.id, clinic_id=record.clinic_id)

    await _expect_rejection(db_session, _audit(frozen, ids, action="void"))
    await _expect_rejection(db_session, _audit(frozen, ids, entity_type="geometry"))
    await _expect_rejection(db_session, _audit(frozen, ids, record_version=0))


# --- cascades --------------------------------------------------------------


@pytest.mark.asyncio
async def test_removing_a_finding_cascades_to_its_targets(db_session: AsyncSession, ids):
    record = _record(ids)
    db_session.add(record)
    await db_session.flush()
    finding = _finding(record, ids)
    db_session.add(finding)
    await db_session.flush()
    db_session.add(_target(finding))
    await db_session.commit()

    await db_session.execute(text("DELETE FROM nts_findings WHERE id = :i"), {"i": finding.id})
    await db_session.commit()

    remaining = (await db_session.execute(select(NtsFindingTarget))).scalars().all()
    assert remaining == []
