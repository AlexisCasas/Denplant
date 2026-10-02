"""File-storage access for core features.

Core entities that own files (today: the clinic logo) need the same storage
backend the rest of the application uses (local volume now, object storage
later). The backend implementation lives in ``media``, which is
``removable=False``; this facade is the one place core reaches for it, with a
lazy import so loading core never loads a module.
"""

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from app.modules.media.storage.base import StorageBackend


def get_storage_backend() -> "StorageBackend":
    """The configured storage backend (singleton)."""
    from app.modules.media.storage import get_storage_backend as _get

    return _get()
