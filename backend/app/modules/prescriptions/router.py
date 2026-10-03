"""Prescriptions API.

Mounted at ``/api/v1/prescriptions`` by the plugin loader.

There is deliberately no ``PUT``, ``PATCH`` or ``DELETE``: an issued
prescription is never edited and never deleted. A mistake is corrected by
voiding it (with a reason) and issuing a new one.

The router never commits or rolls back — ``get_db`` owns the transaction — and
it re-raises domain failures as ``HTTPException`` so a rejected request really
does roll back.
"""

from collections.abc import Awaitable
from typing import Annotated, TypeVar
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth.dependencies import ClinicContext, get_clinic_context, require_permission
from app.core.schemas import ApiResponse, PaginatedApiResponse
from app.database import get_db

from .exceptions import (
    PatientNotFoundError,
    PrescriberNotEligibleError,
    PrescriptionError,
    PrescriptionNotFoundError,
    PrescriptionStateError,
    PrescriptionValidationError,
    VoidNotAllowedError,
)
from .schemas import (
    PrescriptionCreate,
    PrescriptionResponse,
    PrescriptionSummaryResponse,
    PrescriptionVoid,
)
from .service import PrescriptionService

router = APIRouter()

T = TypeVar("T")

#: Domain failure -> (status, machine-readable code), mapped in one place so a
#: new failure cannot silently become a 500.
_ERROR_MAP: dict[type[PrescriptionError], tuple[int, str]] = {
    PrescriptionNotFoundError: (status.HTTP_404_NOT_FOUND, "prescription_not_found"),
    PatientNotFoundError: (status.HTTP_404_NOT_FOUND, "patient_not_found"),
    PrescriberNotEligibleError: (status.HTTP_403_FORBIDDEN, "prescriber_not_eligible"),
    VoidNotAllowedError: (status.HTTP_403_FORBIDDEN, "void_not_allowed"),
    PrescriptionStateError: (status.HTTP_409_CONFLICT, "prescription_state_conflict"),
    PrescriptionValidationError: (
        status.HTTP_422_UNPROCESSABLE_ENTITY,
        "prescription_validation",
    ),
}


def _to_http(exc: PrescriptionError) -> HTTPException:
    for error_type, (http_status, code) in _ERROR_MAP.items():
        if isinstance(exc, error_type):
            # A validation failure carries its own, more specific, code.
            code = getattr(exc, "code", None) or code
            return HTTPException(
                status_code=http_status,
                detail={"code": code, "message": str(exc), "errors": [str(exc)]},
            )
    # An unmapped failure is a bug, not client input: let it be a 500.
    raise exc


async def _guard(operation: Awaitable[T]) -> T:
    try:
        return await operation
    except PrescriptionError as exc:
        raise _to_http(exc) from exc


@router.post(
    "",
    response_model=ApiResponse[PrescriptionResponse],
    status_code=status.HTTP_201_CREATED,
    summary="Issue a prescription",
)
async def issue_prescription(
    data: PrescriptionCreate,
    ctx: Annotated[ClinicContext, Depends(get_clinic_context)],
    _: Annotated[None, Depends(require_permission("prescriptions.prescribe"))],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> ApiResponse[PrescriptionResponse]:
    """Prescription and items are created together. Clinic, prescriber, number,
    dates and snapshots all come from the server."""
    prescription = await _guard(PrescriptionService.issue(db, ctx, data))
    return ApiResponse(data=PrescriptionResponse.model_validate(prescription))


@router.get(
    "",
    response_model=PaginatedApiResponse[PrescriptionSummaryResponse],
    summary="A patient's prescriptions, newest first",
)
async def list_prescriptions(
    patient_id: Annotated[UUID, Query()],
    ctx: Annotated[ClinicContext, Depends(get_clinic_context)],
    _: Annotated[None, Depends(require_permission("prescriptions.read"))],
    db: Annotated[AsyncSession, Depends(get_db)],
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
) -> PaginatedApiResponse[PrescriptionSummaryResponse]:
    rows, total = await _guard(
        PrescriptionService.list_for_patient(db, ctx, patient_id, page=page, page_size=page_size)
    )
    return PaginatedApiResponse(
        data=[PrescriptionSummaryResponse(**vars(row)) for row in rows],
        total=total,
        page=page,
        page_size=page_size,
    )


@router.get(
    "/{prescription_id}",
    response_model=ApiResponse[PrescriptionResponse],
    summary="One prescription with its snapshots and items",
)
async def get_prescription(
    prescription_id: UUID,
    ctx: Annotated[ClinicContext, Depends(get_clinic_context)],
    _: Annotated[None, Depends(require_permission("prescriptions.read"))],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> ApiResponse[PrescriptionResponse]:
    prescription = await _guard(PrescriptionService.get_accessible(db, ctx, prescription_id))
    return ApiResponse(data=PrescriptionResponse.model_validate(prescription))


@router.post(
    "/{prescription_id}/void",
    response_model=ApiResponse[PrescriptionResponse],
    summary="Void an issued prescription",
)
async def void_prescription(
    prescription_id: UUID,
    data: PrescriptionVoid,
    ctx: Annotated[ClinicContext, Depends(get_clinic_context)],
    _: Annotated[None, Depends(require_permission("prescriptions.void"))],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> ApiResponse[PrescriptionResponse]:
    """A reason is required. Only the original prescriber or an admin may void;
    a voided prescription cannot be voided again or restored."""
    prescription = await _guard(PrescriptionService.void(db, ctx, prescription_id, data.reason))
    return ApiResponse(data=PrescriptionResponse.model_validate(prescription))
