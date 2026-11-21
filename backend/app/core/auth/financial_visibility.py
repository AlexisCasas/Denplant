"""Central capability for responses and endpoints containing monetary data."""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any

from fastapi import Depends, Request

from .dependencies import ClinicContext, get_clinic_context


# Deliberately exact field names.  Clinical counts, dates and treatment
# sequence numbers must survive; these are the monetary values that never
# belong in a dentist response.
FINANCIAL_FIELD_NAMES = frozenset(
    {
        "amount",
        "amount_paid",
        "average_value",
        "balance",
        "balance_due",
        "base_amount",
        "cost",
        "cost_price",
        "debt",
        "default_price",
        "discount",
        "discount_amount",
        "discount_value",
        "income",
        "line_discount",
        "line_subtotal",
        "line_tax",
        "margin",
        "outstanding",
        "paid",
        "paid_amount",
        "price",
        "price_snapshot",
        "pricing_config",
        "revenue",
        "rate",
        "surface_prices",
        "subtotal",
        "tax",
        "tax_amount",
        "total",
        "total_amount",
        "total_discount",
        "total_invoiced",
        "total_paid",
        "total_pending",
        "total_budgeted",
        "total_tax",
        "unit_price",
        "vat",
        "vat_rate",
        "vat_rate_snapshot",
        "vat_type",
        "vat_type_id",
        "work_completed",
        "work_in_progress",
    }
)


class FinancialVisibilityPolicy:
    """Dentists have clinical access but never receive monetary information."""

    @staticmethod
    def can_view_financial_amounts(ctx: ClinicContext) -> bool:
        return FinancialVisibilityPolicy.can_role_view_financial_amounts(ctx.role)

    @staticmethod
    def can_role_view_financial_amounts(role: str) -> bool:
        """Role-only variant for agent contexts after membership revalidation."""
        return role != "dentist"


def mark_financial_response(
    request: Request,
    ctx: ClinicContext = Depends(get_clinic_context),
) -> None:
    """Mark a clinical router response for monetary-field removal.

    The marker is consumed after FastAPI has serialized the declared response
    schema, which prevents default-valued Pydantic fields from reappearing.
    """
    request.state.hide_financial_amounts = not FinancialVisibilityPolicy.can_view_financial_amounts(ctx)


def strip_financial_fields(value: Any, *, _is_root: bool = True) -> Any:
    """Recursively remove monetary JSON keys without replacing them by sentinels."""
    if isinstance(value, Mapping):
        is_paginated_wrapper = _is_root and {"data", "total", "page", "page_size"}.issubset(value)
        return {
            key: strip_financial_fields(item, _is_root=False)
            for key, item in value.items()
            if is_paginated_wrapper or not _is_financial_key(key)
        }
    if isinstance(value, list):
        return [strip_financial_fields(item, _is_root=False) for item in value]
    return value


def _is_financial_key(key: str) -> bool:
    """Recognize both the audited names and future amount/price variants."""
    normalized = key.lower()
    return (
        normalized in FINANCIAL_FIELD_NAMES
        or normalized.endswith(("_amount", "_price", "_subtotal", "_discount", "_tax"))
    )
