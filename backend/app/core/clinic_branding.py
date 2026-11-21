"""Clinic visual identity: the logo.

The logo belongs to the clinic, not to any one document, so it lives in core
and every document that wants it (the budget PDF today, invoices later) reads
it from here.

Where things live
-----------------
* **The file** is in file storage, at ``clinics/{clinic_id}/branding/``. Each
  version has its own name (``logo-<sha8>.<ext>``), so replacing it never
  overwrites the previous file in place and a stale cache cannot serve the old
  image under the new name.
* **The reference** is ``clinic.settings["branding"]["logo"]``: path, MIME,
  pixel size, byte size, SHA-256, timestamp. Never the image, never base64.

The client never writes that reference — the settings PATCH endpoints each
accept a fixed set of keys and ``branding`` is not one of them — and every read
re-checks that the stored path is inside this clinic's own branding folder.

What an upload must be
----------------------
PNG, JPEG or WebP, decided by decoding it (the extension and the declared
content type are not trusted), at most 1 MB and 2000 × 2000 px, not animated.
It is then **re-encoded**, which drops EXIF and any other metadata and means
what is stored is an image this process produced, not the bytes it was handed.
SVG is refused: there is no sanitiser for it.
"""

from __future__ import annotations

import base64
import hashlib
import io
import logging
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import TYPE_CHECKING, Any

from PIL import Image, ImageOps, UnidentifiedImageError

from app.core.storage import get_storage_backend

if TYPE_CHECKING:
    from app.core.auth.models import Clinic

logger = logging.getLogger(__name__)

MAX_LOGO_BYTES = 1024 * 1024
MAX_LOGO_DIMENSION = 2000
#: A safe pixel budget, checked from the header before any pixel is decoded.
MAX_LOGO_PIXELS = MAX_LOGO_DIMENSION * MAX_LOGO_DIMENSION

#: Pillow format name → (MIME type, file extension).
ALLOWED_FORMATS: dict[str, tuple[str, str]] = {
    "PNG": ("image/png", "png"),
    "JPEG": ("image/jpeg", "jpg"),
    "WEBP": ("image/webp", "webp"),
}

# What the UI recommends; the PDF draws the logo in a fixed box of this ratio.
RECOMMENDED_WIDTH_PX = 600
RECOMMENDED_HEIGHT_PX = 240


class LogoValidationError(ValueError):
    """The uploaded file is not an acceptable logo. ``code`` is machine-readable."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code


@dataclass(frozen=True)
class NormalizedLogo:
    data: bytes
    mime_type: str
    extension: str
    width: int
    height: int
    sha256: str


def normalize_logo(raw: bytes) -> NormalizedLogo:
    """Validate an uploaded image and return the bytes that will be stored.

    Raises :class:`LogoValidationError`.
    """
    if not raw:
        raise LogoValidationError("empty", "The file is empty.")
    if len(raw) > MAX_LOGO_BYTES:
        raise LogoValidationError(
            "too_large", f"The file exceeds {MAX_LOGO_BYTES // (1024 * 1024)} MB."
        )

    try:
        with Image.open(io.BytesIO(raw)) as probe:
            image_format = probe.format
            width, height = probe.size
            frames = getattr(probe, "n_frames", 1)
            if image_format not in ALLOWED_FORMATS:
                raise LogoValidationError(
                    "unsupported_type", "The logo must be a PNG, JPEG or WebP image."
                )
            # Header only so far: refuse before decoding a single pixel.
            if width > MAX_LOGO_DIMENSION or height > MAX_LOGO_DIMENSION:
                raise LogoValidationError(
                    "dimensions",
                    f"The image is larger than {MAX_LOGO_DIMENSION}×{MAX_LOGO_DIMENSION} px.",
                )
            if width * height > MAX_LOGO_PIXELS:
                raise LogoValidationError("dimensions", "The image has too many pixels.")
            if width < 1 or height < 1:
                raise LogoValidationError("dimensions", "The image has no size.")
            if frames > 1:
                raise LogoValidationError("animated", "Animated images are not allowed.")

            image = ImageOps.exif_transpose(probe)  # also decodes
            image.load()
    except LogoValidationError:
        raise
    except (UnidentifiedImageError, OSError, ValueError, Image.DecompressionBombError) as exc:
        raise LogoValidationError(
            "unreadable", "The file is not a valid PNG, JPEG or WebP image."
        ) from exc

    mime, extension = ALLOWED_FORMATS[image_format]
    out = io.BytesIO()
    if image_format == "JPEG":
        # JPEG has no alpha and CMYK does not render everywhere.
        image.convert("RGB").save(out, "JPEG", quality=90, optimize=True)
    elif image_format == "PNG":
        if image.mode not in ("RGB", "RGBA", "L", "LA", "P"):
            image = image.convert("RGBA")
        image.save(out, "PNG", optimize=True)
    else:
        image.save(out, "WEBP", quality=90)
    data = out.getvalue()

    # Re-encoding can in principle grow the file; the limit is on what is kept.
    if len(data) > MAX_LOGO_BYTES:
        raise LogoValidationError(
            "too_large", f"The file exceeds {MAX_LOGO_BYTES // (1024 * 1024)} MB."
        )

    return NormalizedLogo(
        data=data,
        mime_type=mime,
        extension=extension,
        width=image.width,
        height=image.height,
        sha256=hashlib.sha256(data).hexdigest(),
    )


# ---------------------------------------------------------------------------
# storage + reference
# ---------------------------------------------------------------------------


def _branding_prefix(clinic_id: Any) -> str:
    return f"clinics/{clinic_id}/branding/"


def read_logo_reference(clinic: Clinic) -> dict | None:
    """The stored reference, or ``None`` if there is no logo (or it is malformed)."""
    settings = clinic.settings if isinstance(clinic.settings, dict) else {}
    branding = settings.get("branding")
    logo = branding.get("logo") if isinstance(branding, dict) else None
    if not isinstance(logo, dict):
        return None
    path = logo.get("path")
    # Never trust the path blindly: it must be inside this clinic's folder.
    if (
        not isinstance(path, str)
        or ".." in path
        or not path.startswith(_branding_prefix(clinic.id))
    ):
        logger.warning("Ignoring a malformed logo reference on clinic %s", clinic.id)
        return None
    return logo


def logo_metadata(clinic: Clinic) -> dict | None:
    """The part of the reference that is safe and useful to show a client."""
    logo = read_logo_reference(clinic)
    if logo is None:
        return None
    return {
        "mime_type": logo.get("mime_type"),
        "width": logo.get("width"),
        "height": logo.get("height"),
        "size": logo.get("size"),
        "sha256": logo.get("sha256"),
        "updated_at": logo.get("updated_at"),
    }


async def save_logo(clinic: Clinic, raw: bytes) -> NormalizedLogo:
    """Validate, store and reference a new logo, replacing any previous one.

    The caller commits. The previous file is deleted only after the new one is
    stored.
    """
    logo = normalize_logo(raw)
    storage = get_storage_backend()
    previous = read_logo_reference(clinic)

    path = f"{_branding_prefix(clinic.id)}logo-{logo.sha256[:12]}.{logo.extension}"
    await storage.store(logo.data, path)

    settings = dict(clinic.settings or {})
    branding = dict(settings.get("branding") or {})
    branding["logo"] = {
        "path": path,
        "mime_type": logo.mime_type,
        "width": logo.width,
        "height": logo.height,
        "size": len(logo.data),
        "sha256": logo.sha256,
        "updated_at": datetime.now(UTC).isoformat(),
    }
    settings["branding"] = branding
    clinic.settings = settings

    if previous and previous.get("path") != path:
        await storage.delete(previous["path"])
    return logo


async def remove_logo(clinic: Clinic) -> bool:
    """Delete the stored logo and its reference. ``False`` if there was none."""
    previous = read_logo_reference(clinic)
    settings = dict(clinic.settings or {})
    branding = dict(settings.get("branding") or {})
    had_reference = "logo" in branding
    branding.pop("logo", None)
    if branding:
        settings["branding"] = branding
    else:
        settings.pop("branding", None)
    clinic.settings = settings

    if previous:
        await get_storage_backend().delete(previous["path"])
    return previous is not None or had_reference


async def load_logo(clinic: Clinic) -> tuple[bytes, str] | None:
    """The logo's bytes and MIME type, or ``None`` if there is none to draw.

    A reference whose file has gone missing is logged and treated as no logo:
    a document must still render.
    """
    logo = read_logo_reference(clinic)
    if logo is None:
        return None
    try:
        data = await get_storage_backend().retrieve(logo["path"])
    except FileNotFoundError:
        logger.warning("Logo file missing for clinic %s (%s)", clinic.id, logo["path"])
        return None
    return data, str(logo.get("mime_type") or "image/png")


async def logo_data_uri(clinic: Clinic) -> str | None:
    """The logo as a ``data:`` URI, for embedding in an HTML document.

    Generated at render time from the file in storage, so nothing about it is
    kept in the database and the renderer never has to open a path or a URL.
    """
    loaded = await load_logo(clinic)
    if loaded is None:
        return None
    data, mime = loaded
    return f"data:{mime};base64,{base64.b64encode(data).decode('ascii')}"
