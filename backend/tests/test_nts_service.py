"""NTS record service — lifecycle, validation, audit and version semantics.

The service never commits: every test here owns the transaction, which is
also what lets the rollback tests prove atomicity.
"""

from types import SimpleNamespace
from uuid import uuid4

import pytest
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth.models import Clinic, ClinicMembership, User
from app.modules.odontogram.nts.constants import (
    AuditAction,
    DraftSeed,
    FindingProvenance,
    RecordStatus,
)
from app.modules.odontogram.nts.exceptions import (
    NtsClinicalValidationError,
    NtsDraftConflictError,
    NtsRecordNotFoundError,
    NtsStateConflictError,
    NtsVersionConflictError,
)
from app.modules.odontogram.nts.models import (
    NtsFinding,
    NtsFindingTarget,
    NtsOdontogramRecord,
    NtsRecordAuditEvent,
    NtsRecordSpecification,
)
from app.modules.odontogram.nts.service import (
    FindingSpec,
    NtsRecordService,
    TargetSpec,
)
from app.modules.patients.models import Patient

NORM = "pe_nts_188_2022"


@pytest.fixture
async def actor(db_session: AsyncSession, test_clinic: Clinic) -> User:
    user = User(
        id=uuid4(),
        email=f"nts-{uuid4().hex[:8]}@example.com",
        password_hash="x",
        first_name="Ana",
        last_name="Pérez",
        professional_id="COP-12345",
    )
    db_session.add(user)
    await db_session.flush()
    db_session.add(
        ClinicMembership(id=uuid4(), user_id=user.id, clinic_id=test_clinic.id, role="dentist")
    )
    await db_session.commit()
    return user


@pytest.fixture
async def ids(test_clinic: Clinic, test_patient: Patient, actor: User):
    return SimpleNamespace(clinic=test_clinic.id, patient=test_patient.id, actor=actor.id)


def _tooth(number: int, **kw) -> TargetSpec:
    return TargetSpec(participation="subject", target_kind="fdi_tooth", tooth_number=number, **kw)


CARIES = FindingSpec(
    rule_id="6.1.16",
    attributes={"caries_type": "CDP", "surfaces": ["O"]},
    targets=[_tooth(46)],
)
TEMP_CROWN = FindingSpec(rule_id="6.1.4", attributes={"sigla": "CT"}, targets=[_tooth(21)])


async def _draft(db, ids, **kw) -> NtsOdontogramRecord:
    record = await NtsRecordService.create_draft(
        db,
        ids.clinic,
        patient_id=ids.patient,
        norm_version=NORM,
        stage="diagnosis",
        actor_id=ids.actor,
        **kw,
    )
    await db.commit()
    return record


async def _events(db, record_id) -> list[NtsRecordAuditEvent]:
    rows = (
        (
            await db.execute(
                select(NtsRecordAuditEvent)
                .where(NtsRecordAuditEvent.record_id == record_id)
                .order_by(NtsRecordAuditEvent.changed_at, NtsRecordAuditEvent.record_version)
            )
        )
        .scalars()
        .all()
    )
    return list(rows)


async def _stored_version(db, record_id) -> int:
    return await db.scalar(
        select(NtsOdontogramRecord.version).where(NtsOdontogramRecord.id == record_id)
    )


# --- create draft ----------------------------------------------------------


@pytest.mark.asyncio
async def test_create_draft_starts_at_version_one_with_its_audit_event(
    db_session: AsyncSession, ids
):
    record = await _draft(db_session, ids)

    assert record.status == RecordStatus.DRAFT.value
    assert record.version == 1
    assert record.content_hash is None
    assert record.hash_algorithm is None
    assert record.canonicalization_version is None

    events = await _events(db_session, record.id)
    assert [e.action for e in events] == [AuditAction.RECORD_CREATED.value]
    created = events[0]
    assert created.clinic_id == ids.clinic
    assert created.record_version == 1
    assert created.entity_type == "record"
    assert created.entity_id == record.id
    assert created.previous_state is None
    assert created.new_state["status"] == "draft"
    assert created.changed_by == ids.actor
    assert created.changed_at is not None


@pytest.mark.asyncio
async def test_a_second_draft_raises_a_domain_conflict(db_session: AsyncSession, ids):
    await _draft(db_session, ids)
    with pytest.raises(NtsDraftConflictError):
        await _draft(db_session, ids)


@pytest.mark.asyncio
async def test_a_lost_draft_race_does_not_destroy_the_callers_work(db_session: AsyncSession, ids):
    """The SAVEPOINT keeps unrelated work in the same transaction alive."""
    await _draft(db_session, ids)
    survivor_id = uuid4()
    survivor = Patient(
        id=survivor_id,
        clinic_id=ids.clinic,
        first_name="Sigue",
        last_name="Viva",
        status="active",
        preferred_language="es",
        do_not_contact=False,
    )
    db_session.add(survivor)
    await db_session.flush()

    with pytest.raises(NtsDraftConflictError):
        await NtsRecordService.create_draft(
            db_session,
            ids.clinic,
            patient_id=ids.patient,
            norm_version=NORM,
            stage="diagnosis",
            actor_id=ids.actor,
        )

    await db_session.commit()
    assert await db_session.get(Patient, survivor_id) is not None


@pytest.mark.asyncio
async def test_an_unknown_norm_version_is_refused(db_session: AsyncSession, ids):
    with pytest.raises(NtsClinicalValidationError):
        await NtsRecordService.create_draft(
            db_session,
            ids.clinic,
            patient_id=ids.patient,
            norm_version="pe_nts_999_2099",
            stage="diagnosis",
            actor_id=ids.actor,
        )


# --- reads -----------------------------------------------------------------


@pytest.mark.asyncio
async def test_reads_are_scoped_to_the_clinic(db_session: AsyncSession, ids):
    record = await _draft(db_session, ids)
    other = Clinic(id=uuid4(), name="Otra", tax_id="Z9", settings={})
    db_session.add(other)
    await db_session.commit()

    with pytest.raises(NtsRecordNotFoundError):
        await NtsRecordService.get_record(db_session, other.id, record.id)


@pytest.mark.asyncio
async def test_get_editable_draft_returns_the_open_draft(db_session: AsyncSession, ids):
    assert (
        await NtsRecordService.get_editable_draft(db_session, ids.clinic, ids.patient, NORM) is None
    )
    record = await _draft(db_session, ids)
    found = await NtsRecordService.get_editable_draft(db_session, ids.clinic, ids.patient, NORM)
    assert found is not None and found.id == record.id


# --- compare-and-bump ------------------------------------------------------


@pytest.mark.asyncio
async def test_each_operation_bumps_the_version_exactly_once(db_session: AsyncSession, ids):
    record = await _draft(db_session, ids)
    assert record.version == 1

    await NtsRecordService.update_metadata(
        db_session,
        ids.clinic,
        record.id,
        expected_version=1,
        actor_id=ids.actor,
        observations="Primera nota",
    )
    await db_session.commit()
    assert record.version == 2
    assert await _stored_version(db_session, record.id) == 2

    finding = await NtsRecordService.create_finding(
        db_session,
        ids.clinic,
        record.id,
        expected_version=2,
        actor_id=ids.actor,
        spec=CARIES,
    )
    await db_session.commit()
    assert record.version == 3

    # Five targets swapped in one operation is still a single bump.
    await NtsRecordService.replace_targets(
        db_session,
        ids.clinic,
        record.id,
        finding.id,
        expected_version=3,
        actor_id=ids.actor,
        targets=[_tooth(47)],
    )
    await db_session.commit()
    assert record.version == 4
    assert await _stored_version(db_session, record.id) == 4


@pytest.mark.asyncio
async def test_orm_and_database_versions_never_diverge(db_session: AsyncSession, ids):
    """The identity map must not keep a stale version after the raw UPDATE."""
    record = await _draft(db_session, ids)
    for expected in (1, 2, 3):
        await NtsRecordService.update_metadata(
            db_session,
            ids.clinic,
            record.id,
            expected_version=expected,
            actor_id=ids.actor,
            observations=f"nota {expected}",
        )
        await db_session.commit()
        assert record.version == await _stored_version(db_session, record.id)


@pytest.mark.asyncio
async def test_a_stale_expected_version_changes_nothing(db_session: AsyncSession, ids):
    record = await _draft(db_session, ids)
    record_id = record.id
    await NtsRecordService.update_metadata(
        db_session,
        ids.clinic,
        record_id,
        expected_version=1,
        actor_id=ids.actor,
        observations="ganó",
    )
    await db_session.commit()

    with pytest.raises(NtsVersionConflictError):
        await NtsRecordService.update_metadata(
            db_session,
            ids.clinic,
            record_id,
            expected_version=1,
            actor_id=ids.actor,
            observations="perdió",
        )
    await db_session.rollback()

    assert await _stored_version(db_session, record_id) == 2
    stored = await NtsRecordService.get_record(db_session, ids.clinic, record_id)
    assert stored.observations == "ganó"


@pytest.mark.asyncio
async def test_a_terminal_record_reports_a_state_conflict(db_session: AsyncSession, ids):
    record = await _draft(db_session, ids)
    await NtsRecordService.discard(
        db_session,
        ids.clinic,
        record.id,
        expected_version=1,
        actor_id=ids.actor,
        reason="abandonado",
    )
    await db_session.commit()

    with pytest.raises(NtsStateConflictError):
        await NtsRecordService.update_metadata(
            db_session,
            ids.clinic,
            record.id,
            expected_version=2,
            actor_id=ids.actor,
            observations="tarde",
        )


# --- atomicity -------------------------------------------------------------


@pytest.mark.asyncio
async def test_a_validation_failure_leaves_no_bump_behind(db_session: AsyncSession, ids):
    """Validation runs before the bump, so nothing was consumed."""
    record = await _draft(db_session, ids)
    record_id = record.id
    with pytest.raises(NtsClinicalValidationError):
        await NtsRecordService.create_finding(
            db_session,
            ids.clinic,
            record_id,
            expected_version=1,
            actor_id=ids.actor,
            spec=FindingSpec(
                rule_id="6.1.16",
                attributes={"caries_type": "NOPE", "surfaces": ["O"]},
                targets=[_tooth(46)],
            ),
        )
    await db_session.rollback()
    assert await _stored_version(db_session, record_id) == 1


@pytest.mark.asyncio
async def test_a_caller_rollback_loses_mutation_bump_and_audit_together(
    db_session: AsyncSession, ids
):
    record = await _draft(db_session, ids)
    record_id = record.id
    await NtsRecordService.create_finding(
        db_session,
        ids.clinic,
        record_id,
        expected_version=1,
        actor_id=ids.actor,
        spec=CARIES,
    )
    # The service flushed but never committed.
    await db_session.rollback()

    assert await _stored_version(db_session, record_id) == 1
    assert await db_session.scalar(select(func.count()).select_from(NtsFinding)) == 0
    events = await _events(db_session, record_id)
    assert [e.action for e in events] == [AuditAction.RECORD_CREATED.value]


# --- attribute validation --------------------------------------------------


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("attributes", "fragment"),
    [
        ({"caries_type": "CDP"}, "required"),
        ({"caries_type": "CDP", "surfaces": ["O"], "extra": 1}, "unknown attribute"),
        ({"caries_type": "XX", "surfaces": ["O"]}, "is not one of"),
        ({"caries_type": "CDP", "surfaces": "O"}, "expected a list"),
        ({"caries_type": "CDP", "surfaces": ["O", "O"]}, "repeated codes"),
        ({"caries_type": "CDP", "surfaces": ["Z"]}, "is not one of"),
    ],
)
async def test_attributes_are_validated_against_the_catalog(
    db_session: AsyncSession, ids, attributes, fragment
):
    record = await _draft(db_session, ids)
    with pytest.raises(NtsClinicalValidationError) as exc:
        await NtsRecordService.create_finding(
            db_session,
            ids.clinic,
            record.id,
            expected_version=1,
            actor_id=ids.actor,
            spec=FindingSpec(rule_id="6.1.16", attributes=attributes, targets=[_tooth(46)]),
        )
    assert any(fragment in e for e in exc.value.errors)
    await db_session.rollback()


@pytest.mark.asyncio
async def test_a_boolean_is_not_an_integer_attribute(db_session: AsyncSession, ids):
    """6.1.19 carries an integer degree; True is not a measurement."""
    record = await _draft(db_session, ids)
    with pytest.raises(NtsClinicalValidationError) as exc:
        await NtsRecordService.create_finding(
            db_session,
            ids.clinic,
            record.id,
            expected_version=1,
            actor_id=ids.actor,
            spec=FindingSpec(
                rule_id="6.1.19",
                attributes={"sigla": "M", "mobility_degree": True},
                targets=[_tooth(46)],
            ),
        )
    assert any("expected an integer" in e for e in exc.value.errors)


# --- target validation -----------------------------------------------------


@pytest.mark.asyncio
async def test_a_supernumerary_needs_its_two_anchors(db_session: AsyncSession, ids):
    """6.1.26 validates from target_identity + anchor, never from its id."""
    record = await _draft(db_session, ids)
    spec = FindingSpec(
        rule_id="6.1.26",
        attributes={"sigla": "S"},
        targets=[
            TargetSpec(
                participation="subject",
                target_kind="unnumbered_tooth",
                local_ordinal=1,
                position=0,
            ),
            TargetSpec(
                participation="anchor",
                target_kind="fdi_tooth",
                tooth_number=11,
                position=1,
            ),
            TargetSpec(
                participation="anchor",
                target_kind="fdi_tooth",
                tooth_number=21,
                position=2,
            ),
        ],
    )
    finding = await NtsRecordService.create_finding(
        db_session,
        ids.clinic,
        record.id,
        expected_version=1,
        actor_id=ids.actor,
        spec=spec,
    )
    await db_session.commit()
    assert len(finding.targets) == 3

    # One anchor short is refused.
    with pytest.raises(NtsClinicalValidationError) as exc:
        await NtsRecordService.replace_targets(
            db_session,
            ids.clinic,
            record.id,
            finding.id,
            expected_version=2,
            actor_id=ids.actor,
            targets=list(spec.targets[:2]),
        )
    assert any("exactly 2 anchor" in e for e in exc.value.errors)


@pytest.mark.asyncio
async def test_anchors_are_refused_where_the_rule_declares_none(db_session: AsyncSession, ids):
    record = await _draft(db_session, ids)
    with pytest.raises(NtsClinicalValidationError) as exc:
        await NtsRecordService.create_finding(
            db_session,
            ids.clinic,
            record.id,
            expected_version=1,
            actor_id=ids.actor,
            spec=FindingSpec(
                rule_id="6.1.16",
                attributes={"caries_type": "CDP", "surfaces": ["O"]},
                targets=[
                    _tooth(46),
                    TargetSpec(
                        participation="anchor",
                        target_kind="fdi_tooth",
                        tooth_number=47,
                        position=1,
                    ),
                ],
            ),
        )
    assert any("declares no anchor" in e for e in exc.value.errors)


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("rule_id", "attributes", "targets", "fragment"),
    [
        # pair needs exactly two distinct teeth
        ("6.1.6", {}, [_tooth(11)], "exactly two subjects"),
        ("6.1.6", {}, [_tooth(11), _tooth(11, position=1)], "distinct teeth"),
        # arch rules take arch targets, and 6.1.2 exactly one
        (
            "6.1.2",
            {"condition_state": "good"},
            [_tooth(11)],
            "must be arch",
        ),
        (
            "6.1.2",
            {"condition_state": "good"},
            [
                TargetSpec(participation="subject", target_kind="arch", arch="upper"),
                TargetSpec(
                    participation="subject",
                    target_kind="arch",
                    arch="lower",
                    position=1,
                ),
            ],
            "exactly one arch",
        ),
        # single_segment ranges use one group
        (
            "6.1.29",
            {"condition_state": "good"},
            [_tooth(13), _tooth(23, group_index=1)],
            "single_segment",
        ),
    ],
)
async def test_targets_are_validated_from_scope_metadata(
    db_session: AsyncSession, ids, rule_id, attributes, targets, fragment
):
    record = await _draft(db_session, ids)
    with pytest.raises(NtsClinicalValidationError) as exc:
        await NtsRecordService.create_finding(
            db_session,
            ids.clinic,
            record.id,
            expected_version=1,
            actor_id=ids.actor,
            spec=FindingSpec(rule_id=rule_id, attributes=attributes, targets=targets),
        )
    assert any(fragment in e for e in exc.value.errors), exc.value.errors
    await db_session.rollback()


@pytest.mark.asyncio
async def test_both_arches_are_accepted_where_the_rule_allows_it(db_session: AsyncSession, ids):
    record = await _draft(db_session, ids)
    finding = await NtsRecordService.create_finding(
        db_session,
        ids.clinic,
        record.id,
        expected_version=1,
        actor_id=ids.actor,
        spec=FindingSpec(
            rule_id="6.1.7",
            attributes={},
            targets=[
                TargetSpec(participation="subject", target_kind="arch", arch="upper"),
                TargetSpec(
                    participation="subject",
                    target_kind="arch",
                    arch="lower",
                    position=1,
                ),
            ],
        ),
    )
    await db_session.commit()
    assert len(finding.targets) == 2


@pytest.mark.asyncio
async def test_geometry_is_refused_with_a_readable_message(db_session: AsyncSession, ids):
    record = await _draft(db_session, ids)
    with pytest.raises(NtsClinicalValidationError) as exc:
        await NtsRecordService.create_finding(
            db_session,
            ids.clinic,
            record.id,
            expected_version=1,
            actor_id=ids.actor,
            spec=FindingSpec(
                rule_id="6.1.16",
                attributes={"caries_type": "CDP", "surfaces": ["O"]},
                targets=[
                    TargetSpec(
                        participation="subject",
                        target_kind="fdi_tooth",
                        tooth_number=46,
                        geometry={"points": []},
                    )
                ],
            ),
        )
    assert any("GEOMETRY CONTRACT PENDING" in e for e in exc.value.errors)


# --- roles -----------------------------------------------------------------


@pytest.mark.asyncio
async def test_a_declared_role_is_accepted_and_an_undeclared_one_is_not(
    db_session: AsyncSession, ids
):
    record = await _draft(db_session, ids)
    finding = await NtsRecordService.create_finding(
        db_session,
        ids.clinic,
        record.id,
        expected_version=1,
        actor_id=ids.actor,
        spec=FindingSpec(
            rule_id="6.1.29",
            attributes={"condition_state": "good"},
            targets=[
                _tooth(13, role="pilar"),
                _tooth(12, position=1),
                _tooth(11, position=2, role="pilar"),
            ],
        ),
    )
    await db_session.commit()
    assert sum(1 for t in finding.targets if t.role == "pilar") == 2

    with pytest.raises(NtsClinicalValidationError) as exc:
        await NtsRecordService.replace_targets(
            db_session,
            ids.clinic,
            record.id,
            finding.id,
            expected_version=2,
            actor_id=ids.actor,
            targets=[_tooth(13, role="pontico"), _tooth(12, position=1)],
        )
    assert any("is not declared by this rule" in e for e in exc.value.errors)


@pytest.mark.asyncio
async def test_a_role_is_not_required_when_the_norm_states_no_cardinality(
    db_session: AsyncSession, ids
):
    """`pilar` has min_count None, so a bridge without one still finalizes.

    The norm mandates marking the pilares but never says how many, and
    silence is not turned into a constraint.
    """
    record = await _draft(db_session, ids)
    await NtsRecordService.create_finding(
        db_session,
        ids.clinic,
        record.id,
        expected_version=1,
        actor_id=ids.actor,
        spec=FindingSpec(
            rule_id="6.1.29",
            attributes={"condition_state": "good"},
            targets=[_tooth(13), _tooth(12, position=1)],
        ),
    )
    await db_session.commit()
    await NtsRecordService.finalize(
        db_session, ids.clinic, record.id, expected_version=2, actor_id=ids.actor
    )
    await db_session.commit()
    assert record.status == RecordStatus.FINALIZED.value


# --- specifications --------------------------------------------------------


@pytest.mark.asyncio
async def test_a_required_specification_blocks_finalize_until_linked(db_session: AsyncSession, ids):
    """6.1.4 routes its material to Especificaciones (required=True)."""
    record = await _draft(db_session, ids)
    finding = await NtsRecordService.create_finding(
        db_session,
        ids.clinic,
        record.id,
        expected_version=1,
        actor_id=ids.actor,
        spec=TEMP_CROWN,
    )
    await db_session.commit()
    record_id, finding_id = record.id, finding.id

    with pytest.raises(NtsClinicalValidationError) as exc:
        await NtsRecordService.finalize(
            db_session, ids.clinic, record_id, expected_version=2, actor_id=ids.actor
        )
    assert any("temporary_crown_material" in e for e in exc.value.errors)
    await db_session.rollback()

    # A *general* specification does not satisfy it.
    await NtsRecordService.set_specification(
        db_session,
        ids.clinic,
        record_id,
        expected_version=2,
        actor_id=ids.actor,
        text="Nota general",
    )
    await db_session.commit()
    with pytest.raises(NtsClinicalValidationError):
        await NtsRecordService.finalize(
            db_session, ids.clinic, record_id, expected_version=3, actor_id=ids.actor
        )
    await db_session.rollback()

    # A finding-linked one does.
    await NtsRecordService.set_specification(
        db_session,
        ids.clinic,
        record_id,
        expected_version=3,
        actor_id=ids.actor,
        finding_id=finding_id,
        text="Acrílico autocurable",
    )
    await db_session.commit()
    finalized = await NtsRecordService.finalize(
        db_session, ids.clinic, record_id, expected_version=4, actor_id=ids.actor
    )
    await db_session.commit()
    assert finalized.status == RecordStatus.FINALIZED.value


@pytest.mark.asyncio
async def test_a_non_blocking_requirement_does_not_stop_finalize(db_session: AsyncSession, ids):
    """6.1.3 carries `required=False` — DenPlant has no evidence to block."""
    record = await _draft(db_session, ids)
    await NtsRecordService.create_finding(
        db_session,
        ids.clinic,
        record.id,
        expected_version=1,
        actor_id=ids.actor,
        spec=FindingSpec(
            rule_id="6.1.3",
            attributes={"crown_type": "CM", "condition_state": "good"},
            targets=[_tooth(26)],
        ),
    )
    await db_session.commit()
    await NtsRecordService.finalize(
        db_session, ids.clinic, record.id, expected_version=2, actor_id=ids.actor
    )
    await db_session.commit()
    assert record.status == RecordStatus.FINALIZED.value


@pytest.mark.asyncio
async def test_a_blank_specification_never_satisfies_a_requirement(db_session: AsyncSession, ids):
    record = await _draft(db_session, ids)
    await NtsRecordService.create_finding(
        db_session,
        ids.clinic,
        record.id,
        expected_version=1,
        actor_id=ids.actor,
        spec=TEMP_CROWN,
    )
    await db_session.commit()
    with pytest.raises(NtsClinicalValidationError):
        await NtsRecordService.set_specification(
            db_session,
            ids.clinic,
            record.id,
            expected_version=2,
            actor_id=ids.actor,
            text="   ",
        )


@pytest.mark.asyncio
async def test_fluorosis_activates_its_requirement_only_for_that_variant(
    db_session: AsyncSession, ids
):
    record = await _draft(db_session, ids)
    await NtsRecordService.create_finding(
        db_session,
        ids.clinic,
        record.id,
        expected_version=1,
        actor_id=ids.actor,
        spec=FindingSpec(
            rule_id="6.1.5",
            attributes={"dde_type": "O", "surfaces": ["V"]},
            targets=[_tooth(11)],
        ),
    )
    await db_session.commit()
    # `O` triggers nothing, so finalize passes untouched.
    await NtsRecordService.finalize(
        db_session, ids.clinic, record.id, expected_version=2, actor_id=ids.actor
    )
    await db_session.commit()
    assert record.content_hash is not None


# --- findings CRUD ---------------------------------------------------------


@pytest.mark.asyncio
async def test_finding_removal_keeps_the_whole_previous_aggregate(db_session: AsyncSession, ids):
    record = await _draft(db_session, ids)
    finding = await NtsRecordService.create_finding(
        db_session,
        ids.clinic,
        record.id,
        expected_version=1,
        actor_id=ids.actor,
        spec=TEMP_CROWN,
    )
    await db_session.commit()
    await NtsRecordService.set_specification(
        db_session,
        ids.clinic,
        record.id,
        expected_version=2,
        actor_id=ids.actor,
        finding_id=finding.id,
        text="Acrílico",
    )
    await db_session.commit()

    await NtsRecordService.remove_finding(
        db_session,
        ids.clinic,
        record.id,
        finding.id,
        expected_version=3,
        actor_id=ids.actor,
    )
    await db_session.commit()

    assert await db_session.scalar(select(func.count()).select_from(NtsFinding)) == 0
    assert await db_session.scalar(select(func.count()).select_from(NtsFindingTarget)) == 0
    removed = next(
        e
        for e in await _events(db_session, record.id)
        if e.action == AuditAction.FINDING_REMOVED.value
    )
    assert removed.new_state is None
    assert removed.previous_state["rule_id"] == "6.1.4"
    assert removed.previous_state["targets"][0]["tooth_number"] == 21
    assert removed.previous_state["specifications"][0]["text"] == "Acrílico"


@pytest.mark.asyncio
async def test_updating_attributes_revalidates_against_the_catalog(db_session: AsyncSession, ids):
    record = await _draft(db_session, ids)
    finding = await NtsRecordService.create_finding(
        db_session,
        ids.clinic,
        record.id,
        expected_version=1,
        actor_id=ids.actor,
        spec=CARIES,
    )
    await db_session.commit()

    await NtsRecordService.update_finding_attributes(
        db_session,
        ids.clinic,
        record.id,
        finding.id,
        expected_version=2,
        actor_id=ids.actor,
        attributes={"caries_type": "CE", "surfaces": ["O", "M"]},
    )
    await db_session.commit()
    assert finding.attributes["caries_type"] == "CE"

    with pytest.raises(NtsClinicalValidationError):
        await NtsRecordService.update_finding_attributes(
            db_session,
            ids.clinic,
            record.id,
            finding.id,
            expected_version=3,
            actor_id=ids.actor,
            attributes={"caries_type": "CE"},
        )


# --- metadata --------------------------------------------------------------


@pytest.mark.asyncio
async def test_metadata_update_touches_only_the_editable_fields(db_session: AsyncSession, ids):
    record = await _draft(db_session, ids)
    before = (record.patient_id, record.norm_version, record.recorded_by)

    await NtsRecordService.update_metadata(
        db_session,
        ids.clinic,
        record.id,
        expected_version=1,
        actor_id=ids.actor,
        stage="evolution",
        observations="Refiere bruxismo",
    )
    await db_session.commit()

    assert record.stage == "evolution"
    assert record.observations == "Refiere bruxismo"
    assert (record.patient_id, record.norm_version, record.recorded_by) == before

    event = next(
        e
        for e in await _events(db_session, record.id)
        if e.action == AuditAction.RECORD_METADATA_UPDATED.value
    )
    assert event.previous_state == {
        "stage": "diagnosis",
        "stage_label": None,
        "observations": None,
    }
    assert event.new_state["stage"] == "evolution"


# --- carry forward ---------------------------------------------------------


@pytest.mark.asyncio
async def test_carry_forward_copies_findings_but_never_narrative(db_session: AsyncSession, ids):
    source = await _draft(db_session, ids, observations="Observación del origen")
    finding = await NtsRecordService.create_finding(
        db_session,
        ids.clinic,
        source.id,
        expected_version=1,
        actor_id=ids.actor,
        spec=TEMP_CROWN,
    )
    await db_session.commit()
    await NtsRecordService.set_specification(
        db_session,
        ids.clinic,
        source.id,
        expected_version=2,
        actor_id=ids.actor,
        finding_id=finding.id,
        text="Acrílico",
    )
    await db_session.commit()
    await NtsRecordService.set_specification(
        db_session,
        ids.clinic,
        source.id,
        expected_version=3,
        actor_id=ids.actor,
        text="Especificación general",
    )
    await db_session.commit()
    await NtsRecordService.finalize(
        db_session, ids.clinic, source.id, expected_version=4, actor_id=ids.actor
    )
    await db_session.commit()
    source_hash = source.content_hash

    draft = await _draft(db_session, ids, seed=DraftSeed.CARRY_FORWARD)
    draft = await NtsRecordService.get_record(db_session, ids.clinic, draft.id)

    assert len(draft.findings) == 1
    copied = draft.findings[0]
    assert copied.id != finding.id
    assert copied.provenance == FindingProvenance.CARRIED_FORWARD.value
    assert copied.source_finding_id == finding.id
    assert copied.created_by == ids.actor
    assert [t.tooth_number for t in copied.targets] == [21]

    # linked specification copied; general one and observations are not
    assert [s.text for s in draft.specifications] == ["Acrílico"]
    assert draft.specifications[0].finding_id == copied.id
    assert draft.observations is None

    # the source is untouched
    await db_session.refresh(source)
    assert source.content_hash == source_hash
    assert source.status == RecordStatus.FINALIZED.value
    assert len(source.findings) == 1


@pytest.mark.asyncio
async def test_carry_forward_blocks_finalize_until_each_finding_is_reviewed(
    db_session: AsyncSession, ids
):
    source = await _draft(db_session, ids)
    await NtsRecordService.create_finding(
        db_session,
        ids.clinic,
        source.id,
        expected_version=1,
        actor_id=ids.actor,
        spec=CARIES,
    )
    await db_session.commit()
    await NtsRecordService.create_finding(
        db_session,
        ids.clinic,
        source.id,
        expected_version=2,
        actor_id=ids.actor,
        spec=FindingSpec(
            rule_id="6.1.16",
            attributes={"caries_type": "CE", "surfaces": ["M"]},
            targets=[_tooth(36)],
        ),
    )
    await db_session.commit()
    await NtsRecordService.finalize(
        db_session, ids.clinic, source.id, expected_version=3, actor_id=ids.actor
    )
    await db_session.commit()

    draft = await _draft(db_session, ids, seed=DraftSeed.CARRY_FORWARD)
    draft = await NtsRecordService.get_record(db_session, ids.clinic, draft.id)
    first, second = sorted(draft.findings, key=lambda f: f.sequence)
    draft_id, first_id, second_id = draft.id, first.id, second.id

    with pytest.raises(NtsClinicalValidationError) as exc:
        await NtsRecordService.finalize(
            db_session, ids.clinic, draft_id, expected_version=1, actor_id=ids.actor
        )
    assert any("carried-forward" in e for e in exc.value.errors)
    await db_session.rollback()

    reviewed = await NtsRecordService.confirm_carried_forward(
        db_session,
        ids.clinic,
        draft_id,
        first_id,
        expected_version=1,
        actor_id=ids.actor,
    )
    await db_session.commit()
    assert reviewed.provenance == FindingProvenance.OBSERVED.value
    # the provenance trail survives the review
    assert reviewed.source_finding_id is not None
    # ...and confirming one does not confirm the other
    refreshed = await NtsRecordService.get_record(db_session, ids.clinic, draft_id)
    other = next(f for f in refreshed.findings if f.id == second_id)
    assert other.provenance == FindingProvenance.CARRIED_FORWARD.value

    await NtsRecordService.remove_finding(
        db_session,
        ids.clinic,
        draft_id,
        second_id,
        expected_version=2,
        actor_id=ids.actor,
    )
    await db_session.commit()

    final = await NtsRecordService.finalize(
        db_session, ids.clinic, draft_id, expected_version=3, actor_id=ids.actor
    )
    await db_session.commit()
    assert final.status == RecordStatus.FINALIZED.value


@pytest.mark.asyncio
async def test_carry_forward_without_a_source_is_refused(db_session: AsyncSession, ids):
    with pytest.raises(NtsStateConflictError):
        await NtsRecordService.create_draft(
            db_session,
            ids.clinic,
            patient_id=ids.patient,
            norm_version=NORM,
            stage="diagnosis",
            actor_id=ids.actor,
            seed=DraftSeed.CARRY_FORWARD,
        )


@pytest.mark.asyncio
async def test_confirming_an_observed_finding_is_a_state_conflict(db_session: AsyncSession, ids):
    record = await _draft(db_session, ids)
    finding = await NtsRecordService.create_finding(
        db_session,
        ids.clinic,
        record.id,
        expected_version=1,
        actor_id=ids.actor,
        spec=CARIES,
    )
    await db_session.commit()
    with pytest.raises(NtsStateConflictError):
        await NtsRecordService.confirm_carried_forward(
            db_session,
            ids.clinic,
            record.id,
            finding.id,
            expected_version=2,
            actor_id=ids.actor,
        )


@pytest.mark.asyncio
async def test_no_bulk_confirmation_helper_exists():
    """A "confirm all" would make carry-forward blind copying again."""
    names = [n for n in dir(NtsRecordService) if not n.startswith("_")]
    assert not [n for n in names if "all" in n.lower()]
    assert "confirm_carried_forward" in names


# --- discard ---------------------------------------------------------------


@pytest.mark.asyncio
async def test_discard_keeps_everything_and_leaves_the_hash_null(db_session: AsyncSession, ids):
    record = await _draft(db_session, ids)
    await NtsRecordService.create_finding(
        db_session,
        ids.clinic,
        record.id,
        expected_version=1,
        actor_id=ids.actor,
        spec=CARIES,
    )
    await db_session.commit()

    await NtsRecordService.discard(
        db_session,
        ids.clinic,
        record.id,
        expected_version=2,
        actor_id=ids.actor,
        reason="paciente no regresó",
    )
    await db_session.commit()

    assert record.status == RecordStatus.DISCARDED.value
    assert record.discard_reason == "paciente no regresó"
    assert record.discarded_by == ids.actor
    assert record.content_hash is None
    assert record.version == 3
    assert await db_session.scalar(select(func.count()).select_from(NtsFinding)) == 1
    discarded = next(
        e for e in await _events(db_session, record.id) if e.action == AuditAction.DISCARDED.value
    )
    assert discarded.record_version == 3


@pytest.mark.asyncio
async def test_discard_requires_a_reason(db_session: AsyncSession, ids):
    record = await _draft(db_session, ids)
    with pytest.raises(NtsClinicalValidationError):
        await NtsRecordService.discard(
            db_session,
            ids.clinic,
            record.id,
            expected_version=1,
            actor_id=ids.actor,
            reason="  ",
        )


# --- finalize --------------------------------------------------------------


@pytest.mark.asyncio
async def test_finalize_stamps_the_hash_triple_and_authorship(
    db_session: AsyncSession, ids, actor: User
):
    record = await _draft(db_session, ids)
    await NtsRecordService.create_finding(
        db_session,
        ids.clinic,
        record.id,
        expected_version=1,
        actor_id=ids.actor,
        spec=CARIES,
    )
    await db_session.commit()

    await NtsRecordService.finalize(
        db_session, ids.clinic, record.id, expected_version=2, actor_id=ids.actor
    )
    await db_session.commit()

    assert record.status == RecordStatus.FINALIZED.value
    assert record.finalized_at is not None
    assert record.finalized_by == ids.actor
    assert len(record.content_hash) == 64
    assert record.content_hash == record.content_hash.lower()
    assert record.hash_algorithm == "sha256"
    assert record.canonicalization_version == 1
    assert record.recorded_by_name == "Ana Pérez"
    assert record.recorded_by_role == "dentist"
    assert record.recorded_by_professional_id == actor.professional_id


@pytest.mark.asyncio
async def test_a_record_with_no_findings_can_be_finalized(db_session: AsyncSession, ids):
    """The norm records findings, not health: zero is a valid answer."""
    record = await _draft(db_session, ids)
    await NtsRecordService.finalize(
        db_session, ids.clinic, record.id, expected_version=1, actor_id=ids.actor
    )
    await db_session.commit()
    assert record.status == RecordStatus.FINALIZED.value
    assert record.content_hash is not None


@pytest.mark.asyncio
async def test_a_finalized_record_is_terminal(db_session: AsyncSession, ids):
    record = await _draft(db_session, ids)
    await NtsRecordService.finalize(
        db_session, ids.clinic, record.id, expected_version=1, actor_id=ids.actor
    )
    await db_session.commit()
    with pytest.raises(NtsStateConflictError):
        await NtsRecordService.discard(
            db_session,
            ids.clinic,
            record.id,
            expected_version=2,
            actor_id=ids.actor,
            reason="tarde",
        )


# --- supersession ----------------------------------------------------------


async def _finalized(db, ids, **kw) -> NtsOdontogramRecord:
    record = await _draft(db, ids, **kw)
    await NtsRecordService.finalize(
        db, ids.clinic, record.id, expected_version=1, actor_id=ids.actor
    )
    await db.commit()
    return record


@pytest.mark.asyncio
async def test_supersession_never_touches_the_predecessor(db_session: AsyncSession, ids):
    first = await _finalized(db_session, ids)
    before = (
        first.status,
        first.content_hash,
        first.version,
        first.updated_at,
        len(await _events(db_session, first.id)),
    )

    correction = await _draft(
        db_session,
        ids,
        supersedes_record_id=first.id,
        supersession_reason="error material en 4.6",
    )
    await NtsRecordService.finalize(
        db_session, ids.clinic, correction.id, expected_version=1, actor_id=ids.actor
    )
    await db_session.commit()

    await db_session.refresh(first)
    assert (
        first.status,
        first.content_hash,
        first.version,
        first.updated_at,
        len(await _events(db_session, first.id)),
    ) == before

    events = await _events(db_session, correction.id)
    assert AuditAction.SUPERSESSION_RECORDED.value in [e.action for e in events]
    supersession = next(e for e in events if e.action == AuditAction.SUPERSESSION_RECORDED.value)
    assert supersession.record_id == correction.id
    assert supersession.new_state["supersedes_record_id"] == str(first.id)


@pytest.mark.asyncio
async def test_a_second_successor_is_refused(db_session: AsyncSession, ids):
    first = await _finalized(db_session, ids)
    second = await _draft(
        db_session,
        ids,
        supersedes_record_id=first.id,
        supersession_reason="primera corrección",
    )
    await NtsRecordService.finalize(
        db_session, ids.clinic, second.id, expected_version=1, actor_id=ids.actor
    )
    await db_session.commit()

    with pytest.raises(NtsStateConflictError):
        await NtsRecordService.create_draft(
            db_session,
            ids.clinic,
            patient_id=ids.patient,
            norm_version=NORM,
            stage="diagnosis",
            actor_id=ids.actor,
            supersedes_record_id=first.id,
            supersession_reason="segunda corrección",
        )


@pytest.mark.asyncio
async def test_a_draft_cannot_be_superseded(db_session: AsyncSession, ids):
    draft = await _draft(db_session, ids)
    await NtsRecordService.discard(
        db_session,
        ids.clinic,
        draft.id,
        expected_version=1,
        actor_id=ids.actor,
        reason="x",
    )
    await db_session.commit()
    with pytest.raises(NtsStateConflictError):
        await NtsRecordService.create_draft(
            db_session,
            ids.clinic,
            patient_id=ids.patient,
            norm_version=NORM,
            stage="diagnosis",
            actor_id=ids.actor,
            supersedes_record_id=draft.id,
            supersession_reason="no procede",
        )


# --- current record --------------------------------------------------------


@pytest.mark.asyncio
async def test_a_draft_never_replaces_the_current_finalized_record(db_session: AsyncSession, ids):
    finalized = await _finalized(db_session, ids)
    await _draft(db_session, ids)

    current = await NtsRecordService.get_current_record(db_session, ids.clinic, ids.patient, NORM)
    assert current is not None and current.id == finalized.id


@pytest.mark.asyncio
async def test_a_discarded_record_is_never_current(db_session: AsyncSession, ids):
    draft = await _draft(db_session, ids)
    await NtsRecordService.discard(
        db_session,
        ids.clinic,
        draft.id,
        expected_version=1,
        actor_id=ids.actor,
        reason="x",
    )
    await db_session.commit()
    assert (
        await NtsRecordService.get_current_record(db_session, ids.clinic, ids.patient, NORM) is None
    )


@pytest.mark.asyncio
async def test_the_current_record_follows_the_supersession_chain(db_session: AsyncSession, ids):
    a = await _finalized(db_session, ids)
    b = await _draft(db_session, ids, supersedes_record_id=a.id, supersession_reason="a->b")
    await NtsRecordService.finalize(
        db_session, ids.clinic, b.id, expected_version=1, actor_id=ids.actor
    )
    await db_session.commit()
    assert (
        await NtsRecordService.get_current_record(db_session, ids.clinic, ids.patient, NORM)
    ).id == b.id

    c = await _draft(db_session, ids, supersedes_record_id=b.id, supersession_reason="b->c")
    await NtsRecordService.finalize(
        db_session, ids.clinic, c.id, expected_version=1, actor_id=ids.actor
    )
    await db_session.commit()
    assert (
        await NtsRecordService.get_current_record(db_session, ids.clinic, ids.patient, NORM)
    ).id == c.id

    # every link of the chain stays reachable
    for record in (a, b, c):
        assert await NtsRecordService.get_record(db_session, ids.clinic, record.id)


@pytest.mark.asyncio
async def test_ordinary_succession_picks_the_most_recent(db_session: AsyncSession, ids):
    """Two finalized records where neither supersedes the other.

    They cannot be backdated: the guard trigger refuses any UPDATE of a
    finalized record, which is exactly the property under test elsewhere.
    So they simply finalize in order.
    """
    older = await _finalized(db_session, ids)
    newer = await _finalized(db_session, ids)
    assert older.finalized_at < newer.finalized_at

    current = await NtsRecordService.get_current_record(db_session, ids.clinic, ids.patient, NORM)
    assert current.id == newer.id


# --- audit completeness ----------------------------------------------------


@pytest.mark.asyncio
async def test_every_audited_action_is_reachable(db_session: AsyncSession, ids):
    """Walk one record through every operation and collect the trail."""
    source = await _draft(db_session, ids)
    finding = await NtsRecordService.create_finding(
        db_session,
        ids.clinic,
        source.id,
        expected_version=1,
        actor_id=ids.actor,
        spec=CARIES,
    )
    await db_session.commit()
    await NtsRecordService.update_finding_attributes(
        db_session,
        ids.clinic,
        source.id,
        finding.id,
        expected_version=2,
        actor_id=ids.actor,
        attributes={"caries_type": "CE", "surfaces": ["O"]},
    )
    await db_session.commit()
    await NtsRecordService.replace_targets(
        db_session,
        ids.clinic,
        source.id,
        finding.id,
        expected_version=3,
        actor_id=ids.actor,
        targets=[_tooth(47)],
    )
    await db_session.commit()
    await NtsRecordService.set_specification(
        db_session,
        ids.clinic,
        source.id,
        expected_version=4,
        actor_id=ids.actor,
        finding_id=finding.id,
        text="detalle",
    )
    await db_session.commit()
    await NtsRecordService.update_metadata(
        db_session,
        ids.clinic,
        source.id,
        expected_version=5,
        actor_id=ids.actor,
        observations="nota",
    )
    await db_session.commit()
    await NtsRecordService.finalize(
        db_session, ids.clinic, source.id, expected_version=6, actor_id=ids.actor
    )
    await db_session.commit()

    draft = await _draft(db_session, ids, seed=DraftSeed.CARRY_FORWARD)
    draft = await NtsRecordService.get_record(db_session, ids.clinic, draft.id)
    carried = draft.findings[0]
    await NtsRecordService.confirm_carried_forward(
        db_session,
        ids.clinic,
        draft.id,
        carried.id,
        expected_version=1,
        actor_id=ids.actor,
    )
    await db_session.commit()
    await NtsRecordService.remove_finding(
        db_session,
        ids.clinic,
        draft.id,
        carried.id,
        expected_version=2,
        actor_id=ids.actor,
    )
    await db_session.commit()
    await NtsRecordService.discard(
        db_session,
        ids.clinic,
        draft.id,
        expected_version=3,
        actor_id=ids.actor,
        reason="fin",
    )
    await db_session.commit()

    correction = await _draft(
        db_session,
        ids,
        supersedes_record_id=source.id,
        supersession_reason="corrige",
    )
    await NtsRecordService.finalize(
        db_session, ids.clinic, correction.id, expected_version=1, actor_id=ids.actor
    )
    await db_session.commit()

    seen = set()
    for record_id in (source.id, draft.id, correction.id):
        for event in await _events(db_session, record_id):
            seen.add(event.action)
            assert event.clinic_id == ids.clinic
            assert event.record_id == record_id
            assert event.record_version >= 1
            assert event.entity_type in {
                "record",
                "finding",
                "target",
                "specification",
            }
            assert event.changed_by == ids.actor
            assert event.changed_at is not None

    assert seen == {a.value for a in AuditAction}


@pytest.mark.asyncio
async def test_audit_states_are_json_safe(db_session: AsyncSession, ids):
    """UUID and datetime are converted explicitly, never left as objects."""
    record = await _draft(db_session, ids)
    await NtsRecordService.create_finding(
        db_session,
        ids.clinic,
        record.id,
        expected_version=1,
        actor_id=ids.actor,
        spec=CARIES,
    )
    await db_session.commit()

    import json

    for event in await _events(db_session, record.id):
        for state in (event.previous_state, event.new_state):
            if state is not None:
                json.dumps(state)  # raises if anything non-serialisable slipped in


@pytest.mark.asyncio
async def test_specifications_never_merge_into_observations(db_session: AsyncSession, ids):
    record = await _draft(db_session, ids)
    await NtsRecordService.update_metadata(
        db_session,
        ids.clinic,
        record.id,
        expected_version=1,
        actor_id=ids.actor,
        observations="Observaciones §5.15",
    )
    await db_session.commit()
    await NtsRecordService.set_specification(
        db_session,
        ids.clinic,
        record.id,
        expected_version=2,
        actor_id=ids.actor,
        text="Especificaciones §5.14",
    )
    await db_session.commit()

    fresh = await NtsRecordService.get_record(db_session, ids.clinic, record.id)
    assert fresh.observations == "Observaciones §5.15"
    assert [s.text for s in fresh.specifications] == ["Especificaciones §5.14"]
    assert await db_session.scalar(select(func.count()).select_from(NtsRecordSpecification)) == 1
