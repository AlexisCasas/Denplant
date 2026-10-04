"""Prescription PDF — an A4 sheet for printing and handwritten signature.

Three steps, the same shape as the budget PDF, kept apart on purpose:

1. :func:`build_pdf_context` turns a ``Prescription`` into every piece of text
   the document shows. **Pure and synchronous**: it receives the prescription
   (with its items), the already-resolved logo and a locale, and nothing else.
   It cannot reach a patient, a user or a clinic, so it cannot rebuild an
   identity from live data.
2. :func:`render_html` is presentation only.
3. WeasyPrint turns the HTML into bytes, in a worker thread.

## What is frozen and what is not

Every name, number and address on the sheet comes from the ``*_snapshot``
columns taken when the prescription was issued, and the age is measured at
``issue_date`` from the frozen date of birth. The single live input is the
**clinic logo**: a reprint carries the branding the clinic has now.

## What this is not

It is not an electronic prescription and nothing here is digitally signed. The
sheet leaves a line for the prescriber's handwritten signature and stamp and
says so; no PDF is stored, hashed or sent anywhere.

## A voided prescription

Is still printable, with all of its content, under an ``ANULADA`` watermark on
every page and a banner. The void reason, date and actor are internal and are
never printed.

## Text

Every string that comes from the database is HTML-escaped when the HTML is
built (attributes included). Free-text line breaks are kept with CSS
(``white-space: pre-line``), never by turning them into markup. The renderer is
only allowed to load ``data:`` resources.
"""

from __future__ import annotations

import asyncio
import html
import logging
import re
from dataclasses import dataclass
from datetime import date
from io import BytesIO
from typing import Any
from uuid import UUID

from app.core.auth.models import Clinic
from app.core.clinic_branding import logo_data_uri

from .age import format_age
from .exceptions import PdfRenderFailed, PdfUnavailable
from .models import STATUS_VOIDED, Prescription

logger = logging.getLogger(__name__)

SUPPORTED_LOCALES = ("es", "en")
DEFAULT_LOCALE = "es"

_E = html.escape


def resolve_locale(requested: str | None, clinic_settings: dict | None) -> str:
    """The language of the labels.

    The caller's explicit choice, else the clinic's ``communication_language``,
    else Spanish. Anything we have no labels for is Spanish, not English: this
    is a document issued by a clinic in a Spanish-speaking market.
    """
    for candidate in (requested, (clinic_settings or {}).get("communication_language")):
        if candidate in SUPPORTED_LOCALES:
            return str(candidate)
    return DEFAULT_LOCALE


def pdf_filename(number: str) -> str:
    """``receta-RX-2026-000004.pdf``: from the number alone, header-safe."""
    return f"receta-{re.sub(r'[^A-Za-z0-9._-]', '-', number)}.pdf"


# ===========================================================================
# the context
# ===========================================================================


@dataclass(frozen=True)
class PDFClinic:
    name: str
    legal_name: str | None
    tax_id: str | None
    address: str | None
    phone: str | None
    #: ``data:`` URI of the clinic's *current* logo, or ``None``.
    logo: str | None


@dataclass(frozen=True)
class PDFItem:
    number: int
    active_ingredient: str
    strength: str
    pharmaceutical_form: str
    commercial_name: str | None
    presentation: str | None
    dose: str
    route: str
    frequency: str
    duration: str
    total_quantity: str
    instructions: str | None


@dataclass(frozen=True)
class PrescriptionPDFContext:
    locale: str
    labels: dict[str, Any]
    title: str
    number: str
    issue_date: str
    valid_until: str
    voided: bool
    clinic: PDFClinic
    patient_name: str
    patient_document: str | None
    patient_age: str
    items: list[PDFItem]
    prescriber_name: str
    prescriber_registration: str


def _clean(value: str | None) -> str | None:
    if value is None:
        return None
    text = value.strip()
    return text or None


def _fmt_date(value: date) -> str:
    return value.strftime("%d/%m/%Y")


def build_pdf_context(
    prescription: Prescription, *, logo: str | None, locale: str = DEFAULT_LOCALE
) -> PrescriptionPDFContext:
    """Everything the sheet shows, from the prescription's own snapshots."""
    if locale not in SUPPORTED_LOCALES:
        locale = DEFAULT_LOCALE
    labels = _get_labels(locale)

    document = None
    national_id = _clean(prescription.patient_national_id_snapshot)
    if national_id:
        kind = _clean(prescription.patient_national_id_type_snapshot)
        kind_label = labels["id_types"].get(kind.lower(), kind.upper()) if kind else None
        document = f"{kind_label}: {national_id}" if kind_label else national_id

    items = [
        PDFItem(
            number=number,
            active_ingredient=item.active_ingredient,
            strength=item.strength,
            pharmaceutical_form=item.pharmaceutical_form,
            commercial_name=_clean(item.commercial_name),
            presentation=_clean(item.presentation),
            dose=item.dose,
            route=item.route,
            frequency=item.frequency,
            duration=item.duration,
            total_quantity=item.total_quantity,
            instructions=_clean(item.instructions),
        )
        # Ordered here, explicitly: the sheet never relies on load order.
        for number, item in enumerate(sorted(prescription.items, key=lambda i: i.position), 1)
    ]

    return PrescriptionPDFContext(
        locale=locale,
        labels=labels,
        title=f"{labels['receipt']} {prescription.number}",
        number=prescription.number,
        issue_date=_fmt_date(prescription.issue_date),
        valid_until=_fmt_date(prescription.valid_until),
        voided=prescription.status == STATUS_VOIDED,
        clinic=PDFClinic(
            name=prescription.clinic_name_snapshot,
            legal_name=_clean(prescription.clinic_legal_name_snapshot),
            tax_id=_clean(prescription.clinic_tax_id_snapshot),
            address=_clean(prescription.clinic_address_snapshot),
            phone=_clean(prescription.clinic_phone_snapshot),
            logo=logo,
        ),
        patient_name=prescription.patient_name_snapshot,
        patient_document=document,
        patient_age=format_age(
            prescription.patient_date_of_birth_snapshot, prescription.issue_date, locale=locale
        ),
        items=items,
        prescriber_name=prescription.prescriber_name_snapshot,
        prescriber_registration=prescription.prescriber_professional_id_snapshot,
    )


# ===========================================================================
# the HTML
# ===========================================================================

_CSS = """
@page {
    size: A4;
    margin: 24mm 16mm 18mm 16mm;
    @top-left { content: element(strip); }
    @top-right { content: "__PAGE__ " counter(page) " __OF__ " counter(pages); font-size: 8pt; color: #555; }
}
@page :first {
    margin-top: 16mm;
    @top-left { content: none; }
    @top-right { content: none; }
    @bottom-center { content: "__PAGE__ " counter(page) " __OF__ " counter(pages); font-size: 8pt; color: #555; }
}
* { box-sizing: border-box; }
body { font-family: 'DejaVu Sans', Arial, Helvetica, sans-serif; font-size: 10pt; line-height: 1.35; color: #111; margin: 0; }
/* Running element: repeated by the page margin box from page 2 on. */
.strip { position: running(strip); font-size: 8pt; color: #333; border-bottom: 0.5pt solid #999; padding-bottom: 1mm; }
.strip .void { color: #b91c1c; font-weight: bold; }
/* Fixed elements repeat on every page, which is what a watermark needs. */
.watermark {
    position: fixed; top: 50%; left: 50%;
    transform: translate(-50%, -50%) rotate(-40deg);
    font-size: 90pt; font-weight: bold; letter-spacing: 6px; white-space: nowrap;
    color: rgba(185, 28, 28, 0.16);
}
.void-banner {
    border: 1.5pt solid #b91c1c; color: #b91c1c; text-align: center; font-weight: bold;
    letter-spacing: 4px; padding: 2mm; margin-bottom: 5mm;
}
table { border-collapse: collapse; width: 100%; }
.header td { vertical-align: top; }
.header { border-bottom: 1.5pt solid #1e3a8a; margin-bottom: 5mm; padding-bottom: 3mm; }
.clinic-logo { display: block; max-width: 50mm; max-height: 20mm; width: auto; height: auto; object-fit: contain; margin-bottom: 3mm; }
.clinic-name { font-size: 14pt; font-weight: bold; color: #1e3a8a; }
.clinic-details { font-size: 8.5pt; color: #444; }
.doc-box { text-align: right; }
.doc-title { font-size: 16pt; font-weight: bold; letter-spacing: 2px; }
.doc-number { font-size: 11pt; font-weight: bold; color: #1e3a8a; }
.doc-meta { font-size: 9pt; color: #333; margin-top: 1mm; }
.patient { margin-bottom: 5mm; border: 0.5pt solid #bbb; }
.patient td { padding: 1.5mm 2.5mm; vertical-align: top; }
.lbl { font-size: 7.5pt; color: #555; letter-spacing: 0.3px; }
.rp { font-size: 15pt; font-weight: bold; font-style: italic; margin: 0 0 3mm 0; break-after: avoid; }
.item { break-inside: avoid; margin-bottom: 4mm; padding-bottom: 3mm; border-bottom: 0.5pt solid #ccc; }
.items .item:last-child { break-after: avoid; border-bottom: none; }
.item-head { font-size: 11pt; break-after: avoid; margin-bottom: 1mm; }
.item-head .num { font-weight: bold; margin-right: 1.5mm; }
.item-head .dci { font-weight: bold; }
.sub { font-size: 9pt; color: #333; break-after: avoid; }
.spec { margin-top: 1.5mm; break-inside: avoid; }
.spec th { font-size: 7.5pt; color: #555; text-align: left; font-weight: normal; padding: 0 2mm 0.5mm 0; }
.spec td { padding: 0 2mm 0 0; vertical-align: top; }
.instructions { margin-top: 1.5mm; font-size: 9.5pt; }
.instructions .txt { white-space: pre-line; overflow-wrap: anywhere; }
.signature { break-inside: avoid; margin-top: 16mm; }
.signature .line { width: 75mm; border-top: 0.8pt solid #000; padding-top: 1.5mm; text-align: center; }
.signature .who { font-weight: bold; }
.signature .small { font-size: 8.5pt; color: #333; }
.notice { margin-top: 6mm; font-size: 8pt; font-style: italic; color: #555; }
.item-head, .sub, .spec td, .instructions .txt { overflow-wrap: anywhere; }
"""


def _row(label: str, value: str | None) -> str:
    if not value:
        return ""
    return f'<div class="sub">{_E(label)}: {_E(value)}</div>'


def _render_item(item: PDFItem, labels: dict[str, Any]) -> str:
    head = " ".join(
        part
        for part in (
            f'<span class="num">{item.number}.</span>',
            f'<span class="dci">{_E(item.active_ingredient)}</span>',
            f"<span>{_E(item.strength)}</span>",
            f"<span>{_E(item.pharmaceutical_form)}</span>",
        )
    )
    instructions = (
        f'<div class="instructions"><span class="lbl">{_E(labels["instructions"])}:</span> '
        f'<span class="txt">{_E(item.instructions)}</span></div>'
        if item.instructions
        else ""
    )
    return f"""
        <div class="item">
            <div class="item-head">{head}</div>
            {_row(labels["commercial_name"], item.commercial_name)}
            {_row(labels["presentation"], item.presentation)}
            <table class="spec">
                <tr>
                    <th>{_E(labels["dose"])}</th><th>{_E(labels["route"])}</th>
                    <th>{_E(labels["frequency"])}</th><th>{_E(labels["duration"])}</th>
                    <th>{_E(labels["quantity"])}</th>
                </tr>
                <tr>
                    <td>{_E(item.dose)}</td><td>{_E(item.route)}</td>
                    <td>{_E(item.frequency)}</td><td>{_E(item.duration)}</td>
                    <td>{_E(item.total_quantity)}</td>
                </tr>
            </table>
            {instructions}
        </div>"""


def _render_clinic(clinic: PDFClinic, labels: dict[str, Any]) -> str:
    rows = []
    if clinic.legal_name and clinic.legal_name != clinic.name:
        rows.append(f"<div>{_E(clinic.legal_name)}</div>")
    if clinic.tax_id:
        rows.append(f"<div>{_E(labels['tax_id'])}: {_E(clinic.tax_id)}</div>")
    if clinic.address:
        rows.append(f"<div>{_E(clinic.address)}</div>")
    if clinic.phone:
        rows.append(f"<div>{_E(clinic.phone)}</div>")
    logo = (
        f'<img class="clinic-logo" src="{_E(clinic.logo, quote=True)}" alt="">'
        if clinic.logo
        else ""
    )
    return (
        f'{logo}<div class="clinic-name">{_E(clinic.name)}</div>'
        f'<div class="clinic-details">{"".join(rows)}</div>'
    )


def render_html(ctx: PrescriptionPDFContext) -> str:
    """The sheet's HTML. Presentation only."""
    labels = ctx.labels
    css = _CSS.replace("__PAGE__", labels["page"]).replace("__OF__", labels["of"])

    watermark = f'<div class="watermark">{_E(labels["voided"])}</div>' if ctx.voided else ""
    banner = f'<div class="void-banner">{_E(labels["voided"])}</div>' if ctx.voided else ""
    void_tag = f'<span class="void">{_E(labels["voided"])}</span> · ' if ctx.voided else ""
    document = (
        f'<div><span class="lbl">{_E(labels["document"])}</span><br>{_E(ctx.patient_document)}</div>'
        if ctx.patient_document
        else ""
    )

    items = "".join(_render_item(item, labels) for item in ctx.items)
    return f"""<!DOCTYPE html>
<html lang="{_E(ctx.locale, quote=True)}">
<head>
    <meta charset="UTF-8">
    <title>{_E(ctx.title)}</title>
    <style>{css}</style>
</head>
<body>
    {watermark}
    <div class="strip">{void_tag}{_E(ctx.number)} · {_E(labels["patient"])}: {_E(ctx.patient_name)}</div>
    {banner}
    <table class="header">
        <tr>
            <td>{_render_clinic(ctx.clinic, labels)}</td>
            <td class="doc-box">
                <div class="doc-title">{_E(labels["receipt"].upper())}</div>
                <div class="doc-number">{_E(ctx.number)}</div>
                <div class="doc-meta">{_E(labels["date"])}: {_E(ctx.issue_date)}</div>
                <div class="doc-meta">{_E(labels["valid_until"])}: {_E(ctx.valid_until)}</div>
            </td>
        </tr>
    </table>
    <table class="patient">
        <tr>
            <td><span class="lbl">{_E(labels["patient"])}</span><br>{_E(ctx.patient_name)}</td>
            <td>{document}</td>
            <td><span class="lbl">{_E(labels["age"])}</span><br>{_E(ctx.patient_age)}</td>
        </tr>
    </table>
    <div class="rp">Rp/</div>
    <div class="items">{items}</div>
    <div class="signature">
        <div class="line">
            <div class="lbl">{_E(labels["dentist"])}</div>
            <div class="who">{_E(ctx.prescriber_name)}</div>
            <div class="small">{_E(labels["registration"])}: {_E(ctx.prescriber_registration)}</div>
            <div class="small">{_E(labels["signature"])}</div>
        </div>
    </div>
    <div class="notice">{_E(labels["notice"])}</div>
</body>
</html>"""


# ===========================================================================
# rendering
# ===========================================================================


def data_only_url_fetcher(url: str, *args: Any, **kwargs: Any) -> Any:
    """Allow ``data:`` resources and nothing else (no HTTP, no ``file:``)."""
    if not url.lower().startswith("data:"):
        raise ValueError("only data: URLs may be loaded while rendering a prescription")
    from weasyprint import default_url_fetcher

    return default_url_fetcher(url, *args, **kwargs)


def _load_weasyprint() -> Any:
    try:
        import weasyprint
    except (ImportError, OSError) as exc:  # OSError: the system libraries are missing
        raise PdfUnavailable("PDF rendering is not available on this server") from exc
    return weasyprint


def _url_fetcher(weasyprint: Any) -> Any:
    # WeasyPrint >= 68 has a fetcher class that can be limited by protocol; older
    # versions take a plain callable.
    fetcher_class = getattr(weasyprint, "URLFetcher", None)
    if fetcher_class is not None:
        return fetcher_class(allowed_protocols=("data",))
    return data_only_url_fetcher


def _html_to_pdf(html_content: str, prescription_id: UUID) -> bytes:
    """HTML to PDF bytes. Never returns anything that is not a PDF."""
    weasyprint = _load_weasyprint()
    try:
        buffer = BytesIO()
        weasyprint.HTML(string=html_content, url_fetcher=_url_fetcher(weasyprint)).write_pdf(buffer)
        return buffer.getvalue()
    except Exception as exc:
        # The prescription id and the kind of error; never what is written on it.
        logger.error("Prescription %s: PDF render failed (%s)", prescription_id, type(exc).__name__)
        raise PdfRenderFailed("the PDF could not be rendered") from exc


async def _current_logo(clinic: Clinic, prescription_id: UUID) -> str | None:
    """The clinic's logo as it is now, or ``None``: branding never blocks a print."""
    try:
        return await logo_data_uri(clinic)
    except Exception as exc:
        logger.warning(
            "Prescription %s: clinic logo unavailable (%s); printing without it",
            prescription_id,
            type(exc).__name__,
        )
        return None


class PrescriptionPDFService:
    @staticmethod
    async def generate_pdf(
        prescription: Prescription, clinic: Clinic, *, locale: str = DEFAULT_LOCALE
    ) -> bytes:
        """Render ``prescription`` (items loaded) as a PDF.

        ``clinic`` is used for **one thing**, the current logo. Nothing is read
        from it, or from anything else live, to describe the prescription.
        Nothing is written anywhere.
        """
        logo = await _current_logo(clinic, prescription.id)
        context = build_pdf_context(prescription, logo=logo, locale=locale)
        html_content = render_html(context)
        # WeasyPrint is CPU-bound: keep the event loop free while it renders.
        return await asyncio.to_thread(_html_to_pdf, html_content, prescription.id)


# ===========================================================================
# labels
# ===========================================================================


def _get_labels(locale: str) -> dict[str, Any]:
    if locale == "en":
        return {
            "receipt": "Prescription",
            "date": "Date",
            "valid_until": "Valid until",
            "patient": "Patient",
            "document": "Document",
            "age": "Age",
            "tax_id": "Tax ID",
            "commercial_name": "Trade name",
            "presentation": "Presentation",
            "dose": "Dose",
            "route": "Route",
            "frequency": "Frequency",
            "duration": "Duration",
            "quantity": "Quantity",
            "instructions": "Instructions",
            "dentist": "Dentist",
            "registration": "Registration no.",
            "signature": "Signature and stamp",
            "voided": "VOIDED",
            "page": "Page",
            "of": "of",
            "notice": "Printed document — requires the prescriber's handwritten signature and stamp.",
            "id_types": {"dni": "DNI", "nie": "NIE", "passport": "Passport"},
        }
    return {
        "receipt": "Receta",
        "date": "Fecha",
        "valid_until": "Vigencia hasta",
        "patient": "Paciente",
        "document": "Documento",
        "age": "Edad",
        "tax_id": "RUC / NIF",
        "commercial_name": "Nombre comercial",
        "presentation": "Presentación",
        "dose": "Dosis",
        "route": "Vía",
        "frequency": "Frecuencia",
        "duration": "Duración",
        "quantity": "Cantidad",
        "instructions": "Indicaciones",
        "dentist": "Odontólogo",
        "registration": "Colegiatura",
        "signature": "Firma y sello",
        "voided": "ANULADA",
        "page": "Página",
        "of": "de",
        "notice": "Documento impreso — requiere firma manuscrita y sello del prescriptor.",
        "id_types": {"dni": "DNI", "nie": "NIE", "passport": "Pasaporte"},
    }
