"""Domain failures for prescriptions.

Free of FastAPI so the rules never learn HTTP; the router maps them.

==================================  =====  ============================
:class:`PrescriptionNotFoundError`   404   ``prescription_not_found``
:class:`PatientNotFoundError`        404   ``patient_not_found``
:class:`PrescriberNotEligibleError`  403   ``prescriber_not_eligible``
:class:`VoidNotAllowedError`         403   ``void_not_allowed``
:class:`PrescriptionStateError`      409   ``prescription_state_conflict``
:class:`PrescriptionValidationError` 422   ``prescription_validation``
:class:`PdfUnavailable`              503   ``pdf_unavailable``
:class:`PdfRenderFailed`             500   ``pdf_render_failed``
==================================  =====  ============================
"""

from __future__ import annotations


class PrescriptionError(ValueError):
    """Base class for every prescriptions domain failure."""


class PrescriptionNotFoundError(PrescriptionError):
    """No such prescription for this clinic.

    Also raised when it exists in another clinic or the caller has no access
    to its patient: the cases are indistinguishable on purpose, so an
    identifier cannot be probed.
    """


class PatientNotFoundError(PrescriptionError):
    """The patient does not exist, belongs to another clinic or is out of this
    caller's scope. The three are indistinguishable on purpose."""


class PrescriberNotEligibleError(PrescriptionError):
    """The caller may not issue prescriptions.

    Holding the permission is not enough: only a ``dentist`` membership may
    prescribe, whatever the wildcard an ``admin`` carries.
    """


class VoidNotAllowedError(PrescriptionError):
    """The caller may read this prescription but not void it.

    Only the original prescriber, or an admin, may.
    """


class PrescriptionStateError(PrescriptionError):
    """The lifecycle forbids it: a voided prescription is terminal."""


class PrescriptionValidationError(PrescriptionError):
    """The request cannot become a prescription.

    ``code`` says which rule, in machine-readable form, so a client can react
    without parsing prose (for example to send the user to the patient's
    record to fill in a missing date of birth).
    """

    def __init__(self, code: str, message: str) -> None:
        self.code = code
        super().__init__(message)


class PdfUnavailable(PrescriptionError):  # noqa: N818  (names fixed by the design)
    """The PDF renderer cannot be loaded on this server.

    Never answered with a stand-in: a response that says ``application/pdf``
    must be a PDF.
    """


class PdfRenderFailed(PrescriptionError):  # noqa: N818  (names fixed by the design)
    """The renderer failed on this document.

    The message is deliberately generic: what went wrong inside the renderer is
    logged against the prescription id, and what is on the prescription never
    reaches an error body.
    """
