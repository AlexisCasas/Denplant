"""Pydantic schemas for the patients_clinical module."""

from datetime import date, datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator

# --- Medical context -----------------------------------------------------


class MedicalContextBase(BaseModel):
    is_pregnant: bool = False
    pregnancy_week: int | None = Field(default=None, ge=1, le=42)
    is_lactating: bool = False

    is_on_anticoagulants: bool = False
    anticoagulant_medication: str | None = Field(default=None, max_length=100)
    inr_value: float | None = Field(default=None, ge=0, le=20)
    last_inr_date: date | None = None

    is_smoker: bool = False
    smoking_frequency: str | None = Field(default=None, max_length=100)
    alcohol_consumption: str | None = Field(default=None, max_length=100)

    bruxism: bool = False

    adverse_reactions_to_anesthesia: bool = False
    anesthesia_reaction_details: str | None = Field(default=None, max_length=500)


class MedicalContextUpdate(MedicalContextBase):
    pass


class MedicalContextResponse(MedicalContextBase):
    last_updated_at: datetime | None = None
    last_updated_by: UUID | None = None

    model_config = ConfigDict(from_attributes=True)


# --- Allergy ------------------------------------------------------------


class AllergyCreate(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    type: str | None = Field(default=None, max_length=50)
    severity: str = Field(default="medium", max_length=20)
    reaction: str | None = Field(default=None, max_length=500)
    notes: str | None = None


class AllergyUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=100)
    type: str | None = Field(default=None, max_length=50)
    severity: str | None = Field(default=None, max_length=20)
    reaction: str | None = Field(default=None, max_length=500)
    notes: str | None = None


class AllergyResponse(AllergyCreate):
    id: UUID

    model_config = ConfigDict(from_attributes=True)


# --- Medication ---------------------------------------------------------


class MedicationCreate(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    dosage: str | None = Field(default=None, max_length=100)
    frequency: str | None = Field(default=None, max_length=100)
    start_date: date | None = None
    notes: str | None = None


class MedicationUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=100)
    dosage: str | None = Field(default=None, max_length=100)
    frequency: str | None = Field(default=None, max_length=100)
    start_date: date | None = None
    notes: str | None = None


class MedicationResponse(MedicationCreate):
    id: UUID

    model_config = ConfigDict(from_attributes=True)


# --- Systemic disease ---------------------------------------------------


class SystemicDiseaseCreate(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    type: str | None = Field(default=None, max_length=50)
    diagnosis_date: date | None = None
    is_controlled: bool = True
    is_critical: bool = False
    medications: str | None = None
    notes: str | None = None


class SystemicDiseaseUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=100)
    type: str | None = Field(default=None, max_length=50)
    diagnosis_date: date | None = None
    is_controlled: bool | None = None
    is_critical: bool | None = None
    medications: str | None = None
    notes: str | None = None


class SystemicDiseaseResponse(SystemicDiseaseCreate):
    id: UUID

    model_config = ConfigDict(from_attributes=True)


# --- Surgical history ---------------------------------------------------


class SurgicalHistoryCreate(BaseModel):
    procedure: str = Field(min_length=1, max_length=200)
    surgery_date: date | None = None
    complications: str | None = None
    notes: str | None = None


class SurgicalHistoryUpdate(BaseModel):
    procedure: str | None = Field(default=None, min_length=1, max_length=200)
    surgery_date: date | None = None
    complications: str | None = None
    notes: str | None = None


class SurgicalHistoryResponse(SurgicalHistoryCreate):
    id: UUID

    model_config = ConfigDict(from_attributes=True)


# --- Emergency contact --------------------------------------------------


class EmergencyContactBase(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    relationship: str | None = Field(default=None, max_length=50)
    phone: str = Field(min_length=1, max_length=20)
    email: EmailStr | None = None
    is_legal_guardian: bool = False


class EmergencyContactUpsert(EmergencyContactBase):
    pass


class EmergencyContactResponse(EmergencyContactBase):
    model_config = ConfigDict(from_attributes=True)


# --- Legal guardian -----------------------------------------------------


class LegalGuardianBase(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    relationship: str = Field(max_length=50)
    dni: str | None = Field(default=None, max_length=20)
    phone: str = Field(min_length=1, max_length=20)
    email: EmailStr | None = None
    address: str | None = Field(default=None, max_length=200)
    notes: str | None = None


class LegalGuardianUpsert(LegalGuardianBase):
    pass


class LegalGuardianResponse(LegalGuardianBase):
    model_config = ConfigDict(from_attributes=True)


# --- Aggregate medical history (legacy-shaped payload for the form) -----


class MedicalHistoryUpdate(BaseModel):
    """Bulk update payload mirroring the legacy JSONB shape.

    The frontend form submits the entire medical history in one go.
    Backend converts it into the normalized tables atomically.
    """

    allergies: list[AllergyCreate] = []
    medications: list[MedicationCreate] = []
    systemic_diseases: list[SystemicDiseaseCreate] = []
    surgical_history: list[SurgicalHistoryCreate] = []

    is_pregnant: bool = False
    pregnancy_week: int | None = Field(default=None, ge=1, le=42)
    is_lactating: bool = False

    is_on_anticoagulants: bool = False
    anticoagulant_medication: str | None = Field(default=None, max_length=100)
    inr_value: float | None = Field(default=None, ge=0, le=20)
    last_inr_date: date | None = None

    is_smoker: bool = False
    smoking_frequency: str | None = Field(default=None, max_length=100)
    alcohol_consumption: str | None = Field(default=None, max_length=100)

    bruxism: bool = False

    adverse_reactions_to_anesthesia: bool = False
    anesthesia_reaction_details: str | None = Field(default=None, max_length=500)


class MedicalHistoryResponse(BaseModel):
    allergies: list[AllergyResponse] = []
    medications: list[MedicationResponse] = []
    systemic_diseases: list[SystemicDiseaseResponse] = []
    surgical_history: list[SurgicalHistoryResponse] = []

    is_pregnant: bool = False
    pregnancy_week: int | None = None
    is_lactating: bool = False

    is_on_anticoagulants: bool = False
    anticoagulant_medication: str | None = None
    inr_value: float | None = None
    last_inr_date: date | None = None

    is_smoker: bool = False
    smoking_frequency: str | None = None
    alcohol_consumption: str | None = None

    bruxism: bool = False

    adverse_reactions_to_anesthesia: bool = False
    anesthesia_reaction_details: str | None = None

    last_updated_at: datetime | None = None
    last_updated_by: UUID | None = None


# --- Alerts (computed) --------------------------------------------------


class PatientAlert(BaseModel):
    type: str
    severity: str
    title: str
    details: str | None = None


class PatientAlertsResponse(BaseModel):
    alerts: list[PatientAlert]


# --- Specialty anamneses -------------------------------------------------


class DentalAnamnesisInput(BaseModel):
    professional_id: UUID | None = None
    consultation_reason: str | None = None
    illness_duration: str | None = Field(default=None, max_length=200)
    main_symptoms: str | None = None
    chronological_narrative: str | None = None
    biological_functions: str | None = None
    family_history: str | None = None
    personal_history: str | None = None
    high_blood_pressure: bool | None = None
    low_blood_pressure: bool | None = None
    hepatitis: bool | None = None
    gastritis: bool | None = None
    ulcers: bool | None = None
    hiv: bool | None = None
    diabetes: bool | None = None
    asthma: bool | None = None
    smoker: bool | None = None
    additional_comment: str | None = None
    blood_diseases: bool | None = None
    blood_diseases_detail: str | None = None
    heart_problems: bool | None = None
    heart_problems_detail: str | None = None
    other_disease: bool | None = None
    other_disease_detail: str | None = None
    brushing_frequency: str | None = Field(default=None, max_length=100)
    bleeding_gums: bool | None = None
    abnormal_extraction_bleeding: bool | None = None
    abnormal_extraction_bleeding_detail: str | None = None
    bruxism: bool | None = None
    mouth_discomfort: str | None = None
    allergies: bool | None = None
    allergies_detail: str | None = None
    recent_major_surgery: bool | None = None
    recent_major_surgery_detail: str | None = None
    permanent_medication: bool | None = None
    permanent_medication_detail: str | None = None
    blood_pressure: str | None = Field(default=None, max_length=30)
    pulse: int | None = Field(default=None, ge=0, le=300)
    heart_rate: int | None = Field(default=None, ge=0, le=300)
    respiratory_rate: int | None = Field(default=None, ge=0, le=120)
    temperature_c: float | None = Field(default=None, ge=20, le=50)
    extraoral_exam: str | None = None
    intraoral_exam: str | None = None
    auxiliary_exam_results: str | None = None
    observations: str | None = None


class DentalAnamnesisResponse(DentalAnamnesisInput):
    patient_id: UUID
    clinic_id: UUID
    last_updated_by: UUID | None = None
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class PediatricDentalAnamnesisInput(BaseModel):
    professional_id: UUID | None = None
    consultation_reason: str | None = None
    mother_name: str | None = Field(default=None, max_length=200)
    father_name: str | None = Field(default=None, max_length=200)
    siblings_count: int | None = Field(default=None, ge=0, le=50)
    birth_order: int | None = Field(default=None, ge=1, le=50)
    disease_type: str | None = None
    chronological_narrative: str | None = None
    maternal_diseases: str | None = None
    pregnancy_complications: bool | None = None
    premature_baby: bool | None = None
    birth_weight_kg: float | None = Field(default=None, ge=0, le=15)
    prenatal_comment: str | None = None
    birth_problems: bool | None = None
    birth_problems_detail: str | None = None
    pacifier_use: bool | None = None
    pacifier_use_detail: str | None = None
    bottle_use: bool | None = None
    bottle_use_detail: str | None = None
    thumb_sucking: bool | None = None
    thumb_sucking_detail: str | None = None
    medication_or_therapy: bool | None = None
    medication_or_therapy_detail: str | None = None
    allergies_or_intolerances: bool | None = None
    allergies_or_intolerances_detail: str | None = None
    brushes_before_sleep: bool | None = None
    brushes_before_sleep_detail: str | None = None
    open_mouth_or_snores: bool | None = None
    open_mouth_or_snores_detail: str | None = None
    postnatal_additional_comment: str | None = None
    sweets_times_per_day: int | None = Field(default=None, ge=0, le=50)
    sweets_days_per_week: int | None = Field(default=None, ge=0, le=7)
    milk_type: str | None = Field(default=None, max_length=200)
    dental_hygiene: str | None = None
    daily_diet: str | None = None
    parenting_style: str | None = None
    oral_habits: str | None = None
    brushing_technique: str | None = None
    clinical_exam: str | None = None
    observations: str | None = None


class PediatricDentalAnamnesisResponse(PediatricDentalAnamnesisInput):
    patient_id: UUID
    clinic_id: UUID
    last_updated_by: UUID | None = None
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


CHANNEL_CODES = {
    "single", "vestibular", "palatal_lingual", "mesiolingual", "mesiobuccal",
    "distal", "distobuccal", "distolingual",
}
ANATOMICAL_CROWN_CODES = {"caries", "restoration", "bruxism", "fracture", "fractureWithPulpExposure"}
PAIN_CHARACTERISTIC_CODES = {
    "spontaneous", "provoked", "cold", "heat", "chewing", "nocturnal", "air", "sweet",
    "acidic", "radiated", "diffuse", "stabbing", "continuous", "intermittent", "sporadic",
}
PERCUSSION_CODES = {"horizontal", "vertical"}
PALPATION_CODES = {"vestibular", "lingualPalatal"}
PULP_CHAMBER_CODES = {"open", "closed", "wide", "narrow", "pulpStones"}
CANALS_COUNT_CODES = {"singleCanal", "twoCanals", "threeCanals", "fourCanals"}
CANALS_CHARACTERISTIC_CODES = {"straight", "curved", "wide", "narrow", "previouslyTreated", "openApex"}
PULPAL_DIAGNOSIS_CODES = {
    "normalPulp", "reversiblePulpitis", "symptomaticIrreversiblePulpitis",
    "asymptomaticIrreversiblePulpitis", "pulpNecrosis", "diagnosisPreviouslyTreated", "previouslyInitiated",
}
PERIAPICAL_DIAGNOSIS_CODES = {
    "healthyApicalTissues", "acuteApicalPeriodontitis", "chronicApicalPeriodontitis",
    "acuteApicalAbscess", "chronicApicalAbscess", "condensingOsteitis",
}
DEFINITIVE_DIAGNOSIS_CODES = {"irreversiblePulpitis", "necroticPulp"}
INDICATED_TREATMENT_CODES = {
    "biopulpectomy", "apicoectomy", "necropulpectomy", "hemisection", "retreatment",
    "radicectomy", "whitening", "extraction",
}
RESTORATION_CODES = {"post", "amalgamResin", "crown", "other"}


def _ensure_codes(values: list[str], allowed: set[str]) -> list[str]:
    if len(values) != len(set(values)):
        raise ValueError("Clinical codes must not be duplicated")
    unknown = set(values) - allowed
    if unknown:
        raise ValueError(f"Unsupported clinical codes: {', '.join(sorted(unknown))}")
    return values


class EndodonticChannelInput(BaseModel):
    channel_code: str
    conduct: str | None = None
    working_length_mm: float | None = Field(default=None, ge=0, le=100)
    reference_point: str | None = Field(default=None, max_length=200)
    initial_file: str | None = Field(default=None, max_length=100)
    final_apical_file: str | None = Field(default=None, max_length=100)
    cement_type: str | None = Field(default=None, max_length=200)
    master_gutta_percha_cone: str | None = Field(default=None, max_length=100)

    @field_validator("channel_code")
    @classmethod
    def validate_channel_code(cls, value: str) -> str:
        if value not in CHANNEL_CODES:
            raise ValueError("Unsupported channel code")
        return value


class EndodonticChannelResponse(EndodonticChannelInput):
    id: UUID
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class EndodonticRecordFields(BaseModel):
    professional_id: UUID | None = None
    prior_endodontic_treatment: str | None = None
    pain_history: str | None = None
    initial_note: str | None = None
    anatomical_crown: list[str] = Field(default_factory=list)
    inflammation: bool | None = None
    inflammation_detail: str | None = None
    fistulas: bool | None = None
    fistulas_detail: str | None = None
    gingivitis: bool | None = None
    gingivitis_detail: str | None = None
    pockets: bool | None = None
    pockets_detail: str | None = None
    calculus: bool | None = None
    pain_characteristics: list[str] = Field(default_factory=list)
    percussion_pain: list[str] = Field(default_factory=list)
    palpation_pain: list[str] = Field(default_factory=list)
    clinical_exam_note: str | None = None
    heat_response: bool | None = None
    heat_duration: str | None = Field(default=None, max_length=100)
    heat_intensity: str | None = Field(default=None, max_length=100)
    cold_response: bool | None = None
    cold_duration: str | None = Field(default=None, max_length=100)
    cold_intensity: str | None = Field(default=None, max_length=100)
    pulp_chamber: list[str] = Field(default_factory=list)
    canals_count: list[str] = Field(default_factory=list)
    canals_characteristics: list[str] = Field(default_factory=list)
    furcation_lesion: bool | None = None
    apical_lesion: bool | None = None
    lateral_lesion: bool | None = None
    endo_perio_lesion: bool | None = None
    dwarf_roots: bool | None = None
    root_fracture: bool | None = None
    root_fracture_detail: str | None = None
    calcification: bool | None = None
    calcification_detail: str | None = None
    periodontal_ligament: bool | None = None
    periodontal_ligament_detail: str | None = None
    resorption: bool | None = None
    resorption_detail: str | None = None
    radiographic_note: str | None = None
    presumptive_pulpal_diagnosis: list[str] = Field(default_factory=list)
    presumptive_pulpal_note: str | None = None
    periapical_diagnosis: list[str] = Field(default_factory=list)
    periapical_note: str | None = None
    definitive_diagnosis: list[str] = Field(default_factory=list)
    definitive_note: str | None = None
    indicated_treatment: list[str] = Field(default_factory=list)
    indicated_treatment_note: str | None = None
    clinical_data_note: str | None = None
    operative_accidents: str | None = None
    post_endodontic_restoration: list[str] = Field(default_factory=list)
    prognosis: str | None = None
    final_note: str | None = None
    channels: list[EndodonticChannelInput] = Field(default_factory=list)

    @field_validator("anatomical_crown")
    @classmethod
    def validate_anatomical_crown(cls, value: list[str]) -> list[str]: return _ensure_codes(value, ANATOMICAL_CROWN_CODES)

    @field_validator("pain_characteristics")
    @classmethod
    def validate_pain_characteristics(cls, value: list[str]) -> list[str]: return _ensure_codes(value, PAIN_CHARACTERISTIC_CODES)

    @field_validator("percussion_pain")
    @classmethod
    def validate_percussion_pain(cls, value: list[str]) -> list[str]: return _ensure_codes(value, PERCUSSION_CODES)

    @field_validator("palpation_pain")
    @classmethod
    def validate_palpation_pain(cls, value: list[str]) -> list[str]: return _ensure_codes(value, PALPATION_CODES)

    @field_validator("pulp_chamber")
    @classmethod
    def validate_pulp_chamber(cls, value: list[str]) -> list[str]: return _ensure_codes(value, PULP_CHAMBER_CODES)

    @field_validator("canals_count")
    @classmethod
    def validate_canals_count(cls, value: list[str]) -> list[str]: return _ensure_codes(value, CANALS_COUNT_CODES)

    @field_validator("canals_characteristics")
    @classmethod
    def validate_canals_characteristics(cls, value: list[str]) -> list[str]: return _ensure_codes(value, CANALS_CHARACTERISTIC_CODES)

    @field_validator("presumptive_pulpal_diagnosis")
    @classmethod
    def validate_pulpal_diagnoses(cls, value: list[str]) -> list[str]: return _ensure_codes(value, PULPAL_DIAGNOSIS_CODES)

    @field_validator("periapical_diagnosis")
    @classmethod
    def validate_periapical_diagnoses(cls, value: list[str]) -> list[str]: return _ensure_codes(value, PERIAPICAL_DIAGNOSIS_CODES)

    @field_validator("definitive_diagnosis")
    @classmethod
    def validate_definitive_diagnoses(cls, value: list[str]) -> list[str]: return _ensure_codes(value, DEFINITIVE_DIAGNOSIS_CODES)

    @field_validator("indicated_treatment")
    @classmethod
    def validate_indicated_treatment(cls, value: list[str]) -> list[str]: return _ensure_codes(value, INDICATED_TREATMENT_CODES)

    @field_validator("post_endodontic_restoration")
    @classmethod
    def validate_restoration(cls, value: list[str]) -> list[str]: return _ensure_codes(value, RESTORATION_CODES)

    @field_validator("prognosis")
    @classmethod
    def validate_prognosis(cls, value: str | None) -> str | None:
        if value is not None and value not in {"favorable", "unfavorable", "reserved"}:
            raise ValueError("Unsupported prognosis")
        return value

    @field_validator("channels")
    @classmethod
    def validate_distinct_channels(
        cls, value: list[EndodonticChannelInput]
    ) -> list[EndodonticChannelInput]:
        codes = [channel.channel_code for channel in value]
        if len(codes) != len(set(codes)):
            raise ValueError("Channel codes must not be duplicated")
        return value


class EndodonticRecordCreate(EndodonticRecordFields):
    tooth_number: int = Field(ge=11, le=85)


class EndodonticRecordUpdate(EndodonticRecordFields):
    tooth_number: int | None = Field(default=None, ge=11, le=85)


class EndodonticRecordResponse(EndodonticRecordFields):
    id: UUID
    clinic_id: UUID
    patient_id: UUID
    tooth_number: int
    channels: list[EndodonticChannelResponse] = Field(default_factory=list)
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)
