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

DenPlant's figures below are read from `ntsChartGeometry.crownBox()` — the
placement model the chart is actually drawn from — not from the layout
constants. The two differ: each tooth's SVG is fitted into its cell with
`preserveAspectRatio="xMidYMid meet"`, so the effective crown is a little
smaller than crown-width × chart-scale suggests. The placement model is the
authority.

| | annex | DenPlant at 1:1 CSS px |
|---|---|---|
| permanent arch width | 113.0 mm | **170.9 mm** |
| chart height (4 rows) | 141.2 mm | **154.1 mm** |
| molar crown | 8.00 × 5.76 mm = **0.46 cm²** | 10.39 × 8.03 mm = **0.835 cm²** |
| premolar crown | 7.40 × 5.50 mm = **0.41 cm²** | 9.63 × 7.99 mm = **0.770 cm²** |
| anterior crown | 5.80 × 5.71 mm = **0.33 cm²** | 6.99 × 7.79 mm = **0.545 cm²** |
| cell pitch | molar ≈8.0, premolar ≈7.4, anterior ≈5.7 mm | class-proportional, same ordering |

Two things follow.

**The annex as printed does not satisfy its own §5.17** — no crown on it
reaches 0.5 cm². The scanned annex therefore cannot be used as a dimensional
authority; §5.17's figure is a floor to meet, not a measurement to copy.

**DenPlant's chart meets §5.17 at 1:1**, and fits A4 portrait (190 × 275 mm
printable at 10 mm margins) with 19 mm of width and 121 mm of height to spare.

> **Minimum safe print scale: 0.958**, derived over all 52 teeth by
> `minimumSafePrintScale()` and asserted by `ntsPrintLayout.spec.ts`. The
> binding constraint is the **anterior** crown at 0.545 cm², which clears
> §5.17 by only 9 % of area — about 4 % of linear scale. The molar tolerates
> 0.77.
>
> The practical consequence: **the sheet must print at 100 %.** Chrome's
> "Fit to printable area" or any manual shrink below ~96 % produces a
> document that does not satisfy the norm. This is why the print stylesheet
> uses no `transform: scale()` and why the chart is sized to fit the page
> outright rather than being scaled into it.

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

## 4b. How the sheet is isolated

The printed document is teleported to `<body>` as `.nts-print-root`, and the
print stylesheet hides every other child of `<body>`:

```css
@media print {
  body > *:not(.nts-print-root) { display: none !important; }
  .nts-print-root { display: block !important; }
}
```

That hides the Nuxt app root, the teleport target that Nuxt UI modals and
toasts render into, and — in development — the devtools nodes, all at once.
The alternative, marking each control `print:hidden`, is a list that goes out
of date the next time somebody adds a button, and what would go out of date is
a clinical document.

The document is mounted **at all times**, `display: none` on screen, so that
the browser's own Ctrl+P prints it with no click handler and no `beforeprint`
race. `display: none` also keeps a duplicate of the record out of the
accessibility tree. It is safe to mount twice: the print view is pure props,
issues no request and mutates nothing, and the chart subtree declares no
element ids, so two instances cannot collide over an `id` or a `url(#…)`.

Measured vertical budget for an ordinary finalized record (Chromium, print
media): header 19.9 mm, chart 159.8, especificaciones 12.7, observaciones
12.7, professional 23.9, footer 29.0 — **258.0 mm** of blocks, plus five
2 mm gaps and the 5.3 mm continuation strip (§4f) = **273.3 mm** against
275 mm of printable page, so it fits one sheet. A record with six
specifications flows to a second page, which is the policy, not a failure.

The slack is 1.7 mm, and that is deliberate: the strip had to be paid for out
of decorative spacing (§9) rather than by scaling anything clinical. At the
previous 2.5 mm gap the same record measures 277.1 mm and prints on two
sheets. If a future change spends those 1.7 mm, the golden case becomes two
pages — which is a policy outcome, not a defect.

> Trap worth knowing: `space-y-*` in this Tailwind build puts the gap on the
> **bottom** of each child. Overriding `margin-top` alone does nothing — the
> adjacent margins collapse to the larger one. Zero both sides first.

> Second trap, from 05F.4a: the blocks are no longer children of
> `[data-testid="nts-print-document"]` — they sit in the body cell of the
> sheet table that makes the continuation strip repeat. The rules that set the
> inter-block gap therefore key off
> `[data-testid="nts-print-sheet"] > tbody > tr > td > * + *`. Wrapping the
> document in anything new moves that boundary again, and the symptom is
> silent: the blocks simply run together, with no error anywhere — and the
> page count *improves*, which makes it read as a success.

## 4c. Ink: what is black and what is not

§5.17 says the graphic prints in black; §5.12–5.13 reserve red and blue for
the findings. On screen the structure is a theme neutral, which is right for a
screen and wrong for a sheet. Measured in Chromium under `media: print`:

| element | before | after |
|---|---|---|
| crown outline, surface dividers | `#64757D` | **`rgb(0,0,0)`** |
| roots (molar / premolar / anterior) | `#64757D` | **`rgb(0,0,0)`** |
| annotation box border | `#DCE5E8` | **`rgb(0,0,0)`** |
| FDI number | `#202D35` | **`rgb(0,0,0)`** |
| repaired covered edges (05D.4c) | `#64757D` | **`rgb(0,0,0)`** |
| sigla, good | `#0000CC` | `#0000CC` |
| sigla, bad | `#CC0000` | `#CC0000` |
| `+n` overflow marker | `#64757D` | `#64757D` |

Screen values are unchanged in all rows.

**The selectors are structural, never global.** `data-region` appears only in
`NtsToothCell`; `nts-structure-*` only on the covered-edge repair group.
Neither can reach a clinical mark. A blanket `svg * { stroke: black }` would
repaint the findings and destroy the colour code the norm relies on — so there
isn't one, and a test asserts there never is.

The tooth outline takes its colour from `currentColor` set in an **inline**
style, so the override needs `!important`: a stylesheet `!important` beats a
non-important inline declaration.

**`+n` stays neutral deliberately.** The norm defines no such mark, so it is
outside §5.17's requirement on the *graphic*; grey is what keeps it from
reading as structure or as a finding. For the same reason the neutral token
itself is not overridden — that is what `+n` is drawn with.

## 4d. When printing is refused, and when it is merely qualified

Two different questions, and conflating them would be the bug.

**Refusals** come from `resolvePrintAvailability`. The sheet prints the record
*as persisted*, so anything that makes the screen and the stored record
disagree has to stop it:

| blocker | why | cleared by |
|---|---|---|
| `dirty` | typed text is not on the sheet | saving or discarding the edit |
| `writing` | a sent mutation can still change the record | the request settling |
| `refresh_failed` | the write landed, the re-read did not | the existing GET-only retry |
| `conflict` | another session changed it; not yet acknowledged | reviewing the notice |
| `loading` / `refreshing` / `opening_historical` | a snapshot is being installed | waiting |
| `no_record` / `catalog_unavailable` / `norm_mismatch` | nothing readable to print | — structural, no button at all |

The first six are *transient*: the button stays visible and disabled with the
reason in text, because a control that vanishes gives no reason and one that
looks live and does nothing is worse than either. The last three remove the
affordance entirely.

There is deliberately **no "print anyway"** for `dirty`. Agreeing to it would
not put the unsaved text on the page.

> **Disabling the button is not a gate.** The print root is always mounted so
> the browser's own Ctrl+P reaches it without passing the button. The decision
> is therefore computed once and consumed by both; when it says no, the root
> renders a notice in place of the clinical document. A test fails if the two
> ever diverge.

**Qualifications** are not refusals. A draft, a discarded record and a
superseded one all print, and each states what it is before the chart:

| record | qualification |
|---|---|
| finalized, in force | none |
| draft | `BORRADOR` + not the definitive record (+ unreviewed carried-forward count) |
| discarded | `DESCARTADO` + `discard_reason` |
| finalized, superseded | `REGISTRO SUPERADO` + a later record exists |

Carried by border and weight, never a fill: a background is the one thing a
print dialog can switch off. No wording calls a record invalid, annulled or
certified.

## 4e. The preflight

`window.print()` takes no arguments — paper, orientation, scale and colour
belong to the browser's own dialog. The modal therefore *asks*:

- Paper: A4 · Orientation: portrait · **Scale: 100%** · Print in colour
- **Do not use "Fit to page".** At 100% the narrowest crown is 0.545 cm²
  against §5.17's 0.5 cm² minimum; shrinking to fit breaks the norm.
- When findings cannot be fully drawn, their counts — from the same
  `printDeclarations` the sheet uses, so the two cannot disagree — with a note
  that the sheet identifies them. It never blocks, and never recommends where
  the clinician should write anything.

`document.title` is untouched: the browser derives a suggested PDF filename
from it, and that is not somewhere a patient's name belongs.

## 4e2. Known clinical gaps the sheet declares

Coverage is **35 complete, 1 partial, 2 unsupported** of the norm's 38 rules.
The printed sheet never hides the shortfall: anything it cannot draw in full
is named in the system note after *Observaciones*.

| id | rule / area | state |
|---|---|---|
| **G6** | 6.1.10 fractura — freehand shape the clinician has no channel to supply | open, `unsupported` |
| **CLINICAL-03** | 6.1.13 giroversión — direction the norm does not enumerate | open, `unsupported` |
| **G10** | 6.1.35 sellante — fissure anatomy the chart does not model | open, `partial` (the sigla draws) |
| **G9** | 6.1.31 multi-segment range grouping | open, editor produces one segment |
| **CLINICAL-02** | pilar cardinality | open, no automatic bound |

None of these is closed by the 05F block, which added no renderer, geometry or
catalog change at all.

> A finding can also read as `unsupported` for a second reason: a rule whose
> colour is `condition_dependent` (6.1.27 pulpotomía, 6.1.35 sellante) cannot
> be drawn without its `condition_state`, because the renderer will not invent
> a clinical colour. There the shortfall is in the *record*, not in the build.

## 4f. Page identity — closed in 05F.4a

The gap 05F.4 measured: the second page of a multi-page sheet began
mid-content — for a record with 15 specifications, page 2 opened at
`5. Especificación 5: …`, carrying **no record id, no patient, no norm
version**. Separated from page 1 it was an anonymous sheet of clinical text.

That is not a rare shape. Only the plain finalized record fits one page;
**any qualified record — draft, discarded, superseded — is two pages**,
because the qualification banner costs the remaining slack.

### What carries the identity now

Every printed page opens with a one-line continuation strip:

```
<título> · <paciente> · <documento> · <record id> · <norm_version>
```

The title comes from the existing print-header i18n key, so the strip follows
the UI locale like the rest of the sheet; 05F.4a added no new key.

It is `[data-testid="nts-print-continuation"]`, and it is the `<thead>` of the
table that wraps the whole sheet (`[data-testid="nts-print-sheet"]`). A table
header row is repeated by the paginator on every page the table spans, so the
strip is *structural*, not positioned: nothing has to be reserved in the page
margin, and no `@page` rule changes.

It costs **5.34 mm on every page**, measured. The ordinary record had 4.6 mm
of slack, so the strip's own padding and margin were trimmed and the
inter-block gap went from 2.5 mm to 2.0 mm — decorative spacing only, per §9.
Measured both ways: 277.1 mm and two pages at the old spacing, 273.3 mm and
one page at the new. Two of the long scenarios also dropped a page (15
specifications and the historical-norm record, 3 → 2).

### Why not the two alternatives

Both were measured in real Chromium on a standalone five-page document before
any product code was touched:

| mechanism | pages 1–4 | last page |
|---|---|---|
| `@page` margin box + `counter(page)` | carried | carried |
| `position: fixed` | carried | **dropped** |
| `<thead>` | carried | carried |

`position: fixed` — the remedy 05F.4 proposed — is disqualified on the
measurement: Chromium does not paint it on the final page, so the one page
most likely to be detached is the one that would lose its identity.

`@page` margin boxes do work, including with `content: var(--x)`. They were
rejected for a different reason: the patient's name would have to travel
through a CSS `content:` string, where an apostrophe or a quote in a real name
(`O'Brien`, `D'Angelo`) breaks the declaration silently, and the variable has
to be written onto `document.documentElement` — a global mutation carrying PHI,
outside the print root's isolation.

### Constraints this strip keeps

- Screen-invisible: it lives inside the print root, which is `display: none`
  outside `@media print`.
- No PHI leaves the document: nothing is written to `document.title`, the URL,
  the console or any request.
- Gated by the same `canRenderPrintRecord` invariant as the rest of the sheet —
  a norm mismatch prints nothing at all, strip included.
- The record id is the full identifier, never truncated, matching §4c's rule
  for the footer hash.

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
| **05F.2** | `@page`, physical sizing, isolation, page breaks: `ntsPrintLayout.ts`, the "NTS print layout" block in `main.css` | done |
| **05F.3** | trigger, safety gating, qualification banners, preflight: `resolvePrintAvailability`, `NtsPrintAction.vue` | done |
| **05F.4** | long-text policy, browser PDF QA, final regression | done |
| **05F.4a** | per-page identity: the continuation strip in `NtsOdontogramPrintView.vue` (§4f) | done |

Colour tokens for print are already pinned in `frontend/app/assets/css/main.css`
(`#0000CC` / `#CC0000` under `@media print`), independent of theme.

The printed page reuses `NtsOdontogramChart` and therefore the whole clinical
renderer. There is no print renderer and must not be one: a second way of
drawing a tooth is a second clinical opinion about that tooth.
