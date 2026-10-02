"""Budget PDF generation.

Three steps, kept apart on purpose so a template can be replaced without
touching a financial rule:

1. :func:`build_pdf_context` turns a ``Budget`` + ``Clinic`` into a
   :class:`BudgetPDFContext`: every figure and every piece of text the document
   shows, already derived and formatted. **All the rules live here** — which
   amount a column shows, how the global discount is spread, what the totals
   block adds up to.
2. :func:`render_html` turns the context into HTML. It does presentation only:
   it never calls a service, never does arithmetic and never reads a model.
   It is the part a client-supplied template replaces.
3. WeasyPrint turns the HTML into bytes.

## Money

Nothing is recomputed from scratch. Line amounts and the budget total are the
persisted ones (``BudgetItem.line_*``, ``Budget.total``), and the global
discount is spread over the lines by :func:`pricing.allocate_global_discount`,
the only place that formula lives. The totals block is *derived for display*
from those: ``Subtotal − line discounts − global discount = Taxable base`` and
``Taxable base + VAT = Total``, with VAT taken as the remainder so the block
always adds up and its total is **exactly** ``budget.total``.

## Text

Every string that comes from the database is HTML-escaped when the HTML is
built. Labels are ours and are not.
"""

from __future__ import annotations

import asyncio
import hashlib
import html
import logging
import re
from dataclasses import dataclass, field
from datetime import datetime
from decimal import Decimal
from io import BytesIO
from typing import TYPE_CHECKING

from app.core.auth.models import Clinic
from app.core.clinic_branding import logo_data_uri
from app.core.utils.currency import format_currency as _fmt_currency

from .models import Budget, BudgetSignature
from .pricing import CENT, allocate_global_discount

if TYPE_CHECKING:
    from .models import BudgetItem

logger = logging.getLogger(__name__)

_LOCALE_BY_LANG = {"es": "es_ES", "en": "en_US"}

#: Catalog-name fallback order — the same one billing uses for invoice lines.
_NAME_FALLBACK = ("es", "en", "fr", "pt", "ta")

#: A drawn signature is stored as a data URI; only a plain image one is embedded.
_SAFE_IMAGE_URI = re.compile(r"^data:image/(?:png|jpeg|webp);base64,[A-Za-z0-9+/=]+$")


# ===========================================================================
# the context
# ===========================================================================


@dataclass(frozen=True)
class PDFClinic:
    """The clinic's identity, as printed. A missing field is ``None`` and is omitted."""

    name: str
    legal_name: str | None
    tax_id: str | None
    address: str | None
    phone: str | None
    email: str | None
    #: ``data:`` URI of the logo, or ``None``.
    logo: str | None


@dataclass(frozen=True)
class PDFLine:
    number: int
    description: str
    tooth: str | None
    notes: str | None
    quantity: int
    unit_price: str
    discount: str | None
    vat_rate: str | None
    vat_amount: str | None
    #: The line's total, VAT included (``BudgetItem.line_total``).
    total: str


@dataclass(frozen=True)
class PDFTotalRow:
    key: str
    label: str
    value: str
    emphasis: bool = False
    is_discount: bool = False


@dataclass(frozen=True)
class PDFFigures:
    """The amounts behind the totals block, unformatted (for checks, not drawing)."""

    subtotal: Decimal
    line_discounts: Decimal
    global_discount: Decimal
    taxable_base: Decimal
    tax: Decimal
    total: Decimal


@dataclass(frozen=True)
class PDFSignature:
    signed_by_name: str
    signed_at: str
    method_label: str
    #: A validated image ``data:`` URI, or ``None`` (typed name shown instead).
    image: str | None


@dataclass(frozen=True)
class BudgetPDFContext:
    locale: str
    labels: dict
    title: str
    budget_number: str
    version: int
    date: str
    status: str
    status_label: str
    watermark: str | None
    clinic: PDFClinic
    patient_name: str
    professional_name: str | None
    lines: list[PDFLine]
    totals: list[PDFTotalRow]
    figures: PDFFigures
    valid_from: str
    valid_until: str
    patient_notes: str | None
    signature: PDFSignature | None
    footer: str
    extra: dict = field(default_factory=dict)


def _money(amount: Decimal, currency: str, money_locale: str) -> str:
    return _fmt_currency(Decimal(str(amount)).quantize(CENT), currency, locale=money_locale)


def _format_address(address: dict | None) -> str | None:
    """Format an address dict as one line, or ``None`` when there is nothing to print."""
    if not address:
        return None
    parts = []
    if address.get("street"):
        parts.append(str(address["street"]))
    city_line = " ".join(filter(None, [address.get("postal_code"), address.get("city")]))
    if city_line:
        parts.append(city_line)
    if address.get("country"):
        parts.append(str(address["country"]))
    return ", ".join(parts) or None


def _item_name(item: BudgetItem, locale: str) -> str:
    names = item.catalog_item.names if item.catalog_item and item.catalog_item.names else {}
    for code in (locale, *_NAME_FALLBACK):
        if names.get(code):
            return str(names[code])
    return next((str(v) for v in names.values() if v), "")


def _tooth_text(item: BudgetItem) -> str | None:
    if not item.tooth_number:
        return None
    text = f"#{item.tooth_number}"
    if item.surfaces:
        text += f" ({', '.join(str(s) for s in item.surfaces)})"
    return text


def _clean(value: str | None) -> str | None:
    value = (value or "").strip()
    return value or None


def compute_figures(budget: Budget) -> PDFFigures:
    """The amounts of the totals block. See the module docstring.

    The global discount is spread by ``allocate_global_discount`` — never by a
    formula of this module. VAT is the remainder to ``budget.total``, so the
    block closes on the persisted total to the cent.
    """
    items = list(budget.items)
    shares = allocate_global_discount(
        budget.global_discount_type, budget.global_discount_value, items
    )
    subtotal = sum((Decimal(str(i.line_subtotal)) for i in items), Decimal("0.00"))
    line_discounts = sum((Decimal(str(i.line_discount)) for i in items), Decimal("0.00"))
    global_discount = sum(shares, Decimal("0.00"))
    taxable_base = (subtotal - line_discounts - global_discount).quantize(CENT)
    total = Decimal(str(budget.total)).quantize(CENT)
    return PDFFigures(
        subtotal=subtotal.quantize(CENT),
        line_discounts=line_discounts.quantize(CENT),
        global_discount=global_discount.quantize(CENT),
        taxable_base=taxable_base,
        tax=(total - taxable_base).quantize(CENT),
        total=total,
    )


async def build_pdf_context(
    budget: Budget,
    clinic: Clinic,
    *,
    is_preview: bool = False,
    locale: str = "es",
    signature: BudgetSignature | None = None,
) -> BudgetPDFContext:
    """Everything the document shows, derived and formatted. No HTML here."""
    # A partial stand-in (a raw SQL row, say) is how ``currency`` once went
    # missing; refuse it loudly instead of failing deep inside a render.
    if not isinstance(clinic, Clinic):
        raise TypeError(f"The budget PDF needs a Clinic entity, got {type(clinic).__name__}")

    labels = _get_labels(locale)
    money_locale = _LOCALE_BY_LANG.get(locale, "es_ES")

    def money(amount: Decimal) -> str:
        return _money(amount, clinic.currency, money_locale)

    # -- lines ---------------------------------------------------------------
    lines: list[PDFLine] = []
    for number, item in enumerate(budget.items, 1):
        rate = Decimal(str(item.vat_rate or 0))
        has_vat = rate != 0
        lines.append(
            PDFLine(
                number=number,
                description=_item_name(item, locale),
                tooth=_tooth_text(item),
                notes=_clean(item.notes),
                quantity=item.quantity,
                unit_price=money(item.unit_price),
                discount=money(item.line_discount) if item.line_discount else None,
                vat_rate=f"{rate.normalize():f} %" if has_vat else None,
                vat_amount=money(item.line_tax) if has_vat else None,
                total=money(item.line_total),
            )
        )

    # -- totals --------------------------------------------------------------
    figures = compute_figures(budget)
    totals = [PDFTotalRow("subtotal", labels["subtotal"], money(figures.subtotal))]
    if figures.line_discounts:
        totals.append(
            PDFTotalRow(
                "line_discounts",
                labels["line_discounts"],
                f"-{money(figures.line_discounts)}",
                is_discount=True,
            )
        )
    if figures.global_discount:
        label = labels["global_discount"]
        if budget.global_discount_type == "percentage" and budget.global_discount_value:
            label = f"{label} ({Decimal(str(budget.global_discount_value)).normalize():f} %)"
        totals.append(
            PDFTotalRow(
                "global_discount", label, f"-{money(figures.global_discount)}", is_discount=True
            )
        )
    if figures.line_discounts or figures.global_discount:
        totals.append(
            PDFTotalRow("taxable_base", labels["taxable_base"], money(figures.taxable_base))
        )
    if figures.tax or any(Decimal(str(i.vat_rate or 0)) != 0 for i in budget.items):
        totals.append(PDFTotalRow("tax", labels["tax"], money(figures.tax)))
    totals.append(PDFTotalRow("total", labels["grand_total"], money(figures.total), emphasis=True))

    # -- people --------------------------------------------------------------
    patient_name = ""
    if budget.patient:
        patient_name = f"{budget.patient.first_name} {budget.patient.last_name}".strip()
    professional_name = None
    if budget.assigned_professional:
        professional_name = (
            f"{budget.assigned_professional.first_name} {budget.assigned_professional.last_name}"
        ).strip() or None

    # -- signature -----------------------------------------------------------
    pdf_signature = None
    if signature is not None:
        data = signature.signature_data if isinstance(signature.signature_data, dict) else {}
        raw_png = data.get("png")
        method_key = signature.signature_method or "click_accept"
        pdf_signature = PDFSignature(
            signed_by_name=signature.signed_by_name,
            signed_at=signature.signed_at.strftime("%d/%m/%Y %H:%M")
            if signature.signed_at
            else "—",
            method_label=labels.get(
                f"signature_method_{method_key}",
                labels.get("signature_method_click_accept", method_key),
            ),
            image=raw_png if isinstance(raw_png, str) and _SAFE_IMAGE_URI.match(raw_png) else None,
        )

    # A signed document is a fixed record: its footer carries the moment it was
    # signed, not "now", so rendering it again says the same thing.
    if signature is not None and signature.signed_at:
        stamp = signature.signed_at.strftime("%d/%m/%Y %H:%M")
    else:
        stamp = datetime.now().strftime("%d/%m/%Y %H:%M")

    watermark = labels["draft"] if (is_preview or budget.status == "draft") else None

    return BudgetPDFContext(
        locale=locale,
        labels=labels,
        title=f"{labels['budget']} {budget.budget_number}",
        budget_number=budget.budget_number,
        version=budget.version,
        date=budget.created_at.strftime("%d/%m/%Y"),
        status=budget.status,
        status_label=labels["status"].get(budget.status, budget.status),
        watermark=watermark,
        clinic=PDFClinic(
            name=_clean(clinic.name) or "Dental Clinic",
            legal_name=_clean(clinic.legal_name),
            tax_id=_clean(clinic.tax_id),
            address=_format_address(clinic.address),
            phone=_clean(clinic.phone),
            email=_clean(clinic.email),
            logo=await logo_data_uri(clinic),
        ),
        patient_name=patient_name,
        professional_name=professional_name,
        lines=lines,
        totals=totals,
        figures=figures,
        valid_from=budget.valid_from.strftime("%d/%m/%Y") if budget.valid_from else "-",
        valid_until=(
            budget.valid_until.strftime("%d/%m/%Y") if budget.valid_until else labels["no_expiry"]
        ),
        patient_notes=_clean(budget.patient_notes),
        signature=pdf_signature,
        footer=f"{labels['generated_by']} Denplant | {stamp}",
    )


# ===========================================================================
# the template
# ===========================================================================

_E = html.escape


def _render_clinic_header(clinic: PDFClinic, labels: dict) -> str:
    rows = []
    if clinic.legal_name and clinic.legal_name != clinic.name:
        rows.append(f"<div>{_E(clinic.legal_name)}</div>")
    if clinic.tax_id:
        rows.append(f"<div>{_E(labels['tax_id'])}: {_E(clinic.tax_id)}</div>")
    if clinic.address:
        rows.append(f"<div>{_E(clinic.address)}</div>")
    contact = " | ".join(filter(None, [clinic.phone, clinic.email]))
    if contact:
        rows.append(f"<div>{_E(contact)}</div>")
    logo = (
        f'<img class="clinic-logo" src="{_E(clinic.logo, quote=True)}" alt="">'
        if clinic.logo
        else ""
    )
    return f"""
                <div class="clinic-info">
                    {logo}
                    <div class="clinic-name">{_E(clinic.name)}</div>
                    <div class="clinic-details">{"".join(rows)}</div>
                </div>"""


def _render_lines(ctx: BudgetPDFContext) -> str:
    out = []
    for line in ctx.lines:
        tooth = f'<br><small class="tooth">{_E(line.tooth)}</small>' if line.tooth else ""
        notes = f'<br><small class="notes">{_E(line.notes)}</small>' if line.notes else ""
        discount = _E(line.discount) if line.discount else "-"
        if line.vat_rate:
            vat = f'{_E(line.vat_rate)}<br><small class="tooth">{_E(line.vat_amount or "")}</small>'
        else:
            vat = "-"
        out.append(
            f"""
            <tr>
                <td class="number">{line.number}</td>
                <td class="description">{_E(line.description)}{tooth}{notes}</td>
                <td class="quantity">{line.quantity}</td>
                <td class="price">{_E(line.unit_price)}</td>
                <td class="discount">{discount}</td>
                <td class="vat">{vat}</td>
                <td class="total">{_E(line.total)}</td>
            </tr>"""
        )
    return "".join(out)


def _render_totals(ctx: BudgetPDFContext) -> str:
    rows = []
    for row in ctx.totals:
        cls = "grand-total" if row.emphasis else ("discount" if row.is_discount else "")
        rows.append(
            f"""
                        <tr>
                            <td class="label {cls}">{_E(row.label)}:</td>
                            <td class="value {cls}">{_E(row.value)}</td>
                        </tr>"""
        )
    return "".join(rows)


def _render_signature(ctx: BudgetPDFContext) -> str:
    labels = ctx.labels
    sig = ctx.signature
    if sig is None:
        return f"""
            <div class="signature-section">
                <div class="signature-box">
                    <div class="signature-line"></div>
                    <div class="signature-label">{_E(labels["patient_signature"])}</div>
                </div>
                <div class="signature-box">
                    <div class="signature-line"></div>
                    <div class="signature-label">{_E(labels["clinic_signature"])}</div>
                </div>
            </div>
            """
    visual = (
        f'<img src="{_E(sig.image, quote=True)}" alt="" style="max-width: 100%; max-height: 80px;" />'
        if sig.image
        else '<div style="font-family: cursive; font-size: 14pt; '
        f'padding: 18px 0 4px; border-bottom: 1px solid #333;">{_E(sig.signed_by_name)}</div>'
    )
    # The SHA-256 of this file is evidence kept *outside* it (on the signature
    # record): a document cannot contain its own hash. It is said here, not shown.
    return f"""
        <div class="signature-section">
            <div class="signature-box signature-box-signed">
                <div class="signature-line">{visual}</div>
                <div class="signature-label">{_E(labels["patient_signature"])}</div>
                <div class="signature-meta">
                    <div><strong>{_E(labels["signed_by"])}:</strong> {_E(sig.signed_by_name)}</div>
                    <div><strong>{_E(labels["signed_at"])}:</strong> {_E(sig.signed_at)}</div>
                    <div><strong>{_E(labels["signature_method"])}:</strong> {_E(sig.method_label)}</div>
                    <div class="signature-hash">{_E(labels["document_hash_note"])}</div>
                </div>
            </div>
            <div class="signature-box">
                <div class="signature-line"></div>
                <div class="signature-label">{_E(labels["clinic_signature"])}</div>
            </div>
        </div>
        """


_CSS = """
                * { margin: 0; padding: 0; box-sizing: border-box; }
                body {
                    font-family: 'Helvetica Neue', Arial, sans-serif;
                    font-size: 11pt;
                    line-height: 1.4;
                    color: #333;
                    padding: 20mm;
                }
                .watermark {
                    position: fixed;
                    top: 50%;
                    left: 50%;
                    transform: translate(-50%, -50%) rotate(-45deg);
                    font-size: 120px;
                    color: rgba(200, 200, 200, 0.3);
                    z-index: 1000;
                    pointer-events: none;
                }
                .header {
                    display: flex;
                    justify-content: space-between;
                    margin-bottom: 30px;
                    padding-bottom: 20px;
                    border-bottom: 2px solid #2563eb;
                }
                .clinic-info { max-width: 60%; }
                /* The logo's box: never wider than 50 mm or taller than 20 mm,
                   proportions kept (width/height stay auto), never stretched. */
                .clinic-logo {
                    display: block;
                    max-width: 50mm;
                    max-height: 20mm;
                    width: auto;
                    height: auto;
                    object-fit: contain;
                    margin-bottom: 4mm;
                }
                .clinic-name { font-size: 18pt; font-weight: bold; color: #1e40af; margin-bottom: 5px; }
                .clinic-details { font-size: 9pt; color: #666; }
                .budget-info { text-align: right; }
                .budget-number { font-size: 14pt; font-weight: bold; color: #1e40af; }
                .budget-meta { font-size: 9pt; color: #666; margin-top: 5px; }
                .status-badge {
                    display: inline-block;
                    padding: 3px 10px;
                    border-radius: 12px;
                    font-size: 9pt;
                    font-weight: bold;
                    text-transform: uppercase;
                    margin-top: 8px;
                }
                .status-draft { background: #e5e7eb; color: #374151; }
                .status-sent { background: #dbeafe; color: #1e40af; }
                .status-accepted { background: #d1fae5; color: #065f46; }
                .status-rejected { background: #fee2e2; color: #991b1b; }
                .status-expired { background: #fef3c7; color: #92400e; }

                .section { margin-bottom: 25px; }
                .section-title {
                    font-size: 11pt;
                    font-weight: bold;
                    color: #1e40af;
                    margin-bottom: 10px;
                    padding-bottom: 5px;
                    border-bottom: 1px solid #e5e7eb;
                }
                .patient-info { display: flex; gap: 40px; }
                .info-group { min-width: 200px; }
                .info-label { font-size: 9pt; color: #666; margin-bottom: 2px; }
                .info-value { font-weight: 500; }

                table { width: 100%; border-collapse: collapse; margin-bottom: 20px; }
                th {
                    background: #f3f4f6;
                    padding: 10px 8px;
                    text-align: left;
                    font-size: 9pt;
                    font-weight: 600;
                    color: #374151;
                    border-bottom: 2px solid #e5e7eb;
                }
                td { padding: 10px 8px; border-bottom: 1px solid #e5e7eb; vertical-align: top; }
                tr:last-child td { border-bottom: none; }
                .number { width: 26px; text-align: center; }
                .description { width: auto; }
                .quantity { width: 44px; text-align: center; }
                .price { width: 82px; text-align: right; }
                .discount { width: 78px; text-align: right; color: #059669; }
                .vat { width: 66px; text-align: right; }
                .total { width: 90px; text-align: right; font-weight: 500; }
                .tooth { color: #6b7280; }
                .notes { color: #9ca3af; font-style: italic; }

                .totals { float: right; width: 320px; margin-top: 20px; }
                .totals table { margin-bottom: 0; }
                .totals td { padding: 6px 8px; border-bottom: none; }
                .totals .label { text-align: left; color: #666; }
                .totals .value { text-align: right; font-weight: 500; }
                .totals .discount { color: #059669; }
                .totals .grand-total {
                    font-size: 14pt;
                    font-weight: bold;
                    color: #1e40af;
                    border-top: 2px solid #1e40af;
                    padding-top: 10px;
                }

                .notes-section { clear: both; padding-top: 30px; margin-top: 30px; border-top: 1px solid #e5e7eb; }
                .notes-content {
                    background: #f9fafb;
                    padding: 15px;
                    border-radius: 8px;
                    font-size: 10pt;
                    color: #4b5563;
                    white-space: pre-wrap;
                }
                .validity {
                    margin-top: 20px;
                    padding: 15px;
                    background: #eff6ff;
                    border-radius: 8px;
                    font-size: 10pt;
                }
                .validity strong { color: #1e40af; }

                .signature-section { margin-top: 40px; padding-top: 20px; }
                .signature-box { display: inline-block; width: 45%; margin-right: 5%; vertical-align: top; }
                .signature-line {
                    border-bottom: 1px solid #333;
                    height: 80px;
                    margin-bottom: 5px;
                    display: flex;
                    align-items: flex-end;
                    justify-content: center;
                }
                .signature-label { font-size: 9pt; color: #666; }
                .signature-meta { margin-top: 10px; font-size: 8pt; color: #475569; line-height: 1.5; }
                .signature-meta strong { color: #0f172a; }
                .signature-hash { font-size: 7pt; color: #64748b; }

                .footer {
                    position: fixed;
                    bottom: 15mm;
                    left: 20mm;
                    right: 20mm;
                    font-size: 8pt;
                    color: #9ca3af;
                    text-align: center;
                    border-top: 1px solid #e5e7eb;
                    padding-top: 10px;
                }
                @media print { body { padding: 0; } .footer { position: fixed; } }
"""


def render_html(ctx: BudgetPDFContext) -> str:
    """The document's HTML. Presentation only — see the module docstring."""
    labels = ctx.labels
    watermark = f'<div class="watermark">{_E(ctx.watermark)}</div>' if ctx.watermark else ""
    professional = (
        f"""
                    <div class="info-group">
                        <div class="info-label">{_E(labels["professional"])}</div>
                        <div class="info-value">{_E(ctx.professional_name)}</div>
                    </div>"""
        if ctx.professional_name
        else ""
    )
    notes = (
        f"""
            <div class="notes-section">
                <div class="section-title">{_E(labels["notes"])}</div>
                <div class="notes-content">{_E(ctx.patient_notes)}</div>
            </div>"""
        if ctx.patient_notes
        else ""
    )
    return f"""<!DOCTYPE html>
        <html lang="{_E(ctx.locale)}">
        <head>
            <meta charset="UTF-8">
            <title>{_E(ctx.title)}</title>
            <style>{_CSS}</style>
        </head>
        <body>
            {watermark}

            <div class="header">{_render_clinic_header(ctx.clinic, labels)}
                <div class="budget-info">
                    <div class="budget-number">{_E(ctx.title)}</div>
                    <div class="budget-meta">
                        {_E(labels["version"])}: {ctx.version}<br>
                        {_E(labels["date"])}: {_E(ctx.date)}
                    </div>
                    <span class="status-badge status-{_E(ctx.status)}">{_E(ctx.status_label)}</span>
                </div>
            </div>

            <div class="section">
                <div class="section-title">{_E(labels["patient_info"])}</div>
                <div class="patient-info">
                    <div class="info-group">
                        <div class="info-label">{_E(labels["patient"])}</div>
                        <div class="info-value">{_E(ctx.patient_name)}</div>
                    </div>{professional}
                </div>
            </div>

            <div class="section">
                <div class="section-title">{_E(labels["treatments"])}</div>
                <table>
                    <thead>
                        <tr>
                            <th class="number">#</th>
                            <th class="description">{_E(labels["description"])}</th>
                            <th class="quantity">{_E(labels["qty"])}</th>
                            <th class="price">{_E(labels["unit_price"])}</th>
                            <th class="discount">{_E(labels["discount"])}</th>
                            <th class="vat">{_E(labels["vat_column"])}</th>
                            <th class="total">{_E(labels["line_total"])}</th>
                        </tr>
                    </thead>
                    <tbody>{_render_lines(ctx)}
                    </tbody>
                </table>

                <div class="totals">
                    <table>{_render_totals(ctx)}
                    </table>
                </div>
            </div>

            <div class="validity">
                <strong>{_E(labels["validity"])}:</strong>
                {_E(labels["from"])} {_E(ctx.valid_from)} {_E(labels["until"])} {_E(ctx.valid_until)}
            </div>
            {notes}

            {_render_signature(ctx)}

            <div class="footer">{_E(ctx.footer)}</div>
        </body>
        </html>
        """


# ===========================================================================
# the service
# ===========================================================================


class BudgetPDFService:
    """Generates budget PDFs. Takes a ``Clinic`` entity, always."""

    @staticmethod
    async def generate_pdf(
        budget: Budget,
        clinic: Clinic,
        is_preview: bool = False,
        locale: str = "es",
        signature: BudgetSignature | None = None,
    ) -> bytes:
        """Generate the PDF for a budget.

        Args:
            budget: The budget (items, patient and professional loaded).
            clinic: The clinic entity — its identity, logo and currency.
            is_preview: Adds the DRAFT watermark.
            locale: Language of the labels (es/en).
            signature: When given, the signature block shows the signer's
                data. The SHA-256 is **not** printed inside the file; it is
                evidence kept on the signature record.
        """
        context = await build_pdf_context(
            budget, clinic, is_preview=is_preview, locale=locale, signature=signature
        )
        html_content = render_html(context)
        # WeasyPrint is CPU-bound; offload to a thread so the event
        # loop keeps serving other requests while it renders.
        return await asyncio.to_thread(BudgetPDFService._html_to_pdf, html_content)

    @staticmethod
    def generate_pdf_hash(pdf_bytes: bytes) -> str:
        """SHA-256 of PDF content, for signature evidence."""
        return hashlib.sha256(pdf_bytes).hexdigest()

    @staticmethod
    def _html_to_pdf(html_content: str) -> bytes:
        """Convert HTML to PDF (WeasyPrint; the HTML itself if it is missing)."""
        try:
            from weasyprint import HTML

            pdf_buffer = BytesIO()
            HTML(string=html_content).write_pdf(pdf_buffer)
            return pdf_buffer.getvalue()
        except ImportError:
            # In production WeasyPrint should be installed.
            return html_content.encode("utf-8")


# ===========================================================================
# labels
# ===========================================================================


def _get_labels(locale: str) -> dict:
    """Localized labels for the PDF."""
    labels_es = {
        "budget": "Presupuesto",
        "version": "Versión",
        "date": "Fecha",
        "draft": "BORRADOR",
        "patient_info": "Información del Paciente",
        "patient": "Paciente",
        "professional": "Profesional",
        "treatments": "Tratamientos",
        "description": "Descripción",
        "qty": "Cant.",
        "unit_price": "Precio Unit.",
        "discount": "Descuento",
        "vat_column": "IVA",
        "line_total": "Total (IVA incl.)",
        "total": "Total",
        "subtotal": "Subtotal",
        "line_discounts": "Descuentos de línea",
        "global_discount": "Descuento global",
        "taxable_base": "Base imponible",
        "tax": "IVA",
        "grand_total": "TOTAL",
        "tax_id": "NIF/RUC",
        "validity": "Validez",
        "from": "desde",
        "until": "hasta",
        "no_expiry": "sin fecha de caducidad",
        "notes": "Observaciones",
        "patient_signature": "Firma del Paciente",
        "clinic_signature": "Firma de la Clínica",
        "signed_by": "Firmado por",
        "signed_at": "Fecha de firma",
        "signature_method": "Canal",
        "signature_method_drawn": "Firma manuscrita",
        "signature_method_click_accept": "Aceptación digital",
        "signature_method_external": "Firma externa",
        "document_hash_note": "La huella SHA-256 de este documento se conserva en el registro de la firma, fuera del archivo.",
        "generated_by": "Generado por",
        "status": {
            "draft": "Borrador",
            "sent": "Enviado",
            "accepted": "Aceptado",
            "in_progress": "En Progreso",
            "completed": "Completado",
            "invoiced": "Facturado",
            "rejected": "Rechazado",
            "expired": "Caducado",
            "cancelled": "Cancelado",
        },
    }

    labels_en = {
        "budget": "Quote",
        "version": "Version",
        "date": "Date",
        "draft": "DRAFT",
        "patient_info": "Patient Information",
        "patient": "Patient",
        "professional": "Professional",
        "treatments": "Treatments",
        "description": "Description",
        "qty": "Qty",
        "unit_price": "Unit Price",
        "discount": "Discount",
        "vat_column": "VAT",
        "line_total": "Total (VAT incl.)",
        "total": "Total",
        "subtotal": "Subtotal",
        "line_discounts": "Line discounts",
        "global_discount": "Global discount",
        "taxable_base": "Taxable base",
        "tax": "VAT",
        "grand_total": "TOTAL",
        "tax_id": "Tax ID",
        "validity": "Validity",
        "from": "from",
        "until": "until",
        "no_expiry": "no expiry date",
        "notes": "Notes",
        "patient_signature": "Patient Signature",
        "clinic_signature": "Clinic Signature",
        "signed_by": "Signed by",
        "signed_at": "Signed on",
        "signature_method": "Channel",
        "signature_method_drawn": "Handwritten signature",
        "signature_method_click_accept": "Digital acceptance",
        "signature_method_external": "External signature",
        "document_hash_note": "The SHA-256 fingerprint of this document is kept on the signature record, outside the file.",
        "generated_by": "Generated by",
        "status": {
            "draft": "Draft",
            "sent": "Sent",
            "accepted": "Accepted",
            "in_progress": "In Progress",
            "completed": "Completed",
            "invoiced": "Invoiced",
            "rejected": "Rejected",
            "expired": "Expired",
            "cancelled": "Cancelled",
        },
    }

    return labels_es if locale == "es" else labels_en
