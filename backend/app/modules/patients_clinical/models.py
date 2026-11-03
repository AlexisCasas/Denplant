"""Normalized medical history + emergency contact models.

Replaces the JSONB blobs (``patients.medical_history``,
``patients.emergency_contact``, ``patients.legal_guardian``) that
lived directly on the patient row before Fase B.4.

Table names are prefixed ``patients_clinical_`` so analytics queries
stay unambiguous across modules.
"""

from __future__ import annotations

from datetime import date, datetime
from typing import TYPE_CHECKING
from uuid import uuid4

from sqlalchemy import (
    Boolean,
    Date,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import ARRAY, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base, TimestampMixin

if TYPE_CHECKING:
    from app.modules.patients.models import Patient


class MedicalContext(Base, TimestampMixin):
    """1:1 medical flags + anesthesia + lifestyle context for a patient."""

    __tablename__ = "patients_clinical_medical_context"

    patient_id: Mapped[UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("patients.id", ondelete="CASCADE"),
        primary_key=True,
    )
    clinic_id: Mapped[UUID] = mapped_column(ForeignKey("clinics.id"), index=True)

    is_pregnant: Mapped[bool] = mapped_column(Boolean, default=False)
    pregnancy_week: Mapped[int | None] = mapped_column(Integer)
    is_lactating: Mapped[bool] = mapped_column(Boolean, default=False)

    is_on_anticoagulants: Mapped[bool] = mapped_column(Boolean, default=False)
    anticoagulant_medication: Mapped[str | None] = mapped_column(String(100))
    inr_value: Mapped[float | None] = mapped_column(Float)
    last_inr_date: Mapped[date | None] = mapped_column(Date)

    is_smoker: Mapped[bool] = mapped_column(Boolean, default=False)
    smoking_frequency: Mapped[str | None] = mapped_column(String(100))
    alcohol_consumption: Mapped[str | None] = mapped_column(String(100))

    bruxism: Mapped[bool] = mapped_column(Boolean, default=False)

    adverse_reactions_to_anesthesia: Mapped[bool] = mapped_column(Boolean, default=False)
    anesthesia_reaction_details: Mapped[str | None] = mapped_column(String(500))

    last_updated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_updated_by: Mapped[UUID | None] = mapped_column(UUID(as_uuid=True))

    patient: Mapped[Patient] = relationship()


class Allergy(Base, TimestampMixin):
    """Individual allergy entry (N:1 patient)."""

    __tablename__ = "patients_clinical_allergy"

    id: Mapped[UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    patient_id: Mapped[UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("patients.id", ondelete="CASCADE"),
        index=True,
    )
    clinic_id: Mapped[UUID] = mapped_column(ForeignKey("clinics.id"), index=True)

    name: Mapped[str] = mapped_column(String(100))
    type: Mapped[str | None] = mapped_column(String(50))
    # severity: low | medium | high | critical
    severity: Mapped[str] = mapped_column(String(20), default="medium", index=True)
    reaction: Mapped[str | None] = mapped_column(String(500))
    notes: Mapped[str | None] = mapped_column(Text)


class Medication(Base, TimestampMixin):
    """Medication the patient is currently taking (N:1)."""

    __tablename__ = "patients_clinical_medication"

    id: Mapped[UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    patient_id: Mapped[UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("patients.id", ondelete="CASCADE"),
        index=True,
    )
    clinic_id: Mapped[UUID] = mapped_column(ForeignKey("clinics.id"), index=True)

    name: Mapped[str] = mapped_column(String(100))
    dosage: Mapped[str | None] = mapped_column(String(100))
    frequency: Mapped[str | None] = mapped_column(String(100))
    start_date: Mapped[date | None] = mapped_column(Date)
    notes: Mapped[str | None] = mapped_column(Text)


class SystemicDisease(Base, TimestampMixin):
    """Systemic disease / condition (N:1)."""

    __tablename__ = "patients_clinical_systemic_disease"

    id: Mapped[UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    patient_id: Mapped[UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("patients.id", ondelete="CASCADE"),
        index=True,
    )
    clinic_id: Mapped[UUID] = mapped_column(ForeignKey("clinics.id"), index=True)

    name: Mapped[str] = mapped_column(String(100))
    type: Mapped[str | None] = mapped_column(String(50))
    diagnosis_date: Mapped[date | None] = mapped_column(Date)
    is_controlled: Mapped[bool] = mapped_column(Boolean, default=True)
    is_critical: Mapped[bool] = mapped_column(Boolean, default=False, index=True)
    medications: Mapped[str | None] = mapped_column(Text)
    notes: Mapped[str | None] = mapped_column(Text)


class SurgicalHistory(Base, TimestampMixin):
    """Past surgery / procedure (N:1)."""

    __tablename__ = "patients_clinical_surgical_history"

    id: Mapped[UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    patient_id: Mapped[UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("patients.id", ondelete="CASCADE"),
        index=True,
    )
    clinic_id: Mapped[UUID] = mapped_column(ForeignKey("clinics.id"), index=True)

    procedure: Mapped[str] = mapped_column(String(200))
    surgery_date: Mapped[date | None] = mapped_column(Date)
    complications: Mapped[str | None] = mapped_column(Text)
    notes: Mapped[str | None] = mapped_column(Text)


class EmergencyContact(Base, TimestampMixin):
    """Emergency contact (1:1)."""

    __tablename__ = "patients_clinical_emergency_contact"

    patient_id: Mapped[UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("patients.id", ondelete="CASCADE"),
        primary_key=True,
    )
    clinic_id: Mapped[UUID] = mapped_column(ForeignKey("clinics.id"), index=True)

    name: Mapped[str] = mapped_column(String(100))
    relationship: Mapped[str | None] = mapped_column(String(50))
    phone: Mapped[str] = mapped_column(String(20))
    email: Mapped[str | None] = mapped_column(String(255))
    is_legal_guardian: Mapped[bool] = mapped_column(Boolean, default=False)


class LegalGuardian(Base, TimestampMixin):
    """Legal guardian (1:1, for minors or incapacitated patients)."""

    __tablename__ = "patients_clinical_legal_guardian"

    patient_id: Mapped[UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("patients.id", ondelete="CASCADE"),
        primary_key=True,
    )
    clinic_id: Mapped[UUID] = mapped_column(ForeignKey("clinics.id"), index=True)

    name: Mapped[str] = mapped_column(String(100))
    relationship: Mapped[str] = mapped_column(String(50))
    dni: Mapped[str | None] = mapped_column(String(20))
    phone: Mapped[str] = mapped_column(String(20))
    email: Mapped[str | None] = mapped_column(String(255))
    address: Mapped[str | None] = mapped_column(String(200))
    notes: Mapped[str | None] = mapped_column(Text)


# --- Specialty anamneses -------------------------------------------------


class DentalAnamnesis(Base, TimestampMixin):
    """Current adult dental anamnesis (one record per patient)."""

    __tablename__ = "patients_clinical_dental_anamnesis"

    patient_id: Mapped[UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("patients.id", ondelete="CASCADE"), primary_key=True
    )
    clinic_id: Mapped[UUID] = mapped_column(ForeignKey("clinics.id"), index=True)
    professional_id: Mapped[UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"))
    last_updated_by: Mapped[UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"))

    consultation_reason: Mapped[str | None] = mapped_column(Text)
    illness_duration: Mapped[str | None] = mapped_column(String(200))
    main_symptoms: Mapped[str | None] = mapped_column(Text)
    chronological_narrative: Mapped[str | None] = mapped_column(Text)
    biological_functions: Mapped[str | None] = mapped_column(Text)
    family_history: Mapped[str | None] = mapped_column(Text)
    personal_history: Mapped[str | None] = mapped_column(Text)
    high_blood_pressure: Mapped[bool | None] = mapped_column(Boolean)
    low_blood_pressure: Mapped[bool | None] = mapped_column(Boolean)
    hepatitis: Mapped[bool | None] = mapped_column(Boolean)
    gastritis: Mapped[bool | None] = mapped_column(Boolean)
    ulcers: Mapped[bool | None] = mapped_column(Boolean)
    hiv: Mapped[bool | None] = mapped_column(Boolean)
    diabetes: Mapped[bool | None] = mapped_column(Boolean)
    asthma: Mapped[bool | None] = mapped_column(Boolean)
    smoker: Mapped[bool | None] = mapped_column(Boolean)
    additional_comment: Mapped[str | None] = mapped_column(Text)
    blood_diseases: Mapped[bool | None] = mapped_column(Boolean)
    blood_diseases_detail: Mapped[str | None] = mapped_column(Text)
    heart_problems: Mapped[bool | None] = mapped_column(Boolean)
    heart_problems_detail: Mapped[str | None] = mapped_column(Text)
    other_disease: Mapped[bool | None] = mapped_column(Boolean)
    other_disease_detail: Mapped[str | None] = mapped_column(Text)
    brushing_frequency: Mapped[str | None] = mapped_column(String(100))
    bleeding_gums: Mapped[bool | None] = mapped_column(Boolean)
    abnormal_extraction_bleeding: Mapped[bool | None] = mapped_column(Boolean)
    abnormal_extraction_bleeding_detail: Mapped[str | None] = mapped_column(Text)
    bruxism: Mapped[bool | None] = mapped_column(Boolean)
    mouth_discomfort: Mapped[str | None] = mapped_column(Text)
    allergies: Mapped[bool | None] = mapped_column(Boolean)
    allergies_detail: Mapped[str | None] = mapped_column(Text)
    recent_major_surgery: Mapped[bool | None] = mapped_column(Boolean)
    recent_major_surgery_detail: Mapped[str | None] = mapped_column(Text)
    permanent_medication: Mapped[bool | None] = mapped_column(Boolean)
    permanent_medication_detail: Mapped[str | None] = mapped_column(Text)
    blood_pressure: Mapped[str | None] = mapped_column(String(30))
    pulse: Mapped[int | None] = mapped_column(Integer)
    heart_rate: Mapped[int | None] = mapped_column(Integer)
    respiratory_rate: Mapped[int | None] = mapped_column(Integer)
    temperature_c: Mapped[float | None] = mapped_column(Float)
    extraoral_exam: Mapped[str | None] = mapped_column(Text)
    intraoral_exam: Mapped[str | None] = mapped_column(Text)
    auxiliary_exam_results: Mapped[str | None] = mapped_column(Text)
    observations: Mapped[str | None] = mapped_column(Text)


class PediatricDentalAnamnesis(Base, TimestampMixin):
    """Current pediatric dental anamnesis (one record per patient)."""

    __tablename__ = "patients_clinical_pediatric_dental_anamnesis"

    patient_id: Mapped[UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("patients.id", ondelete="CASCADE"), primary_key=True
    )
    clinic_id: Mapped[UUID] = mapped_column(ForeignKey("clinics.id"), index=True)
    professional_id: Mapped[UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"))
    last_updated_by: Mapped[UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"))

    consultation_reason: Mapped[str | None] = mapped_column(Text)
    mother_name: Mapped[str | None] = mapped_column(String(200))
    father_name: Mapped[str | None] = mapped_column(String(200))
    siblings_count: Mapped[int | None] = mapped_column(Integer)
    birth_order: Mapped[int | None] = mapped_column(Integer)
    disease_type: Mapped[str | None] = mapped_column(Text)
    chronological_narrative: Mapped[str | None] = mapped_column(Text)
    maternal_diseases: Mapped[str | None] = mapped_column(Text)
    pregnancy_complications: Mapped[bool | None] = mapped_column(Boolean)
    premature_baby: Mapped[bool | None] = mapped_column(Boolean)
    birth_weight_kg: Mapped[float | None] = mapped_column(Float)
    prenatal_comment: Mapped[str | None] = mapped_column(Text)
    birth_problems: Mapped[bool | None] = mapped_column(Boolean)
    birth_problems_detail: Mapped[str | None] = mapped_column(Text)
    pacifier_use: Mapped[bool | None] = mapped_column(Boolean)
    pacifier_use_detail: Mapped[str | None] = mapped_column(Text)
    bottle_use: Mapped[bool | None] = mapped_column(Boolean)
    bottle_use_detail: Mapped[str | None] = mapped_column(Text)
    thumb_sucking: Mapped[bool | None] = mapped_column(Boolean)
    thumb_sucking_detail: Mapped[str | None] = mapped_column(Text)
    medication_or_therapy: Mapped[bool | None] = mapped_column(Boolean)
    medication_or_therapy_detail: Mapped[str | None] = mapped_column(Text)
    allergies_or_intolerances: Mapped[bool | None] = mapped_column(Boolean)
    allergies_or_intolerances_detail: Mapped[str | None] = mapped_column(Text)
    brushes_before_sleep: Mapped[bool | None] = mapped_column(Boolean)
    brushes_before_sleep_detail: Mapped[str | None] = mapped_column(Text)
    open_mouth_or_snores: Mapped[bool | None] = mapped_column(Boolean)
    open_mouth_or_snores_detail: Mapped[str | None] = mapped_column(Text)
    postnatal_additional_comment: Mapped[str | None] = mapped_column(Text)
    sweets_times_per_day: Mapped[int | None] = mapped_column(Integer)
    sweets_days_per_week: Mapped[int | None] = mapped_column(Integer)
    milk_type: Mapped[str | None] = mapped_column(String(200))
    dental_hygiene: Mapped[str | None] = mapped_column(Text)
    daily_diet: Mapped[str | None] = mapped_column(Text)
    parenting_style: Mapped[str | None] = mapped_column(Text)
    oral_habits: Mapped[str | None] = mapped_column(Text)
    brushing_technique: Mapped[str | None] = mapped_column(Text)
    clinical_exam: Mapped[str | None] = mapped_column(Text)
    observations: Mapped[str | None] = mapped_column(Text)


class EndodonticRecord(Base, TimestampMixin):
    """A dated endodontic clinical record; patients can have many."""

    __tablename__ = "patients_clinical_endodontic_record"

    id: Mapped[UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    clinic_id: Mapped[UUID] = mapped_column(ForeignKey("clinics.id"), nullable=False)
    patient_id: Mapped[UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("patients.id", ondelete="CASCADE"), nullable=False
    )
    professional_id: Mapped[UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"))
    tooth_number: Mapped[int] = mapped_column(Integer, nullable=False)
    prior_endodontic_treatment: Mapped[str | None] = mapped_column(Text)
    pain_history: Mapped[str | None] = mapped_column(Text)
    initial_note: Mapped[str | None] = mapped_column(Text)
    anatomical_crown: Mapped[list[str]] = mapped_column(ARRAY(String), default=list)
    inflammation: Mapped[bool | None] = mapped_column(Boolean)
    inflammation_detail: Mapped[str | None] = mapped_column(Text)
    fistulas: Mapped[bool | None] = mapped_column(Boolean)
    fistulas_detail: Mapped[str | None] = mapped_column(Text)
    gingivitis: Mapped[bool | None] = mapped_column(Boolean)
    gingivitis_detail: Mapped[str | None] = mapped_column(Text)
    pockets: Mapped[bool | None] = mapped_column(Boolean)
    pockets_detail: Mapped[str | None] = mapped_column(Text)
    calculus: Mapped[bool | None] = mapped_column(Boolean)
    pain_characteristics: Mapped[list[str]] = mapped_column(ARRAY(String), default=list)
    percussion_pain: Mapped[list[str]] = mapped_column(ARRAY(String), default=list)
    palpation_pain: Mapped[list[str]] = mapped_column(ARRAY(String), default=list)
    clinical_exam_note: Mapped[str | None] = mapped_column(Text)
    heat_response: Mapped[bool | None] = mapped_column(Boolean)
    heat_duration: Mapped[str | None] = mapped_column(String(100))
    heat_intensity: Mapped[str | None] = mapped_column(String(100))
    cold_response: Mapped[bool | None] = mapped_column(Boolean)
    cold_duration: Mapped[str | None] = mapped_column(String(100))
    cold_intensity: Mapped[str | None] = mapped_column(String(100))
    pulp_chamber: Mapped[list[str]] = mapped_column(ARRAY(String), default=list)
    canals_count: Mapped[list[str]] = mapped_column(ARRAY(String), default=list)
    canals_characteristics: Mapped[list[str]] = mapped_column(ARRAY(String), default=list)
    furcation_lesion: Mapped[bool | None] = mapped_column(Boolean)
    apical_lesion: Mapped[bool | None] = mapped_column(Boolean)
    lateral_lesion: Mapped[bool | None] = mapped_column(Boolean)
    endo_perio_lesion: Mapped[bool | None] = mapped_column(Boolean)
    dwarf_roots: Mapped[bool | None] = mapped_column(Boolean)
    root_fracture: Mapped[bool | None] = mapped_column(Boolean)
    root_fracture_detail: Mapped[str | None] = mapped_column(Text)
    calcification: Mapped[bool | None] = mapped_column(Boolean)
    calcification_detail: Mapped[str | None] = mapped_column(Text)
    periodontal_ligament: Mapped[bool | None] = mapped_column(Boolean)
    periodontal_ligament_detail: Mapped[str | None] = mapped_column(Text)
    resorption: Mapped[bool | None] = mapped_column(Boolean)
    resorption_detail: Mapped[str | None] = mapped_column(Text)
    radiographic_note: Mapped[str | None] = mapped_column(Text)
    presumptive_pulpal_diagnosis: Mapped[list[str]] = mapped_column(ARRAY(String), default=list)
    presumptive_pulpal_note: Mapped[str | None] = mapped_column(Text)
    periapical_diagnosis: Mapped[list[str]] = mapped_column(ARRAY(String), default=list)
    periapical_note: Mapped[str | None] = mapped_column(Text)
    definitive_diagnosis: Mapped[list[str]] = mapped_column(ARRAY(String), default=list)
    definitive_note: Mapped[str | None] = mapped_column(Text)
    indicated_treatment: Mapped[list[str]] = mapped_column(ARRAY(String), default=list)
    indicated_treatment_note: Mapped[str | None] = mapped_column(Text)
    clinical_data_note: Mapped[str | None] = mapped_column(Text)
    operative_accidents: Mapped[str | None] = mapped_column(Text)
    post_endodontic_restoration: Mapped[list[str]] = mapped_column(ARRAY(String), default=list)
    prognosis: Mapped[str | None] = mapped_column(String(20))
    final_note: Mapped[str | None] = mapped_column(Text)

    channels: Mapped[list[EndodonticRecordChannel]] = relationship(
        back_populates="record", cascade="all, delete-orphan"
    )

    __table_args__ = (
        Index("ix_pc_endo_clinic_patient_created", "clinic_id", "patient_id", "created_at"),
        Index("ix_pc_endo_clinic_patient_tooth", "clinic_id", "patient_id", "tooth_number"),
    )


class EndodonticRecordChannel(Base, TimestampMixin):
    """One clinically identified canal/channel within an endodontic record."""

    __tablename__ = "patients_clinical_endodontic_record_channel"

    id: Mapped[UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    endodontic_record_id: Mapped[UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("patients_clinical_endodontic_record.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    channel_code: Mapped[str] = mapped_column(String(30), nullable=False)
    conduct: Mapped[str | None] = mapped_column(Text)
    working_length_mm: Mapped[float | None] = mapped_column(Numeric(6, 2))
    reference_point: Mapped[str | None] = mapped_column(String(200))
    initial_file: Mapped[str | None] = mapped_column(String(100))
    final_apical_file: Mapped[str | None] = mapped_column(String(100))
    cement_type: Mapped[str | None] = mapped_column(String(200))
    master_gutta_percha_cone: Mapped[str | None] = mapped_column(String(100))

    record: Mapped[EndodonticRecord] = relationship(back_populates="channels")

    __table_args__ = (
        UniqueConstraint("endodontic_record_id", "channel_code", name="uq_pc_endo_channel_code"),
    )
