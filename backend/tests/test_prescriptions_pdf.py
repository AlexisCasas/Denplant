"""Prescription PDF - access, headers, snapshots, logo, voiding, pages, errors.

Content is checked the way the budget PDF is: through WeasyPrint's own layout of
the HTML the endpoint renders, i.e. the text that ends up on each page. The
response itself is checked for what a PDF response must be: the bytes, the
headers and the number of pages.

The fixtures live in ``prescriptions_fixtures`` and are imported explicitly (not
registered in ``conftest.py``); importing a fixture by name makes ruff read every
test argument as a redefinition, hence the file-level F811 exemption below.
"""
# ruff: noqa: F811

from __future__ import annotations

import io
import logging
import re
import sys
from datetime import UTC, date, datetime
from types import SimpleNamespace
from uuid import uuid4

import pytest
from PIL import Image
from sqlalchemy import select, text

from app.core.auth.models import Clinic
from app.core.clinic_branding import logo_data_uri, read_logo_reference, save_logo
from app.core.storage import get_storage_backend
from app.modules.prescriptions import pdf as pdf_module
from app.modules.prescriptions.models import Prescription
from app.modules.prescriptions.pdf import (
    PrescriptionPDFService,
    build_pdf_context,
    data_only_url_fetcher,
    pdf_filename,
    render_html,
    resolve_locale,
)
from tests.prescriptions_fixtures import (
    BASE,
    DOB,
    ITEM,
    _issue,
    api,  # noqa: F401
    env,  # noqa: F401
    inspect,  # noqa: F401
)

# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------


def png(width: int, height: int, color=(30, 90, 200)) -> bytes:
    out = io.BytesIO()
    Image.new("RGB", (width, height), color).save(out, "PNG")
    return out.getvalue()


def pages_of(html_content: str) -> list[str]:
    """The text WeasyPrint lays out on each page, margin boxes included."""
    from weasyprint import HTML

    document = HTML(string=html_content).render()
    pages = []
    for page in document.pages:
        chunks = [
            box.text
            for box in page._page_box.descendants()
            if isinstance(getattr(box, "text", None), str)
        ]
        # Whitespace between inline elements is layout, not text.
        pages.append(re.sub(r"\s+", " ", " ".join(chunks)).strip())
    return pages


def has_item(page_text: str, number: int) -> bool:
    """Whether ``number. Medicamento number`` is on the page (11 is not 1)."""
    return re.search(rf"(?<!\d){number}\. Medicamento {number}(?!\d)", page_text) is not None


def text_of(html_content: str) -> str:
    return " ".join(pages_of(html_content))


def _pdf_structure(pdf_bytes: bytes) -> bytes:
    """The file with its compressed streams inflated, so its objects can be read.

    WeasyPrint packs page dictionaries into compressed object streams; without a
    PDF reader in the project this is enough to count pages and find images.
    """
    import zlib

    chunks = [pdf_bytes]
    for match in re.finditer(rb"stream\r?\n(.*?)\r?\nendstream", pdf_bytes, re.DOTALL):
        try:
            chunks.append(zlib.decompress(match.group(1)))
        except zlib.error:
            continue
    return b"\n".join(chunks)


def page_count(pdf_bytes: bytes) -> int:
    """Page objects in the file (``/Type /Page`` but not ``/Type /Pages``)."""
    return len(re.findall(rb"/Type /Page(?![A-Za-z])", _pdf_structure(pdf_bytes)))


def has_image(pdf_bytes: bytes) -> bool:
    return b"/Subtype /Image" in _pdf_structure(pdf_bytes)


async def load(inspect, prescription_id) -> Prescription:
    session = inspect()
    return (
        await session.execute(select(Prescription).where(Prescription.id == prescription_id))
    ).scalar_one()


async def html_for(inspect, prescription_id, *, logo=None, locale="es") -> str:
    prescription = await load(inspect, prescription_id)
    return render_html(build_pdf_context(prescription, logo=logo, locale=locale))


async def get_pdf(api, headers, prescription_id, **params):
    return await api.get(f"{BASE}/{prescription_id}/pdf", headers=headers, params=params)


async def void(api, env, prescription_id, reason="motivo-interno-QA-7731"):
    response = await api.post(
        f"{BASE}/{prescription_id}/void", headers=env.admin, json={"reason": reason}
    )
    assert response.status_code == 200, response.text
    return response.json()["data"]


def stub_prescription(**over):
    """A plain object with only the snapshot columns: no patient, user or clinic."""
    base = {
        "id": uuid4(),
        "number": "RX-2026-000001",
        "issue_date": date(2026, 10, 3),
        "valid_until": date(2026, 10, 10),
        "status": "issued",
        "patient_name_snapshot": "Ana Pérez",
        "patient_national_id_snapshot": "12345678",
        "patient_national_id_type_snapshot": "dni",
        "patient_date_of_birth_snapshot": date(1990, 5, 17),
        "prescriber_name_snapshot": "Dr. Luis Gómez",
        "prescriber_professional_id_snapshot": "COP-9",
        "clinic_name_snapshot": "Clínica Uno",
        "clinic_legal_name_snapshot": "Uno S.A.C.",
        "clinic_tax_id_snapshot": "20100000001",
        "clinic_address_snapshot": "Av. Uno 1, Lima",
        "clinic_phone_snapshot": "+51 1 000",
        "items": [],
    }
    base.update(over)
    return SimpleNamespace(**base)


def stub_item(position=1, **over):
    base = {
        "position": position,
        "active_ingredient": "Amoxicilina",
        "strength": "500 mg",
        "pharmaceutical_form": "Cápsula",
        "commercial_name": None,
        "presentation": None,
        "dose": "1 cápsula",
        "route": "Oral",
        "frequency": "Cada 8 horas",
        "duration": "7 días",
        "total_quantity": "21 cápsulas",
        "instructions": None,
    }
    base.update(over)
    return SimpleNamespace(**base)


# ===========================================================================
# the endpoint: access
# ===========================================================================


@pytest.mark.asyncio
async def test_a_dentist_downloads_the_pdf_of_an_issued_prescription(api, env):
    issued = await _issue(api, env)

    response = await get_pdf(api, env.dentist, issued["id"])

    assert response.status_code == 200
    assert response.headers["content-type"] == "application/pdf"
    assert response.content.startswith(b"%PDF")
    assert page_count(response.content) == 1


@pytest.mark.asyncio
async def test_an_admin_can_read_it(api, env):
    issued = await _issue(api, env)
    assert (await get_pdf(api, env.admin, issued["id"])).status_code == 200


@pytest.mark.asyncio
@pytest.mark.parametrize("role", ["hygienist", "assistant", "receptionist"])
async def test_other_roles_cannot_print(api, env, role):
    issued = await _issue(api, env)
    assert (await get_pdf(api, getattr(env, role), issued["id"])).status_code == 403


@pytest.mark.asyncio
async def test_another_clinic_gets_a_404(api, env):
    issued = await _issue(api, env)
    assert (await get_pdf(api, env.outsider, issued["id"])).status_code == 404
    assert (await get_pdf(api, env.other_dentist, issued["id"])).status_code == 404


@pytest.mark.asyncio
async def test_patient_scope_applies(api, env):
    issued = await _issue(api, env)
    assert (await get_pdf(api, env.dentist2, issued["id"])).status_code == 404

    shared = await _issue(api, env, patient=env.shared)
    assert (await get_pdf(api, env.dentist2, shared["id"])).status_code == 200


@pytest.mark.asyncio
async def test_an_unknown_prescription_is_a_404(api, env):
    response = await get_pdf(api, env.dentist, uuid4())
    assert response.status_code == 404
    assert response.json()["code"] == "prescription_not_found"


@pytest.mark.asyncio
async def test_a_voided_prescription_is_still_printable(api, env):
    issued = await _issue(api, env)
    await void(api, env, issued["id"])

    response = await get_pdf(api, env.dentist, issued["id"])

    assert response.status_code == 200
    assert response.content.startswith(b"%PDF")


# ===========================================================================
# the endpoint: headers
# ===========================================================================


@pytest.mark.asyncio
async def test_the_headers_of_a_printable_document(api, env):
    issued = await _issue(api, env)

    response = await get_pdf(api, env.dentist, issued["id"])

    assert response.headers["content-disposition"] == (
        f'inline; filename="receta-{issued["number"]}.pdf"'
    )
    assert response.headers["cache-control"] == "no-store"
    assert response.headers["x-content-type-options"] == "nosniff"
    assert re.fullmatch(
        r'inline; filename="receta-RX-\d{4}-\d{6}\.pdf"', response.headers["content-disposition"]
    )


@pytest.mark.asyncio
async def test_the_filename_carries_nothing_about_the_patient(api, env):
    issued = await _issue(api, env)
    disposition = (await get_pdf(api, env.dentist, issued["id"])).headers["content-disposition"]
    assert "Mio" not in disposition and "Paciente" not in disposition


def test_the_filename_is_built_from_the_number_alone_and_is_header_safe():
    assert pdf_filename("RX-2026-000004") == "receta-RX-2026-000004.pdf"
    assert pdf_filename('RX/..\\"x\r\ny') == "receta-RX-..--x--y.pdf"


@pytest.mark.asyncio
@pytest.mark.parametrize("locale", ["es", "en"])
async def test_the_locale_parameter_is_accepted(api, env, locale):
    issued = await _issue(api, env)
    assert (await get_pdf(api, env.dentist, issued["id"], locale=locale)).status_code == 200


@pytest.mark.asyncio
async def test_other_locales_are_not_accepted(api, env):
    issued = await _issue(api, env)
    assert (await get_pdf(api, env.dentist, issued["id"], locale="fr")).status_code == 422


def test_the_locale_comes_from_the_request_then_the_clinic_then_spanish():
    assert resolve_locale("en", {"communication_language": "es"}) == "en"
    assert resolve_locale(None, {"communication_language": "en"}) == "en"
    assert resolve_locale(None, {"communication_language": "fr"}) == "es"
    assert resolve_locale(None, {}) == "es"
    assert resolve_locale(None, None) == "es"
    assert resolve_locale("fr", None) == "es"


# ===========================================================================
# content: snapshots
# ===========================================================================


@pytest.mark.asyncio
async def test_the_sheet_says_what_the_prescription_snapshots_say(api, env, inspect):
    issued = await _issue(api, env)

    body = text_of(await html_for(inspect, issued["id"]))

    issue = date.fromisoformat(issued["issue_date"])
    expected_age = (
        issue.year - DOB.year - (0 if (issue.month, issue.day) >= (DOB.month, DOB.day) else 1)
    )
    for fragment in (
        issued["number"],
        "Mio Paciente",
        "DNI: 45678912",
        f"{expected_age} años",
        "Dentist Tester",
        "COP-111",
        "Clínica Sonrisa",
        "Sonrisa S.A.C.",
        "20123456789",
        "Av. Larco 123, 15074 Lima, Perú",
        "+51 1 555 0100",
        date.fromisoformat(issued["issue_date"]).strftime("%d/%m/%Y"),
        date.fromisoformat(issued["valid_until"]).strftime("%d/%m/%Y"),
    ):
        assert fragment in body, fragment


@pytest.mark.asyncio
async def test_the_date_of_birth_is_not_printed(api, env, inspect):
    issued = await _issue(api, env)
    body = text_of(await html_for(inspect, issued["id"]))
    assert DOB.strftime("%d/%m/%Y") not in body
    assert DOB.isoformat() not in body


@pytest.mark.asyncio
async def test_changing_the_patient_the_user_and_the_clinic_does_not_change_the_sheet(
    api, env, inspect
):
    issued = await _issue(api, env)
    before = text_of(await html_for(inspect, issued["id"]))

    session = inspect()
    await session.execute(
        text(
            "UPDATE patients SET first_name = 'Cambiado', last_name = 'Distinto', "
            "national_id = '00000000', date_of_birth = '2001-02-03' WHERE id = :id"
        ),
        {"id": env.patient},
    )
    await session.execute(
        text(
            "UPDATE users SET first_name = 'Renombrado', last_name = 'Otro', "
            "professional_id = 'COP-NUEVO' WHERE id = :id"
        ),
        {"id": env.dentist_id},
    )
    await session.execute(
        text(
            "UPDATE clinics SET name = 'Otro Nombre', legal_name = 'Otra S.A.', tax_id = 'X9', "
            "address = CAST(:addr AS jsonb), phone = '999' WHERE id = :id"
        ),
        {"id": env.clinic, "addr": '{"street": "Calle Nueva 1", "city": "Cusco"}'},
    )
    await session.commit()
    session.expire_all()

    after_html = await html_for(inspect, issued["id"])
    assert text_of(after_html) == before
    for fresh in (
        "Cambiado",
        "Distinto",
        "00000000",
        "Renombrado",
        "COP-NUEVO",
        "Otro Nombre",
        "Otra S.A.",
        "Calle Nueva 1",
        "Cusco",
        "999",
    ):
        assert fresh not in text_of(after_html), fresh

    # ...and the endpoint, which uses the same code, still prints.
    assert (await get_pdf(api, env.admin, issued["id"])).status_code == 200


def test_the_context_is_built_from_the_prescription_alone():
    # A plain stand-in with the snapshot columns and nothing else: no patient,
    # no user, no clinic to fall back on, and it still builds.
    prescription = stub_prescription(items=[stub_item(1)])
    ctx = build_pdf_context(prescription, logo=None, locale="es")
    assert ctx.patient_name == "Ana Pérez"
    assert ctx.clinic.name == "Clínica Uno"
    assert ctx.prescriber_registration == "COP-9"
    assert ctx.patient_age == "36 años"


def test_the_age_is_measured_at_the_issue_date_not_today():
    old = stub_prescription(
        issue_date=date(2010, 6, 1),
        valid_until=date(2010, 6, 8),
        patient_date_of_birth_snapshot=date(2000, 1, 1),
    )
    assert build_pdf_context(old, logo=None).patient_age == "10 años"
    # the day before a birthday vs on it
    eve = stub_prescription(patient_date_of_birth_snapshot=date(1990, 10, 4))
    assert build_pdf_context(eve, logo=None).patient_age == "35 años"
    day = stub_prescription(patient_date_of_birth_snapshot=date(1990, 10, 3))
    assert build_pdf_context(day, logo=None).patient_age == "36 años"


def test_a_baby_is_written_in_months():
    baby = stub_prescription(patient_date_of_birth_snapshot=date(2026, 1, 15))
    assert build_pdf_context(baby, logo=None).patient_age == "8 meses"
    assert build_pdf_context(baby, logo=None, locale="en").patient_age == "8 months"


def test_the_document_is_optional_on_the_sheet():
    none = stub_prescription(
        patient_national_id_snapshot=None, patient_national_id_type_snapshot=None
    )
    assert build_pdf_context(none, logo=None).patient_document is None
    typeless = stub_prescription(patient_national_id_type_snapshot=None)
    assert build_pdf_context(typeless, logo=None).patient_document == "12345678"
    odd = stub_prescription(patient_national_id_type_snapshot="carnet")
    assert build_pdf_context(odd, logo=None).patient_document == "CARNET: 12345678"


# ===========================================================================
# content: medications
# ===========================================================================


@pytest.mark.asyncio
async def test_one_medication_with_every_field(api, env, inspect):
    issued = await _issue(
        api,
        env,
        items=[
            {
                **ITEM,
                "commercial_name": "Amoxil",
                "presentation": "Caja x 21",
                "instructions": "Tomar con agua",
            }
        ],
    )

    body = text_of(await html_for(inspect, issued["id"]))

    for fragment in (
        "1.",
        "Amoxicilina",
        "500 mg",
        "Cápsula",
        "Nombre comercial: Amoxil",
        "Presentación: Caja x 21",
        "1 cápsula",
        "Oral",
        "Cada 8 horas",
        "7 días",
        "21 cápsulas",
        "Indicaciones",
        "Tomar con agua",
        "Rp/",
        "Dosis",
        "Vía",
        "Frecuencia",
        "Duración",
        "Cantidad",
        "Firma y sello",
        "Colegiatura",
    ):
        assert fragment in body, fragment


@pytest.mark.asyncio
async def test_several_medications_are_numbered_in_order(api, env, inspect):
    issued = await _issue(
        api,
        env,
        items=[{**ITEM, "active_ingredient": name} for name in ("Cuarta", "Primera", "Segunda")],
    )

    body = text_of(await html_for(inspect, issued["id"]))

    assert body.index("1. Cuarta") < body.index("2. Primera") < body.index("3. Segunda")


def test_items_are_ordered_by_position_whatever_order_they_arrive_in():
    prescription = stub_prescription(
        items=[
            stub_item(3, active_ingredient="C"),
            stub_item(1, active_ingredient="A"),
            stub_item(2, active_ingredient="B"),
        ]
    )
    ctx = build_pdf_context(prescription, logo=None)
    assert [(i.number, i.active_ingredient) for i in ctx.items] == [(1, "A"), (2, "B"), (3, "C")]


def test_optional_fields_that_are_absent_leave_no_trace():
    prescription = stub_prescription(items=[stub_item(1, commercial_name="  ", instructions="")])
    body = text_of(render_html(build_pdf_context(prescription, logo=None)))
    assert "Nombre comercial" not in body
    assert "Presentación" not in body
    assert "Indicaciones" not in body
    assert "Amoxicilina" in body


def test_accents_and_unicode_survive():
    prescription = stub_prescription(
        patient_name_snapshot="José Ñandú Çelik",
        items=[
            stub_item(
                1,
                active_ingredient="Ácido acetilsalicílico",
                strength="500 µg",
                instructions="Tomar después de comer — ½ vaso; “agua”",
            )
        ],
    )
    body = text_of(render_html(build_pdf_context(prescription, logo=None)))
    for fragment in ("José Ñandú Çelik", "Ácido acetilsalicílico", "500 µg", "½ vaso", "“agua”"):
        assert fragment in body, fragment


def test_text_written_by_people_cannot_inject_markup():
    hostile = "<script>alert(1)</script><img src=x onerror=alert(2)> & \"q\" 's'"
    prescription = stub_prescription(
        patient_name_snapshot=hostile,
        prescriber_name_snapshot=hostile,
        clinic_name_snapshot=hostile,
        clinic_legal_name_snapshot=hostile + "L",
        clinic_address_snapshot=hostile,
        patient_national_id_snapshot=hostile,
        items=[
            stub_item(
                1,
                active_ingredient=hostile,
                commercial_name=hostile,
                presentation=hostile,
                instructions=hostile,
            )
        ],
    )
    html_out = render_html(build_pdf_context(prescription, logo=None))

    assert "<script" not in html_out
    assert "<img src=x" not in html_out
    assert "&lt;script&gt;" in html_out
    # What the reader sees is the literal text.
    assert "<script>alert(1)</script>" in text_of(html_out)


def test_a_hostile_logo_value_cannot_break_out_of_its_attribute():
    html_out = render_html(
        build_pdf_context(stub_prescription(), logo='x" onerror="alert(1)', locale="es")
    )
    assert 'onerror="alert(1)"' not in html_out
    assert "&quot;" in html_out


def test_multiline_instructions_keep_their_lines_without_markup():
    prescription = stub_prescription(
        items=[stub_item(1, instructions="Primera línea\nSegunda línea")]
    )
    html_out = render_html(build_pdf_context(prescription, logo=None))

    # The line break is kept as a character and drawn by CSS, never as markup.
    assert "Primera línea\nSegunda línea" in html_out
    assert "pre-line" in html_out
    assert "Primera línea<" not in html_out
    body = text_of(html_out)
    assert "Primera línea" in body and "Segunda línea" in body


def test_no_claim_of_a_digital_or_electronic_prescription():
    for locale in ("es", "en"):
        body = text_of(
            render_html(
                build_pdf_context(stub_prescription(items=[stub_item()]), logo=None, locale=locale)
            )
        ).lower()
        for forbidden in (
            "firma digital",
            "receta electrónica",
            "digital signature",
            "electronic prescription",
        ):
            assert forbidden not in body


def test_the_labels_exist_in_both_languages():
    es = text_of(render_html(build_pdf_context(stub_prescription(items=[stub_item()]), logo=None)))
    en = text_of(
        render_html(
            build_pdf_context(stub_prescription(items=[stub_item()]), logo=None, locale="en")
        )
    )
    for label in (
        "RECETA",
        "Paciente",
        "Fecha",
        "Vigencia hasta",
        "Colegiatura",
        "Odontólogo",
        "Dosis",
        "Vía",
        "Frecuencia",
        "Duración",
        "Cantidad",
        "Firma y sello",
        "Documento impreso — requiere firma manuscrita",
    ):
        assert label in es, label
    for label in (
        "PRESCRIPTION",
        "Patient",
        "Date",
        "Valid until",
        "Registration no.",
        "Dentist",
        "Dose",
        "Route",
        "Frequency",
        "Duration",
        "Quantity",
        "Signature and stamp",
        "requires the prescriber's handwritten signature and stamp",
    ):
        assert label in en, label


def test_the_title_has_no_patient_name():
    ctx = build_pdf_context(stub_prescription(), logo=None)
    assert ctx.title == "Receta RX-2026-000001"
    assert "Ana" not in ctx.title
    assert "<title>Receta RX-2026-000001</title>" in render_html(ctx)


# ===========================================================================
# the logo
# ===========================================================================


async def _clinic_with_logo(inspect, env, data: bytes):
    session = inspect()
    clinic = await session.get(Clinic, env.clinic)
    await save_logo(clinic, data)
    await session.commit()
    return clinic


@pytest.mark.asyncio
async def test_the_current_logo_is_drawn(api, env, inspect):
    issued = await _issue(api, env)
    without = await get_pdf(api, env.dentist, issued["id"])
    assert not has_image(without.content)

    await _clinic_with_logo(inspect, env, png(600, 240))
    with_logo = await get_pdf(api, env.dentist, issued["id"])

    assert with_logo.status_code == 200
    assert has_image(with_logo.content)


@pytest.mark.asyncio
async def test_a_prescription_without_a_logo_still_prints(api, env):
    issued = await _issue(api, env)
    response = await get_pdf(api, env.dentist, issued["id"])
    assert response.status_code == 200 and not has_image(response.content)


@pytest.mark.asyncio
async def test_a_missing_logo_file_does_not_stop_the_print(api, env, inspect):
    issued = await _issue(api, env)
    clinic = await _clinic_with_logo(inspect, env, png(300, 120))
    await get_storage_backend().delete(read_logo_reference(clinic)["path"])

    response = await get_pdf(api, env.dentist, issued["id"])

    assert response.status_code == 200
    assert response.content.startswith(b"%PDF")
    assert not has_image(response.content)


@pytest.mark.asyncio
async def test_a_storage_failure_does_not_stop_the_print_and_logs_no_clinical_text(
    api, env, inspect, monkeypatch, caplog
):
    issued = await _issue(api, env)

    async def broken(_clinic):
        raise RuntimeError("storage is down")

    monkeypatch.setattr(pdf_module, "logo_data_uri", broken)
    with caplog.at_level(logging.WARNING, logger="app.modules.prescriptions.pdf"):
        response = await get_pdf(api, env.dentist, issued["id"])

    assert response.status_code == 200
    assert not has_image(response.content)
    logged = " ".join(r.getMessage() for r in caplog.records)
    assert issued["id"] in logged and "RuntimeError" in logged
    for private in ("Mio", "Amoxicilina", "Dentist"):
        assert private not in logged


@pytest.mark.asyncio
async def test_replacing_the_logo_changes_the_reprint(api, env, inspect):
    issued = await _issue(api, env)
    clinic = await _clinic_with_logo(inspect, env, png(600, 240, (30, 90, 200)))
    first = await logo_data_uri(clinic)
    prescription = await load(inspect, issued["id"])
    first_html = render_html(build_pdf_context(prescription, logo=first))

    clinic = await _clinic_with_logo(inspect, env, png(500, 300, (200, 30, 30)))
    second = await logo_data_uri(clinic)
    second_html = render_html(build_pdf_context(prescription, logo=second))

    assert first and second and first != second
    assert first in first_html and second in second_html and first not in second_html
    # the clinical text is identical
    assert text_of(first_html) == text_of(second_html)


# ===========================================================================
# a voided prescription
# ===========================================================================


@pytest.mark.asyncio
async def test_a_voided_sheet_is_marked_and_keeps_all_its_content(api, env, inspect):
    issued = await _issue(api, env, items=[dict(ITEM), {**ITEM, "active_ingredient": "Ibuprofeno"}])
    original = text_of(await html_for(inspect, issued["id"]))
    assert "ANULADA" not in original

    await void(api, env, issued["id"])
    html_out = await html_for(inspect, issued["id"])
    body = text_of(html_out)

    assert 'class="watermark"' in html_out and 'class="void-banner"' in html_out
    for fragment in (
        "Mio Paciente",
        "Amoxicilina",
        "Ibuprofeno",
        "COP-111",
        "Clínica Sonrisa",
        issued["number"],
        "Firma y sello",
    ):
        assert fragment in body, fragment
    assert "VOIDED" not in body


@pytest.mark.asyncio
async def test_a_voided_sheet_does_not_print_the_reason_the_date_or_the_actor(api, env, inspect):
    issued = await _issue(api, env)
    voided = await void(api, env, issued["id"], reason="motivo-interno-QA-7731")

    html_out = await html_for(inspect, issued["id"])
    body = text_of(html_out)

    assert "motivo-interno-QA-7731" not in html_out
    assert voided["voided_by"] not in html_out
    assert "Admin Tester" not in body
    stamp = datetime.fromisoformat(voided["voided_at"]).astimezone(UTC)
    assert stamp.strftime("%H:%M:%S") not in html_out
    assert "voided_at" not in html_out and "void_reason" not in html_out


def test_a_voided_sheet_says_voided_in_english_too():
    prescription = stub_prescription(status="voided", items=[stub_item()])
    body = text_of(render_html(build_pdf_context(prescription, logo=None, locale="en")))
    assert "VOIDED" in body and "ANULADA" not in body


def test_an_issued_sheet_carries_no_void_mark():
    html_out = render_html(build_pdf_context(stub_prescription(items=[stub_item()]), logo=None))
    assert 'class="watermark"' not in html_out and 'class="void-banner"' not in html_out
    assert "ANULADA" not in text_of(html_out)


# ===========================================================================
# pages
# ===========================================================================


def long_prescription(count=30):
    return stub_prescription(
        items=[
            stub_item(
                n,
                active_ingredient=f"Medicamento {n}",
                instructions="Indicación larga. " * 25,
            )
            for n in range(1, count + 1)
        ],
    )


def test_long_content_runs_to_several_pages_with_a_short_strip_after_the_first():
    html_out = render_html(build_pdf_context(long_prescription(), logo=None))
    pages = pages_of(html_out)

    assert len(pages) > 1
    first, later = pages[0], pages[1:]
    # the first page is the full document header
    assert "Clínica Uno" in first and "Av. Uno 1, Lima" in first and "RUC / NIF" in first
    assert "Rp/" in first and has_item(first, 1)
    assert f"Página 1 de {len(pages)}" in first
    # the others carry only a short identification, not the clinic again
    for number, page in enumerate(later, start=2):
        assert "RX-2026-000001" in page and "Ana Pérez" in page, number
        assert f"Página {number} de {len(pages)}" in page, number
        assert "Av. Uno 1, Lima" not in page and "RUC / NIF" not in page, number


def test_a_voided_long_document_is_marked_on_every_page():
    prescription = long_prescription()
    prescription.status = "voided"
    pages = pages_of(render_html(build_pdf_context(prescription, logo=None)))

    assert len(pages) > 1
    assert all("ANULADA" in page for page in pages)


def _boxes_by_class(html_content: str, name: str):
    from weasyprint import HTML

    found = []
    for number, page in enumerate(HTML(string=html_content).render().pages):
        for box in page._page_box.descendants():
            element = getattr(box, "element", None)
            classes = (element.get("class") or "").split() if element is not None else []
            if name in classes and getattr(box, "element_tag", "") in {"div", "table"}:
                found.append((number, box))
    return found


def test_the_signature_comes_after_the_last_medication_and_never_over_it():
    html_out = render_html(build_pdf_context(long_prescription(), logo=None))
    signatures = _boxes_by_class(html_out, "signature")
    items = _boxes_by_class(html_out, "item")

    assert len(signatures) == 1 and len(items) == 30
    sig_page, signature = signatures[0]
    last_page, last_item = items[-1]
    # in flow, after the last medication: the same page below it, or a later page
    assert sig_page >= last_page
    if sig_page == last_page:
        assert (
            signature.border_box_y() >= last_item.border_box_y() + last_item.border_height() - 0.5
        )
    # and the last medication does not travel alone to the page before it
    assert sig_page == last_page


def test_no_medication_is_cut_when_it_fits_on_a_page():
    html_out = render_html(build_pdf_context(long_prescription(12), logo=None))
    pages = pages_of(html_out)
    for n in range(1, 13):
        holders = [p for p in pages if has_item(p, n)]
        assert len(holders) == 1


def test_the_prescription_title_never_stays_alone_at_the_end_of_a_page():
    html_out = render_html(build_pdf_context(long_prescription(), logo=None))
    for page in pages_of(html_out):
        if "Rp/" in page:
            assert has_item(page, 1)


def test_a_single_instruction_longer_than_a_page_is_split_not_lost():
    huge = "\n".join(f"Paso número {n}: seguir la pauta indicada." for n in range(1, 160))
    prescription = stub_prescription(items=[stub_item(1, instructions=huge)])
    pages = pages_of(render_html(build_pdf_context(prescription, logo=None)))

    assert len(pages) > 1
    body = " ".join(pages)
    assert "Paso número 1:" in body and "Paso número 159:" in body


@pytest.mark.asyncio
async def test_many_medications_make_a_multi_page_pdf(api, env):
    items = [{**ITEM, "instructions": "Indicación larga. " * 40} for _ in range(30)]
    issued = await _issue(api, env, items=items)

    response = await get_pdf(api, env.dentist, issued["id"])

    assert response.status_code == 200
    assert page_count(response.content) > 1


# ===========================================================================
# no side effects
# ===========================================================================


async def _state(session):
    out = {}
    for table, order in (
        ("prescriptions", "id"),
        ("prescription_items", "id"),
        ("prescription_counters", "clinic_id"),
        ("documents", "id"),
        ("media_attachments", "id"),
    ):
        rows = (await session.execute(text(f"SELECT * FROM {table} ORDER BY {order}"))).all()
        out[table] = [tuple(r) for r in rows]
    return out


@pytest.mark.asyncio
async def test_printing_writes_nothing_anywhere(api, env, inspect, monkeypatch):
    from app.core.events import event_bus

    issued = await _issue(api, env)
    second = await _issue(api, env)
    await void(api, env, second["id"])
    session = inspect()
    before = await _state(session)
    await session.rollback()

    published = []
    monkeypatch.setattr(event_bus, "publish", lambda *a, **k: published.append((a, k)))
    for prescription_id in (issued["id"], second["id"]):
        assert (await get_pdf(api, env.dentist, prescription_id)).status_code == 200
        assert (await get_pdf(api, env.dentist, prescription_id, locale="en")).status_code == 200

    session = inspect()
    after = await _state(session)
    assert after == before
    assert published == []


@pytest.mark.asyncio
async def test_printing_creates_no_files_in_storage(api, env, inspect):
    issued = await _issue(api, env)
    backend = get_storage_backend()
    base = getattr(backend, "base_path", None)
    files_before = sorted(p for p in base.rglob("*") if p.is_file()) if base else None

    await get_pdf(api, env.dentist, issued["id"])

    if base is not None:
        assert sorted(p for p in base.rglob("*") if p.is_file()) == files_before


# ===========================================================================
# the renderer
# ===========================================================================


# The plain-callable fetcher is only used on WeasyPrint < 68, where it is not deprecated.
@pytest.mark.filterwarnings("ignore:default_url_fetcher is deprecated:DeprecationWarning")
def test_only_data_urls_may_be_loaded_while_rendering():
    for forbidden in (
        "http://example.com/x.png",
        "https://example.com/x.png",
        "file:///etc/passwd",
        "ftp://example.com/x",
        "//example.com/x",
    ):
        with pytest.raises(ValueError):
            data_only_url_fetcher(forbidden)

    allowed = data_only_url_fetcher("data:text/plain;base64,aGk=")
    assert allowed is not None


def test_the_renderer_is_configured_with_a_restrictive_fetcher():
    import weasyprint

    fetcher = pdf_module._url_fetcher(weasyprint)
    if hasattr(weasyprint, "URLFetcher"):
        assert isinstance(fetcher, weasyprint.URLFetcher)
        with pytest.raises(Exception):  # noqa: B017
            fetcher.fetch("http://127.0.0.1:9/x.png")
    else:
        assert fetcher is data_only_url_fetcher


def test_an_external_resource_is_never_requested(monkeypatch):
    import urllib.request

    calls = []
    monkeypatch.setattr(urllib.request, "urlopen", lambda *a, **k: calls.append(a))
    html_out = '<html><body><img src="http://127.0.0.1:9/logo.png"><p>texto</p></body></html>'

    pdf_bytes = pdf_module._html_to_pdf(html_out, uuid4())

    assert pdf_bytes.startswith(b"%PDF")
    assert calls == []


@pytest.mark.asyncio
async def test_without_weasyprint_the_answer_is_503_and_never_html(api, env, monkeypatch):
    issued = await _issue(api, env)
    monkeypatch.setitem(sys.modules, "weasyprint", None)

    response = await get_pdf(api, env.dentist, issued["id"])

    assert response.status_code == 503
    assert response.json()["code"] == "pdf_unavailable"
    assert response.headers["content-type"].startswith("application/json")
    assert not response.content.startswith(b"%PDF") and b"<html" not in response.content


@pytest.mark.asyncio
async def test_a_render_failure_is_a_500_with_a_stable_code_and_no_private_text(
    api, env, monkeypatch, caplog
):
    issued = await _issue(api, env)

    def boom(_weasyprint):
        raise RuntimeError("Mio Paciente Amoxicilina exploded")

    monkeypatch.setattr(pdf_module, "_url_fetcher", boom)
    with caplog.at_level(logging.ERROR, logger="app.modules.prescriptions.pdf"):
        response = await get_pdf(api, env.dentist, issued["id"])

    assert response.status_code == 500
    assert response.json()["code"] == "pdf_render_failed"
    assert response.headers["content-type"].startswith("application/json")
    for private in ("Mio", "Amoxicilina", "exploded"):
        assert private not in response.text
    logged = " ".join(r.getMessage() for r in caplog.records)
    assert issued["id"] in logged and "RuntimeError" in logged
    for private in ("Mio", "Amoxicilina", "exploded"):
        assert private not in logged


@pytest.mark.asyncio
async def test_the_service_returns_pdf_bytes_for_a_loaded_prescription(api, env, inspect):
    issued = await _issue(api, env)
    prescription = await load(inspect, issued["id"])
    session = inspect()
    clinic = await session.get(Clinic, env.clinic)

    pdf_bytes = await PrescriptionPDFService.generate_pdf(prescription, clinic, locale="en")

    assert pdf_bytes.startswith(b"%PDF")
