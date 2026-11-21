"""The budget PDF: figures, treatments, clinic identity, escaping, logo.

What a client sees is checked three ways at once: the stored rows, what the API
returns, and what the PDF *draws* (WeasyPrint's own layout of the rendered
document, so it is what ends up on the page, not what the template meant to
write).
"""

from __future__ import annotations

import io
from decimal import Decimal
from uuid import UUID, uuid4

import pytest
from httpx import AsyncClient
from PIL import Image
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth.models import Clinic, ClinicMembership
from app.core.clinic_branding import save_logo
from app.core.utils.currency import format_currency
from app.modules.budget.pdf import (
    BudgetPDFService,
    build_pdf_context,
    compute_figures,
    render_html,
)
from app.modules.budget.pricing import allocate_global_discount
from app.modules.budget.service import BudgetService
from app.modules.catalog.models import TreatmentCatalogItem, TreatmentCategory, VatType
from app.modules.patients.models import Patient

CURRENCY = "USD"


def money(amount: str | Decimal) -> str:
    return format_currency(Decimal(str(amount)), CURRENCY, locale="es_ES")


# ---------------------------------------------------------------------------
# setup
# ---------------------------------------------------------------------------


@pytest.fixture
async def pdf_setup(
    db_session: AsyncSession, auth_headers: dict[str, str], client: AsyncClient
) -> dict:
    me = await client.get("/api/v1/auth/me", headers=auth_headers)
    user_id = me.json()["data"]["user"]["id"]

    clinic = Clinic(
        id=uuid4(),
        name="Clínica Sonrisa",
        legal_name="Sonrisa Dental S.L.",
        tax_id="B12345674",
        address={
            "street": "Calle Mayor 1",
            "city": "Madrid",
            "postal_code": "28013",
            "country": "España",
        },
        phone="+34 911 000 111",
        email="hola@sonrisa.test",
        currency=CURRENCY,
        settings={"slot_duration_min": 15},
    )
    db_session.add(clinic)
    await db_session.flush()
    db_session.add(ClinicMembership(id=uuid4(), user_id=user_id, clinic_id=clinic.id, role="admin"))

    vat21 = VatType(
        id=uuid4(),
        clinic_id=clinic.id,
        names={"es": "General", "en": "General"},
        rate=21.0,
        is_default=False,
        is_system=False,
    )
    vat0 = VatType(
        id=uuid4(),
        clinic_id=clinic.id,
        names={"es": "Exento", "en": "Exempt"},
        rate=0.0,
        is_default=True,
        is_system=True,
    )
    category = TreatmentCategory(
        id=uuid4(),
        clinic_id=clinic.id,
        key="cat",
        names={"es": "Cat", "en": "Cat"},
        display_order=1,
        is_active=True,
        is_system=False,
    )
    db_session.add_all([vat21, vat0, category])
    await db_session.flush()

    def catalog(code: str, names: dict, price: str, vat: VatType) -> TreatmentCatalogItem:
        return TreatmentCatalogItem(
            id=uuid4(),
            clinic_id=clinic.id,
            category_id=category.id,
            internal_code=code,
            names=names,
            descriptions={},
            default_price=Decimal(price),
            vat_type_id=vat.id,
            treatment_scope="whole_tooth",
            is_diagnostic=False,
            is_active=True,
            is_system=False,
        )

    taxed = catalog("TAX-1", {"es": "Empaste", "en": "Filling"}, "100.00", vat21)
    exempt = catalog("EXE-1", {"es": "Revisión", "en": "Checkup"}, "50.00", vat0)
    # No Spanish or English name at all: only Tamil. The fallback chain must find it.
    odd = catalog("ODD-1", {"ta": "சிகிச்சை"}, "10.00", vat0)
    nameless = catalog("NON-1", {}, "10.00", vat0)
    patient = Patient(
        id=uuid4(),
        clinic_id=clinic.id,
        first_name="Ana",
        last_name="García",
        email="ana@test.com",
        phone="+34600000000",
        status="active",
    )
    db_session.add_all([taxed, exempt, odd, nameless, patient])
    await db_session.commit()

    return {
        "clinic_id": clinic.id,
        "patient_id": str(patient.id),
        "taxed": str(taxed.id),
        "exempt": str(exempt.id),
        "odd": str(odd.id),
        "nameless": str(nameless.id),
    }


async def make_budget(
    client: AsyncClient,
    headers: dict,
    setup: dict,
    items: list[dict],
    **budget_fields,
) -> str:
    created = await client.post(
        "/api/v1/budget/budgets",
        json={"patient_id": setup["patient_id"], "valid_from": "2024-01-01", **budget_fields},
        headers=headers,
    )
    assert created.status_code == 201, created.text
    budget_id = created.json()["data"]["id"]
    for item in items:
        added = await client.post(
            f"/api/v1/budget/budgets/{budget_id}/items", json=item, headers=headers
        )
        assert added.status_code == 201, added.text
    return budget_id


async def load(db: AsyncSession, setup: dict, budget_id: str):
    """The budget as the PDF routes load it, from what is *stored*."""
    db.expire_all()
    budget = await BudgetService.get_budget(
        db, setup["clinic_id"], UUID(budget_id), include_items=True
    )
    clinic = await db.get(Clinic, setup["clinic_id"])
    return budget, clinic


async def context(db: AsyncSession, setup: dict, budget_id: str, **kw):
    budget, clinic = await load(db, setup, budget_id)
    return budget, clinic, await build_pdf_context(budget, clinic, **kw)


def layout_text(html_content: str) -> str:
    """Every piece of text WeasyPrint lays out on the pages of this document."""
    from weasyprint import HTML

    document = HTML(string=html_content).render()
    chunks: list[str] = []
    for page in document.pages:
        for box in page._page_box.descendants():
            text = getattr(box, "text", None)
            if isinstance(text, str):
                chunks.append(text)
    return " ".join(chunks)


def png(width: int, height: int, color=(30, 90, 200)) -> bytes:
    out = io.BytesIO()
    Image.new("RGB", (width, height), color).save(out, "PNG")
    return out.getvalue()


# ===========================================================================
# money
# ===========================================================================


async def api_detail(client: AsyncClient, headers: dict, budget_id: str) -> dict:
    response = await client.get(f"/api/v1/budget/budgets/{budget_id}", headers=headers)
    assert response.status_code == 200
    return response.json()["data"]


async def assert_pdf_matches(
    client: AsyncClient, headers: dict, db: AsyncSession, setup: dict, budget_id: str
):
    """persisted == API == PDF, to the cent, line by line and in the totals."""
    api = await api_detail(client, headers, budget_id)
    budget, clinic, ctx = await context(db, setup, budget_id)
    drawn = layout_text(render_html(ctx))

    # persisted == API
    assert Decimal(api["total"]) == budget.total
    assert Decimal(api["subtotal"]) == budget.subtotal
    for api_line, row in zip(api["items"], budget.items, strict=True):
        assert Decimal(api_line["line_total"]) == row.line_total
        assert Decimal(api_line["line_discount"]) == row.line_discount
        assert Decimal(api_line["unit_price"]) == row.unit_price

    # API == the PDF's figures …
    assert ctx.figures.total == Decimal(api["total"])
    assert ctx.figures.subtotal == Decimal(api["subtotal"])
    for api_line, pdf_line in zip(api["items"], ctx.lines, strict=True):
        assert pdf_line.total == money(api_line["line_total"])
        assert pdf_line.unit_price == money(api_line["unit_price"])
        assert pdf_line.quantity == api_line["quantity"]

    # … and the PDF *draws* them.
    assert money(api["total"]) in drawn
    assert money(api["subtotal"]) in drawn
    for api_line in api["items"]:
        assert money(api_line["line_total"]) in drawn
        assert money(api_line["unit_price"]) in drawn
    return api, budget, ctx, drawn


@pytest.mark.asyncio
async def test_simple_line(client, auth_headers, db_session, pdf_setup):
    """Treatment A, quantity 1, price 100."""
    budget_id = await make_budget(
        client,
        auth_headers,
        pdf_setup,
        [{"catalog_item_id": pdf_setup["exempt"], "quantity": 1, "unit_price": "100"}],
    )
    api, budget, ctx, drawn = await assert_pdf_matches(
        client, auth_headers, db_session, pdf_setup, budget_id
    )
    assert budget.total == Decimal("100.00")
    assert ctx.lines[0].unit_price == money("100")
    assert ctx.lines[0].total == money("100")
    # Currency is the clinic's.
    assert "US$" in drawn or "$" in drawn


@pytest.mark.asyncio
async def test_quantity(client, auth_headers, db_session, pdf_setup):
    """Quantity 2 at 100: the line is 200."""
    budget_id = await make_budget(
        client,
        auth_headers,
        pdf_setup,
        [{"catalog_item_id": pdf_setup["exempt"], "quantity": 2, "unit_price": "100"}],
    )
    api, budget, ctx, _ = await assert_pdf_matches(
        client, auth_headers, db_session, pdf_setup, budget_id
    )
    assert ctx.lines[0].quantity == 2
    assert ctx.lines[0].unit_price == money("100")
    assert ctx.lines[0].total == money("200")
    assert budget.total == Decimal("200.00")


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("kind", "value", "expected_discount", "expected_total"),
    [("percentage", "10", "20.00", "180.00"), ("absolute", "30", "30.00", "170.00")],
)
async def test_line_discount(
    client, auth_headers, db_session, pdf_setup, kind, value, expected_discount, expected_total
):
    budget_id = await make_budget(
        client,
        auth_headers,
        pdf_setup,
        [
            {
                "catalog_item_id": pdf_setup["exempt"],
                "quantity": 2,
                "unit_price": "100",
                "discount_type": kind,
                "discount_value": value,
            }
        ],
    )
    _, budget, ctx, drawn = await assert_pdf_matches(
        client, auth_headers, db_session, pdf_setup, budget_id
    )
    assert ctx.lines[0].discount == money(expected_discount)
    assert ctx.lines[0].total == money(expected_total)
    assert money(expected_discount) in drawn
    assert ctx.figures.line_discounts == Decimal(expected_discount)
    assert ctx.figures.global_discount == Decimal("0.00")
    assert budget.total == Decimal(expected_total)


@pytest.mark.asyncio
@pytest.mark.parametrize(("kind", "value"), [("percentage", "10"), ("absolute", "25")])
async def test_global_discount_uses_the_pricing_helper(
    client, auth_headers, db_session, pdf_setup, kind, value
):
    budget_id = await make_budget(
        client,
        auth_headers,
        pdf_setup,
        [
            {"catalog_item_id": pdf_setup["taxed"], "quantity": 1, "unit_price": "100"},
            {"catalog_item_id": pdf_setup["exempt"], "quantity": 1, "unit_price": "50"},
        ],
        global_discount_type=kind,
        global_discount_value=value,
    )
    _, budget, ctx, drawn = await assert_pdf_matches(
        client, auth_headers, db_session, pdf_setup, budget_id
    )

    # The discount shown is exactly the sum of the helper's shares.
    shares = allocate_global_discount(kind, Decimal(value), list(budget.items))
    assert ctx.figures.global_discount == sum(shares, Decimal("0.00")).quantize(Decimal("0.01"))
    # The block closes on the persisted total.
    assert ctx.figures.taxable_base + ctx.figures.tax == ctx.figures.total == budget.total
    assert ctx.figures.subtotal - ctx.figures.line_discounts - ctx.figures.global_discount == (
        ctx.figures.taxable_base
    )
    labels = [row.key for row in ctx.totals]
    assert labels == ["subtotal", "global_discount", "taxable_base", "tax", "total"]


@pytest.mark.asyncio
async def test_vat_per_line_taxed_and_exempt(client, auth_headers, db_session, pdf_setup):
    budget_id = await make_budget(
        client,
        auth_headers,
        pdf_setup,
        [
            {"catalog_item_id": pdf_setup["taxed"], "quantity": 1, "unit_price": "100"},
            {"catalog_item_id": pdf_setup["exempt"], "quantity": 1, "unit_price": "50"},
        ],
    )
    _, budget, ctx, drawn = await assert_pdf_matches(
        client, auth_headers, db_session, pdf_setup, budget_id
    )
    taxed, exempt = ctx.lines
    assert taxed.vat_rate == "21 %"
    assert taxed.vat_amount == money("21")
    assert taxed.total == money("121")
    assert exempt.vat_rate is None
    assert exempt.vat_amount is None
    assert exempt.total == money("50")
    assert "21 %" in drawn
    assert ctx.figures.tax == Decimal("21.00")
    assert budget.total == Decimal("171.00")


@pytest.mark.asyncio
async def test_combined_lines_discounts_and_vat(client, auth_headers, db_session, pdf_setup):
    """Several lines + line discounts + a global discount + taxed and exempt lines."""
    budget_id = await make_budget(
        client,
        auth_headers,
        pdf_setup,
        [
            {
                "catalog_item_id": pdf_setup["taxed"],
                "quantity": 2,
                "unit_price": "100",
                "discount_type": "percentage",
                "discount_value": "10",
            },
            {
                "catalog_item_id": pdf_setup["taxed"],
                "quantity": 1,
                "unit_price": "33.33",
                "discount_type": "absolute",
                "discount_value": "3",
            },
            {"catalog_item_id": pdf_setup["exempt"], "quantity": 3, "unit_price": "50"},
        ],
        global_discount_type="percentage",
        global_discount_value="5",
    )
    api, budget, ctx, drawn = await assert_pdf_matches(
        client, auth_headers, db_session, pdf_setup, budget_id
    )
    f = ctx.figures
    assert f.total == budget.total
    assert f.taxable_base + f.tax == f.total
    assert f.subtotal == Decimal("383.33")
    assert f.line_discounts == Decimal("23.00")
    # The true VAT after every discount: never more than the line VATs summed.
    assert f.tax <= sum((i.line_tax for i in budget.items), Decimal("0")) + Decimal("0.02")
    for row in ctx.totals:
        assert row.value in drawn


@pytest.mark.asyncio
async def test_shown_total_is_budget_total_to_the_cent(client, auth_headers, db_session, pdf_setup):
    """Awkward cents: fractional prices, percentages and VAT."""
    budget_id = await make_budget(
        client,
        auth_headers,
        pdf_setup,
        [
            {
                "catalog_item_id": pdf_setup["taxed"],
                "quantity": 3,
                "unit_price": "33.33",
                "discount_type": "percentage",
                "discount_value": "15",
            },
            {
                "catalog_item_id": pdf_setup["taxed"],
                "quantity": 7,
                "unit_price": "12.34",
                "discount_type": "percentage",
                "discount_value": "7.5",
            },
            {"catalog_item_id": pdf_setup["exempt"], "quantity": 1, "unit_price": "0.99"},
        ],
        global_discount_type="percentage",
        global_discount_value="12.5",
    )
    _, budget, ctx, drawn = await assert_pdf_matches(
        client, auth_headers, db_session, pdf_setup, budget_id
    )
    assert ctx.figures.total == budget.total
    assert ctx.totals[-1].value == money(budget.total)
    assert ctx.totals[-1].value in drawn


# ===========================================================================
# treatments
# ===========================================================================


@pytest.mark.asyncio
async def test_treatment_name_tooth_surfaces_quantity_notes(
    client, auth_headers, db_session, pdf_setup
):
    budget_id = await make_budget(
        client,
        auth_headers,
        pdf_setup,
        [
            {
                "catalog_item_id": pdf_setup["taxed"],
                "quantity": 2,
                "tooth_number": 36,
                "surfaces": ["M", "O", "D"],
                "notes": "Dos visitas",
            }
        ],
    )
    _, _, ctx, drawn = await context_drawn(db_session, pdf_setup, budget_id)
    line = ctx.lines[0]
    assert line.description == "Empaste"
    assert line.tooth == "#36 (M, O, D)"
    assert line.quantity == 2
    assert line.notes == "Dos visitas"
    assert "Empaste" in drawn
    assert "#36 (M, O, D)" in drawn
    assert "Dos visitas" in drawn


async def context_drawn(db, setup, budget_id, **kw):
    budget, clinic, ctx = await context(db, setup, budget_id, **kw)
    return budget, clinic, ctx, layout_text(render_html(ctx))


@pytest.mark.asyncio
async def test_no_tooth_prints_none(client, auth_headers, db_session, pdf_setup):
    budget_id = await make_budget(
        client, auth_headers, pdf_setup, [{"catalog_item_id": pdf_setup["exempt"]}]
    )
    _, _, ctx, _ = await context_drawn(db_session, pdf_setup, budget_id)
    assert ctx.lines[0].tooth is None
    assert "#" not in render_html(ctx).split('<td class="description">')[1].split("</td>")[0]


@pytest.mark.asyncio
async def test_tooth_without_surfaces(client, auth_headers, db_session, pdf_setup):
    budget_id = await make_budget(
        client,
        auth_headers,
        pdf_setup,
        [{"catalog_item_id": pdf_setup["exempt"], "tooth_number": 16}],
    )
    _, _, ctx, _ = await context_drawn(db_session, pdf_setup, budget_id)
    assert ctx.lines[0].tooth == "#16"


@pytest.mark.asyncio
async def test_missing_translation_falls_back_down_the_billing_chain(
    client, auth_headers, db_session, pdf_setup
):
    budget_id = await make_budget(
        client,
        auth_headers,
        pdf_setup,
        [
            {"catalog_item_id": pdf_setup["odd"]},
            {"catalog_item_id": pdf_setup["nameless"]},
        ],
    )
    _, _, ctx, _ = await context_drawn(db_session, pdf_setup, budget_id)
    assert ctx.lines[0].description == "சிகிச்சை"  # the only name there is
    assert ctx.lines[1].description == ""  # none at all: empty, never a crash


@pytest.mark.asyncio
async def test_item_born_from_a_plan_prints_like_a_manual_one(
    client, auth_headers, db_session, pdf_setup
):
    """A plan item arrives through the same create_item path, with treatment_id.

    NOTE: ``treatment_plan`` sends only ``teeth[0]`` and its surfaces, so a
    multi-tooth treatment prints one tooth. Documented, out of scope here.
    """
    from app.modules.budget.service import BudgetItemService

    budget_id = await make_budget(client, auth_headers, pdf_setup, [])
    item = await BudgetItemService.create_item(
        db_session,
        pdf_setup["clinic_id"],
        UUID(budget_id),
        {
            "catalog_item_id": UUID(pdf_setup["taxed"]),
            "quantity": 1,
            "tooth_number": 46,
            "surfaces": ["O"],
            "treatment_id": None,
            "unit_price": Decimal("80.00"),
        },
    )
    budget = await db_session.get(
        type((await load(db_session, pdf_setup, budget_id))[0]), UUID(budget_id)
    )
    await BudgetService._recalculate_totals(db_session, budget)
    await db_session.commit()
    _, _, ctx, _ = await context_drawn(db_session, pdf_setup, budget_id)
    assert ctx.lines[0].tooth == "#46 (O)"
    assert ctx.lines[0].unit_price == money("80")
    assert item.line_total == Decimal("96.80")
    assert ctx.lines[0].total == money("96.80")


# ===========================================================================
# clinic identity
# ===========================================================================


@pytest.mark.asyncio
async def test_clinic_identity_is_printed(client, auth_headers, db_session, pdf_setup):
    budget_id = await make_budget(
        client, auth_headers, pdf_setup, [{"catalog_item_id": pdf_setup["exempt"]}]
    )
    _, _, ctx, drawn = await context_drawn(db_session, pdf_setup, budget_id)
    assert ctx.clinic.name == "Clínica Sonrisa"
    assert ctx.clinic.legal_name == "Sonrisa Dental S.L."
    assert ctx.clinic.tax_id == "B12345674"
    assert ctx.clinic.address == "Calle Mayor 1, 28013 Madrid, España"
    for text in (
        "Clínica Sonrisa",
        "Sonrisa Dental S.L.",
        "B12345674",
        "Calle Mayor 1, 28013 Madrid, España",
        "+34 911 000 111",
        "hola@sonrisa.test",
    ):
        assert text in drawn, text


@pytest.mark.asyncio
async def test_empty_clinic_fields_are_omitted_not_invented(
    client, auth_headers, db_session, pdf_setup
):
    clinic = await db_session.get(Clinic, pdf_setup["clinic_id"])
    clinic.legal_name = None
    clinic.phone = None
    clinic.email = "  "
    clinic.address = {}
    await db_session.commit()
    budget_id = await make_budget(
        client, auth_headers, pdf_setup, [{"catalog_item_id": pdf_setup["exempt"]}]
    )
    _, _, ctx, _ = await context_drawn(db_session, pdf_setup, budget_id)
    assert (ctx.clinic.legal_name, ctx.clinic.phone, ctx.clinic.email, ctx.clinic.address) == (
        None,
        None,
        None,
        None,
    )
    details = render_html(ctx).split('<div class="clinic-details">')[1].split("</div></div>")[0]
    assert "@" not in details and "|" not in details
    assert "None" not in render_html(ctx)


@pytest.mark.asyncio
async def test_legal_name_equal_to_name_is_not_repeated(
    client, auth_headers, db_session, pdf_setup
):
    clinic = await db_session.get(Clinic, pdf_setup["clinic_id"])
    clinic.legal_name = clinic.name
    await db_session.commit()
    budget_id = await make_budget(
        client, auth_headers, pdf_setup, [{"catalog_item_id": pdf_setup["exempt"]}]
    )
    _, _, ctx, _ = await context_drawn(db_session, pdf_setup, budget_id)
    # Name and legal name are the same: printed once, not twice.
    assert render_html(ctx).count("Clínica Sonrisa") == 1


@pytest.mark.asyncio
async def test_a_partial_clinic_is_refused(client, auth_headers, db_session, pdf_setup):
    """The raw-row clinic that once dropped ``currency`` fails loudly now."""
    from sqlalchemy import text

    budget_id = await make_budget(
        client, auth_headers, pdf_setup, [{"catalog_item_id": pdf_setup["exempt"]}]
    )
    budget, _ = await load(db_session, pdf_setup, budget_id)
    row = (
        await db_session.execute(
            text(
                "SELECT id, name, address, phone, email, settings, tax_id, legal_name FROM clinics WHERE id = :i"
            ),
            {"i": pdf_setup["clinic_id"]},
        )
    ).first()
    with pytest.raises(TypeError, match="Clinic entity"):
        await build_pdf_context(budget, row)


@pytest.mark.asyncio
async def test_currency_comes_from_the_clinic(client, auth_headers, db_session, pdf_setup):
    clinic = await db_session.get(Clinic, pdf_setup["clinic_id"])
    clinic.currency = "EUR"
    await db_session.commit()
    budget_id = await make_budget(
        client,
        auth_headers,
        pdf_setup,
        [{"catalog_item_id": pdf_setup["exempt"], "unit_price": "100"}],
    )
    _, _, ctx, drawn = await context_drawn(db_session, pdf_setup, budget_id)
    assert ctx.lines[0].total == format_currency(Decimal("100"), "EUR", locale="es_ES")
    assert "€" in drawn


# ===========================================================================
# escaping
# ===========================================================================


@pytest.mark.asyncio
async def test_every_database_string_is_escaped(client, auth_headers, db_session, pdf_setup):
    evil = "<script>alert(1)</script><img src=x onerror=alert(2)>"
    clinic = await db_session.get(Clinic, pdf_setup["clinic_id"])
    clinic.name = f"Sonrisa {evil}"
    clinic.legal_name = f"Legal {evil}"
    clinic.tax_id = f"B1{evil}"[:20]
    clinic.phone = evil[:20]
    clinic.email = evil
    clinic.address = {"street": evil, "city": evil}
    patient = await db_session.get(Patient, UUID(pdf_setup["patient_id"]))
    patient.first_name = evil
    await db_session.commit()
    budget_id = await make_budget(
        client,
        auth_headers,
        pdf_setup,
        [
            {
                "catalog_item_id": pdf_setup["exempt"],
                "notes": evil,
                "surfaces": [evil],
                "tooth_number": 11,
            }
        ],
        patient_notes=evil,
    )
    _, _, ctx, _ = await context_drawn(db_session, pdf_setup, budget_id)
    html_out = render_html(ctx)
    assert "<script>" not in html_out
    assert "<img src=x" not in html_out
    assert "&lt;script&gt;" in html_out
    assert html_out.count("<img") == 0  # no logo set: the only <img> would be injected


# ===========================================================================
# logo in the PDF
# ===========================================================================


@pytest.mark.asyncio
async def test_pdf_has_no_image_without_a_logo(client, auth_headers, db_session, pdf_setup):
    budget_id = await make_budget(
        client, auth_headers, pdf_setup, [{"catalog_item_id": pdf_setup["exempt"]}]
    )
    _, clinic, ctx, _ = await context_drawn(db_session, pdf_setup, budget_id)
    assert ctx.clinic.logo is None
    assert "clinic-logo" not in render_html(ctx).split("</style>")[1]
    pdf = await BudgetPDFService.generate_pdf(*(await load(db_session, pdf_setup, budget_id)))
    assert b"/Subtype /Image" not in pdf


@pytest.mark.asyncio
async def test_pdf_contains_the_logo(client, auth_headers, db_session, pdf_setup):
    clinic = await db_session.get(Clinic, pdf_setup["clinic_id"])
    await save_logo(clinic, png(600, 240))
    await db_session.commit()
    budget_id = await make_budget(
        client, auth_headers, pdf_setup, [{"catalog_item_id": pdf_setup["exempt"]}]
    )
    budget, clinic = await load(db_session, pdf_setup, budget_id)
    ctx = await build_pdf_context(budget, clinic)
    assert ctx.clinic.logo.startswith("data:image/png;base64,")
    assert '<img class="clinic-logo"' in render_html(ctx)
    pdf = await BudgetPDFService.generate_pdf(budget, clinic)
    assert b"/Subtype /Image" in pdf


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("size", "fits"), [((600, 240), "height"), ((1000, 100), "width"), ((100, 100), "height")]
)
async def test_logo_is_boxed_without_distortion(
    client, auth_headers, db_session, pdf_setup, size, fits
):
    """Fits in 50 × 20 mm and keeps the image's own proportions."""
    from weasyprint import HTML
    from weasyprint.formatting_structure import boxes

    clinic = await db_session.get(Clinic, pdf_setup["clinic_id"])
    await save_logo(clinic, png(*size))
    await db_session.commit()
    budget_id = await make_budget(
        client, auth_headers, pdf_setup, [{"catalog_item_id": pdf_setup["exempt"]}]
    )
    budget, clinic = await load(db_session, pdf_setup, budget_id)
    html_out = render_html(await build_pdf_context(budget, clinic))

    document = HTML(string=html_out).render()
    images = [
        b
        for page in document.pages
        for b in page._page_box.descendants()
        if isinstance(b, boxes.ReplacedBox)
    ]
    assert len(images) == 1
    box = images[0]
    px_per_mm = 96 / 25.4
    assert box.width <= 50 * px_per_mm + 0.5
    assert box.height <= 20 * px_per_mm + 0.5
    assert box.width / box.height == pytest.approx(size[0] / size[1], rel=0.02)
    # The limit that bites is the one the shape says it should.
    if fits == "height":
        assert box.height == pytest.approx(20 * px_per_mm, abs=1) or box.width < 50 * px_per_mm
    else:
        assert box.width == pytest.approx(50 * px_per_mm, abs=1)


@pytest.mark.asyncio
async def test_a_missing_logo_file_still_renders(client, auth_headers, db_session, pdf_setup):
    from app.core.clinic_branding import read_logo_reference
    from app.core.storage import get_storage_backend

    clinic = await db_session.get(Clinic, pdf_setup["clinic_id"])
    await save_logo(clinic, png(300, 120))
    await db_session.commit()
    await get_storage_backend().delete(read_logo_reference(clinic)["path"])
    budget_id = await make_budget(
        client, auth_headers, pdf_setup, [{"catalog_item_id": pdf_setup["exempt"]}]
    )
    _, _, ctx, _ = await context_drawn(db_session, pdf_setup, budget_id)
    assert ctx.clinic.logo is None


def test_compute_figures_is_the_pricing_helper_and_nothing_else():
    """No second proration formula in the PDF module."""
    import inspect

    import app.modules.budget.pdf as pdf_module

    source = inspect.getsource(pdf_module)
    assert "allocate_global_discount(" in source
    # The proration formulas (percentage share, gross→net division) are not here.
    assert "/ items_total" not in source
    assert "1 + Decimal(str(i.vat_rate)" not in source
    assert compute_figures is pdf_module.compute_figures
