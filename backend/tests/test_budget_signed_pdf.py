# ruff: noqa: F811  (the imported ``pdf_setup`` fixture is used as a parameter)
"""The signed budget PDF is a stored, immutable record.

Accepting a budget renders its signed PDF once, stores the bytes, and records
their SHA-256 and location on the signature. Downloads return those bytes, so a
later change of logo, name, address or template cannot touch a document already
signed. Signatures that predate this are left exactly as they were, and say so.
"""

from __future__ import annotations

import hashlib
import re
from uuid import UUID

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth.models import Clinic
from app.core.clinic_branding import save_logo
from app.core.storage import get_storage_backend
from app.modules.budget import pdf as pdf_module
from app.modules.budget.models import Budget, BudgetSignature
from app.modules.budget.pdf import BudgetPDFService, build_pdf_context, render_html
from app.modules.budget.signed_pdf import (
    SIGNED_PDF_KEY,
    read_reference,
    signed_pdf_path,
    strip_client_reference,
)

from .test_budget_pdf import load, make_budget, pdf_setup, png  # noqa: F401


async def accept(client: AsyncClient, headers: dict, budget_id: str, **signature) -> None:
    sent = await client.post(f"/api/v1/budget/budgets/{budget_id}/send", json={}, headers=headers)
    assert sent.status_code == 200, sent.text
    accepted = await client.post(
        f"/api/v1/budget/budgets/{budget_id}/accept",
        json={
            "signature": {
                "signed_by_name": "Ana García",
                "relationship_to_patient": "patient",
                **signature,
            }
        },
        headers=headers,
    )
    assert accepted.status_code == 200, accepted.text


async def signature_of(db: AsyncSession, budget_id: str) -> BudgetSignature:
    db.expire_all()
    result = await db.execute(
        select(BudgetSignature).where(BudgetSignature.budget_id == UUID(budget_id))
    )
    return result.scalar_one()


async def signed_pdf(client: AsyncClient, headers: dict, budget_id: str):
    return await client.get(f"/api/v1/budget/budgets/{budget_id}/pdf/signed", headers=headers)


async def accepted_budget(client, headers, db, setup) -> str:
    clinic = await db.get(Clinic, setup["clinic_id"])
    await save_logo(clinic, png(600, 240, (200, 30, 30)))  # logo A
    await db.commit()
    budget_id = await make_budget(
        client,
        headers,
        setup,
        [
            {
                "catalog_item_id": setup["taxed"],
                "quantity": 2,
                "unit_price": "100",
                "tooth_number": 36,
            }
        ],
    )
    await accept(client, headers, budget_id)
    return budget_id


# ===========================================================================
# at acceptance
# ===========================================================================


@pytest.mark.asyncio
async def test_acceptance_stores_the_pdf_and_records_hash_and_location(
    client, auth_headers, db_session, pdf_setup
):
    budget_id = await accepted_budget(client, auth_headers, db_session, pdf_setup)
    signature = await signature_of(db_session, budget_id)

    ref = read_reference(signature)
    assert ref is not None
    assert ref["path"] == signed_pdf_path(signature.clinic_id, signature.budget_id, signature.id)
    stored = await get_storage_backend().retrieve(ref["path"])

    assert stored.startswith(b"%PDF")
    assert signature.document_hash == hashlib.sha256(stored).hexdigest()
    assert ref["sha256"] == signature.document_hash
    assert ref["size"] == len(stored)


@pytest.mark.asyncio
async def test_the_hash_is_not_inside_the_bytes_it_hashes(
    client, auth_headers, db_session, pdf_setup
):
    budget_id = await accepted_budget(client, auth_headers, db_session, pdf_setup)
    signature = await signature_of(db_session, budget_id)
    budget, clinic = await load(db_session, pdf_setup, budget_id)

    html_out = render_html(await build_pdf_context(budget, clinic, signature=signature))
    assert signature.document_hash not in html_out
    assert not re.search(r"\b[0-9a-f]{64}\b", html_out)  # no digest of any kind
    assert "SHA-256" in html_out  # it says where the evidence is kept instead


@pytest.mark.asyncio
async def test_a_signed_pdf_renders_the_same_text_every_time(
    client, auth_headers, db_session, pdf_setup
):
    """No 'now' in a signed document: its footer carries the moment of signing."""
    budget_id = await accepted_budget(client, auth_headers, db_session, pdf_setup)
    signature = await signature_of(db_session, budget_id)
    budget, clinic = await load(db_session, pdf_setup, budget_id)

    first = render_html(await build_pdf_context(budget, clinic, signature=signature))
    second = render_html(await build_pdf_context(budget, clinic, signature=signature))
    assert first == second
    assert signature.signed_at.strftime("%d/%m/%Y %H:%M") in first


@pytest.mark.asyncio
async def test_a_client_supplied_reference_is_never_believed(
    client, auth_headers, db_session, pdf_setup
):
    clinic = await db_session.get(Clinic, pdf_setup["clinic_id"])
    await db_session.commit()
    budget_id = await make_budget(
        client, auth_headers, pdf_setup, [{"catalog_item_id": pdf_setup["exempt"]}]
    )
    forged = {"path": "../../etc/passwd", "sha256": "0" * 64, "size": 1}
    await accept(
        client, auth_headers, budget_id, signature_data={SIGNED_PDF_KEY: forged, "keep": 1}
    )

    signature = await signature_of(db_session, budget_id)
    ref = read_reference(signature)
    assert ref is not None and ref["path"] != forged["path"]  # replaced by the real one
    assert signature.signature_data["keep"] == 1  # the client's other keys are untouched
    assert strip_client_reference({SIGNED_PDF_KEY: forged, "a": 1}) == {"a": 1}
    del clinic


def test_a_reference_to_any_other_path_is_ignored():
    signature = BudgetSignature(
        id=UUID(int=1),
        clinic_id=UUID(int=2),
        budget_id=UUID(int=3),
        signature_data={SIGNED_PDF_KEY: {"path": "budget-signed/other.pdf"}},
    )
    assert read_reference(signature) is None


# ===========================================================================
# immutability
# ===========================================================================


@pytest.mark.asyncio
async def test_changing_the_clinic_does_not_change_a_signed_document(
    client, auth_headers, db_session, pdf_setup, monkeypatch
):
    budget_id = await accepted_budget(client, auth_headers, db_session, pdf_setup)  # logo A
    signature = await signature_of(db_session, budget_id)

    first = await signed_pdf(client, auth_headers, budget_id)
    assert first.status_code == 200
    assert first.headers["x-document-source"] == "stored"
    assert hashlib.sha256(first.content).hexdigest() == signature.document_hash

    # The clinic changes everything it can: logo B, name, legal name, address, template.
    clinic = await db_session.get(Clinic, pdf_setup["clinic_id"])
    await save_logo(clinic, png(300, 300, (20, 20, 220)))  # logo B
    clinic.name = "Otro Nombre Distinto"
    clinic.legal_name = "Otra Razón Social S.A."
    clinic.tax_id = "A99999999"
    clinic.address = {"street": "Otra calle 99", "city": "Sevilla"}
    await db_session.commit()
    monkeypatch.setattr(pdf_module, "_CSS", pdf_module._CSS + " body { background: #ff00ff; }")

    second = await signed_pdf(client, auth_headers, budget_id)
    assert second.status_code == 200
    assert second.headers["x-document-source"] == "stored"
    assert second.content == first.content  # byte for byte
    assert hashlib.sha256(second.content).hexdigest() == signature.document_hash
    assert b"/Subtype /Image" in second.content  # it still carries logo A


@pytest.mark.asyncio
async def test_a_new_budget_after_the_change_uses_the_new_logo(
    client, auth_headers, db_session, pdf_setup
):
    clinic = await db_session.get(Clinic, pdf_setup["clinic_id"])
    await save_logo(clinic, png(600, 240, (200, 30, 30)))
    await db_session.commit()
    first_id = await make_budget(
        client, auth_headers, pdf_setup, [{"catalog_item_id": pdf_setup["exempt"]}]
    )
    budget, clinic = await load(db_session, pdf_setup, first_id)
    logo_a = (await build_pdf_context(budget, clinic)).clinic.logo

    await save_logo(clinic, png(300, 300, (20, 20, 220)))
    clinic.name = "Nombre Nuevo"
    await db_session.commit()
    second_id = await make_budget(
        client, auth_headers, pdf_setup, [{"catalog_item_id": pdf_setup["exempt"]}]
    )
    budget, clinic = await load(db_session, pdf_setup, second_id)
    ctx = await build_pdf_context(budget, clinic)

    assert ctx.clinic.logo is not None
    assert ctx.clinic.logo != logo_a
    assert ctx.clinic.name == "Nombre Nuevo"
    assert "Nombre Nuevo" in render_html(ctx)

    # The unsigned PDF of the first budget, drawn now, also follows the clinic.
    budget, clinic = await load(db_session, pdf_setup, first_id)
    assert (await build_pdf_context(budget, clinic)).clinic.logo == ctx.clinic.logo


# ===========================================================================
# integrity
# ===========================================================================


@pytest.mark.asyncio
async def test_a_tampered_stored_file_is_not_served(client, auth_headers, db_session, pdf_setup):
    budget_id = await accepted_budget(client, auth_headers, db_session, pdf_setup)
    signature = await signature_of(db_session, budget_id)
    ref = read_reference(signature)
    original = await get_storage_backend().retrieve(ref["path"])
    await get_storage_backend().store(original + b"\n%tampered", ref["path"])

    response = await signed_pdf(client, auth_headers, budget_id)
    assert response.status_code == 500
    assert b"%tampered" not in response.content


@pytest.mark.asyncio
async def test_a_missing_stored_file_is_an_error_not_a_substitute(
    client, auth_headers, db_session, pdf_setup
):
    budget_id = await accepted_budget(client, auth_headers, db_session, pdf_setup)
    signature = await signature_of(db_session, budget_id)
    await get_storage_backend().delete(read_reference(signature)["path"])

    response = await signed_pdf(client, auth_headers, budget_id)
    assert response.status_code == 500  # never silently a freshly rendered, different document


# ===========================================================================
# legacy signatures
# ===========================================================================


@pytest.fixture
def pdf_render_fails(monkeypatch):
    """A render failure at acceptance: the signature ends up with no stored PDF."""

    async def boom(*args, **kwargs):
        raise RuntimeError("no fonts")

    original = BudgetPDFService.generate_pdf
    monkeypatch.setattr(BudgetPDFService, "generate_pdf", boom)
    yield
    monkeypatch.setattr(BudgetPDFService, "generate_pdf", original)


@pytest.mark.asyncio
async def test_a_failed_render_does_not_block_the_acceptance(
    client, auth_headers, db_session, pdf_setup, pdf_render_fails
):
    budget_id = await make_budget(
        client, auth_headers, pdf_setup, [{"catalog_item_id": pdf_setup["exempt"]}]
    )
    await accept(client, auth_headers, budget_id)

    db_session.expire_all()
    budget = await db_session.get(Budget, UUID(budget_id))
    assert budget.status == "accepted"
    signature = await signature_of(db_session, budget_id)
    assert signature.document_hash is None  # no hash invented
    assert read_reference(signature) is None


@pytest.mark.asyncio
async def test_a_legacy_signature_is_untouched_and_falls_back_explicitly(
    client, auth_headers, db_session, pdf_setup, monkeypatch
):
    original_generate = BudgetPDFService.generate_pdf

    async def boom(*args, **kwargs):
        raise RuntimeError("no fonts")

    monkeypatch.setattr(BudgetPDFService, "generate_pdf", boom)
    budget_id = await make_budget(
        client,
        auth_headers,
        pdf_setup,
        [{"catalog_item_id": pdf_setup["taxed"], "unit_price": "100"}],
    )
    await accept(client, auth_headers, budget_id)
    monkeypatch.setattr(BudgetPDFService, "generate_pdf", original_generate)

    before = await signature_of(db_session, budget_id)
    snapshot = (before.document_hash, dict(before.signature_data or {}))

    # Staff download: rendered on the fly, and the response says so.
    response = await signed_pdf(client, auth_headers, budget_id)
    assert response.status_code == 200
    assert response.headers["x-document-source"] == "regenerated"
    assert response.content.startswith(b"%PDF")

    # Nothing was written to the signature by serving it, and no hash appeared.
    after = await signature_of(db_session, budget_id)
    assert (after.document_hash, dict(after.signature_data or {})) == snapshot
    assert after.document_hash is None
    assert SIGNED_PDF_KEY not in (after.signature_data or {})

    # The metadata endpoint reports no hash rather than a false one.
    meta = await client.get(f"/api/v1/budget/budgets/{budget_id}/signature", headers=auth_headers)
    assert meta.json()["data"]["document_hash"] is None


@pytest.mark.asyncio
async def test_a_legacy_signature_with_drawn_png_still_renders(
    client, auth_headers, db_session, pdf_setup, pdf_render_fails
):
    budget_id = await make_budget(
        client, auth_headers, pdf_setup, [{"catalog_item_id": pdf_setup["exempt"]}]
    )
    tiny = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
    await accept(
        client, auth_headers, budget_id, signature_method="drawn", signature_data={"png": tiny}
    )
    signature = await signature_of(db_session, budget_id)
    budget, clinic = await load(db_session, pdf_setup, budget_id)

    ctx = await build_pdf_context(budget, clinic, signature=signature)
    assert ctx.signature.image == tiny
    assert tiny in render_html(ctx)


@pytest.mark.asyncio
async def test_a_drawn_signature_that_is_not_an_image_is_not_embedded(
    client, auth_headers, db_session, pdf_setup, pdf_render_fails
):
    budget_id = await make_budget(
        client, auth_headers, pdf_setup, [{"catalog_item_id": pdf_setup["exempt"]}]
    )
    hostile = 'data:image/png;base64,AAAA" onerror="alert(1)'
    await accept(
        client, auth_headers, budget_id, signature_method="drawn", signature_data={"png": hostile}
    )
    signature = await signature_of(db_session, budget_id)
    budget, clinic = await load(db_session, pdf_setup, budget_id)

    ctx = await build_pdf_context(budget, clinic, signature=signature)
    assert ctx.signature.image is None
    assert "onerror" not in render_html(ctx)


# ===========================================================================
# the public route (the one that used to fail on a partial clinic)
# ===========================================================================


@pytest.mark.asyncio
async def test_public_signed_pdf_returns_the_stored_bytes(
    client, auth_headers, db_session, pdf_setup
):
    budget_id = await accepted_budget(client, auth_headers, db_session, pdf_setup)
    signature = await signature_of(db_session, budget_id)
    budget = await db_session.get(Budget, UUID(budget_id))
    budget.public_auth_method = "none"  # no cookie challenge for this test
    await db_session.commit()
    token = budget.public_token

    first = await client.get(f"/api/v1/budget/public/budgets/{token}/pdf/signed")
    assert first.status_code == 200, first.text
    assert first.headers["x-document-source"] == "stored"
    assert hashlib.sha256(first.content).hexdigest() == signature.document_hash

    # Change the clinic: the public copy is the same document.
    clinic = await db_session.get(Clinic, pdf_setup["clinic_id"])
    clinic.name = "Cambiado"
    await save_logo(clinic, png(200, 200, (0, 0, 0)))
    await db_session.commit()
    second = await client.get(f"/api/v1/budget/public/budgets/{token}/pdf/signed")
    assert second.content == first.content

    # And it is the very file staff download.
    staff = await signed_pdf(client, auth_headers, budget_id)
    assert staff.content == first.content


@pytest.mark.asyncio
async def test_public_legacy_signed_pdf_renders_instead_of_failing(
    client, auth_headers, db_session, pdf_setup, monkeypatch
):
    """The pre-fix failure: a partial clinic row made this a 500."""
    original_generate = BudgetPDFService.generate_pdf

    async def boom(*args, **kwargs):
        raise RuntimeError("no fonts")

    monkeypatch.setattr(BudgetPDFService, "generate_pdf", boom)
    budget_id = await make_budget(
        client, auth_headers, pdf_setup, [{"catalog_item_id": pdf_setup["exempt"]}]
    )
    await accept(client, auth_headers, budget_id)
    monkeypatch.setattr(BudgetPDFService, "generate_pdf", original_generate)

    budget = await db_session.get(Budget, UUID(budget_id))
    budget.public_auth_method = "none"
    await db_session.commit()

    response = await client.get(f"/api/v1/budget/public/budgets/{budget.public_token}/pdf/signed")
    assert response.status_code == 200, response.text
    assert response.headers["x-document-source"] == "regenerated"
    assert response.content.startswith(b"%PDF")


# ===========================================================================
# the other PDF routes get the same, complete clinic
# ===========================================================================


@pytest.mark.asyncio
async def test_unsigned_and_preview_pdfs_render_with_the_clinic_currency(
    client, auth_headers, db_session, pdf_setup
):
    budget_id = await make_budget(
        client,
        auth_headers,
        pdf_setup,
        [{"catalog_item_id": pdf_setup["taxed"], "unit_price": "100"}],
    )
    for route in ("pdf", "pdf/preview"):
        response = await client.get(
            f"/api/v1/budget/budgets/{budget_id}/{route}", headers=auth_headers
        )
        assert response.status_code == 200, (route, response.text)
        assert response.content.startswith(b"%PDF")


@pytest.mark.asyncio
async def test_unsigned_pdf_does_not_change_the_acceptance_flow(
    client, auth_headers, db_session, pdf_setup
):
    """Accepting still publishes, still moves the status, still has one signature."""
    budget_id = await accepted_budget(client, auth_headers, db_session, pdf_setup)
    detail = await client.get(f"/api/v1/budget/budgets/{budget_id}", headers=auth_headers)
    assert detail.json()["data"]["status"] == "accepted"
    signatures = (
        (
            await db_session.execute(
                select(BudgetSignature).where(BudgetSignature.budget_id == UUID(budget_id))
            )
        )
        .scalars()
        .all()
    )
    assert len(signatures) == 1
