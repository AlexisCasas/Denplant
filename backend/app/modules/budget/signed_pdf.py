"""The signed budget PDF as a stored, immutable record.

When a budget is accepted its signed PDF is rendered **once**, the bytes are
written to file storage, their SHA-256 is recorded on the signature
(``BudgetSignature.document_hash``) and the file's location is recorded beside
the signature's own data (``signature_data["signed_pdf"]``, JSONB — no
migration). From then on the document is the stored file: every download
returns those exact bytes, so changing the clinic's logo, name, address or the
template later cannot alter something already signed.

The hash is metadata *about* the file, kept outside it. A file cannot contain
its own digest, so the PDF says where the evidence is kept rather than printing
a value.

## Legacy signatures

Signatures made before this existed have no ``signed_pdf`` reference (and, in
practice, no hash: it was never persisted). They are **not** touched: no hash is
invented for them and nothing is backfilled. Their download falls back,
explicitly, to rendering the PDF on the fly as before, and says so with
``X-Document-Source: regenerated``.

## Trust

``signature_data`` can carry client-supplied keys (a drawn signature's image),
so the reference is never believed on sight: a client-supplied ``signed_pdf``
is stripped on acceptance, and a reference is honoured only if its path is
exactly the one this module would generate for that signature.
"""

from __future__ import annotations

import hashlib
import logging
from datetime import UTC, datetime
from typing import Any
from uuid import UUID

from app.core.storage import get_storage_backend

from .models import BudgetSignature

logger = logging.getLogger(__name__)

SIGNED_PDF_KEY = "signed_pdf"

#: ``X-Document-Source`` values on a signed-PDF download.
SOURCE_STORED = "stored"
SOURCE_REGENERATED = "regenerated"


class SignedPdfIntegrityError(RuntimeError):
    """A stored signed PDF is missing or no longer matches its recorded hash."""


def signed_pdf_path(clinic_id: UUID, budget_id: UUID, signature_id: UUID) -> str:
    return f"budget-signed/{clinic_id}/{budget_id}/{signature_id}.pdf"


def strip_client_reference(signature_data: dict | None) -> dict | None:
    """Drop a ``signed_pdf`` key a client may have put in its signature data."""
    if not isinstance(signature_data, dict):
        return signature_data
    return {k: v for k, v in signature_data.items() if k != SIGNED_PDF_KEY}


def read_reference(signature: BudgetSignature) -> dict | None:
    """The signature's stored-PDF reference, or ``None`` (a legacy signature).

    ``None`` also for a reference that is not exactly what this module would
    have written for this signature.
    """
    data = signature.signature_data if isinstance(signature.signature_data, dict) else {}
    ref: Any = data.get(SIGNED_PDF_KEY)
    if not isinstance(ref, dict):
        return None
    expected = signed_pdf_path(signature.clinic_id, signature.budget_id, signature.id)
    if ref.get("path") != expected:
        logger.warning("Ignoring a signed-PDF reference on signature %s", signature.id)
        return None
    return ref


async def store_signed_pdf(signature: BudgetSignature, pdf_bytes: bytes) -> str:
    """Store the bytes, record their SHA-256 and the reference. Returns the hash.

    The caller flushes/commits. ``signature.id`` must already exist.
    """
    digest = hashlib.sha256(pdf_bytes).hexdigest()
    path = signed_pdf_path(signature.clinic_id, signature.budget_id, signature.id)
    await get_storage_backend().store(pdf_bytes, path)

    data = dict(strip_client_reference(signature.signature_data) or {})
    data[SIGNED_PDF_KEY] = {
        "path": path,
        "sha256": digest,
        "size": len(pdf_bytes),
        "stored_at": datetime.now(UTC).isoformat(),
    }
    # Reassign: JSONB change detection does not see an in-place edit.
    signature.signature_data = data
    signature.document_hash = digest
    return digest


async def load_signed_pdf(signature: BudgetSignature) -> bytes | None:
    """The stored bytes, verified against ``document_hash``.

    ``None`` for a legacy signature (no reference). Raises
    :class:`SignedPdfIntegrityError` if a recorded file is missing or does not
    hash to what was recorded: serving a different document in its place would
    be worse than failing.
    """
    ref = read_reference(signature)
    if ref is None:
        return None
    try:
        data = await get_storage_backend().retrieve(ref["path"])
    except FileNotFoundError as exc:
        raise SignedPdfIntegrityError(f"Signed PDF missing for signature {signature.id}") from exc
    digest = hashlib.sha256(data).hexdigest()
    if not signature.document_hash or digest != signature.document_hash:
        raise SignedPdfIntegrityError(
            f"Signed PDF for signature {signature.id} does not match its recorded hash"
        )
    return data
