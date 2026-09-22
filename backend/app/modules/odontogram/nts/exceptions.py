"""Domain exceptions for NTS clinical records.

Deliberately free of FastAPI: there is no NTS router yet, and the clinical
rules must not learn HTTP. NTS-04B.3 maps these onto status codes:

=================================  =====
:class:`NtsRecordNotFoundError`         404
:class:`NtsVersionConflictError`        409
:class:`NtsStateConflictError`          409
:class:`NtsDraftConflictError`          409
:class:`NtsClinicalValidationError`  422
=================================  =====

They subclass :class:`ValueError`, matching how ``agenda.service`` declares
``InvalidTransitionError`` and friends, so a caller that already handles
``ValueError`` is not surprised.
"""

from __future__ import annotations


class NtsError(ValueError):
    """Base class for every NTS domain failure."""


class NtsRecordNotFoundError(NtsError):
    """No such record for this clinic.

    Also raised when a record exists but belongs to a different clinic:
    the two cases are indistinguishable on purpose, so a caller cannot probe
    another clinic's identifiers.
    """


class NtsVersionConflictError(NtsError):
    """``expected_version`` no longer matches the stored version.

    Someone else mutated the record first. The caller re-reads and retries;
    nothing is overwritten.
    """


class NtsStateConflictError(NtsError):
    """The record's lifecycle state forbids the operation.

    A finalized or discarded record is terminal.
    """


class NtsDraftConflictError(NtsError):
    """A draft already exists for this clinic, patient and norm version.

    One draft at a time is a design decision (ADR 0022 §6), enforced by a
    partial unique index; this is that index surfacing as a domain failure.
    """


class NtsClinicalValidationError(NtsError):
    """The content violates the norm as the catalog describes it.

    Carries every problem found, not just the first, so a clinician fixes
    one form rather than N.
    """

    def __init__(self, errors: list[str]) -> None:
        self.errors = list(errors)
        joined = "; ".join(self.errors)
        super().__init__(f"{len(self.errors)} validation error(s): {joined}")
