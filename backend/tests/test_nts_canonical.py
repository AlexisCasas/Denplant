"""CanonicalSnapshotV1 — golden vectors and determinism.

The expected canonical strings in this file are written **by hand from the
contract** in ``docs/technical/odontogram/nts-record-model.md`` §10, not
produced by the code under test. The expected digests are literals computed
out of band. If a change to :mod:`app.modules.odontogram.nts.canonical`
breaks one of these, the correct response is to read the contract and
decide which side is wrong — never to paste the new actual value in.

These tests need no database: the canonical module is pure and reads
attributes by name.
"""

import json
from datetime import UTC, datetime, timedelta, timezone
from types import SimpleNamespace
from uuid import UUID

import pytest

from app.modules.odontogram.nts.canonical import (
    CanonicalizationError,
    build_canonical_snapshot_v1,
    digest_canonical_v1,
    serialize_canonical_v1,
    sha256_canonical_v1,
)


def _utc(text: str) -> datetime:
    return datetime.fromisoformat(text).replace(tzinfo=UTC)


def _target(**kwargs):
    base = {
        "id": None,
        "group_index": 0,
        "position": 0,
        "participation": "subject",
        "role": None,
        "target_kind": "fdi_tooth",
        "tooth_number": None,
        "arch": None,
        "local_ordinal": None,
        "geometry": None,
    }
    return SimpleNamespace(**{**base, **kwargs})


def _finding(**kwargs):
    base = {
        "id": None,
        "rule_id": "6.1.16",
        "attributes": {},
        "provenance": "observed",
        "source_finding_id": None,
        "sequence": 0,
        "created_at": _utc("2026-09-17T07:05:00.000000"),
        "created_by": UUID("55555555-5555-5555-5555-555555555555"),
        "targets": [],
    }
    return SimpleNamespace(**{**base, **kwargs})


def _specification(**kwargs):
    base = {"id": None, "finding_id": None, "text": "", "sequence": 0}
    return SimpleNamespace(**{**base, **kwargs})


def _record(**kwargs):
    base = {
        "id": UUID("11111111-1111-1111-1111-111111111111"),
        "clinic_id": UUID("22222222-2222-2222-2222-222222222222"),
        "patient_id": UUID("33333333-3333-3333-3333-333333333333"),
        "norm_version": "pe_nts_188_2022",
        "stage": "diagnosis",
        "stage_label": None,
        "observations": None,
        "supersedes_record_id": None,
        "supersession_reason": None,
        "recorded_at": _utc("2026-09-17T08:30:00.000000"),
        "recorded_by": UUID("00000000-0000-4000-8000-000000000004"),
        "finalized_at": _utc("2026-09-17T09:15:30.123456"),
        "finalized_by": UUID("00000000-0000-4000-8000-000000000004"),
        "recorded_by_name": "Dra. Ana Pérez",
        "recorded_by_role": "dentist",
        "recorded_by_professional_id": "COP-12345",
        "findings": [],
        "specifications": [],
    }
    return SimpleNamespace(**{**base, **kwargs})


# ===========================================================================
# GOLDEN VECTOR A — minimal finalized record: no findings, no specifications
# ===========================================================================

VECTOR_A_RECORD = _record(
    id=UUID("00000000-0000-4000-8000-000000000001"),
    clinic_id=UUID("00000000-0000-4000-8000-000000000002"),
    patient_id=UUID("00000000-0000-4000-8000-000000000003"),
)

# Written by hand: keys ascending by code point, compact separators,
# explicit nulls, UUIDs lowercase, timestamps with six fractional digits.
VECTOR_A_CANONICAL = (
    "{"
    '"clinic_id":"00000000-0000-4000-8000-000000000002",'
    '"finalized_at":"2026-09-17T09:15:30.123456Z",'
    '"finalized_by":"00000000-0000-4000-8000-000000000004",'
    '"findings":[],'
    '"id":"00000000-0000-4000-8000-000000000001",'
    '"norm_version":"pe_nts_188_2022",'
    '"observations":null,'
    '"patient_id":"00000000-0000-4000-8000-000000000003",'
    '"recorded_at":"2026-09-17T08:30:00.000000Z",'
    '"recorded_by":"00000000-0000-4000-8000-000000000004",'
    '"recorded_by_name":"Dra. Ana Pérez",'
    '"recorded_by_professional_id":"COP-12345",'
    '"recorded_by_role":"dentist",'
    '"specifications":[],'
    '"stage":"diagnosis",'
    '"stage_label":null,'
    '"supersedes_record_id":null,'
    '"supersession_reason":null'
    "}"
)

VECTOR_A_SHA256 = "88af347115e52a062edbb8fac208193300cd1bee54da161edc09e4906c9e9dba"


def test_golden_vector_a_canonical_bytes():
    produced = serialize_canonical_v1(build_canonical_snapshot_v1(VECTOR_A_RECORD))
    assert produced == VECTOR_A_CANONICAL.encode("utf-8")


def test_golden_vector_a_digest():
    assert sha256_canonical_v1(VECTOR_A_RECORD) == VECTOR_A_SHA256


# ===========================================================================
# GOLDEN VECTOR B — several findings, shuffled input, Unicode, nulls
# ===========================================================================

_F1 = UUID("aaaaaaaa-0000-0000-0000-000000000001")
_F2 = UUID("aaaaaaaa-0000-0000-0000-000000000002")

VECTOR_B_RECORD = _record(
    stage="other",
    stage_label="Interconsulta ortodóncica",
    # Embedded newline: the contract escapes every control character as
    # \u00xx, never as a JSON short escape.
    observations="Línea alba marcada.\nRefiere bruxismo.",
    supersedes_record_id=UUID("44444444-4444-4444-4444-444444444444"),
    supersession_reason="Corrección de pieza 4.6 — error material",
    recorded_at=_utc("2026-09-17T07:00:00.000000"),
    recorded_by=UUID("55555555-5555-5555-5555-555555555555"),
    finalized_at=_utc("2026-09-17T10:20:05.000900"),
    finalized_by=UUID("66666666-6666-6666-6666-666666666666"),
    recorded_by_name="Dr. Ñuño Fernández-Ávila",
    recorded_by_professional_id=None,
    # Findings supplied newest-first, so the builder has to reorder them.
    findings=[
        _finding(
            id=_F2,
            rule_id="6.1.16",
            # Keys deliberately out of order; the array value keeps its own
            # order, because only declared collections are sorted.
            attributes={"surfaces": ["O", "M"], "caries_type": "CDP"},
            sequence=2,
            created_at=_utc("2026-09-17T07:06:00.000000"),
            targets=[
                _target(
                    id=UUID("dddddddd-0000-0000-0000-000000000001"),
                    tooth_number=46,
                )
            ],
        ),
        _finding(
            id=_F1,
            rule_id="6.1.26",
            attributes={"sigla": "S"},
            sequence=1,
            targets=[
                # Supplied in the wrong order on purpose.
                _target(
                    id=UUID("cccccccc-0000-0000-0000-000000000003"),
                    position=2,
                    participation="anchor",
                    tooth_number=21,
                ),
                _target(
                    id=UUID("cccccccc-0000-0000-0000-000000000001"),
                    position=0,
                    target_kind="unnumbered_tooth",
                    local_ordinal=1,
                ),
                _target(
                    id=UUID("cccccccc-0000-0000-0000-000000000002"),
                    position=1,
                    participation="anchor",
                    tooth_number=11,
                ),
            ],
        ),
    ],
    specifications=[
        _specification(
            id=UUID("eeeeeeee-0000-0000-0000-000000000002"),
            sequence=2,
            text="Observación general",
        ),
        _specification(
            id=UUID("eeeeeeee-0000-0000-0000-000000000001"),
            finding_id=_F2,
            sequence=1,
            text="Fluorosis: índice de Dean — muy leve",
        ),
    ],
)

VECTOR_B_CANONICAL = (
    "{"
    '"clinic_id":"22222222-2222-2222-2222-222222222222",'
    '"finalized_at":"2026-09-17T10:20:05.000900Z",'
    '"finalized_by":"66666666-6666-6666-6666-666666666666",'
    '"findings":['
    # sequence 1 first
    "{"
    '"attributes":{"sigla":"S"},'
    '"created_at":"2026-09-17T07:05:00.000000Z",'
    '"created_by":"55555555-5555-5555-5555-555555555555",'
    '"id":"aaaaaaaa-0000-0000-0000-000000000001",'
    '"provenance":"observed",'
    '"rule_id":"6.1.26",'
    '"sequence":1,'
    '"source_finding_id":null,'
    '"targets":['
    "{"
    '"arch":null,"geometry":null,"group_index":0,'
    '"id":"cccccccc-0000-0000-0000-000000000001",'
    '"local_ordinal":1,"participation":"subject","position":0,'
    '"role":null,"target_kind":"unnumbered_tooth","tooth_number":null'
    "},"
    "{"
    '"arch":null,"geometry":null,"group_index":0,'
    '"id":"cccccccc-0000-0000-0000-000000000002",'
    '"local_ordinal":null,"participation":"anchor","position":1,'
    '"role":null,"target_kind":"fdi_tooth","tooth_number":11'
    "},"
    "{"
    '"arch":null,"geometry":null,"group_index":0,'
    '"id":"cccccccc-0000-0000-0000-000000000003",'
    '"local_ordinal":null,"participation":"anchor","position":2,'
    '"role":null,"target_kind":"fdi_tooth","tooth_number":21'
    "}"
    "]"
    "},"
    # sequence 2 second
    "{"
    '"attributes":{"caries_type":"CDP","surfaces":["O","M"]},'
    '"created_at":"2026-09-17T07:06:00.000000Z",'
    '"created_by":"55555555-5555-5555-5555-555555555555",'
    '"id":"aaaaaaaa-0000-0000-0000-000000000002",'
    '"provenance":"observed",'
    '"rule_id":"6.1.16",'
    '"sequence":2,'
    '"source_finding_id":null,'
    '"targets":['
    "{"
    '"arch":null,"geometry":null,"group_index":0,'
    '"id":"dddddddd-0000-0000-0000-000000000001",'
    '"local_ordinal":null,"participation":"subject","position":0,'
    '"role":null,"target_kind":"fdi_tooth","tooth_number":46'
    "}"
    "]"
    "}"
    "],"
    '"id":"11111111-1111-1111-1111-111111111111",'
    '"norm_version":"pe_nts_188_2022",'
    '"observations":"Línea alba marcada.\\u000aRefiere bruxismo.",'
    '"patient_id":"33333333-3333-3333-3333-333333333333",'
    '"recorded_at":"2026-09-17T07:00:00.000000Z",'
    '"recorded_by":"55555555-5555-5555-5555-555555555555",'
    '"recorded_by_name":"Dr. Ñuño Fernández-Ávila",'
    '"recorded_by_professional_id":null,'
    '"recorded_by_role":"dentist",'
    '"specifications":['
    "{"
    '"finding_id":"aaaaaaaa-0000-0000-0000-000000000002",'
    '"id":"eeeeeeee-0000-0000-0000-000000000001",'
    '"sequence":1,'
    '"text":"Fluorosis: índice de Dean — muy leve"'
    "},"
    "{"
    '"finding_id":null,'
    '"id":"eeeeeeee-0000-0000-0000-000000000002",'
    '"sequence":2,'
    '"text":"Observación general"'
    "}"
    "],"
    '"stage":"other",'
    '"stage_label":"Interconsulta ortodóncica",'
    '"supersedes_record_id":"44444444-4444-4444-4444-444444444444",'
    '"supersession_reason":"Corrección de pieza 4.6 — error material"'
    "}"
)

VECTOR_B_SHA256 = "9fcfe70fcc508d2180c313fcc5084f671bbd047ab632a24ddedb17ab3fabbbcc"


def test_golden_vector_b_canonical_bytes():
    produced = serialize_canonical_v1(build_canonical_snapshot_v1(VECTOR_B_RECORD))
    assert produced == VECTOR_B_CANONICAL.encode("utf-8")


def test_golden_vector_b_digest():
    assert sha256_canonical_v1(VECTOR_B_RECORD) == VECTOR_B_SHA256


def test_golden_vector_b_preserves_unicode_literally():
    """Non-ASCII is emitted as UTF-8, never \\u-escaped, never normalised."""
    produced = serialize_canonical_v1(build_canonical_snapshot_v1(VECTOR_B_RECORD))
    assert "Ñuño".encode() in produced
    assert "—".encode() in produced
    assert b"\\u00d1" not in produced
    # ...but a control character *is* escaped, in the six-character
    # backslash-u form, never as a JSON short escape.
    assert b"\\u000a" in produced
    assert b"\n" not in produced


# ===========================================================================
# Determinism
# ===========================================================================


def test_attribute_key_order_does_not_change_the_bytes():
    a = _record(findings=[_finding(id=_F1, attributes={"b": 1, "a": 2, "c": 3})])
    b = _record(findings=[_finding(id=_F1, attributes={"c": 3, "a": 2, "b": 1})])
    assert _bytes(a) == _bytes(b)


def test_finding_input_order_does_not_change_the_bytes():
    f1 = _finding(id=_F1, sequence=1)
    f2 = _finding(id=_F2, sequence=2)
    assert _bytes(_record(findings=[f1, f2])) == _bytes(_record(findings=[f2, f1]))


def test_findings_with_equal_sequence_are_ordered_by_id():
    """`id` makes the sort total even if `sequence` were ever duplicated."""
    f1 = _finding(id=_F1, sequence=1)
    f2 = _finding(id=_F2, sequence=1)
    forward = _bytes(_record(findings=[f1, f2]))
    reverse = _bytes(_record(findings=[f2, f1]))
    assert forward == reverse
    assert forward.index(str(_F1).encode()) < forward.index(str(_F2).encode())


def test_target_input_order_does_not_change_the_bytes():
    t0 = _target(id=UUID("cccccccc-0000-0000-0000-000000000001"), position=0, tooth_number=11)
    t1 = _target(id=UUID("cccccccc-0000-0000-0000-000000000002"), position=1, tooth_number=12)
    t2 = _target(
        id=UUID("cccccccc-0000-0000-0000-000000000003"), group_index=1, position=0, tooth_number=21
    )
    ordered = _record(findings=[_finding(id=_F1, targets=[t0, t1, t2])])
    shuffled = _record(findings=[_finding(id=_F1, targets=[t2, t0, t1])])
    assert _bytes(ordered) == _bytes(shuffled)


def test_specification_input_order_does_not_change_the_bytes():
    s1 = _specification(id=UUID("eeeeeeee-0000-0000-0000-000000000001"), sequence=1, text="uno")
    s2 = _specification(id=UUID("eeeeeeee-0000-0000-0000-000000000002"), sequence=2, text="dos")
    assert _bytes(_record(specifications=[s1, s2])) == _bytes(_record(specifications=[s2, s1]))


def test_uuid_input_form_is_normalised_to_lowercase():
    upper = _record(id="00000000-0000-4000-8000-00000000000A")
    lower = _record(id=UUID("00000000-0000-4000-8000-00000000000a"))
    assert _bytes(upper) == _bytes(lower)
    assert b"00000000-0000-4000-8000-00000000000a" in _bytes(upper)


def test_timestamps_normalise_to_utc_with_fixed_format():
    """+00:00, a non-UTC zone and plain UTC all converge on one rendering."""
    utc = _record(finalized_at=datetime(2026, 9, 17, 9, 15, 30, 123456, tzinfo=UTC))
    plus_zero = _record(
        finalized_at=datetime(2026, 9, 17, 9, 15, 30, 123456, tzinfo=timezone(timedelta(0)))
    )
    lima = _record(
        finalized_at=datetime(2026, 9, 17, 4, 15, 30, 123456, tzinfo=timezone(timedelta(hours=-5)))
    )
    assert _bytes(utc) == _bytes(plus_zero) == _bytes(lima)
    assert b'"finalized_at":"2026-09-17T09:15:30.123456Z"' in _bytes(utc)


def test_microseconds_always_render_six_digits():
    assert b'"finalized_at":"2026-09-17T09:15:30.000000Z"' in _bytes(
        _record(finalized_at=_utc("2026-09-17T09:15:30.000000"))
    )
    assert b'"finalized_at":"2026-09-17T09:15:30.000900Z"' in _bytes(
        _record(finalized_at=_utc("2026-09-17T09:15:30.000900"))
    )


def test_same_snapshot_always_yields_the_same_digest():
    first = sha256_canonical_v1(VECTOR_B_RECORD)
    second = sha256_canonical_v1(VECTOR_B_RECORD)
    assert first == second
    assert len(first) == 64
    assert first == first.lower()
    assert digest_canonical_v1(VECTOR_B_CANONICAL.encode("utf-8")) == first


def test_excluded_fields_never_reach_the_snapshot():
    """version, status, created_at/updated_at and the hash columns stay out."""
    snapshot = build_canonical_snapshot_v1(
        _record(
            version=99,
            status="finalized",
            created_at=_utc("2020-01-01T00:00:00.000000"),
            updated_at=_utc("2020-01-01T00:00:00.000000"),
            content_hash="f" * 64,
            hash_algorithm="sha256",
            canonicalization_version=1,
        )
    )
    for excluded in (
        "version",
        "status",
        "created_at",
        "updated_at",
        "content_hash",
        "hash_algorithm",
        "canonicalization_version",
    ):
        assert excluded not in snapshot


# ===========================================================================
# Refusals — version 1 fails loudly rather than guessing
# ===========================================================================


def test_non_null_geometry_is_refused():
    """GEOMETRY CONTRACT PENDING: a shape we could not replay is never stored."""
    record = _record(
        findings=[
            _finding(
                id=_F1,
                targets=[_target(id=_F2, tooth_number=11, geometry={"points": []})],
            )
        ]
    )
    with pytest.raises(CanonicalizationError, match="GEOMETRY CONTRACT PENDING"):
        build_canonical_snapshot_v1(record)


@pytest.mark.parametrize(
    "attributes",
    [
        {"probing": 3.5},
        {"nested": {"depth": 1.0}},
        {"list": [1, 2.5]},
    ],
)
def test_floats_are_refused_anywhere_in_attributes(attributes):
    record = _record(findings=[_finding(id=_F1, attributes=attributes)])
    with pytest.raises(CanonicalizationError, match="float"):
        build_canonical_snapshot_v1(record)


def test_naive_datetime_is_refused_rather_than_assumed_utc():
    record = _record(finalized_at=datetime(2026, 9, 17, 9, 15, 30, 123456))
    with pytest.raises(CanonicalizationError, match="naive datetime"):
        build_canonical_snapshot_v1(record)


def test_bool_is_not_accepted_where_an_integer_is_expected():
    record = _record(findings=[_finding(id=_F1, sequence=True)])
    with pytest.raises(CanonicalizationError, match="bool"):
        build_canonical_snapshot_v1(record)


def test_serializer_refuses_an_unsupported_type():
    with pytest.raises(CanonicalizationError, match="float"):
        serialize_canonical_v1({"x": 1.5})


def _bytes(record) -> bytes:
    return serialize_canonical_v1(build_canonical_snapshot_v1(record))


# ===========================================================================
# The emitter is hand-written, so prove independently that it emits JSON
# ===========================================================================

# A string exercising every escaping rule at once. Built from chr() calls so
# the source file itself holds no literal backslash and cannot blur which
# code point is meant.
_BACKSLASH = chr(0x5C)
_TRICKY = (
    'Quote " backslash '
    + _BACKSLASH
    + " newline "
    + chr(0x0A)
    + " tab "
    + chr(0x09)
    + " ctrl "
    + chr(0x01)
    + " unicode ñ→€"
)

# Written by hand from the contract: only the double quote, the backslash and
# control characters below U+0020 are escaped; control characters use the
# six-character backslash-u form with lowercase hex; non-ASCII stays literal.
_TRICKY_CANONICAL_FRAGMENT = (
    '"observations":"Quote '
    + _BACKSLASH
    + '" backslash '
    + _BACKSLASH
    + _BACKSLASH
    + " newline "
    + _BACKSLASH
    + "u000a tab "
    + _BACKSLASH
    + "u0009 ctrl "
    + _BACKSLASH
    + 'u0001 unicode ñ→€"'
)


def test_escaping_matches_the_contract_byte_for_byte():
    produced = _bytes(_record(observations=_TRICKY))
    assert _TRICKY_CANONICAL_FRAGMENT.encode("utf-8") in produced
    # Non-ASCII is never backslash-u escaped, and JSON short escapes are
    # never used for control characters.
    assert "ñ→€".encode() in produced
    for forbidden in ("n", "t", "u00f1", "u2192"):
        assert (_BACKSLASH + forbidden).encode("utf-8") not in produced


@pytest.mark.parametrize(
    "record",
    [VECTOR_A_RECORD, VECTOR_B_RECORD],
    ids=["vector_a", "vector_b"],
)
def test_canonical_bytes_are_syntactically_valid_json(record):
    """The stdlib parser accepts the output and it round-trips losslessly.

    ``json.loads`` is used only as an independent *reader*; no golden value
    in this file is produced by ``json.dumps``.
    """
    produced = _bytes(record)
    parsed = json.loads(produced.decode("utf-8"))
    assert parsed == build_canonical_snapshot_v1(record)


def test_escaped_string_round_trips_through_the_stdlib_parser():
    """Every escaped character comes back exactly as it went in."""
    parsed = json.loads(_bytes(_record(observations=_TRICKY)).decode("utf-8"))
    assert parsed["observations"] == _TRICKY
    assert parsed["observations"].count(chr(0x0A)) == 1
    assert parsed["observations"].count(chr(0x09)) == 1
    assert parsed["observations"].count(chr(0x01)) == 1
    assert parsed["observations"].count(_BACKSLASH) == 1


def test_unicode_is_not_normalised():
    """NFC and NFD forms of the same text stay distinct, as stored."""
    nfc = chr(0x00F1)  # ñ as one code point
    nfd = "n" + chr(0x0303)  # n + combining tilde
    assert nfc != nfd
    assert _bytes(_record(observations=nfc)) != _bytes(_record(observations=nfd))
    for text in (nfc, nfd):
        parsed = json.loads(_bytes(_record(observations=text)).decode("utf-8"))
        assert parsed["observations"] == text
