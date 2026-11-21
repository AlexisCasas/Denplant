"""Regression coverage for dentist financial-data redaction."""

import json

import pytest
from starlette.requests import Request
from starlette.responses import StreamingResponse

from app.core.auth.financial_visibility import strip_financial_fields
from app.main import financial_response_middleware


def test_dentist_json_removes_nested_amounts_but_keeps_clinical_and_pagination_data() -> None:
    payload = {
        "data": [
            {
                "plan_number": "TP-42",
                "total": 1234.56,
                "budget": {"total": 1234.56},
                "items": [
                    {
                        "status": "pending",
                        "treatment": {"clinical_type": "crown", "price_snapshot": 987.65},
                        "sessions": [{"label": "Preparación", "amount": 321.09}],
                    }
                ],
            }
        ],
        "total": 1,
        "page": 1,
        "page_size": 20,
    }

    result = strip_financial_fields(payload)

    assert result == {
        "data": [
            {
                "plan_number": "TP-42",
                "budget": {},
                "items": [
                    {
                        "status": "pending",
                        "treatment": {"clinical_type": "crown"},
                        "sessions": [{"label": "Preparación"}],
                    }
                ],
            }
        ],
        "total": 1,
        "page": 1,
        "page_size": 20,
    }


def test_dentist_json_removes_catalog_and_appointment_treatment_prices() -> None:
    payload = {
        "data": {
            "default_price": 650.75,
            "cost_price": 221.10,
            "sessions": [{"default_price": 325.37, "label": "Sesión 1"}],
            "treatments": [{"default_price": 650.75, "tooth_number": 16}],
        }
    }

    assert strip_financial_fields(payload) == {
        "data": {
            "sessions": [{"label": "Sesión 1"}],
            "treatments": [{"tooth_number": 16}],
        }
    }


def test_dentist_json_removes_amount_variants_and_pricing_configuration() -> None:
    payload = {
        "data": {
            "discount_amount": 71.21,
            "amount_paid": 200.00,
            "income": 310.00,
            "pricing_config": {"per_tooth": 101.25},
            "surface_prices": {"1": 101.25},
            "clinical_type": "filling",
        }
    }

    assert strip_financial_fields(payload) == {"data": {"clinical_type": "filling"}}


def _request() -> Request:
    return Request({"type": "http", "method": "GET", "path": "/", "headers": []})


async def _body(response: StreamingResponse) -> bytes:
    if hasattr(response, "body"):
        return response.body
    return b"".join([chunk async for chunk in response.body_iterator])


@pytest.mark.asyncio
async def test_middleware_preserves_http_contract_while_redacting_valid_json() -> None:
    request = _request()
    request.state.hide_financial_amounts = True

    async def call_next(_: Request) -> StreamingResponse:
        return StreamingResponse(
            iter([b'{"data":{"clinical_type":"crown","price":137.45}}']),
            status_code=201,
            media_type="application/json",
            headers={"X-Test": "kept"},
        )

    response = await financial_response_middleware(request, call_next)
    body = await _body(response)

    assert response.status_code == 201
    assert response.headers["content-type"].startswith("application/json")
    assert response.headers["x-test"] == "kept"
    assert json.loads(body) == {"data": {"clinical_type": "crown"}}
    assert int(response.headers["content-length"]) == len(body)


@pytest.mark.asyncio
async def test_middleware_leaves_unmarked_errors_and_non_json_untouched() -> None:
    request = _request()

    async def unauthorized(_: Request) -> StreamingResponse:
        return StreamingResponse(iter([b'{"detail":"Unauthorized"}']), status_code=401, media_type="application/json")

    response = await financial_response_middleware(request, unauthorized)
    assert response.status_code == 401
    assert json.loads(await _body(response)) == {"detail": "Unauthorized"}

    request.state.hide_financial_amounts = True

    async def pdf(_: Request) -> StreamingResponse:
        return StreamingResponse(iter([b"%PDF-test"]), media_type="application/pdf")

    response = await financial_response_middleware(request, pdf)
    assert response.headers["content-type"].startswith("application/pdf")
    assert await _body(response) == b"%PDF-test"


@pytest.mark.asyncio
async def test_middleware_preserves_malformed_json_body_after_inspection() -> None:
    request = _request()
    request.state.hide_financial_amounts = True

    async def call_next(_: Request) -> StreamingResponse:
        return StreamingResponse(iter([b"not-json"]), status_code=502, media_type="application/json")

    response = await financial_response_middleware(request, call_next)
    body = await _body(response)
    assert response.status_code == 502
    assert body == b"not-json"
    assert int(response.headers["content-length"]) == len(body)
