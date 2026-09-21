# NTS N.° 188 — printing the odontogram

Reference for the official print of the MINSA Perú odontogram. Everything
below is either quoted from the norm or measured from its annex; where a
choice was DenPlant's, it says so.

Source: *NTS N.° 188-MINSA/DGIESP-2022, Norma Técnica de Salud para el uso del
odontograma*. The PDF is a pure scan; the annex figures here were measured at
300 dpi from the page image.

## 1. What the norm actually fixes

| § | Requirement | Consequence |
|---|---|---|
| **5.17** | "El gráfico … es único y **se imprime en color negro**, con las siguientes dimensiones: la corona tiene como mínimo **0.5 cm cuadrados** y la raíz es proporcional a esta." | The only dimensional requirement in the document. Structure prints black. |
| **5.12** | Siglas in the annotation boxes are **blue** for a good state or non-pathological characteristic, **red** for a bad state, a temporary one, or a pathological characteristic. | |
| **5.13** | "Para graficar los hallazgos clínicos … **sólo se deben utilizar los colores rojo y azul**." | Colour carries clinical meaning. Greyscale printing destroys it. |
| **5.14** | *Especificaciones* holds findings that did not fit in the boxes. | The norm's own remedy for box overflow. |
| **5.15** | *Observaciones* describes findings **outside the nomenclature**. | Not a dumping ground for findings the nomenclature *does* cover. |
| **5.6** | A recorded finding is "inalterable, sin enmendaduras, ni tachaduras". | A draft print must never read as the record in force. |
| **5.2** | The odontogram **forms part of** the Ficha Odonto-Estomatológica, contained in the historia clínica. | The graphic is embedded in another document. |
| **5.3** | The cirujano dentista is responsible for the data and **"firma y sella la Ficha Odonto-Estomatológica"**. | The signature belongs to the Ficha, not to this graphic. |
| **5.9** | Records must respect "la ubicación y forma de los hallazgos". | Print must not distort the drawing to fit. |

The norm says **nothing** about paper size, orientation, margins, typeface,
a patient header inside the annex, or archiving the odontogram as a standalone
file.

## 2. Structure of the annex (printed p.22)

A4 portrait (measured 210.0 × 296.9 mm). Blocks, top to bottom:

1. Running header with the norm's title
2. Title *ANEXO: GRÁFICO DEL ODONTOGRAMA*
3. **`FECHA:`** — a label alone, right-aligned. The only metadata field.
4. A box containing the word *ODONTOGRAMA*
5. Permanent upper — boxes, FDI `18…28`, teeth (apices up)
6. Deciduous upper — boxes, FDI `55…65`, teeth
7. Deciduous lower — teeth, FDI `85…75`, boxes
8. Permanent lower — teeth, FDI `48…38`, boxes
9. **`Especificaciones:`** + 5 ruled lines
10. **`Observaciones:`** + 5 ruled lines
11. Source line, page number

Annotation boxes always sit on the **outer** side, with the FDI number between
the box and the tooth.

There is **no patient block and no signature block** — consistent with §5.2
and §5.3.

### Measured geometry

| | annex | DenPlant at 1:1 CSS px |
|---|---|---|
| permanent arch width | 113.0 mm | **170.9 mm** |
| chart height (4 rows) | 141.2 mm | **154.0 mm** |
| molar crown | 8.00 × 5.76 mm = **0.46 cm²** | 11.27 × 8.71 mm = **0.98 cm²** |
| incisor crown | 5.80 × 5.71 mm = **0.33 cm²** | 7.81 × 8.71 mm = **0.68 cm²** |
| cell pitch | molar ≈8.0, premolar ≈7.4, anterior ≈5.7 mm | class-proportional, same ordering |

Two things follow.

**The annex as printed does not satisfy its own §5.17** — no crown on it
reaches 0.5 cm². The scanned annex therefore cannot be used as a dimensional
authority; §5.17's figure is a floor to meet, not a measurement to copy.

**DenPlant's chart already meets §5.17 at 1:1**, with ~2× headroom on molars
and ~1.4× on incisors, and fits A4 portrait (190 × 275 mm printable at 10 mm
margins) with 19 mm of width and 121 mm of height to spare.

> **Minimum safe print scale: 0.86.** The incisor is the binding constraint
> (0.68 cm² × f² ≥ 0.50 → f ≥ 0.857); the molar tolerates 0.71. Anything below
> 0.86 breaks §5.17. 05F.2 introduces the print scale and must add the
> assertion that guards it; there is no such test yet.

## 3. Level of fidelity

**Structural equivalence, not a pixel copy.** The only binding dimensional and
colour requirements are §5.17 and §5.12–5.13; the annex's margins, indentation
and ruled lines are the layout of a form meant to be filled in by hand, and
§5.2 says the graphic is embedded in another document anyway. Reproducing the
ruled lines under text that is already written would either leave empty lines
under the text or imply a length limit that does not exist.

The block is preserved even when empty ("Sin especificaciones registradas.") —
a missing block cannot be told apart from one nobody filled in.

## 4. Decisions that are DenPlant's, not the norm's

| decision | rationale |
|---|---|
| Patient header (name, document, date) **outside** the normative area | The annex has none; a loose sheet still has to be matchable to a person. |
| **No** "Firma y sello" line | §5.3 puts it on the Ficha. Printing one here would imply this sheet is the signed document. |
| Professional identification from `recorded_by_name` / `_role` / `_professional_id` | §5.3 names the dentist who *records*. `finalized_by` may be a different person and is never printed as the professional. |
| Technical footer: record id, norm version, status, **full** content hash | Traceability. Labelled *Huella de contenido*, never "firma digital", "certificado" or any claim of legal validity. Never truncated — half a digest attests nothing. |
| Incompletely drawn findings declared as a **system note**, after *Observaciones* | Keeps DenPlant content out from between the annex's three blocks, while ensuring a tooth whose finding was not drawn never reads as a tooth with nothing found. |
| Draft and discarded records are printable, but qualified | §5.6 makes a recorded finding inalterable; a working copy must not be mistakable for the document. Refusing to print would only produce screenshots. |

## 5. Never

- **Never** write to the record to represent a gap. Appending to
  `observations` would author clinical text under a clinician's name and move
  the content hash of a finalized document.
- **Never** route findings that *are* in the nomenclature (fracture,
  giroversión, sealant) to *Observaciones* as a recommendation: §5.15 is for
  findings **outside** the nomenclature. What the clinician writes there is
  the clinician's decision.
- **Never** print an editor buffer. Unsaved text has not been recorded.
- **Never** fall back to another norm's catalog, and **never** treat "a
  catalog is present" as sufficient. `ruleFor` matches by `rule_id` alone and
  rule ids are stable across revisions, so a catalog for a *different* norm
  draws the wrong marks rather than none. The record's `norm_version` and the
  catalog's must be equal before anything clinical is rendered
  (`canRenderPrintRecord`); otherwise the page prints nothing.
- **Never** render a missing field as a dash. An omitted row and "—" make
  different claims.

## 6. Implementation

| slice | scope | status |
|---|---|---|
| **05F.1** | print data + DOM: `ntsPrintModel.ts`, `useNtsPrintIdentity.ts`, `NtsOdontogramPrintView.vue` | done |
| **05F.2** | `@page`, margins, `print-color-adjust`, screen-only inventory, page breaks | pending |
| **05F.3** | trigger, eligibility banners, draft watermark, pre-print advisories | pending |
| **05F.4** | long-text policy, browser PDF QA, final regression | pending |

Colour tokens for print are already pinned in `frontend/app/assets/css/main.css`
(`#0000CC` / `#CC0000` under `@media print`), independent of theme.

The printed page reuses `NtsOdontogramChart` and therefore the whole clinical
renderer. There is no print renderer and must not be one: a second way of
drawing a tooth is a second clinical opinion about that tooth.
