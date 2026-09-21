# Changelog — odontogram module

## Unreleased

- fix(nts-05f.4a): **every printed page carries the record's identity.**

  05F.4 measured the gap and left it open: page 2 of a multi-page sheet began
  mid-content and named neither the patient nor the record. Since any
  qualified record — draft, discarded, superseded — is already two pages, a
  detached sheet of clinical text with no owner was the normal case, not an
  edge case.

  The sheet is now wrapped in a table whose `<thead>` is a one-line
  continuation strip: `Odontograma · paciente · documento · record id ·
  norm_version`. Paginators repeat a table header on every page the table
  spans, so the strip needs no reserved margin and the §4b vertical budget is
  untouched.

  Three mechanisms were measured in real Chromium on a five-page document
  before any product code changed. `position: fixed` — the remedy 05F.4 had
  proposed — **is dropped by Chromium on the last page**, which is the page
  most likely to be detached. `@page` margin boxes work, but would carry the
  patient's name through a CSS `content:` string, where an apostrophe in a
  real name breaks the declaration silently, and would require writing PHI
  onto `document.documentElement`, outside the print root's isolation. The
  `<thead>` carries on every page and keeps the name in the DOM as text.

  Verified page by page with `pdftotext -f N -l N` across eight record shapes
  including historical norms and superseded records: every page of every
  document names its own record. Nothing reaches `document.title`, the URL or
  the console; the strip is invisible on screen; a norm mismatch still prints
  nothing at all, strip included.

  Regression caught and fixed in the same slice: moving the blocks into a
  table cell silently detached the inter-block gap rules, which now key off
  `[data-testid="nts-print-sheet"] > tbody > tr > td > * + *`. It was worth
  catching — while the gaps were collapsed the sheet *gained* a page of
  capacity, so the page counts looked better than the fixed layout's.

  Page count, measured, with the gaps correct throughout: the strip costs
  5.34 mm per page and the ordinary record had 4.6 mm of slack, so it went to
  two pages. Paid for out of decorative spacing only (the strip's own padding
  and margin, and the inter-block gap from 2.5 mm to 2.0 mm) — no scaling, no
  font reduction, and the chart keeps its 171 mm and its 0.5446 cm² crowns.
  The ordinary record measures 273.3 mm of 275 mm and is **one page** again;
  the 15-specification and historical-norm records dropped from three pages to
  two. Slack is now 1.7 mm, so a future block that spends it puts the golden
  case back on two sheets — a policy outcome, not a defect.

  No new i18n key: the strip's title reuses the existing print-header key and
  follows the UI locale like the rest of the sheet.

- test(nts-05f.4): **final print QA for the NTS block** — no product change,
  two findings.

  End-to-end validation in real Chromium against the live backend contract:
  thirteen record shapes rendered to A4 PDFs at scale 1 with the page size
  taken from the stylesheet, plus the blocker states driven through the real
  UI. Everything below is measured, not asserted from the docs.

  **Geometry holds.** Chart 170.92 × 154.09 mm inside a 190 × 275 mm content
  box; every PDF `MediaBox` is A4 (594.96 × 841.92 pt), never Letter.
  Recomputed from the productive placement model — molar 0.8348 cm²,
  premolar 0.7698, **anterior 0.5446** against §5.17's 0.5 cm² minimum. The
  negative guard bites: at 0.99 × the minimum safe scale the anterior crown
  falls to 0.4901 cm², below the norm.

  **Ink holds.** Crown, roots, surface dividers, annotation boxes and FDI
  numbers all measure `rgb(0,0,0)` in print media; findings `#0000CC` and
  `#CC0000`; `+n` neutral. The covered-edge repair — which 05F.2 could only
  verify against a probe node because no fixture produced one — rendered for
  real this time and is black.

  **Nothing is lost to pagination.** 15 specifications: all present, ordered,
  no duplicates. 45 observation lines: all present, breaks preserved. A single
  specification taller than a page: split across three pages with all 40
  repetitions intact and the technical footer still complete after it. The
  footer is `position: static` and follows content; it never overlays it.

  **The gates hold, including behind the application's back.** Dirty, writing,
  failed-refetch and conflict each withdraw the clinical document from the
  always-mounted print root, not merely from the button — verified by driving
  print media directly, and after a hard reload without ever opening the
  modal. `window.print()` fires exactly once on confirm, zero on cancel, and
  the print action issues no request and no mutation. No PHI in
  `document.title`, the URL or the console.

  Two findings worth recording:

  **1. Page 2 has no identity.** A second page opens mid-content with no
  record id, patient, norm or date. It is not an edge case: only the plain
  finalized record fits one page, so every qualified record — draft,
  discarded, superseded — is already two. Not fixed here: the page has 4.6 mm
  of slack and a running header needs ~6 mm, so the fix re-tunes the whole
  vertical budget and would push the one-page case to two. Characterised, with
  the shape of the remedy, in `nts-188-print.md` §4f.

  **2. A `condition_dependent` rule needs its state to draw at all.** A
  pulpotomía recorded without `condition_state` resolves `unsupported` and is
  declared on the sheet rather than drawn. That is the renderer refusing to
  invent a clinical colour — supply the attribute and it draws complete — but
  it means "unsupported" on a printed sheet can mean *this record is
  incomplete*, not only *this build cannot draw it*. Worth knowing when
  reading the note.

  Coverage unchanged and re-confirmed: **35 complete, 1 partial, 2
  unsupported**. No backend, migration, DB, renderer, geometry or catalog
  change anywhere in the 05F block.

- feat(nts-05f.3): **printing becomes usable, and refuses when it should**.

  05F.1 built the document, 05F.2 made it an A4 sheet. Neither could be
  reached from the application: there was no button, and `window.print()` was
  never called. This adds the control — and, more to the point, the conditions
  under which it declines.

  **The sheet prints the record as persisted, so unsaved text has to block
  it.** A clinician who types an observation, does not save, prints, and files
  the result has filed a document that omits what they just wrote. Printing is
  refused while anything is dirty, and there is deliberately no "print
  anyway": consenting to that would not put the text on the page. The same
  reasoning covers a write still in flight (it can still change the record), a
  write whose refetch failed (the screen may be behind the server — cleared by
  the existing GET-only retry, never by re-sending), an unacknowledged
  conflict, and any load or refresh still installing a snapshot.

  **Disabling the button is not a gate.** The print root is always mounted so
  that the browser's own Ctrl+P works, which means it can be reached without
  passing the button at all. So the decision is computed once —
  `resolvePrintAvailability` — and both the button and the root consume the
  same object. When it says no, the root renders a notice instead of the
  clinical document; a stale snapshot cannot be printed behind the
  application's back. There is a test that fails if the two ever diverge.

  **Status qualifies a document; it does not refuse one.** A draft, a
  discarded record and a superseded one all print. Each says what it is,
  before the chart, in words — `BORRADOR`, `DESCARTADO` (with its reason),
  `REGISTRO SUPERADO` — carried by border and weight rather than a fill,
  because a background is the one thing a print dialog can switch off. A draft
  also reports how many carried-forward findings are still unreviewed, which
  is what stops the sheet reading as a reviewed document; nothing is confirmed
  on the clinician's behalf to produce that number. None of the wording calls
  a record invalid, annulled or certified — DenPlant has no standing to say
  any of those, and the norm defines none of them.

  **The preflight asks for what `window.print()` cannot set.** Paper size,
  orientation, scale and colour belong to the browser's dialog and take no
  arguments, so the modal states them and explains the one that matters: at
  100% the narrowest crown is 0.545 cm² against §5.17's 0.5 cm² minimum, so
  "Fit to page" produces a sheet that does not satisfy the norm. When the
  record carries findings the chart cannot fully draw, the preflight counts
  them from the same `printDeclarations` the sheet uses — so the warning
  before printing and the note on the page cannot disagree — and says the
  sheet will identify them. It does not block, and it recommends nothing about
  any particular rule: where extra clinical detail belongs is the clinician's
  judgement, and nothing is written for them.

  One control, not three: the sheet always prints `viewRecord`, so a Print
  button in the current-record card *and* another in the draft card would be
  two controls that both print the draft whenever a draft exists.

  `document.title` is untouched — the browser derives a suggested PDF filename
  from it, and that is not somewhere a patient's name belongs.

  Verified in Chromium across finalized, draft, draft-with-carried-forward,
  discarded, superseded and mixed partial/unsupported records; the preflight is
  usable at 390 px; confirming calls `window.print()` exactly once and
  cancelling calls it not at all.

- fix(nts-05f.2a): **`describeAttributes` is now total for the catalog's own
  authoring shape**.

  05F.2's QA fed a printed record with 6.1.10 (fractura) or 6.1.13
  (giroversión) and got a blank document: `describeAttributes` threw, the
  exception took the whole `NtsFindingList` computed property down with it,
  and print, mounted alongside it, inherited the same empty subtree.

  Root cause: `rule?.attributes.map(...)` and `definition?.values.find(...)`.
  The optional chaining guards `rule?.`/`definition?.` — it does nothing for
  `.attributes`/`.values` themselves, so a rule or attribute that declares
  none of either still threw `Cannot read properties of undefined`.

  **Corrected before verifying whether it was actually a production defect —
  it needed to be, and the answer matters.** Traced end-to-end against the
  running backend (`GET /api/v1/odontogram/nts/catalogs/pe_nts_188_2022`):
  the live API always sends `"attributes":[]` and `"values":[]`, never an
  absent key, for every one of the 38 rules — confirmed for 6.1.10 and
  6.1.13 specifically. `AttributeDef.attributes`/`.values` default to `()` in
  the Pydantic model and FastAPI serializes the default, not an omission.
  **So this never crashed a real clinician's screen.**

  What it did crash: the catalog's own *source* file —
  `nts/catalog/pe_nts_188_2022.json`, the pre-validation authoring format —
  genuinely omits both keys when a rule declares nothing, and this project's
  entire frontend test suite reads that file directly as `REAL_CATALOG`,
  bypassing the Pydantic layer that fills the defaults on the real wire. Any
  test — including 05F.2's own print QA script — that built a finding for
  6.1.10 or 6.1.13 and mounted `NtsFindingList` hit exactly this crash. That
  is real and reproducible; it is just not "screen-breaking in production
  today" as 05F.2 characterized it.

  Fixed anyway, because the hardening is cheap, correct regardless of which
  contract is authoritative, and makes the test suite's own long-standing
  `REAL_CATALOG` convention safe for any of the 38 rules rather than a
  landmine for two of them. `NtsRule.attributes` and `NtsRuleAttribute.values`
  keep their required-array types — the live contract does not demonstrate
  otherwise — and every function in `ntsFindingModel.ts` that walked either
  field now reads it through one guard (`rule?.attributes ?? []`) shared by
  all of them, rather than five ad-hoc repetitions.

  `describeAttributes` itself is now total by shape, not by rule id: an
  enumerated code still resolves through the catalog's own label; a
  `free_text` value — 6.1.13's `rotation_sense`, "el sentido de la
  giroversión" — prints verbatim, because the norm enumerates nothing for it
  to resolve against and dropping it silently would have been worse than the
  original crash; an attribute key this catalog does not describe at all
  degrades to its raw value instead of vanishing; `null`/`undefined` render
  as nothing, never the strings `"undefined"`/`"null"`.

  Coverage unchanged: 35 complete, 1 partial, 2 unsupported. Fractura and
  giroversión are not rendered any differently — they still print in the
  "hallazgos no representados" note, exactly as 05F.1 designed. This ticket
  only stops the description layer from crashing on their way there.

- feat(nts-05f.2): **the official A4 sheet** — isolation, physical size, pagination.

  05F.1 built the document; this mounts it and makes it a page.

  **Isolation, not suppression.** The printed sheet is teleported to `<body>`
  as its own root, and printing hides every *other* child of the body in one
  rule. Hiding the application control by control would have been a list that
  goes stale the next time somebody adds a button — and the thing going stale
  would be a clinical document. Verified in real print media: `#__nuxt`, the
  Nuxt teleport target, and every devtools node all resolve to
  `display: none`; only `.nts-print-root` is `block`.

  **Mounted always, not on a click.** The browser's own Ctrl+P has to produce
  the sheet, and there is no print button until 05F.3. On screen the document
  is `display: none`, which also keeps a second copy of the whole record out
  of the accessibility tree. It costs one extra render of the chart: the print
  view is pure props, issues no request, mutates nothing, and the chart
  subtree declares no element ids, so two instances cannot collide over an
  `id` or a `url(#…)` reference.

  **§5.17 is now arithmetic the build checks.** `ntsPrintLayout.ts` converts
  the chart's own placement geometry to millimetres — CSS defines `1px` as
  exactly 1/96 inch for print, so the conversion is exact rather than
  approximate — and asserts that every crown clears 0.5 cm².

  That measurement corrected an earlier figure. The pre-flight quoted a
  minimum safe scale of 0.86, derived by hand from the layout constants. Read
  from `crownBox()` — the geometry the chart is actually drawn from, which
  fits each tooth's SVG into its cell — the real numbers are molar 0.835 cm²,
  premolar 0.770, **anterior 0.545**, and the minimum safe scale is **0.958**.
  The sheet satisfies the norm at full size, but by 9 % of area, not 40 %.
  The practical consequence is that the sheet **must print at 100 %**: any
  "fit to page" shrink below ~96 % produces a document that does not satisfy
  §5.17. Hence no `transform: scale()` anywhere in the print stylesheet.

  **One page for the ordinary record.** Measured in Chromium at the screen's
  own spacing, a simple finalized record came to 294.4 mm against 275 mm of
  printable page and spilled onto a second sheet. Only the whitespace between
  blocks was tightened — no font reduced, no clinical content scaled, the
  chart still 171 mm — bringing it to 270.4 mm. A dense record with six
  specifications still flows to a second page, which is the policy.

  Worth recording for whoever touches this next: `space-y-*` in this Tailwind
  build puts the gap on the **bottom** of each child, so overriding
  `margin-top` alone did nothing at all — the margins simply collapsed to the
  larger one. Both sides have to be zeroed first.

  **§5.17's other half: the graphic prints in black.** The colour work so far
  had covered the findings; the structure had not been measured. It was not
  black. Measured in Chromium under `media: print`: crown outline, surface
  dividers and roots all `#64757D`, the annotation boxes `#DCE5E8` — close to
  invisible on paper — and the FDI numbers `#202D35`. Theme neutrals, which is
  right on screen and wrong on a sheet the norm says prints in black.

  Corrected print-only, with structural selectors: the tooth cell carries
  `data-region` on its roots, crown regions, annotation box and FDI number,
  and that attribute exists **only** in `NtsToothCell`; the covered-edge
  repair carries `nts-structure-*`, which exists only on that group. Neither
  can reach a clinical mark, which is why there is no blanket
  `svg * { stroke: black }` — that would repaint the findings and destroy the
  red and blue §5.12-5.13 makes carry meaning. The outline's colour comes from
  an inline `currentColor`, so `!important` is what overrides it.

  After: every structural part measures `rgb(0, 0, 0)` in print and is
  unchanged on screen; the siglas still measure `#0000CC` and `#CC0000`; and
  `+n` stays neutral, because the norm defines no such mark and it sits
  outside the requirement on the *graphic* — staying grey is what stops it
  reading as either structure or a finding. The neutral token itself is
  deliberately not overridden, since it is what `+n` is drawn with.

  **Overlay alignment**, the risk flagged in the pre-flight, holds in print
  media: the overlay's left edge sits 0.14 mm from the canvas's, it spans
  170.92 mm against the canvas's 171 mm, and the first and last tooth cells
  land at 0.10 mm and 170.89 mm. Findings print in the pinned `#0000CC`, and
  the `+n` overflow marker prints in neutral ink beside them.

  Still to come in 05F.3: the print trigger, eligibility, the
  BORRADOR/DESCARTADO qualification and the pre-print advisories.

- feat(nts-05f.1): **the odontogram as a printed document — data and DOM**.

  The screen surface is a place to work on a record: buttons, editors,
  banners, a history. A printed odontogram is none of those, and the
  difference is not a stylesheet. `NtsOdontogramPrintView` is the record
  arranged the way the norm's Anexo arranges it — chart, then
  *Especificaciones*, then *Observaciones* — and nothing else.

  What the audit of the Anexo settled, and what this slice encodes:

  - The annex has **no patient block and no signature block**. §5.2 places the
    graphic inside the Ficha Odonto-Estomatológica and §5.3 puts the firma y
    sello on that Ficha. So the patient line and the professional line are
    DenPlant information, printed outside the normative content, and there is
    **no "Firma y sello" line** at all.
  - The professional is `recorded_by_*`, never `finalized_by`. The service
    snapshots the person who *recorded* the finding "even when somebody else
    presses finalize"; printing the finaliser would attribute clinical content
    to someone who did not record it. `finalized_by_name` is therefore not a
    gap this feature has.
  - The technical footer carries record id, norm version, status and the
    **whole** content hash, labelled *Huella de contenido*. Half a digest
    attests nothing, so it is never abbreviated to fit — and it is not called
    a signature, a certification, or evidence of legal validity.

  **One drawing.** The page mounts `NtsOdontogramChart` itself, reading the
  catalog it is handed. There is no print renderer: a second way of drawing a
  tooth is a second clinical opinion about that tooth, and two of those can
  disagree. The chart gained one presentational prop, `advisories`, so the
  editing alerts beside it do not follow it onto paper — the `+n` overflow
  marker does, because it is part of the drawing and hiding it would make the
  sheet claim a box holds only the siglas that fit.

  **Findings the drawing cannot carry** are declared on the page, after
  *Observaciones* so that no DenPlant content is inserted between the annex's
  three blocks. The list comes from the renderer's own `completeness`, never
  from a list of rule ids, so it is exactly as long as the drawing is short.
  Declaring a gap **writes nothing**: appending to `observations` would be
  DenPlant authoring clinical text over a clinician's name, and would move the
  content hash of a finalized document.

  **The record and the catalog must name the same norm.** Not merely "a
  catalog is present": `ruleFor` matches a finding to a rule by `rule_id`
  alone and rule ids are stable across revisions, so a catalog for a different
  norm does not fail loudly — it draws that norm's marks for this record's
  findings. Measured before the gate existed: the chart rendered, catalog A's
  sigla `FFP` appeared on a norm-B record, and the declarations were computed
  under A. One invariant, `canRenderPrintRecord`, now answers the question for
  both the view and the pure model, and `printDeclarations` applies it itself
  rather than trusting its caller to have applied it first. A mismatch prints
  the unavailable notice: no chart, no marks, no declarations, no fallback.

  **Persisted, never buffered.** The page reads the record as stored. Text a
  clinician typed and did not save has not been recorded, and a document that
  printed it would be claiming otherwise.

  Patient name and document come from the payload cache the patient page
  already filled (`useNuxtData('patient:<id>')`) — no request, and no second
  source of patient data. An empty cache prints no header rather than a row of
  dashes: "Documento: —" reads as "this patient has none", which is a
  different claim from "this page did not have it".

  Still to come: `@page` and the print stylesheet (05F.2), the trigger, the
  draft watermark and the pre-print advisories (05F.3). Nothing here depends
  on a media query, which is what makes it testable as a DOM tree.

- fix(nts-05e.4a): **a context change cannot silently discard clinical text**.
  05E.4 guarded navigation *inside* the odontogram; the controls that take the
  odontogram away live outside it, and could not see what they were about to
  destroy.

  The audit found what those controls actually are, and it was not what the
  ticket assumed. `patientId` reaches the shell from `route.params.id`, read
  once — **there is no in-page patient switcher**, so changing patient is
  route navigation. The one reachable in-screen context change is the
  chart-format selector, a *sibling* of the mount point: clicking it flips
  shared preference state and the shell is unmounted.

  So the shell now publishes, through a small shared composable, the only
  thing outside controls need: whether anything would be lost. Two flags, not
  one — `dirty` is text a clinician typed and can discard, `writing` is a
  mutation already sent, which is not the browser's to throw away and whose
  result needs somewhere to land. They get different answers: a confirmation
  for the first, an unavailable control for the second.

  The guard sits at the control that causes the change, never as an attempt
  to revert a prop afterwards. The format selector asks before switching,
  using the same words as the odontogram's own history prompt — one policy
  for abandoning unsaved clinical text, not three dialogs that disagree.
  Leaving the page is covered by `onBeforeRouteLeave` scoped to the shell
  rather than to the patient page, which hosts several tabs with nothing to
  protect; reload and tab-close reuse the `beforeunload` pattern the
  periodontogram already established.

  Nothing is persisted to survive the navigation. A copy of clinical text in
  `localStorage` would be a second source of truth, which this module refuses
  everywhere else; confirming before abandoning it is enough.

- fix(nts-05e.4): **one record, one write at a time** — plus the integration
  pass that closes phase 05E.

  The defect this ticket was written to find: every mutation in the module
  bumps the same `record.version`, but each editor guarded only itself. Saving
  *Observaciones* and confirming a carried-forward finding are different
  components with different busy flags, so both read the loaded record and both
  sent `expected_version: 7`. Proved by probe before fixing: two requests, one
  version, and the second 409s for something the clinician did nothing to
  cause. There is now a **record-wide** lock in `useNtsOdontogramRecord`, held
  across the refetch as well as the request — the loaded record still carries
  the old version until the refresh lands — and the finding editor takes it
  through a new optional `lock` option. Every write affordance is disabled
  while it is held, so the guard is visible rather than a silently dead click.

  **Unsaved text is no longer lost to a click.** Opening a historical record
  swaps the record in view, which resets the panels' buffers. Both panels now
  report dirtiness, an open finding editor counts as unsaved work, and
  navigating away asks first — discard and continue, or keep editing. A
  confirm rather than per-record buffer retention: the smaller mechanism, and
  the honest one, since the clinician is told what they are about to lose.

  **The history selector's ARIA was wrong and is now right.** 05E.3 shipped
  `listbox`/`option` with a button inside each option — invalid, and it
  promised an arrow-key model that did not exist. It is a plain list of
  buttons with `aria-current`, which is what the interaction actually is.

  Two more facts are now said in words rather than implied by colour: which row
  is *the current odontogram* and which is *the one on screen* — different
  things that a single "current" badge would have conflated. An opened record
  shows the actor and metadata fields it actually carries, and renders nothing
  where it carries none.

  `finalize`, `discard` and `createDraft` now refetch in place like every other
  post-mutation read, instead of replacing the clinical surface with a skeleton
  and rebuilding it.

  Renderer coverage unchanged at 35 complete / 1 partial / 2 unsupported. No
  backend, migration or catalog change.

- feat(nts-05e.3): **record history, and a record is read under its own norm**.
  The list 05A shipped becomes a selector that opens earlier odontograms
  read-only, and the catalog is now resolved from `record.norm_version`
  everywhere — never from the active profile.

  This closes the risk 05D.0 flagged and the 05E pre-flight confirmed was
  still live. `resolveChart` matches findings by `rule_id` against whichever
  catalog it is handed, with no norm check; the only thing that had been
  keeping that safe was the history list being filtered by the profile's norm,
  so every listed record happened to match the one loaded catalog. A
  correctness guarantee resting on a filter is not a guarantee. The filter is
  now gone — a clinical history does not shrink because the clinic upgraded
  its norm version — and the guarantee is stated instead: `catalogFor(version)`
  resolves each record's own norm, cached by version and by nothing else.

  **There is no fallback.** If a record's norm cannot be served, nothing is
  drawn: interpreting findings under a norm they were not recorded in would
  put marks on the chart the record does not contain, which is a fabricated
  clinical statement, not a degraded view. The record's dates and status stay
  readable, with a retry that is a GET.

  Two generations, not one. Opening B while A is in flight ends on B, and A's
  late answer is dropped — record *and* catalog are checked against the same
  token and installed together, so a record can never be paired with another
  record's rules. The rows stay clickable while one is loading: disabling them
  would make a slow record block the selector and switching away impossible,
  which is the very case the tokens exist to make safe.

  `mode` is explicit — `current` or `historical` — rather than inferred from
  `status`, because the record in force is routinely finalized and is still
  the current one. A historical record is inspection: no finding, text or
  lifecycle write is offered, whatever its status says, and the finding editor
  is never bound to it. Returning restores the current record, its catalog and
  its editing state, and creates nothing.

  The current record now resolves its catalog from itself too, so there is one
  rule rather than two. The profile's catalog still gates the clinical reads —
  a norm this build cannot interpret must not reach a patient's record at all
  — and the second fetch happens only when record and profile genuinely
  disagree, which is exactly the case that used to be read wrongly.

  Frontend only: `norm_version` was already optional on the list endpoint, so
  no API, migration or schema change was needed.

- feat(nts-05e.2): **the annex's two text blocks reach the screen**.
  *Especificaciones* (§5.14) and *Observaciones* (§5.15) are now editable on a
  draft and readable on a finalized record, in the annex's own order — chart,
  then Especificaciones, then Observaciones — because 05F will print from this
  DOM.

  They stay two things, never one textarea. §5.14 is vocabulary that exists and
  had no room in the boxes: an ordered list of free-text entries, each
  optionally naming a finding. §5.15 is what the 38 rules cannot express at
  all: one free-text block. Neither becomes a structured finding, a treatment,
  a plan or a budget line.

  No autosave anywhere. Both panels hold a local buffer and save explicitly;
  an emptied Observaciones box saves as an explicit `null`, because the API
  reads an absent key as *leave it alone* and omitting the field would silently
  keep the old text. Entries render in the server's `sequence`, never by id and
  never alphabetically — reordering what a clinician wrote is editing it.

  The `+n` overflow gets an advisory beside Especificaciones, and an advisory
  only: nothing is created, nothing is copied, and the wording says the
  findings are *still recorded* rather than implying any were dropped.

  Two fixes fell out of building it. `recoverFromConflict` did a **foreground**
  load, so a 409 swapped the whole clinical surface for a spinner and rebuilt
  it — taking the clinician's unsaved text down with it, which is the worst
  possible answer to a conflict, since their own words are what they need to
  decide what to do next. It now refetches in place, like every other
  post-mutation read; the conflict alert already says what happened. And the
  text mutations now hold a lock across the refetch, not just the request:
  `isMutating` drops when the server answers, but the loaded record still
  carries the old version until the refresh lands, so a second write started in
  that window would have sent a version the server had already left behind.

  A separate refresh-failure banner from the finding editor's, with its own
  retry. Sharing one would leave a clinician pressing a button that re-reads
  the wrong thing.

  Strings added to all five locales. No history selector and no `norm_version`
  resolution: 05E.3 owns both.

- feat(nts-05e.1): **client layer for Especificaciones and Observaciones**. The
  05E pre-flight found both already persisted, hashed, audited and guarded
  server-side, with every endpoint in place — so this adds no migration, no
  endpoint and no backend implementation, only the four client methods that
  were missing and the composable state around them.

  `useNtsApi` gains `updateMetadata`, `createSpecification`,
  `updateSpecification` and `removeSpecification`. Three details of the real
  contract are carried rather than smoothed over: the metadata call is a
  **PATCH** whose payload is passed through untouched, because the API reads an
  absent key as *leave it alone* and an explicit null as *clear it* — building
  the body from optional arguments would wipe two fields on every observations
  save. `finding_id` is optional on create and **required even when null** on
  replace, so omitting it can never read as "unlink". And no client proposes a
  `sequence`: the server owns the ordering and answers with it.

  The composable exposes `observations`, `specifications` (sorted by the
  server's `sequence`, never by id and never alphabetically — reordering what a
  clinician wrote is editing it), `isTextEditable`, and the four mutations.
  They target the open draft, which is the only record the server will accept a
  write for.

  Mutation and refresh stay two phases, as 05C established: once the server has
  accepted a change, a failed refetch sets `refreshFailed`, never `error`, and
  `retryRefresh` re-reads with a GET and only a GET. Nothing is written locally
  before the server answers, so there is no rollback to get wrong, and the next
  `expected_version` comes from the refetch rather than from arithmetic — two
  mutations in a row cannot both claim the same version. A 409 refetches and
  reports without retrying; a 422 surfaces verbatim as clinical errors.

  Three API-edge tests added, none duplicating the service layer: a finalized
  record refuses new observations, a new specification, and any change or
  removal of an existing one — each a 409 `nts_state_conflict`, with the entry
  provably unchanged afterwards.

  No UI. `NtsOdontogramShell.vue` is untouched; the editor arrives in 05E.2.

- fix(nts-05d.4d): **a trifurcated root attaches across the whole crown**. A
  second clinical review of the annex found that 05D.4b fixed the overlap and
  left the width wrong: the three bases spanned exactly **50%** of the crown,
  so the roots read as a narrow cluster hanging from the middle of the tooth
  while the two-rooted molar beside it attached across **90%**.

  Measured against the annex rather than adjusted by eye. On its 89-pixel
  crown the outer root flanks land about two pixels inside the corners — an
  envelope near 95% — the apices sit at ±0.275 of the width, and each triangle
  is symmetric about its own apex. The apex measurement confirms `tipSpread`
  was already right, so it is untouched: the defect was never about the tips.

  `baseHalf` 0.13 → **0.20** and `baseSpread` 0.12 → **0.25**, chosen so that
  `baseSpread ∓ baseHalf` resolve to `0.05` and `0.45` — exactly the pad and
  half-slice a **two**-rooted molar already uses. The outer two roots of a
  trifurcated tooth are now the very same triangles a two-rooted tooth is
  drawn with, down to the unit (`7.9..43.1` and `51.9..87.1`), with the third
  standing between them. One rule for how a root meets a crown, not two.

  Envelope 50% → **90%**, adjacent overlap 12.32 → **13.20** units (15% of the
  crown, so the roots overlap slightly more than before, not less).

  Nothing moved vertically. Apex Y, base Y and apex X are identical for all 52
  teeth; 42 teeth are byte-identical and within the ten that changed only
  `roots` differs — viewBox, crown and every region path are unchanged.

  Two consequences worth naming. The old geometry put each outer apex
  *outside its own base* (`M46.62,82 L72.14,2 L69.5,82`), which is why 05D.4c
  had to widen `rootBox` to reach the tips; the tips now sit inside their
  bases, so that invariant is restated over *every* corner instead of over
  whichever kind currently protrudes. And `rootBox` for a three-rooted tooth
  is now identical to a two-rooted one, which makes the `near_roots` symbol
  the same size on both — it had been drawn smaller on three-rooted teeth
  because it was sized against the narrow old box. Centres are unchanged.

- fix(nts-05d.4c): **the tooth stays readable under a clinical fill**. 05D.4
  left one visual tension open: a solid fill is painted over the drawing, so
  wherever it reached the crown's own strokes it covered them and the outline
  went missing.

  The naive fix — repaint the tooth above every fill — was rejected outright.
  It would restore the crown and simultaneously put a divider back between
  contiguous surfaces of one finding, which is precisely what merging them
  exists to prevent: a posterior occlusal fill would get its four tile
  dividers back and stop reading as one clinical figure.

  The figure's own rim answers it instead, with no new rule invented. An edge
  between two selected regions of one figure is interior and is already absent
  from the boundary; every edge that survives there either bounds the crown or
  borders an unaffected surface — the two cases that must stay visible.
  Intersecting that with the tooth's real edges drops the last case, a rim
  segment the drawing never had: the incisal band is inset inside the central
  zone, so its long sides run through open space and giving them a neutral
  stroke would invent an anatomical subdivision the odontogram does not
  contain. Its short ends do lie on the zone's real divider and are restored,
  which keeps that line continuous instead of notched.

  Restored as open polylines — closing one would draw an edge that is not
  there — in the chart's own neutral ink, at `NTS_TOOTH_STROKE`, now a shared
  constant so the cell that draws the outline and the overlay that repairs it
  cannot disagree. Painted after the fill and before every clinical mark. An
  outline gets none: it fills nothing, so it hides nothing.

  No opacity, blend mode, pattern or third colour — asserted by a test over
  the rendered layer. Clinical semantics, mark kinds, catalog, DB and coverage
  (35 / 1 / 2) are all untouched.

  Also fixed here: two literal NUL bytes that 05D.4 left in
  `ntsRenderModel.ts`, from a separator escape that was decoded into the byte
  itself rather than written as an escape. Harmless at runtime, but it made the
  file read as binary to git and grep.

- feat(nts-05d.4): **filled and contoured surfaces reach the chart**, and the
  render vocabulary is complete. `shape_fill` and `outline` were the last two
  mark kinds nothing drew; both now resolve through metadata that already
  existed, with no new decision taken inside the renderer.

  Geometry is read from the mark, never guessed. `regions_from` names the
  attribute supplying the codes, which go to the clinically validated surface
  policy; the renderer never reads `finding.attributes.surfaces` by name, which
  is the accident 05D.4a existed to prevent. A binding that cannot resolve —
  absent attribute, a value that is not a set of codes, an empty set, codes
  naming no geometry — is reported with its own reason rather than
  approximated.

  **A landmark is not a surface.** A mark anchored at `coronal_pulp` resolves
  through the dentition's neutral central-tile accessor, not through the
  surface policy. On a front tooth those are materially different polygons —
  the whole central zone against the inset incisal band — and giving the
  landmark the surface's shape would be a wrong clinical statement. The merge
  algorithm is shared (one implementation, `mergeRegions`); the meaning is not.

  **Multi-loop figures survive.** A component's boundary is one or more closed
  loops, and a figure enclosing ground the finding does not cover has a rim and
  holes wound against each other. Every loop reaches the SVG as one closed
  subpath of a single path, under an explicit `fill-rule="nonzero"` chosen
  because that is what the opposite windings mean. Keeping only the first loop
  would fill a hole in and claim an area nobody recorded — the exact defect
  05D.4b uncovered, now pinned by a test at both the model and the DOM.

  Two findings covering the same region are both drawn, never merged across
  findings, in the record's own order; the situation is reported beside the
  chart as `overlaps`, flagged `silent` when one of them writes no sigla and so
  could be hidden completely.

  Coverage goes from 30/5/3 to **35 complete, 1 partial, 2 unsupported**.
  6.1.16, 6.1.33 and 6.1.36 go partial → complete, 6.1.27 partial → complete,
  and 6.1.34 unsupported → complete. What remains is not a renderer gap:
  6.1.35 needs fissure anatomy the chart does not model (G10), 6.1.10 needs the
  shape the clinician observed (G6), and 6.1.13 needs a direction the norm
  never enumerates (CLINICAL-03).

  One fixture bug fixed on the way: the catalog census synthesised a
  multi-valued attribute as a bare string, which the record model rejects — so
  it was measuring the renderer against data no stored finding could have.

- feat(nts-05d.4b): **surface codes become geometry, and three roots become a
  trifurcation**. 05D.4a declared *which attribute* a `shape_fill` or `outline`
  reads its regions from; it said nothing about what a surface code looks like,
  because the norm does not. A dentist has now ruled on that, and the ruling is
  implemented as a pure policy module — `ntsSurfaceGeometry.ts` — kept
  deliberately outside the catalog.

  Mesial follows the quadrant, so a fixed left-is-mesial rule (wrong for half
  the mouth) cannot creep in. **Vestibular faces outward in both arches** —
  upper V at the top, lower V at the bottom. A pre-implementation design note
  had this reversed; the clinician's ruling overrides it, and an explicit
  regression guard fails if a future reader of that superseded note flips it
  back. Occlusal is the whole central table however many tiles it is drawn in;
  an anterior's incisal surface is a centred horizontal band spanning that
  tooth's central zone edge to edge, inset vertically so it never sits on the
  vestibular/lingual divide.

  The band's width is **derived, not chosen** — and one geometry, not two. An
  earlier revision widened it to a flat 50% of the crown for legibility, which
  pushed it over the mesial and distal trapezoids: it claimed surfaces nobody
  had recorded, and it overlapped its neighbours instead of meeting them, so it
  could not tile and had to be carried beside the regions as a second,
  "visual" shape. Two shapes for one surface agree until an outline is drawn
  from one and a fill from the other. Legibility is now height and, later,
  stroke; the band is one of the tiles, and `resolveSurfaceRegions`,
  `resolveSurfaceComponents` and `resolveSurfaces().incisal` all hand out the
  same polygon by reference.

  Two consequences are recorded rather than papered over. On an anterior,
  **V+O and L+O are two figures** — the inset that keeps the band off the
  divide also keeps it from touching those trapezoids, and bridging the gap
  would paint sound enamel. And an anterior with all five surfaces **has two
  holes**, the slivers above and below the band; boundary loops are now wound
  by nesting depth so rim and hole draw correctly as one path and their signed
  areas sum to the area actually covered.

  Contiguous surfaces merge into one continuous figure with no internal
  divider, by robust boundary extraction — collinear subdivision, then
  cancellation of shared edges, then chaining into closed loops. Naive
  duplicate-edge cancellation is not enough: an outer trapezoid meets the
  central table along one long edge that the table's own tiles split in two, so
  without subdividing first nothing cancels. Surfaces that do not touch stay
  separate; bridging them would claim the sound surface between was affected.

  Root geometry: a three-rooted tooth was drawn as three triangles standing
  side by side with gaps between them. They now leave a common trunk — bases
  overlapping, apices spread far enough apart to be counted. One- and
  two-rooted teeth are byte-identical, and every apex height on the chart is
  unchanged, so the apex band, range and arch overlays and the supernumerary
  anchor all stay put. `rootBox` was measuring only the base edges, which was
  equivalent while a tip always fell between its own two flanks; it now
  accounts for the apices, and widens only for the ten trifurcated teeth.

  **G5 is closed as DenPlant clinically validated product policy — not as
  norm.** NTS N.° 188 supplies the surface vocabulary and says the mark is
  drawn "según la forma que se observa"; it defines no correspondence between
  M/D/O/V/L and parts of a figure, and nothing here may be cited as if it did.
  A catalog test still asserts that no region id or geometric word appears in
  the JSON.

  Geometry only. Nothing new is drawn: `shape_fill` and `outline` are still the
  two mark kinds nothing renders, and coverage stays at 30 complete / 5 partial
  / 3 unsupported.

  Still open and untouched: G6 (freehand fracture shape), G9 (multi-segment
  registration), G10 (fissure anatomy), CLINICAL-02 (pilar cardinality),
  CLINICAL-03 (giroversión direction).

- feat(nts-05d.4a): **an area mark declares where its area comes from**.
  `box_siglas` has said which attribute supplies its text since NTS-05D.0b;
  `shape_fill` and `outline` said nothing about which attribute supplies their
  regions. A renderer would have had to hunt for an attribute called
  "surfaces", or for the rule's only `enum_multi` — both work on this norm
  today, neither is a contract, and it is the same gap C3 closed for text.

  `RenderMark.regions_from` closes it, declared on 6.1.16, 6.1.33, 6.1.34 and
  6.1.36. A new generic invariant requires `shape_fill` and `outline` to take
  their geometry from **exactly one** source — a landmark `at` or a
  `regions_from` attribute, never both and never neither — and forbids the
  binding on any kind that covers no area. 6.1.27 is the standing proof that
  the two are alternatives: it paints the coronal pulp from `at`, on a
  tooth-scoped rule with no surfaces attribute at all.

  Metadata only. The clinical drawing is byte-identical and coverage stays at
  30 complete / 5 partial / 3 unsupported; `shape_fill` and `outline` are still
  the two mark kinds nothing draws.

  **G5 is not closed.** A surface→region mapping is *proposed* — the
  mesial/distal derivation is verified against all eight quadrants and the
  crown regions tile exactly — but it stays **pending clinical validation** on
  the vestibular/lingual orientation, which the norm never fixes, and on how an
  anterior's occlusal/incisal surface should read when its central region is 4%
  of the crown against 19% on a posterior. The catalog deliberately says
  nothing about either: it names the attribute and stops.

  Still open and untouched: G6 (freehand fracture shape), G9 (multi-segment
  registration), G10 (fissure anatomy), CLINICAL-02 (pilar cardinality),
  CLINICAL-03 (giroversión direction).

- feat(nts-05d.3): **lines, connectors and arrows reach the chart**. With the
  span primitives in place the drawing goes from 18 rules to **30 complete,
  5 partial, 3 unsupported**: orthodontic appliances, edentulous arches,
  bridges, complete and partial prostheses, root canals, posts, eruption,
  extrusion, intrusion and transposition all draw.

  Three instruction kinds, all carrying geometry already resolved to chart
  coordinates: `line` and `connector` as polylines, `arrow` as a spine plus a
  head that faces along its last segment. The layer draws them and knows
  nothing else — no scope, no roles, no arches.

  Everything is still read from the mark. The catalog's placement tokens are
  translated to geometry bands by one explicit table; `geometry_input.constraints`
  is never consulted, as NTS-05D.3a settled. Arrow direction is derived from
  `toward` plus the tooth's arch, so an upper and a lower tooth with the same
  finding mirror each other without either being named. A span's endpoints come
  from row order, so a bridge from 11 to 21 is two teeth wide and not ten.

  The verticals of a fixed partial prosthesis are dropped onto the targets
  carrying the mark's role and onto no others — a span with the role marked
  only in the middle gets its stroke there, and one with no role marked gets
  the horizontal alone. Endpoints are never assumed to be the role.

  Spans are grouped by `group_index`, so a finding delivered with two groups
  draws two segments. That does not fix the persistence gap and no group is
  ever invented; it means the renderer is ready when the gap closes.

  Root lines follow the reading closed in NTS-05D.3a: **one line per tooth on
  its centre axis**, never one per root. `rootAxes` stays available and stays
  unused here.

  Left undrawn, and reported rather than approximated: the freehand fracture
  shape (G6), fissure anatomy for sealants (G10), and the direction of a
  rotation, which is a clinical observation the norm never enumerates
  (CLINICAL-03). `shape_fill` and `outline` are the two mark kinds still to
  come.

- feat(nts-05d.3a): **where a mark goes and which targets it applies to are now
  two questions**. The 05D.3 pre-flight found four marks with no stated height:
  §6.1.1's symbol and connector, and §6.1.29's line and connector. The norm
  states it for both — "a nivel de los ápices", p.6 and p.16 — and the catalog
  carried it only in `geometry_input.constraints`.

  Constraints cannot do that job, and §6.1.8 is the standing proof: one rule,
  two marks, `root_area, crown_area`, a line on the root and a square on the
  crown. Whichever area a renderer picked would be wrong for one of them.
  Placement is per mark, and the validator now requires it of every connector
  and of every line the clinician does not draw freehand.

  The placement token `endpoints` was the root of it: it answered *which
  targets* while occupying the field for *where*. It is retired, and
  `RenderMark.target_selector` (`range_endpoints`) answers that question in its
  own typed field — the same separation `role` already gives §6.1.29's pilares,
  differing only in who decides, the span's shape or the clinician.

  Metadata only. The clinical drawing is byte-identical, coverage stays at
  18 complete / 7 partial / 13 unsupported, and §6.1.1 remains deferred until
  the span primitives land: its placement is now known, what is missing is the
  connector that joins the squares.

  Also recorded: the **root-line micro-gap (G8) is closed by the PDF**.
  Magnified, p.19 draws tooth 74 — a two-rooted deciduous molar — with a single
  vertical line down the centre of the tooth, passing *between* the roots, and
  p.9 draws tooth 26 with three roots and one line. It is **one line per tooth
  on its vertical centre, not one per root**, which is what the catalog already
  said: one mark is one line. No change was needed.

  Still open and untouched: G6 (freehand fracture shape), G9 (multi-segment
  registration), G10 (fissure anatomy), CLINICAL-02 (pilar cardinality),
  CLINICAL-03 (giroversión direction).

- feat(nts-05d.2): **siglas and symbols are drawn on the chart**. The first
  clinically visible layer: `ntsRenderModel.ts` turns a finding plus its
  catalog rule plus the chart geometry into `RenderInstruction[]`, and
  `NtsFindingLayer.vue` draws them inside the shared overlay. The model is
  pure — no Vue, no DOM — and the layer decides nothing.

  Every decision is read from the mark: which attribute supplies the text
  (`text_from`), what is appended (`suffix_from`), which shape
  (`params.shape`), where it sits (`params.at`, falling back to what the shape
  itself names). There is no `rule_id` in either file and a test asserts there
  never will be. That is what pays off for the supernumerary tooth: its sigla
  goes inside a circumference between two apices instead of into a box, and
  the renderer gets it right without knowing which rule that is.

  Colour stops at meaning. The model emits `paint: 'good' | 'bad'` and no hex;
  two new tokens, `--color-nts-finding-good` / `--color-nts-finding-bad`, hold
  the values. They are deliberately **not** the product's success/danger
  colours: blue means *good* here, which inverts the usual convention, and a
  well-meant retune of an error token must not be able to repaint a clinical
  record. A print block pins both regardless of theme.

  **Nothing is dropped silently.** A finding whose marks this slice cannot
  draw reports `partial` or `unsupported` and is announced next to the chart
  rather than approximated on it. Where several findings share one annotation
  box the siglas stack one per line as the annex draws them (p.15 writes "D"
  over "L"); beyond two, the box shows "+n" — a UI overflow indicator, not an
  NTS symbol — and every instruction stays in the model.

  Of the 38 rules: **18 complete, 7 partial, 13 unsupported**. Lines,
  connectors, arrows, fills and outlines arrive in later slices; span symbols
  drawn on range endpoints are deferred with them, because placing the squares
  without the connector that joins them would show half a mark.

  Draft and finalized render byte-for-byte identically, and so do carried-forward
  and observed findings — both verified, not asserted.

- feat(nts-05d.1): **global chart geometry foundation; no clinical findings
  rendered yet**. 05B gave every tooth its own `<svg>` and its own viewBox,
  which is all a row of independent drawings needs — and not enough for
  anything that spans teeth. A span from 13 to 23, an arch-wide appliance, a
  mark between two crowns or between two apices had nowhere to be drawn,
  because there was no shared origin.

  `ntsChartGeometry.ts` supplies one. It is pure — no Vue, no DOM, no
  `getBoundingClientRect` — and answers, for any FDI number, where that tooth's
  column, crown, annotation box, number strip, roots and apices land on a
  single chart-wide canvas, plus the bands and spans marks are anchored to
  (`apexBand`, `occlusalBand`, `rangeSpan`, `archSpan`, `interproximalPoint`).
  Spans follow row order rather than FDI arithmetic, so 11 → 21 is contiguous;
  an interproximal point between teeth that are not neighbours returns `null`
  instead of a midpoint that means nothing.

  `ntsDentition.ts` gained `rootShapes`: the base, apex and flanks that
  `rootPaths` used to compute and discard. The emitted `d` strings are derived
  from exactly those points, so nothing drawn changed.

  The chart now takes its scale and width from the geometry module instead of
  keeping a second copy, and carries an **empty** overlay `<svg>` with the
  deterministic viewBox, `pointer-events-none` and `aria-hidden`. It draws
  nothing: it exists so the coordinate space is real and testable, and so a
  later ticket has somewhere to put marks that scrolls with the teeth.

  Visually inert, and checked rather than asserted: the rendered chart markup
  was diffed against the previous commit and is byte-identical apart from the
  overlay element and a `relative` class on its positioning context.

- feat(nts-05d.0b): **render metadata is now declarative end to end**. The
  05D.0 audit found that a renderer could not build a single one of the 38
  findings from metadata alone — it would have had to know that 6.1.29's
  `at: "pillars"` meant the `pilar` role, that 6.1.19's degree came from
  `mobility_degree`, that 6.1.26's sigla belongs in a circle and not in the
  box, and that 6.1.23 draws its arrow on the tooth while 6.1.24 draws one
  outside it. Each of those would have become an `if (rule_id === …)`.

  Marks now separate **how it looks** (`params`, drawn from closed enums) from
  **what data it reads** (`text_from`, `suffix_from`, `role` — references the
  validator resolves). Every `box_siglas` names its text source (19 of them),
  no `is_sigla` attribute may be left unread, every arrow declares its
  placement as well as its direction, and every param key and value must be
  declared vocabulary for its kind.

  Three token pairs collapsed to one spelling each — `apex_height`/`apex_level`,
  `vertical`/`straight_vertical`, and `square_bordering_crown`/
  `square_enclosing_crown` (§6.1.3 says "bordeando la corona", §6.1.4 "que
  encierre la corona", and pp. 6-7 draw the same rectangle). 6.1.5 dropped
  `geometry_input.mode: surface_regions`: the norm asks which surfaces are
  affected and then only writes the siglas in the box, so the mode promised a
  drawing that does not exist. The `surfaces` attribute stays — it is clinical
  data the norm requests, not a drawing instruction.

  Catalog metadata only. No record, no hash and no migration is touched:
  `canonical.py` never reads the catalog, so no finalized record can move.
  CLINICAL-01 to CLINICAL-05 all stay open; in particular no pilar cardinality,
  no mobility scale and no rotation vocabulary was invented.

- feat(nts-05c): **structured finding editor**. The chart becomes a capture
  surface: pick a rule from the catalog, fill the attributes it declares,
  select the targets its scope needs, and create the finding. Existing
  findings can be edited, have their target set replaced, be confirmed one at
  a time when carried forward, and be withdrawn.

  Everything is **catalog-driven**. There is no `switch (rule.rule_id)`, no
  list of the 38 findings in TypeScript and no clinical knowledge in a Vue
  component: `scope` decides what must be picked, `attributes` generates the
  controls, `target_roles` offers the roles, `anchor` asks for the spatial
  references, and `required` decides what blocks saving. The tests use
  **synthetic rules** with invented ids precisely so a pass cannot be
  explained by the code recognising a real one.

  Two consequences worth stating, because the visual reference gets them
  wrong. A removable orthodontic appliance is **arch**-scoped, so the editor
  shows an arch selector rather than a range picker — it reads `scope`, and
  the catalog and the norm both say arch. And a supernumerary tooth has no FDI
  cell, so its subject target is sent with `target_kind: unnumbered_tooth` and
  no tooth number, located by the two interproximal anchors the rule declares.
  Neither behaviour is coded per rule.

  **Surfaces are an attribute, not a target.** The API has no surface target
  kind, and the norm's own `surfaces` vocabulary (M/D/O/V/L) is carried by a
  catalog-declared `enum_multi`. Nothing geometric is ever sent: no SVG region
  id reaches the backend, and no region→surface mapping was invented, because
  the norm labels no side of the drawn crown. The free-form shape §6.1.16 and
  §6.1.33 describe is the pending geometry channel, not this.

  A finding and its targets are created in **one request** — the API takes
  them as one aggregate — so there is no half-created finding to reconcile and
  no client-side pretence of atomicity. Editing attributes and targets are two
  endpoints, and the second uses the version the first reported rather than the
  version the editor opened with. A 409 closes the editor, refetches through
  the same recovery 05A already had, and is never retried; a 422 stays open
  with every problem the server listed.

  The chart is interactive **only while a rule needs teeth**: outside that it
  has no tab stops and no pressed state, so a reader never meets 52 controls
  that lead nowhere. Selection styling uses interaction tokens — red and blue
  stay reserved for what a finding means.

  Still pending: the normative finding renderer (05D) and the Especificaciones
  editor (05E). 05C surfaces a requirement when a rule activates one and never
  marks it satisfied; only `required = true` is described as blocking, and the
  backend remains the authority on finalizing.

- feat(nts-05b): **the official dental layout**. `NtsOdontogramChart` replaces
  the shell's "renderer pending" region with the structure of the norm's own
  *Anexo: Gráfico del odontograma* (NTS N.° 188-MINSA/DGIESP-2022, p. 22):
  four rows stacked permanent upper → deciduous upper → deciduous lower →
  permanent lower, all 52 teeth, each with its FDI number and the annotation
  box the annex reserves beside it.

  Findings are still **not** drawn. A record that already carries some says so
  in words instead — an invented symbol on an odontogram is a false clinical
  statement, while an absent one at least reads as absent.

  Orientation comes from the annex, which prints 18 at the far left and 28 at
  the far right: screen-left is the patient's right, in all four rows. The FDI
  numbers are generated from the quadrants rather than listed by hand, and
  `dentition`, `arch`, `side`, `quadrant` and tooth class are derived from the
  number, never stored. There is no dentition toggle: the official format
  prints both dentitions, so an adult patient still gets all 52 cells.

  The tooth cell reproduces the annex's own geometry — a crown cut by its four
  corner diagonals, with the centre halved on premolars and quartered on
  molars, plus roots pointing away from the midline. Its regions are
  addressable but named **positionally** (`outer-top`, `center-1`…): which
  trapezoid is mesial depends on the quadrant, and that mapping belongs with
  the surface-scoped rules.

  Proportions are read off the annex and expressed as ratios, never as
  dimensions the norm states — it is a 300dpi scan, so its pixels are raster
  readings. Crown height is the same for every class while the width is not
  (molar ≈ 88, premolar ≈ 82, front teeth ≈ 61 against a height of ≈ 68), and
  the annex varies the whole column with it: the annotation box, the number
  and the tooth share one class-dependent width, which is what keeps a box
  over the tooth it belongs to. Roots run a little longer than the crown is
  tall (≈ 1.2×). The six front teeth do not get the posterior's central
  rectangle: the annex closes their diagonals onto a short segment, so their
  centre is a sliver and they read as envelopes rather than boxes.

  The deciduous arches are drawn at **the same size as the permanent ones**.
  The annex measures a deciduous molar at the width of a permanent molar and a
  deciduous incisor at the width of a permanent incisor; its deciduous rows
  are shorter only because they hold ten teeth instead of sixteen. One scale
  serves the whole chart, and the dentitions are told apart by position and by
  their FDI numbers rather than by being miniaturised.

  Upper premolars measure ~7% narrower than upper molars in the annex while
  lower premolars measure the same as lower molars. One width per tooth class
  is kept regardless: that difference is **raster/artwork variation tolerated,
  not a normative distinction**, and nothing in the norm's text supports an
  arch-dependent premolar.

  Chromatically neutral on purpose — the norm gives red and blue meaning, and
  spending them on decoration now would make them unreadable later. Stroke and
  fill are SVG presentation attributes rather than a stylesheet rule, so the
  outline cannot come back as a solid block if a CSS chunk fails to load.

  One scroll container holds all four rows: rows that scrolled independently
  would drift and put a deciduous tooth under the wrong permanent one. The
  canvas keeps a deterministic minimum width, derived from the widest row
  instead of shrinking teeth, so a narrow screen scrolls without the page
  itself overflowing and without the clinical order ever reflowing.

  No HTTP and no lifecycle state in the chart: the shell passes down the draft
  if there is one, otherwise the record in force as read-only, otherwise the
  blank form marked as standing for no clinical record.

- feat(nts-05a): **frontend data layer + lifecycle shell** for the MINSA
  odontogram. The NTS-02 placeholder is replaced by
  `NtsOdontogramShell.vue`, which talks to the B.3 API through
  `useNtsApi` (transport only) and `useNtsOdontogramRecord` (state only).
  This is **not** the clinical renderer: the chart region is explicitly
  marked pending, and the finding editor, geometry capture and signature
  are all still absent.

  What the shell does: load the catalog, the record in force, the open
  draft and the history; open an empty draft (`seed: 'empty'` always —
  carry-forward is not offered until findings can be reviewed one by one);
  finalize; discard with a reason. What it deliberately does not do:
  retry a 409 (it refetches the authoritative state and says what
  happened), infer `expected_version + 1` (every version comes from the
  server), or keep clinical data in `localStorage`.

  A load is guarded by a generation token and an `AbortController`, so a
  response for the previous patient can never land on the new one, and
  state is cleared before the first byte of the new patient arrives. The
  composable takes its patient and norm version as reactive sources rather
  than snapshots, so reusing the shell across patients reloads the right
  one.

  `types/nts.ts` mirrors `nts/schemas.py` and nothing else: the 38 rules
  arrive from `GET /nts/catalogs/{norm_version}`, never from a second
  hand-maintained copy in TypeScript.

  `DiagnosisMode` hides its two Original-shaped panels under the MINSA
  profile — the "registered conditions" card and the plan CTA are backed by
  `Treatment` rows with `status = 'existing'`, and presenting those as NTS
  findings would erase the distinction the norm draws between a *hallazgo*
  and a *procedimiento*. Under the Original profile they are unchanged; the
  data is untouched either way.

  Stage (`diagnosis` / `evolution` / `discharge` / `other` + free label) is
  product metadata, not a normative requirement.

- feat(nts-04b.3): **HTTP API** for NTS clinical records, mounted at
  `/api/v1/odontogram/nts` as its own subrouter — 16 endpoints across catalog,
  patient records, findings, targets, specifications and lifecycle. The
  Original profile's routes are untouched. No schema change, no migration.

  Permissions reuse `odontogram.read` / `odontogram.write`; no NTS-specific
  permission is introduced. `get_db()` keeps owning the transaction: the
  router never commits or rolls back, and a domain failure is re-raised as an
  `HTTPException` so the dependency actually rolls back — returning a 4xx
  normally would commit a half-applied mutation, and a test proves it does
  not. Domain errors map centrally to 404 / 409 / 422 with machine-readable
  codes (`nts_version_conflict`, `nts_state_conflict`, `nts_draft_conflict`,
  `nts_clinical_validation`, `nts_record_not_found`), and a clinical
  validation failure keeps its full list of problems instead of one string.

  Every mutation carries `expected_version` in the body — which is why
  removals are `POST .../remove` rather than `DELETE` with a body — and every
  mutation response reports the version the server actually reached, so no
  client infers `expected_version + 1`. Request schemas are `extra="forbid"`,
  so `clinic_id`, `actor_id`, `status`, `version` and the hash fields cannot
  be smuggled in. `PATCH` on a record distinguishes an absent key (leave
  alone) from an explicit `null` (clear), and `PUT` on a specification
  requires `finding_id` even when null so omitting it can never read as
  "unlink". `GET current` / `GET draft` answer `200` with `data: null` when
  there is none — only a named record that does not exist is a 404, and an
  unknown `norm_version` is distinguishable from an empty history.

  The catalog is served read-only (`GET /nts/catalogs`,
  `GET /nts/catalogs/{norm_version}`) so no client re-types the 38 rules in
  TypeScript; the catalog's own Pydantic models are the response schema.
  Record history is paginated and never loads findings or targets.

  Two read-only service additions this required: `list_records(...)` and a
  `clear_observations` flag on `update_metadata` (`None` already meant "leave
  unchanged", so clearing needed its own signal). The audit trail is **not**
  exposed: its access model and volume need their own design. Nothing here
  claims a digital signature, compliance or SIHCE accreditation.

- feat(nts-04b.2): **transactional service** for NTS clinical records —
  `nts/service.py`, `nts/validation.py`, `nts/audit.py`, `nts/exceptions.py`.
  No router, no endpoints, no schema change: `odo_0004` is untouched.

  Every mutation is compare-and-bump → validate → mutate → one audit event →
  flush, and the transaction belongs to the caller: the service flushes but
  never commits and never rolls back globally, so a caller's rollback loses
  the mutation, the version bump and the audit event together. One user
  operation is exactly one version bump, however many targets it moves. The
  bump is a single `UPDATE ... WHERE version = :expected AND status='draft'
  RETURNING version`, which also takes the parent row lock that serialises
  concurrent child writers; the identity map is resynchronised with
  `set_committed_value` so a stale ORM version can never be written back.

  Validation is entirely catalog-driven — attributes, scopes, anchors, arch
  cardinality, range grouping, target roles and required Especificaciones all
  derive from `get_nts_rule`. There is **no `rule_id` branch** in the service
  or the validators, and `notes` are never executable. A role cardinality the
  norm does not state is not invented: `pilar` stays optional. A
  `required=false` specification requirement (`crown_metal_colour`) is
  surfaced but never blocks finalize.

  Carry-forward copies findings, attributes, targets and finding-linked
  specifications for individual review, and deliberately does **not** copy
  observations or general specifications. Finalize is blocked while any
  carried-forward finding remains, and there is no bulk confirm. Finalize
  resolves the authorship snapshot of the *recorder*, sets the lifecycle
  fields and the SHA-256 of CanonicalSnapshotV1 without an intervening flush,
  and writes `supersession_recorded` against the **new** record — the
  predecessor is never touched. `finalized` means DenPlant locked the record;
  it does not mean the document is digitally signed and claims no compliance
  or accreditation.

- feat(nts-03.1): the catalog now expresses **target roles** and **required
  Especificaciones** structurally, so a consumer never branches on a `rule_id`.
  New `RoleDef` + `NtsRule.target_roles` replaces the `target_roles` *attribute*
  on 6.1.29 — a pilar is a property of one tooth inside the span, and having it
  in both places gave a target's role two sources; the validator now refuses an
  attribute by that name. New `SpecificationRequirement`, declarable on a rule
  or on a single `VariantValue`, plus
  `NtsRule.active_specification_requirements(attributes)`.

  Mapped from a fresh reading of the PDF: 6.1.4 rule-level and required
  (§6.1.4 p.7); 6.1.5 `dde_type=FLUOROSIS` variant-level and required (§6.1.5
  p.8); 6.1.3 rule-level but **`required=false` and flagged
  `needs_clinical_review`** — §6.1.3 (p.6-7) states it for the rule and names
  no crown_type condition, and `CLM` is metal-free, so no per-variant
  obligation was inferred. `pilar` is likewise flagged: §6.1.29 (p.16) mandates
  "líneas verticales sobre los pilares" but states no cardinality, so
  `min_count`/`max_count` stay unset — `None` means the norm is silent, never
  `0`. Rule-level and variant-level requirements are mutually exclusive because
  `nts_record_specifications` stores no requirement code. 38/38 rules intact;
  no schema, migration or persistence change.

- feat(nts-04b.1): NTS clinical record **persistence foundation**. Migration
  `odo_0004` creates the five tables of ADR 0021 — `nts_odontogram_records`,
  `nts_findings`, `nts_finding_targets`, `nts_record_specifications`,
  `nts_record_audit_events` — with their structural constraints and the first
  two triggers in the repo: `trg_nts_records_guard` (a finalized or discarded
  record is terminal; no NTS record is ever physically deleted) and
  `trg_nts_audit_append_only` (the audit trail takes INSERT only). Nothing in
  the Original profile is touched and no data is backfilled.

  Structure only: the DB enforces the lifecycle triples, `version >= 1`, the
  one-draft and linear-supersession-chain partial indexes, FDI validity
  (permanent *and* deciduous), target-kind column coherence with no sentinel
  tooth numbers, and — via composite foreign keys — that a finding cannot
  diverge from its record's `norm_version` and a specification cannot point at
  a finding of another record. A finding reaches its record through that one
  composite FK only: both its columns are NOT NULL, so it already guarantees
  parent existence, version equality and the cascade. Normative meaning stays
  in the catalog and the service, never in DDL.

  Geometry is refused at write time too: `ck_nts_target_geometry_pending`
  (`geometry IS NULL`) makes a stored shape structurally impossible while
  canonicalization version 1 is the only one implemented, so a draft can never
  accumulate a shape that would later block finalizing it. The future migration
  that introduces version 2 drops the CHECK. The three nullable JSONB columns
  use `none_as_null` so Python `None` becomes SQL NULL rather than the JSON
  value `null`.

  New `nts/canonical.py` implements **CanonicalSnapshotV1**: build → serialise
  → SHA-256, with a hand-written JSON emitter so a library upgrade can never
  change a stored record's digest. Version 1 refuses floats and any non-null
  `geometry` (GEOMETRY CONTRACT PENDING) rather than dropping them silently.
  Pinned by two golden vectors with literal expected bytes and digests.

  **Not implemented here:** router, endpoints, API schemas, the clinical
  service, operative compare-and-bump, carry-forward, finalize, discard,
  supersede, automatic audit-event generation, geometry capture, digital
  signature and NTS permissions. `finalized` means DenPlant locked the
  snapshot — **not** that the document is digitally signed, and no compliance
  or SIHCE accreditation is claimed.

- docs(nts-04a.2): design/ADR for the NTS clinical record model. **No code,
  no tables, no migrations** — `docs/technical/odontogram/nts-record-model.md`
  plus ADR 0021 (five-table hybrid relational + JSONB persistence model) and
  ADR 0022 (draft/discarded/finalized lifecycle, no hard delete, supersession
  instead of mutation, append-only audit trail, optimistic locking,
  carry-forward with individual review, `content_hash` over
  CanonicalSnapshotV1). ADR 0022 is written to be reviewable on its own by a
  legal/clinical reader. Records the explicit non-claims: `finalized` is not a
  digitally signed document and no compliance or SIHCE accreditation is
  asserted; the signature workstream is separate. Geometry storage stays
  **GEOMETRY CONTRACT PENDING** until the anatomical coordinate space is
  versioned. Implementation lands in NTS-04B.

- feat(nts-03): versioned normative catalog for NTS N.° 188-MINSA/DGIESP-2022
  under `nts/catalog/` — typed schema, structural validator, cached loader and
  the 38 rules of §6.1 as data (`pe_nts_188_2022.json`). Each rule records its
  scope, structured attributes, colour semantics, render marks, geometry source
  and the page/section it came from; the two misprinted headings in the PDF
  (6.1.15 as "6.115", 6.1.23 as "5.2.23") are preserved in `document_label`
  rather than normalised away. 15 of the 38 rules are **not** tooth-scoped
  (6 surface, 3 pair, 3 range, 3 arch), which is the constraint NTS-04 has to
  design around. Identity is `norm_version + rule_id`, never the sigla — the
  norm reuses "S" (6.1.26/6.1.35) and "M" (6.1.19/6.1.28), so cross-rule sigla
  collisions are explicitly not validation errors. Three items the norm leaves
  genuinely open (`rotation_sense`, `mobility_degree`, `dde_type=FLUOROSIS`)
  are flagged `needs_clinical_review` instead of being filled in from general
  dental knowledge. The catalog is cached (`functools.cache`) and therefore
  shared process-wide, so it is immutable *all the way down*: every collection
  is a tuple and `RenderMark.params` is a read-only mapping — without that, one
  `mark.params[...] = ...` poisoned the cache for every later caller (found by
  probe, fixed, regression-tested). Data only: no findings model, no persistence, no
  migrations, no endpoints and no renderer — §5.6 digital immutability is
  documented as an open NTS-04 gate, not implemented. Docs:
  `docs/technical/odontogram/nts-188-catalog.md` (includes the `preview.html`
  coverage matrix — 34/38, the 4 missing are the non-tooth-scoped prosthetic
  rules — and the legacy-vocabulary matrix).

- feat(nts-02): profile selector + profile-aware mount point. New
  `useOdontogramProfile` composable reads/persists the NTS-01 preference
  (`GET/PUT /api/v1/odontogram/preferences`); the local value changes only
  after a successful PUT, so selector and backend cannot drift, and a failed
  read falls back to `original`. `OdontogramProfileView` picks the renderer
  (`OdontogramChart` for `original`, `NtsOdontogramPlaceholder` for
  `pe_nts_188_2022`) and forwards props/listeners verbatim through `$attrs`;
  `OdontogramChart` itself stays untouched and profile-unaware — no
  `if (profile === ...)` inside it. `OdontogramProfileSelector` is wired into
  the `DiagnosisMode` card header only; `HistoryMode` and the treatment-plan
  chart keep rendering the original chart on purpose (swapping a working
  chart for a placeholder there would remove function without adding any).
  The backend remains the single source of truth — no localStorage mirror.
  Placeholder only: no teeth, findings, snapshots, NTS catalog or graphic
  rules yet.

- feat(nts-01): per-user, per-clinic odontogram profile preference
  (`original` | `pe_nts_188_2022`). New module-owned table
  `odontogram_user_preferences` (migration `odo_0003`) mirroring
  `notification_preferences` — core `User` / `ClinicMembership` are left
  untouched and `Clinic.settings` is deliberately not used, since that
  would impose one format on every member of the clinic. Endpoints
  `GET/PUT /api/v1/odontogram/preferences` derive `user_id` / `clinic_id`
  from the authenticated clinic context, so a caller can only read or
  write their own preference. Absence of a row means `original`; reads
  never create one and existing users are not backfilled. Gated by clinic
  membership only — picking a chart format is a personal UI choice, not a
  clinical operation, so no new `nts.*` permission is introduced yet.
  No renderer, snapshots, findings or NTS catalog in this change.

- security: enforce the central patient access policy for odontogram roots and treatment-ID routes.

- fix(#184): the layer type-checks clean under `nuxt typecheck`. Real bugs behind the errors: treatment colour dots read `TREATMENT_COLORS` (a `{light,dark}` config) as a hex string — they now go through `getTreatmentColor()`; the toast undo action used the v3 `click` key (v4: `onClick`), `UPopover :ui.width` is `content`; `TreatmentBar` emitted a possibly-undefined fallback status; touch drags on the timeline guard an empty `touches` list. Tooth-position lookups are typed by `ToothPosition` (1–8) instead of `|| MAP[1]` fallbacks.
- fix(#183): `TreatmentService.perform` publishes with `db=` so the payments earned ledger and the plan-item completion run in its transaction (ADR 0019).
- feat(events): `TreatmentService.perform` accepts `publish_price=False`
  to emit `odontogram.treatment.performed` with `unit_price: null` —
  the caller declares the revenue already attributed elsewhere
  (treatment_plan per-session billing). Default behaviour unchanged.

- style(lint): first ESLint pass over this module's frontend layer —
  module layers were outside the linter's base path until now, so
  CI had never checked them. Mostly auto-fixed formatting; see the
  PR for the handful of manual fixes.

- fix(frontend): render an error state with retry when the odontogram
  fetch fails, instead of falling through to a fabricated all-healthy
  32-tooth chart (audit S5, #95). Adds `odontogram.messages.loadError`.

- feat(ux): ``DiagnosisMode`` now publishes a ``treatmentsToothById`` map
  and an ``onTeethHover`` callback through the
  ``odontogram.diagnosis.sidebar`` slot ctx, so the clinical-notes
  sidebar can pulse the matching tooth on the chart when the user
  hovers/focuses a note. Reuses the existing ``hoveredTeeth`` →
  ``highlightedTeethProp`` plumbing on ``OdontogramChart``.
- feat(treatments): add ``crown_on_implant`` and
  ``provisional_crown_on_implant`` clinical types. Both render on the
  lateral view as a solid prosthetic fill on the crown path (same code
  path as ``bridge``) — the diagonal-stripes pattern used by regular
  ``crown`` looked too sparse / artificial for implant-supported
  restorations. The two new types appear in ``TreatmentPicker`` under
  the Restauradora category, and count as ``hasReplacementTreatment``
  so the underlying ``missing`` / ``extraction`` state stops fading
  the tooth.
- fix(ToothDualView): when a tooth carrying ``missing`` /
  ``extraction_indicated`` / ``extraction`` state receives a
  prosthetic replacement (implant, bridge, crown, pontic,
  bridge_abutment, overlay, inlay, unerupted), render the tooth at
  full opacity — the restoration supersedes the extracted state.
  Also suppress the dashed/solid X overlays (occlusal + lateral) on
  those teeth, so the X no longer paints over the implant/crown.
  Previously, SVG-level opacity (and the wrapper ``.transparent``
  0.4 dim) faded both the natural anatomy and every overlay, so a
  newly placed implant on an extracted tooth rendered almost
  invisible. Opacity now applies only to natural-anatomy paths and
  only when no replacement is present.
- fix(DiagnosisMode): hide treatments whose
  ``source_module === 'migration_import'`` from the Diagnóstico panel.
  Migrated patients arrived with their entire chart history (often
  decades of crowns, fillings and extractions) flooding the active
  diagnosis workflow. The artefacts remain visible on the odontogram
  via ``ToothRecord.general_condition``, and the historical record
  stays in the History tab + the auto-generated treatment plans.
- refactor(types): drop the ``as unknown as Record<string, unknown>`` cast in ``useTreatments`` now that ``useApi`` accepts ``object`` payloads.
- Added per-module `CLAUDE.md` for AI-agent context (2026-04-27).
- Issue #60: `DiagnosisMode.vue` exposes a right-rail
  `odontogram.diagnosis.sidebar` slot (with mobile slideover) and
  `ConditionsList.vue` exposes a per-treatment
  `odontogram.condition.actions` slot. The clinical_notes module fills
  both — odontogram itself does not depend on it.

## 0.3.0 — initial documented version

- Per-tooth state with surface granularity, JSONB-backed.
- Tooth treatment workflow with `added` / `status_changed` /
  `performed` / `deleted` events.
- Drives budget + treatment_plan sync via `odontogram.treatment.performed`.
