"""Background jobs owned by the media module."""

from __future__ import annotations

import logging

from app.database import async_session_maker

from .service import DocumentService

logger = logging.getLogger(__name__)

JOB_ID_PURGE_OUTBOX = "media_purge_outbox"


async def process_media_purge_outbox() -> None:
    """Physically delete files queued after a committed patient purge.

    Rows stay ``failed`` after a storage error, so a later scheduler run can
    retry them. Database mutations are committed only after the complete
    batch has been attempted; an unexpected database failure is rolled back.
    """
    async with async_session_maker() as db:
        try:
            processed = await DocumentService.process_purge_outbox(db)
            await db.commit()
            if processed:
                logger.info("media purge outbox: processed %s files", processed)
        except Exception:
            await db.rollback()
            logger.exception("media purge outbox processing failed")
