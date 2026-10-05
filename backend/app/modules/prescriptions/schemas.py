"""Prescriptions — request and response schemas.

The create request carries three things and nothing else: the patient, the
last day the prescription is valid, and the medications. ``extra="forbid"``
turns every other key into a 422, which is what keeps a client from naming its
own clinic, prescriber, number, status, dates or snapshots.
"""

from __future__ import annotations

from datetime import date, datetime
from typing import Annotated
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, field_validator

#: Trimmed, and at least one visible character left after trimming.
Required100 = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=100)]
Required200 = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)]
Required2000 = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=2000)
]


class _Request(BaseModel):
    model_config = ConfigDict(extra="forbid")


class PrescriptionItemCreate(_Request):
    """One medication, as free text. Nothing is looked up or normalised."""

    # --- required ---------------------------------------------------------
    #: Denominación Común Internacional.
    active_ingredient: Required200
    strength: Required100
    pharmaceutical_form: Required100
    dose: Required200
    route: Required100
    frequency: Required200
    duration: Required100
    total_quantity: Required100

    # --- optional ---------------------------------------------------------
    commercial_name: str | None = Field(default=None, max_length=200)
    presentation: str | None = Field(default=None, max_length=200)
    instructions: str | None = Field(default=None, max_length=4000)

    @field_validator("commercial_name", "presentation", "instructions")
    @classmethod
    def _blank_is_absent(cls, value: str | None) -> str | None:
        if value is None:
            return None
        stripped = value.strip()
        return stripped or None


class PrescriptionCreate(_Request):
    """Issue a prescription. The only three things a client may say."""

    patient_id: UUID
    #: Required, with no default: the validity is a clinical decision.
    valid_until: date
    items: list[PrescriptionItemCreate] = Field(min_length=1, max_length=50)


class PrescriptionVoid(_Request):
    reason: Required2000


class PrescriptionItemResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    position: int
    active_ingredient: str
    strength: str
    pharmaceutical_form: str
    dose: str
    route: str
    frequency: str
    duration: str
    total_quantity: str
    commercial_name: str | None
    presentation: str | None
    instructions: str | None


class PrescriptionSummaryResponse(BaseModel):
    """One row of a patient's history."""

    id: UUID
    number: str
    issued_at: datetime
    issue_date: date
    valid_until: date
    prescriber_name_snapshot: str
    item_count: int
    status: str
    voided_at: datetime | None


class PrescriptionResponse(BaseModel):
    """The whole document: header, every snapshot and the items."""

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    clinic_id: UUID
    patient_id: UUID
    prescriber_user_id: UUID

    number: str
    sequence: int
    year: int
    issued_at: datetime
    issue_date: date
    valid_until: date

    status: str
    voided_at: datetime | None
    voided_by: UUID | None
    void_reason: str | None

    patient_name_snapshot: str
    patient_national_id_snapshot: str | None
    patient_national_id_type_snapshot: str | None
    patient_date_of_birth_snapshot: date

    prescriber_name_snapshot: str
    prescriber_professional_id_snapshot: str

    clinic_name_snapshot: str
    clinic_legal_name_snapshot: str | None
    clinic_tax_id_snapshot: str
    clinic_address_snapshot: str | None
    clinic_phone_snapshot: str | None

    items: list[PrescriptionItemResponse]
