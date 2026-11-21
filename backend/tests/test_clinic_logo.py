"""The clinic logo: upload, preview, replace, delete, and what is refused."""

from __future__ import annotations

import io
from uuid import uuid4

import pytest
from httpx import AsyncClient
from PIL import Image
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth.models import Clinic, ClinicMembership, User
from app.core.auth.service import create_access_token, hash_password
from app.core.clinic_branding import (
    MAX_LOGO_BYTES,
    LogoValidationError,
    normalize_logo,
    read_logo_reference,
)
from app.core.storage import get_storage_backend


def image_bytes(fmt: str, size=(600, 240), color=(20, 100, 200), mode="RGB") -> bytes:
    out = io.BytesIO()
    Image.new(mode, size, color).save(out, fmt)
    return out.getvalue()


def upload(content: bytes, name: str = "logo.png", mime: str = "image/png") -> dict:
    return {"file": (name, content, mime)}


@pytest.fixture
async def logo_world(
    db_session: AsyncSession, auth_headers: dict[str, str], client: AsyncClient
) -> dict:
    """Admin of clinic A (the default test user), a receptionist, and an admin of clinic B."""
    me = await client.get("/api/v1/auth/me", headers=auth_headers)
    admin_id = me.json()["data"]["user"]["id"]

    clinic_a = Clinic(
        id=uuid4(), name="A", tax_id="B11111111", address={}, settings={"slot_duration_min": 15}
    )
    clinic_b = Clinic(
        id=uuid4(), name="B", tax_id="B22222222", address={}, settings={"slot_duration_min": 15}
    )
    db_session.add_all([clinic_a, clinic_b])
    await db_session.flush()
    db_session.add(
        ClinicMembership(id=uuid4(), user_id=admin_id, clinic_id=clinic_a.id, role="admin")
    )

    def make_user(email: str) -> User:
        return User(
            id=uuid4(),
            email=email,
            password_hash=hash_password("TestPass1234"),
            first_name="U",
            last_name="X",
            is_active=True,
        )

    reception = make_user("reception-logo@test.clinic")
    other_admin = make_user("admin-b-logo@test.clinic")
    db_session.add_all([reception, other_admin])
    await db_session.flush()
    db_session.add(
        ClinicMembership(
            id=uuid4(), user_id=reception.id, clinic_id=clinic_a.id, role="receptionist"
        )
    )
    db_session.add(
        ClinicMembership(id=uuid4(), user_id=other_admin.id, clinic_id=clinic_b.id, role="admin")
    )
    await db_session.commit()

    def headers(user: User) -> dict:
        return {
            "Authorization": f"Bearer {create_access_token(user.id, token_version=user.token_version)}"
        }

    return {
        "clinic_a": clinic_a.id,
        "clinic_b": clinic_b.id,
        "reception_headers": headers(reception),
        "other_headers": headers(other_admin),
    }


async def current(db: AsyncSession, clinic_id) -> Clinic:
    db.expire_all()
    return await db.get(Clinic, clinic_id)


# ---------------------------------------------------------------------------
# the happy paths
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_no_logo_at_first(client, auth_headers, logo_world):
    assert (await client.get("/api/v1/auth/clinic/logo", headers=auth_headers)).status_code == 404
    clinics = await client.get("/api/v1/auth/clinics", headers=auth_headers)
    assert clinics.json()["data"][0]["logo"] is None


@pytest.mark.parametrize(
    ("fmt", "mime", "name"),
    [
        ("PNG", "image/png", "l.png"),
        ("JPEG", "image/jpeg", "l.jpg"),
        ("WEBP", "image/webp", "l.webp"),
    ],
)
@pytest.mark.asyncio
async def test_upload_each_allowed_format(
    client, auth_headers, db_session, logo_world, fmt, mime, name
):
    response = await client.post(
        "/api/v1/auth/clinic/logo", headers=auth_headers, files=upload(image_bytes(fmt), name, mime)
    )
    assert response.status_code == 200, response.text
    meta = response.json()["data"]
    assert meta["mime_type"] == mime
    assert (meta["width"], meta["height"]) == (600, 240)
    assert "path" not in meta  # the storage location is never shown to a client

    shown = await client.get("/api/v1/auth/clinic/logo", headers=auth_headers)
    assert shown.status_code == 200
    assert shown.headers["content-type"] == mime
    assert shown.headers["x-content-type-options"] == "nosniff"
    assert Image.open(io.BytesIO(shown.content)).size == (600, 240)

    clinics = await client.get("/api/v1/auth/clinics", headers=auth_headers)
    assert clinics.json()["data"][0]["logo"]["mime_type"] == mime


@pytest.mark.asyncio
async def test_the_file_is_in_storage_and_settings_hold_only_a_reference(
    client, auth_headers, db_session, logo_world
):
    await client.post(
        "/api/v1/auth/clinic/logo", headers=auth_headers, files=upload(image_bytes("PNG"))
    )
    clinic = await current(db_session, logo_world["clinic_a"])
    ref = read_logo_reference(clinic)

    assert ref["path"].startswith(f"clinics/{clinic.id}/branding/")
    assert await get_storage_backend().exists(ref["path"])
    # Metadata only: nothing that looks like the image itself.
    assert set(ref) == {"path", "mime_type", "width", "height", "size", "sha256", "updated_at"}
    assert "base64" not in str(clinic.settings)
    assert max(len(str(v)) for v in ref.values()) < 200


@pytest.mark.asyncio
async def test_replace_swaps_the_file_and_deletes_the_old_one(
    client, auth_headers, db_session, logo_world
):
    await client.post(
        "/api/v1/auth/clinic/logo", headers=auth_headers, files=upload(image_bytes("PNG"))
    )
    first = read_logo_reference(await current(db_session, logo_world["clinic_a"]))

    second_bytes = image_bytes("PNG", size=(300, 120), color=(200, 20, 20))
    await client.post("/api/v1/auth/clinic/logo", headers=auth_headers, files=upload(second_bytes))
    second = read_logo_reference(await current(db_session, logo_world["clinic_a"]))

    assert second["path"] != first["path"]
    assert second["sha256"] != first["sha256"]
    storage = get_storage_backend()
    assert not await storage.exists(first["path"])
    assert await storage.exists(second["path"])
    shown = await client.get("/api/v1/auth/clinic/logo", headers=auth_headers)
    assert Image.open(io.BytesIO(shown.content)).size == (300, 120)


@pytest.mark.asyncio
async def test_delete_removes_file_and_reference_and_is_idempotent(
    client, auth_headers, db_session, logo_world
):
    await client.post(
        "/api/v1/auth/clinic/logo", headers=auth_headers, files=upload(image_bytes("PNG"))
    )
    ref = read_logo_reference(await current(db_session, logo_world["clinic_a"]))

    assert (
        await client.delete("/api/v1/auth/clinic/logo", headers=auth_headers)
    ).status_code == 204
    clinic = await current(db_session, logo_world["clinic_a"])
    assert read_logo_reference(clinic) is None
    assert "branding" not in clinic.settings
    assert not await get_storage_backend().exists(ref["path"])
    assert (await client.get("/api/v1/auth/clinic/logo", headers=auth_headers)).status_code == 404
    assert (
        await client.delete("/api/v1/auth/clinic/logo", headers=auth_headers)
    ).status_code == 204


@pytest.mark.asyncio
async def test_other_settings_survive_a_logo_change(client, auth_headers, db_session, logo_world):
    await client.post(
        "/api/v1/auth/clinic/logo", headers=auth_headers, files=upload(image_bytes("PNG"))
    )
    await client.delete("/api/v1/auth/clinic/logo", headers=auth_headers)
    assert (await current(db_session, logo_world["clinic_a"])).settings["slot_duration_min"] == 15


# ---------------------------------------------------------------------------
# what is refused
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_a_text_file_named_png_is_refused(client, auth_headers, logo_world):
    """The extension and the declared type are not trusted: the content is decoded."""
    response = await client.post(
        "/api/v1/auth/clinic/logo",
        headers=auth_headers,
        files=upload(b"this is not an image at all", "logo.png", "image/png"),
    )
    assert response.status_code == 400
    assert response.json()["code"] == "unreadable"


@pytest.mark.asyncio
async def test_svg_is_refused(client, auth_headers, logo_world):
    svg = b'<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><script>alert(1)</script></svg>'
    for name, mime in (("logo.svg", "image/svg+xml"), ("logo.png", "image/png")):
        response = await client.post(
            "/api/v1/auth/clinic/logo", headers=auth_headers, files=upload(svg, name, mime)
        )
        assert response.status_code == 400, name


@pytest.mark.asyncio
async def test_other_image_formats_are_refused(client, auth_headers, logo_world):
    gif = image_bytes("GIF")
    response = await client.post(
        "/api/v1/auth/clinic/logo", headers=auth_headers, files=upload(gif, "logo.png", "image/png")
    )
    assert response.status_code == 415
    assert response.json()["code"] == "unsupported_type"


@pytest.mark.asyncio
async def test_a_file_over_one_megabyte_is_refused(client, auth_headers, logo_world):
    big = b"\x89PNG\r\n\x1a\n" + b"0" * (MAX_LOGO_BYTES + 10)
    response = await client.post(
        "/api/v1/auth/clinic/logo", headers=auth_headers, files=upload(big)
    )
    assert response.status_code == 413
    assert response.json()["code"] == "too_large"


@pytest.mark.asyncio
async def test_dimensions_over_2000_are_refused(client, auth_headers, logo_world):
    response = await client.post(
        "/api/v1/auth/clinic/logo",
        headers=auth_headers,
        files=upload(image_bytes("PNG", size=(2001, 10))),
    )
    assert response.status_code == 400
    assert response.json()["code"] == "dimensions"
    ok = await client.post(
        "/api/v1/auth/clinic/logo",
        headers=auth_headers,
        files=upload(image_bytes("PNG", size=(2000, 20))),
    )
    assert ok.status_code == 200


@pytest.mark.asyncio
async def test_an_empty_upload_is_refused(client, auth_headers, logo_world):
    response = await client.post(
        "/api/v1/auth/clinic/logo", headers=auth_headers, files=upload(b"")
    )
    assert response.status_code == 400


@pytest.mark.asyncio
async def test_a_failed_upload_leaves_the_current_logo_alone(
    client, auth_headers, db_session, logo_world
):
    await client.post(
        "/api/v1/auth/clinic/logo", headers=auth_headers, files=upload(image_bytes("PNG"))
    )
    before = read_logo_reference(await current(db_session, logo_world["clinic_a"]))
    await client.post("/api/v1/auth/clinic/logo", headers=auth_headers, files=upload(b"junk"))
    after = read_logo_reference(await current(db_session, logo_world["clinic_a"]))
    assert after == before
    assert await get_storage_backend().exists(before["path"])


def test_animated_images_are_refused():
    out = io.BytesIO()
    frames = [Image.new("RGB", (20, 20), c) for c in ((255, 0, 0), (0, 255, 0))]
    frames[0].save(out, "WEBP", save_all=True, append_images=frames[1:], duration=50)
    with pytest.raises(LogoValidationError) as error:
        normalize_logo(out.getvalue())
    assert error.value.code == "animated"


def test_metadata_is_stripped_by_re_encoding():
    out = io.BytesIO()
    image = Image.new("RGB", (40, 40), (10, 10, 10))
    exif = Image.Exif()
    exif[0x010E] = "SECRET DESCRIPTION"
    image.save(out, "JPEG", exif=exif)
    assert b"SECRET DESCRIPTION" in out.getvalue()
    stored = normalize_logo(out.getvalue()).data
    assert b"SECRET DESCRIPTION" not in stored


def test_the_stored_bytes_are_ours_not_the_upload():
    raw = image_bytes("PNG") + b"TRAILING-GARBAGE-OR-PAYLOAD"
    logo = normalize_logo(raw)
    assert b"TRAILING-GARBAGE-OR-PAYLOAD" not in logo.data
    assert logo.data != raw


# ---------------------------------------------------------------------------
# who may, and whose
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_only_clinic_admins_may_change_or_read_it(client, auth_headers, logo_world):
    await client.post(
        "/api/v1/auth/clinic/logo", headers=auth_headers, files=upload(image_bytes("PNG"))
    )
    headers = logo_world["reception_headers"]
    assert (
        await client.post(
            "/api/v1/auth/clinic/logo", headers=headers, files=upload(image_bytes("PNG"))
        )
    ).status_code == 403
    assert (await client.delete("/api/v1/auth/clinic/logo", headers=headers)).status_code == 403
    assert (await client.get("/api/v1/auth/clinic/logo", headers=headers)).status_code == 403


@pytest.mark.asyncio
async def test_unauthenticated_requests_are_refused(client, logo_world):
    assert (await client.get("/api/v1/auth/clinic/logo")).status_code in (401, 403)
    assert (
        await client.post("/api/v1/auth/clinic/logo", files=upload(image_bytes("PNG")))
    ).status_code in (401, 403)


@pytest.mark.asyncio
async def test_another_clinic_cannot_see_or_touch_it(client, auth_headers, db_session, logo_world):
    await client.post(
        "/api/v1/auth/clinic/logo", headers=auth_headers, files=upload(image_bytes("PNG"))
    )
    ref = read_logo_reference(await current(db_session, logo_world["clinic_a"]))

    other = logo_world["other_headers"]
    assert (await client.get("/api/v1/auth/clinic/logo", headers=other)).status_code == 404
    # Deleting "the logo" from clinic B deletes B's (none), never A's.
    assert (await client.delete("/api/v1/auth/clinic/logo", headers=other)).status_code == 204
    assert await get_storage_backend().exists(ref["path"])
    clinics = await client.get("/api/v1/auth/clinics", headers=other)
    assert clinics.json()["data"][0]["logo"] is None


@pytest.mark.asyncio
async def test_a_tampered_reference_is_never_followed(db_session, logo_world):
    """A path outside this clinic's own branding folder is ignored."""
    clinic_a = await db_session.get(Clinic, logo_world["clinic_a"])
    clinic_b = await db_session.get(Clinic, logo_world["clinic_b"])
    for bad in (
        f"clinics/{clinic_a.id}/branding/logo-x.png",  # another clinic's folder
        f"clinics/{clinic_b.id}/branding/../../{clinic_a.id}/branding/x.png",  # traversal
        "../../etc/passwd",
        "budget-signed/x.pdf",
    ):
        clinic_b.settings = {"branding": {"logo": {"path": bad, "mime_type": "image/png"}}}
        assert read_logo_reference(clinic_b) is None, bad
