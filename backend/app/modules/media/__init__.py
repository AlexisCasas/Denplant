"""Media module - document and file management."""

import logging
from typing import Any
from uuid import UUID

from fastapi import APIRouter
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.events import EventType
from app.core.plugins import BaseModule
from app.core.scheduling import ScheduledJob

from .models import Document, MediaAttachment, MediaPurgeOutbox
from .router import router
from .service import DocumentService

logger = logging.getLogger(__name__)


class MediaModule(BaseModule):
    """Media module providing document management."""

    manifest = {
        "name": "media",
        "version": "0.2.0",
        "summary": "Patient documents, photos, X-rays + polymorphic attachments.",
        "author": "DentalPin Core Team",
        "license": "BSL-1.1",
        "category": "official",
        "depends": ["patients"],
        "installable": True,
        "auto_install": True,
        "removable": False,
        "role_permissions": {
            "admin": ["*"],
            "dentist": ["*"],
            "hygienist": [
                "documents.read",
                "attachments.read",
                "attachments.write",
            ],
            "assistant": ["*"],
            "receptionist": ["*"],
        },
        "frontend": {
            "layer_path": "frontend",
        },
    }

    def get_models(self) -> list:
        return [Document, MediaAttachment, MediaPurgeOutbox]

    def get_router(self) -> APIRouter:
        return router

    def get_permissions(self) -> list[str]:
        return [
            "documents.read",
            "documents.write",
            "attachments.read",
            "attachments.write",
        ]

    def get_scheduled_jobs(self) -> list[ScheduledJob]:
        from .tasks import JOB_ID_PURGE_OUTBOX, process_media_purge_outbox

        return [
            ScheduledJob(
                id=JOB_ID_PURGE_OUTBOX,
                func=process_media_purge_outbox,
                trigger="interval",
                trigger_args={"minutes": 1},
                name="Process media purge outbox (every minute)",
                max_instances=1,
            )
        ]

    def get_event_handlers(self) -> dict[str, Any]:
        """Register event handlers."""
        return {
            EventType.PATIENT_ARCHIVED: self._on_patient_archived,
            EventType.PATIENT_RESTORED: self._on_patient_restored,
            EventType.PATIENT_PERMANENT_DELETE_REQUESTED: self._on_patient_permanent_delete,
        }

    async def _on_patient_archived(self, data: dict, *, db: AsyncSession) -> None:
        """Cascade soft-archive of a patient's documents when they are
        archived.

        Transactional (ADR 0019): the cascade is part of archiving the
        patient. On its own session it committed independently, so a request
        that failed after the publish left the documents archived under a
        patient that never was (issue #183).
        """
        patient_id = data.get("patient_id")
        clinic_id = data.get("clinic_id")
        if not patient_id or not clinic_id:
            logger.error(
                "media._on_patient_archived: missing patient_id/clinic_id in payload: %r",
                data,
            )
            return

        await DocumentService.archive_patient_documents(
            db, UUID(str(clinic_id)), UUID(str(patient_id))
        )

    async def _on_patient_restored(self, data: dict, *, db: AsyncSession) -> None:
        if data.get("patient_id") and data.get("clinic_id"):
            await DocumentService.restore_patient_documents(
                db, UUID(str(data["clinic_id"])), UUID(str(data["patient_id"]))
            )

    async def _on_patient_permanent_delete(self, data: dict, *, db: AsyncSession) -> None:
        if data.get("patient_id") and data.get("clinic_id"):
            await DocumentService.queue_patient_document_purge(
                db, UUID(str(data["clinic_id"])), UUID(str(data["patient_id"]))
            )
