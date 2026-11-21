"""Invoice PDF generation service."""

import asyncio
import base64
import hashlib
from datetime import date
from decimal import Decimal
from io import BytesIO
from pathlib import Path
from typing import TYPE_CHECKING

from app.core.clinic_branding import logo_data_uri
from app.core.utils.currency import format_currency as _fmt_currency

if TYPE_CHECKING:
    from app.core.auth.models import Clinic

from .models import Invoice

_LOCALE_BY_LANG = {"es": "es_ES", "en": "en_US"}


class InvoicePDFService:
    """Service for generating invoice PDFs.

    Generates professional HTML-based PDFs with clinic branding.
    """

    @staticmethod
    def _format_address(address: dict | None) -> str:
        """Format address dict as a readable string."""
        if not address:
            return ""
        parts = []
        if address.get("street"):
            parts.append(address["street"])
        city_line = " ".join(filter(None, [address.get("postal_code"), address.get("city")]))
        if city_line:
            parts.append(city_line)
        if address.get("country"):
            parts.append(address["country"])
        return ", ".join(parts)

    @staticmethod
    async def generate_pdf(
        invoice: Invoice,
        clinic: "Clinic",
        is_preview: bool = False,
        locale: str = "es",
        extra_pdf_data: dict | None = None,
        total_paid: Decimal | None = None,
        balance_due: Decimal | None = None,
    ) -> bytes:
        """Generate PDF for an invoice.

        Args:
            invoice: The invoice to generate PDF for
            clinic: The clinic for branding
            is_preview: If True, adds DRAFT watermark for draft invoices
            locale: Language for labels (es/en)
            extra_pdf_data: Optional dict produced by a country
                ``BillingComplianceHook.enhance_pdf_data``. Recognised
                keys: ``compliance_qr_png_b64`` (base64 PNG) renders the
                QR top-right; ``compliance_qr_label`` (default
                ``"VERI*FACTU"``); ``legal_notices`` (list[str]) appends
                to the legal-notices block.

        Returns:
            PDF content as bytes
        """
        # Generate HTML content. ``total_paid`` / ``balance_due`` are
        # computed by callers (billing service) since they are no longer
        # stored on Invoice.
        logo = await logo_data_uri(clinic)
        html_content = InvoicePDFService._generate_html(
            invoice,
            clinic,
            is_preview,
            locale,
            extra_pdf_data or {},
            total_paid=total_paid or Decimal("0"),
            balance_due=balance_due if balance_due is not None else invoice.total,
            logo=logo,
        )

        # WeasyPrint is CPU-bound; offload to a thread so the event
        # loop keeps serving other requests while it renders.
        return await asyncio.to_thread(InvoicePDFService._html_to_pdf, html_content)

    @staticmethod
    def generate_pdf_hash(pdf_bytes: bytes) -> str:
        """Generate SHA-256 hash of PDF content for signature verification."""
        return hashlib.sha256(pdf_bytes).hexdigest()

    @staticmethod
    def _generate_html(
        invoice: Invoice,
        clinic: "Clinic",
        is_preview: bool,
        locale: str,
        extra_pdf_data: dict | None = None,
        total_paid: Decimal = Decimal("0"),
        balance_due: Decimal | None = None,
        logo: str | None = None,
    ) -> str:
        """Generate HTML content for the invoice."""
        extra = extra_pdf_data or {}
        dental_background_data_uri = "data:image/png;base64," + base64.b64encode(
            (Path(__file__).parent / "assets" / "dental-page-background.png").read_bytes()
        ).decode("ascii")
        # Localized labels
        labels = InvoicePDFService._get_labels(locale)

        # Determine if this is a credit note
        is_credit_note = invoice.credit_note_for_id is not None

        # Format currency from clinic.currency, locale derived from language.
        money_locale = _LOCALE_BY_LANG.get(locale, "es_ES")

        def format_currency(amount: Decimal) -> str:
            return _fmt_currency(amount, clinic.currency, locale=money_locale)

        # Build items table rows
        items_html = ""
        for i, item in enumerate(invoice.items, 1):
            tooth_info = ""
            if item.tooth_number:
                tooth_info = f"#{item.tooth_number}"
                if item.surfaces:
                    tooth_info += f" ({', '.join(item.surfaces)})"

            items_html += f"""
            <tr>
                <td class="number">{i}</td>
                <td class="description">
                    {item.description}
                    {f'<br><small class="code">{item.internal_code}</small>' if item.internal_code else ""}
                    {f'<br><small class="tooth">{tooth_info}</small>' if tooth_info else ""}
                </td>
                <td class="quantity">{item.quantity}</td>
                <td class="price">{format_currency(item.unit_price)}</td>
                <td class="vat">{item.vat_rate}%</td>
                <td class="total">{format_currency(item.line_total)}</td>
            </tr>
            """

        # Status badge
        status_label = labels["status"].get(invoice.status, invoice.status)

        # Watermark for preview or draft
        watermark_style = ""
        watermark_html = ""
        if is_preview or invoice.status == "draft":
            watermark_style = """
            .watermark {
                position: fixed;
                top: 50%;
                left: 50%;
                transform: translate(-50%, -50%) rotate(-45deg);
                font-size: 120px;
                font-weight: 600;
                letter-spacing: 3px;
                color: rgba(114, 208, 221, 0.12);
                z-index: 0;
                pointer-events: none;
            }
            """
            watermark_html = f'<div class="watermark">{labels["draft"]}</div>'

        # Patient info
        patient_name = ""
        if invoice.patient:
            patient_name = f"{invoice.patient.first_name} {invoice.patient.last_name}"

        # Format dates
        issue_date = invoice.issue_date.strftime("%d/%m/%Y") if invoice.issue_date else "-"
        due_date = invoice.due_date.strftime("%d/%m/%Y") if invoice.due_date else "-"

        # Document title
        doc_title = labels["credit_note"] if is_credit_note else labels["invoice"]
        doc_number = invoice.invoice_number or labels["draft"]

        # Credit note reference
        credit_note_ref_html = ""
        if is_credit_note and invoice.credit_note_for:
            ref_number = invoice.credit_note_for.invoice_number or "-"
            credit_note_ref_html = f"""
            <div class="credit-note-ref">
                <strong>{labels["credit_note_for"]}:</strong> {ref_number}
            </div>
            """

        # Compliance QR (e.g. AEAT VERI*FACTU). Country-agnostic block:
        # the country compliance hook supplies the base64 PNG via
        # ``extra_pdf_data['compliance_qr_png_b64']``. Sized 32 mm and
        # placed top-right per AEAT geometry; we render it as a sibling
        # of ``.invoice-info`` so it does not push the layout.
        qr_b64 = extra.get("compliance_qr_png_b64") or extra.get("verifactu_qr_png_b64")
        qr_label = extra.get("compliance_qr_label") or "VERI*FACTU"
        qr_block_html = ""
        if qr_b64:
            qr_block_html = f"""
            <div class="compliance-qr">
                <img src="data:image/png;base64,{qr_b64}" alt="{qr_label}" />
                <div class="compliance-qr-label">{qr_label}</div>
            </div>
            """

        # Legal notices appended by compliance hooks (e.g. "Factura
        # verificable en VERI*FACTU"). Rendered after the notes section.
        legal_notices = extra.get("legal_notices") or []
        legal_notices_html = ""
        if legal_notices:
            items_li = "".join(f"<li>{notice}</li>" for notice in legal_notices)
            legal_notices_html = f"""
            <div class="legal-notices">
                <ul>{items_li}</ul>
            </div>
            """

        # Build HTML
        html = f"""
        <!DOCTYPE html>
        <html lang="{locale}">
        <head>
            <meta charset="UTF-8">
            <title>{doc_title} {doc_number}</title>
            <style>
                * {{
                    margin: 0;
                    padding: 0;
                    box-sizing: border-box;
                }}
                @page {{
                    size: A4;
                    margin: 18mm 16mm 24mm;
                    background-color: #fff;
                    background-image: url("{dental_background_data_uri}");
                    background-repeat: no-repeat;
                    background-position: 120% 110%;
                    background-size: 118mm auto;
                }}
                body {{
                    font-family: 'Helvetica Neue', Arial, sans-serif;
                    font-size: 10pt;
                    line-height: 1.4;
                    color: #2f3d40;
                    padding: 0;
                }}
                {watermark_style}
                .header {{
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    margin-bottom: 11mm;
                    padding: 2mm 0 5mm;
                    border-bottom: 1px solid #72d0dd;
                }}
                .clinic-info {{
                    max-width: 60%;
                    padding-top: 0;
                }}
                .clinic-name {{
                    font-size: 15pt;
                    font-weight: 600;
                    color: #246575;
                    margin-bottom: 4px;
                    letter-spacing: .1px;
                }}
                .clinic-details {{
                    font-size: 8pt;
                    line-height: 1.45;
                    color: #718186;
                }}
                .invoice-info {{
                    text-align: right;
                }}
                .invoice-number {{
                    font-size: 13pt;
                    font-weight: 700;
                    color: #246575;
                    letter-spacing: .3px;
                }}
                .invoice-meta {{
                    font-size: 8pt;
                    color: #718186;
                    margin-top: 4px;
                }}
                .status-badge {{
                    display: inline-block;
                    padding: 2px 8px;
                    border: 1px solid transparent;
                    border-radius: 12px;
                    font-size: 7.5pt;
                    font-weight: 600;
                    text-transform: uppercase;
                    margin-top: 8px;
                }}
                .status-draft {{ background: #f1f5f5; border-color: #dce8e9; color: #52656a; }}
                .status-issued {{ background: #effafa; border-color: #cfecee; color: #246575; }}
                .status-partial {{ background: #fdf8e9; border-color: #f1e5bd; color: #8c6822; }}
                .status-paid {{ background: #edf8f4; border-color: #d5eee4; color: #236c59; }}
                .status-cancelled {{ background: #fdf1f2; border-color: #f3dce0; color: #a34450; }}
                .status-voided {{ background: #f1f5f5; border-color: #dce8e9; color: #66757a; }}

                .credit-note-ref {{
                    margin-top: 10px;
                    padding: 8px 12px;
                    background: #fef3c7;
                    border-radius: 6px;
                    font-size: 10pt;
                }}

                .section {{
                    margin-bottom: 9mm;
                }}
                .section-title {{
                    font-size: 10pt;
                    font-weight: 600;
                    color: #246575;
                    margin-bottom: 9px;
                    padding-bottom: 4px;
                    border-bottom: 1px solid #bce7ec;
                }}
                .billing-info {{
                    display: flex;
                    gap: 8mm;
                }}
                .info-group {{
                    min-width: 0;
                    flex: 1 1 0;
                }}
                .info-group:nth-child(2) {{
                    flex: 1.35 1 0;
                }}
                .info-label,
                .info-value {{
                    min-width: 0;
                    white-space: normal;
                    overflow-wrap: break-word;
                    word-wrap: break-word;
                }}
                .info-label {{
                    font-size: 8pt;
                    color: #718186;
                    margin-bottom: 3px;
                    letter-spacing: .55px;
                    text-transform: uppercase;
                }}
                .info-value {{
                    font-size: 10pt;
                    font-weight: 600;
                    color: #2f3d40;
                }}

                table {{
                    width: 100%;
                    border-collapse: collapse;
                    margin-bottom: 6mm;
                }}
                th {{
                    background: #f2fafb;
                    padding: 9px 7px;
                    text-align: left;
                    font-size: 9pt;
                    font-weight: 600;
                    color: #315e69;
                    border-bottom: 1px solid #bce7ec;
                }}
                td {{
                    padding: 9px 7px;
                    border-bottom: 1px solid #e7f0f1;
                    vertical-align: top;
                }}
                tr:last-child td {{
                    border-bottom: none;
                }}
                .number {{ width: 30px; text-align: center; }}
                .description {{ width: auto; }}
                .quantity {{ width: 50px; text-align: center; }}
                .price {{ width: 90px; text-align: right; }}
                .vat {{ width: 50px; text-align: center; }}
                .total {{ width: 100px; text-align: right; font-weight: 500; }}
                .clinic-logo {{ max-width: 48mm; max-height: 18mm; margin-bottom: 3mm; object-fit: contain; object-position: left center; }}
                .clinic-logo + .clinic-name {{ display: none; }}
                .code {{ color: #718186; }}
                .tooth {{ color: #87979b; }}

                .totals {{
                    float: right;
                    width: 320px;
                    margin-top: 6mm;
                }}
                .totals table {{
                    margin-bottom: 0;
                }}
                .totals td {{
                    padding: 7px 8px;
                    border-bottom: none;
                }}
                .totals .label {{
                    text-align: left;
                    color: #66757a;
                }}
                .totals .value {{
                    text-align: right;
                    font-weight: 500;
                    color: #2f3d40;
                }}
                .totals .grand-total {{
                    font-size: 15pt;
                    font-weight: 700;
                    color: #246575;
                    border-top: 2px solid #72d0dd;
                    padding-top: 8px;
                }}
                .totals .balance-due {{
                    font-size: 11.5pt;
                    font-weight: 600;
                    color: #c65762;
                }}
                .totals .paid {{
                    color: #059669;
                }}

                .notes-section {{
                    clear: both;
                    padding-top: 9mm;
                    margin-top: 9mm;
                    border-top: 1px solid #d8e9eb;
                }}
                .notes-content {{
                    background: #f7fbfb;
                    padding: 4mm;
                    border-radius: 6px;
                    font-size: 10pt;
                    color: #4b5563;
                }}

                .payment-info {{
                    margin-top: 5mm;
                    padding: 3mm 4mm;
                    background: #f5fbfc;
                    border: 1px solid #dfedef;
                    border-radius: 6px;
                    font-size: 9pt;
                }}
                .payment-info strong {{
                    color: #246575;
                }}

                .footer {{
                    position: fixed;
                    bottom: 14mm;
                    left: 16mm;
                    right: 16mm;
                    font-size: 7.5pt;
                    color: #8a9ba0;
                    text-align: center;
                    border-top: 1px solid #72d0dd;
                    padding-top: 7px;
                }}

                .compliance-qr {{
                    position: absolute;
                    top: 20mm;
                    right: 20mm;
                    text-align: center;
                    width: 32mm;
                }}
                .compliance-qr img {{
                    width: 32mm;
                    height: 32mm;
                    display: block;
                }}
                .compliance-qr-label {{
                    margin-top: 2mm;
                    font-size: 7pt;
                    font-weight: bold;
                    letter-spacing: 0.5px;
                    color: #111;
                }}

                .legal-notices {{
                    margin-top: 16px;
                    font-size: 8pt;
                    color: #6b7280;
                }}
                .legal-notices ul {{
                    list-style: none;
                    padding: 0;
                }}
                .legal-notices li {{
                    margin-bottom: 4px;
                }}

                @media print {{
                    body {{ padding: 0; }}
                    .footer {{ position: fixed; }}
                }}
            </style>
        </head>
        <body>
            {watermark_html}
            {qr_block_html}

            <div class="header">
                <div class="clinic-info">
                    {f'<img class="clinic-logo" src="{logo}" alt="">' if logo else ""}
                    <div class="clinic-name">{clinic.name if clinic else "Dental Clinic"}</div>
                    <div class="clinic-details">
                        {
            InvoicePDFService._format_address(clinic.address)
            if hasattr(clinic, "address") and clinic.address
            else ""
        }<br>
                        {clinic.phone if hasattr(clinic, "phone") and clinic.phone else ""}
                        {f" | {clinic.email}" if hasattr(clinic, "email") and clinic.email else ""}
                        {
            f"<br>{labels['tax_id']}: {clinic.tax_id}"
            if hasattr(clinic, "tax_id") and clinic.tax_id
            else ""
        }
                    </div>
                </div>
                <div class="invoice-info">
                    <div class="invoice-number">{doc_title} {doc_number}</div>
                    <div class="invoice-meta">
                        {labels["issue_date"]}: {issue_date}<br>
                        {labels["due_date"]}: {due_date}
                    </div>
                    <span class="status-badge status-{invoice.status}">{status_label}</span>
                    {credit_note_ref_html}
                </div>
            </div>

            <div class="section">
                <div class="section-title">{labels["billing_info"]}</div>
                <div class="billing-info">
                    <div class="info-group">
                        <div class="info-label">{labels["billing_name"]}</div>
                        <div class="info-value">{invoice.billing_name}</div>
                        {
            f'<div class="info-label" style="margin-top: 8px;">{labels["tax_id"]}</div><div class="info-value">{invoice.billing_tax_id}</div>'
            if invoice.billing_tax_id
            else ""
        }
                    </div>
                    <div class="info-group">
                        <div class="info-label">{labels["address"]}</div>
                        <div class="info-value">{
            InvoicePDFService._format_address(invoice.billing_address)
        }</div>
                    </div>
                    {
            f'''
                    <div class="info-group">
                        <div class="info-label">{labels["patient"]}</div>
                        <div class="info-value">{patient_name}</div>
                    </div>
                    '''
            if patient_name and patient_name != invoice.billing_name
            else ""
        }
                </div>
            </div>

            <div class="section">
                <div class="section-title">{labels["items"]}</div>
                <table>
                    <thead>
                        <tr>
                            <th class="number">#</th>
                            <th class="description">{labels["description"]}</th>
                            <th class="quantity">{labels["qty"]}</th>
                            <th class="price">{labels["unit_price"]}</th>
                            <th class="vat">{labels["vat"]}</th>
                            <th class="total">{labels["total"]}</th>
                        </tr>
                    </thead>
                    <tbody>
                        {items_html}
                    </tbody>
                </table>

                <div class="totals">
                    <table>
                        <tr>
                            <td class="label">{labels["subtotal"]}:</td>
                            <td class="value">{format_currency(invoice.subtotal)}</td>
                        </tr>
                        {
            f'''
                        <tr>
                            <td class="label">{labels["total_discount"]}:</td>
                            <td class="value discount">-{format_currency(invoice.total_discount)}</td>
                        </tr>
                        '''
            if invoice.total_discount
            else ""
        }
                        <tr>
                            <td class="label">{labels["tax"]}:</td>
                            <td class="value">{format_currency(invoice.total_tax)}</td>
                        </tr>
                        <tr>
                            <td class="label grand-total">{labels["grand_total"]}:</td>
                            <td class="value grand-total">{format_currency(invoice.total)}</td>
                        </tr>
                        {
            f'''
                        <tr>
                            <td class="label paid">{labels["total_paid"]}:</td>
                            <td class="value paid">{format_currency(total_paid)}</td>
                        </tr>
                        '''
            if total_paid > 0
            else ""
        }
                        {
            f'''
                        <tr>
                            <td class="label balance-due">{labels["balance_due"]}:</td>
                            <td class="value balance-due">{format_currency(balance_due if balance_due is not None else invoice.total)}</td>
                        </tr>
                        '''
            if (balance_due if balance_due is not None else invoice.total) > 0
            else ""
        }
                    </table>
                </div>
            </div>

            {
            f'''
            <div class="notes-section">
                <div class="section-title">{labels["notes"]}</div>
                <div class="notes-content">{invoice.public_notes}</div>
            </div>
            '''
            if invoice.public_notes
            else ""
        }

            <div class="payment-info">
                <strong>{labels["payment_terms"]}:</strong> {invoice.payment_term_days} {
            labels["days"]
        }
            </div>

            {legal_notices_html}

            <div class="footer">
                {labels["generated_by"]} Denplant | {date.today().strftime("%d/%m/%Y %H:%M")}
            </div>
        </body>
        </html>
        """

        return html

    @staticmethod
    def _html_to_pdf(html_content: str) -> bytes:
        """Convert HTML to PDF.

        Uses WeasyPrint if available, otherwise returns HTML as fallback.
        """
        try:
            from weasyprint import HTML

            pdf_buffer = BytesIO()
            HTML(string=html_content).write_pdf(pdf_buffer)
            return pdf_buffer.getvalue()
        except ImportError:
            # WeasyPrint not installed, return HTML content
            # In production, WeasyPrint should be installed
            return html_content.encode("utf-8")

    @staticmethod
    def _get_labels(locale: str) -> dict:
        """Get localized labels for PDF."""
        labels_es = {
            "invoice": "Factura",
            "credit_note": "Factura Rectificativa",
            "credit_note_for": "Rectifica a",
            "draft": "BORRADOR",
            "issue_date": "Fecha emisión",
            "due_date": "Fecha vencimiento",
            "billing_info": "Datos de Facturación",
            "billing_name": "Nombre/Razón social",
            "tax_id": "NIF/CIF",
            "address": "Dirección",
            "patient": "Paciente",
            "items": "Conceptos",
            "description": "Descripción",
            "qty": "Cant.",
            "unit_price": "Precio Unit.",
            "discount": "Descuento",
            "vat": "IGV",
            "total": "Total",
            "subtotal": "Subtotal",
            "total_discount": "Descuento total",
            "tax": "IGV",
            "grand_total": "TOTAL",
            "total_paid": "Total pagado",
            "balance_due": "Pendiente",
            "notes": "Observaciones",
            "payment_terms": "Plazo de pago",
            "days": "días",
            "generated_by": "Generado por",
            "status": {
                "draft": "Borrador",
                "issued": "Emitida",
                "partial": "Pago Parcial",
                "paid": "Pagada",
                "cancelled": "Cancelada",
                "voided": "Anulada",
            },
        }

        labels_en = {
            "invoice": "Invoice",
            "credit_note": "Credit Note",
            "credit_note_for": "Corrects",
            "draft": "DRAFT",
            "issue_date": "Issue date",
            "due_date": "Due date",
            "billing_info": "Billing Information",
            "billing_name": "Name/Company",
            "tax_id": "Tax ID",
            "address": "Address",
            "patient": "Patient",
            "items": "Items",
            "description": "Description",
            "qty": "Qty",
            "unit_price": "Unit Price",
            "discount": "Discount",
            "vat": "IGV",
            "total": "Total",
            "subtotal": "Subtotal",
            "total_discount": "Total discount",
            "tax": "IGV",
            "grand_total": "TOTAL",
            "total_paid": "Total paid",
            "balance_due": "Balance due",
            "notes": "Notes",
            "payment_terms": "Payment terms",
            "days": "days",
            "generated_by": "Generated by",
            "status": {
                "draft": "Draft",
                "issued": "Issued",
                "partial": "Partial",
                "paid": "Paid",
                "cancelled": "Cancelled",
                "voided": "Voided",
            },
        }

        return labels_es if locale == "es" else labels_en
