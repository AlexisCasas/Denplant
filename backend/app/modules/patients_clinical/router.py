"""HTTP surface for patients_clinical.

Mounted under ``/api/v1/patients_clinical/*``. Endpoints are scoped by
``patient_id`` path parameter; each verifies the patient belongs to
the caller's clinic before touching clinical rows.

The legacy ``/medical-history`` bulk endpoint stays — the form still
submits the whole blob — but it now writes normalized rows atomically.
"""

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth.dependencies import ClinicContext, get_clinic_context, require_permission
from app.core.events import EventType, event_bus
from app.core.schemas import ApiResponse
from app.database import get_db
from app.modules.patients.access import PatientAccessPolicy

from .schemas import (
    AllergyCreate,
    AllergyResponse,
    AllergyUpdate,
    DentalAnamnesisInput,
    DentalAnamnesisResponse,
    EmergencyContactResponse,
    EmergencyContactUpsert,
    EndodonticRecordCreate,
    EndodonticRecordResponse,
    EndodonticRecordUpdate,
    LegalGuardianResponse,
    LegalGuardianUpsert,
    MedicalContextResponse,
    MedicalContextUpdate,
    MedicalHistoryResponse,
    MedicalHistoryUpdate,
    MedicationCreate,
    MedicationResponse,
    MedicationUpdate,
    PatientAlertsResponse,
    PediatricDentalAnamnesisInput,
    PediatricDentalAnamnesisResponse,
    SurgicalHistoryCreate,
    SurgicalHistoryResponse,
    SurgicalHistoryUpdate,
    SystemicDiseaseCreate,
    SystemicDiseaseResponse,
    SystemicDiseaseUpdate,
)
from .service import PatientsClinicalService

router = APIRouter()


async def _ensure_patient(db: AsyncSession, ctx: ClinicContext, patient_id: UUID) -> None:
    if not await PatientAccessPolicy.can_access(db, ctx, patient_id):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Patient not found")


# --- Medical context (1:1) ----------------------------------------------


@router.get(
    "/patients/{patient_id}/medical-context",
    response_model=ApiResponse[MedicalContextResponse],
)
async def get_medical_context(
    patient_id: UUID,
    ctx: Annotated[ClinicContext, Depends(get_clinic_context)],
    _: Annotated[None, Depends(require_permission("patients_clinical.medical.read"))],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> ApiResponse[MedicalContextResponse]:
    await _ensure_patient(db, ctx, patient_id)
    ctx_row = await PatientsClinicalService.get_medical_context(db, patient_id)
    if ctx_row is None:
        return ApiResponse(data=MedicalContextResponse())
    return ApiResponse(data=MedicalContextResponse.model_validate(ctx_row))


@router.put(
    "/patients/{patient_id}/medical-context",
    response_model=ApiResponse[MedicalContextResponse],
)
async def update_medical_context(
    patient_id: UUID,
    data: MedicalContextUpdate,
    ctx: Annotated[ClinicContext, Depends(get_clinic_context)],
    _: Annotated[None, Depends(require_permission("patients_clinical.medical.write"))],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> ApiResponse[MedicalContextResponse]:
    await _ensure_patient(db, ctx, patient_id)
    ctx_row = await PatientsClinicalService.upsert_medical_context(
        db, ctx.clinic_id, patient_id, data.model_dump(exclude_unset=True), ctx.user_id
    )
    await db.commit()
    await db.refresh(ctx_row)
    await event_bus.publish(
        EventType.PATIENT_MEDICAL_UPDATED,
        {
            "patient_id": str(patient_id),
            "clinic_id": str(ctx.clinic_id),
            "user_id": str(ctx.user_id),
            "section": "context",
            "summary": "Contexto médico actualizado",
        },
    )
    return ApiResponse(data=MedicalContextResponse.model_validate(ctx_row))


# --- Allergies ---------------------------------------------------------


@router.get(
    "/patients/{patient_id}/allergies",
    response_model=ApiResponse[list[AllergyResponse]],
)
async def list_allergies(
    patient_id: UUID,
    ctx: Annotated[ClinicContext, Depends(get_clinic_context)],
    _: Annotated[None, Depends(require_permission("patients_clinical.medical.read"))],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> ApiResponse[list[AllergyResponse]]:
    await _ensure_patient(db, ctx, patient_id)
    allergies = await PatientsClinicalService.list_allergies(db, patient_id)
    return ApiResponse(data=[AllergyResponse.model_validate(a) for a in allergies])


@router.post(
    "/patients/{patient_id}/allergies",
    response_model=ApiResponse[AllergyResponse],
    status_code=status.HTTP_201_CREATED,
)
async def create_allergy(
    patient_id: UUID,
    data: AllergyCreate,
    ctx: Annotated[ClinicContext, Depends(get_clinic_context)],
    _: Annotated[None, Depends(require_permission("patients_clinical.medical.write"))],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> ApiResponse[AllergyResponse]:
    await _ensure_patient(db, ctx, patient_id)
    allergy = await PatientsClinicalService.create_allergy(
        db, ctx.clinic_id, patient_id, data.model_dump()
    )
    await db.commit()
    await db.refresh(allergy)
    return ApiResponse(data=AllergyResponse.model_validate(allergy))


@router.put(
    "/patients/{patient_id}/allergies/{allergy_id}",
    response_model=ApiResponse[AllergyResponse],
)
async def update_allergy(
    patient_id: UUID,
    allergy_id: UUID,
    data: AllergyUpdate,
    ctx: Annotated[ClinicContext, Depends(get_clinic_context)],
    _: Annotated[None, Depends(require_permission("patients_clinical.medical.write"))],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> ApiResponse[AllergyResponse]:
    await _ensure_patient(db, ctx, patient_id)
    allergy = await PatientsClinicalService.get_allergy(db, allergy_id)
    if allergy is None or allergy.patient_id != patient_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Allergy not found")
    allergy = await PatientsClinicalService.update_allergy(
        db, allergy, data.model_dump(exclude_unset=True)
    )
    await db.commit()
    await db.refresh(allergy)
    return ApiResponse(data=AllergyResponse.model_validate(allergy))


@router.delete(
    "/patients/{patient_id}/allergies/{allergy_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def delete_allergy(
    patient_id: UUID,
    allergy_id: UUID,
    ctx: Annotated[ClinicContext, Depends(get_clinic_context)],
    _: Annotated[None, Depends(require_permission("patients_clinical.medical.write"))],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> None:
    await _ensure_patient(db, ctx, patient_id)
    allergy = await PatientsClinicalService.get_allergy(db, allergy_id)
    if allergy is None or allergy.patient_id != patient_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Allergy not found")
    await PatientsClinicalService.delete_allergy(db, allergy)
    await db.commit()


# --- Medications -------------------------------------------------------


@router.get(
    "/patients/{patient_id}/medications",
    response_model=ApiResponse[list[MedicationResponse]],
)
async def list_medications(
    patient_id: UUID,
    ctx: Annotated[ClinicContext, Depends(get_clinic_context)],
    _: Annotated[None, Depends(require_permission("patients_clinical.medical.read"))],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> ApiResponse[list[MedicationResponse]]:
    await _ensure_patient(db, ctx, patient_id)
    meds = await PatientsClinicalService.list_medications(db, patient_id)
    return ApiResponse(data=[MedicationResponse.model_validate(m) for m in meds])


@router.post(
    "/patients/{patient_id}/medications",
    response_model=ApiResponse[MedicationResponse],
    status_code=status.HTTP_201_CREATED,
)
async def create_medication(
    patient_id: UUID,
    data: MedicationCreate,
    ctx: Annotated[ClinicContext, Depends(get_clinic_context)],
    _: Annotated[None, Depends(require_permission("patients_clinical.medical.write"))],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> ApiResponse[MedicationResponse]:
    await _ensure_patient(db, ctx, patient_id)
    med = await PatientsClinicalService.create_medication(
        db, ctx.clinic_id, patient_id, data.model_dump()
    )
    await db.commit()
    await db.refresh(med)
    return ApiResponse(data=MedicationResponse.model_validate(med))


@router.put(
    "/patients/{patient_id}/medications/{medication_id}",
    response_model=ApiResponse[MedicationResponse],
)
async def update_medication(
    patient_id: UUID,
    medication_id: UUID,
    data: MedicationUpdate,
    ctx: Annotated[ClinicContext, Depends(get_clinic_context)],
    _: Annotated[None, Depends(require_permission("patients_clinical.medical.write"))],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> ApiResponse[MedicationResponse]:
    await _ensure_patient(db, ctx, patient_id)
    med = await PatientsClinicalService.get_medication(db, medication_id)
    if med is None or med.patient_id != patient_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Medication not found")
    med = await PatientsClinicalService.update_medication(
        db, med, data.model_dump(exclude_unset=True)
    )
    await db.commit()
    await db.refresh(med)
    return ApiResponse(data=MedicationResponse.model_validate(med))


@router.delete(
    "/patients/{patient_id}/medications/{medication_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def delete_medication(
    patient_id: UUID,
    medication_id: UUID,
    ctx: Annotated[ClinicContext, Depends(get_clinic_context)],
    _: Annotated[None, Depends(require_permission("patients_clinical.medical.write"))],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> None:
    await _ensure_patient(db, ctx, patient_id)
    med = await PatientsClinicalService.get_medication(db, medication_id)
    if med is None or med.patient_id != patient_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Medication not found")
    await PatientsClinicalService.delete_medication(db, med)
    await db.commit()


# --- Systemic diseases -------------------------------------------------


@router.get(
    "/patients/{patient_id}/systemic-diseases",
    response_model=ApiResponse[list[SystemicDiseaseResponse]],
)
async def list_systemic_diseases(
    patient_id: UUID,
    ctx: Annotated[ClinicContext, Depends(get_clinic_context)],
    _: Annotated[None, Depends(require_permission("patients_clinical.medical.read"))],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> ApiResponse[list[SystemicDiseaseResponse]]:
    await _ensure_patient(db, ctx, patient_id)
    rows = await PatientsClinicalService.list_systemic_diseases(db, patient_id)
    return ApiResponse(data=[SystemicDiseaseResponse.model_validate(r) for r in rows])


@router.post(
    "/patients/{patient_id}/systemic-diseases",
    response_model=ApiResponse[SystemicDiseaseResponse],
    status_code=status.HTTP_201_CREATED,
)
async def create_systemic_disease(
    patient_id: UUID,
    data: SystemicDiseaseCreate,
    ctx: Annotated[ClinicContext, Depends(get_clinic_context)],
    _: Annotated[None, Depends(require_permission("patients_clinical.medical.write"))],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> ApiResponse[SystemicDiseaseResponse]:
    await _ensure_patient(db, ctx, patient_id)
    disease = await PatientsClinicalService.create_systemic_disease(
        db, ctx.clinic_id, patient_id, data.model_dump()
    )
    await db.commit()
    await db.refresh(disease)
    return ApiResponse(data=SystemicDiseaseResponse.model_validate(disease))


@router.put(
    "/patients/{patient_id}/systemic-diseases/{disease_id}",
    response_model=ApiResponse[SystemicDiseaseResponse],
)
async def update_systemic_disease(
    patient_id: UUID,
    disease_id: UUID,
    data: SystemicDiseaseUpdate,
    ctx: Annotated[ClinicContext, Depends(get_clinic_context)],
    _: Annotated[None, Depends(require_permission("patients_clinical.medical.write"))],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> ApiResponse[SystemicDiseaseResponse]:
    await _ensure_patient(db, ctx, patient_id)
    disease = await PatientsClinicalService.get_systemic_disease(db, disease_id)
    if disease is None or disease.patient_id != patient_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Disease not found")
    disease = await PatientsClinicalService.update_systemic_disease(
        db, disease, data.model_dump(exclude_unset=True)
    )
    await db.commit()
    await db.refresh(disease)
    return ApiResponse(data=SystemicDiseaseResponse.model_validate(disease))


@router.delete(
    "/patients/{patient_id}/systemic-diseases/{disease_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def delete_systemic_disease(
    patient_id: UUID,
    disease_id: UUID,
    ctx: Annotated[ClinicContext, Depends(get_clinic_context)],
    _: Annotated[None, Depends(require_permission("patients_clinical.medical.write"))],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> None:
    await _ensure_patient(db, ctx, patient_id)
    disease = await PatientsClinicalService.get_systemic_disease(db, disease_id)
    if disease is None or disease.patient_id != patient_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Disease not found")
    await PatientsClinicalService.delete_systemic_disease(db, disease)
    await db.commit()


# --- Surgical history --------------------------------------------------


@router.get(
    "/patients/{patient_id}/surgical-history",
    response_model=ApiResponse[list[SurgicalHistoryResponse]],
)
async def list_surgical_history(
    patient_id: UUID,
    ctx: Annotated[ClinicContext, Depends(get_clinic_context)],
    _: Annotated[None, Depends(require_permission("patients_clinical.medical.read"))],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> ApiResponse[list[SurgicalHistoryResponse]]:
    await _ensure_patient(db, ctx, patient_id)
    rows = await PatientsClinicalService.list_surgical_history(db, patient_id)
    return ApiResponse(data=[SurgicalHistoryResponse.model_validate(r) for r in rows])


@router.post(
    "/patients/{patient_id}/surgical-history",
    response_model=ApiResponse[SurgicalHistoryResponse],
    status_code=status.HTTP_201_CREATED,
)
async def create_surgical_history(
    patient_id: UUID,
    data: SurgicalHistoryCreate,
    ctx: Annotated[ClinicContext, Depends(get_clinic_context)],
    _: Annotated[None, Depends(require_permission("patients_clinical.medical.write"))],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> ApiResponse[SurgicalHistoryResponse]:
    await _ensure_patient(db, ctx, patient_id)
    surgery = await PatientsClinicalService.create_surgical_history(
        db, ctx.clinic_id, patient_id, data.model_dump()
    )
    await db.commit()
    await db.refresh(surgery)
    return ApiResponse(data=SurgicalHistoryResponse.model_validate(surgery))


@router.put(
    "/patients/{patient_id}/surgical-history/{surgery_id}",
    response_model=ApiResponse[SurgicalHistoryResponse],
)
async def update_surgical_history(
    patient_id: UUID,
    surgery_id: UUID,
    data: SurgicalHistoryUpdate,
    ctx: Annotated[ClinicContext, Depends(get_clinic_context)],
    _: Annotated[None, Depends(require_permission("patients_clinical.medical.write"))],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> ApiResponse[SurgicalHistoryResponse]:
    await _ensure_patient(db, ctx, patient_id)
    surgery = await PatientsClinicalService.get_surgical_history(db, surgery_id)
    if surgery is None or surgery.patient_id != patient_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Surgery not found")
    surgery = await PatientsClinicalService.update_surgical_history(
        db, surgery, data.model_dump(exclude_unset=True)
    )
    await db.commit()
    await db.refresh(surgery)
    return ApiResponse(data=SurgicalHistoryResponse.model_validate(surgery))


@router.delete(
    "/patients/{patient_id}/surgical-history/{surgery_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def delete_surgical_history(
    patient_id: UUID,
    surgery_id: UUID,
    ctx: Annotated[ClinicContext, Depends(get_clinic_context)],
    _: Annotated[None, Depends(require_permission("patients_clinical.medical.write"))],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> None:
    await _ensure_patient(db, ctx, patient_id)
    surgery = await PatientsClinicalService.get_surgical_history(db, surgery_id)
    if surgery is None or surgery.patient_id != patient_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Surgery not found")
    await PatientsClinicalService.delete_surgical_history(db, surgery)
    await db.commit()


# --- Emergency contact (1:1) -------------------------------------------


@router.get(
    "/patients/{patient_id}/emergency-contact",
    response_model=ApiResponse[EmergencyContactResponse | None],
)
async def get_emergency_contact(
    patient_id: UUID,
    ctx: Annotated[ClinicContext, Depends(get_clinic_context)],
    _: Annotated[None, Depends(require_permission("patients_clinical.emergency.read"))],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> ApiResponse[EmergencyContactResponse | None]:
    await _ensure_patient(db, ctx, patient_id)
    contact = await PatientsClinicalService.get_emergency_contact(db, patient_id)
    if contact is None:
        return ApiResponse(data=None)
    return ApiResponse(data=EmergencyContactResponse.model_validate(contact))


@router.put(
    "/patients/{patient_id}/emergency-contact",
    response_model=ApiResponse[EmergencyContactResponse],
)
async def upsert_emergency_contact(
    patient_id: UUID,
    data: EmergencyContactUpsert,
    ctx: Annotated[ClinicContext, Depends(get_clinic_context)],
    _: Annotated[None, Depends(require_permission("patients_clinical.emergency.write"))],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> ApiResponse[EmergencyContactResponse]:
    await _ensure_patient(db, ctx, patient_id)
    contact = await PatientsClinicalService.upsert_emergency_contact(
        db, ctx.clinic_id, patient_id, data.model_dump()
    )
    await db.commit()
    await db.refresh(contact)
    return ApiResponse(data=EmergencyContactResponse.model_validate(contact))


@router.delete(
    "/patients/{patient_id}/emergency-contact",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def delete_emergency_contact(
    patient_id: UUID,
    ctx: Annotated[ClinicContext, Depends(get_clinic_context)],
    _: Annotated[None, Depends(require_permission("patients_clinical.emergency.write"))],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> None:
    await _ensure_patient(db, ctx, patient_id)
    contact = await PatientsClinicalService.get_emergency_contact(db, patient_id)
    if contact is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Emergency contact not found"
        )
    await PatientsClinicalService.delete_emergency_contact(db, contact)
    await db.commit()


# --- Legal guardian (1:1) ----------------------------------------------


@router.get(
    "/patients/{patient_id}/legal-guardian",
    response_model=ApiResponse[LegalGuardianResponse | None],
)
async def get_legal_guardian(
    patient_id: UUID,
    ctx: Annotated[ClinicContext, Depends(get_clinic_context)],
    _: Annotated[None, Depends(require_permission("patients_clinical.emergency.read"))],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> ApiResponse[LegalGuardianResponse | None]:
    await _ensure_patient(db, ctx, patient_id)
    guardian = await PatientsClinicalService.get_legal_guardian(db, patient_id)
    if guardian is None:
        return ApiResponse(data=None)
    return ApiResponse(data=LegalGuardianResponse.model_validate(guardian))


@router.put(
    "/patients/{patient_id}/legal-guardian",
    response_model=ApiResponse[LegalGuardianResponse],
)
async def upsert_legal_guardian(
    patient_id: UUID,
    data: LegalGuardianUpsert,
    ctx: Annotated[ClinicContext, Depends(get_clinic_context)],
    _: Annotated[None, Depends(require_permission("patients_clinical.emergency.write"))],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> ApiResponse[LegalGuardianResponse]:
    await _ensure_patient(db, ctx, patient_id)
    guardian = await PatientsClinicalService.upsert_legal_guardian(
        db, ctx.clinic_id, patient_id, data.model_dump()
    )
    await db.commit()
    await db.refresh(guardian)
    return ApiResponse(data=LegalGuardianResponse.model_validate(guardian))


@router.delete(
    "/patients/{patient_id}/legal-guardian",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def delete_legal_guardian(
    patient_id: UUID,
    ctx: Annotated[ClinicContext, Depends(get_clinic_context)],
    _: Annotated[None, Depends(require_permission("patients_clinical.emergency.write"))],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> None:
    await _ensure_patient(db, ctx, patient_id)
    guardian = await PatientsClinicalService.get_legal_guardian(db, patient_id)
    if guardian is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Legal guardian not found"
        )
    await PatientsClinicalService.delete_legal_guardian(db, guardian)
    await db.commit()


# --- Aggregated medical history + alerts -------------------------------


@router.get(
    "/patients/{patient_id}/medical-history",
    response_model=ApiResponse[MedicalHistoryResponse],
)
async def get_medical_history(
    patient_id: UUID,
    ctx: Annotated[ClinicContext, Depends(get_clinic_context)],
    _: Annotated[None, Depends(require_permission("patients_clinical.medical.read"))],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> ApiResponse[MedicalHistoryResponse]:
    await _ensure_patient(db, ctx, patient_id)
    data = await PatientsClinicalService.build_medical_history(db, patient_id)
    return ApiResponse(data=MedicalHistoryResponse.model_validate(data))


@router.put(
    "/patients/{patient_id}/medical-history",
    response_model=ApiResponse[MedicalHistoryResponse],
)
async def replace_medical_history(
    patient_id: UUID,
    data: MedicalHistoryUpdate,
    ctx: Annotated[ClinicContext, Depends(get_clinic_context)],
    _: Annotated[None, Depends(require_permission("patients_clinical.medical.write"))],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> ApiResponse[MedicalHistoryResponse]:
    await _ensure_patient(db, ctx, patient_id)
    await PatientsClinicalService.replace_medical_history(
        db,
        ctx.clinic_id,
        patient_id,
        data.model_dump(),
        ctx.user_id,
    )
    await db.commit()
    await event_bus.publish(
        EventType.PATIENT_MEDICAL_UPDATED,
        {
            "patient_id": str(patient_id),
            "clinic_id": str(ctx.clinic_id),
            "user_id": str(ctx.user_id),
            "section": "history",
            "summary": "Historial médico actualizado",
        },
    )
    refreshed = await PatientsClinicalService.build_medical_history(db, patient_id)
    return ApiResponse(data=MedicalHistoryResponse.model_validate(refreshed))


@router.get(
    "/patients/{patient_id}/alerts",
    response_model=ApiResponse[PatientAlertsResponse],
)
async def get_patient_alerts(
    patient_id: UUID,
    ctx: Annotated[ClinicContext, Depends(get_clinic_context)],
    _: Annotated[None, Depends(require_permission("patients_clinical.medical.read"))],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> ApiResponse[PatientAlertsResponse]:
    await _ensure_patient(db, ctx, patient_id)
    alerts = await PatientsClinicalService.compute_alerts(db, patient_id)
    return ApiResponse(data=PatientAlertsResponse(alerts=alerts))


# --- Specialty anamneses -------------------------------------------------


async def _ensure_professional(
    db: AsyncSession, ctx: ClinicContext, professional_id: UUID | None
) -> None:
    if not await PatientsClinicalService.validate_professional(db, ctx.clinic_id, professional_id):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Professional must be an active professional in this clinic",
        )


@router.get(
    "/patients/{patient_id}/dental-anamnesis",
    response_model=ApiResponse[DentalAnamnesisResponse | None],
)
async def get_dental_anamnesis(
    patient_id: UUID,
    ctx: Annotated[ClinicContext, Depends(get_clinic_context)],
    _: Annotated[None, Depends(require_permission("patients_clinical.medical.read"))],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> ApiResponse[DentalAnamnesisResponse | None]:
    await _ensure_patient(db, ctx, patient_id)
    record = await PatientsClinicalService.get_dental_anamnesis(db, ctx.clinic_id, patient_id)
    return ApiResponse(
        data=DentalAnamnesisResponse.model_validate(record) if record is not None else None
    )


@router.put(
    "/patients/{patient_id}/dental-anamnesis",
    response_model=ApiResponse[DentalAnamnesisResponse],
)
async def upsert_dental_anamnesis(
    patient_id: UUID,
    data: DentalAnamnesisInput,
    ctx: Annotated[ClinicContext, Depends(get_clinic_context)],
    _: Annotated[None, Depends(require_permission("patients_clinical.medical.write"))],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> ApiResponse[DentalAnamnesisResponse]:
    await _ensure_patient(db, ctx, patient_id)
    await _ensure_professional(db, ctx, data.professional_id)
    record = await PatientsClinicalService.upsert_dental_anamnesis(
        db, ctx.clinic_id, patient_id, data.model_dump(), ctx.user_id
    )
    await db.commit()
    await db.refresh(record)
    return ApiResponse(data=DentalAnamnesisResponse.model_validate(record))


@router.get(
    "/patients/{patient_id}/pediatric-dental-anamnesis",
    response_model=ApiResponse[PediatricDentalAnamnesisResponse | None],
)
async def get_pediatric_dental_anamnesis(
    patient_id: UUID,
    ctx: Annotated[ClinicContext, Depends(get_clinic_context)],
    _: Annotated[None, Depends(require_permission("patients_clinical.medical.read"))],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> ApiResponse[PediatricDentalAnamnesisResponse | None]:
    await _ensure_patient(db, ctx, patient_id)
    record = await PatientsClinicalService.get_pediatric_dental_anamnesis(
        db, ctx.clinic_id, patient_id
    )
    return ApiResponse(
        data=PediatricDentalAnamnesisResponse.model_validate(record)
        if record is not None
        else None
    )


@router.put(
    "/patients/{patient_id}/pediatric-dental-anamnesis",
    response_model=ApiResponse[PediatricDentalAnamnesisResponse],
)
async def upsert_pediatric_dental_anamnesis(
    patient_id: UUID,
    data: PediatricDentalAnamnesisInput,
    ctx: Annotated[ClinicContext, Depends(get_clinic_context)],
    _: Annotated[None, Depends(require_permission("patients_clinical.medical.write"))],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> ApiResponse[PediatricDentalAnamnesisResponse]:
    await _ensure_patient(db, ctx, patient_id)
    await _ensure_professional(db, ctx, data.professional_id)
    record = await PatientsClinicalService.upsert_pediatric_dental_anamnesis(
        db, ctx.clinic_id, patient_id, data.model_dump(), ctx.user_id
    )
    await db.commit()
    await db.refresh(record)
    return ApiResponse(data=PediatricDentalAnamnesisResponse.model_validate(record))


# --- Endodontic records -------------------------------------------------


@router.get(
    "/patients/{patient_id}/endodontic-records",
    response_model=ApiResponse[list[EndodonticRecordResponse]],
)
async def list_endodontic_records(
    patient_id: UUID,
    ctx: Annotated[ClinicContext, Depends(get_clinic_context)],
    _: Annotated[None, Depends(require_permission("patients_clinical.medical.read"))],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> ApiResponse[list[EndodonticRecordResponse]]:
    await _ensure_patient(db, ctx, patient_id)
    records = await PatientsClinicalService.list_endodontic_records(db, ctx.clinic_id, patient_id)
    return ApiResponse(data=[EndodonticRecordResponse.model_validate(record) for record in records])


@router.post(
    "/patients/{patient_id}/endodontic-records",
    response_model=ApiResponse[EndodonticRecordResponse],
    status_code=status.HTTP_201_CREATED,
)
async def create_endodontic_record(
    patient_id: UUID,
    data: EndodonticRecordCreate,
    ctx: Annotated[ClinicContext, Depends(get_clinic_context)],
    _: Annotated[None, Depends(require_permission("patients_clinical.medical.write"))],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> ApiResponse[EndodonticRecordResponse]:
    await _ensure_patient(db, ctx, patient_id)
    await _ensure_professional(db, ctx, data.professional_id)
    record = await PatientsClinicalService.create_endodontic_record(
        db, ctx.clinic_id, patient_id, data.model_dump()
    )
    await db.commit()
    record = await PatientsClinicalService.get_endodontic_record(
        db, ctx.clinic_id, patient_id, record.id
    )
    assert record is not None
    return ApiResponse(data=EndodonticRecordResponse.model_validate(record))


@router.get(
    "/patients/{patient_id}/endodontic-records/{record_id}",
    response_model=ApiResponse[EndodonticRecordResponse],
)
async def get_endodontic_record(
    patient_id: UUID,
    record_id: UUID,
    ctx: Annotated[ClinicContext, Depends(get_clinic_context)],
    _: Annotated[None, Depends(require_permission("patients_clinical.medical.read"))],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> ApiResponse[EndodonticRecordResponse]:
    await _ensure_patient(db, ctx, patient_id)
    record = await PatientsClinicalService.get_endodontic_record(
        db, ctx.clinic_id, patient_id, record_id
    )
    if record is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Endodontic record not found")
    return ApiResponse(data=EndodonticRecordResponse.model_validate(record))


@router.put(
    "/patients/{patient_id}/endodontic-records/{record_id}",
    response_model=ApiResponse[EndodonticRecordResponse],
)
async def update_endodontic_record(
    patient_id: UUID,
    record_id: UUID,
    data: EndodonticRecordUpdate,
    ctx: Annotated[ClinicContext, Depends(get_clinic_context)],
    _: Annotated[None, Depends(require_permission("patients_clinical.medical.write"))],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> ApiResponse[EndodonticRecordResponse]:
    await _ensure_patient(db, ctx, patient_id)
    record = await PatientsClinicalService.get_endodontic_record(
        db, ctx.clinic_id, patient_id, record_id
    )
    if record is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Endodontic record not found")
    payload = data.model_dump(exclude_unset=True)
    if "professional_id" in payload:
        await _ensure_professional(db, ctx, payload["professional_id"])
    await PatientsClinicalService.update_endodontic_record(db, record, payload)
    await db.commit()
    refreshed = await PatientsClinicalService.get_endodontic_record(
        db, ctx.clinic_id, patient_id, record_id
    )
    assert refreshed is not None
    return ApiResponse(data=EndodonticRecordResponse.model_validate(refreshed))
