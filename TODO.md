# Knitwittage — Todo

A running list of work to come back to. Roughly ordered by ease/impact, but feel free to reshuffle.

---

## Stitches & gallery polish

### 7. Open question: editable built-in icons?

Knit, purl, inc1, dec1, YO are low-risk to allow editing — purely visual. Cable crossings
carry rendering smarts (cluster detection, echoes, drag-placement) that a user-edited
icon would break. Possible compromise: editable for simple stitches, locked for cross-
type. Park until someone actually asks.

### ~~8. Inc/dec metadata in the stitch editor~~ ✓

Shipped. "Row effect" fieldset added to the Add / Edit Stitch overlay:

- **No inc/dec** — default for all existing stitches.
- **Decrease by N** stitches.
- **Increase by N** stitches.

Stored as a single signed `delta` field on the user-stitch record (0 = no
change, +N = increase, -N = decrease). The chart-based row-balance check
(#19) only needs the per-row sum of deltas, so we don't need separate
consumes/produces. Older records without the field (including the brief
`consumes`/`produces` schema we shipped on the way) load as `delta: 0`
or migrate via `produces - consumes`.

ARCHITECTURE.md §5.4 updated. Prerequisite for #19 now met.

---

## Layout & responsiveness

### 9. Mobile layout

The desktop 3-column grid doesn't fit phones — left panel survives but the chart and
right panel get cropped. This needs a real responsive design pass, not a quick CSS tweak:

- Breakpoint where panels collapse into bottom sheets / drawers, or stacked rows.
- Chart becomes the dominant viewport; everything else is on demand.
- Touch-friendly target sizes (44×44 minimum for tap targets).
- Pinch-zoom on the chart.
- Pen/finger input parity with mouse for stitch placement.

Worth sketching wireframes before code.

---

## Generate panel

### ~~22. Rename "Generate" → "Colourwork"~~ ✓

Shipped. Right-rail section heading is now **Colourwork**, the first
button reads **Generate random pattern**, and the second stays as
**From image** (#23 / #24 still open against it).

### 23. From-image: extend palette beyond default colours

The image-quantisation step currently maps every pixel to the nearest colour
in the user's *active* palette — so a photo with rich tonal range gets
squashed into 12-ish colours and loses fidelity. Add a palette-source option
in the modal:

- **Active palette only** (default) — current behaviour.
- **Auto-extract N colours from image** — k-means or median-cut over the
  pixels, producing N palette entries the user didn't have. Show the new
  swatches alongside the preview so the user can accept / reject before
  importing. N capped at ~16-24.
- *(stretch)* **Match across saved patterns** — quantise to colours the
  user has used in any previous project loaded from IndexedDB, not just
  this one's palette.

Lives in [js/image.js](js/image.js).

### 28. Random pattern: cap to 2 colours per row

The random-pattern generator currently picks any of the user-selected colours
for each cell ([js/random.js:82](js/random.js)) — so if the user has 5 colours
selected, a row can easily contain all 5. This violates the dominant
stranded-colourwork convention (Fair Isle, Norwegian, etc.) where 2 yarns per
row is the practical limit:

- Floats: each yarn not in use is stranded across the back. 3+ colours per row
  produces multiple long floats — stiff fabric, catches on fingers, harder
  tension to manage.
- Two-handed knitting (one yarn per hand) is the standard technique.

3+ colours per row is occasionally seen in advanced/specialty work but is
uncommon. Intarsia uses many colours but isn't stranded — and isn't really
what our chart paradigm represents.

**Fix:** for each row of the seed pattern, randomly pick 2 colours from the
user's selection and only use those two for that row. Across rows the pairing
can change, so a chart can still feature 5+ colours overall — just not
simultaneously on one row.

UX: probably enforce by default (no toggle) since stranded is the dominant
idiom for chart-driven designs. If we ever want to relax, add a "Stranded
(max 2/row)" / "Intarsia (any)" radio at the top of the random-pattern modal.

### 24. From-image: resize controls don't propagate to preview or grid (bug)

Repro: open "From image", drop an image — preview renders at some default
size. Bump the rows or stitches inputs in the modal: the preview pane
doesn't rebuild, and clicking **Apply to grid** brings the chart through
at the original size, not the resized one.

Two fixes:

- The resize inputs need to trigger a re-quantise + re-paint of the
  preview canvas (debounced, so dragging the number input doesn't thrash).
- On **Apply to grid**, the destination grid must be re-initialised at
  the resized rows×cols and `state.grid` / `state.stitchGrid` sized to
  match before the pixel data lands.

---

## Instructions tab

### ~~13. Cable code rename~~ ✓

Shipped. Crossings now use standard notation:

- `CnF` / `CnB` for **all-knit** cables (e.g. C4F for a 4-stitch left cable).
- `TwnL` / `TwnR` for **mixed knit/purl twists** (e.g. Tw4L for a 4-stitch
  left twist where knits cross over purls).
- 3-cluster crossings with a purl centre but knit outers (K2/P1/K2) are
  correctly classified as cables — only the outer groups determine the type.
- Gallery tiles show `CF (TwL)` / `CB (TwR)` so the user sees both roles.
- Crossing Definitions in the instructions use matching `(Cable Front)` /
  `(Twist Left)` etc. terminology.

### 14a. End-of-piece marker for full no-stitch rows (long-term)

The short-term bug fix shipped — `getActiveKnittingRows()` skips all-no-stitch
rows from the row count so the instructions don't fabricate K/P stitches for
chart placeholders.

The long-term feature is still open: a full no-stitch row separating two regions
of stitches should mean "cast off here, then cast on again for the next piece"
— so a chart with a 1-row gap between two panels generates two separate sets
of instructions with the appropriate cast-off / cast-on lines between them.
Needs a small UX decision around how the user signals "this is a deliberate
end-of-piece break" vs "I just left a row blank by accident".

Now that #11 (cast-on preamble) has shipped, the cast-on line can be reused at
each piece boundary; the cast-off side just needs a `Cast off N stitches` line
in the same position.

### ~~25. Print: option to omit the chart~~ ✓

Shipped. **Include chart** toggle added next to **Icons in chart** in
the Instructions modal — default on. When unchecked, `preparePrint()`
skips the chart panel rendering AND the legend, leaving just the
text instructions + abbreviation block. Useful for very large pieces
where chart pages add bulk without value.

### 26. Within-row repeat detection

Many knitting rows have an internal repeat — a small motif that recurs across
the row with non-repeated edge sections. Common in cabled / lace patterns:

```
K2, [P1, C4F, P2, C4B, P2] x 4, P1
```

…rather than the current run-length output:

```
K2, P1, C4F, P2, C4B, P2, P1, C4F, P2, C4B, P2, P1, C4F, P2, C4B, P2, P1, C4F, P2, C4B, P2, P1
```

Detection: take the row's encoded stitch sequence and search for the longest
substring that fits ≥ 2 consecutive times somewhere in the middle, with
optional non-repeating prefix/suffix. Output as
`<prefix>, [<repeat>] x <n>, <suffix>` when the saving is significant
(say ≥ 30% shorter than the run-length form).

Two output styles to consider:
- `[…] x 4` — explicit repeat count.
- `* … rep from * until N sts remain, …` — traditional pattern phrasing.
A simple toggle in the Instructions modal can let the user pick.

Lives in [js/instructions.js](js/instructions.js), in the row-encoder pipeline
between the run-length pass and the final string assembly.

### 27. Cross-row repeat detection (vertical pattern repeat)

Many patterns are built from a small block of rows that repeats vertically —
e.g. an 8-row cable repeat, or a 4-row lace stitch. Instead of emitting:

```
Row 1: ...
Row 2: ...
...
Row 16: ...   (identical to row 8)
Row 17: ...   (identical to row 9)
```

…detect that rows 9–16 are byte-identical to rows 1–8 (and 17–24, etc.) and
collapse to:

```
Rows 1–8: <full text>
Repeat rows 1–8 N more times, until <piece is X cm / X rows>.
```

Detection: hash each row's encoded text + colour run, scan for the smallest
period P such that row[i] == row[i mod P] for all i ≥ P. When P < total
rows / 2 and the pattern holds for the full chart, collapse.

**Shaping caveat.** Sleeves, jumper bodies, etc. often have inc/dec rows
that break a strict repeat — but the *texture* still repeats. An experienced
knitter handles this with phrases like:

```
Repeat rows 1–8 in pattern, decreasing 1 st each end every 6 rows
until 80 sts remain.
```

Inferring shaping from a chart is a bigger problem — needs the inc/dec
metadata from #8 + #19's row-balance plumbing, plus pattern recognition for
"increases happen at row edges, every M rows." Worth a follow-up after the
plain vertical-repeat detection lands.

Lives in [js/instructions.js](js/instructions.js); needs the row strings as
discrete units so they can be compared. The current encoder buffers `rowsText`
already (see the abbreviations-block code at line ~290) — extend that buffer
to a per-row array and hash from there.

---

## Bigger features

### 16b. Canvas tiling for big grids

`GridView` paints a single `<canvas>` element. Browsers cap one canvas
dimension at ~16 384px (Safari/iOS) and even where the dimension cap is
higher (Chrome desktop = 32 767px), GPU memory becomes the bottleneck —
at 22 000² that's ~1.94GB per canvas, which mid-range Windows GPUs
white-out on. Currently `GRID_CANVAS_LIMIT_PX = 16000`, which means
1000×1000 grids top out at ~0.68× zoom (cells ~15px) instead of the 1.0×
cap that smaller grids reach.

The fix: split the chart across a grid of smaller canvas tiles, each
under the per-canvas limit. The `redrawAll` loop iterates tiles instead
of one canvas; `cellAt(clientX, clientY)` translates through tile rect
math. Trade-off: more bookkeeping, more state in `GridView`, but
1000×1000 reaches 1.0× zoom cleanly and we lose the canvas-size cap as a
fragile point (§7.10).

When this lands, also bump `GRID_CANVAS_LIMIT_PX` (or remove it
entirely) and update §7.10 of ARCHITECTURE.md.

### ~~17. Row & column insert / delete~~ ✓

Shipped. Right-click on a row number (left or right rail) or column number
(top or bottom rail) to insert or delete that row/column. Right-click on
cells stays free for paste-cancel / colour-erase.

**Grow/shrink model** (chose this over the original "fixed-bounds, shift
contents" idea, after weighing UX): insert grows the grid by 1, delete
shrinks by 1. No silent content loss.

- Insert capped at GRID_MAX = 1000 — refuses with a toast at the limit.
- Delete refuses below GRID_MIN = 2.
- Delete prompts a confirm if the row/col has any colour or stitch content.
- Column operations clear any cluster (cable / multi-cell stitch) crossing
  the affected column, with a confirm before insert if a cluster spans the
  insert point. Reuses `clearOverlappedClustersInRow()` to keep cluster-id
  semantics consistent (§7.4).
- Selection / paste-ghost / knit-mode all reset cleanly on dimension change
  (the same `afterDimensionChange()` follow-up the Resize button uses).
- Single undo entry per operation.

Lives in [js/app.js](js/app.js) — new `insertRowAt` / `deleteRowAt` /
`insertColAt` / `deleteColAt` functions plus the `rail-context-menu` UI.

### 19. Per-row stitch counter + inc/dec balance check

Two related capabilities that share the same plumbing.

**Phase 1 — visible row count.** A narrow column between the chart and the right panel
showing the active stitch count per row (cells minus no-stitch). Useful as a sanity
check ("did I pad this row right?") and the obvious place to surface row deltas later.
Hide the column above ~100 rows to keep the workbench uncluttered, with a manual toggle.

**Phase 2 — stitch metadata.** Each stitch type declares how many stitches it consumes
from the previous row and produces for the next. Built-ins are easy to populate:

| Stitch        | consumes | produces | delta |
|---------------|---------:|---------:|------:|
| knit / purl   |        1 |        1 |     0 |
| K2tog / SSK   |        2 |        1 |    −1 |
| K3tog / S2KP  |        3 |        1 |    −2 |
| YO            |        0 |        1 |    +1 |
| M1L / M1R     |        0 |        1 |    +1 |
| left/right cross | n cells | n cells | 0 |
| no-stitch     |        0 |        0 |     0 |

User stitches need a small fieldset in the stitch editor capturing the same info
(default: "1 in, 1 out — same"). Bump the gallery file format to carry it; existing user
stitches without metadata default to "same".

**Phase 3 — balance check.** When row *N* contains any inc or dec stitches, calculate
the *expected* count for row *N+1* (sum of `produces` for row N's cells), then compare
to row *N+1*'s actual stitch count. Flag mismatches visually in the row-count column
(red dot or asterisk next to the row number) and surface a tooltip explaining the
discrepancy. Catches the common shaping mistake where a knitter adds a K2tog but forgets
to remove a cell from the following row.

### 20. Garment outline generator (jumper, beanie, …)

A "start me off" feature that produces blank but correctly-shaped chart panels for a
small set of canonical garments, sized to the user's body and gauge. The user then
fills in stitches/cables/colourwork on top of the generated outline. Two goals:
showcase what the app can do for full garments, and stress-test the workbench on
genuinely large grids.

**Inputs (per garment)**
- Body measurements relevant to the garment (chest, length, sleeve length, upper-arm
  circumference, neck, head circumference, etc.).
- Gauge: stitches per swatch + rows per swatch (shares plumbing with the stitch-count
  calculator, #18).
- Fit / ease preference: e.g. **Hugging** (negative or zero ease), **Standard**,
  **Loose** (extra positive ease). Translates to a per-measurement allowance.

**Outputs**
- One generated chart per panel — for a basic crew-neck jumper that's three charts:
  **Front**, **Back**, **Sleeve** (×2 implied). Each chart is correctly sized in rows
  and columns and pre-populated with no-stitch cells outside the panel outline plus
  plain stockinette inside, with shaping increases/decreases at the right rows for
  underarm taper, sleeve cap, neckline, etc.
- Outline is a starting point — the user can then drop cables, colourwork, texture
  stitches into the body of the panel without having to work out the silhouette.

**Initial templates to ship**
- **Basic crew-neck jumper** — front / back / sleeve. Knit-flat construction is the
  simplest first cut (top-down or bottom-up in the round are alternatives we can add
  later if asked).
- **Beanie** — a small, satisfying example that exercises crown decreases.

Acknowledge upfront in the UI that there are many ways to construct a jumper (flat
vs in-the-round, top-down vs bottom-up, set-in vs raglan vs drop-shoulder); we are
not trying to ship a full pattern library, just a couple of well-chosen starters.

**Notes**
- Need an "ease table" per garment per fit option that the generator reads from —
  keep it data-driven so new garments are just a new entry, not new code.
- Round stitch and row counts to whole numbers; show the rounding error so the user
  can see how far off-target the gauge maths landed.
- Save last-used measurements per garment in IndexedDB so a user revisiting doesn't
  retype everything.
- Good follow-up to #18 (stitch-count calculator) — same gauge inputs, same unit
  handling, same rounding philosophy. Worth designing them as a single coherent
  "sizing" surface rather than two unrelated dialogs.

### 21. Recipient profiles ("People") + body-vs-garment measurement model

Save the people you knit for so measurements aren't re-entered on every project, and
draw a clear line between **body measurements** (what the wearer actually is) and
**garment measurements** (what the finished piece needs to be). Pairs with #20 —
the outline generator's inputs come from a Person + a per-garment style choice.

**People**
- Create / edit / delete recipients with a name and a set of body measurements.
- Persist in IndexedDB. Future patterns can pick a saved person and pre-fill.
- When opening a saved person on a new project: show the stored measurements with
  an obvious "Looks right? Update if anything's changed." nudge — measurements drift
  (kids especially), and stale numbers produce bad garments quietly.
- Optional: "last measured" date per measurement so the user can see how stale the
  data is.

**Body measurements vs garment measurements**
Body measurements describe the wearer. Garment measurements describe the finished
piece. The generator needs both — body + a styling choice → garment.

- *Body, anchored*: chest/bust, neck circumference, shoulder width, upper-arm
  circumference, wrist circumference, shoulder-to-wrist, underarm-to-wrist, nape-to-
  waist, waist-to-hip, head circumference, etc. These are facts about the person.
- *Garment, derived from body + styling choices*: finished chest (= body chest +
  ease), finished sleeve length (depends on whether the wearer wants short / above-
  elbow / standard / over-the-hands / turn-up cuff), finished body length, finished
  neckline depth, etc.

**Sleeve length is the canonical example** — one body measurement (shoulder-to-wrist
or underarm-to-wrist) maps to many possible garment sleeve lengths:

- **Cap** (just covers the shoulder).
- **Short** (above the elbow — knitted tee).
- **Three-quarter** (mid-forearm).
- **Standard** (to the wrist bone).
- **Over-the-hands** (extra length, often with a thumbhole).
- **Turn-up cuff** (standard length plus the depth of the cuff fold, ×2).

Same idea for body length (cropped / standard / tunic), neckline depth (high crew /
standard crew / scoop), etc.

**UX implications**
- The Person dialog captures only *body* numbers — never garment-fit choices.
- The garment generator dialog (#20) captures *styling* choices (sleeve style, body
  length, neckline depth) and combines them with the selected Person + ease setting
  to produce the finished garment measurements before the gauge maths.
- Show the user the *derived* garment measurements before generating, so they can
  sanity-check before a 1000-row chart appears.

**Notes**
- Don't conflate the existing "Pattern is for…" free-text field (if any) with this —
  Person should be a structured record, not a string.
- Privacy: this is just IndexedDB on the user's machine, but treat names + body
  measurements with the same care as any other personal data — don't ship them off-
  device, don't include them in pattern exports unless the user explicitly opts in.
- A pattern saved with a Person attached should reference them by id, not embed a
  copy of the measurements — so if the wearer's chest changes and the user re-runs
  the generator, they get an updated panel.

---

## Onboarding & help

### 29. Tutorial + verbose help mode

The app has accumulated a lot of subtle interactions — right-click on a cell
cancels the paste-ghost, right-click on a row/col rail opens insert/delete,
drag across cells places cables, ctrl+C arms a paste-ghost that ctrl+V drops,
the Erase Stitch / Erase Colour toggles compose with the active tool, etc.
None of this is discoverable without being told.

Two related deliverables:

**Tutorial** — first-run walkthrough that takes the user through:
- Painting + the active-colour palette
- Placing a stitch (single-cell)
- Drag-placing a cable / multi-cell stitch
- Selection → copy / paste / multi-paste; right-click to dismiss
- Resize / Calculate grid size
- Generate Instructions, Print, Knit mode

Probably a coachmark / spotlight overlay (one step at a time, dim the rest)
with Next / Skip controls. Persist `tutorial-seen` in localStorage so it
doesn't fire on subsequent loads. Re-runnable from a "Show tutorial" link
in the masthead or a Help menu.

**Verbose help mode** — a toggle (Help icon in the masthead?) that, when
on, sprinkles small inline overlays at decision points: hover a tool
button to see the keyboard shortcut + erase-toggle compatibility, hover a
row label to see "right-click to insert/delete", hover the Custom-stitch
add button for "drag across 2+ cells if multi-cell, otherwise single-cell."

When off, the UI is clean (status quo). When on, the user sees the same
extra hints any time they hover. Should NOT auto-pop overlays — explicit
hover only, so it's not annoying for repeat use.

Implementation hints:
- Tutorial: a single `<div id="tutorial-overlay">` with one step shown at
  a time, anchored to a target element via `getBoundingClientRect()`.
- Help mode: a body class like `body.help-mode` that reveals
  `.help-hint` siblings (currently `display:none`) on hover.
- Both share an authoring format — a small JSON or JS data structure
  listing each hint's selector + content + which mode it appears in.

---

## Notes

- The active todo list inside the chat session mirrors this file roughly. Treat this
  file as the source of truth between sessions.
- "Verify SW rollout from knitwit-v58 → knitwittage" is no longer relevant — we've
  shipped many cache versions past that, and the active code path doesn't reference
  the old name anywhere.
