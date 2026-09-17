"""CanonicalSnapshotV1 — byte-exact serialization of a clinical record.

The contract: *the same clinical record → the same canonical bytes → the
same SHA-256*, independent of query order, dictionary ordering, local
timezone, ORM version or frontend version. It is specified in
``docs/technical/odontogram/nts-record-model.md`` §10, and that document is
the authority; this module implements it and nothing more.

Three separate stages, deliberately not fused:

1. :func:`build_canonical_snapshot_v1` — build the logical value tree.
2. :func:`serialize_canonical_v1` — emit the canonical UTF-8 bytes.
3. :func:`sha256_canonical_v1` — digest those bytes.

Why a hand-written emitter instead of :func:`json.dumps`: the contract
fixes escaping down to the byte (every control character as ``\\u00xx``,
where JSON's short escapes would give ``\\n``), and the whole point of a
"logical JSON controlled by DenPlant" is that a library upgrade can never
change a stored record's digest. The output is still valid JSON.

``canonicalization_version = 1`` is permanent. Any change to any rule here
is version 2, and version 1 must keep working so existing records stay
verifiable.

This module is pure: no database, no ORM, no I/O. It reads attributes by
name, so it accepts an ORM record, a dataclass or a simple namespace alike.
"""

from __future__ import annotations

import hashlib
from collections.abc import Iterable
from datetime import UTC, datetime
from typing import Any, Final
from uuid import UUID

from app.modules.odontogram.nts.constants import (
    CANONICALIZATION_VERSION_V1,
    HASH_ALGORITHM_SHA256,
)

__all__ = [
    "CANONICALIZATION_VERSION_V1",
    "HASH_ALGORITHM_SHA256",
    "CanonicalizationError",
    "build_canonical_snapshot_v1",
    "serialize_canonical_v1",
    "sha256_canonical_v1",
]

#: Timestamp format: UTC, always six fractional digits, always ``Z``.
_TIMESTAMP_FORMAT: Final[str] = "%Y-%m-%dT%H:%M:%S.%f"


class CanonicalizationError(ValueError):
    """The input cannot be canonicalised under version 1.

    Raised rather than guessing. A record whose digest we cannot reproduce
    later is worse than a record that failed to finalize now.
    """


# --------------------------------------------------------------------------
# stage 1 — the logical value tree
# --------------------------------------------------------------------------


def build_canonical_snapshot_v1(record: Any) -> dict[str, Any]:
    """Return the canonical value tree for ``record``.

    ``record`` must expose the attribute names of the contract, with
    ``findings`` (each exposing ``targets``) and ``specifications`` loaded.
    Ordering of those collections is irrelevant — this function sorts them.
    """
    return {
        "id": _uuid(record.id, "record.id"),
        "clinic_id": _uuid(record.clinic_id, "record.clinic_id"),
        "patient_id": _uuid(record.patient_id, "record.patient_id"),
        "norm_version": _text(record.norm_version, "record.norm_version"),
        "stage": _text(record.stage, "record.stage"),
        "stage_label": _text(record.stage_label, "record.stage_label"),
        "observations": _text(record.observations, "record.observations"),
        "supersedes_record_id": _uuid(record.supersedes_record_id, "record.supersedes_record_id"),
        "supersession_reason": _text(record.supersession_reason, "record.supersession_reason"),
        "recorded_at": _timestamp(record.recorded_at, "record.recorded_at"),
        "recorded_by": _uuid(record.recorded_by, "record.recorded_by"),
        "finalized_at": _timestamp(record.finalized_at, "record.finalized_at"),
        "finalized_by": _uuid(record.finalized_by, "record.finalized_by"),
        "recorded_by_name": _text(record.recorded_by_name, "record.recorded_by_name"),
        "recorded_by_role": _text(record.recorded_by_role, "record.recorded_by_role"),
        "recorded_by_professional_id": _text(
            record.recorded_by_professional_id, "record.recorded_by_professional_id"
        ),
        "findings": _findings(getattr(record, "findings", ()) or ()),
        "specifications": _specifications(getattr(record, "specifications", ()) or ()),
    }


def _findings(findings: Iterable[Any]) -> list[dict[str, Any]]:
    built = [
        {
            "id": _uuid(f.id, "finding.id"),
            "rule_id": _text(f.rule_id, "finding.rule_id"),
            "attributes": _attributes(f.attributes, "finding.attributes"),
            "provenance": _text(f.provenance, "finding.provenance"),
            "source_finding_id": _uuid(f.source_finding_id, "finding.source_finding_id"),
            "sequence": _integer(f.sequence, "finding.sequence"),
            "created_at": _timestamp(f.created_at, "finding.created_at"),
            "created_by": _uuid(f.created_by, "finding.created_by"),
            "targets": _targets(getattr(f, "targets", ()) or ()),
        }
        for f in findings
    ]
    # (sequence, id) — `id` makes the order total.
    return sorted(built, key=lambda item: (item["sequence"], item["id"]))


def _targets(targets: Iterable[Any]) -> list[dict[str, Any]]:
    built = [
        {
            "id": _uuid(t.id, "target.id"),
            "group_index": _integer(t.group_index, "target.group_index"),
            "position": _integer(t.position, "target.position"),
            "participation": _text(t.participation, "target.participation"),
            "role": _text(t.role, "target.role"),
            "target_kind": _text(t.target_kind, "target.target_kind"),
            "tooth_number": _integer(t.tooth_number, "target.tooth_number"),
            "arch": _text(t.arch, "target.arch"),
            "local_ordinal": _integer(t.local_ordinal, "target.local_ordinal"),
            "geometry": _geometry(getattr(t, "geometry", None)),
        }
        for t in targets
    ]
    # (group_index, position, id)
    return sorted(
        built,
        key=lambda item: (item["group_index"], item["position"], item["id"]),
    )


def _specifications(specifications: Iterable[Any]) -> list[dict[str, Any]]:
    built = [
        {
            "id": _uuid(s.id, "specification.id"),
            "finding_id": _uuid(s.finding_id, "specification.finding_id"),
            "text": _text(s.text, "specification.text"),
            "sequence": _integer(s.sequence, "specification.sequence"),
        }
        for s in specifications
    ]
    return sorted(built, key=lambda item: (item["sequence"], item["id"]))


# --- value coercion -------------------------------------------------------


def _uuid(value: Any, where: str) -> str | None:
    """Canonical hyphenated lowercase string, 36 characters."""
    if value is None:
        return None
    if isinstance(value, UUID):
        return str(value)
    if isinstance(value, str):
        try:
            return str(UUID(value))
        except ValueError as exc:
            raise CanonicalizationError(f"{where}: {value!r} is not a UUID") from exc
    raise CanonicalizationError(f"{where}: expected UUID, got {type(value).__name__}")


def _timestamp(value: Any, where: str) -> str | None:
    """UTC, ``YYYY-MM-DDTHH:MM:SS.ffffffZ``, exactly six fractional digits.

    A naive datetime is rejected rather than assumed to be UTC: guessing a
    timezone would silently change the digest of a clinical record.
    """
    if value is None:
        return None
    if not isinstance(value, datetime):
        raise CanonicalizationError(f"{where}: expected datetime, got {type(value).__name__}")
    if value.tzinfo is None or value.utcoffset() is None:
        raise CanonicalizationError(f"{where}: naive datetime; a timezone-aware value is required")
    return value.astimezone(UTC).strftime(_TIMESTAMP_FORMAT) + "Z"


def _text(value: Any, where: str) -> str | None:
    """Pass a string through unchanged — no Unicode normalisation.

    Enum members (``StrEnum``) are accepted and reduced to their value.
    """
    if value is None:
        return None
    if isinstance(value, str):
        return str(value)
    raise CanonicalizationError(f"{where}: expected str, got {type(value).__name__}")


def _integer(value: Any, where: str) -> int | None:
    if value is None:
        return None
    if isinstance(value, bool):
        raise CanonicalizationError(f"{where}: bool is not an integer here")
    if isinstance(value, int):
        return value
    raise CanonicalizationError(f"{where}: expected int, got {type(value).__name__}")


def _attributes(value: Any, where: str) -> dict[str, Any]:
    if value is None:
        return {}
    if not isinstance(value, dict):
        raise CanonicalizationError(f"{where}: expected object, got {type(value).__name__}")
    return _plain(value, where)


def _plain(value: Any, where: str) -> Any:
    """Validate a JSONB subtree: str/int/bool/None/list/dict only.

    Floats are rejected everywhere in version 1 (see the module docstring
    and §10.5 rule 10).
    """
    if value is None or isinstance(value, (str, bool)):
        return value
    if isinstance(value, float):
        raise CanonicalizationError(
            f"{where}: floats are not permitted in canonicalization version 1"
        )
    if isinstance(value, int):
        return value
    if isinstance(value, dict):
        for key in value:
            if not isinstance(key, str):
                raise CanonicalizationError(f"{where}: object keys must be strings")
        return {k: _plain(v, f"{where}.{k}") for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [_plain(v, f"{where}[{i}]") for i, v in enumerate(value)]
    raise CanonicalizationError(f"{where}: unsupported value type {type(value).__name__}")


def _geometry(value: Any) -> None:
    """Version 1 stores no geometry — **GEOMETRY CONTRACT PENDING**.

    A non-null geometry is refused loudly rather than dropped, so a record
    whose digest we could not reproduce under a future contract can never
    be finalized as version 1.
    """
    if value is None:
        return None
    raise CanonicalizationError(
        "target.geometry is set, but canonicalization version 1 defines no "
        "geometry contract (GEOMETRY CONTRACT PENDING). Capturing geometry "
        "requires canonicalization version 2."
    )


# --------------------------------------------------------------------------
# stage 2 — canonical bytes
# --------------------------------------------------------------------------


def serialize_canonical_v1(snapshot: dict[str, Any]) -> bytes:
    """Emit the canonical UTF-8 bytes for a built snapshot."""
    return _emit(snapshot).encode("utf-8")


def _emit(value: Any) -> str:
    if value is None:
        return "null"
    if value is True:
        return "true"
    if value is False:
        return "false"
    if isinstance(value, str):
        return _emit_string(value)
    if isinstance(value, int):
        return str(value)
    if isinstance(value, dict):
        # Keys sorted ascending by Unicode code point.
        items = ",".join(f"{_emit_string(key)}:{_emit(value[key])}" for key in sorted(value))
        return "{" + items + "}"
    if isinstance(value, (list, tuple)):
        return "[" + ",".join(_emit(item) for item in value) + "]"
    if isinstance(value, float):
        raise CanonicalizationError("floats are not permitted in canonicalization version 1")
    raise CanonicalizationError(
        f"unsupported value type {type(value).__name__} in canonical snapshot"
    )


def _emit_string(value: str) -> str:
    """JSON string, UTF-8 literal, no Unicode normalisation, no ASCII escaping.

    Only what the contract requires is escaped: ``"``, ``\\`` and every
    control character below ``U+0020`` as ``\\u00xx`` with lowercase hex.
    Short escapes (``\\n``, ``\\t``, …) are deliberately **not** used, so
    the byte output never depends on a JSON library's choices.
    """
    out = ['"']
    for char in value:
        if char == '"':
            out.append('\\"')
        elif char == "\\":
            out.append("\\\\")
        elif char < " ":
            out.append(f"\\u{ord(char):04x}")
        else:
            out.append(char)
    out.append('"')
    return "".join(out)


# --------------------------------------------------------------------------
# stage 3 — digest
# --------------------------------------------------------------------------


def sha256_canonical_v1(record: Any) -> str:
    """Build, serialise and digest ``record``. Lowercase hex, 64 chars."""
    return digest_canonical_v1(serialize_canonical_v1(build_canonical_snapshot_v1(record)))


def digest_canonical_v1(payload: bytes) -> str:
    """SHA-256 of already-canonical bytes, as lowercase hex."""
    return hashlib.sha256(payload).hexdigest()
