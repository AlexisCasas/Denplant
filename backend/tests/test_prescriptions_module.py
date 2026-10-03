"""Prescriptions — the module contract: manifest, permissions, tools, routes."""

import pytest

from app.core.auth.permissions import has_permission
from app.core.plugins.loader import discover_modules
from app.modules.prescriptions import PrescriptionsModule
from app.modules.prescriptions.router import router


@pytest.fixture(scope="module")
def module() -> PrescriptionsModule:
    found = {m.name: m for m in discover_modules()}
    assert "prescriptions" in found, "the module is not discovered"
    return found["prescriptions"]  # type: ignore[return-value]


def test_the_manifest_is_valid_and_deliberate(module) -> None:
    manifest = module.get_manifest()
    assert manifest.name == "prescriptions"
    assert manifest.category.value == "official"
    assert manifest.depends == ("patients",)
    # Installed by default, and never removable: uninstalling would destroy
    # legal clinical documents.
    assert manifest.installable is True
    assert manifest.auto_install is True
    assert manifest.removable is False
    assert manifest.role_permissions


def test_it_declares_exactly_three_permissions(module) -> None:
    assert module.get_permissions() == ["read", "prescribe", "void"]


def test_only_a_dentist_is_granted_anything(module) -> None:
    grants = module.get_manifest().role_permissions
    assert set(grants) == {"admin", "dentist"}
    assert set(grants["dentist"]) == {"read", "prescribe", "void"}
    for role in ("hygienist", "assistant", "receptionist"):
        assert role not in grants
        for permission in ("read", "prescribe", "void"):
            assert not has_permission(role, f"prescriptions.{permission}"), (role, permission)


def test_the_dentist_holds_all_three_permissions() -> None:
    for permission in ("read", "prescribe", "void"):
        assert has_permission("dentist", f"prescriptions.{permission}")


def test_the_admin_wildcard_matches_prescribe_which_is_why_the_service_checks_the_role() -> None:
    # The core role table grants admin "*". The permission therefore cannot say
    # "not an admin": PrescriptionService.require_eligible_prescriber does.
    assert has_permission("admin", "prescriptions.prescribe")


def test_it_exposes_no_ai_tools_and_no_event_handlers(module) -> None:
    assert module.get_tools() == []
    assert module.get_event_handlers() == {}


def test_the_router_has_no_put_patch_or_delete() -> None:
    methods = {method for route in router.routes for method in getattr(route, "methods", set())}
    assert methods == {"GET", "POST"}


def test_the_models_are_the_three_tables(module) -> None:
    assert {m.__tablename__ for m in module.get_models()} == {
        "prescriptions",
        "prescription_items",
        "prescription_counters",
    }
