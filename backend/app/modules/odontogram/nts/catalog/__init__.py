"""Versioned normative catalogs for odontogram profiles.

Read-only data plus the schema and validator that keep it honest. Nothing
here persists clinical information: a catalog says what a norm *requires*,
not what was found in a patient's mouth.
"""

from app.modules.odontogram.nts.catalog.loader import (
    CatalogNotFoundError,
    available_norm_versions,
    get_nts_catalog,
    get_nts_rule,
)
from app.modules.odontogram.nts.catalog.schema import (
    AttributeDef,
    AttributeKind,
    ColorSemantics,
    GeometryInput,
    GeometryMode,
    GlobalRule,
    NtsCatalog,
    NtsRule,
    RenderKind,
    ReviewStatus,
    Scope,
)
from app.modules.odontogram.nts.catalog.validator import (
    CatalogValidationError,
    validate_nts_catalog,
)

__all__ = [
    "AttributeDef",
    "AttributeKind",
    "CatalogNotFoundError",
    "CatalogValidationError",
    "ColorSemantics",
    "GeometryInput",
    "GeometryMode",
    "GlobalRule",
    "NtsCatalog",
    "NtsRule",
    "RenderKind",
    "ReviewStatus",
    "Scope",
    "available_norm_versions",
    "get_nts_catalog",
    "get_nts_rule",
    "validate_nts_catalog",
]
