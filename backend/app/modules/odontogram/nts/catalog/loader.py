"""Load, validate and cache normative catalogs.

A catalog is a JSON file in this package named after its ``norm_version``
(``pe_nts_188_2022.json``). It is parsed once, validated once, and handed
out as an immutable :class:`NtsCatalog`.

Validation runs at load time on purpose: a catalog that violates its own
invariants must never reach a caller, and the failure should be loud and
early rather than a surprise three layers up.
"""

from __future__ import annotations

import json
import re
from functools import cache
from pathlib import Path

from app.modules.odontogram.nts.catalog.schema import NtsCatalog, NtsRule
from app.modules.odontogram.nts.catalog.validator import validate_nts_catalog

CATALOG_DIR = Path(__file__).parent

#: Norm versions are file names; keep them boring so they cannot escape the
#: package directory.
_VERSION_RE = re.compile(r"^[a-z0-9_]+$")


class CatalogNotFoundError(LookupError):
    """No catalog is bundled for the requested norm version."""


class CatalogVersionMismatchError(CatalogNotFoundError):
    """File name and declared ``norm_version`` disagree."""


def available_norm_versions() -> tuple[str, ...]:
    """Norm versions bundled with this build, sorted."""
    return tuple(sorted(p.stem for p in CATALOG_DIR.glob("*.json")))


@cache
def get_nts_catalog(norm_version: str) -> NtsCatalog:
    """Return the validated catalog for ``norm_version``.

    Raises :class:`CatalogNotFoundError` if it is not bundled, and
    :class:`~app.modules.odontogram.nts.catalog.validator.CatalogValidationError`
    if it is bundled but inconsistent.
    """
    if not _VERSION_RE.match(norm_version):
        raise CatalogNotFoundError(
            f"Invalid norm version {norm_version!r}; "
            f"known versions: {', '.join(available_norm_versions())}"
        )

    path = CATALOG_DIR / f"{norm_version}.json"
    if not path.is_file():
        raise CatalogNotFoundError(
            f"No catalog bundled for norm version {norm_version!r}; "
            f"known versions: {', '.join(available_norm_versions())}"
        )

    catalog = NtsCatalog.model_validate(json.loads(path.read_text(encoding="utf-8")))

    if catalog.norm_version != norm_version:
        raise CatalogVersionMismatchError(
            f"{path.name} declares norm_version {catalog.norm_version!r}"
        )

    validate_nts_catalog(catalog)
    return catalog


def get_nts_rule(rule_id: str, norm_version: str) -> NtsRule:
    """Return one rule, or raise :class:`CatalogNotFoundError`."""
    rule = get_nts_catalog(norm_version).rule(rule_id)
    if rule is None:
        raise CatalogNotFoundError(f"Rule {rule_id!r} does not exist in {norm_version!r}")
    return rule
