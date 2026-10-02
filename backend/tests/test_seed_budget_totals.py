"""The demo seed prices budgets with the same rule as ``BudgetService``.

PRES-2024-0005 was seeded with a 5 % global discount taken from the ex-VAT
subtotal (24.50, total 549.50), while the service applies the discount to the
VAT-inclusive items total (28.70, total 545.30). A demo budget therefore changed
amount the moment it was recalculated, and disagreed with what ``pricing`` hands
the invoice wizard. These tests pin the seed to the service's rule.
"""

from decimal import Decimal
from types import SimpleNamespace
from uuid import NAMESPACE_DNS, uuid5

from app.modules.budget.pricing import allocate_global_discount
from app.seeds import demo_data

CENT = Decimal("0.01")


class _AnyCatalog(dict):
    """A catalog that knows every code: 21 % VAT on every third one, 100 € each."""

    def get(self, code, default=None):
        return self._entry(code)

    def __getitem__(self, code):
        return self._entry(code)

    @staticmethod
    def _entry(code: str) -> dict:
        taxed = sum(code.encode()) % 3 == 0
        return {
            "id": uuid5(NAMESPACE_DNS, code),
            "default_price": Decimal("100.00"),
            "vat_type_id": None,
            "vat_rate": 21.0 if taxed else 0.0,
            "odontogram_treatment_type": "filling",
            "sessions": [],
        }


def _seed_budgets():
    catalog = _AnyCatalog()
    plans = demo_data.generate_treatment_plans_data(catalog)
    return demo_data.generate_budgets_data(catalog, plans)


def _as_lines(items):
    return [
        SimpleNamespace(
            line_subtotal=i["line_subtotal"],
            line_discount=i["line_discount"],
            line_total=i["line_total"],
            vat_rate=i["vat_rate"],
        )
        for i in items
    ]


def test_every_seeded_budget_total_follows_the_service_rule():
    data = _seed_budgets()
    items_by_budget: dict = {}
    for item in data["items"]:
        items_by_budget.setdefault(item["budget_id"], []).append(item)

    checked = 0
    for budget in data["budgets"]:
        lines = items_by_budget[budget["id"]]
        items_total = sum((i["line_total"] for i in lines), Decimal("0.00"))
        kind, value = budget["global_discount_type"], budget["global_discount_value"]

        if kind == "percentage":
            expected_discount = (items_total * value / 100).quantize(CENT)
        elif kind == "absolute":
            expected_discount = min(value, items_total).quantize(CENT)
        else:
            expected_discount = Decimal("0.00")

        assert budget["total_discount"] == expected_discount, budget["budget_number"]
        assert budget["total"] == items_total - expected_discount, budget["budget_number"]
        # ``subtotal - discount + tax`` is the identity the PDF and the UI print.
        assert (
            budget["subtotal"] - budget["total_discount"] + budget["total_tax"] == budget["total"]
        )
        # And the invoice side (``pricing``) lands on the same gross to the cent.
        shares = allocate_global_discount(kind, value, _as_lines(lines))
        gross = sum(
            (
                (i["line_subtotal"] - i["line_discount"] - s)
                * (1 + Decimal(str(i["vat_rate"])) / 100)
                for i, s in zip(lines, shares, strict=True)
            ),
            Decimal("0.00"),
        )
        assert abs(gross - budget["total"]) <= Decimal("0.02"), budget["budget_number"]
        checked += 1
    assert checked >= 3  # the scenarios include a percentage and an absolute discount


def test_the_seed_helper_takes_the_discount_off_the_vat_inclusive_total():
    """The exact case that was wrong: 5 % of 574 is 28.70, not 5 % of 490."""
    assert demo_data._global_discount_amount(
        Decimal("574.00"), {"type": "percentage", "value": 5}
    ) == Decimal("28.70")
    assert demo_data._global_discount_amount(
        Decimal("574.00"), {"type": "absolute", "value": 50}
    ) == Decimal("50.00")
    # An absolute discount never exceeds what there is to discount.
    assert demo_data._global_discount_amount(
        Decimal("30.00"), {"type": "absolute", "value": 50}
    ) == Decimal("30.00")
    assert demo_data._global_discount_amount(Decimal("574.00"), None) == Decimal("0.00")
