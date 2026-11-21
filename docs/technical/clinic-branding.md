# Clinic branding — the clinic logo

The logo belongs to the **clinic**, not to a document: budgets print it today
and any later document (invoices, prescriptions) can reuse it.

## Storage

* **The file** lives in file storage — `clinics/{clinic_id}/branding/logo-<sha8>.<ext>` —
  through the `media` storage backend (local volume now, object storage later),
  reached via `app.core.storage`. It is **not** a `media.Document` (those require a
  patient) and it is **not** in the database.
* **The reference** is `clinic.settings["branding"]["logo"]`: `path`, `mime_type`,
  `width`, `height`, `size`, `sha256`, `updated_at`. No image, no base64. No migration.
* Each version has its own name, so a replacement never overwrites in place; the previous
  file is deleted after the new one is stored.
* The settings PATCH endpoints accept fixed keys and `branding` is not one of them, and
  every read re-checks that the path is inside this clinic's own `branding/` folder.

## API (`app/core/auth/router.py`)

| Endpoint | Permission | Notes |
|---|---|---|
| `GET /api/v1/auth/clinic/logo` | `admin.clinic.read` | the image; 404 without a logo |
| `POST /api/v1/auth/clinic/logo` | `admin.clinic.write` | multipart `file` |
| `DELETE /api/v1/auth/clinic/logo` | `admin.clinic.write` | idempotent |

`ClinicMetadataResponse.logo` exposes the metadata (never the path). The clinic is always
the caller's own, taken from the request context.

## What an upload must be (`app/core/clinic_branding.py`)

PNG, JPEG or WebP — decided by **decoding** it, not by extension or declared type; at most
1 MB and 2000×2000 px (checked from the header before any pixel is decoded); not animated.
SVG is refused (there is no sanitiser). The image is then **re-encoded**, which drops EXIF
and any trailing bytes. Error `code`s: `too_large` (413), `unsupported_type` (415),
`dimensions`, `unreadable`, `animated`, `empty` (400).

## In a PDF

The logo is embedded as a `data:` URI generated at render time from the stored file (no path
or URL is ever handed to WeasyPrint), in a box of at most **50 × 20 mm** with
`object-fit: contain` and automatic width/height, so it is never stretched. 50 × 20 mm is
chosen against the A4 budget header (170 mm of usable width, a ~55 mm budget block on the
right, ~20 mm of clinic text on the left): a 20 mm logo does not make the header taller. The
settings form recommends 600×240 px (2.5:1, ≈ 300 dpi at that size).

## Signed documents

A document that has been signed does **not** follow the clinic's current branding: the signed
budget PDF is rendered once at acceptance and stored (see the budget module's CLAUDE.md), so
a later logo, name or address change cannot alter it. New documents use the new logo.
