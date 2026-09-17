"""Core schemas for standardized API responses."""

from typing import Generic, TypeVar

from pydantic import BaseModel

T = TypeVar("T")


class ApiResponse(BaseModel, Generic[T]):
    """Wrapper for individual item responses."""

    data: T
    message: str | None = None


class PaginatedApiResponse(BaseModel, Generic[T]):
    """Wrapper for paginated list responses."""

    data: list[T]
    total: int
    page: int
    page_size: int
    message: str | None = None


class ErrorResponse(BaseModel):
    """Standard error response.

    ``code`` is optional and machine-readable: it lets a client tell two
    failures with the same status apart (for example a stale version from a
    duplicate draft, both 409) without parsing prose. Handlers that do not
    set one leave it null, so existing responses keep their shape.
    """

    data: None = None
    message: str
    errors: list[str] = []
    code: str | None = None
