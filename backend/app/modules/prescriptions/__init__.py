"""Prescriptions module — medication prescriptions for printing and handwritten signature.

Owns ``prescriptions``, ``prescription_items`` and ``prescription_counters``.

A prescription is issued once and is immutable afterwards (the only change it
admits is ``issued → voided``, with a reason). Every name and address on it is
a snapshot taken at issue, so it never rewrites itself when the patient, the
user or the clinic change.

This is **not** an electronic prescription: nothing is digitally signed, and
the module has no pharmacy integration and no drug knowledge of any kind (no
catalog, dose calculation, interaction or contraindication checks). Its PDF is
an A4 sheet rendered on demand for printing and handwritten signature; it is
never stored.
It is also unrelated to ``patients_clinical.Medication``, which records what a
patient *takes*.
"""

from fastapi import APIRouter

from app.core.plugins import BaseModule

from .models import Prescription, PrescriptionCounter, PrescriptionItem
from .router import router


class PrescriptionsModule(BaseModule):
    manifest = {
        "name": "prescriptions",
        "version": "0.1.0",
        "summary": (
            "Immutable, numbered medication prescriptions for printing and "
            "handwritten signature. Not an electronic prescription."
        ),
        "author": "DentalPin Core Team",
        "license": "BSL-1.1",
        "category": "official",
        "depends": ["patients"],
        "installable": True,
        "auto_install": True,
        "removable": False,
        # Only a dentist is granted anything. The admin wildcard comes from the
        # core role table and also matches ``prescribe``, which is why issuing
        # is enforced again in the service.
        "role_permissions": {
            "admin": ["*"],
            "dentist": ["read", "prescribe", "void"],
        },
    }

    def get_models(self) -> list:
        return [Prescription, PrescriptionItem, PrescriptionCounter]

    def get_router(self) -> APIRouter:
        return router

    def get_permissions(self) -> list[str]:
        return ["read", "prescribe", "void"]

    def get_event_handlers(self) -> dict:
        return {}

    def get_tools(self) -> list:
        """Prescriptions exposes no AI tools because an agent must not draft,
        modify or issue medication prescriptions."""
        return []
