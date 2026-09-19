# Changelog — odontogram module

## Unreleased

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
