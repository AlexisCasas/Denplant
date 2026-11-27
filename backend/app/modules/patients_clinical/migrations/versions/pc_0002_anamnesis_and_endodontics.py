"""Add specialty anamneses and endodontic records.

Revision ID: pc_0002
Revises: pc_0001
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "pc_0002"
down_revision: str | None = "pc_0001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _audit_columns() -> list[sa.Column]:
    return [
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    ]


def upgrade() -> None:
    op.create_table(
        "patients_clinical_dental_anamnesis",
        sa.Column("patient_id", sa.UUID(), nullable=False),
        sa.Column("clinic_id", sa.UUID(), nullable=False),
        sa.Column("professional_id", sa.UUID(), nullable=True),
        sa.Column("last_updated_by", sa.UUID(), nullable=True),
        sa.Column("consultation_reason", sa.Text(), nullable=True),
        sa.Column("illness_duration", sa.String(length=200), nullable=True),
        sa.Column("main_symptoms", sa.Text(), nullable=True),
        sa.Column("chronological_narrative", sa.Text(), nullable=True),
        sa.Column("biological_functions", sa.Text(), nullable=True),
        sa.Column("family_history", sa.Text(), nullable=True),
        sa.Column("personal_history", sa.Text(), nullable=True),
        sa.Column("high_blood_pressure", sa.Boolean(), nullable=True),
        sa.Column("low_blood_pressure", sa.Boolean(), nullable=True),
        sa.Column("hepatitis", sa.Boolean(), nullable=True),
        sa.Column("gastritis", sa.Boolean(), nullable=True),
        sa.Column("ulcers", sa.Boolean(), nullable=True),
        sa.Column("hiv", sa.Boolean(), nullable=True),
        sa.Column("diabetes", sa.Boolean(), nullable=True),
        sa.Column("asthma", sa.Boolean(), nullable=True),
        sa.Column("smoker", sa.Boolean(), nullable=True),
        sa.Column("additional_comment", sa.Text(), nullable=True),
        sa.Column("blood_diseases", sa.Boolean(), nullable=True),
        sa.Column("blood_diseases_detail", sa.Text(), nullable=True),
        sa.Column("heart_problems", sa.Boolean(), nullable=True),
        sa.Column("heart_problems_detail", sa.Text(), nullable=True),
        sa.Column("other_disease", sa.Boolean(), nullable=True),
        sa.Column("other_disease_detail", sa.Text(), nullable=True),
        sa.Column("brushing_frequency", sa.String(length=100), nullable=True),
        sa.Column("bleeding_gums", sa.Boolean(), nullable=True),
        sa.Column("abnormal_extraction_bleeding", sa.Boolean(), nullable=True),
        sa.Column("abnormal_extraction_bleeding_detail", sa.Text(), nullable=True),
        sa.Column("bruxism", sa.Boolean(), nullable=True),
        sa.Column("mouth_discomfort", sa.Text(), nullable=True),
        sa.Column("allergies", sa.Boolean(), nullable=True),
        sa.Column("allergies_detail", sa.Text(), nullable=True),
        sa.Column("recent_major_surgery", sa.Boolean(), nullable=True),
        sa.Column("recent_major_surgery_detail", sa.Text(), nullable=True),
        sa.Column("permanent_medication", sa.Boolean(), nullable=True),
        sa.Column("permanent_medication_detail", sa.Text(), nullable=True),
        sa.Column("blood_pressure", sa.String(length=30), nullable=True),
        sa.Column("pulse", sa.Integer(), nullable=True),
        sa.Column("heart_rate", sa.Integer(), nullable=True),
        sa.Column("respiratory_rate", sa.Integer(), nullable=True),
        sa.Column("temperature_c", sa.Float(), nullable=True),
        sa.Column("extraoral_exam", sa.Text(), nullable=True),
        sa.Column("intraoral_exam", sa.Text(), nullable=True),
        sa.Column("auxiliary_exam_results", sa.Text(), nullable=True),
        sa.Column("observations", sa.Text(), nullable=True),
        *_audit_columns(),
        sa.ForeignKeyConstraint(["clinic_id"], ["clinics.id"]),
        sa.ForeignKeyConstraint(["patient_id"], ["patients.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["professional_id"], ["users.id"]),
        sa.ForeignKeyConstraint(["last_updated_by"], ["users.id"]),
        sa.PrimaryKeyConstraint("patient_id"),
    )
    op.create_index(
        op.f("ix_patients_clinical_dental_anamnesis_clinic_id"),
        "patients_clinical_dental_anamnesis", ["clinic_id"], unique=False,
    )

    op.create_table(
        "patients_clinical_pediatric_dental_anamnesis",
        sa.Column("patient_id", sa.UUID(), nullable=False),
        sa.Column("clinic_id", sa.UUID(), nullable=False),
        sa.Column("professional_id", sa.UUID(), nullable=True),
        sa.Column("last_updated_by", sa.UUID(), nullable=True),
        sa.Column("consultation_reason", sa.Text(), nullable=True),
        sa.Column("mother_name", sa.String(length=200), nullable=True),
        sa.Column("father_name", sa.String(length=200), nullable=True),
        sa.Column("siblings_count", sa.Integer(), nullable=True),
        sa.Column("birth_order", sa.Integer(), nullable=True),
        sa.Column("disease_type", sa.Text(), nullable=True),
        sa.Column("chronological_narrative", sa.Text(), nullable=True),
        sa.Column("maternal_diseases", sa.Text(), nullable=True),
        sa.Column("pregnancy_complications", sa.Boolean(), nullable=True),
        sa.Column("premature_baby", sa.Boolean(), nullable=True),
        sa.Column("birth_weight_kg", sa.Float(), nullable=True),
        sa.Column("prenatal_comment", sa.Text(), nullable=True),
        sa.Column("birth_problems", sa.Boolean(), nullable=True),
        sa.Column("birth_problems_detail", sa.Text(), nullable=True),
        sa.Column("pacifier_use", sa.Boolean(), nullable=True),
        sa.Column("pacifier_use_detail", sa.Text(), nullable=True),
        sa.Column("bottle_use", sa.Boolean(), nullable=True),
        sa.Column("bottle_use_detail", sa.Text(), nullable=True),
        sa.Column("thumb_sucking", sa.Boolean(), nullable=True),
        sa.Column("thumb_sucking_detail", sa.Text(), nullable=True),
        sa.Column("medication_or_therapy", sa.Boolean(), nullable=True),
        sa.Column("medication_or_therapy_detail", sa.Text(), nullable=True),
        sa.Column("allergies_or_intolerances", sa.Boolean(), nullable=True),
        sa.Column("allergies_or_intolerances_detail", sa.Text(), nullable=True),
        sa.Column("brushes_before_sleep", sa.Boolean(), nullable=True),
        sa.Column("brushes_before_sleep_detail", sa.Text(), nullable=True),
        sa.Column("open_mouth_or_snores", sa.Boolean(), nullable=True),
        sa.Column("open_mouth_or_snores_detail", sa.Text(), nullable=True),
        sa.Column("postnatal_additional_comment", sa.Text(), nullable=True),
        sa.Column("sweets_times_per_day", sa.Integer(), nullable=True),
        sa.Column("sweets_days_per_week", sa.Integer(), nullable=True),
        sa.Column("milk_type", sa.String(length=200), nullable=True),
        sa.Column("dental_hygiene", sa.Text(), nullable=True),
        sa.Column("daily_diet", sa.Text(), nullable=True),
        sa.Column("parenting_style", sa.Text(), nullable=True),
        sa.Column("oral_habits", sa.Text(), nullable=True),
        sa.Column("brushing_technique", sa.Text(), nullable=True),
        sa.Column("clinical_exam", sa.Text(), nullable=True),
        sa.Column("observations", sa.Text(), nullable=True),
        *_audit_columns(),
        sa.ForeignKeyConstraint(["clinic_id"], ["clinics.id"]),
        sa.ForeignKeyConstraint(["patient_id"], ["patients.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["professional_id"], ["users.id"]),
        sa.ForeignKeyConstraint(["last_updated_by"], ["users.id"]),
        sa.PrimaryKeyConstraint("patient_id"),
    )
    op.create_index(
        op.f("ix_patients_clinical_pediatric_dental_anamnesis_clinic_id"),
        "patients_clinical_pediatric_dental_anamnesis", ["clinic_id"], unique=False,
    )

    op.create_table(
        "patients_clinical_endodontic_record",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("clinic_id", sa.UUID(), nullable=False),
        sa.Column("patient_id", sa.UUID(), nullable=False),
        sa.Column("professional_id", sa.UUID(), nullable=True),
        sa.Column("tooth_number", sa.Integer(), nullable=False),
        sa.Column("prior_endodontic_treatment", sa.Text(), nullable=True),
        sa.Column("pain_history", sa.Text(), nullable=True),
        sa.Column("initial_note", sa.Text(), nullable=True),
        sa.Column("anatomical_crown", postgresql.ARRAY(sa.String()), nullable=False, server_default="{}"),
        sa.Column("inflammation", sa.Boolean(), nullable=True),
        sa.Column("inflammation_detail", sa.Text(), nullable=True),
        sa.Column("fistulas", sa.Boolean(), nullable=True),
        sa.Column("fistulas_detail", sa.Text(), nullable=True),
        sa.Column("gingivitis", sa.Boolean(), nullable=True),
        sa.Column("gingivitis_detail", sa.Text(), nullable=True),
        sa.Column("pockets", sa.Boolean(), nullable=True),
        sa.Column("pockets_detail", sa.Text(), nullable=True),
        sa.Column("calculus", sa.Boolean(), nullable=True),
        sa.Column("pain_characteristics", postgresql.ARRAY(sa.String()), nullable=False, server_default="{}"),
        sa.Column("percussion_pain", postgresql.ARRAY(sa.String()), nullable=False, server_default="{}"),
        sa.Column("palpation_pain", postgresql.ARRAY(sa.String()), nullable=False, server_default="{}"),
        sa.Column("clinical_exam_note", sa.Text(), nullable=True),
        sa.Column("heat_response", sa.Boolean(), nullable=True),
        sa.Column("heat_duration", sa.String(length=100), nullable=True),
        sa.Column("heat_intensity", sa.String(length=100), nullable=True),
        sa.Column("cold_response", sa.Boolean(), nullable=True),
        sa.Column("cold_duration", sa.String(length=100), nullable=True),
        sa.Column("cold_intensity", sa.String(length=100), nullable=True),
        sa.Column("pulp_chamber", postgresql.ARRAY(sa.String()), nullable=False, server_default="{}"),
        sa.Column("canals_count", postgresql.ARRAY(sa.String()), nullable=False, server_default="{}"),
        sa.Column("canals_characteristics", postgresql.ARRAY(sa.String()), nullable=False, server_default="{}"),
        sa.Column("furcation_lesion", sa.Boolean(), nullable=True),
        sa.Column("apical_lesion", sa.Boolean(), nullable=True),
        sa.Column("lateral_lesion", sa.Boolean(), nullable=True),
        sa.Column("endo_perio_lesion", sa.Boolean(), nullable=True),
        sa.Column("dwarf_roots", sa.Boolean(), nullable=True),
        sa.Column("root_fracture", sa.Boolean(), nullable=True),
        sa.Column("root_fracture_detail", sa.Text(), nullable=True),
        sa.Column("calcification", sa.Boolean(), nullable=True),
        sa.Column("calcification_detail", sa.Text(), nullable=True),
        sa.Column("periodontal_ligament", sa.Boolean(), nullable=True),
        sa.Column("periodontal_ligament_detail", sa.Text(), nullable=True),
        sa.Column("resorption", sa.Boolean(), nullable=True),
        sa.Column("resorption_detail", sa.Text(), nullable=True),
        sa.Column("radiographic_note", sa.Text(), nullable=True),
        sa.Column("presumptive_pulpal_diagnosis", postgresql.ARRAY(sa.String()), nullable=False, server_default="{}"),
        sa.Column("presumptive_pulpal_note", sa.Text(), nullable=True),
        sa.Column("periapical_diagnosis", postgresql.ARRAY(sa.String()), nullable=False, server_default="{}"),
        sa.Column("periapical_note", sa.Text(), nullable=True),
        sa.Column("definitive_diagnosis", postgresql.ARRAY(sa.String()), nullable=False, server_default="{}"),
        sa.Column("definitive_note", sa.Text(), nullable=True),
        sa.Column("indicated_treatment", postgresql.ARRAY(sa.String()), nullable=False, server_default="{}"),
        sa.Column("indicated_treatment_note", sa.Text(), nullable=True),
        sa.Column("clinical_data_note", sa.Text(), nullable=True),
        sa.Column("operative_accidents", sa.Text(), nullable=True),
        sa.Column("post_endodontic_restoration", postgresql.ARRAY(sa.String()), nullable=False, server_default="{}"),
        sa.Column("prognosis", sa.String(length=20), nullable=True),
        sa.Column("final_note", sa.Text(), nullable=True),
        *_audit_columns(),
        sa.ForeignKeyConstraint(["clinic_id"], ["clinics.id"]),
        sa.ForeignKeyConstraint(["patient_id"], ["patients.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["professional_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_pc_endo_clinic_patient_created", "patients_clinical_endodontic_record", ["clinic_id", "patient_id", "created_at"], unique=False)
    op.create_index("ix_pc_endo_clinic_patient_tooth", "patients_clinical_endodontic_record", ["clinic_id", "patient_id", "tooth_number"], unique=False)

    op.create_table(
        "patients_clinical_endodontic_record_channel",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("endodontic_record_id", sa.UUID(), nullable=False),
        sa.Column("channel_code", sa.String(length=30), nullable=False),
        sa.Column("conduct", sa.Text(), nullable=True),
        sa.Column("working_length_mm", sa.Numeric(precision=6, scale=2), nullable=True),
        sa.Column("reference_point", sa.String(length=200), nullable=True),
        sa.Column("initial_file", sa.String(length=100), nullable=True),
        sa.Column("final_apical_file", sa.String(length=100), nullable=True),
        sa.Column("cement_type", sa.String(length=200), nullable=True),
        sa.Column("master_gutta_percha_cone", sa.String(length=100), nullable=True),
        *_audit_columns(),
        sa.CheckConstraint(
            "channel_code IN ('single', 'vestibular', 'palatal_lingual', 'mesiolingual', "
            "'mesiobuccal', 'distal', 'distobuccal', 'distolingual')",
            name="ck_pc_endo_channel_code",
        ),
        sa.ForeignKeyConstraint(
            ["endodontic_record_id"], ["patients_clinical_endodontic_record.id"], ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("endodontic_record_id", "channel_code", name="uq_pc_endo_channel_code"),
    )
    op.create_index(
        op.f("ix_patients_clinical_endodontic_record_channel_endodontic_record_id"),
        "patients_clinical_endodontic_record_channel", ["endodontic_record_id"], unique=False,
    )


def downgrade() -> None:
    op.drop_index(op.f("ix_patients_clinical_endodontic_record_channel_endodontic_record_id"), table_name="patients_clinical_endodontic_record_channel")
    op.drop_table("patients_clinical_endodontic_record_channel")
    op.drop_index("ix_pc_endo_clinic_patient_tooth", table_name="patients_clinical_endodontic_record")
    op.drop_index("ix_pc_endo_clinic_patient_created", table_name="patients_clinical_endodontic_record")
    op.drop_table("patients_clinical_endodontic_record")
    op.drop_index(op.f("ix_patients_clinical_pediatric_dental_anamnesis_clinic_id"), table_name="patients_clinical_pediatric_dental_anamnesis")
    op.drop_table("patients_clinical_pediatric_dental_anamnesis")
    op.drop_index(op.f("ix_patients_clinical_dental_anamnesis_clinic_id"), table_name="patients_clinical_dental_anamnesis")
    op.drop_table("patients_clinical_dental_anamnesis")
