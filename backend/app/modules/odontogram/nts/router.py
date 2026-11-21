"""HTTP API for NTS clinical records, mounted under ``/api/v1/odontogram/nts``.

Transaction boundary: ``get_db()`` owns it — it commits when a handler
returns and rolls back when one raises. So this router never calls
``commit()`` or ``rollback()``, and it never converts a domain failure into
a returned response: the failure is re-raised as an ``HTTPException`` so the
dependency actually rolls the transaction back. Returning a 4xx normally
would commit a half-applied mutation.

Permissions reuse the module's existing ``odontogram.read`` /
``odontogram.write``. No NTS-specific permission is introduced.

Normative meaning lives in the catalog; there is no ``rule_id`` branch here.
"""

from __future__ import annotations

from collections.abc import Awaitable
from typing import Annotated, Any, TypeVar
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth.dependencies import (
    ClinicContext,
    get_clinic_context,
    require_permission,
)
from app.core.schemas import ApiResponse, PaginatedApiResponse
from app.database import get_db
from app.modules.patients.access import PatientAccessPolicy

from .catalog import NtsCatalog, get_nts_catalog
from .catalog.loader import CatalogNotFoundError, available_norm_versions
from .exceptions import (
    NtsClinicalValidationError,
    NtsDraftConflictError,
    NtsError,
    NtsRecordNotFoundError,
    NtsStateConflictError,
    NtsVersionConflictError,
)
from .models import NtsOdontogramRecord
from .schemas import (
    NtsCatalogVersionsResponse,
    NtsDiscardRequest,
    NtsDraftCreateRequest,
    NtsExpectedVersionRequest,
    NtsFindingAttributesReplaceRequest,
    NtsFindingCreateRequest,
    NtsFindingMutationResponse,
    NtsFindingResponse,
    NtsRecordMetadataUpdateRequest,
    NtsRecordResponse,
    NtsRecordSummaryResponse,
    NtsSpecificationCreateRequest,
    NtsSpecificationMutationResponse,
    NtsSpecificationReplaceRequest,
    NtsSpecificationResponse,
    NtsTargetInput,
    NtsTargetsReplaceRequest,
    NtsVersionMutationResponse,
)
from .service import FindingSpec, NtsRecordService, TargetSpec

router = APIRouter()

T = TypeVar("T")

#: Domain failure -> (status, machine-readable code). Mapped in one place so
#: every endpoint answers the same way, and so a new domain error cannot
#: silently become a 500.
_ERROR_MAP: dict[type[NtsError], tuple[int, str]] = {
    NtsRecordNotFoundError: (status.HTTP_404_NOT_FOUND, "nts_record_not_found"),
    NtsVersionConflictError: (status.HTTP_409_CONFLICT, "nts_version_conflict"),
    NtsDraftConflictError: (status.HTTP_409_CONFLICT, "nts_draft_conflict"),
    NtsStateConflictError: (status.HTTP_409_CONFLICT, "nts_state_conflict"),
    NtsClinicalValidationError: (
        status.HTTP_422_UNPROCESSABLE_ENTITY,
        "nts_clinical_validation",
    ),
}


def _to_http(exc: NtsError) -> HTTPException:
    """Translate a domain failure, preserving the individual errors.

    ``NtsClinicalValidationError`` carries every problem found, and the list
    survives into the response body rather than being flattened into one
    string — a clinician should fix one form, not N.
    """
    for error_type, (http_status, code) in _ERROR_MAP.items():
        if isinstance(exc, error_type):
            errors = getattr(exc, "errors", None) or [str(exc)]
            return HTTPException(
                status_code=http_status,
                detail={"code": code, "message": str(exc), "errors": errors},
            )
    # An unmapped NtsError is a bug, not client input: let it be a 500.
    raise exc


async def _guard(operation: Awaitable[T]) -> T:
    """Await a service call, re-raising domain failures as HTTP ones.

    The HTTPException propagates out of the handler, which is what makes
    ``get_db`` roll the transaction back.
    """
    try:
        return await operation
    except NtsError as exc:
        raise _to_http(exc) from exc


async def _validate_patient_access(db: AsyncSession, ctx: ClinicContext, patient_id: UUID) -> None:
    if not await PatientAccessPolicy.can_access(db, ctx, patient_id):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Patient not found")


async def _get_accessible_record(
    db: AsyncSession, ctx: ClinicContext, record_id: UUID
) -> NtsOdontogramRecord:
    """Load a record for this clinic *and* this user's patient scope.

    A record outside the caller's patient scope answers 404, never 403: a
    403 would confirm that some other patient's record exists.
    """
    record = await _guard(NtsRecordService.get_record(db, ctx.clinic_id, record_id))
    if not await PatientAccessPolicy.can_access(db, ctx, record.patient_id):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="NTS record not found")
    return record


def _require_known_norm(norm_version: str) -> None:
    """Separate "unknown norm" from "no record yet".

    Without this a typo in ``norm_version`` would look like an empty
    history. The check is a catalog lookup, never a hand-written list.
    """
    try:
        get_nts_catalog(norm_version)
    except CatalogNotFoundError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={
                "code": "nts_norm_version_unknown",
                "message": str(exc),
                "errors": [str(exc)],
            },
        ) from exc


def _targets(inputs: list[NtsTargetInput]) -> list[TargetSpec]:
    return [
        TargetSpec(
            participation=t.participation,
            target_kind=t.target_kind,
            tooth_number=t.tooth_number,
            arch=t.arch,
            local_ordinal=t.local_ordinal,
            role=t.role,
            group_index=t.group_index,
            position=t.position,
        )
        for t in inputs
    ]


def _record_response(record: NtsOdontogramRecord) -> NtsRecordResponse:
    return NtsRecordResponse.model_validate(record)


# ===========================================================================
# catalog (read-only, no patient involved)
# ===========================================================================


@router.get(
    "/catalogs",
    response_model=ApiResponse[NtsCatalogVersionsResponse],
    summary="Norm versions this build can interpret",
)
async def list_catalogs(
    _ctx: Annotated[ClinicContext, Depends(get_clinic_context)],
    _: Annotated[None, Depends(require_permission("odontogram.read"))],
) -> ApiResponse[NtsCatalogVersionsResponse]:
    return ApiResponse(
        data=NtsCatalogVersionsResponse(norm_versions=list(available_norm_versions()))
    )


@router.get(
    "/catalogs/{norm_version}",
    response_model=ApiResponse[NtsCatalog],
    summary="The full versioned catalog",
)
async def get_catalog(
    norm_version: str,
    _ctx: Annotated[ClinicContext, Depends(get_clinic_context)],
    _: Annotated[None, Depends(require_permission("odontogram.read"))],
) -> ApiResponse[NtsCatalog]:
    """Serve the catalog so no client re-types the norm.

    The catalog's own Pydantic models are the response schema; wrapping them
    in parallel ``*Response`` shapes would be a second hand-maintained copy
    of the same 38 rules.
    """
    _require_known_norm(norm_version)
    return ApiResponse(data=get_nts_catalog(norm_version))


# ===========================================================================
# patient-scoped records
# ===========================================================================


@router.get(
    "/patients/{patient_id}/records",
    response_model=PaginatedApiResponse[NtsRecordSummaryResponse],
    summary="A patient's record history",
)
async def list_records(
    patient_id: UUID,
    ctx: Annotated[ClinicContext, Depends(get_clinic_context)],
    _: Annotated[None, Depends(require_permission("odontogram.read"))],
    db: Annotated[AsyncSession, Depends(get_db)],
    norm_version: Annotated[str | None, Query()] = None,
    record_status: Annotated[str | None, Query(alias="status")] = None,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
) -> PaginatedApiResponse[NtsRecordSummaryResponse]:
    await _validate_patient_access(db, ctx, patient_id)
    if norm_version is not None:
        _require_known_norm(norm_version)

    summaries, total = await _guard(
        NtsRecordService.list_records(
            db,
            ctx.clinic_id,
            patient_id,
            norm_version=norm_version,
            status=record_status,
            page=page,
            page_size=page_size,
        )
    )
    return PaginatedApiResponse(
        data=[
            NtsRecordSummaryResponse(
                **{
                    field: getattr(summary.record, field)
                    for field in NtsRecordSummaryResponse.model_fields
                    if field != "is_superseded"
                },
                is_superseded=summary.is_superseded,
            )
            for summary in summaries
        ],
        total=total,
        page=page,
        page_size=page_size,
    )


@router.get(
    "/patients/{patient_id}/records/current",
    response_model=ApiResponse[NtsRecordResponse | None],
    summary="The clinically current finalized record, if any",
)
async def get_current_record(
    patient_id: UUID,
    norm_version: Annotated[str, Query(min_length=1)],
    ctx: Annotated[ClinicContext, Depends(get_clinic_context)],
    _: Annotated[None, Depends(require_permission("odontogram.read"))],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> ApiResponse[NtsRecordResponse | None]:
    """``data: null`` when there is none.

    Having no current record is an ordinary clinical state, not an error, so
    it is 200 with a null payload. Only a *named* record that does not exist
    is a 404.
    """
    await _validate_patient_access(db, ctx, patient_id)
    _require_known_norm(norm_version)
    record = await _guard(
        NtsRecordService.get_current_record(db, ctx.clinic_id, patient_id, norm_version)
    )
    return ApiResponse(data=_record_response(record) if record else None)


@router.get(
    "/patients/{patient_id}/records/draft",
    response_model=ApiResponse[NtsRecordResponse | None],
    summary="The open draft, if any",
)
async def get_draft(
    patient_id: UUID,
    norm_version: Annotated[str, Query(min_length=1)],
    ctx: Annotated[ClinicContext, Depends(get_clinic_context)],
    _: Annotated[None, Depends(require_permission("odontogram.read"))],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> ApiResponse[NtsRecordResponse | None]:
    """``data: null`` when none is open — see :func:`get_current_record`."""
    await _validate_patient_access(db, ctx, patient_id)
    _require_known_norm(norm_version)
    record = await _guard(
        NtsRecordService.get_editable_draft(db, ctx.clinic_id, patient_id, norm_version)
    )
    return ApiResponse(data=_record_response(record) if record else None)


@router.post(
    "/patients/{patient_id}/records",
    response_model=ApiResponse[NtsRecordResponse],
    status_code=status.HTTP_201_CREATED,
    summary="Open a draft (optionally correcting an earlier record)",
)
async def create_draft(
    patient_id: UUID,
    payload: NtsDraftCreateRequest,
    ctx: Annotated[ClinicContext, Depends(get_clinic_context)],
    _: Annotated[None, Depends(require_permission("odontogram.write"))],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> ApiResponse[NtsRecordResponse]:
    """A correction is a new record carrying ``supersedes_record_id``.

    There is no "supersede" endpoint: the predecessor is never modified.
    """
    await _validate_patient_access(db, ctx, patient_id)
    _require_known_norm(payload.norm_version)

    record = await _guard(
        NtsRecordService.create_draft(
            db,
            ctx.clinic_id,
            patient_id=patient_id,
            norm_version=payload.norm_version,
            stage=payload.stage,
            actor_id=ctx.user_id,
            stage_label=payload.stage_label,
            observations=payload.observations,
            seed=payload.seed,
            supersedes_record_id=payload.supersedes_record_id,
            supersession_reason=payload.supersession_reason,
        )
    )
    return ApiResponse(data=_record_response(record))


# ===========================================================================
# one record
# ===========================================================================


@router.get(
    "/records/{record_id}",
    response_model=ApiResponse[NtsRecordResponse],
    summary="One record with its findings, targets and specifications",
)
async def get_record(
    record_id: UUID,
    ctx: Annotated[ClinicContext, Depends(get_clinic_context)],
    _: Annotated[None, Depends(require_permission("odontogram.read"))],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> ApiResponse[NtsRecordResponse]:
    record = await _get_accessible_record(db, ctx, record_id)
    return ApiResponse(data=_record_response(record))


@router.patch(
    "/records/{record_id}",
    response_model=ApiResponse[NtsRecordResponse],
    summary="Change stage, stage label or observations",
)
async def update_metadata(
    record_id: UUID,
    payload: NtsRecordMetadataUpdateRequest,
    ctx: Annotated[ClinicContext, Depends(get_clinic_context)],
    _: Annotated[None, Depends(require_permission("odontogram.write"))],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> ApiResponse[NtsRecordResponse]:
    """An absent key leaves the field alone; an explicit ``null`` clears it."""
    await _get_accessible_record(db, ctx, record_id)
    record = await _guard(
        NtsRecordService.update_metadata(
            db,
            ctx.clinic_id,
            record_id,
            expected_version=payload.expected_version,
            actor_id=ctx.user_id,
            stage=payload.stage,
            stage_label=payload.stage_label,
            observations=payload.observations,
            clear_stage_label=payload.was_sent("stage_label") and payload.stage_label is None,
            clear_observations=payload.was_sent("observations") and payload.observations is None,
        )
    )
    return ApiResponse(data=_record_response(record))


# ===========================================================================
# findings
# ===========================================================================


@router.post(
    "/records/{record_id}/findings",
    response_model=ApiResponse[NtsFindingMutationResponse],
    status_code=status.HTTP_201_CREATED,
    summary="Add a finding and its targets as one aggregate",
)
async def create_finding(
    record_id: UUID,
    payload: NtsFindingCreateRequest,
    ctx: Annotated[ClinicContext, Depends(get_clinic_context)],
    _: Annotated[None, Depends(require_permission("odontogram.write"))],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> ApiResponse[NtsFindingMutationResponse]:
    record = await _get_accessible_record(db, ctx, record_id)
    finding = await _guard(
        NtsRecordService.create_finding(
            db,
            ctx.clinic_id,
            record_id,
            expected_version=payload.expected_version,
            actor_id=ctx.user_id,
            spec=FindingSpec(
                rule_id=payload.rule_id,
                attributes=payload.attributes,
                targets=_targets(payload.targets),
            ),
        )
    )
    return ApiResponse(
        data=NtsFindingMutationResponse(
            record_version=record.version,
            finding=NtsFindingResponse.model_validate(finding),
        )
    )


@router.put(
    "/records/{record_id}/findings/{finding_id}",
    response_model=ApiResponse[NtsFindingMutationResponse],
    summary="Replace a finding's attributes",
)
async def replace_finding_attributes(
    record_id: UUID,
    finding_id: UUID,
    payload: NtsFindingAttributesReplaceRequest,
    ctx: Annotated[ClinicContext, Depends(get_clinic_context)],
    _: Annotated[None, Depends(require_permission("odontogram.write"))],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> ApiResponse[NtsFindingMutationResponse]:
    record = await _get_accessible_record(db, ctx, record_id)
    finding = await _guard(
        NtsRecordService.update_finding_attributes(
            db,
            ctx.clinic_id,
            record_id,
            finding_id,
            expected_version=payload.expected_version,
            actor_id=ctx.user_id,
            attributes=payload.attributes,
        )
    )
    return ApiResponse(
        data=NtsFindingMutationResponse(
            record_version=record.version,
            finding=NtsFindingResponse.model_validate(finding),
        )
    )


@router.put(
    "/records/{record_id}/findings/{finding_id}/targets",
    response_model=ApiResponse[NtsFindingMutationResponse],
    summary="Replace a finding's whole target set",
)
async def replace_targets(
    record_id: UUID,
    finding_id: UUID,
    payload: NtsTargetsReplaceRequest,
    ctx: Annotated[ClinicContext, Depends(get_clinic_context)],
    _: Annotated[None, Depends(require_permission("odontogram.write"))],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> ApiResponse[NtsFindingMutationResponse]:
    """The set is validated as a whole and costs one version bump."""
    record = await _get_accessible_record(db, ctx, record_id)
    finding = await _guard(
        NtsRecordService.replace_targets(
            db,
            ctx.clinic_id,
            record_id,
            finding_id,
            expected_version=payload.expected_version,
            actor_id=ctx.user_id,
            targets=_targets(payload.targets),
        )
    )
    return ApiResponse(
        data=NtsFindingMutationResponse(
            record_version=record.version,
            finding=NtsFindingResponse.model_validate(finding),
        )
    )


@router.post(
    "/records/{record_id}/findings/{finding_id}/confirm",
    response_model=ApiResponse[NtsFindingMutationResponse],
    summary="Confirm one carried-forward finding as observed",
)
async def confirm_carried_forward(
    record_id: UUID,
    finding_id: UUID,
    payload: NtsExpectedVersionRequest,
    ctx: Annotated[ClinicContext, Depends(get_clinic_context)],
    _: Annotated[None, Depends(require_permission("odontogram.write"))],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> ApiResponse[NtsFindingMutationResponse]:
    """One finding at a time. There is deliberately no bulk confirmation."""
    record = await _get_accessible_record(db, ctx, record_id)
    finding = await _guard(
        NtsRecordService.confirm_carried_forward(
            db,
            ctx.clinic_id,
            record_id,
            finding_id,
            expected_version=payload.expected_version,
            actor_id=ctx.user_id,
        )
    )
    return ApiResponse(
        data=NtsFindingMutationResponse(
            record_version=record.version,
            finding=NtsFindingResponse.model_validate(finding),
        )
    )


@router.post(
    "/records/{record_id}/findings/{finding_id}/remove",
    response_model=ApiResponse[NtsVersionMutationResponse],
    summary="Remove a finding from a draft",
)
async def remove_finding(
    record_id: UUID,
    finding_id: UUID,
    payload: NtsExpectedVersionRequest,
    ctx: Annotated[ClinicContext, Depends(get_clinic_context)],
    _: Annotated[None, Depends(require_permission("odontogram.write"))],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> ApiResponse[NtsVersionMutationResponse]:
    """POST, not DELETE: ``expected_version`` belongs in the body (ADR 0022),
    and a DELETE carrying a body is poorly supported by clients and proxies.
    """
    record = await _get_accessible_record(db, ctx, record_id)
    await _guard(
        NtsRecordService.remove_finding(
            db,
            ctx.clinic_id,
            record_id,
            finding_id,
            expected_version=payload.expected_version,
            actor_id=ctx.user_id,
        )
    )
    return ApiResponse(data=NtsVersionMutationResponse(record_version=record.version))


# ===========================================================================
# specifications
# ===========================================================================


@router.post(
    "/records/{record_id}/specifications",
    response_model=ApiResponse[NtsSpecificationMutationResponse],
    status_code=status.HTTP_201_CREATED,
    summary="Add an Especificaciones entry",
)
async def create_specification(
    record_id: UUID,
    payload: NtsSpecificationCreateRequest,
    ctx: Annotated[ClinicContext, Depends(get_clinic_context)],
    _: Annotated[None, Depends(require_permission("odontogram.write"))],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> ApiResponse[NtsSpecificationMutationResponse]:
    record = await _get_accessible_record(db, ctx, record_id)
    specification = await _guard(
        NtsRecordService.set_specification(
            db,
            ctx.clinic_id,
            record_id,
            expected_version=payload.expected_version,
            actor_id=ctx.user_id,
            text=payload.text,
            finding_id=payload.finding_id,
        )
    )
    return ApiResponse(
        data=NtsSpecificationMutationResponse(
            record_version=record.version,
            specification=NtsSpecificationResponse.model_validate(specification),
        )
    )


@router.put(
    "/records/{record_id}/specifications/{specification_id}",
    response_model=ApiResponse[NtsSpecificationMutationResponse],
    summary="Replace an Especificaciones entry",
)
async def replace_specification(
    record_id: UUID,
    specification_id: UUID,
    payload: NtsSpecificationReplaceRequest,
    ctx: Annotated[ClinicContext, Depends(get_clinic_context)],
    _: Annotated[None, Depends(require_permission("odontogram.write"))],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> ApiResponse[NtsSpecificationMutationResponse]:
    """Full replacement: ``finding_id`` is required even when null, so
    omitting it can never be read as "unlink from its finding".
    """
    record = await _get_accessible_record(db, ctx, record_id)
    specification = await _guard(
        NtsRecordService.set_specification(
            db,
            ctx.clinic_id,
            record_id,
            expected_version=payload.expected_version,
            actor_id=ctx.user_id,
            text=payload.text,
            finding_id=payload.finding_id,
            specification_id=specification_id,
        )
    )
    return ApiResponse(
        data=NtsSpecificationMutationResponse(
            record_version=record.version,
            specification=NtsSpecificationResponse.model_validate(specification),
        )
    )


@router.post(
    "/records/{record_id}/specifications/{specification_id}/remove",
    response_model=ApiResponse[NtsVersionMutationResponse],
    summary="Remove an Especificaciones entry",
)
async def remove_specification(
    record_id: UUID,
    specification_id: UUID,
    payload: NtsExpectedVersionRequest,
    ctx: Annotated[ClinicContext, Depends(get_clinic_context)],
    _: Annotated[None, Depends(require_permission("odontogram.write"))],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> ApiResponse[NtsVersionMutationResponse]:
    record = await _get_accessible_record(db, ctx, record_id)
    await _guard(
        NtsRecordService.remove_specification(
            db,
            ctx.clinic_id,
            record_id,
            specification_id,
            expected_version=payload.expected_version,
            actor_id=ctx.user_id,
        )
    )
    return ApiResponse(data=NtsVersionMutationResponse(record_version=record.version))


# ===========================================================================
# lifecycle
# ===========================================================================


@router.post(
    "/records/{record_id}/finalize",
    response_model=ApiResponse[NtsRecordResponse],
    summary="Lock the clinical snapshot and stamp its integrity digest",
)
async def finalize(
    record_id: UUID,
    payload: NtsExpectedVersionRequest,
    ctx: Annotated[ClinicContext, Depends(get_clinic_context)],
    _: Annotated[None, Depends(require_permission("odontogram.write"))],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> ApiResponse[NtsRecordResponse]:
    """Finalizing means DenPlant locked the record.

    It does **not** mean the document is digitally signed, and it asserts no
    compliance or accreditation.
    """
    await _get_accessible_record(db, ctx, record_id)
    record = await _guard(
        NtsRecordService.finalize(
            db,
            ctx.clinic_id,
            record_id,
            expected_version=payload.expected_version,
            actor_id=ctx.user_id,
        )
    )
    return ApiResponse(data=_record_response(record))


@router.post(
    "/records/{record_id}/discard",
    response_model=ApiResponse[NtsRecordResponse],
    summary="Abandon a draft, keeping everything it held",
)
async def discard(
    record_id: UUID,
    payload: NtsDiscardRequest,
    ctx: Annotated[ClinicContext, Depends(get_clinic_context)],
    _: Annotated[None, Depends(require_permission("odontogram.write"))],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> ApiResponse[NtsRecordResponse]:
    await _get_accessible_record(db, ctx, record_id)
    record = await _guard(
        NtsRecordService.discard(
            db,
            ctx.clinic_id,
            record_id,
            expected_version=payload.expected_version,
            actor_id=ctx.user_id,
            reason=payload.reason,
        )
    )
    return ApiResponse(data=_record_response(record))


__all__: list[Any] = ["router"]
